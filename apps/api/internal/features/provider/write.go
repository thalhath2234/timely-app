package provider

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/chat"
	"timely-api/internal/models"
	"timely-api/internal/richtext"
)

// Help me write: one-shot drafting for docs and task or project descriptions.
// It runs on the account's generative provider (Settings → Agent keys), never
// on TypeSafe, which only answers typed questions.

// writeActions maps each action to the instruction the model gets. "write"
// and the actions that need a selection are checked in writeRequest.validate.
var writeActions = map[string]string{
	"write":     "Write what the user asks for.",
	"continue":  "Continue the text from where it ends. Match its voice, language and formatting, and do not repeat what is already there. When it ends with a list or checklist, carry on with more items of that same kind.",
	"describe":  "Write a short, useful description for this item from its title and any notes: what it is, why it matters and what done looks like. Use a few short paragraphs or a short checklist of steps, whichever fits.",
	"improve":   "Rewrite the selected text so it reads clearly and naturally. Keep its meaning, facts, language and formatting.",
	"shorter":   "Rewrite the selected text so it is noticeably shorter. Keep the key points and its language.",
	"longer":    "Expand the selected text with useful detail. Keep its meaning, voice and language.",
	"fix":       "Fix spelling, grammar and punctuation in the selected text. Change nothing else.",
	"steps":     "Turn the selected text into a Markdown checklist of clear, actionable steps (\"- [ ] ...\").",
	"summarize": "Summarize the text in a few short bullet points.",
}

const writeSystem = `You are the writing helper inside Timely, a planner with tasks, projects and docs.
Reply with only the text to put into the editor, as Markdown: headings, lists, "- [ ]" checklists, tables, bold and links are all fine.
The current text is the editor's content as Markdown. Lines starting "- [ ]" or "- [x]" are checklist items with tick boxes; write checklist items exactly that way, never "- []" or "[ ]" inside a plain bullet.
No preamble, no closing remarks, no notes about what you changed, and do not wrap the answer in a code block.
Write in the language of the user's text unless they ask for another one.
The current text is context: do not repeat it in your answer unless the task is to rewrite it.`

// writeCursor is typed into the doc where the draft goes (WRITE_CURSOR in
// packages/contract/src/helpMeWrite.ts); the model sees it as cursorTag.
const (
	writeCursor = "TIMELYWRITECURSOR"
	cursorTag   = "<cursor/>"
)

// cursorLine is a line holding only the cursor, alone or as a list item;
// tagLine is the same line with the tag the model sees, copied back.
var (
	cursorLine = regexp.MustCompile(`(?m)^[ \t]*(?:[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)?` + writeCursor + `[ \t]*(?:\n|$)`)
	tagLine    = regexp.MustCompile(`(?m)^[ \t]*(?:[-*+][ \t]+(?:\[[ xX]?\][ \t]*)?|\d+[.)][ \t]+)?` + regexp.QuoteMeta(cursorTag) + `[ \t]*(?:\n|$)`)
)

const (
	writeMaxText   = 12000
	writeMaxPrompt = 2000
	// writeMaxWhole is how much of a long doc a summary or description reads:
	// all of most docs. A longer one is read from its start and its end, cut
	// between blocks, and the answer says so (writeResponse.Shortened).
	writeMaxWhole = 60000
	// writeContinueHead is how much of the start Continue writing keeps of
	// a long doc, for its title and voice; the rest of writeMaxText is the end
	// it carries on from.
	writeContinueHead = 2000
	// writeMaxSelection is the most selected text (as Markdown) a rewrite
	// takes, WRITE_MAX_SELECTION in packages/contract/src/helpMeWrite.ts. A
	// longer selection is refused, never cut: Replace puts the answer over
	// the whole selection, so a rewrite of part of it would delete the rest.
	writeMaxSelection = 20000
	// writeTooLong is WRITE_TOO_LONG in the contract.
	writeTooLong = "That's too much text to rewrite at once. Select up to about 3,000 words and try again."
)

