package chat

import (
	"context"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Phase 5, review round 2: runs-lens findings, each with the test that
// failed before the fix. make test-chat-integration runs them.

// Run once on a parked card runs exactly the approved call even when the
// chat's engine was switched to Classic while the card waited (Q-5.1): a
// continuation only makes sense on the agent engine.
func TestIntegrationAgentEngineHostEngineSwitchOnParkedCard(t *testing.T) {
	h := hostHarness(t, func(o *WorkerEngineOptions) { o.LiveWait = time.Second })
	c := h.chat("List my files", "supervised", "switch", lines(reply("Let me look. ", 0), ls("call_ls"), reply("Files: {{last_result}}", 0)))
	c = h.hostWaiting(c.ID, hostParked)
	if code, body := serve(t, h.s, "PATCH", "/chats/"+c.ID, `{"engine":"classic"}`); code != 200 {
		t.Fatalf("switch the engine on a parked chat: %d %s", code, body)
	}
	if code, body := h.answerCard(c.ID, c.HostRequest.RequestID, hostOnce, ""); code != 200 {
		t.Fatalf("Run once on a parked card: %d %s", code, body)
	}
	c = h.wait(c.ID, "continued", func(c Conversation) bool {
		return c.Status == "idle" && strings.Contains(lastMessage(c).Content, "Files: ran terminal")
	})
	starts := h.hostStarts()
	if len(starts) != 2 || starts[1].PreApproved == nil || starts[1].PreApproved["tool_call_id"] != "call_ls" {
		t.Fatalf("the continuation did not start on the agent engine: %+v", starts)
	}
	if cl := closedHost(c); len(cl) != 1 || cl[0].Outcome != hostRan {
		t.Fatalf("card after the continuation: %+v", cl)
	}
}

// The same when the chat follows the account default and Settings → Agent
// is switched to Classic while the card waits.
func TestIntegrationAgentEngineHostAccountEngineSwitchOnParkedCard(t *testing.T) {
	h := hostHarness(t, func(o *WorkerEngineOptions) { o.LiveWait = time.Second })
	c := h.chat("List my files", "supervised", "switch2", lines(reply("Let me look. ", 0), ls("call_ls"), reply("Files: {{last_result}}", 0)))
	c = h.hostWaiting(c.ID, hostParked)
	if err := h.db.Model(&Conversation{}).Where("id = ?", c.ID).Update("engine", "").Error; err != nil {
		t.Fatal(err)
	}
	if err := h.db.Where("user_id = ?", "user-a").FirstOrCreate(&AgentChatSettings{UserID: "user-a"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := h.db.Model(&AgentChatSettings{}).Where("user_id = ?", "user-a").Update("engine", engineClassic).Error; err != nil {
		t.Fatal(err)
	}
	if code, body := h.answerCard(c.ID, c.HostRequest.RequestID, hostOnce, ""); code != 200 {
		t.Fatalf("Run once on a parked card: %d %s", code, body)
	}
	c = h.wait(c.ID, "continued", func(c Conversation) bool {
		return c.Status == "idle" && strings.Contains(lastMessage(c).Content, "Files: ran terminal")
	})
	if starts := h.hostStarts(); len(starts) != 2 || starts[1].PreApproved == nil {
		t.Fatalf("the continuation did not start on the agent engine: %+v", starts)
	}
}

// A Stop that lands while an approved call runs does not turn the call into
// "not run": host.ran is the truth for the card, whenever it arrives
// ("interrupted" is a call that started and was killed by the Stop).
func TestIntegrationAgentEngineHostStopWhileTheApprovedCallRuns(t *testing.T) {
	for _, status := range []string{"ok", "interrupted", "error", "timeout"} {
		t.Run(status, func(t *testing.T) {
			h := hostHarness(t)
			c := h.chat("Run", "supervised", "stopran-"+status, lines(
				host("c1", "terminal", obj{"command": "echo hi"}, obj{"ran_delay_ms": 600, "ran_status": status}), reply("Done.", 0)))
			c = h.hostWaiting(c.ID, hostLive)
			if code, body := h.answerCard(c.ID, "req-c1", hostOnce, ""); code != 200 {
				t.Fatalf("Run once: %d %s", code, body)
			}
			deadline := time.Now().Add(10 * time.Second)
			for len(h.approvalAnswers()) == 0 {
				if time.Now().After(deadline) {
					t.Fatal("the worker never got the approval")
				}
				time.Sleep(10 * time.Millisecond)
			}
			time.Sleep(150 * time.Millisecond)
			if code, body := h.post("/chats/"+c.ID+"/stop", ""); code != 200 {
				t.Fatalf("stop: %d %s", code, body)
			}
			c = h.wait(c.ID, "the call's host.ran settled the card", func(c Conversation) bool {
				cl := closedHost(c)
				return c.Status == "stopped" && len(cl) == 1 && cl[0].Outcome != hostApproved && cl[0].Outcome != hostNotRun
			})
			if cl := closedHost(c); cl[0].Outcome != hostRan || !strings.Contains(c.Messages[1].Content, "chose Run once") || strings.Contains(c.Messages[1].Content, "did not run") {
				t.Fatalf("the call started (%s) but the card reads %+v / %q", status, cl, c.Messages[1].Content)
			}
		})
	}
}

// A Stop before the call started (Hermes abandoned the slot: host.ran
// cancelled) leaves the card "not run".
func TestIntegrationAgentEngineHostStopBeforeTheApprovedCallStarts(t *testing.T) {
	h := hostHarness(t)
	c := h.chat("Run", "supervised", "stopcancel", lines(
		host("c1", "terminal", obj{"command": "echo hi"}, obj{"ran_delay_ms": 400, "ran_status": "cancelled"}), reply("Done.", 0)))
	c = h.hostWaiting(c.ID, hostLive)
	if code, body := h.answerCard(c.ID, "req-c1", hostOnce, ""); code != 200 {
		t.Fatalf("Run once: %d %s", code, body)
	}
	if code, body := h.post("/chats/"+c.ID+"/stop", ""); code != 200 {
		t.Fatalf("stop: %d %s", code, body)
	}
	time.Sleep(900 * time.Millisecond)
	var got Conversation
	if err := h.db.First(&got, "id = ?", c.ID).Error; err != nil {
		t.Fatal(err)
	}
	if cl := closedHost(got); len(cl) != 1 || cl[0].Outcome != hostNotRun {
		t.Fatalf("a call that never started: %+v", cl)
	}
}

// An account turned off while a card waits cannot run it: Run once on a live
// card is refused, the worker gets a deny, and nothing ran (Q-5.2).
func TestIntegrationAgentEngineHostAccountTurnedOffWhileALiveCardWaits(t *testing.T) {
	var on atomic.Bool
	on.Store(true)
	h := hostHarness(t, func(o *WorkerEngineOptions) {
		o.HostAllowed = func(_ context.Context, uid string) bool { return on.Load() && uid == "user-a" }
		o.HostSweepEvery = time.Hour // the answer is what is under test
	})
	c := h.chat("List my files", "supervised", "off-live", lines(ls("call_1"), reply("{{last_result}}", 0)))
	c = h.hostWaiting(c.ID, hostLive)
	on.Store(false)
	if code, body := h.answerCard(c.ID, c.HostRequest.RequestID, hostOnce, ""); code != 403 {
		t.Fatalf("Run once after the account was turned off: %d %s", code, body)
	}
	c = h.wait(c.ID, "replied", statusIs("idle"))
	if got := h.approvalAnswers(); len(got) != 1 || got[0].Choice != hostDeny {
		t.Fatalf("the worker must be told to deny: %+v", got)
	}
	if cl := closedHost(c); len(cl) != 1 || cl[0].Outcome != hostDenied || strings.Contains(lastMessage(c).Content, "ran terminal") {
		t.Fatalf("thread %+v", c.Messages)
	}
	if kinds := eventKinds(h.hostEvents(c.ID)); slices.Contains(kinds, eventRan) || slices.Contains(kinds, eventApproved) {
		t.Fatalf("events %v", kinds)
	}
}

// The same for a parked card: no continuation is queued.
func TestIntegrationAgentEngineHostAccountTurnedOffWhileAParkedCardWaits(t *testing.T) {
	var on atomic.Bool
	on.Store(true)
	h := hostHarness(t, func(o *WorkerEngineOptions) {
		o.LiveWait = time.Second
		o.HostAllowed = func(_ context.Context, uid string) bool { return on.Load() && uid == "user-a" }
		o.HostSweepEvery = time.Hour
	})
	c := h.chat("List my files", "supervised", "off-parked", lines(ls("call_1"), reply("x", 0)))
	c = h.hostWaiting(c.ID, hostParked)
	on.Store(false)
	if code, body := h.answerCard(c.ID, c.HostRequest.RequestID, hostOnce, ""); code != 403 {
		t.Fatalf("Run once after the account was turned off: %d %s", code, body)
	}
	c = h.wait(c.ID, "idle", statusIs("idle"))
	if cl := closedHost(c); len(cl) != 1 || cl[0].Outcome != hostDenied || c.Continuation.pending() || len(h.hostStarts()) != 1 {
		t.Fatalf("thread %+v continuation %+v starts %d", c.Messages, c.Continuation, len(h.hostStarts()))
	}
}

// Turning an account off denies its waiting cards without anyone answering.
func TestIntegrationAgentEngineHostAccountTurnedOffDeniesWaitingCards(t *testing.T) {
	var on atomic.Bool
	on.Store(true)
	h := hostHarness(t, func(o *WorkerEngineOptions) {
		o.HostAllowed = func(_ context.Context, uid string) bool { return on.Load() && uid == "user-a" }
	})
	c := h.chat("List my files", "supervised", "off-sweep", lines(ls("call_1"), reply("{{last_result}}", 0)))
	h.hostWaiting(c.ID, hostLive)
	on.Store(false)
	c = h.wait(c.ID, "denied by the sweep", statusIs("idle"))
	if cl := closedHost(c); len(cl) != 1 || cl[0].Outcome != hostDenied || strings.Contains(lastMessage(c).Content, "ran terminal") {
		t.Fatalf("thread %+v", c.Messages)
	}
}

// A parked card is not answerable after its time even before the sweep
// closes it.
func TestIntegrationAgentEngineHostParkedCardPastItsTimeIsNotAnswerable(t *testing.T) {
	h := hostHarness(t, func(o *WorkerEngineOptions) {
		o.LiveWait = time.Second
		o.ParkFor = func(context.Context, string) time.Duration { return 500 * time.Millisecond }
		o.HostSweepEvery = time.Hour
	})
	c := h.chat("List my files", "supervised", "late", lines(ls("call_1")))
	c = h.hostWaiting(c.ID, hostParked)
	time.Sleep(700 * time.Millisecond)
	if code, body := h.answerCard(c.ID, c.HostRequest.RequestID, hostOnce, ""); code != 409 {
		t.Fatalf("an answer after the card's time: %d %s", code, body)
	}
	c = h.wait(c.ID, "idle", statusIs("idle"))
	if cl := closedHost(c); len(cl) != 1 || cl[0].Outcome != hostExpired || c.Continuation.pending() || len(h.hostStarts()) != 1 {
		t.Fatalf("thread %+v continuation %+v", c.Messages, c.Continuation)
	}
	// Deny still works on a late card? it is closed already: 409.
	if code, _ := h.answerCard(c.ID, "req-call_1", hostDeny, ""); code != 409 {
		t.Fatalf("a second answer: %d", code)
	}
}

// The hardline floor holds end to end in every mode: a catastrophic command
// spelled in a way Hermes' own floor misses gets a block verdict, no card and
// no run, even in Full Access.
func TestIntegrationAgentEngineHostHardlineFloorEndToEnd(t *testing.T) {
	for _, mode := range []string{"supervised", "auto", "full"} {
		t.Run(mode, func(t *testing.T) {
			h := hostHarness(t)
			c := h.chat("Clean up", mode, "floor-"+mode, lines(host("c1", "terminal", obj{"command": "/bin/rm -rf /"}), reply("{{last_result}}", 0)))
			c = h.wait(c.ID, "replied", statusIs("idle"))
			v := h.verdicts()
			if len(v) != 1 || v[0].Verdict != "block" || !strings.Contains(v[0].Message, "never runs") {
				t.Fatalf("verdicts %+v", v)
			}
			if kinds := eventKinds(h.hostEvents(c.ID)); slices.Contains(kinds, eventRan) || slices.Contains(kinds, eventRequested) {
				t.Fatalf("events %v", kinds)
			}
			if len(closedHost(c)) != 0 {
				t.Fatalf("a card was shown for a command that never runs: %+v", closedHost(c))
			}
		})
	}
}

// A terminal grant fires for the next command even though the first one's
// output tainted the chat locally (Q-5.1), through gate.ask with the taint the
// real worker sends for terminal output.
func TestIntegrationAgentEngineHostTerminalGrantAfterOwnOutput(t *testing.T) {
	h := hostHarness(t)
	taint := func(call string) obj {
		o := host(call, "terminal", obj{"command": "git status --short"})
		o["tainted_sources"] = []obj{{"kind": "terminal", "tool": "terminal"}}
		return o
	}
	c := h.chat("Check", "supervised", "grant-taint", lines(taint("c1"), taint("c2"), reply("Done.", 0)))
	c = h.hostWaiting(c.ID, hostLive)
	if code, body := h.answerCard(c.ID, "req-c1", hostChat, ""); code != 200 {
		t.Fatalf("Allow for this chat: %d %s", code, body)
	}
	c = h.wait(c.ID, "replied", statusIs("idle"))
	v := h.verdicts()
	if len(v) != 2 || v[0].Verdict != "approve" || v[1].Verdict != "allow" {
		t.Fatalf("the second git status asked again: %+v", v)
	}
}

// A continuation that parks on a new card before its pre-approved call ran
// loses that approval: the earlier card reads "not run" with a notice, and is
// never left "approved" for good.
func TestIntegrationAgentEngineHostContinuationThatParksAgainSettlesTheEarlierCard(t *testing.T) {
	h := hostHarness(t, func(o *WorkerEngineOptions) { o.LiveWait = time.Second })
	c := h.chat("List my files", "supervised", "park1", lines(ls("call_ls"), reply("x", 0)))
	c = h.hostWaiting(c.ID, hostParked)
	h.kit.Fixture("cont", lines(host("call_pwd", "terminal", obj{"command": "pwd"}), reply("done", 0))).ForConversation(c.ID, "cont")
	if code, body := h.answerCard(c.ID, c.HostRequest.RequestID, hostOnce, ""); code != 200 {
		t.Fatalf("answer %d %s", code, body)
	}
	c = h.wait(c.ID, "parked again", func(c Conversation) bool {
		return c.Status == statusHostApproval && c.HostRequest.Phase == hostParked && c.HostRequest.ToolCallID == "call_pwd"
	})
	cl := closedHost(c)
	if len(cl) != 1 || cl[0].ToolCallID != "call_ls" || cl[0].Outcome != hostNotRun {
		t.Fatalf("closed cards %+v", cl)
	}
	if !strings.Contains(lastMessage(c).Content, "Not run: ls -la") {
		t.Fatalf("no notice for the lost approval: %q", lastMessage(c).Content)
	}
}
