package provider

import (
	"strings"
	"testing"

	"timely-api/internal/models"
)

func TestWriteValidate(t *testing.T) {
	cases := []struct {
		req  writeRequest
		want string
	}{
		{writeRequest{}, "Say what to write"},
		{writeRequest{Action: "write", Prompt: "an agenda"}, ""},
		{writeRequest{Action: "improve"}, "Select some text first"},
		{writeRequest{Action: "improve", Selection: "teh plan"}, ""},
		{writeRequest{Action: "continue"}, "There is nothing to continue yet"},
		{writeRequest{Action: "describe"}, "Give it a title first"},
		{writeRequest{Action: "describe", Title: "Book flights"}, ""},
		{writeRequest{Action: "summarize", Text: "Notes"}, ""},
		{writeRequest{Action: "dance"}, `Unknown writing action "dance"`},
	}
	for _, tc := range cases {
		err := tc.req.validate()
		got := ""
		if err != nil {
			got = err.Error()
		}
		if got != tc.want {
			t.Errorf("%+v: got %q, want %q", tc.req, got, tc.want)
		}
	}
}

func TestWriteMessages(t *testing.T) {
	msgs := writeMessages(writeRequest{Action: "describe", Kind: "task", Title: "Book flights", Text: "Lisbon in May"})
	if len(msgs) != 2 || msgs[0].Role != "system" || msgs[1].Role != "user" {
		t.Fatalf("unexpected messages %+v", msgs)
	}
	user := msgs[1].Content
	for _, want := range []string{"task description", `"Book flights"`, "Lisbon in May", "Keep it compact"} {
		if !strings.Contains(user, want) {
			t.Errorf("user turn misses %q:\n%s", want, user)
		}
	}
	// Summarizing a selection sends only the selection, not the whole doc.
	sum := writeMessages(writeRequest{Action: "summarize", Kind: "doc", Text: "WHOLE DOC", Selection: "just this"})[1].Content
	if strings.Contains(sum, "WHOLE DOC") || !strings.Contains(sum, "just this") {
		t.Errorf("summarize turn: %s", sum)
	}
}

func TestWriteMessagesKeepsOneLineSelectionsInline(t *testing.T) {
	one := writeMessages(writeRequest{Action: "longer", Selection: "Workshop space"})[1].Content
	if !strings.Contains(one, "single paragraph") {
		t.Errorf("one-line rewrite should stay inline: %s", one)
	}
	steps := writeMessages(writeRequest{Action: "steps", Selection: "Workshop space"})[1].Content
	if strings.Contains(steps, "single paragraph") {
		t.Errorf("steps must be free to make a list: %s", steps)
	}
}

func TestCleanWritten(t *testing.T) {
	if got := cleanWritten("```markdown\n# Plan\n- one\n```"); got != "# Plan\n- one" {
		t.Errorf("fence not removed: %q", got)
	}
	inner := "Intro\n\n```go\nfmt.Println()\n```\n\nOutro"
	if got := cleanWritten(inner); got != inner {
		t.Errorf("inner code block changed: %q", got)
	}
}

// shoppingDoc is a checklist with the cursor typed as a new item at its end,
// the way the editors mark an empty line under a checklist.
func shoppingDoc() models.JSONMap {
	item := func(text string, checked bool) map[string]any {
		return map[string]any{"type": "taskItem", "attrs": map[string]any{"checked": checked}, "content": []any{
			map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": text}}},
		}}
	}
	return models.JSONMap{"type": "doc", "content": []any{
		map[string]any{"type": "taskList", "content": []any{item("Onion", false), item("Cereal", true), item(writeCursor, false)}},
	}}
}

