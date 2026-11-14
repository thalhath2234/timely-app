package chat

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/agenthost/agenthosttest"
)

// The worker takes Run once but its ack comes after Go's approval.answer
// timeout (its message loop was busy). That is not a refusal: Go queues no
// continuation, so the approved call runs once, not twice.
func TestIntegrationAgentEngineHostLateAckRunsTheCallOnce(t *testing.T) {
	oldTimeout, oldDelay := hostAnswerTimeout, agenthosttest.SlowAckDelay
	hostAnswerTimeout, agenthosttest.SlowAckDelay = 300*time.Millisecond, 900*time.Millisecond
	t.Cleanup(func() { hostAnswerTimeout, agenthosttest.SlowAckDelay = oldTimeout, oldDelay })
	h := hostHarness(t)
	c := h.chat("Run", "supervised", "slowack", lines(ls("call_s", obj{"request_id": "slowack-1", "ran_delay_ms": 1500}), reply("Done.", 0)))
	c = h.hostWaiting(c.ID, hostLive)
	h.kit.Fixture("slowcont", lines(ls("call_s"), reply("done again", 0))).ForConversation(c.ID, "slowcont")
	if code, body := h.answerCard(c.ID, "slowack-1", hostOnce, ""); code != 200 {
		t.Fatalf("Run once: %d %s", code, body)
	}
	h.wait(c.ID, "the chat ended", func(c Conversation) bool { return c.Status == "idle" || c.Status == "failed" || c.Status == "stopped" })
	time.Sleep(2500 * time.Millisecond)
	ran := 0
	for _, e := range h.hostEvents(c.ID) {
		if e.Kind == eventRan && strings.Contains(string(e.Detail), `"ok"`) {
			ran++
		}
	}
	if ran > 1 {
		t.Fatalf("the approved call ran %d times", ran)
	}
	for _, s := range h.hostStarts() {
		if s.PreApproved != nil && len(s.PreApproved) > 0 {
			t.Fatalf("a continuation was queued for an answer the worker may have taken: %v", s.PreApproved)
		}
	}
}

// The API dies after a lane claimed a parked card's continuation and before
// Start named the run: the re-claim of the running row with no agent run
// still carries the approved call, so it runs once and its card settles.
func TestIntegrationAgentEngineHostCrashBeforeTheContinuationIsNamedKeepsTheApproval(t *testing.T) {
	h := hostHarness(t, func(o *WorkerEngineOptions) { o.LiveWait = time.Second })
	c := h.chat("List my files", "supervised", "r4crash", lines(ls("call_ls"), reply("x", 0)))
	c = h.hostWaiting(c.ID, hostParked)
	parked := c.HostRequest
	h.kit.Fixture("after", lines(ls("call_ls"), reply("Listed.", 0))).ForConversation(c.ID, "after")
	// What Run once on the parked card and then the claim leave on the row
	// when the lane's process is gone before Start's checkpoint.
	err := h.db.Transaction(func(tx *gorm.DB) error {
		var row Conversation
		if err := h.s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), "user-a", c.ID, &row); err != nil {
			return err
		}
		closeHostCardAs(&row, hostApproved, nil, hostOnce)
		past := time.Now().UTC().Add(-time.Minute)
		row.Status, row.Phase, row.RunEngine = "running", "plan", engineAgent
		row.Lease, row.LeaseUntil = "lease_dead", &past
		row.AgentRunID, row.AgentInstance = "", ""
		row.Continuation = continuationFor(parked)
		row.Revision++
		return tx.Save(&row).Error
	})
	if err != nil {
		t.Fatal(err)
	}
	c = h.wait(c.ID, "the re-claimed turn ends", func(c Conversation) bool { return c.Status == "idle" || c.Status == "failed" })
	starts := h.hostStarts()
	if last := starts[len(starts)-1]; len(last.PreApproved) == 0 {
		t.Fatalf("the re-claimed turn lost the approved call: run.start has no pre_approved (%d starts)", len(starts))
	}
	if cl := closedHost(c); len(cl) != 1 || cl[0].Outcome != hostRan {
		t.Fatalf("the approved call should have run once and settled its card, got %+v", cl)
	}
	if c.Continuation.pending() {
		t.Fatalf("the continuation is still on the row: %+v", c.Continuation)
	}
}

