package chat

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// Question cards (phase 4) without a database: what a clarify.request
// becomes on the row, the answers the endpoint takes, the message a closed
// card leaves, and the fence on an answer.

func clarifyEvent(t *testing.T, payload string) workerEvent {
	t.Helper()
	var ev workerEvent
	if err := json.Unmarshal([]byte(`{"kind":"clarify.request","payload":`+payload+`}`), &ev); err != nil {
		t.Fatal(err)
	}
	return ev
}

func TestAskedQuestionCleansTheCard(t *testing.T) {
	now := time.Date(2026, 11, 13, 9, 0, 0, 0, time.UTC)
	long := strings.Repeat("é", maxQuestionRunes+50)
	ev := clarifyEvent(t, `{"request_id":"req-1","timeout_s":30,"questions":[
		{"qid":"q0","question":"Which day?\u0000","choices":["Mon","Tue","Wed","Thu","Fri"],"recommended":0,"multi_select":false},
		{"qid":"","question":"`+long+`","choices":null,"recommended":3,"multi_select":true},
		{"qid":"q2","question":"c"},{"qid":"q3","question":"d"},{"qid":"q4","question":"e"},{"qid":"q5","question":"f"}]}`)
	q, ok := askedQuestion("run-1", ev, now, time.Hour)
	if !ok || q.RequestID != "req-1" || q.Run != "run-1" || len(q.Questions) != maxQuestions {
		t.Fatalf("card %+v %v", q, ok)
	}
	first, second := q.Questions[0], q.Questions[1]
	if first.Question != "Which day?" || len(first.Choices) != maxQuestionChoice || first.Recommended == nil || *first.Recommended != 0 {
		t.Fatalf("first question %+v", first)
	}
	if second.QID != "q1" || len([]rune(second.Question)) != maxQuestionRunes || second.Choices != nil || second.Recommended != nil || !second.MultiSelect {
		t.Fatalf("second question %+v", second)
	}
	if !q.AskedAt.Equal(now) || !q.ExpiresAt.Equal(now.Add(30*time.Second)) {
		t.Fatalf("asked %s expires %s", q.AskedAt, q.ExpiresAt)
	}
	// Without a timeout the engine's own applies; without a request or a
	// question there is no card.
	if q, _ := askedQuestion("run-1", clarifyEvent(t, `{"request_id":"r","questions":[{"question":"x"}]}`), now, time.Hour); !q.ExpiresAt.Equal(now.Add(time.Hour)) {
		t.Fatalf("default timeout: %s", q.ExpiresAt)
	}
	for _, payload := range []string{`{"questions":[{"question":"x"}]}`, `{"request_id":"r","questions":[]}`} {
		if _, ok := askedQuestion("run-1", clarifyEvent(t, payload), now, time.Hour); ok {
			t.Fatalf("a card from %s", payload)
		}
	}
}

