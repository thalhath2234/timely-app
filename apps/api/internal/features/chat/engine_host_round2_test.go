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
