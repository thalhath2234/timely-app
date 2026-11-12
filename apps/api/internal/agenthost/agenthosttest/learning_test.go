package agenthosttest

import (
	"context"
	"errors"
	"testing"
	"time"

	"timely-api/internal/agenthost"
)

func (r *rig) workerFor(account string) *agenthost.Worker {
	r.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	w, err := r.sup.Ensure(ctx, account)
	if err != nil {
		r.t.Fatalf("Ensure(%s): %v", account, err)
	}
	return w
}

func (r *rig) next(typ string) agenthost.Message {
	r.t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		select {
		case m := <-r.msgs:
			if m.Type == typ {
				return m
			}
		case <-deadline:
			r.t.Fatalf("no %s message", typ)
			return agenthost.Message{}
		}
	}
}

type learningResult struct {
	OK   bool           `json:"ok"`
	Data map[string]any `json:"data"`
}

func TestLearningRepliesAreScriptedPerTypeAndAccount(t *testing.T) {
	r := newRig(t, nil)
	r.kit.LearningReply("learning.list", map[string]any{"what": "every account"})
	r.kit.LearningReplyFor("acct-2", "learning.list", map[string]any{"what": "acct-2 only"},
		map[string]any{"type": "learning", "event": map[string]any{"id": "ev-1", "kind": "memory", "status": "applied"}})
	r.kit.LearningError("", "learning.rollback", "not_found", "no such ledger entry")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	for account, want := range map[string]string{"acct-1": "every account", "acct-2": "acct-2 only"} {
		reply, err := r.workerFor(account).Request(ctx, "learning.list", map[string]any{"what": "skills"})
		if err != nil {
			t.Fatal(err)
		}
		var res learningResult
		if err := reply.Decode(&res); err != nil || reply.Type != agenthost.TypeLearningResult || !res.OK || res.Data["what"] != want {
			t.Fatalf("%s: %s %+v %v", account, reply.Type, res, err)
		}
	}
	// acct-2's reply also emitted a learning message, stamped with its account.
	m := r.next(agenthost.TypeLearning)
	if m.Account != "acct-2" {
		t.Fatalf("learning message for %q", m.Account)
	}

	_, err := r.workerFor("acct-1").Request(ctx, "learning.rollback", map[string]any{"ledger_entry_id": "x"})
	var re *agenthost.ReplyError
	if !errors.As(err, &re) || re.Code != "not_found" {
		t.Fatalf("rollback: %v", err)
	}
	_, err = r.workerFor("acct-1").Request(ctx, "learning.export", nil)
	if !errors.As(err, &re) || re.Code != "unsupported" {
		t.Fatalf("an unscripted request: %v", err)
	}
	reply, err := r.workerFor("acct-1").Request(ctx, agenthost.TypeSettingsUpdate, map[string]any{"settings": map[string]any{}})
	var res learningResult
	if err != nil || reply.Decode(&res) != nil || !res.OK || res.Data["config_sha256"] != "fake" {
		t.Fatalf("settings.update: %v %+v", err, res)
	}
	got := r.kit.ReceivedOf("learning.list")
	if len(got) != 2 || got[0].Account == got[1].Account {
		t.Fatalf("received %+v", got)
	}
}

func TestEmitSendsLearningMessagesOutsideRuns(t *testing.T) {
	r := newRig(t, nil)
	r.kit.Emit(map[string]any{"type": "learning", "event": map[string]any{"id": "queued-before-ready"}})
	r.kit.WebBackends([]string{"exa"}, 3)
	w := r.worker()
	if ready := w.Ready(); len(ready.WebBackends) != 1 || ready.WebBackends[0] != "exa" || ready.SkillsUpstream != 3 {
		t.Fatalf("ready = %+v", ready)
	}
	first := r.next(agenthost.TypeLearning)
	r.kit.Emit(map[string]any{"type": "learning", "event": map[string]any{"id": "second"}})
	second := r.next(agenthost.TypeLearning)
	var a, b struct {
		Event struct {
			ID string `json:"id"`
		} `json:"event"`
	}
	_ = first.Decode(&a)
	_ = second.Decode(&b)
	if a.Event.ID != "queued-before-ready" || b.Event.ID != "second" || first.Account != "acct-1" {
		t.Fatalf("emitted %s then %s (account %q)", a.Event.ID, b.Event.ID, first.Account)
	}
	select {
	case m := <-r.msgs:
		if m.Type == agenthost.TypeLearning {
			t.Fatalf("a line was emitted twice: %s", m.Raw)
		}
	case <-time.After(200 * time.Millisecond):
	}
}

func TestEmitWithAnotherAccountIsAProtocolViolation(t *testing.T) {
	r := newRig(t, nil)
	w := r.worker()
	r.kit.Emit(map[string]any{"type": "learning", "_account": "acct-other", "event": map[string]any{"id": "rogue"}})
	select {
	case <-w.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("the supervisor kept a worker that wrote for another account")
	}
	for {
		select {
		case m := <-r.msgs:
			if m.Type == agenthost.TypeLearning {
				t.Fatalf("the handler got the rogue line: %s", m.Raw)
			}
		default:
			if exit := w.Exit(); !exit.Crashed {
				t.Fatalf("exit = %+v", exit)
			}
			return
		}
	}
}