type writeRequest struct {
	Action    string `json:"action"`
	Prompt    string `json:"prompt"`
	Selection string `json:"selection"`
	// SelectionDoc is the selected part of the editor's content as a doc,
	// read as Markdown in place of Selection, so the model sees the links,
	// @mentions, tick boxes and tables it holds and can keep them. Apps from
	// before it send only Selection, the plain text.
	SelectionDoc models.JSONMap `json:"selectionDoc"`
	// Kind is "doc", "task" or "project"; Title and Text describe what is open.
	Kind  string `json:"kind"`
	Title string `json:"title"`
	Text  string `json:"text"`
	// Doc is the editor's content with writeCursor where the draft goes. It
	// replaces Text as Markdown, so the model sees checklists and headings;
	// apps from before it send only Text.
	Doc models.JSONMap `json:"doc"`
	// cursor: Text shows where the draft goes, as cursorTag.
	cursor bool
	// rich: Selection is Markdown read from SelectionDoc.
	rich bool
	// shortened: Text is a long doc's start and end, its middle left out.
	shortened bool
}

type writeResponse struct {
	Text     string `json:"text"`
	Provider string `json:"provider"`
	Model    string `json:"model"`
	// Shortened: the doc was too long to read whole, so the draft (a
	// summary, description or continuation) comes from its start and end.
	Shortened bool `json:"shortened,omitempty"`
}

func (r *writeRequest) validate() error {
	r.Action = strings.TrimSpace(r.Action)
	if r.Action == "" {
		r.Action = "write"
	}
	if _, ok := writeActions[r.Action]; !ok {
		return fmt.Errorf("Unknown writing action %q", r.Action)
	}
	r.Prompt = clipHead(strings.TrimSpace(r.Prompt), writeMaxPrompt)
	if r.SelectionDoc != nil {
		if markdown := strings.TrimSpace(richtext.ToMarkdown(r.SelectionDoc)); markdown != "" {
			r.Selection, r.rich = markdown, true
		}
		r.SelectionDoc = nil
	}
	r.Selection = strings.TrimSpace(r.Selection)
	if len(r.Selection) > writeMaxSelection {
		return errors.New(writeTooLong)
	}
	r.Title = clipHead(strings.TrimSpace(r.Title), 300)
	fromDoc := r.Doc != nil
	if fromDoc {
		r.Text = richtext.ToMarkdown(r.Doc)
		r.Doc = nil
	}
	// Only a draft written at the caret goes to the cursor: a rewrite has its
	// selection, Continue writes at the end, and a summary or description is
	// about the whole text. The editor types the cursor once; plain text from
	// older apps has none. A doc holding only the cursor line is empty, but a
	// lone list item still says what kind of list the draft goes into.
	keep := fromDoc && r.Action == "write" && r.Selection == "" && strings.Count(r.Text, writeCursor) == 1 &&
		strings.TrimSpace(r.Text) != writeCursor
	if !keep {
		r.Text = dropCursor(r.Text)
	}
	// A summary or description is about the whole doc and Continue writing
	// about its end, so a long doc keeps its start and end, cut between
	// blocks, never a stretch starting mid-sentence.
	switch {
	case r.Selection == "" && (r.Action == "summarize" || r.Action == "describe"):
		r.Text, r.shortened = clipEnds(strings.TrimSpace(r.Text), writeMaxWhole, writeMaxWhole/2)
	case r.Action == "continue":
		r.Text, r.shortened = clipEnds(strings.TrimSpace(r.Text), writeMaxText, writeContinueHead)
	default:
		r.Text = clipAround(strings.TrimSpace(r.Text), writeCursor, writeMaxText)
	}
	if r.cursor = strings.Contains(r.Text, writeCursor); r.cursor {
		// A tag already in the doc's own text is not the spot.
		r.Text = strings.ReplaceAll(strings.ReplaceAll(r.Text, cursorTag, "&lt;cursor/&gt;"), writeCursor, cursorTag)
	}
	switch r.Action {
	case "write":
		if r.Prompt == "" {
			return fmt.Errorf("Say what to write")
		}
	case "improve", "shorter", "longer", "fix", "steps":
		if r.Selection == "" {
			return fmt.Errorf("Select some text first")
		}
	case "continue":
		if r.Text == "" {
			return fmt.Errorf("There is nothing to continue yet")
		}
	case "summarize":
		if r.Selection == "" && r.Text == "" {
			return fmt.Errorf("There is nothing to summarize yet")
		}
	case "describe":
		if r.Title == "" && r.Text == "" {
			return fmt.Errorf("Give it a title first")
		}
	}
	return nil
}

