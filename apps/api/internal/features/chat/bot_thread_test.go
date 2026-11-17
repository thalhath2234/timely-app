package chat

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"timely-api/internal/features/bots"
)

// The thread's toolset is the whole of it: no Timely write, no web tool, no
// host tool, and the definitions offered match the names.
func TestBotThreadToolsetIsClosed(t *testing.T) {
	for _, draft := range []bool{false, true} {
		names := BotThreadToolNames(draft)
		var offered []string
		for _, def := range threadToolDefs(draft) {
			fn := def.(map[string]any)["function"].(map[string]any)
			offered = append(offered, fn["name"].(string))
		}
		if !slices.Equal(names, offered) {
			t.Fatalf("draft=%v: names %v, offered %v", draft, names, offered)
		}
		for _, name := range names {
			if isWriteTool(name) {
				t.Errorf("%s is a Timely write tool", name)
			}
			if webTools[name] || strings.HasPrefix(name, "browser") || strings.HasPrefix(name, "terminal") {
				t.Errorf("%s is a web or host tool", name)
			}
		}
	}
	want := []string{"get_bot", "bot_history", "change_bot", "undo_bot_change"}
	if got := BotThreadToolNames(false); !slices.Equal(got, want) {
		t.Fatalf("toolset %v, want %v", got, want)
	}
	if got := BotThreadToolNames(true); !slices.Equal(got, []string{"create_bot_draft"}) {
		t.Fatalf("draft toolset %v", got)
	}
}

// Any other tool, whatever the model or a page asks for, is refused before it
// touches anything.
func TestBotThreadRefusesOtherTools(t *testing.T) {
	s := New(nil, nil, nil)
	s.SetBotThreads(refuseAll{t})
	st := &threadTurn{uid: "user-a", cid: "chat_1", botID: "bot_1"}
	for _, name := range []string{"create_task", "update_task", "web_search", "web_extract", "browser_exec", "terminal", "propose_changes", "ask_bot", "list_bots", "create_bot", "create_bot_draft"} {
		out := s.threadTool(context.Background(), st, name, json.RawMessage(`{}`))
		if m, ok := out.(map[string]any); !ok || !strings.Contains(m["error"].(string), "only changes its bot") {
			t.Errorf("%s was not refused: %v", name, out)
		}
	}
	draft := &threadTurn{uid: "user-a", cid: "chat_2", draft: true}
	for _, name := range []string{"change_bot", "get_bot", "bot_history", "undo_bot_change"} {
		if out := s.threadTool(context.Background(), draft, name, nil); out.(map[string]any)["error"] == nil {
			t.Errorf("%s ran in a draft thread", name)
		}
	}
}

// refuseAll fails the test on any call: a refused tool never reaches Bots.
type refuseAll struct{ t *testing.T }

func (r refuseAll) Get(context.Context, string, string) (bots.Detail, error) {
	r.t.Fatal("Get called")
	return bots.Detail{}, nil
}
func (r refuseAll) Change(context.Context, string, string, bots.ChangeInput, bool) (bots.ChangeResult, error) {
	r.t.Fatal("Change called")
	return bots.ChangeResult{}, nil
}
func (r refuseAll) History(context.Context, string, string, bots.HistoryQuery) (bots.History, error) {
	r.t.Fatal("History called")
	return bots.History{}, nil
}
func (r refuseAll) Create(context.Context, string, bots.Input, bots.Origin) (bots.View, error) {
	r.t.Fatal("Create called")
	return bots.View{}, nil
}

func TestReviewTransitions(t *testing.T) {
	type c struct {
		state, action, next string
		noop, refused       bool
	}
	cases := []c{
		{bots.ProposalPending, "approve", bots.ProposalApproved, false, false},
		{bots.ProposalApproved, "approve", bots.ProposalApproved, false, false}, // finish a cut-short apply
		{bots.ProposalApplied, "approve", bots.ProposalApplied, true, false},
		{bots.ProposalUndone, "approve", bots.ProposalUndone, true, false},
		{bots.ProposalDismissed, "approve", "", false, true},
		{bots.ProposalFailed, "approve", "", false, true},
		{"", "approve", "", false, true},
		{bots.ProposalPending, "discard", bots.ProposalDismissed, false, false},
		{bots.ProposalDismissed, "discard", bots.ProposalDismissed, true, false},
		{bots.ProposalApproved, "discard", "", false, true},
		{bots.ProposalApplied, "discard", "", false, true},
		{bots.ProposalUndone, "discard", "", false, true},
		{"", "discard", "", false, true},
		{bots.ProposalPending, "other", "", false, true},
	}
	for _, x := range cases {
		next, noop, err := reviewTransition(x.state, x.action)
		if (err != nil) != x.refused || next != x.next || noop != x.noop {
			t.Errorf("%q + %s: next %q noop %v err %v; want %q noop %v refused %v", x.state, x.action, next, noop, err, x.next, x.noop, x.refused)
		}
	}
}

