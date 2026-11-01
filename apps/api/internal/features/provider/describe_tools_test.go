package provider

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"timely-api/internal/features/agent"
	"timely-api/internal/features/chat"
)

// scriptedDescribe answers each Describe call with the next reply and keeps
// what it was sent.
type scriptedDescribe struct {
	replies []chat.WireMessage
	sent    [][]chat.WireMessage
	tools   [][]any
}

func (s *scriptedDescribe) Complete(_ context.Context, messages []chat.WireMessage, tools []any, _ bool) (chat.WireMessage, error) {
	s.sent = append(s.sent, append([]chat.WireMessage(nil), messages...))
	s.tools = append(s.tools, tools)
	if len(s.sent) > len(s.replies) {
		return chat.WireMessage{}, errors.New("no more replies")
	}
	return s.replies[len(s.sent)-1], nil
}

func toolCall(id, name string, args any) chat.WireMessage {
	call := chat.ToolCall{ID: id, Type: "function"}
	call.Function.Name = name
	raw, _ := json.Marshal(args)
	call.Function.Arguments = string(raw)
	return chat.WireMessage{Role: "assistant", ToolCalls: []chat.ToolCall{call}}
}

func offeredNames(specs []any) []string {
	var names []string
	for _, spec := range specs {
		names = append(names, spec.(map[string]any)["function"].(map[string]any)["name"].(string))
	}
	return names
}

func testDescribeTools(loaded *int) *describeTools {
	catalog := agent.Catalog{
		"list_projects": {Description: "List projects.", Call: func(context.Context, string, json.RawMessage) (any, error) {
			return []map[string]string{{"id": "p1", "title": "Client work"}}, nil
		}},
		"create_task": {Description: "Create a task.", Call: func(context.Context, string, json.RawMessage) (any, error) {
			return nil, errors.New("a write ran")
		}},
	}
	load := func(context.Context, string) (any, error) {
		*loaded++
		var data any
		err := json.Unmarshal(boardCheckData, &data)
		return data, err
	}
	return newDescribeTools("u1", catalog, load, "Asia/Colombo")
}

const (
	wrongProject = "root = Panel(\"Late\", [list])\nlate = @Data({source: \"tasks\", project: \"Clients work\", overdue: true})\nlist = List(@Each(late.rows, \"t\", TaskRow(t.id, t.title)), \"Nothing late\")"
	rightProject = "root = Panel(\"Late\", [list])\nlate = @Data({source: \"tasks\", project: \"Client work\", overdue: true})\nlist = List(@Each(late.rows, \"t\", TaskRow(t.id, t.title)), \"Nothing late\")"
)

func TestDescribeReadsChecksAndFixes(t *testing.T) {
	loaded := 0
	tools := testDescribeTools(&loaded)
	if names := strings.Join(offeredNames(tools.specs), ","); names != "list_projects,check_block" {
		t.Fatalf("offered %s: read tools and check_block only, never a write", names)
	}
	model := &scriptedDescribe{replies: []chat.WireMessage{
		toolCall("c1", "list_projects", map[string]any{}),
		toolCall("c2", "check_block", map[string]any{"program": wrongProject}),
		toolCall("c3", "create_task", map[string]any{"name": "x"}),
		// Answers with the name check_block flagged: Timely draws it and sends it back once.
		{Role: "assistant", Content: wrongProject},
		{Role: "assistant", Content: "```openui-lang\n" + rightProject + "\n```"},
	}}
	messages := []chat.WireMessage{{Role: "system", Content: boardPrompt + describeToolsNote}, {Role: "user", Content: "Words: late client work"}}
	program, err := describe(context.Background(), model, messages, tools)
	if err != nil {
		t.Fatal(err)
	}
	if program != rightProject {
		t.Fatalf("program = %q", program)
	}
	if len(model.sent) != 5 {
		t.Fatalf("calls = %d", len(model.sent))
	}
	result := func(call int) string { return model.sent[call][len(model.sent[call])-1].Content }
	if got := result(1); !strings.Contains(got, `"title":"Client work"`) {
		t.Errorf("the read tool's result reaches the model: %s", got)
	}
	if got := result(2); !strings.Contains(got, "No project is called “Clients work”. The closest is “Client work”.") || !strings.Contains(got, `"shows"`) {
		t.Errorf("check_block returns the problems and what the card shows: %s", got)
	}
	if got := result(3); !strings.Contains(got, "unknown tool") {
		t.Errorf("a write tool is refused: %s", got)
	}
	if got := result(4); !strings.Contains(got, "found problems") || !strings.Contains(got, "Clients work") {
		t.Errorf("an answer with problems goes back once: %s", got)
	}
	if loaded != 1 {
		t.Errorf("the data loads once per Describe, loaded %d times", loaded)
	}
}