// writeMessages builds the system and user turns for one request.
func writeMessages(r writeRequest) []chat.WireMessage {
	kind := map[string]string{"doc": "doc", "task": "task description", "project": "project description"}[r.Kind]
	if kind == "" {
		kind = "doc"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Task: %s\n", writeActions[r.Action])
	if r.Kind == "task" || r.Kind == "project" {
		b.WriteString("Keep it compact: this goes into a description field, not a long document.\n")
	}
	fmt.Fprintf(&b, "\nThe user is editing a %s", kind)
	if r.Title != "" {
		fmt.Fprintf(&b, " titled %q", r.Title)
	}
	b.WriteString(".\n")
	if r.Text != "" && !(r.Action == "summarize" && r.Selection != "") {
		fmt.Fprintf(&b, "\n<current_text>\n%s\n</current_text>\n", r.Text)
		if r.shortened {
			b.WriteString("The current text is long, so its middle is left out where it says so. Work from the start and the end you have.\n")
		}
	}
	if r.Selection != "" {
		fmt.Fprintf(&b, "\n<selected_text>\n%s\n</selected_text>\n", r.Selection)
		rewrite := r.Action == "improve" || r.Action == "shorter" || r.Action == "longer" || r.Action == "fix"
		if !strings.Contains(r.Selection, "\n") && rewrite {
			b.WriteString("The selection is a single line, so answer with a single paragraph: no headings, list markers or checkboxes.\n")
		}
		if r.rich {
			b.WriteString("The selected text is Markdown from the editor. Keep every link and every @mention link ([@Name](timely://...)) exactly as written.")
			if rewrite {
				b.WriteString(" Keep its shape: the same headings, list items, ticked and unticked boxes and table rows and columns.")
			}
			b.WriteString("\n")
		}
	}
	if r.cursor {
		b.WriteString("\n" + cursorTag + " in the current text marks where your answer goes; fit it to that spot and do not write the tag. ")
		b.WriteString("When " + cursorTag + " is a list item, answer with only items of that same kind of list, one per line, with no heading or intro: \"- [ ] item\" for a checklist, \"- item\" for bullets, \"1. item\" for a numbered list.\n")
	}
	if r.Prompt != "" {
		fmt.Fprintf(&b, "\n<request>\n%s\n</request>\n", r.Prompt)
	}
	return []chat.WireMessage{{Role: "system", Content: writeSystem}, {Role: "user", Content: b.String()}}
}

var wholeFence = regexp.MustCompile("(?s)^```[a-zA-Z]*\\n(.*)\\n```$")

// cleanWritten drops a code fence wrapped around the whole answer, which some
// models add despite being told not to, and, when the doc showed one, a
// cursor tag copied from it, with its line when the tag stood alone there.
func cleanWritten(s string, cursor bool) string {
	if cursor {
		s = strings.ReplaceAll(tagLine.ReplaceAllString(s, ""), cursorTag, "")
	}
	s = strings.TrimSpace(s)
	if m := wholeFence.FindStringSubmatch(s); m != nil {
		s = strings.TrimSpace(m[1])
	}
	return s
}

func clipHead(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return strings.ToValidUTF8(s[:n], "")
}

// dropCursor takes the cursor out of the text, with its line when it stood
// alone there or as a list item of its own.
func dropCursor(s string) string {
	return strings.ReplaceAll(cursorLine.ReplaceAllString(s, ""), writeCursor, "")
}

// clipAround keeps n bytes of a long text around the cursor, most of them
// before it, so the model sees what leads up to the spot the draft goes.
// Without a cursor it keeps the end, as clipTail does.
func clipAround(s, cursor string, n int) string {
	at := strings.Index(s, cursor)
	if at < 0 || len(s) <= n {
		return clipTail(s, n)
	}
	start := max(0, at-n*3/4)
	end := min(len(s), start+n)
	return strings.ToValidUTF8(s[max(0, end-n):end], "")
}

// clipEnds keeps a long text's first head bytes and its last n-head bytes,
// each cut where a block (a blank line) or else a line starts, with a note
// of how many words were left out between them. ok reports a cut.
func clipEnds(s string, n, head int) (string, bool) {
	if len(s) <= n {
		return s, false
	}
	tail := n - head
	front := s[:head]
	if i := strings.LastIndex(front, "\n\n"); i > head/2 {
		front = front[:i]
	} else if i := strings.LastIndex(front, "\n"); i > head/2 {
		front = front[:i]
	}
	back := s[len(s)-tail:]
	if i := strings.Index(back, "\n\n"); i >= 0 && i < tail/2 {
		back = back[i+2:]
	} else if i := strings.Index(back, "\n"); i >= 0 && i < tail/2 {
		back = back[i+1:]
	}
	words := len(strings.Fields(s[len(front) : len(s)-len(back)]))
	front = strings.TrimSpace(strings.ToValidUTF8(front, ""))
	back = strings.TrimSpace(strings.ToValidUTF8(back, ""))
	return fmt.Sprintf("%s\n\n[… %d words left out here …]\n\n%s", front, words, back), true
}

// clipTail keeps the end of a long text.
func clipTail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return strings.ToValidUTF8(s[len(s)-n:], "")
}

