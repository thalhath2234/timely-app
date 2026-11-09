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

// The classic loop's prompts and tool results, recorded before the per-call
// branch moved out of plan() into toolcall.go (plan 5.8). Each digest is the
// sha256 of what the model was sent on one call: every message (role,
// content, tool calls, tool call id, cache mark) and the tool specs offered.
// The time notice is the only part that changes from run to run, so it is
// replaced by a placeholder before hashing.
var classicGolden = map[string][]string{
	"reads": {
		"d4fbaf8d43bdf88bf12b9515b577f5e2f8f286b67eb5a5a94e86e1e1b7df381c",
		"b2f1a56f65ee0177f25b1ed6176c57263a65d4a35728aa7539f5d986097a140b",
		"ce2a69ce194b268d80ac221d7b118a34eaee7ba058910cd23ad3ad14bcfd2a51",
		"cccd3db2b4c1e37787d916f3bbc20cea493f8926c8c896a7982870b930e43c55",
		"3afe4615c8282d99e5d471b34b196ffe7b67648761e9c1de902dcc7cf95dde5c",
		"334474d50fb040badaa7134468199e68fabe99844cb645d7521ac5a669fcbcdc",
		"234415c89d191fe69604fe521d87210bcacdea2209d5c867d4cadb3a6dfc7bcd",
		"23cbcfbe9feb7fc901f51173a7bdecf20e31db9559bbfd97fe92b98db21b76ed",
	},
	"tagged": {
		"685463bc1e49061227fec2c7dd4f725005781ca0e0016b40d40a3be6d3bad20b",
		"cc624758b34999223ddf2bcd16d3a51fcb44b4fccbfa7b47e6deb8d817eaa062",
		"bd36b3366f43d563592abf4c55bf8132dd5f23b1b6bcb5602b32239a62730478",
	},
	"propose": {
		"cf8c0d24a7c2f556ff66423435a84f93722a02a6bdfb72b9f06e4eee11bf1c8f",
	},
}

// recorder plays back responses and records each request the model gets.
type recorder struct {
	mu        sync.Mutex
	responses []WireMessage
	requests  []string
	seen      [][]WireMessage
}

func (r *recorder) Complete(_ context.Context, messages []WireMessage, tools []any, _ bool) (WireMessage, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	type wire struct {
		WireMessage
		Cache bool `json:"cache,omitempty"`
	}
	sent := make([]wire, len(messages))
	for i, m := range messages {
		if strings.HasPrefix(m.Content, "System notice (not written by the user):\nCurrent UTC time:") {
			m.Content = "<time notice>"
		}
		sent[i] = wire{WireMessage: m, Cache: m.Cache}
	}
	r.requests = append(r.requests, string(raw(map[string]any{"messages": sent, "tools": tools})))
	r.seen = append(r.seen, append([]WireMessage{}, messages...))
	if len(r.responses) == 0 {
		return WireMessage{}, fmt.Errorf("script exhausted")
	}
	next := r.responses[0]
	r.responses = r.responses[1:]
	return next, nil
}

func (r *recorder) digests() []string {
	out := make([]string, len(r.requests))
	for i, req := range r.requests {
		out[i] = fmt.Sprintf("%x", sha256.Sum256([]byte(req)))
	}
	return out
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
	if err := s.plan(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	return model, c
}

// Classic plan() sends the same prompts and tool results as before the
// per-call branch moved to toolCall: a read, an outside read, a write tool
// called directly, an unknown tool, an oversize result, propose_changes in
// a batch, ask_bot over maxAsks, an answer-only refusal, and a proposal.
func TestIntegrationClassicPromptsAreUnchanged(t *testing.T) {
	db := integrationDB(t)
	s := New(db, goldenCatalog, nil)
	s.SetBotNames(func(context.Context, string) ([]BotName, error) { return tagNames, nil })
	propose := map[string]any{"summary": "Create Buy milk", "direct": true, "language": "en", "reply": "", "remaining": "",
		"steps": []any{map[string]any{"tool": "create_task", "summary": "Create Buy milk", "arguments": map[string]any{"name": "Buy milk"}}}}

	got := map[string][]string{}
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
	got["reads"] = reads.digests()
	last := lastToolResults(reads.seen[len(reads.seen)-1])
	if len(last) != 11 || !strings.Contains(last[2], "never called directly") || !strings.Contains(last[3], `Unknown tool \"frobnicate\"`) ||
		!strings.Contains(last[4], "Result is too large") || !strings.Contains(last[6], "Call propose_changes alone") || !strings.Contains(last[10], "as many bots as one request may ask (3)") {
		t.Fatalf("tool results %v", last)
	}

	tagged := message("user", "@Kettle, make a task")
	tagged.BotTags = []string{"bot_kettle"}
	answer, _ := goldenRun(t, s, db, tagged, []WireMessage{
		calls("c_refused", "create_task", map[string]any{"name": "x"}),
		calls("c_ask", "ask_bot", map[string]string{"bot": "bot_kettle"}),
		{Role: "assistant", Content: "Kettle reads 49.99."},
	})
	got["tagged"] = answer.digests()

	proposal, c := goldenRun(t, s, db, message("user", "Add Buy milk"), []WireMessage{calls("c_p", "propose_changes", propose)})
	got["propose"] = proposal.digests()
	if len(c.Plan) != 1 || c.Plan[0].Tool != "create_task" {
		t.Fatalf("plan %+v", c.Plan)
	}

	for name, digests := range got {
		want := classicGolden[name]
		same := len(want) == len(digests)
		for i := 0; same && i < len(want); i++ {
			same = want[i] == digests[i]
		}
		if !same {
			t.Errorf("%s: prompts changed\n got  %q\n want %q", name, digests, want)
		}
	}
}

// instructionFor(false) is the instruction as it was before the split
// (sha256 recorded then); instructionFor(true) drops only the scope line.
func TestInstructionForDropsOnlyTheScopeLine(t *testing.T) {
	if got := fmt.Sprintf("%x", sha256.Sum256([]byte(instructionFor(false)))); got != "c0272bc9674d05a5aa389052960a711662bf1145e45ba110be4119d88acfe9e0" {
		t.Fatalf("the classic instruction changed: %s", got)
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
