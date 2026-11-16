package chat

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"

	"timely-api/internal/features/agent"

	"gorm.io/gorm"
)

// recorder plays back responses and records each request the model gets.
type recorder struct {
	mu        sync.Mutex
	responses []WireMessage
	seen      [][]WireMessage
}

func (r *recorder) Complete(_ context.Context, messages []WireMessage, _ []any, _ bool) (WireMessage, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.seen = append(r.seen, append([]WireMessage{}, messages...))
	if len(r.responses) == 0 {
		return WireMessage{}, fmt.Errorf("script exhausted")
	}
	next := r.responses[0]
	r.responses = r.responses[1:]
	return next, nil
}

// calls is one assistant message with several tool calls, ids as given.
func calls(pairs ...any) WireMessage {
	m := WireMessage{Role: "assistant"}
	for i := 0; i+2 < len(pairs); i += 3 {
		var tc ToolCall
		tc.ID, tc.Type = pairs[i].(string), "function"
		tc.Function.Name, tc.Function.Arguments = pairs[i+1].(string), string(raw(pairs[i+2]))
		m.ToolCalls = append(m.ToolCalls, tc)
	}
	return m
}

// goldenCatalog has real tool names (their authority decides read or write)
// with fixed results; get_sheet_values answers past the 90,000-byte cap.
func goldenCatalog(*gorm.DB) agent.Catalog {
	fixed := func(v any) agent.Tool {
		return agent.Tool{Description: "fixed", Call: func(context.Context, string, json.RawMessage) (any, error) { return v, nil }}
	}
	return agent.Catalog{
		"get_context":      fixed(map[string]any{"workspaces": []map[string]string{{"id": "ws_1", "name": "Home"}}}),
		"list_docs":        fixed(map[string]any{"docs": []map[string]string{{"id": "doc_1", "title": "Notes", "updatedAt": "2026-11-01T09:00:00Z"}}}),
		"list_bots":        fixed(map[string]any{"outsideData": "Read from third-party pages.", "bots": []map[string]string{{"id": "bot_kettle", "name": "Kettle"}}}),
		"get_bot":          fixed(map[string]string{"id": "bot_kettle", "name": "Kettle"}),
		"get_sheet_values": fixed(map[string]string{"values": strings.Repeat("x", 95000)}),
		"ask_bot": {Description: "ask", Call: func(_ context.Context, _ string, args json.RawMessage) (any, error) {
			var in struct {
				Bot string `json:"bot"`
			}
			_ = json.Unmarshal(args, &in)
			return map[string]any{"outsideData": "Read from third-party pages.", "bot": map[string]string{"id": in.Bot, "name": in.Bot}, "fresh": "recent"}, nil
		}},
		"create_task": {Description: "Create a task", Call: func(context.Context, string, json.RawMessage) (any, error) {
			return map[string]any{"task": map[string]string{"id": "tsk_1", "name": "Buy milk"}}, nil
		}},
	}
}

func goldenRun(t *testing.T, s *Service, db *gorm.DB, first Message, responses []WireMessage) (*recorder, Conversation) {
	t.Helper()
	model := &recorder{responses: responses}
	s.provider = model
	c := planFixture(t, db)
	c.Messages = []Message{first}
	c.Timezone = "Europe/Berlin"
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	if err := playTurn(context.Background(), s, &c); err != nil {
		t.Fatal(err)
	}
	return model, c
}

// What a turn's tool calls get back: a read, an outside read, a write tool
// called directly, an unknown tool, an oversize result, propose_changes in
// a batch, ask_bot over maxAsks, an answer-only refusal, and a proposal.
func TestIntegrationTurnToolResults(t *testing.T) {
	db := integrationDB(t)
	s := New(db, goldenCatalog, nil)
	s.SetBotNames(func(context.Context, string) ([]BotName, error) { return tagNames, nil })
	propose := map[string]any{"summary": "Create Buy milk", "direct": true, "language": "en", "reply": "", "remaining": "",
		"steps": []any{map[string]any{"tool": "create_task", "summary": "Create Buy milk", "arguments": map[string]any{"name": "Buy milk"}}}}

	reads, _ := goldenRun(t, s, db, message("user", "Look around"), []WireMessage{
		calls("c_read", "list_docs", map[string]any{}),
		calls("c_outside", "list_bots", map[string]any{}),
		calls("c_write", "create_task", map[string]any{"name": "Buy milk"}),
		calls("c_unknown", "frobnicate", map[string]any{}),
		calls("c_big", "get_sheet_values", map[string]any{"sheetId": "sh_1"}),
		calls("c_b1", "list_docs", map[string]any{}, "c_b2", "propose_changes", propose),
		calls("c_a1", "ask_bot", map[string]string{"bot": "bot_kettle"}, "c_a2", "ask_bot", map[string]string{"bot": "bot_go"},
			"c_a3", "ask_bot", map[string]string{"bot": "bot_btc"}, "c_a4", "ask_bot", map[string]string{"bot": "bot_cafe"}),
		{Role: "assistant", Content: "Here is what I found."},
	})
	last := lastToolResults(reads.seen[len(reads.seen)-1])
	if len(last) != 11 || !strings.Contains(last[2], "never called directly") || !strings.Contains(last[3], `Unknown tool \"frobnicate\"`) ||
		!strings.Contains(last[4], "Result is too large") || !strings.Contains(last[6], "Call propose_changes alone") || !strings.Contains(last[10], "as many bots as one request may ask (3)") {
		t.Fatalf("tool results %v", last)
	}

	tagged := message("user", "@Kettle, make a task")
	tagged.BotTags = []string{"bot_kettle"}
	answer, tc := goldenRun(t, s, db, tagged, []WireMessage{
		calls("c_refused", "create_task", map[string]any{"name": "x"}),
		calls("c_ask", "ask_bot", map[string]string{"bot": "bot_kettle"}),
		{Role: "assistant", Content: "Kettle reads 49.99."},
	})
	if last := lastToolResults(answer.seen[len(answer.seen)-1]); len(last) != 2 || !strings.Contains(last[0], answerOnlyRefusal) || !strings.Contains(last[1], "bot_kettle") {
		t.Fatalf("tagged tool results %v", last)
	}
	if reply := lastMessage(tc); reply.Content != "Kettle reads 49.99." || len(reply.BotAnswers) != 1 {
		t.Fatalf("tagged reply %+v", reply)
	}

	_, c := goldenRun(t, s, db, message("user", "Add Buy milk"), []WireMessage{calls("c_p", "propose_changes", propose)})
	if len(c.Plan) != 1 || c.Plan[0].Tool != "create_task" {
		t.Fatalf("plan %+v", c.Plan)
	}
}

