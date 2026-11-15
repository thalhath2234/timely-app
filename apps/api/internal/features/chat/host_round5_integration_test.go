package chat

import (
	"context"
	"errors"
	"github.com/labstack/echo/v5"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Phase 5, review round 5: the account's Full Access default (set from the
// desktop window) gives a new chat Full Access only on a request that could
// turn it on; any other device gets an Auto chat, as naming Full Access does
// not work there either.
func TestIntegrationNewChatFullAccessDefaultNeedsTheStepUp(t *testing.T) {
	db := integrationDB(t)
	s := New(db, createCatalog, nil)
	s.SetAgentEngine(&fakeEngine{})
	asDesktopWindow(t)
	if code, body := serve(t, s, "PATCH", "/agent/chat-settings", `{"chatPermission":"full"}`); code != 200 {
		t.Fatalf("the desktop window sets the default: %d %s", code, body)
	}
	code, body := serve(t, s, "POST", "/chats", `{"content":"tidy my home folder","client":"web"}`)
	if code != 201 || !strings.Contains(string(body), `"permission":"full"`) || !strings.Contains(string(body), `"shell":true`) {
		t.Fatalf("the desktop window's new chat takes Full Access: %d %s", code, body)
	}
	shellRequest = func(*echo.Context) bool { return false }
	code, body = serve(t, s, "POST", "/chats", `{"content":"tidy my home folder","client":"web"}`)
	if code != 201 || !strings.Contains(string(body), `"permission":"auto"`) || strings.Contains(string(body), `"shell":true`) {
		t.Fatalf("a browser's new chat must not get Full Access: %d %s", code, body)
	}
	if code, _ := serve(t, s, "POST", "/chats", `{"content":"x","client":"web","permission":"full"}`); code != 403 {
		t.Fatalf("naming Full Access from a browser: %d", code)
	}
}

// refusingHostEngine is the engine as the real worker makes it behave when a
// live Run once lands after its wait ended: the answer is recorded here, and
// the worker refuses it at once (park() has already settled the request),
// while its run.done (approval_parked) is still on its way.
type refusingHostEngine struct {
	*WorkerEngine
	refuse atomic.Bool
}

func (w *refusingHostEngine) HostAnswer(ctx context.Context, uid, cid, runID, requestID, choice, lease string) error {
	if !w.refuse.Load() {
		return w.WorkerEngine.HostAnswer(ctx, uid, cid, runID, requestID, choice, lease)
	}
	e := w.WorkerEngine
	e.mu.Lock()
	r := e.runs[runID]
	e.mu.Unlock()
	r.mu.Lock()
	if r.answered == nil {
		r.answered = map[string]string{}
	}
	r.answered[requestID] = choice
	if r.hostWait == requestID {
		r.hostWait = ""
	}
	if lease != "" {
		r.lease = lease
	}
	r.mu.Unlock()
	return errNotFollowing
}

// Card A was approved parked, and its continuation reached card B first. B's
// Run once is refused by the worker (its wait just ended): the follower's
// run.done handling, not the answer, turns it into the continuation, and with
// it card A, whose call never ran and which no run carries now, reads Not run.
func TestIntegrationAgentEngineHostRefusedLiveAnswerKeepsTheCleanUp(t *testing.T) {
	h := hostHarness(t, func(o *WorkerEngineOptions) { o.LiveWait = time.Second })
	w := &refusingHostEngine{WorkerEngine: h.e}
	h.s.SetAgentEngine(w)
	c := h.chat("List my files", "supervised", "r5-first", lines(ls("call_ls"), reply("x", 0)))
	c = h.hostWaiting(c.ID, hostParked)
	h.kit.Fixture("r5-second", lines(host("call_pwd", "terminal", obj{"command": "pwd"}, obj{"live_ms": 1500}), ls("call_ls"), reply("x", 0))).ForConversation(c.ID, "r5-second")
	if code, body := h.answerCard(c.ID, c.HostRequest.RequestID, hostOnce, ""); code != 200 {
		t.Fatalf("answer A: %d %s", code, body)
	}
	c = h.wait(c.ID, "card B live", func(c Conversation) bool {
		return c.Status == statusHostApproval && c.HostRequest.Phase == hostLive && c.HostRequest.ToolCallID == "call_pwd"
	})
	h.kit.Fixture("r5-third", lines(host("call_pwd", "terminal", obj{"command": "pwd"}), reply("done", 0))).ForConversation(c.ID, "r5-third")
	w.refuse.Store(true)
	if code, body := h.answerCard(c.ID, c.HostRequest.RequestID, hostOnce, ""); code != 200 {
		t.Fatalf("answer B: %d %s", code, body)
	}
	c = h.wait(c.ID, "idle after B's continuation", func(c Conversation) bool { return c.Status == "idle" && lastMessage(c).Content == "done" })
	byCall := map[string]string{}
	for _, cl := range closedHost(c) {
		byCall[cl.ToolCallID] = cl.Outcome
	}
	if byCall["call_ls"] != hostNotRun || byCall["call_pwd"] != hostRan {
		t.Fatalf("closed cards %v: card A's call never ran and nothing carries it, B ran", byCall)
	}
}

// Two API processes share the tables (the main checkout and a worktree
// without DB_SCHEMA). The one that follows a live card's run keeps saying so
// on the card; the other neither parks it by its sweep nor takes an answer to
// it as a parked one (which the first one's worker would refuse as busy).
func TestIntegrationAgentEngineHostLiveCardFollowedByAnotherProcessIsLeftAlone(t *testing.T) {
	h := hostHarness(t, func(o *WorkerEngineOptions) { o.RenewEvery = 50 * time.Millisecond })
	c := h.chat("List my files", "supervised", "r5-two", lines(ls("call_ls"), reply("ran", 0)))
	c = h.hostWaiting(c.ID, hostLive)
	s2 := New(h.db, engineCatalog, nil)
	e2 := NewWorkerEngine(s2, WorkerEngineOptions{OrphanAfter: 100 * time.Millisecond, RenewEvery: 50 * time.Millisecond, Logf: t.Logf,
		HostAllowed: func(context.Context, string) bool { return true }})
	s2.SetAgentEngine(e2)
	// Longer than the second process's threshold (OrphanAfter plus two beats).
	time.Sleep(600 * time.Millisecond)
	e2.sweepHost(context.Background())
	var row Conversation
	if err := h.db.First(&row, "id = ?", c.ID).Error; err != nil {
		t.Fatal(err)
	}
	if row.HostRequest.Phase != hostLive || row.AgentRunID != c.AgentRunID || row.HostRequest.FollowedAt == nil {
		t.Fatalf("the other process parked a card whose run is followed: phase %q run %q followedAt %v", row.HostRequest.Phase, row.AgentRunID, row.HostRequest.FollowedAt)
	}
	// An answer that reaches the other process is retried, not queued as a
	// continuation.
	if _, err := s2.answerHost(context.Background(), "user-a", c.ID, c.HostRequest.RequestID, hostOnce, nil, ""); !errors.Is(err, errHostElsewhere) {
		t.Fatalf("an answer at the process that does not follow the run: %v", err)
	}
	if err := h.db.First(&row, "id = ?", c.ID).Error; err != nil || row.Status != statusHostApproval || row.Continuation.Tool != "" {
		t.Fatalf("the refused answer changed the row: %+v %v", row.Status, err)
	}
	// The first process answers it live: its worker runs the call.
	if code, body := h.answerCard(c.ID, c.HostRequest.RequestID, hostOnce, ""); code != 200 {
		t.Fatalf("answer: %d %s", code, body)
	}
	c = h.wait(c.ID, "ran", func(c Conversation) bool { return c.Status == "idle" && lastMessage(c).Content == "ran" })
	if cl := closedHost(c); len(cl) != 1 || cl[0].Outcome != hostRan {
		t.Fatalf("closed cards %+v", cl)
	}
	if n := len(h.hostStarts()); n != 1 {
		t.Fatalf("%d run.starts: a continuation was queued", n)
	}
}

// lateAnswerEngine is the engine when the follower handles the worker's
// run.done (approval_parked) in the window between the answer's commit and
// HostAnswer giving the run the answer's lease: HostAnswer waits until the
// run has left the follower, then calls the real one.
type lateAnswerEngine struct {
	*WorkerEngine
	late atomic.Bool
}

func (w *lateAnswerEngine) HostAnswer(ctx context.Context, uid, cid, runID, requestID, choice, lease string) error {
	if w.late.Load() {
		for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(10 * time.Millisecond) {
			w.WorkerEngine.mu.Lock()
			_, there := w.WorkerEngine.runs[runID]
			w.WorkerEngine.mu.Unlock()
			if !there {
				break
			}
		}
	}
	return w.WorkerEngine.HostAnswer(ctx, uid, cid, runID, requestID, choice, lease)
}

// Review round 6: the worker's run.done (approval_parked) reaches the
// follower after the answer committed but before the answer gave the run its
// lease. The row says what the answer asked for, so the follower still does
// the clean-up (card A's lost approval reads Not run).
func TestIntegrationAgentEngineHostParkBeforeTheAnswerAdoptsItsLeaseKeepsTheCleanUp(t *testing.T) {
	h := hostHarness(t, func(o *WorkerEngineOptions) { o.LiveWait = time.Second })
	w := &lateAnswerEngine{WorkerEngine: h.e}
	h.s.SetAgentEngine(w)
	c := h.chat("List my files", "supervised", "r6-first", lines(ls("call_ls"), reply("x", 0)))
	c = h.hostWaiting(c.ID, hostParked)
	h.kit.Fixture("r6-second", lines(host("call_pwd", "terminal", obj{"command": "pwd"}, obj{"live_ms": 1500}), ls("call_ls"), reply("x", 0))).ForConversation(c.ID, "r6-second")
	if code, body := h.answerCard(c.ID, c.HostRequest.RequestID, hostOnce, ""); code != 200 {
		t.Fatalf("answer A: %d %s", code, body)
	}
	c = h.wait(c.ID, "card B live", func(c Conversation) bool {
		return c.Status == statusHostApproval && c.HostRequest.Phase == hostLive && c.HostRequest.ToolCallID == "call_pwd"
	})
	h.kit.Fixture("r6-third", lines(host("call_pwd", "terminal", obj{"command": "pwd"}), reply("done", 0))).ForConversation(c.ID, "r6-third")
	w.late.Store(true)
	// B's wait (1.5 s) ends while the answer is held back.
	if code, body := h.answerCard(c.ID, c.HostRequest.RequestID, hostOnce, ""); code != 200 {
		t.Fatalf("answer B: %d %s", code, body)
	}
	c = h.wait(c.ID, "idle after B's continuation", func(c Conversation) bool { return c.Status == "idle" && lastMessage(c).Content == "done" })
	byCall := map[string]string{}
	for _, cl := range closedHost(c) {
		byCall[cl.ToolCallID] = cl.Outcome
	}
	if byCall["call_ls"] != hostNotRun || byCall["call_pwd"] != hostRan {
		t.Fatalf("closed cards %v: card A's call never ran and nothing carries it, B ran", byCall)
	}
}