func TestValidAnswers(t *testing.T) {
	q := ChatQuestion{RequestID: "req-1", Questions: []QuestionItem{
		{QID: "q0", Question: "Which day?", Choices: []string{"Mon", "Tue"}},
		{QID: "q1", Question: "Which rooms?", Choices: []string{"A", "B", "C"}, MultiSelect: true},
		{QID: "q2", Question: "Anything else?"},
	}}
	got, err := validAnswers(q, map[string]any{"q0": " Tue ", "q1": []any{"B", "A", "B", "the garden"}, "q2": ""})
	if err != nil {
		t.Fatal(err)
	}
	if string(raw(got)) != `{"q0":"Tue","q1":["B","A","the garden"],"q2":null}` {
		t.Fatalf("answers %s", raw(got))
	}
	// Typed text answers a single-select question too (its "Other" row).
	if got, err := validAnswers(q, map[string]any{"q0": "Friday instead", "q1": nil}); err != nil || got["q0"] != "Friday instead" || got["q1"] != nil {
		t.Fatalf("typed text and a skip: %v %v", got, err)
	}
	for name, answers := range map[string]map[string]any{
		"unknown qid":         {"q9": "Mon"},
		"list, single-select": {"q0": []any{"Mon"}},
		"list, open question": {"q2": []any{"x"}},
		"two typed items":     {"q1": []any{"A", "x", "y"}},
		"not text":            {"q1": []any{"A", 3}},
		"a number":            {"q0": 2},
		"an object":           {"q0": map[string]any{"choice": "Mon"}},
		"too long":            {"q2": strings.Repeat("x", maxAnswerRunes+1)},
	} {
		if _, err := validAnswers(q, answers); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if got, err := validAnswers(q, map[string]any{"q1": []any{" ", ""}}); err != nil || got["q1"] != nil {
		t.Fatalf("an empty list: %v %v", got, err)
	}
}

func TestCloseQuestionKeepsTheCardInTheThread(t *testing.T) {
	asked := time.Now().UTC()
	row := &Conversation{Messages: []Message{message("user", "Book it")}, Question: ChatQuestion{RequestID: "req-1", Run: "run-1",
		Questions: []QuestionItem{{QID: "q0", Question: "Which day?", Choices: []string{"Mon"}}, {QID: "q1", Question: "Rooms?", MultiSelect: true}}, AskedAt: &asked}}
	id := closeQuestion(row, map[string]any{"q0": "Mon", "q1": []string{"A", "B"}}, outcomeSubmitted)
	m := lastMessage(*row)
	if id == "" || m.ID != id || m.Kind != "question" || m.Role != "assistant" || m.AgentRun != "run-1" || m.Engine != engineAgent || row.Question.pending() {
		t.Fatalf("message %+v, card %+v", m, row.Question)
	}
	if m.Content != "Timely asked:\n- Which day?\n  Answer: Mon\n- Rooms?\n  Answer: A, B" || m.Question.Outcome != outcomeSubmitted || m.Question.RequestID != "req-1" {
		t.Fatalf("content %q question %+v", m.Content, m.Question)
	}
	if closeQuestion(row, nil, outcomeStopped) != "" || len(row.Messages) != 2 {
		t.Fatal("a second close added a message")
	}
	// A history seed hands it to the model as a system notice.
	row.Messages = append(row.Messages, message("assistant", "Booked."))
	seed := historySeed(row.Messages)
	if len(seed) != 3 || seed[1]["role"] != "user" || !strings.HasPrefix(seed[1]["content"], "System notice (not written by the user): Timely asked:") {
		t.Fatalf("seed %+v", seed)
	}
	for outcome, text := range map[string]string{outcomeTimedOut: "(not answered in time)", outcomeUndelivered: "(not answered in time)",
		outcomeStopped: "(stopped before an answer)", outcomeCancelled: "(skipped)"} {
		if got := questionText(row.Messages[1].Question.Questions[:1], nil, outcome); !strings.HasSuffix(got, text) {
			t.Errorf("%s: %q", outcome, got)
		}
	}
	// Outside a wait the apps read an empty card.
	if !strings.Contains(string(raw(Conversation{})), `"question":{}`) {
		t.Fatal(`an idle row's JSON lacks "question":{}`)
	}
}

// The fenced answer: only the run that asked, still running, still named
// on the row, for the request it asked.
func TestQuestionOpen(t *testing.T) {
	open := Conversation{Status: "running", AgentRunID: "run-1", Question: ChatQuestion{RequestID: "req-1", Run: "run-1"}}
	if !questionOpen(&open, "req-1") {
		t.Fatal("the waiting card is not open")
	}
	for name, edit := range map[string]func(*Conversation){
		"stopped":         func(c *Conversation) { c.Status = "stopped" },
		"failed":          func(c *Conversation) { c.Status = "failed" },
		"run cleared":     func(c *Conversation) { c.AgentRunID = "" },
		"another run":     func(c *Conversation) { c.AgentRunID = "run-2" },
		"card closed":     func(c *Conversation) { c.Question = ChatQuestion{} },
		"another request": func(c *Conversation) { c.Question.RequestID = "req-2" },
	} {
		c := open
		edit(&c)
		if questionOpen(&c, "req-1") {
			t.Errorf("%s: open", name)
		}
	}
	if empty := (Conversation{Status: "running", AgentRunID: "run-1", Question: ChatQuestion{Run: "run-1"}}); questionOpen(&empty, "") {
		t.Fatal("no card is open for an empty request")
	}
}

// A sub-task is an activity line from its start to its stop.
func TestLiveSubagentLines(t *testing.T) {
	l := newLiveRun("r")
	at := time.Now()
	event := func(payload string) bool {
		var ev workerEvent
		if err := json.Unmarshal([]byte(`{"kind":"subagent","payload":`+payload+`}`), &ev); err != nil {
			t.Fatal(err)
		}
		changed, delta := l.event(ev, at)
		if delta != nil {
			t.Fatal("a sub-task streamed text")
		}
		return changed
	}
	if !event(`{"phase":"start","subagent_id":"sa-1","child_session_id":"c1","goal":"  Read\nthe page  "}`) ||
		!event(`{"phase":"start","subagent_id":"sa-2","child_session_id":"c2","goal":""}`) {
		t.Fatal("a start changed nothing")
	}
	if event(`{"phase":"start","subagent_id":"sa-1","goal":"Read the page"}`) {
		t.Fatal("a repeated start changed the lines")
	}
	if !event(`{"phase":"stop","subagent_id":"sa-1","status":"completed"}`) || !event(`{"phase":"stop","subagent_id":"sa-2","status":"failed"}`) {
		t.Fatal("a stop changed nothing")
	}
	if event(`{"phase":"stop"}`) {
		t.Fatal("an event naming no sub-task changed the lines")
	}
	lines := l.activity().Lines
	if len(lines) != 2 || lines[0].Kind != "subagent" || lines[0].Label != "Sub-task: Read the page" || lines[0].State != "done" ||
		lines[1].Label != "Sub-task" || lines[1].State != "failed" {
		t.Fatalf("lines %+v", lines)
	}
}

// Photo chats and Sensitive chats run classic (Q-4.2); Sensitive ones
// follow the chat's choice only with the test-only no-persist switch.
func TestRunEngineKeepsPhotoAndSensitiveChatsOnClassic(t *testing.T) {
	agent := func(edit func(*Conversation)) *Conversation {
		c := &Conversation{Phase: "plan", Engine: engineAgent, Messages: []Message{message("user", "hi")}}
		if edit != nil {
			edit(c)
		}
		return c
	}
	for name, tc := range map[string]struct {
		c         *Conversation
		noPersist bool
		want      string
	}{
		"plain":                      {agent(nil), false, engineAgent},
		"sensitive":                  {agent(func(c *Conversation) { c.Sensitive = true }), false, engineClassic},
		"sensitive, switch on":       {agent(func(c *Conversation) { c.Sensitive = true }), true, engineAgent},
		"photo phase":                {agent(func(c *Conversation) { c.Phase = "receipt_plan" }), true, engineClassic},
		"photo message":              {agent(func(c *Conversation) { c.Messages[0].ImageIDs = []string{"img_1"} }), true, engineClassic},
		"receipt review":             {agent(func(c *Conversation) { c.ImageReview = &ImageReview{Status: "discarded"} }), true, engineClassic},
		"sensitive photo, switch on": {agent(func(c *Conversation) { c.Sensitive, c.ImageReview = true, &ImageReview{} }), true, engineClassic},
	} {
		if got := runEngine(nil, tc.c, tc.noPersist); got != tc.want {
			t.Errorf("%s: %s, want %s", name, got, tc.want)
		}
	}
}

// A message typed as the answer is held to the 2,000-character limit that
// POST /answer enforces.
func TestTypedAnswerIsHeldToTheAnswerLimit(t *testing.T) {
	card := ChatQuestion{RequestID: "r", Questions: []QuestionItem{{QID: "q0", Question: "Which?"}, {QID: "q1", Question: "More?"}}}
	got, err := textAnswers(strings.Repeat("é", maxAnswerRunes))(card)
	if err != nil || got["q0"] != strings.Repeat("é", maxAnswerRunes) || got["q1"] != got["q0"] {
		t.Fatalf("a full-length answer: %v %v", got, err)
	}
	if _, err := textAnswers(strings.Repeat("é", maxAnswerRunes+1))(card); err == nil || !strings.Contains(err.Error(), "2000 characters") {
		t.Fatalf("an over-long answer: %v", err)
	}
}
