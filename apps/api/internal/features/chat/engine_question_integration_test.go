package chat

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
	"timely-api/internal/agenthost"
	"timely-api/internal/models"
)

// Phase 4 on the agent engine (Q-4.3, work packages decisions 1-4, 6-10):
// question cards the run waits on, sub-tasks and their taint, and the
// Sensitive and photo routing, against the fake worker. make
// test-chat-integration runs them.

// dayQuestions is a card of two questions: a single-select one with the
// first choice recommended, and an open one.
var dayQuestions = []obj{
	{"qid": "q0", "question": "Which day suits you?", "choices": []string{"Monday", "Tuesday"}, "recommended": 0, "multi_select": false},
	{"qid": "q1", "question": "Anything else?", "choices": nil, "recommended": nil, "multi_select": false},
}

// ask is the fake's clarify directive (agenthosttest): clarify.request,
// then a wait for the answer, run.stop or timeoutMS.
func ask(request string, timeoutMS int, questions ...obj) obj {
	if questions == nil {
		questions = dayQuestions
	}
	return obj{"fake": "clarify", "request_id": request, "questions": questions, "timeout_ms": timeoutMS}
}

// waiting waits until the chat's card for request is on the row.
func (h *engineHarness) waiting(cid, request string) Conversation {
	h.t.Helper()
	return h.wait(cid, "asked "+request, func(c Conversation) bool { return c.Status == "running" && c.Question.RequestID == request })
}

// serveAs is serve for another signed-in account.
func serveAs(t *testing.T, s *Service, uid, method, path, body string) (int, []byte) {
	t.Helper()
	e := echo.New()
	g := e.Group("")
	g.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error { c.Set("userID", uid); return next(c) }
	})
	s.Routes(g)
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	e.ServeHTTP(recorder, request)
	return recorder.Code, recorder.Body.Bytes()
}

// questionPushes counts the chat's "Timely has a question" notifications.
func (h *engineHarness) questionPushes(cid string) int64 {
	var n int64
	h.db.Model(&models.Notification{}).Where("entity_id = ? AND body = ?", cid, tr("", txtPushQuestion)).Count(&n)
	return n
}

// clarifyAnswers are the clarify.answer lines Go sent the fake.
func (h *engineHarness) clarifyAnswers() []struct {
	Run       string         `json:"run"`
	RequestID string         `json:"request_id"`
	Answers   map[string]any `json:"answers"`
	Outcome   string         `json:"outcome"`
} {
	var out []struct {
		Run       string         `json:"run"`
		RequestID string         `json:"request_id"`
		Answers   map[string]any `json:"answers"`
		Outcome   string         `json:"outcome"`
	}
	for _, r := range h.kit.ReceivedOf(agenthost.TypeClarifyAnswer) {
		var body struct {
			Run       string         `json:"run"`
			RequestID string         `json:"request_id"`
			Answers   map[string]any `json:"answers"`
			Outcome   string         `json:"outcome"`
		}
		_ = r.Decode(&body)
		out = append(out, body)
	}
	return out
}

// noCard checks the chat as the apps read it carries an empty card ({})
// outside a wait.
func (h *engineHarness) noCard(cid string) {
	h.t.Helper()
	code, body := serve(h.t, h.s, "GET", "/chats/"+cid, "")
	if code != 200 || !strings.Contains(string(body), `"question":{}`) {
		h.t.Fatalf("GET /chats/%s outside a wait: %d %s", cid, code, body)
	}
}

// questionMessages are the chat's "question" messages.
func questionMessages(c Conversation) []Message {
	var out []Message
	for _, m := range c.Messages {
		if m.Kind == "question" {
			out = append(out, m)
		}
	}
	return out
}