// The API restarts while a continuation turn waits live on a new card B: the
// sweep parks B. No run is live and none is queued, so the approved card A
// whose call never ran must not stay "Approved, not run yet".
func TestIntegrationAgentEngineHostOrphanSweepSettlesTheApprovedCard(t *testing.T) {
	h := hostHarness(t, func(o *WorkerEngineOptions) { o.OrphanAfter = 50 * time.Millisecond })
	c := h.chat("hello", "supervised", "r4orphan", lines(reply("hi", 0)))
	c = h.wait(c.ID, "idle", statusIs("idle"))
	err := h.db.Transaction(func(tx *gorm.DB) error {
		var row Conversation
		if err := h.s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), "user-a", c.ID, &row); err != nil {
			return err
		}
		cardA := HostCard{Kind: cardTerminal, Title: "Run this command?", Command: "ls -la"}
		row.HostRequest = HostRequest{RequestID: "req-A", Run: "run_P", Phase: hostParked, Tool: "terminal", ToolCallID: "call_A", ArgsHash: "a", Card: &cardA}
		closeHostCardAs(&row, hostApproved, nil, hostOnce)
		asked := time.Now().UTC().Add(-time.Minute)
		cardB := HostCard{Kind: cardTerminal, Title: "Run this command?", Command: "pwd"}
		row.HostRequest = HostRequest{RequestID: "req-B", Run: "run_C", Phase: hostLive, Tool: "terminal", ToolCallID: "call_B", ArgsHash: "b", Card: &cardB, AskedAt: &asked}
		row.Status, row.AgentRunID, row.AgentInstance = statusHostApproval, "run_C", "gone:1"
		row.Lease, row.LeaseUntil = "", nil
		row.Revision++
		return tx.Save(&row).Error
	})
	if err != nil {
		t.Fatal(err)
	}
	c = h.hostWaiting(c.ID, hostParked)
	if code, body := h.answerCard(c.ID, "req-B", hostDeny, ""); code != 200 {
		t.Fatalf("deny B: %d %s", code, body)
	}
	c = h.wait(c.ID, "idle", statusIs("idle"))
	for _, cl := range closedHost(c) {
		if cl.RequestID == "req-A" && cl.Outcome != hostNotRun {
			t.Fatalf("card A's call never ran and it reads %q", cl.Outcome)
		}
	}
}

// An MCP server turned Off while its tool's card waits (a command server
// follows the account) cannot run it: Run once on the live card is refused,
// the worker is told to deny, and nothing ran.
func TestIntegrationAgentEngineHostMCPServerTurnedOffWhileACardWaits(t *testing.T) {
	m := &fakeMCP{modes: map[string]string{"notes": mcpAsk}}
	h := hostHarness(t, func(o *WorkerEngineOptions) {
		o.MCP = m
		o.HostSweepEvery = time.Hour // the answer is what is under test
	})
	h.s.SetMCP(m)
	c := h.chat("Note it", "auto", "mcpoff", lines(
		host("c_ask", "mcp_notes_create", obj{"title": "x"}, obj{"toolset": "mcp-notes", "mcp": obj{"server": "notes", "tool": "create", "annotations": obj{}}}),
		reply("{{last_result}}", 0),
	))
	c = h.hostWaiting(c.ID, hostLive)
	m.modes["notes"] = mcpOff
	if code, body := h.answerCard(c.ID, c.HostRequest.RequestID, hostOnce, ""); code != 403 {
		t.Fatalf("Run once after the server was turned off: %d %s", code, body)
	}
	c = h.wait(c.ID, "replied", statusIs("idle"))
	if got := h.approvalAnswers(); len(got) != 1 || got[0].Choice != hostDeny {
		t.Fatalf("the worker must be told to deny: %+v", got)
	}
	if cl := closedHost(c); len(cl) != 1 || cl[0].Outcome != hostDenied {
		t.Fatalf("thread %+v", c.Messages)
	}
	if kinds := eventKinds(h.hostEvents(c.ID)); slices.Contains(kinds, eventRan) || slices.Contains(kinds, eventApproved) {
		t.Fatalf("events %v", kinds)
	}
}

// The sweep denies the waiting card of a server that was turned off.
func TestIntegrationAgentEngineHostMCPServerTurnedOffDeniesTheWaitingCard(t *testing.T) {
	m := &fakeMCP{modes: map[string]string{"notes": mcpAsk}}
	h := hostHarness(t, func(o *WorkerEngineOptions) { o.MCP = m })
	h.s.SetMCP(m)
	c := h.chat("Note it", "auto", "mcpoff2", lines(
		host("c_ask", "mcp_notes_create", obj{"title": "x"}, obj{"toolset": "mcp-notes", "mcp": obj{"server": "notes", "tool": "create", "annotations": obj{}}}),
		reply("{{last_result}}", 0),
	))
	h.hostWaiting(c.ID, hostLive)
	m.modes["notes"] = mcpOff
	c = h.wait(c.ID, "denied by the sweep", statusIs("idle"))
	if cl := closedHost(c); len(cl) != 1 || cl[0].Outcome != hostDenied {
		t.Fatalf("thread %+v", c.Messages)
	}
}

