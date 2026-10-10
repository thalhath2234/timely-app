package chat

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/agent"
	"timely-api/internal/features/decide"
	"timely-api/internal/features/search"

	"gorm.io/gorm"
)

var targetNow = time.Date(2026, 10, 10, 9, 0, 0, 0, time.UTC)

// dentistCatalog finds two dentist events (one past, one next week, the
// second listed twice as two chunks) and a task the kind filter drops.
func dentistCatalog(searched *[]string) agent.Catalog {
	events := map[string]map[string]any{
		"evt_old":  {"start": "2026-10-07T14:00:00Z", "allDay": false, "recurrence": nil},
		"evt_next": {"start": "2026-10-14T15:00:00Z", "allDay": false, "recurrence": nil},
	}
	return agent.Catalog{
		"semantic_search": {Call: func(_ context.Context, _ string, args json.RawMessage) (any, error) {
			if searched != nil {
				*searched = append(*searched, string(args))
			}
			return map[string]any{"hits": []search.Hit{
				{Kind: "event", ID: "evt_old", Title: "Dentist", Snippet: "Dr. Patel"},
				{Kind: "task", ID: "tsk_1", Title: "Call the dentist"},
				{Kind: "event", ID: "evt_next", Title: "Dentist", Snippet: "Dr. Patel"},
				{Kind: "event", ID: "evt_next", Title: "Dentist", Snippet: "second chunk"},
			}}, nil
		}},
		"get_event": {Call: func(_ context.Context, _ string, args json.RawMessage) (any, error) {
			var in struct {
				EventID string `json:"eventId"`
			}
			_ = json.Unmarshal(args, &in)
			return events[in.EventID], nil
		}},
	}
}

func dentistChat() *Conversation {
	return &Conversation{UserID: "user-a", Messages: []Message{message("user", "Move my dentist appointment next week to Thursday")}}
}

func targetIDs(t *testing.T, result any) ([]string, string) {
	t.Helper()
	var out struct {
		Candidates []Target `json:"candidates"`
		Pick       string   `json:"pick"`
	}
	if err := json.Unmarshal(raw(result), &out); err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	for _, c := range out.Candidates {
		ids = append(ids, c.ID)
	}
	return ids, out.Pick
}

func TestResolveTargetPutsJevsPickFirst(t *testing.T) {
	jev, bodies := jevBy(t, func(id, _ string) any {
		if id == "target" {
			return choice("Dentist (2)", 0.92)
		}
		return nil
	})
	s := New(nil, nil, nil)
	s.SetDecisions(jev)
	var searched []string
	result, pick, err := s.resolveTarget(context.Background(), dentistChat(), dentistCatalog(&searched), time.UTC, targetNow, raw(map[string]string{"kind": "event", "name": "dentist appointment"}))
	if err != nil {
		t.Fatal(err)
	}
	ids, picked := targetIDs(t, result)
	if picked != "evt_next" || strings.Join(ids, ",") != "evt_next,evt_old" {
		t.Fatalf("pick %q order %v", picked, ids)
	}
	if pick == nil || pick.pick != "evt_next" || len(pick.others) != 1 || pick.others[0] != "evt_old" {
		t.Fatalf("pick record %+v", pick)
	}
	if !strings.Contains(searched[0], `"kinds":["event"]`) {
		t.Fatalf("search must be limited to the kind: %s", searched[0])
	}
	body := (*bodies)[0]
	// Dates reach Jev in words; the request is the person's own message.
	for _, want := range []string{"Wed 14 Oct 2026 (in 4 days) at 15:00", "Wed 7 Oct 2026 (3 days ago) at 14:00", "Move my dentist appointment next week", `"target__2"`} {
		if !strings.Contains(body, want) {
			t.Errorf("missing %q in %s", want, body)
		}
	}
	if strings.Contains(body, "Call the dentist") {
		t.Error("a task was offered for an event")
	}
}

func TestResolveTargetWithoutAConfidentPickKeepsTheOrder(t *testing.T) {
	cases := map[string]struct {
		answer    any
		ctx       context.Context
		sensitive bool
		asks      bool
	}{
		"unsure":         {answer: choice("Dentist (2)", 0.5), ctx: context.Background(), asks: true},
		"none":           {answer: choice("none", 0.95), ctx: context.Background(), asks: true},
		"sensitive chat": {answer: choice("Dentist (2)", 0.95), ctx: context.Background(), sensitive: true},
		"sensitive ctx":  {answer: choice("Dentist (2)", 0.95), ctx: decide.WithSensitive(context.Background())},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			jev, bodies := jevBy(t, func(id, _ string) any { return tc.answer })
			s := New(nil, nil, nil)
			s.SetDecisions(jev)
			c := dentistChat()
			c.Sensitive = tc.sensitive
			result, pick, err := s.resolveTarget(tc.ctx, c, dentistCatalog(nil), time.UTC, targetNow, raw(map[string]string{"kind": "event", "name": "dentist"}))
			if err != nil {
				t.Fatal(err)
			}
			ids, picked := targetIDs(t, result)
			if picked != "" || pick != nil || strings.Join(ids, ",") != "evt_old,evt_next" {
				t.Fatalf("pick %q order %v", picked, ids)
			}
			if asked := len(*bodies) > 0; asked != tc.asks {
				t.Fatalf("asked Jev: %v", asked)
			}
		})
	}
	// Without Jev the shortlist still comes back.
	s := New(nil, nil, nil)
	result, _, err := s.resolveTarget(context.Background(), dentistChat(), dentistCatalog(nil), time.UTC, targetNow, raw(map[string]string{"kind": "event", "name": "dentist"}))
	if ids, _ := targetIDs(t, result); err != nil || len(ids) != 2 {
		t.Fatalf("shortlist %v %v", ids, err)
	}
	if _, _, err := s.resolveTarget(context.Background(), dentistChat(), dentistCatalog(nil), time.UTC, targetNow, raw(map[string]string{"kind": "label", "name": "x"})); err == nil {
		t.Fatal("an unknown kind must fail")
	}
}