// The run asks; the card is on the row (status running, one push); the
// answer clears it, stays in the thread, reaches the worker, and the same
// run ends with its reply.
func TestIntegrationAgentEngineClarifyAnswerContinuesTheRun(t *testing.T) {
	h := newEngineHarness(t)
	c := h.chat("Book my haircut", "supervised", "ask", lines(
		reply("Let me check one thing. ", 0),
		// The same request twice (a repeated event) still pushes once.
		obj{"type": "event", "kind": "clarify.request", "payload": obj{"request_id": "req-1", "questions": dayQuestions, "timeout_s": 600}},
		ask("req-1", 600_000),
		reply("Booked for {{last_answers}}", 0),
	))
	c = h.waiting(c.ID, "req-1")
	q := c.Question
	if q.Run == "" || q.Run != c.AgentRunID || len(q.Questions) != 2 || q.Questions[0].Choices[1] != "Tuesday" ||
		q.Questions[0].Recommended == nil || *q.Questions[0].Recommended != 0 || q.Questions[1].Choices != nil || q.AskedAt == nil || q.ExpiresAt == nil {
		t.Fatalf("card %+v (run %s)", q, c.AgentRunID)
	}
	if left := q.ExpiresAt.Sub(*q.AskedAt); left != 600*time.Second {
		t.Fatalf("expires after %s, want 10 minutes", left)
	}
	if c.Activity.Draft != "Let me check one thing. " {
		t.Fatalf("the draft before the card was not saved with it: %q", c.Activity.Draft)
	}
	var start struct {
		ClarifyTimeout int `json:"clarify_timeout_s"`
	}
	if err := h.kit.ReceivedOf("run.start")[0].Decode(&start); err != nil || start.ClarifyTimeout != 600 {
		t.Fatalf("run.start clarify_timeout_s %d, %v", start.ClarifyTimeout, err)
	}
	// The row the apps read carries the card, in GET /chats too.
	code, body := serve(t, h.s, "GET", "/chats", "")
	if code != 200 || !strings.Contains(string(body), `"requestId":"req-1"`) {
		t.Fatalf("GET /chats %d %s", code, body)
	}
	time.Sleep(300 * time.Millisecond) // the repeated event reached the follower too
	if n := h.questionPushes(c.ID); n != 1 {
		t.Fatalf("%d question pushes, want 1", n)
	}

	code, body = h.post("/chats/"+c.ID+"/answer", `{"requestId":"req-1","answers":{"q0":"Tuesday","q1":"  after lunch  "}}`)
	if code != 200 {
		t.Fatalf("answer: %d %s", code, body)
	}
	var answered Conversation
	if err := json.Unmarshal(body, &answered); err != nil || answered.Question.pending() {
		t.Fatalf("the card is still on the answered row: %+v %v", answered.Question, err)
	}
	c = h.wait(c.ID, "replied", statusIs("idle"))
	if got := h.clarifyAnswers(); len(got) != 1 || got[0].Run != q.Run || got[0].RequestID != "req-1" || got[0].Outcome != outcomeSubmitted ||
		got[0].Answers["q0"] != "Tuesday" || got[0].Answers["q1"] != "after lunch" {
		t.Fatalf("clarify.answer %+v", got)
	}
	if n := len(h.kit.ReceivedOf("run.start")); n != 1 {
		t.Fatalf("%d run.starts: the answer must continue the same run", n)
	}
	asked := questionMessages(c)
	if len(asked) != 1 || asked[0].Question == nil || asked[0].Question.Outcome != outcomeSubmitted || asked[0].Question.Answers["q0"] != "Tuesday" ||
		asked[0].AgentRun != q.Run || !strings.Contains(asked[0].Content, "Which day suits you?") {
		t.Fatalf("question messages %+v", asked)
	}
	last := lastMessage(c)
	if last.Content != `Let me check one thing. Booked for {"q0":"Tuesday","q1":"after lunch"}` || c.Question.pending() {
		t.Fatalf("reply %q, card %+v", last.Content, c.Question)
	}
	if n := slices.IndexFunc(c.Messages, func(m Message) bool { return m.Kind == "question" }); n != len(c.Messages)-2 {
		t.Fatalf("the question message is at %d of %d: it belongs before the reply", n, len(c.Messages))
	}
	h.noCard(c.ID) // idle
	// The card is closed: a second answer is stale.
	if code, _ := h.post("/chats/"+c.ID+"/answer", `{"requestId":"req-1","answers":{"q0":"Monday"}}`); code != 409 {
		t.Fatalf("a second answer: %d, want 409", code)
	}
}

