package chat

import (
	"strings"
	"testing"
	"time"
)

// Phase 5, review round 3: a card the person approved never stays at
// "Approved, not run yet" once the run that should have run its call is over.
// make test-chat-integration runs them.

// A Stop during a continuation turn, before its approved call ran: the
// claim cleared the row's own record of the continuation and the approved
// card belongs to the old parked run, so nothing matched it.
func TestIntegrationAgentEngineHostStopDuringAContinuationSettlesTheApprovedCard(t *testing.T) {
	h := hostHarness(t, func(o *WorkerEngineOptions) { o.LiveWait = time.Second })
	c := h.chat("List my files", "supervised", "r3stop", lines(ls("call_ls"), reply("x", 0)))
	c = h.hostWaiting(c.ID, hostParked)
	h.kit.Fixture("cont", lines(pause(4000), ls("call_ls"), reply("done", 0))).ForConversation(c.ID, "cont")
	if code, body := h.answerCard(c.ID, c.HostRequest.RequestID, hostOnce, ""); code != 200 {
		t.Fatalf("Run once on a parked card: %d %s", code, body)
	}
	h.wait(c.ID, "the continuation runs", func(c Conversation) bool { return c.Status == "running" && c.AgentRunID != "" })
	if code, body := h.post("/chats/"+c.ID+"/stop", ""); code != 200 {
		t.Fatalf("stop: %d %s", code, body)
	}
	c = h.wait(c.ID, "stopped", statusIs("stopped"))
	cl := closedHost(c)
	if len(cl) != 1 || cl[0].Outcome != hostNotRun {
		t.Fatalf("the call never ran, the card reads %+v", cl)
	}
	for _, m := range c.Messages {
		if strings.Contains(m.Content, "it has not run yet") {
			t.Fatalf("the thread still says the call is to come: %q", m.Content)
		}
	}
}

// A run lost after a live Run once (the API crashed, the lease ran out): a
// resumed claim has no PreApproved, and the card stayed approved.
func TestIntegrationAgentEngineHostLostRunSettlesTheApprovedCard(t *testing.T) {
	h := hostHarness(t)
	h.e.opts.RenewEvery = time.Hour // this follower never renews
	c := h.chat("Run", "supervised", "r3lost", lines(
		host("c1", "terminal", obj{"command": "echo hi"}, obj{"ran_delay_ms": 8000}), reply("Done.", 0)))
	c = h.hostWaiting(c.ID, hostLive)
	if code, body := h.answerCard(c.ID, "req-c1", hostOnce, ""); code != 200 {
		t.Fatalf("Run once: %d %s", code, body)
	}
	h.wait(c.ID, "the answer re-attached the run", func(c Conversation) bool { return c.Status == "running" && c.AgentRunID != "" })
	// Another process now holds the run in the row's eyes, and the lease ran out.
	if err := h.db.Exec("UPDATE agent_conversations SET agent_instance = 'other:1', lease_until = now() - interval '1 minute' WHERE id = ?", c.ID).Error; err != nil {
		t.Fatal(err)
	}
	c = h.wait(c.ID, "failed as lost", statusIs("failed"))
	cl := closedHost(c)
	if len(cl) != 1 || cl[0].Outcome == hostApproved {
		t.Fatalf("the run was lost and the card reads %+v", cl)
	}
}

// A Stop that lands while the continuation's approved call runs: the card the
// Stop closed as "not run" belongs to the parked run that asked, and the
// call's own host.ran (a new run, a new call id) still makes it Ran.
func TestIntegrationAgentEngineHostStopWhileAContinuationCallRuns(t *testing.T) {
	h := hostHarness(t, func(o *WorkerEngineOptions) { o.LiveWait = time.Second })
	c := h.chat("List my files", "supervised", "r3contran", lines(ls("call_ls"), reply("x", 0)))
	c = h.hostWaiting(c.ID, hostParked)
	h.kit.Fixture("cont", lines(ls("call_ls", obj{"ran_delay_ms": 700}), reply("done", 0))).ForConversation(c.ID, "cont")
	if code, body := h.answerCard(c.ID, c.HostRequest.RequestID, hostOnce, ""); code != 200 {
		t.Fatalf("Run once on a parked card: %d %s", code, body)
	}
	h.wait(c.ID, "the continuation runs", func(c Conversation) bool { return c.Status == "running" && c.AgentRunID != "" })
	time.Sleep(200 * time.Millisecond)
	if code, body := h.post("/chats/"+c.ID+"/stop", ""); code != 200 {
		t.Fatalf("stop: %d %s", code, body)
	}
	c = h.wait(c.ID, "the call's host.ran settled the card", func(c Conversation) bool {
		cl := closedHost(c)
		return c.Status == "stopped" && len(cl) == 1 && cl[0].Outcome == hostRan
	})
}

// A command that fetched a page leaves outside content, whatever tool ran it:
// the chat's taint names the web (and the host), so a grant never covers a
// later call as if only local files were read.
func TestIntegrationAgentEngineHostNetworkCommandTaintsTheChatAsWeb(t *testing.T) {
	h := hostHarness(t)
	c := h.chat("Read https://example.org/issue/1", "supervised", "r3net", lines(
		host("c1", "terminal", obj{"command": "curl -s https://example.org/issue/1"}), reply("Done.", 0)))
	c = h.hostWaiting(c.ID, hostLive)
	if code, body := h.answerCard(c.ID, "req-c1", hostOnce, ""); code != 200 {
		t.Fatalf("Run once: %d %s", code, body)
	}
	c = h.wait(c.ID, "done", statusIs("idle"))
	var web *TaintSource
	for i := range c.TaintedSources {
		if c.TaintedSources[i].Kind == "web" && c.TaintedSources[i].Host == "example.org" {
			web = &c.TaintedSources[i]
		}
	}
	if web == nil || web.Tool != "terminal" {
		t.Fatalf("tainted sources %+v", c.TaintedSources)
	}
	if !outsideTaint(c.TaintedSources) {
		t.Fatal("a web source counts as local")
	}
}

// A local command leaves no web taint.
func TestIntegrationAgentEngineHostLocalCommandLeavesNoWebTaint(t *testing.T) {
	h := hostHarness(t)
	c := h.chat("List my files", "supervised", "r3local", lines(ls("call_ls"), reply("Done.", 0)))
	c = h.hostWaiting(c.ID, hostLive)
	if code, body := h.answerCard(c.ID, "req-call_ls", hostOnce, ""); code != 200 {
		t.Fatalf("Run once: %d %s", code, body)
	}
	c = h.wait(c.ID, "done", statusIs("idle"))
	for _, s := range c.TaintedSources {
		if s.Kind == "web" {
			t.Fatalf("a local command tainted the chat as web: %+v", c.TaintedSources)
		}
	}
}