// A parked card's call ran in the terminal's recorded folder (a cd of an
// earlier call). A worker reaped while the card waited starts in the working
// folder, so Run once does not run the call there as approved: the gate
// voids the approval and Go asks again with a card for the folder it runs in.
func TestIntegrationAgentEngineHostContinuationInAnotherFolderAsksAgain(t *testing.T) {
	h := hostHarness(t, func(o *WorkerEngineOptions) { o.LiveWait = time.Second })
	c := h.chat("Clean up", "supervised", "r4cwd", lines(host("call_rm", "terminal", obj{"command": "rm -rf build"}, obj{"cwd": "/sandbox/work/sub"}), reply("x", 0)))
	c = h.hostWaiting(c.ID, hostParked)
	if c.HostRequest.Card.SessionCwd != "/sandbox/work/sub" {
		t.Fatalf("the card does not remember the folder it was judged in: %+v", c.HostRequest.Card)
	}
	h.e.opts.LiveWait = 10 * time.Minute
	// the continuation's worker has no recorded folder
	h.kit.Fixture("cont", lines(host("call_rm2", "terminal", obj{"command": "rm -rf build"}), reply("done", 0))).ForConversation(c.ID, "cont")
	if code, body := h.answerCard(c.ID, c.HostRequest.RequestID, hostOnce, ""); code != 200 {
		t.Fatalf("Run once: %d %s", code, body)
	}
	c = h.hostWaiting(c.ID, hostLive)
	if c.HostRequest.ToolCallID != "call_rm2" || c.HostRequest.Card.Cwd != "/sandbox/work" {
		t.Fatalf("expected a new card for the working folder, got %+v", c.HostRequest)
	}
	for _, e := range h.hostEvents(c.ID) {
		if e.Kind == eventRan {
			t.Fatalf("the call ran in the wrong folder without asking: %v", eventKinds(h.hostEvents(c.ID)))
		}
	}
	if code, body := h.answerCard(c.ID, c.HostRequest.RequestID, hostDeny, ""); code != 200 {
		t.Fatalf("deny: %d %s", code, body)
	}
	c = h.wait(c.ID, "idle", statusIs("idle"))
	for _, cl := range closedHost(c) {
		if cl.Outcome == hostApproved {
			t.Fatalf("the first card still reads approved: %+v", closedHost(c))
		}
	}
}

// A parallel batch: card 1 was answered live, card 2 still sat in the
// follower's queue when run.done (approval_parked, naming card 2) reached it
// before the re-attach. Card 2 waits parked; the thread must not also say it
// did not run.
func TestIntegrationAgentEngineHostParkedQueuedCardIsNotAlsoNotRun(t *testing.T) {
	h := hostHarness(t)
	c := h.chat("hello", "supervised", "r4q", lines(reply("hi", 0)))
	c = h.wait(c.ID, "idle", statusIs("idle"))
	until := time.Now().UTC().Add(3 * time.Minute)
	if err := h.db.Exec("UPDATE agent_conversations SET status='running', lease='lease_L', lease_until=?, agent_run_id='run_x', phase='plan' WHERE id = ?", until, c.ID).Error; err != nil {
		t.Fatal(err)
	}
	_ = h.s.find(h.db, "user-a", c.ID, &c)
	_, tools := h.s.newToolRun(context.Background(), &c)
	r := &agentRun{id: "run_x", uid: "user-a", cid: c.ID, lease: "lease_L", tools: tools, conv: c,
		answered: map[string]string{"req-1": hostOnce},
		cards:    map[string]hostPending{"call_2": {tool: "terminal", argsHash: "h2", card: HostCard{Kind: cardTerminal, Title: "Run this command?", Command: "pwd"}}}}
	var q workerEvent
	q.Kind = "approval.request"
	q.Payload.RequestID, q.Payload.ToolCallID, q.Payload.Tool = "req-2", "call_2", "terminal"
	r.hostQueue = []workerEvent{q}
	h.e.parkRun(r, runDone{Reason: "approval_parked", Parked: &runParked{RequestID: "req-2", Tool: "terminal", ArgsHash: "h2", ToolCallID: "call_2"}})
	var row Conversation
	if err := h.s.find(h.db, "user-a", c.ID, &row); err != nil {
		t.Fatal(err)
	}
	if row.HostRequest.RequestID != "req-2" || row.HostRequest.Phase != hostParked {
		t.Fatalf("card 2 should wait parked: %+v", row.HostRequest)
	}
	for _, m := range row.Messages {
		if strings.Contains(m.Content, "pwd") && m.Kind == "notice" {
			t.Fatalf("card 2 waits parked and the thread also says it did not run: %q", m.Content)
		}
	}
}