// instructionFor(false) is the instruction as it was before the split
// (sha256 recorded then); instructionFor(true) drops only the scope line.
func TestInstructionForDropsOnlyTheScopeLine(t *testing.T) {
	if got := fmt.Sprintf("%x", sha256.Sum256([]byte(instructionFor(false)))); got != "c0272bc9674d05a5aa389052960a711662bf1145e45ba110be4119d88acfe9e0" {
		t.Fatalf("the instruction changed: %s", got)
	}
	host := instructionFor(true)
	if strings.Contains(host, "Stay within Timely") || strings.Contains(host, "Politely decline unrelated requests") {
		t.Fatal("a host-allowed account still gets the scope line")
	}
	lines, hostLines := strings.Split(instructionFor(false), "\n"), strings.Split(host, "\n")
	if len(hostLines) != len(lines)-1 || hostLines[0] != lines[0] || strings.Join(hostLines[1:], "\n") != strings.Join(lines[2:], "\n") {
		t.Fatal("instructionFor(true) must differ only by the scope line")
	}
}

// An agent run's tool state survives in run_reads for the same run only.
func TestToolRunSavesAndLoadsRunReads(t *testing.T) {
	run := &toolRun{reads: map[string]string{`get_doc{"docId":"doc_1"}`: "h1"}}
	run.bots.note("ask_bot", []byte(`{"outsideData":"m","bot":{"id":"bot_a"}}`))
	var row Conversation
	run.save(&row, "run-1")
	again := &toolRun{reads: map[string]string{}}
	again.load(&row, "run-1")
	if again.reads[`get_doc{"docId":"doc_1"}`] != "h1" || again.bots.asks != 1 || !again.bots.outside || len(again.bots.answers.list(nil)) != 1 || len(again.bots.taint()) != 1 {
		t.Fatalf("loaded %+v", again)
	}
	other := &toolRun{reads: map[string]string{}}
	other.load(&row, "run-2")
	if len(other.reads) != 0 || other.bots.asks != 0 || other.bots.outside {
		t.Fatalf("another run took this one's reads: %+v", other)
	}
}

// A run that failed after taking a steer has no reply: Retry sends the
// request and the steer again.
func TestSinceLastTurnKeepsASteerOfAFailedRun(t *testing.T) {
	steer := message("user", "also add eggs")
	steer.Kind = "steer"
	got := sinceLastTurn([]Message{message("user", "Plan my week"), message("assistant", "Here it is."), message("user", "Add Buy milk"), steer})
	if len(got) != 2 || got[0] != "Add Buy milk" || got[1] != "also add eggs" {
		t.Fatalf("turn input %q", got)
	}
}

// A reply Stop cut short does not end the turn: Retry, or the next
// message, still carries the person's request, with the cut text as data.
func TestSinceLastTurnSkipsACutReply(t *testing.T) {
	cut := message("assistant", "Drafting")
	cut.Cut = true
	got := sinceLastTurn([]Message{
		message("user", "Plan my week"),
		message("assistant", "Here is a plan."),
		message("user", "Add Buy milk"),
		cut,
		notice("Stopped."),
	})
	if len(got) != 3 || got[0] != "Add Buy milk" || got[1] != cutNotice+"Drafting" || got[2] != "System notice (not written by the user): Stopped." {
		t.Fatalf("turn input %q", got)
	}
	seed := historySeed([]Message{message("user", "Add Buy milk"), cut, notice("Stopped."), message("user", "Try again")})
	if seed != nil {
		t.Fatalf("a cut reply ended the seed: %v", seed)
	}
}

// The agent engine's turn input starts after the model's last reply:
// Timely's notices as data, the person's words as written; a steer before
// that reply already reached its run.
func TestSinceLastTurn(t *testing.T) {
	steer := message("user", "Friday instead")
	steer.Kind = "steer"
	archive := message("assistant", "Previous changes")
	archive.Kind = "archive"
	archive.Steps = []Step{{Tool: "create_task", Summary: "Buy milk", Arguments: raw(map[string]string{"name": "Buy milk"}), Status: "done"}}
	got := sinceLastTurn([]Message{
		message("user", "Add Buy milk"),
		steer,
		message("assistant", "Added."),
		notice("Done — your changes are saved."),
		archive,
		message("user", "And bread"),
	})
	if len(got) != 4 || got[0] != "System notice (not written by the user): Done — your changes are saved." ||
		!strings.HasPrefix(got[2], "Historical change records") || got[3] != "And bread" {
		t.Fatalf("turn input %q", got)
	}
}