// Stale, foreign and malformed answers are refused and leave the card
// waiting; Skip ends it with no answers.
func TestIntegrationAgentEngineClarifyRefusesStaleAndBadAnswers(t *testing.T) {
	h := newEngineHarness(t)
	multi := obj{"qid": "q0", "question": "Which days?", "choices": []string{"Mon", "Tue", "Wed"}, "recommended": nil, "multi_select": true}
	single := obj{"qid": "q1", "question": "Which room?", "choices": []string{"A", "B"}, "recommended": nil, "multi_select": false}
	c := h.chat("Plan the week", "supervised", "ask-bad", lines(ask("req-9", 600_000, multi, single), reply("Skipped: {{last_answers}}", 0)))
	c = h.waiting(c.ID, "req-9")
	path := "/chats/" + c.ID + "/answer"
	for name, tc := range map[string]struct {
		body string
		code int
	}{
		"another request":            {`{"requestId":"req-8","answers":{"q0":["Mon"]}}`, 409},
		"no request":                 {`{"answers":{"q0":["Mon"]}}`, 400},
		"unknown qid":                {`{"requestId":"req-9","answers":{"q7":"Mon"}}`, 400},
		"a list for a single choice": {`{"requestId":"req-9","answers":{"q1":["A","B"]}}`, 400},
		"two typed items":            {`{"requestId":"req-9","answers":{"q0":["Mon","Fri","Sun"]}}`, 400},
		"a number":                   {`{"requestId":"req-9","answers":{"q1":7}}`, 400},
		"too long":                   {`{"requestId":"req-9","answers":{"q1":"` + strings.Repeat("x", maxAnswerRunes+1) + `"}}`, 400},
	} {
		if code, body := h.post(path, tc.body); code != tc.code {
			t.Errorf("%s: %d %s, want %d", name, code, body, tc.code)
		}
	}
	if code, body := serveAs(t, h.s, "user-b", "POST", path, `{"requestId":"req-9","answers":{"q0":["Mon"]}}`); code != 404 {
		t.Fatalf("another account: %d %s, want 404", code, body)
	}
	c = h.waiting(c.ID, "req-9")
	if len(h.clarifyAnswers()) != 0 || len(questionMessages(c)) != 0 {
		t.Fatal("a refused answer reached the worker or the thread")
	}
	if code, body := h.post(path, `{"requestId":"req-9","skip":true}`); code != 200 {
		t.Fatalf("skip: %d %s", code, body)
	}
	c = h.wait(c.ID, "replied", statusIs("idle"))
	if got := h.clarifyAnswers(); len(got) != 1 || got[0].Outcome != outcomeCancelled || len(got[0].Answers) != 0 {
		t.Fatalf("clarify.answer after Skip %+v", got)
	}
	if asked := questionMessages(c); len(asked) != 1 || asked[0].Question.Outcome != outcomeCancelled || lastMessage(c).Content != "Skipped: {}" {
		t.Fatalf("after Skip: %+v, reply %q", asked, lastMessage(c).Content)
	}
}

// A multi-select answer with one typed item reaches the worker as a list.
func TestIntegrationAgentEngineClarifyMultiSelect(t *testing.T) {
	h := newEngineHarness(t)
	multi := obj{"qid": "q0", "question": "Which days?", "choices": []string{"Mon", "Tue", "Wed"}, "recommended": nil, "multi_select": true}
	c := h.chat("Plan the week", "supervised", "ask-multi", lines(ask("req-m", 600_000, multi), reply("Ok {{last_answers}}", 0)))
	h.waiting(c.ID, "req-m")
	if code, body := h.post("/chats/"+c.ID+"/answer", `{"requestId":"req-m","answers":{"q0":["Tue","Mon","Tue","Sunday"]}}`); code != 200 {
		t.Fatalf("answer: %d %s", code, body)
	}
	c = h.wait(c.ID, "replied", statusIs("idle"))
	if lastMessage(c).Content != `Ok {"q0":["Tue","Mon","Sunday"]}` {
		t.Fatalf("reply %q", lastMessage(c).Content)
	}
}

