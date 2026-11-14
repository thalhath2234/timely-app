package chat

import (
	"strings"
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