func TestWriteDocReadsAsMarkdownWithCursor(t *testing.T) {
	req := writeRequest{Action: "write", Prompt: "Ingredients for biryani", Kind: "doc", Doc: shoppingDoc()}
	if err := req.validate(); err != nil {
		t.Fatal(err)
	}
	if want := "- [ ] Onion\n- [x] Cereal\n- [ ] <cursor/>"; req.Text != want {
		t.Fatalf("text = %q, want %q", req.Text, want)
	}
	user := writeMessages(req)[1].Content
	for _, want := range []string{"<current_text>\n- [ ] Onion", "only items of that same kind", `"- [ ] item" for a checklist`} {
		if !strings.Contains(user, want) {
			t.Errorf("user turn misses %q:\n%s", want, user)
		}
	}
	if !strings.Contains(writeMessages(req)[0].Content, `never "- []"`) {
		t.Error("system turn should say how checklist items are written")
	}
}

func TestWriteDropsCursorWhereItIsNotUsed(t *testing.T) {
	cont := writeRequest{Action: "continue", Kind: "doc", Doc: shoppingDoc()}
	if err := cont.validate(); err != nil {
		t.Fatal(err)
	}
	if cont.Text != "- [ ] Onion\n- [x] Cereal" {
		t.Errorf("continue text = %q", cont.Text)
	}
	if strings.Contains(writeMessages(cont)[1].Content, "<cursor/>") {
		t.Error("continue writes at the end, so it gets no cursor")
	}
	fix := writeRequest{Action: "fix", Selection: "Onoin", Kind: "doc", Doc: shoppingDoc()}
	if err := fix.validate(); err != nil || strings.Contains(fix.Text, "<cursor/>") {
		t.Errorf("a rewrite has its selection, not a cursor: %q %v", fix.Text, err)
	}
	// A doc holding only the cursor is empty.
	empty := writeRequest{Action: "continue", Kind: "doc", Doc: models.JSONMap{"type": "doc", "content": []any{
		map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": writeCursor}}},
	}}}
	if err := empty.validate(); err == nil || empty.Text != "" {
		t.Errorf("empty doc: text %q, err %v", empty.Text, err)
	}
}

func TestDropCursor(t *testing.T) {
	cases := map[string]string{
		"Intro\n\n" + writeCursor:                           "Intro\n\n",
		"- [ ] Milk\n- [ ] " + writeCursor + "\n- [ ] Eggs": "- [ ] Milk\n- [ ] Eggs",
		"1. One\n2. " + writeCursor:                         "1. One\n",
		"Pick " + writeCursor + "here":                      "Pick here",
	}
	for in, want := range cases {
		if got := dropCursor(in); got != want {
			t.Errorf("dropCursor(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestClipAroundKeepsCursor(t *testing.T) {
	text := strings.Repeat("a", 100) + writeCursor + strings.Repeat("b", 100)
	got := clipAround(text, writeCursor, 80)
	if len(got) != 80 || !strings.Contains(got, writeCursor) || !strings.HasPrefix(got, "a") {
		t.Errorf("got %q", got)
	}
	if got := clipAround("abcdef", writeCursor, 3); got != "def" {
		t.Errorf("no cursor keeps the end: %q", got)
	}
}

func TestCleanWrittenDropsCursorTag(t *testing.T) {
	if got := cleanWritten("- [ ] Rice <cursor/>\n- [ ] Yogurt"); got != "- [ ] Rice \n- [ ] Yogurt" {
		t.Errorf("got %q", got)
	}
}

func TestClipTailKeepsEnd(t *testing.T) {
	if got := clipTail("abcdef", 3); got != "def" {
		t.Errorf("got %q", got)
	}
}

func TestWriteProvider(t *testing.T) {
	o := overview{DefaultProvider: OpenRouter, APIs: []apiView{{ID: "anthropic", Ready: true}}}
	if got := writeProvider(o); got != "anthropic" {
		t.Errorf("default not ready: got %q", got)
	}
	o.OpenRouter.Ready = true
	if got := writeProvider(o); got != OpenRouter {
		t.Errorf("ready default: got %q", got)
	}
	if got := writeProvider(overview{DefaultProvider: OpenRouter}); got != "" {
		t.Errorf("nothing ready: got %q", got)
	}
}