func TestDescribeTaskInWords(t *testing.T) {
	catalog := agent.Catalog{"get_task": {Call: func(context.Context, string, json.RawMessage) (any, error) {
		return map[string]any{"task": map[string]any{"kind": "task", "deadline": "2026-10-11", "completedAt": "2026-10-09T10:00:00Z"}}, nil
	}}}
	if got := describe(context.Background(), "u", catalog, "task", "tsk_1", time.UTC, targetNow); got != "done, due Sun 11 Oct 2026 (tomorrow)" {
		t.Fatalf("got %q", got)
	}
}

type feedbackJev struct {
	got map[string]bool
}

func (f *feedbackJev) Ask(context.Context, string, decide.Request) (decide.Answers, error) {
	return decide.Answers{}, decide.ErrOff
}
func (f *feedbackJev) Feedback(_, logID string, accepted bool) error {
	f.got[logID] = accepted
	return nil
}

func TestTargetFeedbackFollowsTheProposal(t *testing.T) {
	f := &feedbackJev{got: map[string]bool{}}
	s := New(nil, nil, nil)
	s.SetDecisions(f)
	picks := []*targetPick{
		{logID: "dec_used", pick: "evt_next", others: []string{"evt_old"}},
		{logID: "dec_other", pick: "doc_a", others: []string{"doc_b"}},
		{logID: "dec_none", pick: "sht_a", others: []string{"sht_b"}},
	}
	steps := []Step{
		{Tool: "update_event", Arguments: raw(map[string]string{"eventId": "evt_next"})},
		{Tool: "update_doc", Arguments: raw(map[string]string{"docId": "doc_b"})},
	}
	s.targetFeedback("user-a", picks, steps)
	if len(f.got) != 2 || !f.got["dec_used"] || f.got["dec_other"] {
		t.Fatalf("feedback %v", f.got)
	}
}

// TestIntegrationResolveTargetInARun checks the tool is offered with its
// prompt line only when Jev is on, and that its answer reaches the model.
func TestIntegrationResolveTargetInARun(t *testing.T) {
	db := integrationDB(t)
	catalog := func(*gorm.DB) agent.Catalog {
		c := dentistCatalog(nil)
		c["get_context"] = agent.Tool{Call: func(context.Context, string, json.RawMessage) (any, error) {
			return map[string]string{"ok": "yes"}, nil
		}}
		return c
	}
	jev, _ := jevBy(t, func(id, _ string) any {
		if id == "target" {
			return choice("Dentist (2)", 0.95)
		}
		return nil
	})
	model := &toolsModel{scripted: scripted{responses: []WireMessage{
		call(targetTool, map[string]string{"kind": "event", "name": "dentist"}),
		{Role: "assistant", Content: "Which one?"},
	}}}
	s := New(db, catalog, model)
	s.SetDecisions(jev)
	c := planFixture(t, db)
	c.Messages = []Message{message("user", "Move my dentist appointment next week to Thursday")}
	db.Save(&c)
	if err := s.plan(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	if !has(model.tools[0], targetTool) || !strings.Contains(model.seen[0][0].Content, "call resolve_target") {
		t.Fatal("resolve_target must be offered with its prompt line")
	}
	answer := model.seen[1][len(model.seen[1])-1]
	if answer.Role != "tool" || !strings.Contains(answer.Content, `"pick":"evt_next"`) {
		t.Fatalf("tool answer %s", answer.Content)
	}

	// Off: not offered, no prompt line, and calling it by name fails.
	off := &toolsModel{scripted: scripted{responses: []WireMessage{
		call(targetTool, map[string]string{"kind": "event", "name": "dentist"}),
		{Role: "assistant", Content: "Which one?"},
	}}}
	s = New(db, catalog, off)
	c = planFixture(t, db)
	c.Messages = []Message{message("user", "Move my dentist appointment next week to Thursday")}
	db.Save(&c)
	if err := s.plan(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	if has(off.tools[0], targetTool) || strings.Contains(off.seen[0][0].Content, "resolve_target") {
		t.Fatal("resolve_target must not be offered without Jev")
	}
	if !strings.Contains(off.seen[1][len(off.seen[1])-1].Content, "Unknown tool") {
		t.Fatalf("calling it without Jev must fail: %s", off.seen[1][len(off.seen[1])-1].Content)
	}
}
