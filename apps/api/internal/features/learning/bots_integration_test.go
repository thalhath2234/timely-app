package learning

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"sync"
	"testing"

	"timely-api/internal/agenthost"
)

// What a feedback review stages for a Bot (phase 7): the Bot page lists it,
// one push per staged change, Keep applies it (and Undo after Keep takes it
// back), Discard leaves the skill as it was, and a deleted Bot's staged
// changes are discarded.
func TestIntegrationBotStagedSuggestions(t *testing.T) {
	r := newRig(t)
	a := addUser(t, r.db)
	var mu sync.Mutex
	var pushed []string
	r.svc.SetBotStaged(func(uid, botID, pendingID string) {
		mu.Lock()
		defer mu.Unlock()
		if uid == a {
			pushed = append(pushed, botID+"/"+pendingID)
		}
	})
	stage := func(id, bot, pending string) Event {
		t.Helper()
		return r.seed(a, map[string]any{"id": id, "kind": "skill", "action": "patched", "subject": "bot-btc-dip", "status": "staged",
			"pending_id": pending, "bot_id": bot, "origin": "bot", "reason": "bot", "before": "## What you taught me\nOld", "after": "## What you taught me\nNew"})
	}
	keep := stage("r-1", "bot_a", "pend-a1")
	discard := stage("r-2", "bot_a", "pend-a2")
	stage("r-3", "bot_b", "pend-b1")
	r.seed(a, map[string]any{"id": "c-1", "kind": "skill", "action": "created", "status": "staged", "pending_id": "pend-chat"})
	// The same worker event again is no second push.
	line := map[string]any{"id": "r-1", "kind": "skill", "status": "staged", "pending_id": "pend-a1", "bot_id": "bot_a"}
	if ev, err := r.svc.record(context.Background(), a, botLine(a, line)); err != nil || ev != nil {
		t.Fatalf("repeat recorded: %v %v", ev, err)
	}
	mu.Lock()
	if !slices.Equal(pushed, []string{"bot_a/pend-a1", "bot_a/pend-a2", "bot_b/pend-b1"}) {
		t.Fatalf("pushes %v", pushed)
	}
	mu.Unlock()

	// The Bot page: its skill's "What you taught me" and its own staged changes.
	r.kit.LearningReply("learning.skill", map[string]any{"name": "bot-btc-dip",
		"content": "---\nname: bot-btc-dip\n---\n# BTC dip\n\n## What you taught me\nOnly big dips\nNot on weekends\n\n## Notes\nLater"})
	taught, err := r.svc.BotTaught(context.Background(), a, "bot_a", "btc-dip")
	must(t, err)
	if !taught.Found || taught.Text != "Only big dips\nNot on weekends" || len(taught.Staged) != 2 ||
		taught.Staged[0].ID != discard.ID || taught.Staged[1].ID != keep.ID {
		t.Fatalf("taught %+v", taught)
	}
	if got := requestsFor(r.requests("learning.skill"), a); len(got) != 1 || fields(t, got[0])["name"] != "bot-btc-dip" {
		t.Fatalf("skill requests %v", got)
	}
	// A skill not made yet: not found, the staged changes still listed.
	r.kit.LearningError("", "learning.skill", "not_found", "no skill")
	if taught, err := r.svc.BotTaught(context.Background(), a, "bot_a", "btc-dip"); err != nil || taught.Found || len(taught.Staged) != 2 {
		t.Fatalf("missing skill %+v %v", taught, err)
	}
	// The feed filters by Bot.
	code, body, _ := r.call(a, http.MethodGet, "/agent/learning/events?botId=bot_a", nil)
	if events := body["events"].([]any); code != http.StatusOK || len(events) != 2 {
		t.Fatalf("bot_a events %d %v", code, body)
	}

	// Keep applies it; Undo after Keep rolls it back.
	r.kit.LearningReply("learning.pending", map[string]any{"pending_id": "pend-a1",
		"events": []any{map[string]any{"id": "w-kept", "kind": "skill", "action": "patched", "subject": "bot-btc-dip", "status": "applied",
			"ledger_entry_id": "led-5", "after": "## What you taught me\nNew", "pending_id": "pend-a1", "bot_id": "bot_a"}}})
	if code, body, _ := r.call(a, http.MethodPost, "/agent/learning/pending/pend-a1", map[string]any{"choice": "keep"}); code != http.StatusOK ||
		body["event"].(map[string]any)["status"] != StatusKept || body["event"].(map[string]any)["botId"] != "bot_a" {
		t.Fatalf("keep %d %v", code, body)
	}
	r.kit.LearningReply("learning.rollback", map[string]any{"ok": true})
	if code, body, _ := r.call(a, http.MethodPost, "/agent/learning/events/"+keep.ID+"/undo", nil); code != http.StatusOK {
		t.Fatalf("undo after keep %d %v", code, body)
	}
	if rb := requestsFor(r.requests("learning.rollback"), a); len(rb) != 1 || fields(t, rb[0])["ledger_entry_id"] != "led-5" {
		t.Fatalf("rollback %v", rb)
	}
	// Discard asks the worker to throw it away, nothing else.
	r.kit.LearningReply("learning.pending", map[string]any{"ok": true})
	if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/pending/pend-a2", map[string]any{"choice": "discard"}); code != http.StatusOK {
		t.Fatalf("discard %d", code)
	}
	if got := requestsFor(r.requests("learning.edit"), a); len(got) != 0 {
		t.Fatalf("discard edited the skill: %v", got)
	}
	if taught, _ := r.svc.BotTaught(context.Background(), a, "bot_a", ""); len(taught.Staged) != 0 {
		t.Fatalf("still staged %+v", taught.Staged)
	}

	// A deleted Bot's staged changes are discarded, another Bot's and the
	// chat's stay.
	must(t, r.svc.DiscardBot(context.Background(), a, "bot_b"))
	if n := count(t, r.db, "agent_learning_events", "user_id = ? AND bot_id = 'bot_b' AND status = ?", a, StatusDiscarded); n != 1 {
		t.Fatalf("bot_b discarded %d", n)
	}
	if n := count(t, r.db, "agent_learning_events", "user_id = ? AND pending_id = 'pend-chat' AND status = ?", a, StatusStaged); n != 1 {
		t.Fatal("the chat's staged change was touched")
	}
	pend := requestsFor(r.requests("learning.pending"), a)
	if last := fields(t, pend[len(pend)-1]); last["pending_id"] != "pend-b1" || last["choice"] != "discard" {
		t.Fatalf("last pending request %v", last)
	}
}

func botLine(uid string, event map[string]any) agenthost.Message {
	line := learningLine(event)
	line["account"] = uid
	raw, _ := json.Marshal(line)
	return agenthost.Message{Type: "learning", Account: uid, Raw: raw}
}

func TestTaughtSection(t *testing.T) {
	for in, want := range map[string]string{
		"# A\n\n## What you taught me\nOne\nTwo\n\n## Notes\nx": "One\nTwo",
		"## What you taught me\r\nNothing yet.\r\n":             "",
		"# A\n## Other\nx": "",
		"## What you taught me\n- a\n### sub\n- b\n# Next": "- a\n### sub\n- b",
	} {
		if got := TaughtSection(in); got != want {
			t.Errorf("TaughtSection(%q) = %q, want %q", in, got, want)
		}
	}
}