func TestProposalOfNormalizesBothShapes(t *testing.T) {
	one, err := proposalOf(json.RawMessage(`{"tool":"create_task","args":{"name":"Buy the Pixel"}}`))
	if err != nil {
		t.Fatal(err)
	}
	var p proposal
	if err := json.Unmarshal(lenientProposal(one), &p); err != nil || len(p.Steps) != 1 || p.Steps[0].Tool != "create_task" || !strings.Contains(string(p.Steps[0].Arguments), "Buy the Pixel") {
		t.Fatalf("single step: %+v %v", p, err)
	}
	many := json.RawMessage(`{"summary":"Two","steps":[{"tool":"create_task","summary":"A","arguments":{"name":"A"}}]}`)
	if got, err := proposalOf(many); err != nil || string(got) != string(many) {
		t.Fatalf("steps shape: %s %v", got, err)
	}
	for _, bad := range []string{`{}`, `{"tool":"create_task"}`, `"x"`, `[]`} {
		if _, err := proposalOf(json.RawMessage(bad)); err == nil {
			t.Errorf("%s must be refused", bad)
		}
	}
}

func TestCardOfShowsTheProposal(t *testing.T) {
	a := bots.Alert{ID: "balert_1", ProposalState: bots.ProposalPending, Proposal: json.RawMessage(`{"summary":"Add the task","steps":[{"tool":"create_task","summary":"Buy the Pixel","arguments":{"name":"x"}}]}`)}
	card := cardOf(a)
	if card == nil || card.State != "pending" || card.Summary != "Add the task" || len(card.Steps) != 1 || card.Steps[0] != "Buy the Pixel" || card.ConversationID != "" {
		t.Fatalf("card %+v", card)
	}
	a.ProposalState = bots.ProposalApplied
	if card = cardOf(a); card.ConversationID != reviewChatID("balert_1") {
		t.Fatalf("an applied card names its receipt chat: %+v", card)
	}
	if cardOf(bots.Alert{}) != nil {
		t.Fatal("an alert without a proposal has no card")
	}
}

func TestPatchBecomesAgentInput(t *testing.T) {
	var p patchIn
	raw := `{"prompt":"p","schedule":"every 6h","tools":{"browserSites":["shop.example"],"useMemory":true},"permission":"supervised","gate":"always"}`
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		t.Fatal(err)
	}
	in, err := p.agentInput()
	if err != nil {
		t.Fatal(err)
	}
	if in.Prompt == nil || *in.Prompt != "p" || string(in.Schedule) != `"every 6h"` || in.Tools == nil || in.Tools.UseMemory == nil || !*in.Tools.UseMemory ||
		in.Permission == nil || *in.Permission != "supervised" || in.Gate == nil || *in.Gate != "always" || !in.Set() {
		t.Fatalf("input %+v", in)
	}
}

// A thread whose turn is answering reads as working, since thread turns never
// set the row's Status; the apps show "Working" and poll fast from it.
func TestThreadSummaryWorking(t *testing.T) {
	s := &Service{}
	row := Conversation{ID: "chat_w", Kind: KindBotThread}
	if s.summaryOf(row, 0).Working {
		t.Fatal("idle thread reads as working")
	}
	if !s.beginThreadTurn(row.ID) {
		t.Fatal("turn did not begin")
	}
	if !s.summaryOf(row, 0).Working {
		t.Fatal("thread with a running turn does not read as working")
	}
	s.threadRuns.Delete(row.ID)
	if s.summaryOf(row, 0).Working {
		t.Fatal("finished turn still reads as working")
	}
}

// A reply that only repeats the change cards is dropped; one that adds
// anything is kept.
func TestRestatesCard(t *testing.T) {
	for reply, want := range map[string]bool{
		"Changed: every 6 hours -> every 5 minutes. Undo is available.": true,
		"changed: a -> b\n- Changed: c -> d":                            true,
		"Waiting for your tap: memory off -> on":                        true,
		"":                                                              true,
		"Changed: a -> b\nNote: 5 minutes is below this page's 15-minute minimum.": false,
		"Which timezone are you in?": false,
	} {
		if got := restatesCard(reply); got != want {
			t.Errorf("restatesCard(%q) = %v, want %v", reply, got, want)
		}
	}
}
