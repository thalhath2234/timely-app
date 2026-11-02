package provider

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/chat"
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
	if got := cleanWritten("```markdown\n# Plan\n- one\n```", false); got != "# Plan\n- one" {
		t.Errorf("fence not removed: %q", got)
	}
	inner := "Intro\n\n```go\nfmt.Println()\n```\n\nOutro"
	if got := cleanWritten(inner, false); got != inner {
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
		if got := dropCursor(in, writeCursor); got != want {
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
	if got := cleanWritten("- [ ] Rice <cursor/>\n- [ ] Yogurt", true); got != "- [ ] Rice \n- [ ] Yogurt" {
		t.Errorf("got %q", got)
	}
	// The cursor's own item copied back goes with its box, not as "[ ]".
	if got := cleanWritten("- [ ] Rice\n- [ ] Yogurt\n- [ ] <cursor/>", true); got != "- [ ] Rice\n- [ ] Yogurt" {
		t.Errorf("cursor item: %q", got)
	}
	// Without a cursor in the doc the tag is the user's own text.
	if got := cleanWritten("Use <cursor/> in templates", false); got != "Use <cursor/> in templates" {
		t.Errorf("no cursor: %q", got)
	}
}

// A new doc whose only line is an empty checklist item still tells the model
// it writes checklist items; a bare empty line is an empty doc.
func TestWriteKeepsCursorInALoneListItem(t *testing.T) {
	lone := writeRequest{Action: "write", Prompt: "Ingredients for biryani", Kind: "doc", Doc: models.JSONMap{"type": "doc", "content": []any{
		map[string]any{"type": "taskList", "content": []any{map[string]any{"type": "taskItem", "attrs": map[string]any{"checked": false}, "content": []any{
			map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": writeCursor}}},
		}}}},
	}}}
	if err := lone.validate(); err != nil {
		t.Fatal(err)
	}
	if lone.Text != "- [ ] <cursor/>" || !strings.Contains(writeMessages(lone)[1].Content, "only items of that same kind") {
		t.Errorf("lone item: %q", lone.Text)
	}
	bare := writeRequest{Action: "write", Prompt: "A plan", Kind: "doc", Doc: models.JSONMap{"type": "doc", "content": []any{
		map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": writeCursor}}},
	}}}
	if err := bare.validate(); err != nil || bare.Text != "" || bare.cursor {
		t.Errorf("bare line: %q %v", bare.Text, err)
	}
}

// Only a draft written at the caret, from the editor's doc, gets the cursor:
// not a summary or description, not plain text from older apps, and not a
// mark the doc already held as text.
func TestWriteCursorOnlyForDraftsFromTheEditor(t *testing.T) {
	for _, action := range []string{"summarize", "describe"} {
		r := writeRequest{Action: action, Kind: "doc", Title: "Trip", Doc: shoppingDoc()}
		if err := r.validate(); err != nil || r.cursor || strings.Contains(writeMessages(r)[1].Content, "<cursor/>") {
			t.Errorf("%s: %q %v", action, r.Text, err)
		}
	}
	plain := writeRequest{Action: "write", Prompt: "More", Kind: "doc", Text: "Notes " + writeCursor + " here"}
	if err := plain.validate(); err != nil || plain.cursor || plain.Text != "Notes  here" {
		t.Errorf("plain text: %q %v", plain.Text, err)
	}
	twice := shoppingDoc()
	twice["content"] = append([]any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": "About " + writeCursor}}}}, twice["content"].([]any)...)
	r := writeRequest{Action: "write", Prompt: "More", Kind: "doc", Doc: twice}
	if err := r.validate(); err != nil || r.cursor || strings.Contains(r.Text, writeCursor) {
		t.Errorf("mark twice: %q %v", r.Text, err)
	}
	// A tag the doc holds as text is not taken for the spot.
	tagged := shoppingDoc()
	tagged["content"] = append([]any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": "Use <cursor/> in templates"}}}}, tagged["content"].([]any)...)
	r = writeRequest{Action: "write", Prompt: "More", Kind: "doc", Doc: tagged}
	if err := r.validate(); err != nil || !r.cursor || strings.Count(r.Text, "<cursor/>") != 1 {
		t.Errorf("tag as text: %q %v", r.Text, err)
	}
}

func TestClipTailKeepsEnd(t *testing.T) {
	if got := clipTail("abcdef", 3); got != "def" {
		t.Errorf("got %q", got)
	}
}

// A long selection goes to the model whole, or not at all: Replace puts the
// answer over all of it, so a rewrite of its first part would delete the
// rest (W1).
func TestWriteNeverCutsTheSelection(t *testing.T) {
	var lines []string
	for i := 1; len(strings.Join(lines, "\n")) < 9000; i++ {
		lines = append(lines, fmt.Sprintf("Line %d: the crew will arrive at 10am and set up the stage.", i))
	}
	lines = append(lines, "FINAL LINE: wrap up in December 2027.")
	whole := strings.Join(lines, "\n")
	req := writeRequest{Action: "fix", Selection: whole}
	if err := req.validate(); err != nil || req.Selection != whole {
		t.Fatalf("a %d-byte selection must go whole: err %v, kept %d bytes", len(whole), err, len(req.Selection))
	}
	if !strings.Contains(writeMessages(req)[1].Content, "FINAL LINE") {
		t.Error("the end of the selection must reach the model")
	}
	tooLong := writeRequest{Action: "fix", Selection: strings.Repeat("word ", writeMaxSelection/5+1)}
	if err := tooLong.validate(); err == nil || err.Error() != writeTooLong {
		t.Fatalf("over the limit must be refused with %q, got %v", writeTooLong, err)
	}
}

func richSelection() models.JSONMap {
	text := func(s string, marks ...any) map[string]any {
		node := map[string]any{"type": "text", "text": s}
		if len(marks) > 0 {
			node["marks"] = marks
		}
		return node
	}
	para := func(content ...any) map[string]any { return map[string]any{"type": "paragraph", "content": content} }
	item := func(s string, checked bool) any {
		return map[string]any{"type": "taskItem", "attrs": map[string]any{"checked": checked}, "content": []any{para(text(s))}}
	}
	cell := func(kind, s string) any { return map[string]any{"type": kind, "content": []any{para(text(s))}} }
	return models.JSONMap{"type": "doc", "content": []any{
		para(text("See the "), text("spec", map[string]any{"type": "link", "attrs": map[string]any{"href": "https://example.com/spec"}}),
			text(" with "), map[string]any{"type": "mention", "attrs": map[string]any{"id": "tsk_1", "label": "Alice onboarding", "entityType": "task"}},
			text(" tomorow")),
		map[string]any{"type": "taskList", "content": []any{item("buy milk", true), item("call bob", false)}},
		map[string]any{"type": "table", "content": []any{
			map[string]any{"type": "tableRow", "content": []any{cell("tableHeader", "Who"), cell("tableHeader", "When")}},
			map[string]any{"type": "tableRow", "content": []any{cell("tableCell", "Sam"), cell("tableCell", "Monday")}},
		}},
	}}
}

// The selection goes as Markdown, so links, @mentions, tick boxes and
// tables reach the model and can come back (GW1).
func TestWriteSendsARichSelectionAsMarkdown(t *testing.T) {
	req := writeRequest{Action: "improve", Selection: "See the spec with  tomorow", SelectionDoc: richSelection()}
	if err := req.validate(); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"[spec](https://example.com/spec)", "[@Alice onboarding](timely://task/tsk_1)",
		"- [x] buy milk\n- [ ] call bob", "| Who | When |", "| Sam | Monday |",
	} {
		if !strings.Contains(req.Selection, want) {
			t.Errorf("selection misses %q:\n%s", want, req.Selection)
		}
	}
	user := writeMessages(req)[1].Content
	for _, want := range []string{"<selected_text>\nSee the [spec]", "Keep every link and every @mention", "ticked and unticked boxes"} {
		if !strings.Contains(user, want) {
			t.Errorf("user turn misses %q:\n%s", want, user)
		}
	}
	// Apps from before selectionDoc still send plain text.
	plain := writeRequest{Action: "improve", Selection: "teh plan"}
	if err := plain.validate(); err != nil || strings.Contains(writeMessages(plain)[1].Content, "@mention") {
		t.Errorf("plain selection: %v", err)
	}
}

// longDoc is a doc of two parts with n notes each, as Markdown blocks.
func longDoc(n int) string {
	parts := []string{"# Move plan"}
	parts = append(parts, "## Part 1: Budget")
	for i := 1; i <= n; i++ {
		parts = append(parts, fmt.Sprintf("Budget note %d: set aside money for the boxes, the van and that floor section.", i))
	}
	parts = append(parts, "## Part 2: Move days")
	for i := 1; i <= n; i++ {
		parts = append(parts, fmt.Sprintf("Move note %d: carry the boxes down before noon and check that floor section.", i))
	}
	return strings.Join(parts, "\n\n")
}

// A summary reads the whole of a doc this size, not its last 12 KB starting
// mid-sentence (W6).
func TestWriteSummaryReadsTheWholeDoc(t *testing.T) {
	doc := longDoc(80)
	if len(doc) < 12000 {
		t.Fatalf("doc too short for the test: %d", len(doc))
	}
	for _, action := range []string{"summarize", "describe"} {
		req := writeRequest{Action: action, Kind: "doc", Text: doc}
		if err := req.validate(); err != nil {
			t.Fatal(err)
		}
		if req.Text != doc || req.shortened {
			t.Errorf("%s: a %d-byte doc must be read whole, got %d bytes (shortened %v)", action, len(doc), len(req.Text), req.shortened)
		}
	}
}

// A doc too long to read whole keeps its start and its end, cut between
// blocks, with a note where the middle is; the model and the person are told.
func TestWriteLongDocKeepsStartAndEnd(t *testing.T) {
	doc := longDoc(400)
	req := writeRequest{Action: "summarize", Kind: "doc", Text: doc}
	if err := req.validate(); err != nil {
		t.Fatal(err)
	}
	if !req.shortened || len(req.Text) > writeMaxWhole+100 {
		t.Fatalf("want a shortened text of about %d bytes, got %d (shortened %v)", writeMaxWhole, len(req.Text), req.shortened)
	}
	if !strings.HasPrefix(req.Text, "# Move plan\n\n## Part 1: Budget\n\nBudget note 1:") {
		t.Errorf("the start must be kept: %q", req.Text[:80])
	}
	if !strings.HasSuffix(req.Text, "Move note 400: carry the boxes down before noon and check that floor section.") {
		t.Errorf("the end must be kept: %q", req.Text[len(req.Text)-80:])
	}
	marker := regexp.MustCompile(`\n\n\[… \d+ words left out here …\]\n\n(Budget|Move) note \d+: `)
	if !marker.MatchString(req.Text) {
		t.Errorf("the cut must fall between blocks, with a note")
	}
	if user := writeMessages(req)[1].Content; !strings.Contains(user, "its middle is left out") {
		t.Errorf("the model must be told the middle is missing:\n%s", user[len(user)-300:])
	}
	// Continue writing keeps the end it carries on from, and the title.
	cont := writeRequest{Action: "continue", Kind: "doc", Text: doc}
	if err := cont.validate(); err != nil {
		t.Fatal(err)
	}
	if !cont.shortened || !strings.HasPrefix(cont.Text, "# Move plan") || !strings.HasSuffix(cont.Text, "floor section.") || len(cont.Text) > writeMaxText+100 {
		t.Errorf("continue: %d bytes, shortened %v", len(cont.Text), cont.shortened)
	}
	// A selection's summary is about the selection; the doc is not cut for it.
	sel := writeRequest{Action: "summarize", Kind: "doc", Text: doc, Selection: "Budget note 1"}
	if err := sel.validate(); err != nil || sel.shortened {
		t.Errorf("summary of a selection: shortened %v, %v", sel.shortened, err)
	}
}

// firstSetUp only tells "nothing set up" from "set up but not chosen"
// (ADR 0020); it never picks the provider a run uses.
func TestFirstSetUpSeesEveryKindOfProvider(t *testing.T) {
	now := time.Now()
	cases := []struct {
		name string
		row  Settings
		rows map[string]APIKey
		cli  bool
		want string
	}{
		{"api key before OpenRouter", Settings{OpenRouterKey: "enc"}, map[string]APIKey{"anthropic": {Key: "enc", Model: "m"}}, true, "anthropic"},
		{"connected CLI", Settings{OpenRouterKey: "enc", ClaudeConnectedAt: &now}, nil, true, ClaudeCLI},
		{"CLIs off on the server", Settings{OpenRouterKey: "enc", ClaudeConnectedAt: &now}, nil, false, OpenRouter},
		{"set up without a model", Settings{}, map[string]APIKey{"anthropic": {Key: "enc"}}, true, "anthropic"},
		{"Ollama needs no key", Settings{}, map[string]APIKey{"ollama": {Model: "m"}}, true, "ollama"},
		{"OpenRouter alone", Settings{OpenRouterKey: "enc"}, nil, true, OpenRouter},
		{"nothing set up", Settings{}, nil, true, ""},
	}
	for _, c := range cases {
		if got := firstSetUp(c.row, c.rows, c.cli); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

// GW7: a code answer stays code; only a Markdown or plain fence around the
// whole answer is taken off.
func TestCleanWrittenKeepsCodeBlocks(t *testing.T) {
	bash := "```bash\n#!/usr/bin/env bash\n# backup-notes.sh\nrsync -a ~/notes /backup\n```"
	if got := cleanWritten(bash, false); got != bash {
		t.Errorf("a bash block lost its fence: %q", got)
	}
	two := "```bash\nrsync -a ~/notes /backup\n```\n\nTo run it every night, add this line:\n\n```\n0 2 * * * ~/backup.sh\n```"
	if got := cleanWritten(two, false); got != two {
		t.Errorf("two blocks with prose between were stripped: %q", got)
	}
	cpp := "```c++\nint main() {}\n```"
	if got := cleanWritten(cpp, false); got != cpp {
		t.Errorf("c++ block changed: %q", got)
	}
	for _, lang := range []string{"", "markdown", "md", "text"} {
		if got := cleanWritten("```"+lang+"\n# Plan\n- one\n```", false); got != "# Plan\n- one" {
			t.Errorf("%q fence not removed: %q", lang, got)
		}
	}
}

// W9: a chatty opening and closing offer around the text, a fence after a
// preamble and CRLF line ends are taken off; the answer itself is kept.
func TestCleanWrittenDropsPreambleAndClosing(t *testing.T) {
	chatty := "Sure! Here is your packing list:\n\n```markdown\n- [ ] Passport\n- [ ] Charger\n```\n\nLet me know if you want more items!"
	if got := cleanWritten(chatty, false); got != "- [ ] Passport\n- [ ] Charger" {
		t.Errorf("chatty fenced answer: %q", got)
	}
	plain := "Here's a draft:\n\n- [ ] Passport\n- [ ] Charger\n\nI hope this helps."
	if got := cleanWritten(plain, false); got != "- [ ] Passport\n- [ ] Charger" {
		t.Errorf("chatty plain answer: %q", got)
	}
	crlf := "```markdown\r\n# Plan\r\n- one\r\n```"
	if got := cleanWritten(crlf, false); got != "# Plan\n- one" {
		t.Errorf("CRLF fence: %q", got)
	}
	// An email that ends with "Let me know" and has no chatty opening keeps it.
	email := "Hi Sam,\n\nThe van is booked for Friday.\n\nLet me know if that works."
	if got := cleanWritten(email, false); got != email {
		t.Errorf("the draft's own last line was dropped: %q", got)
	}
	// "Sure, I can make it Friday." is the draft, not a preamble.
	reply := "Sure, I can make it Friday.\n\nSee you then."
	if got := cleanWritten(reply, false); got != reply {
		t.Errorf("draft opening dropped: %q", got)
	}
	// A "Here are..." line that leads into the doc's own list is the text
	// (Continue writing meeting notes), not talk about the answer.
	for _, own := range []string{
		"Here are the next steps:\n\n1. Book the van\n2. Pack the boxes",
		"Here's what we agreed on:\n\n- Move on Friday\n- Sam brings tape",
	} {
		if got := cleanWritten(own, false); got != own {
			t.Errorf("the draft's own lead-in was dropped: %q", got)
		}
	}
	if got := cleanWritten("Here is a shorter version:\n\nPack light and go.", false); got != "Pack light and go." {
		t.Errorf("a version preamble was kept: %q", got)
	}
}

// W22: a cursor tag inside a line leaves one space, not two.
func TestCleanWrittenInlineCursorKeepsOneSpace(t *testing.T) {
	if got := cleanWritten("Pack light <cursor/> and bring a jacket.", true); got != "Pack light and bring a jacket." {
		t.Errorf("got %q", got)
	}
	if got := cleanWritten("Pack light<cursor/> and go", true); got != "Pack light and go" {
		t.Errorf("got %q", got)
	}
}

// W9: an answer that starts by repeating the line before the cursor drops it.
func TestDropRepeatedLead(t *testing.T) {
	text := "Trip notes\n\n<cursor/>"
	if got := dropRepeatedLead("Trip notes\n## Packing\n- [ ] Passport", text); got != "## Packing\n- [ ] Passport" {
		t.Errorf("got %q", got)
	}
	if got := dropRepeatedLead("## Packing\n- [ ] Passport", text); got != "## Packing\n- [ ] Passport" {
		t.Errorf("a new first line must stay: %q", got)
	}
}

// GW17: a refusal comes back as a refusal, not as the draft.
func TestDeclined(t *testing.T) {
	for _, text := range []string{"I can't help with that.", "I’m sorry, but I cannot help with this request.", "CANNOT_WRITE: That would be a fake doctor's note."} {
		if _, ok := declined(text); !ok {
			t.Errorf("%q: want declined", text)
		}
	}
	if reason, _ := declined("CANNOT_WRITE: Not that one."); reason != "Not that one." {
		t.Errorf("reason = %q", reason)
	}
	for _, text := range []string{"I can't make it on Friday, sorry.", "I can't help with that move, but Sam can.\n\nCall him on Monday.", "- [ ] Passport"} {
		if _, ok := declined(text); ok {
			t.Errorf("%q: a draft, not a refusal", text)
		}
	}
	if !strings.Contains(writeSystem, writeDeclined) {
		t.Error("the system prompt must name the refusal marker")
	}
}

// GW18: a link into Timely the request never held is plain words, not a
// mention chip to nothing; the ones it held are kept.
func TestKeepKnownLinks(t *testing.T) {
	sent := "See [@Alice onboarding](timely://task/tsk_42) and [spec](https://example.com)."
	answer := "Ask [@Alice onboarding](timely://task/tsk_42) and [@Ghost](timely://task/00000000-0000-0000-0000-000000000000) about [spec](https://example.com)."
	want := "Ask [@Alice onboarding](timely://task/tsk_42) and @Ghost about [spec](https://example.com)."
	if got := keepKnownLinks(answer, sent); got != want {
		t.Errorf("got %q", got)
	}
}

// GW19: with the editor's own cursor mark, a doc that holds the word
// TIMELYWRITECURSOR keeps it, and the real spot is still found.
func TestWriteCursorMarkLeavesTheWordAlone(t *testing.T) {
	mark := writeCursor + "QXZJKWPA"
	doc := models.JSONMap{"type": "doc", "content": []any{
		map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": "Rename " + writeCursor + " later"}}},
		map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": mark}}},
	}}
	req := writeRequest{Action: "write", Prompt: "a list", Kind: "doc", Doc: doc, CursorMark: mark}
	if err := req.validate(); err != nil {
		t.Fatal(err)
	}
	if !req.cursor || !strings.Contains(req.Text, "Rename "+writeCursor+" later") || !strings.HasSuffix(req.Text, cursorTag) {
		t.Errorf("text %q, cursor %v", req.Text, req.cursor)
	}
	// Without a cursor in the doc, the word is not taken for one.
	plain := writeRequest{Action: "write", Prompt: "a list", Kind: "doc", Doc: doc, CursorMark: writeCursor + "ZZZZZZZZ"}
	if err := plain.validate(); err != nil || plain.cursor || !strings.Contains(plain.Text, "Rename "+writeCursor+" later") {
		t.Errorf("text %q, cursor %v, %v", plain.Text, plain.cursor, err)
	}
	// A mark that isn't one of ours is ignored.
	bad := writeRequest{Action: "write", Prompt: "a list", Kind: "doc", Doc: doc, CursorMark: "Rename"}
	if err := bad.validate(); err != nil || strings.Contains(bad.Text, "<cursor/> ") {
		t.Errorf("bad mark: %q %v", bad.Text, err)
	}
}

// GW20: the prompt and title are cut by characters, as the apps count them.
func TestWriteCutsPromptByCharacters(t *testing.T) {
	malayalam := strings.Repeat("മ", writeMaxPrompt)
	req := writeRequest{Action: "write", Prompt: malayalam, Title: strings.Repeat("ത", writeMaxTitle)}
	if err := req.validate(); err != nil {
		t.Fatal(err)
	}
	if req.Prompt != malayalam || utf8.RuneCountInString(req.Title) != writeMaxTitle {
		t.Errorf("prompt %d chars, title %d chars", utf8.RuneCountInString(req.Prompt), utf8.RuneCountInString(req.Title))
	}
	if got := clipRunes("abcdef", 3); got != "abc" {
		t.Errorf("clipRunes = %q", got)
	}
}

// GW22: the model is told today's date and zone.
func TestWriteMessagesSayToday(t *testing.T) {
	user := writeMessages(writeRequest{Action: "write", Prompt: "Meeting notes for next Tuesday", today: "Sunday 2026-11-01 (Europe/Lisbon)"})[1].Content
	if !strings.HasPrefix(user, "Today is Sunday 2026-11-01 (Europe/Lisbon).\n") {
		t.Errorf("user turn: %s", user)
	}
	// Live, a dated request once came back with the date sums written out.
	if !strings.Contains(writeSystem, "never show how you worked something out") {
		t.Error("the system prompt must ask for the result only")
	}
}

// W13: Describe and Continue are told not to make things up.
func TestDescribeAndContinueDoNotInvent(t *testing.T) {
	for _, action := range []string{"describe", "continue"} {
		if !strings.Contains(writeActions[action], "do not invent facts") {
			t.Errorf("%s: %q", action, writeActions[action])
		}
	}
	if strings.Contains(writeActions["describe"], "why it matters") {
		t.Error("describe still asks for why it matters, which invites made-up reasons")
	}
}

// W15: a rewrite sends the selection and only the text around it.
func TestWriteRewriteSendsOnlyTheTextAround(t *testing.T) {
	doc := strings.Repeat("Early line about the kitchen plan.\n", 200) + "Fix teh tiles.\n" + strings.Repeat("Later line about the budget.\n", 200)
	req := writeRequest{Action: "fix", Selection: "Fix teh tiles.", Kind: "doc", Text: doc}
	if err := req.validate(); err != nil {
		t.Fatal(err)
	}
	if !req.around || len(req.Text) > 2*writeRewriteContext+100 || !strings.Contains(req.Text, writeSelectionMark) || strings.Contains(req.Text, "teh") {
		t.Fatalf("around %v, %d bytes: %q", req.around, len(req.Text), req.Text)
	}
	user := writeMessages(req)[1].Content
	if strings.Count(user, "Fix teh tiles.") != 1 || !strings.Contains(user, "marks where the selected text sits") {
		t.Errorf("user turn: %s", user)
	}
	// Not found in the doc: no doc at all rather than all of it.
	missing := writeRequest{Action: "improve", Selection: "Not in the doc", Kind: "doc", Text: doc}
	if err := missing.validate(); err != nil || missing.Text != "" {
		t.Errorf("missing selection: %d bytes, %v", len(missing.Text), err)
	}
}

// RV-hmw-1: a too-long Summarize says summarize, not rewrite.
func TestWriteTooLongSaysWhatItDoes(t *testing.T) {
	long := strings.Repeat("word ", writeMaxSelection/4)
	sum := writeRequest{Action: "summarize", Selection: long}
	if err := sum.validate(); err == nil || err.Error() != writeTooLongSummary {
		t.Errorf("summarize: %v", err)
	}
	fix := writeRequest{Action: "fix", Selection: long}
	if err := fix.validate(); err == nil || err.Error() != writeTooLong {
		t.Errorf("fix: %v", err)
	}
}

// W11, W16: a timeout and an answer cut at the model's limit get words for
// the feature, not Go errors or the agent's proposal wording.
func TestOneShotError(t *testing.T) {
	check := func(err error, code int, want string) {
		t.Helper()
		var he *echo.HTTPError
		if !errors.As(oneShotError(err, "The draft was too long to finish."), &he) || he.Code != code || fmt.Sprint(he.Message) != want {
			t.Errorf("%v: got %v", err, he)
		}
	}
	check(context.DeadlineExceeded, 504, "The AI took too long to answer. Try again")
	check(chat.ErrOutputTooLong, 502, "The draft was too long to finish.")
	check(errors.New("Anthropic returned HTTP 529: Overloaded"), 502, "Anthropic returned HTTP 529: Overloaded")
}

// listDoc is a checklist, a bullet list and an empty line holding the cursor,
// as the editors send a doc for a typed request under a list.
func listDoc(cursor string) models.JSONMap {
	para := func(text string) map[string]any {
		if text == "" {
			return map[string]any{"type": "paragraph"}
		}
		return map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": text}}}
	}
	task := map[string]any{"type": "taskItem", "attrs": map[string]any{"checked": true}, "content": []any{para("Onion")}}
	bullet := func(text string) map[string]any {
		return map[string]any{"type": "listItem", "content": []any{para(text)}}
	}
	return models.JSONMap{"type": "doc", "content": []any{
		map[string]any{"type": "taskList", "content": []any{task}},
		para(""),
		map[string]any{"type": "bulletList", "content": []any{bullet("Chicken"), bullet("Rice")}},
		para(cursor),
	}}
}

func TestWritePlacedReadsNumberedBlocks(t *testing.T) {
	req := writeRequest{Action: "write", Prompt: "make the bullets a checklist", Kind: "doc", Doc: listDoc(writeCursor), Place: true}
	if err := req.validate(); err != nil {
		t.Fatal(err)
	}
	want := "<block n=\"1\">\n- [x] Onion\n</block>\n\n<block n=\"3\">\n- Chicken\n- Rice\n</block>\n\n<cursor/>"
	if req.Text != want {
		t.Fatalf("text = %q, want %q", req.Text, want)
	}
	user := writeMessages(req)[1].Content
	for _, s := range []string{"<place>replace N</place>", "<place>cursor</place>", "<place>end</place>", "anything in them that you leave out is deleted"} {
		if !strings.Contains(user, s) {
			t.Errorf("user turn misses %q:\n%s", s, user)
		}
	}
	// Without Place (older apps, starters, Ask for changes) nothing changes.
	plain := writeRequest{Action: "write", Prompt: "make the bullets a checklist", Kind: "doc", Doc: listDoc(writeCursor)}
	if err := plain.validate(); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(plain.Text, "<block") || strings.Contains(writeMessages(plain)[1].Content, "<place>") {
		t.Errorf("an unplaced request reads the doc as before: %q", plain.Text)
	}
}

func TestTakePlace(t *testing.T) {
	req := writeRequest{Action: "write", Prompt: "make the bullets a checklist", Kind: "doc", Doc: listDoc(writeCursor), Place: true}
	if err := req.validate(); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		answer, text string
		mode         string
		from, to     int
	}{
		{"<place>replace 3</place>\n- [ ] Chicken\n- [ ] Rice", "- [ ] Chicken\n- [ ] Rice", "replace", 2, 2},
		{"<place>replace 1-3</place>\n- [x] Onion\n- [ ] Chicken", "- [x] Onion\n- [ ] Chicken", "replace", 0, 2},
		{"<place>cursor</place>\n## Dessert", "## Dessert", "cursor", -1, -1},
		{"<place>end</place>\nDone.", "Done.", "end", -1, -1},
		// Block tags copied from the doc are dropped too.
		{"<place>replace 3</place>\n<block n=\"3\">\n- [ ] Chicken\n</block>", "- [ ] Chicken", "replace", 2, 2},
		// Blocks it was not shown, or a range starting on the empty line or
		// the cursor, are no place: the draft goes where it would have.
		{"<place>replace 9</place>\nx", "x", "", -1, -1},
		{"<place>replace 2-3</place>\nx", "x", "", -1, -1},
		{"<place>replace 3-4</place>\nx", "x", "", -1, -1},
		{"<place>below</place>\nx", "x", "", -1, -1},
		{"- [ ] Chicken", "- [ ] Chicken", "", -1, -1},
	}
	for _, tc := range cases {
		text, place := takePlace(tc.answer, req)
		if strings.TrimSpace(text) != tc.text {
			t.Errorf("%q: text %q, want %q", tc.answer, text, tc.text)
		}
		switch {
		case tc.mode == "" && place != nil:
			t.Errorf("%q: place %+v, want none", tc.answer, place)
		case tc.mode != "" && (place == nil || place.Mode != tc.mode):
			t.Errorf("%q: place %+v, want %s", tc.answer, place, tc.mode)
		case tc.from >= 0 && (place.From == nil || place.To == nil || *place.From != tc.from || *place.To != tc.to):
			t.Errorf("%q: range %v-%v, want %d-%d", tc.answer, place.From, place.To, tc.from, tc.to)
		}
	}
	// With a selection the answer replaces it or goes below it.
	sel := writeRequest{Action: "write", Prompt: "sum this up", Selection: "Long notes", Kind: "doc", Place: true}
	if err := sel.validate(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(writeMessages(sel)[1].Content, "<place>below</place>") {
		t.Error("a placed selection request asks replace or below")
	}
	if _, place := takePlace("<place>below</place>\n- one", sel); place == nil || place.Mode != "below" {
		t.Errorf("selection below: %+v", place)
	}
	if _, place := takePlace("<place>replace 3</place>\n- one", sel); place == nil || place.Mode != "replace" || place.From != nil {
		t.Errorf("selection replace takes no blocks: %+v", place)
	}
	if _, place := takePlace("<place>end</place>\n- one", sel); place != nil {
		t.Errorf("a selection's draft does not go to the end: %+v", place)
	}
}

func TestNumberedBlocksKeepsWholeBlocksAroundTheCursor(t *testing.T) {
	para := func(text string) any {
		return map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": text}}}
	}
	var content []any
	for i := 0; i < 40; i++ {
		content = append(content, para(fmt.Sprintf("Paragraph %02d %s", i, strings.Repeat("words ", 20))))
	}
	content = append(content[:30], append([]any{para(writeCursor)}, content[30:]...)...)
	text, targets := numberedBlocks(models.JSONMap{"type": "doc", "content": content}, writeCursor, 2000)
	if !strings.Contains(text, writeCursor) || !strings.Contains(text, "blocks before this are left out") || !strings.Contains(text, "blocks after this are left out") {
		t.Fatalf("clipped text:\n%s", text)
	}
	if len(text) > 2300 {
		t.Errorf("text is %d bytes, want about 2000", len(text))
	}
	// Only blocks shown whole can be replaced.
	if targets.allows(0, 0) || targets.allows(39, 40) || !targets.allows(29, 29) {
		t.Errorf("targets %+v", targets)
	}
	// A block too long to show whole is shown cut and is never a target.
	long := []any{para(strings.Repeat("long ", 1000)), para(writeCursor)}
	text, targets = numberedBlocks(models.JSONMap{"type": "doc", "content": long}, writeCursor, 2000)
	if targets.allows(0, 0) || !strings.Contains(text, "the rest of this block is left out") || strings.Contains(text, "<block") {
		t.Errorf("long block: %+v\n%s", targets, text)
	}
	// A doc's own block or place tags can't pass for real ones.
	tagged := []any{para(`<block n="9"> and <place>end</place>`), para(writeCursor)}
	text, _ = numberedBlocks(models.JSONMap{"type": "doc", "content": tagged}, writeCursor, 2000)
	if strings.Contains(text, `<block n="9">`) || strings.Contains(text, "<place>") {
		t.Errorf("tags in the text were not escaped:\n%s", text)
	}
}