// Stop while the card waits: the run stops, the card closes "stopped" in
// the thread before the notice, the worker is told (and closes its wait
// cancelled, which changes nothing more), and a late answer is stale.
func TestIntegrationAgentEngineClarifyStopDuringTheWait(t *testing.T) {
	h := newEngineHarness(t)
	c := h.chat("Book my haircut", "auto", "ask-stop", lines(ask("req-s", 600_000), reply("never", 0)))
	c = h.waiting(c.ID, "req-s")
	run := c.AgentRunID
	if code, body := h.post("/chats/"+c.ID+"/stop", ""); code != 200 {
		t.Fatalf("stop: %d %s", code, body)
	}
	if stops := h.kit.WaitReceived("run.stop", 1, 10*time.Second); stops[0].Run != run {
		t.Fatalf("run.stop for %s, want %s", stops[0].Run, run)
	}
	time.Sleep(500 * time.Millisecond) // the worker's clarify.closed and run.done reach the follower
	c = h.wait(c.ID, "stopped", statusIs("stopped"))
	asked := questionMessages(c)
	if c.Question.pending() || len(asked) != 1 || asked[0].Question.Outcome != outcomeStopped || lastMessage(c).Content != tr("", txtStopped) {
		t.Fatalf("after Stop: card %+v, questions %+v, last %q", c.Question, asked, lastMessage(c).Content)
	}
	if code, _ := h.post("/chats/"+c.ID+"/answer", `{"requestId":"req-s","answers":{"q0":"Monday"}}`); code != 409 {
		t.Fatalf("an answer after Stop: %d, want 409", code)
	}
	if len(h.clarifyAnswers()) != 0 {
		t.Fatal("an answer reached a stopped run")
	}
	h.noCard(c.ID) // stopped
}

// Delete while the card waits: the run is stopped, and an answer finds no
// chat.
func TestIntegrationAgentEngineClarifyDeleteDuringTheWait(t *testing.T) {
	h := newEngineHarness(t)
	c := h.chat("Book my haircut", "supervised", "ask-delete", lines(ask("req-d", 600_000), reply("never", 0)))
	c = h.waiting(c.ID, "req-d")
	if code, body := serve(t, h.s, "DELETE", "/chats/"+c.ID, ""); code != 204 {
		t.Fatalf("delete: %d %s", code, body)
	}
	if stops := h.kit.WaitReceived("run.stop", 1, 10*time.Second); stops[0].Run != c.AgentRunID {
		t.Fatalf("run.stop for %s, want %s", stops[0].Run, c.AgentRunID)
	}
	if code, _ := h.post("/chats/"+c.ID+"/answer", `{"requestId":"req-d","answers":{"q0":"Monday"}}`); code != 404 {
		t.Fatalf("an answer after Delete: %d, want 404", code)
	}
	time.Sleep(300 * time.Millisecond)
	if len(h.clarifyAnswers()) != 0 {
		t.Fatal("an answer reached a deleted chat's run")
	}
}

// The worker dies while the card waits: the run fails with Try again and
// the card closes; Retry runs the request again.
func TestIntegrationAgentEngineClarifyWorkerExitDuringTheWait(t *testing.T) {
	h := newEngineHarness(t)
	c := h.chat("Book my haircut", "supervised", "ask-exit", lines(ask("req-x", 600_000), reply("never", 0)))
	c = h.waiting(c.ID, "req-x")
	w, ok := h.e.sup.Worker("user-a")
	if !ok {
		t.Fatal("no worker")
	}
	proc, err := os.FindProcess(w.PID())
	if err != nil {
		t.Fatal(err)
	}
	if err := proc.Kill(); err != nil {
		t.Fatal(err)
	}
	c = h.wait(c.ID, "failed", statusIs("failed"))
	asked := questionMessages(c)
	if c.Error != tr("", txtAgentLost) || c.ErrorAction != ActionRetry || c.Question.pending() || c.AgentRunID != "" ||
		len(asked) != 1 || asked[0].Question.Outcome != outcomeStopped {
		t.Fatalf("after the exit: %q %q card %+v questions %+v", c.Error, c.ErrorAction, c.Question, asked)
	}
	if code, _ := h.post("/chats/"+c.ID+"/answer", `{"requestId":"req-x","answers":{"q0":"Monday"}}`); code != 409 {
		t.Fatalf("an answer after the exit: %d, want 409", code)
	}
	h.noCard(c.ID) // failed
	if code, body := h.post("/chats/"+c.ID+"/retry", "{}"); code != 200 {
		t.Fatalf("retry: %d %s", code, body)
	}
	h.kit.WaitReceived("run.start", 2, 20*time.Second)
}