func TestDescribeTakesTheSecondAnswerAsItIs(t *testing.T) {
	loaded := 0
	model := &scriptedDescribe{replies: []chat.WireMessage{
		{Role: "assistant", Content: wrongProject},
		{Role: "assistant", Content: wrongProject},
	}}
	program, err := describe(context.Background(), model, []chat.WireMessage{{Role: "user", Content: "Words: late"}}, testDescribeTools(&loaded))
	if err != nil || program != wrongProject {
		t.Fatalf("program %q, err %v: the person gets the card once it went back once", program, err)
	}
}

func TestDescribeWithoutTools(t *testing.T) {
	model := &scriptedDescribe{replies: []chat.WireMessage{{Role: "assistant", Content: "Here it is.\n" + rightProject}}}
	program, err := describe(context.Background(), model, []chat.WireMessage{{Role: "user", Content: "Words: late"}}, nil)
	if err != nil || program != rightProject {
		t.Fatalf("program %q, err %v", program, err)
	}
	if len(model.sent) != 1 || model.tools[0] != nil {
		t.Errorf("one call with no tools, as before: %d calls, tools %v", len(model.sent), model.tools)
	}

	model = &scriptedDescribe{replies: []chat.WireMessage{{Role: "assistant", Content: "I can't."}, {Role: "assistant", Content: "Still no."}}}
	if _, err := describe(context.Background(), model, nil, nil); !errors.Is(err, errNotACard) {
		t.Errorf("err = %v; an answer without a program is asked again once, then refused", err)
	}
}

func TestDescribeStopsLookingUp(t *testing.T) {
	loaded := 0
	replies := make([]chat.WireMessage, dashboardCardTurns)
	for i := range replies {
		replies[i] = toolCall("c", "list_projects", map[string]any{"n": i})
	}
	model := &scriptedDescribe{replies: replies}
	if _, err := describe(context.Background(), model, []chat.WireMessage{{Role: "user", Content: "Words: late"}}, testDescribeTools(&loaded)); err == nil {
		t.Fatal("a model that only looks things up gets an error, not a hang")
	}
	if len(model.sent) != dashboardCardTurns {
		t.Fatalf("calls = %d", len(model.sent))
	}
	last := model.sent[len(model.sent)-1]
	if got := last[len(last)-1].Content; !strings.Contains(got, "answer now") {
		t.Errorf("the last call asks for the answer: %q", got)
	}
}

// A model that keeps making the same call (live: list_projects ten times,
// 37 KB growing to 268 KB per request) gets a short reminder instead of the
// result again, and its next turn must answer.
func TestDescribeStopsWhenACallRepeats(t *testing.T) {
	loaded := 0
	replies := make([]chat.WireMessage, dashboardCardTurns)
	for i := range replies {
		replies[i] = toolCall("c", "list_projects", map[string]any{})
	}
	model := &scriptedDescribe{replies: replies}
	if _, err := describe(context.Background(), model, []chat.WireMessage{{Role: "user", Content: "Words: late"}}, testDescribeTools(&loaded)); err == nil {
		t.Fatal("a model that never answers gets an error")
	}
	if len(model.sent) != 3 {
		t.Fatalf("calls = %d: the look-up, its repeat, then the answer turn", len(model.sent))
	}
	repeat := model.sent[2][len(model.sent[2])-2].Content
	if !strings.Contains(repeat, "already made this call") || strings.Contains(repeat, "Client work") {
		t.Errorf("the repeat gets a reminder, not the result again: %q", repeat)
	}
	if got := model.sent[2][len(model.sent[2])-1].Content; !strings.Contains(got, "answer now") {
		t.Errorf("the turn after a repeat asks for the answer: %q", got)
	}
}

// Stopping the look-ups leaves turns: the answer is still drawn, and one
// with problems goes back once, as on any turn but the final one.
func TestDescribeChecksTheAnswerAfterLookUpsStop(t *testing.T) {
	loaded := 0
	model := &scriptedDescribe{replies: []chat.WireMessage{
		toolCall("c1", "list_projects", map[string]any{}),
		toolCall("c2", "list_projects", map[string]any{}),
		{Role: "assistant", Content: wrongProject},
		{Role: "assistant", Content: rightProject},
	}}
	program, err := describe(context.Background(), model, []chat.WireMessage{{Role: "user", Content: "Words: late"}}, testDescribeTools(&loaded))
	if err != nil || program != rightProject {
		t.Fatalf("program %q, err %v", program, err)
	}
	if len(model.sent) != 4 {
		t.Fatalf("calls = %d: the look-up, its repeat, the answer, the fix", len(model.sent))
	}
	if got := model.sent[3][len(model.sent[3])-1].Content; !strings.Contains(got, "found problems") || !strings.Contains(got, "Clients work") {
		t.Errorf("the answer with problems goes back once: %q", got)
	}
}

