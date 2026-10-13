package provider

import (
	"strings"
	"testing"
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