// The lease is lost while the card waits (the run is followed by another
// API process, which is gone): a lane re-claims the expired row, Lost
// fails it with Try again and clears the card, and the worker is told to
// stop.
func TestIntegrationAgentEngineClarifyLeaseLossDuringTheWait(t *testing.T) {
	h := newEngineHarness(t)
	h.e.opts.RenewEvery = time.Hour // this follower never renews
	c := h.chat("Book my haircut", "supervised", "ask-lease", lines(ask("req-l", 600_000), reply("never", 0)))
	c = h.waiting(c.ID, "req-l")
	if err := h.db.Exec("UPDATE agent_conversations SET agent_instance = 'other:1', lease_until = now() - interval '1 minute' WHERE id = ?", c.ID).Error; err != nil {
		t.Fatal(err)
	}
	c = h.wait(c.ID, "failed", statusIs("failed"))
	asked := questionMessages(c)
	if c.Error != tr("", txtAgentLost) || c.ErrorAction != ActionRetry || c.Question.pending() || len(asked) != 1 || asked[0].Question.Outcome != outcomeStopped {
		t.Fatalf("after the lost lease: %q %q card %+v questions %+v", c.Error, c.ErrorAction, c.Question, asked)
	}
	h.kit.WaitReceived("run.stop", 1, 10*time.Second)
	if code, _ := h.post("/chats/"+c.ID+"/answer", `{"requestId":"req-l","answers":{"q0":"Monday"}}`); code != 409 {
		t.Fatalf("an answer after the lost lease: %d, want 409", code)
	}
}

// The follower keeps renewing the lease while the card waits, so no lane
// takes the run from it.
func TestIntegrationAgentEngineClarifyWaitKeepsTheLease(t *testing.T) {
	h := newEngineHarness(t)
	h.e.opts.RenewEvery = 100 * time.Millisecond
	c := h.chat("Book my haircut", "supervised", "ask-renew", lines(ask("req-r", 600_000), reply("Done.", 0)))
	c = h.waiting(c.ID, "req-r")
	// Shorten the lease as if time passed: only the follower's renewal
	// brings it back.
	if err := h.db.Exec("UPDATE agent_conversations SET lease_until = now() + interval '2 seconds' WHERE id = ?", c.ID).Error; err != nil {
		t.Fatal(err)
	}
	h.wait(c.ID, "renewed", func(c Conversation) bool { return c.LeaseUntil != nil && time.Until(*c.LeaseUntil) > 2*time.Minute })
	time.Sleep(2500 * time.Millisecond)
	c = h.waiting(c.ID, "req-r")
	if n := len(h.kit.ReceivedOf("run.stop")); n != 0 {
		t.Fatalf("%d run.stops while the card waited", n)
	}
	if code, body := h.post("/chats/"+c.ID+"/answer", `{"requestId":"req-r","answers":{"q0":"Monday"}}`); code != 200 {
		t.Fatalf("answer: %d %s", code, body)
	}
	h.wait(c.ID, "replied", statusIs("idle"))
}