func TestDescribeBoundsLookUps(t *testing.T) {
	// More calls in one turn than one Describe may run.
	var calls []chat.ToolCall
	for i := 0; i < describeCallMax+2; i++ {
		calls = append(calls, toolCall("c", "list_projects", map[string]any{"n": i}).ToolCalls...)
	}
	loaded := 0
	tools := testDescribeTools(&loaded)
	model := &scriptedDescribe{replies: []chat.WireMessage{{Role: "assistant", ToolCalls: calls}, {Role: "assistant", Content: rightProject}}}
	program, err := describe(context.Background(), model, []chat.WireMessage{{Role: "user", Content: "Words: late"}}, tools)
	if err != nil || program != rightProject {
		t.Fatalf("program %q, err %v", program, err)
	}
	sent := model.sent[1]
	results := sent[len(sent)-1-len(calls) : len(sent)-1]
	for i, result := range results {
		refused := strings.Contains(result.Content, "No more look-ups")
		if refused != (i >= describeCallMax) {
			t.Errorf("result %d refused=%v: %s", i, refused, result.Content)
		}
	}
	if !strings.Contains(sent[len(sent)-1].Content, "answer now") {
		t.Errorf("the turn after the last allowed call asks for the answer: %q", sent[len(sent)-1].Content)
	}

	// Results that together go past the budget: the one that would is refused.
	big := strings.Repeat("x", describeResultMax-1000)
	catalog := agent.Catalog{"list_tasks": {Description: "List tasks.", Call: func(context.Context, string, json.RawMessage) (any, error) {
		return map[string]string{"tasks": big}, nil
	}}}
	tools = newDescribeTools("u1", catalog, nil, "")
	first := tools.call(context.Background(), toolCall("c1", "list_tasks", map[string]any{"page": 1}).ToolCalls[0])
	second := tools.call(context.Background(), toolCall("c2", "list_tasks", map[string]any{"page": 2}).ToolCalls[0])
	third := tools.call(context.Background(), toolCall("c3", "list_tasks", map[string]any{"page": 3}).ToolCalls[0])
	if !strings.Contains(first, big) || !strings.Contains(second, big) || strings.Contains(third, big) || !strings.Contains(third, "answer now") || !tools.stopped() {
		t.Fatalf("budget: %d, %d, %q", len(first), len(second), third)
	}
}

func TestDescribeOffersTheReadToolsACardNeeds(t *testing.T) {
	read := func(context.Context, string, json.RawMessage) (any, error) { return nil, nil }
	catalog := agent.Catalog{}
	for _, name := range []string{"list_tasks", "list_events", "get_sheet_values", "list_habits", "get_notification_settings", "auto_schedule_preview", "create_task"} {
		catalog[name] = agent.Tool{Description: name, Call: read}
	}
	tools := newDescribeTools("u1", catalog, nil, "")
	if got := strings.Join(offeredNames(tools.specs), ","); got != "get_sheet_values,list_events,list_tasks" {
		t.Fatalf("offered %s", got)
	}
}

// The board prompt with its tools is cached, and each turn's whole request
// is marked so the next turn reads it back.
func TestDescribeMarksWhatToCache(t *testing.T) {
	loaded := 0
	model := &scriptedDescribe{replies: []chat.WireMessage{
		toolCall("c1", "list_projects", map[string]any{}),
		{Role: "assistant", Content: rightProject},
	}}
	messages := dashboardCardMessages(dashboardCardRequest{Prompt: "late client work", Today: "2026-11-01"}, viewVocab{}, nil, nil)
	if _, err := describe(context.Background(), model, messages, testDescribeTools(&loaded)); err != nil {
		t.Fatal(err)
	}
	for turn, sent := range model.sent {
		for i, m := range sent {
			if want := i == 0 || i == len(sent)-1; m.Cache != want {
				t.Errorf("turn %d message %d (%s) Cache=%v", turn, i, m.Role, m.Cache)
			}
		}
	}
}

func TestDescribeAnswersWithTheLastCleanDraft(t *testing.T) {
	loaded := 0
	replies := []chat.WireMessage{
		toolCall("c1", "check_block", map[string]any{"program": rightProject}),
		toolCall("c2", "check_block", map[string]any{"program": wrongProject}),
	}
	for len(replies) < dashboardCardTurns {
		replies = append(replies, toolCall("c", "list_projects", map[string]any{}))
	}
	model := &scriptedDescribe{replies: replies}
	program, err := describe(context.Background(), model, []chat.WireMessage{{Role: "user", Content: "Words: late"}}, testDescribeTools(&loaded))
	if err != nil || program != rightProject {
		t.Fatalf("program %q, err %v: out of turns, the last draft that drew without problems is the answer", program, err)
	}

	model = &scriptedDescribe{replies: []chat.WireMessage{
		toolCall("c1", "check_block", map[string]any{"program": wrongProject}),
		{Role: "assistant", Content: "Done, the card is ready."},
		{Role: "assistant", Content: "It shows your late tasks."},
	}}
	program, err = describe(context.Background(), model, []chat.WireMessage{{Role: "user", Content: "Words: late"}}, testDescribeTools(&loaded))
	if err != nil || program != wrongProject {
		t.Fatalf("program %q, err %v: a model that never writes the program out gets its last draft", program, err)
	}
}