func (s *Service) write(c *echo.Context) error {
	var req writeRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(400, "Invalid request")
	}
	if err := req.validate(); err != nil {
		return echo.NewHTTPError(400, err.Error())
	}
	ctx := c.Request().Context()
	row, err := s.load(s.db, user(c))
	if err != nil {
		return err
	}
	provider, err := s.defaultProvider(ctx, row)
	if err != nil {
		return err
	}
	if provider == "" {
		return echo.NewHTTPError(409, "Help me write needs an AI provider. Add a key in Settings → Agent keys")
	}
	completer, err := s.Completer(ctx, user(c), provider, "")
	if err != nil {
		return echo.NewHTTPError(409, err.Error())
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	reply, err := completer.Complete(ctx, writeMessages(req), nil, false)
	if err != nil {
		return echo.NewHTTPError(502, err.Error())
	}
	text := cleanWritten(reply.Content, req.cursor)
	if text == "" {
		return echo.NewHTTPError(502, "The AI returned an empty answer. Try again")
	}
	_, model, _ := s.resolveModel(ctx, user(c), provider)
	return c.JSON(200, writeResponse{Text: text, Provider: provider, Model: model, Shortened: req.shortened})
}

// resolveModel reports the model a provider runs for this account.
func (s *Service) resolveModel(ctx context.Context, userID, provider string) (string, string, error) {
	row, err := s.load(s.db.WithContext(ctx), userID)
	if err != nil {
		return provider, "", err
	}
	if spec := apiProviderByID(provider); spec != nil {
		api, _, err := s.apiRow(s.db.WithContext(ctx), userID, provider)
		return provider, api.Model, err
	}
	return provider, s.chatModel(row, provider), nil
}