// A card nobody answers times out in the worker: the card closes "timed
// out" in the thread and the same run goes on to its reply.
func TestIntegrationAgentEngineClarifyTimeoutLeavesTheRunGoing(t *testing.T) {
	h := newEngineHarness(t)
	c := h.chat("Book my haircut", "supervised", "ask-timeout", lines(ask("req-t", 1500), reply("I went with Monday.", 0)))
	h.waiting(c.ID, "req-t")
	c = h.wait(c.ID, "replied", statusIs("idle"))
	asked := questionMessages(c)
	if len(asked) != 1 || asked[0].Question.Outcome != outcomeTimedOut || !strings.Contains(asked[0].Content, "(not answered in time)") ||
		lastMessage(c).Content != "I went with Monday." || len(h.kit.ReceivedOf("run.start")) != 1 {
		t.Fatalf("after the timeout: %+v, reply %q", asked, lastMessage(c).Content)
	}
}

// A message typed while the card waits answers every question (send and
// steer); a repeated send of it is not answered twice.
func TestIntegrationAgentEngineClarifyTypedMessageAnswers(t *testing.T) {
	h := newEngineHarness(t)
	c := h.chat("Book my haircut", "supervised", "ask-typed", lines(ask("req-y", 600_000), reply("Ok {{last_answers}}", 0)))
	before := len(h.waiting(c.ID, "req-y").Messages)
	send := `{"content":"Tuesday after lunch","requestId":"typed-1"}`
	code, body := h.post("/chats/"+c.ID+"/messages", send)
	if code != 200 {
		t.Fatalf("send: %d %s", code, body)
	}
	if code, body := h.post("/chats/"+c.ID+"/messages", send); code != 200 {
		t.Fatalf("the same send again: %d %s", code, body)
	}
	c = h.wait(c.ID, "replied", statusIs("idle"))
	got := h.clarifyAnswers()
	if len(got) != 1 || got[0].Answers["q0"] != "Tuesday after lunch" || got[0].Answers["q1"] != "Tuesday after lunch" || got[0].Outcome != outcomeSubmitted {
		t.Fatalf("clarify.answer %+v", got)
	}
	asked := questionMessages(c)
	if len(asked) != 1 || asked[0].RequestID != "typed-1" || len(c.Messages) != before+2 {
		t.Fatalf("messages %+v (%d before)", c.Messages, before)
	}
	if lastMessage(c).Content != `Ok {"q0":"Tuesday after lunch","q1":"Tuesday after lunch"}` {
		t.Fatalf("reply %q", lastMessage(c).Content)
	}

	// steer while a card waits answers it too.
	c = h.chat("Book my haircut", "supervised", "ask-steer", lines(ask("req-z", 600_000), reply("Ok {{last_answers}}", 0)))
	h.waiting(c.ID, "req-z")
	if code, body := h.post("/chats/"+c.ID+"/steer", `{"text":"Monday"}`); code != 200 {
		t.Fatalf("steer: %d %s", code, body)
	}
	c = h.wait(c.ID, "replied", statusIs("idle"))
	if lastMessage(c).Content != `Ok {"q0":"Monday","q1":"Monday"}` || len(h.kit.ReceivedOf("run.steer")) != 0 {
		t.Fatalf("steer reply %q, %d run.steers", lastMessage(c).Content, len(h.kit.ReceivedOf("run.steer")))
	}
}

// The worker no longer waits when the answer arrives (the card closed in
// the worker first): the answer is kept as undelivered and the person
// gets 409.
func TestIntegrationAgentEngineClarifyUndeliveredAnswer(t *testing.T) {
	h := newEngineHarness(t)
	// The fake closes its wait without telling Go (no clarify.closed) and
	// hangs, so Go still shows the card the worker no longer waits on.
	c := h.chat("Book my haircut", "supervised", "ask-gone", lines(
		obj{"type": "event", "kind": "clarify.request", "payload": obj{"request_id": "req-g", "questions": dayQuestions, "timeout_s": 600}},
		obj{"fake": "hang"},
	))
	h.waiting(c.ID, "req-g")
	if code, _ := h.post("/chats/"+c.ID+"/answer", `{"requestId":"req-g","answers":{"q0":"Monday"}}`); code != 409 {
		t.Fatalf("an undelivered answer: %d, want 409", code)
	}
	c = h.wait(c.ID, "kept the answer", func(c Conversation) bool { return len(questionMessages(c)) == 1 })
	if asked := questionMessages(c); asked[0].Question.Outcome != outcomeUndelivered || c.Question.pending() || c.Status != "running" {
		t.Fatalf("after an undelivered answer: %+v card %+v status %s", asked, c.Question, c.Status)
	}
	h.post("/chats/"+c.ID+"/stop", "")
}

// A sub-task shows as an activity line; what it read outside taints the
// chat (via "subagent"), so the run's direct proposal is held in Auto.
func TestIntegrationAgentEngineChildTaintHoldsADirectProposal(t *testing.T) {
	h := newEngineHarness(t)
	h.e.opts.ActivityEvery = 50 * time.Millisecond
	page := obj{"kind": "web", "tool": "web_extract", "host": "news.example"}
	c := h.chat("Read the page, then add Buy milk", "auto", "child", lines(
		obj{"fake": "subagent", "goal": "Read the news page", "child": "child-1", "subagent_id": "sa-1", "taint": []obj{page}, "ms": 400},
		pause(400),
		toolCallLine("call_p", "propose_changes", buyMilk(true), 1),
		reply("I drafted the change.", 0),
	))
	h.wait(c.ID, "showed the sub-task", func(c Conversation) bool {
		for _, l := range c.Activity.Lines {
			if l.Kind == "subagent" && l.Label == "Sub-task: Read the news page" && l.State == "done" {
				return true
			}
		}
		return false
	})
	c = h.wait(c.ID, "held the proposal", ended)
	want := TaintSource{Kind: "web", Tool: "web_extract", Host: "news.example", Via: "subagent", Child: "child-1"}
	if c.Status != "approval" || items(h.db) != 0 || !slices.Contains(c.TaintedSources, want) {
		t.Fatalf("status %s, %d items, tainted_sources %+v", c.Status, items(h.db), c.TaintedSources)
	}
	if holdReason(&c, c.Plan, nil) != heldTainted {
		t.Fatalf("held for %q", holdReason(&c, c.Plan, nil))
	}
	h.noCard(c.ID) // approval
}

// A sub-task's propose_changes is refused in Go too (the worker's gate
// blocks it first): children read, never propose.
func TestIntegrationAgentEngineChildCannotPropose(t *testing.T) {
	h := newEngineHarness(t)
	call := toolCallLine("call_c", "propose_changes", buyMilk(true), 1)
	call["subagent"] = "child-1"
	c := h.chat("Add Buy milk", "auto", "child-propose", lines(call, reply("Nothing to add.", 0)))
	c = h.wait(c.ID, "replied", ended)
	results := h.toolResults()
	if c.Status != "idle" || len(c.Plan) != 0 || items(h.db) != 0 || len(results) != 1 || !strings.Contains(string(results[0].Result), childProposal) {
		t.Fatalf("status %s plan %+v results %+v", c.Status, c.Plan, results)
	}
}

// With the no-persist switch off (the default), Sensitive and photo chats
// run classic whatever their engine choice, and Available says why.
func TestIntegrationAgentEngineSensitiveAndPhotoChatsStayClassic(t *testing.T) {
	h := newEngineHarness(t)
	photoMessage := func(c *Conversation) { c.Messages[0].ImageIDs = []string{"img_1"} }
	receipt := func(c *Conversation) { c.ImageReview = &ImageReview{Status: "confirmed"} }
	cases := map[string]func(*Conversation){
		"sensitive":    func(c *Conversation) { c.Sensitive = true },
		"photo phase":  func(c *Conversation) { c.Phase = "extract" },
		"photo in it":  photoMessage,
		"receipt chat": receipt,
	}
	reasons := map[string]string{"sensitive": "Sensitive chats use the classic engine", "photo phase": "Photos and receipts use the classic engine",
		"photo in it": "Photos and receipts use the classic engine", "receipt chat": "Photos and receipts use the classic engine"}
	for _, flag := range []bool{false, true} {
		h.s.SetSensitiveNoPersist(flag)
		for name, edit := range cases {
			if flag && name == "sensitive" {
				continue // the switch is for Sensitive chats only
			}
			c := h.chatWith("Add Buy milk", "supervised", "classic-"+name, lines(reply("agent", 0)), edit)
			c = h.wait(c.ID, "claimed", func(c Conversation) bool { return c.RunEngine != "" })
			if c.RunEngine != engineClassic {
				t.Errorf("%s (switch %v): run engine %q", name, flag, c.RunEngine)
			}
			if err := h.e.Available(context.Background(), "user-a", &c); err == nil || err.Error() != reasons[name] {
				t.Errorf("%s (switch %v): Available %v", name, flag, err)
			}
			h.wait(c.ID, "ended", ended)
		}
	}
	if n := len(h.kit.ReceivedOf("run.start")); n != 0 {
		t.Fatalf("%d run.starts for classic chats", n)
	}
}

// With the test-only switch on, a Sensitive plan turn runs on the agent
// engine as a no-persist run: flags.no_persist, toolsets timely and todo,
// the whole conversation as history every turn, and the model's Sensitive
// grant.
func TestIntegrationAgentEngineSensitiveNoPersistRun(t *testing.T) {
	h := newEngineHarness(t)
	var mu sync.Mutex
	var asked []RunModelOptions
	h.e.opts.Model = func(ctx context.Context, uid, provider, model string, opts RunModelOptions) (any, error) {
		mu.Lock()
		asked = append(asked, opts)
		mu.Unlock()
		return testModel(ctx, uid, provider, model, opts)
	}
	models := func() []RunModelOptions { mu.Lock(); defer mu.Unlock(); return slices.Clone(asked) }
	h.s.SetSensitiveNoPersist(true)
	c := h.chatWith("first", "supervised", "np", lines(reply("One.", 0)), func(c *Conversation) { c.Sensitive, c.WebSearch = true, true })
	if err := h.e.Available(context.Background(), "user-a", &c); err != nil {
		t.Fatalf("Available with the switch on: %v", err)
	}
	c = h.wait(c.ID, "replied", statusIs("idle"))
	if c.RunEngine != engineAgent {
		t.Fatalf("run engine %q", c.RunEngine)
	}
	if code, body := h.post("/chats/"+c.ID+"/messages", `{"content":"second"}`); code != 200 {
		t.Fatalf("send: %d %s", code, body)
	}
	starts := h.kit.WaitReceived("run.start", 2, 20*time.Second)
	h.wait(c.ID, "replied again", func(c Conversation) bool { return c.Status == "idle" && len(c.Messages) == 4 })
	var second struct {
		Toolsets []string            `json:"toolsets"`
		History  []map[string]string `json:"history"`
		Reseed   bool                `json:"reseed"`
		System   string              `json:"system_text"`
		Flags    struct {
			NoPersist bool `json:"no_persist"`
			Sensitive bool `json:"sensitive"`
			Web       bool `json:"web"`
			Learning  bool `json:"learning_writes"`
		} `json:"flags"`
	}
	if err := starts[1].Decode(&second); err != nil {
		t.Fatal(err)
	}
	if !second.Flags.NoPersist || !second.Flags.Sensitive || second.Flags.Web || second.Flags.Learning || !slices.Equal(second.Toolsets, []string{"timely", "todo"}) || second.Reseed || strings.Contains(second.System, askHint) {
		t.Fatalf("second run.start %+v", second)
	}
	if len(second.History) != 2 || second.History[0]["content"] != "first" || second.History[1]["content"] != "One." {
		t.Fatalf("history %+v: a no-persist run sends the whole conversation every turn", second.History)
	}
	if got := models(); len(got) < 3 || slices.ContainsFunc(got, func(o RunModelOptions) bool { return !o.Sensitive }) {
		t.Fatalf("model options %+v, want Sensitive every time", got)
	}
	// An ordinary chat beside it neither sends no_persist nor asks for the
	// Sensitive grant.
	plain := h.chat("hello", "supervised", "plain", lines(reply("Hi.", 0)))
	h.wait(plain.ID, "replied", statusIs("idle"))
	got := models()
	if s := h.runStart(plain.ID); slices.Equal(s.Toolsets, []string{"timely", "todo"}) || got[len(got)-1].Sensitive {
		t.Fatalf("plain chat run.start %+v, model %+v", s, got[len(got)-1])
	}
}
