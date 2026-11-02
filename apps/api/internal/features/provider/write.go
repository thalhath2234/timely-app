package provider

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

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
	"continue":  "Continue the text from where it ends. Match its voice, language and formatting, and do not repeat what is already there. When it ends with a list or checklist, carry on with more items of that same kind. " + writeNoInvent,
	"describe":  "Write a short, useful description for this item from its title and any notes: what it is and what done looks like. Use a few short paragraphs or a short checklist of steps, whichever fits. " + writeNoInvent,
	"improve":   "Rewrite the selected text so it reads clearly and naturally. Keep its meaning, facts, language and formatting.",
	"shorter":   "Rewrite the selected text so it is noticeably shorter. Keep the key points and its language.",
	"longer":    "Expand the selected text with useful detail. Keep its meaning, voice and language.",
	"fix":       "Fix spelling, grammar and punctuation in the selected text. Change nothing else.",
	"steps":     "Turn the selected text into a Markdown checklist of clear, actionable steps (\"- [ ] ...\").",
	"summarize": "Summarize the text in a few short bullet points.",
}

// writeNoInvent keeps Describe and Continue to what the item or text says.
const writeNoInvent = "Use only what the title, notes and text say: do not invent facts, names, dates, times, numbers or places. Leave out a detail you do not know rather than make one up."

const writeSystem = `You are the writing helper inside Timely, a planner with tasks, projects and docs.
Reply with only the text to put into the editor, as Markdown: headings, lists, "- [ ]" checklists, tables, bold and links are all fine.
The current text is the editor's content as Markdown. Lines starting "- [ ]" or "- [x]" are checklist items with tick boxes; write checklist items exactly that way, never "- []" or "[ ]" inside a plain bullet.
No preamble, no closing remarks, no notes about what you changed, and never show how you worked something out, such as a date: write only the result. Do not wrap the answer in a code block.
Write in the language of the user's text unless they ask for another one.
The current text is context: do not repeat it in your answer unless the task is to rewrite it.
If you will not write what is asked, reply with only "` + writeDeclined + `" and one short sentence on why, in the user's language.`

// writeCursor is typed into the doc where the draft goes (WRITE_CURSOR in
// packages/contract/src/helpMeWrite.ts); the model sees it as cursorTag. The
// editors add random capital letters to it for each request (cursorMark), so
// a doc that holds the word itself keeps it and the real spot is still found.
const (
	writeCursor = "TIMELYWRITECURSOR"
	cursorTag   = "<cursor/>"
	// writeDeclined opens an answer the model will not write (writeSystem).
	writeDeclined = "CANNOT_WRITE:"
)

var (
	// cursorMarkRe is a per-request cursor (writeCursorMark in the contract).
	cursorMarkRe = regexp.MustCompile(`^` + writeCursor + `[A-Z]{6,24}$`)
	// tagLine is a line holding only the tag the model sees, alone or as a
	// list item, copied back; inlineTag is the tag inside a line.
	tagLine   = regexp.MustCompile(`(?m)^[ \t]*(?:[-*+][ \t]+(?:\[[ xX]?\][ \t]*)?|\d+[.)][ \t]+)?` + regexp.QuoteMeta(cursorTag) + `[ \t]*(?:\n|$)`)
	inlineTag = regexp.MustCompile(`([ \t]?)` + regexp.QuoteMeta(cursorTag) + `([ \t]?)`)
)

// cursorLine is a line holding only the cursor mark, alone or as a list item.
func cursorLine(mark string) *regexp.Regexp {
	return regexp.MustCompile(`(?m)^[ \t]*(?:[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)?` + regexp.QuoteMeta(mark) + `[ \t]*(?:\n|$)`)
}

const (
	writeMaxText = 12000
	// writeMaxPrompt and writeMaxTitle are characters, not bytes:
	// WRITE_MAX_PROMPT in the contract is the prompt box's maxLength.
	writeMaxPrompt = 2000
	writeMaxTitle  = 300
	// writeRewriteContext is how much of the doc on each side of the
	// selection a rewrite reads: the selection is what it changes, and the
	// text around it only sets the voice.
	writeRewriteContext = 1000
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
	// writeTooLong and writeTooLongSummary are writeTooLong(action) in the contract.
	writeTooLong        = "That's too much text to rewrite at once. Select up to about 3,000 words and try again."
	writeTooLongSummary = "That's too much text to summarize at once. Select up to about 3,000 words and try again."
	// writeSelectionMark stands for the selection in the text around it.
	writeSelectionMark = "<selected_text/>"
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
	// CursorMark is the cursor the editor typed into Doc for this request;
	// apps from before it type writeCursor itself.
	CursorMark string `json:"cursorMark"`
	// Place: the person typed what to do, so the model also says where its
	// answer goes (writePlace): over the blocks it rewrites, at the cursor or
	// at the end, or with a selection over it or below it. A request to
	// change text already there ("make these bullets a checklist") then
	// replaces that text instead of adding a second copy.
	Place bool `json:"place"`
	// cursor: Text shows where the draft goes, as cursorTag.
	cursor bool
	// around: Text is the doc around the selection, with writeSelectionMark
	// where the selection is.
	around bool
	// today is the date and zone the model is told ("Sunday 2026-11-01 (Europe/Lisbon)").
	today string
	// rich: Selection is Markdown read from SelectionDoc.
	rich bool
	// shortened: Text is a long doc's start and end, its middle left out.
	shortened bool
	// blocks: Text is the doc as numbered blocks (numberedBlocks), and the
	// model is asked where its answer goes; targets are the blocks it may
	// name, by their index in Doc.
	blocks  bool
	targets blockTargets
	// placeSelection: the model is asked whether its answer replaces the
	// selection or goes below it.
	placeSelection bool
}

type writeResponse struct {
	Text     string `json:"text"`
	Provider string `json:"provider"`
	Model    string `json:"model"`
	// Shortened: the doc was too long to read whole, so the draft (a
	// summary, description or continuation) comes from its start and end.
	Shortened bool `json:"shortened,omitempty"`
	// Place is where the model says the draft goes, for a request with
	// Place set; absent when it did not say, and the draft goes where it
	// would have without it.
	Place *writePlace `json:"place,omitempty"`
}

// writePlace is where a draft goes (WritePlace in
// packages/contract/src/helpMeWrite.ts):
//   - "replace" with From and To: in place of the doc's top-level blocks
//     From to To, their indices in the doc as sent (cursor line included);
//   - "replace" alone: in place of the selection;
//   - "below": below the selection, which stays;
//   - "cursor": where the cursor was typed; "end": at the end of the text.
type writePlace struct {
	Mode string `json:"mode"`
	From *int   `json:"from,omitempty"`
	To   *int   `json:"to,omitempty"`
}

func (r *writeRequest) validate() error {
	r.Action = strings.TrimSpace(r.Action)
	if r.Action == "" {
		r.Action = "write"
	}
	if _, ok := writeActions[r.Action]; !ok {
		return fmt.Errorf("Unknown writing action %q", r.Action)
	}
	r.Prompt = clipRunes(strings.TrimSpace(r.Prompt), writeMaxPrompt)
	mark := writeCursor
	if cursorMarkRe.MatchString(r.CursorMark) {
		mark = r.CursorMark
	}
	if r.SelectionDoc != nil {
		if markdown := strings.TrimSpace(richtext.ToMarkdown(r.SelectionDoc)); markdown != "" {
			r.Selection, r.rich = markdown, true
		}
		r.SelectionDoc = nil
	}
	r.Selection = strings.TrimSpace(r.Selection)
	if len(r.Selection) > writeMaxSelection {
		if r.Action == "summarize" {
			return errors.New(writeTooLongSummary)
		}
		return errors.New(writeTooLong)
	}
	r.Title = clipRunes(strings.TrimSpace(r.Title), writeMaxTitle)
	fromDoc := r.Doc != nil
	r.blocks = fromDoc && r.Place && r.Action == "write" && r.Prompt != "" && r.Selection == ""
	r.placeSelection = r.Place && r.Action == "write" && r.Prompt != "" && r.Selection != ""
	if r.blocks {
		r.Text, r.targets = numberedBlocks(r.Doc, mark, writeMaxText)
		r.Doc = nil
	} else if fromDoc {
		r.Text = richtext.ToMarkdown(r.Doc)
		r.Doc = nil
	}
	// Only a draft written at the caret goes to the cursor: a rewrite has its
	// selection, Continue writes at the end, and a summary or description is
	// about the whole text. The editor types the cursor once; plain text from
	// older apps has none. A doc holding only the cursor line is empty, but a
	// lone list item still says what kind of list the draft goes into.
	keep := fromDoc && r.Action == "write" && r.Selection == "" && strings.Count(r.Text, mark) == 1 &&
		strings.TrimSpace(r.Text) != mark
	if !keep {
		r.Text = dropCursor(r.Text, mark)
	}
	// A summary or description is about the whole doc and Continue writing
	// about its end, so a long doc keeps its start and end, cut between
	// blocks, never a stretch starting mid-sentence.
	switch {
	case r.Selection == "" && (r.Action == "summarize" || r.Action == "describe"):
		r.Text, r.shortened = clipEnds(strings.TrimSpace(r.Text), writeMaxWhole, writeMaxWhole/2)
	case r.Action == "continue":
		r.Text, r.shortened = clipEnds(strings.TrimSpace(r.Text), writeMaxText, writeContinueHead)
	case r.Selection != "" && isRewrite(r.Action):
		// A rewrite sends its selection; of the doc only the text around it.
		r.Text, r.around = aroundSelection(strings.TrimSpace(r.Text), r.Selection, writeRewriteContext)
	case r.blocks:
		// numberedBlocks kept whole blocks around the cursor already.
		r.Text = strings.TrimSpace(r.Text)
	default:
		r.Text = clipAround(strings.TrimSpace(r.Text), mark, writeMaxText)
	}
	if r.cursor = strings.Contains(r.Text, mark); r.cursor {
		// A tag already in the doc's own text is not the spot.
		r.Text = strings.ReplaceAll(strings.ReplaceAll(r.Text, cursorTag, "&lt;cursor/&gt;"), mark, cursorTag)
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
	if r.today != "" {
		fmt.Fprintf(&b, "Today is %s.\n", r.today)
	}
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
		if r.around {
			b.WriteString("This is the text around the selection; " + writeSelectionMark + " marks where the selected text sits in it.\n")
		}
	}
	if r.Selection != "" {
		fmt.Fprintf(&b, "\n<selected_text>\n%s\n</selected_text>\n", r.Selection)
		rewrite := isRewrite(r.Action) && r.Action != "steps"
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
	switch {
	case r.blocks:
		b.WriteString(writePlaceBlocks)
		if r.cursor {
			b.WriteString("When your answer goes at " + cursorTag + " and " + cursorTag + " is a list item, answer with only items of that same kind of list, one per line, with no heading or intro: \"- [ ] item\" for a checklist, \"- item\" for bullets, \"1. item\" for a numbered list.\n")
		}
	case r.cursor:
		b.WriteString("\n" + cursorTag + " in the current text marks where your answer goes; fit it to that spot and do not write the tag. ")
		b.WriteString("When " + cursorTag + " is a list item, answer with only items of that same kind of list, one per line, with no heading or intro: \"- [ ] item\" for a checklist, \"- item\" for bullets, \"1. item\" for a numbered list.\n")
	case r.placeSelection:
		b.WriteString(writePlaceSelection)
	}
	if r.Prompt != "" {
		fmt.Fprintf(&b, "\n<request>\n%s\n</request>\n", r.Prompt)
	}
	return []chat.WireMessage{{Role: "system", Content: writeSystem}, {Role: "user", Content: b.String()}}
}

// writePlaceBlocks asks a draft written from a typed request where it goes,
// as the first line of the answer (takePlace reads it).
const writePlaceBlocks = `
The current text is split into numbered blocks, <block n="1"> and so on, and ` + cursorTag + ` marks where the user's cursor is.
Decide where your answer goes, and start your reply with one tag on a line of its own:
- <place>replace N</place>, or <place>replace N-M</place> for blocks N to M in a row, when the request changes text that is already there: convert, reformat, rewrite, reorder, sort, translate, fix, or tick or untick items. Your answer takes the place of those blocks, so write their whole new version: anything in them that you leave out is deleted. Keep every item, tick box, link and detail the request does not ask to change. Name only the blocks the request is about.
- <place>cursor</place> when the request asks for new text: it goes at ` + cursorTag + `.
- <place>end</place> when the request asks for new text at the end of the text.
After the tag, write only the text, without block tags or ` + cursorTag + `.
`

// writePlaceSelection asks a draft for a selection whether it rewrites the
// selection or adds to it.
const writePlaceSelection = `
Decide where your answer goes, and start your reply with one tag on a line of its own:
- <place>replace</place> when your answer is a new version of the selected text: it takes the selection's place.
- <place>below</place> when your answer is something new about it, such as a summary, a reply, an example or more items: it goes below the selected text, which stays.
After the tag, write only the text.
`

func isRewrite(action string) bool {
	return action == "improve" || action == "shorter" || action == "longer" || action == "fix" || action == "steps"
}

var (
	// fenceLine opens or closes a code block; its group is the language.
	fenceLine = regexp.MustCompile("^ {0,3}```[ \\t]*([^`\\s]*)[ \\t]*$")
	// chatOpener is a line a model opens its answer with ("Sure! Here is
	// the list:"), and chatCloser one it ends with ("Let me know if...").
	// A "Here are..." line counts only when it talks about the answer
	// itself (a draft, a shorter version): "Here are the next steps:" or
	// "Here's what we agreed:" is the text, as in a continued doc.
	chatOpener = regexp.MustCompile(`(?i)^(?:(?:sure|certainly|of course|absolutely|okay|ok)\b.{0,160}|here(?:'s|’s| is| are)\b.{0,160}\b(?:version|draft|rewrite|rewritten|revised|polished|corrected|summary|continuation|description|checklist|list|suggestions?|ideas|options)\b.{0,80}):$`)
	chatCloser = regexp.MustCompile(`(?i)^(?:let me know|i hope|hope this|feel free|would you like|do you want|want me to|if you(?:'d|’d| would) like|happy to)\b.{0,200}$`)
)

// proseFences are the languages a whole answer may come wrapped in; a fence
// with a code language is a code block and is kept.
var proseFences = map[string]bool{"": true, "markdown": true, "md": true, "text": true, "txt": true, "plaintext": true}

// cleanWritten drops what the model wraps around the text despite being
// told not to: a Markdown (or plain) code fence around the whole answer, an
// opening line ("Sure! Here is the list:") and a closing offer ("Let me know
// if...") around it. With cursor, it also drops a cursor tag copied from the
// doc, with its line when the tag stood alone there. A code block with a
// code language, or more than one, is the answer and stays as it is.
func cleanWritten(s string, cursor bool) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	if cursor {
		s = tagLine.ReplaceAllString(s, "")
		s = inlineTag.ReplaceAllStringFunc(s, func(tag string) string {
			if m := inlineTag.FindStringSubmatch(tag); m[1] != "" && m[2] != "" {
				return " "
			}
			return strings.ReplaceAll(tag, cursorTag, "")
		})
	}
	s = strings.TrimSpace(s)
	lines := strings.Split(s, "\n")
	opened := len(lines) > 2 && chatOpener.MatchString(strings.TrimSpace(lines[0])) && strings.TrimSpace(lines[1]) == ""
	if opened {
		lines = lines[2:]
	}
	var fences []int
	for i, line := range lines {
		if fenceLine.MatchString(line) {
			fences = append(fences, i)
		}
	}
	// One prose fence, with at most a closing offer after it.
	if len(fences) == 2 && fences[0] == 0 && fenceLine.FindStringSubmatch(lines[fences[1]])[1] == "" &&
		proseFences[strings.ToLower(fenceLine.FindStringSubmatch(lines[0])[1])] {
		after := strings.TrimSpace(strings.Join(lines[fences[1]+1:], "\n"))
		if after == "" || (!strings.Contains(after, "\n") && chatCloser.MatchString(after)) {
			return strings.TrimSpace(strings.Join(lines[1:fences[1]], "\n"))
		}
	}
	if opened {
		// A chatty opening usually comes with a closing offer.
		if n := len(lines); n > 2 && strings.TrimSpace(lines[n-2]) == "" && chatCloser.MatchString(strings.TrimSpace(lines[n-1])) {
			lines = lines[:n-2]
		}
		return strings.TrimSpace(strings.Join(lines, "\n"))
	}
	return s
}

// declinedOnly is an answer that is only a refusal, written as text.
var declinedOnly = regexp.MustCompile(`(?i)^(?:i(?:'|’)?m sorry,?\s*(?:but\s+)?)?i\s*(?:can(?:'|’)?t|cannot|won(?:'|’)?t|am not able to|(?:'|’)m not able to|am unable to|(?:'|’)m unable to)\s+(?:help|assist)\s+with\s+(?:that|this)(?:\s+request)?\s*[.!]?$`)

// declined reports the reason when the answer is a refusal: the marker the
// system prompt asks for, or a bare "I can't help with that.".
func declined(text string) (string, bool) {
	if rest, ok := strings.CutPrefix(text, writeDeclined); ok {
		return strings.TrimSpace(rest), true
	}
	if !strings.Contains(text, "\n") && declinedOnly.MatchString(text) {
		return "", true
	}
	return "", false
}

// timelyLink is a Markdown link into Timely, which the editors show as an
// @mention chip or a page link.
var timelyLink = regexp.MustCompile(`\[([^\]\n]*)\]\((timely://[^)\s]+)\)`)

// keepKnownLinks turns a link into Timely that the request never held into
// its plain words: the model can only copy real ones, so any other is made
// up and would become a chip to nothing.
func keepKnownLinks(text, sent string) string {
	return timelyLink.ReplaceAllStringFunc(text, func(link string) string {
		m := timelyLink.FindStringSubmatch(link)
		if strings.Contains(sent, "("+m[2]+")") {
			return link
		}
		return m[1]
	})
}

// dropRepeatedLead drops the answer's first line when it repeats the line
// right before the cursor, which Insert would put in the doc twice.
func dropRepeatedLead(answer, text string) string {
	at := strings.Index(text, cursorTag)
	if at < 0 {
		return answer
	}
	// In numbered blocks (numberedBlocks) the line before is the block's
	// last line, not its closing tag.
	before := strings.Split(strings.TrimRight(blockTagLine.ReplaceAllString(text[:at], ""), " \t\n"), "\n")
	last := strings.TrimSpace(before[len(before)-1])
	first, rest, ok := strings.Cut(answer, "\n")
	if !ok || last == "" || strings.TrimSpace(first) != last {
		return answer
	}
	return strings.TrimSpace(rest)
}

func clipHead(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return strings.ToValidUTF8(s[:n], "")
}

// clipRunes keeps the first n characters: the limits people see are counted
// in characters, so a request in Malayalam or Hindi keeps as much as one in
// English.
func clipRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

// dropCursor takes the cursor mark out of the text, with its line when it
// stood alone there or as a list item of its own.
func dropCursor(s, mark string) string {
	return strings.ReplaceAll(cursorLine(mark).ReplaceAllString(s, ""), mark, "")
}

// aroundSelection is the doc as a rewrite reads it: up to n bytes on each
// side of the selection, cut at a line, with writeSelectionMark in the
// selection's place, which the model is sent on its own. ok is false, and
// the text empty, when the selection can't be found in it.
func aroundSelection(text, selection string, n int) (string, bool) {
	at := strings.Index(text, selection)
	if at < 0 {
		return "", false
	}
	before, after := text[:at], text[at+len(selection):]
	if len(before) > n {
		before = before[len(before)-n:]
		if i := strings.Index(before, "\n"); i >= 0 {
			before = before[i+1:]
		}
		before = "…\n" + strings.ToValidUTF8(before, "")
	}
	if len(after) > n {
		after = after[:n]
		if i := strings.LastIndex(after, "\n"); i >= 0 {
			after = after[:i]
		}
		after = strings.ToValidUTF8(after, "") + "\n…"
	}
	return before + writeSelectionMark + after, true
}

// blockTargets are the doc's top-level blocks a placed draft may replace,
// by index in the doc as sent: lo to hi is the stretch shown to the model,
// numbered the blocks it read whole. A range is allowed only inside that
// stretch, starting and ending on numbered blocks and holding no block the
// model saw cut short.
type blockTargets struct {
	lo, hi   int
	numbered map[int]bool
	cut      map[int]bool
}

// allows reports whether blocks from to to (indices) may be replaced.
func (t blockTargets) allows(from, to int) bool {
	if from > to || from < t.lo || to > t.hi || !t.numbered[from] || !t.numbered[to] {
		return false
	}
	for i := from; i <= to; i++ {
		if t.cut[i] {
			return false
		}
	}
	return true
}

// blockTag is a block tag or place tag written into a doc's own text: it is
// escaped so the model can't take it for the real ones.
var blockTag = regexp.MustCompile(`(?i)<(/?(?:block|place)\b)`)

// numberedBlocks is the doc as a draft that says where it goes reads it:
// each top-level block in <block n="i"> tags, i its index in the doc plus
// one, so the answer can name the blocks it takes the place of. The line
// that holds only the cursor sits between them as the cursor, unnumbered,
// as do the doc's properties; empty lines are left out. A long doc keeps
// whole blocks around the cursor, up to n bytes, three quarters of them
// before it; a block longer than half that is cut and not numbered, so a
// draft never replaces text the model did not read.
func numberedBlocks(doc models.JSONMap, mark string, n int) (string, blockTargets) {
	type part struct {
		index int
		text  string
	}
	targets := blockTargets{numbered: map[int]bool{}, cut: map[int]bool{}}
	var parts []part
	at := -1
	for i, raw := range asList(doc["content"]) {
		node, _ := raw.(map[string]any)
		md := strings.TrimSpace(richtext.ToMarkdown(models.JSONMap{"type": "doc", "content": []any{raw}}))
		if md == "" {
			continue
		}
		if strings.Contains(md, mark) {
			at = len(parts)
		}
		switch {
		case md == mark:
			parts = append(parts, part{i, mark})
		case node != nil && node["type"] == "frontmatter":
			parts = append(parts, part{i, md})
		case len(md) > n/2:
			// Cut to half the room, so it can still show beside the cursor.
			targets.cut[i] = true
			parts = append(parts, part{i, strings.ToValidUTF8(md[:n/2], "") + "\n[… the rest of this block is left out …]"})
		default:
			targets.numbered[i] = true
			parts = append(parts, part{i, fmt.Sprintf("<block n=\"%d\">\n%s\n</block>", i+1, blockTag.ReplaceAllString(md, "&lt;$1"))})
		}
	}
	if len(parts) == 0 {
		return "", targets
	}
	if at < 0 {
		at = len(parts) - 1
	}
	// The cursor's block, then blocks before it up to three quarters of n,
	// then after it up to the rest.
	first, last := at, at
	used := len(parts[at].text)
	for first > 0 && used+len(parts[first-1].text) <= n*3/4 {
		first--
		used += len(parts[first].text)
	}
	for last < len(parts)-1 && used+len(parts[last+1].text) <= n {
		last++
		used += len(parts[last].text)
	}
	for first > 0 && used+len(parts[first-1].text) <= n {
		first--
		used += len(parts[first].text)
	}
	texts := make([]string, 0, last-first+3)
	if first > 0 {
		texts = append(texts, fmt.Sprintf("[… %d blocks before this are left out …]", first))
	}
	for _, p := range parts[first : last+1] {
		texts = append(texts, p.text)
	}
	if last < len(parts)-1 {
		texts = append(texts, fmt.Sprintf("[… %d blocks after this are left out …]", len(parts)-1-last))
	}
	targets.lo, targets.hi = parts[first].index, parts[last].index
	for i := range targets.numbered {
		if i < targets.lo || i > targets.hi {
			delete(targets.numbered, i)
		}
	}
	return strings.Join(texts, "\n\n"), targets
}

func asList(v any) []any {
	list, _ := v.([]any)
	return list
}

var (
	// placeLine is the tag a placed draft opens with: <place>replace 3-5</place>.
	placeLine = regexp.MustCompile(`(?im)^[ \t]*<place>[ \t]*(replace|cursor|end|below)(?:[ \t]+(\d+)(?:[ \t]*[-–][ \t]*(\d+))?)?[ \t]*</place>[ \t]*(?:\n|$)`)
	// blockTagLine is a block tag the model copied from the doc onto its own line.
	blockTagLine = regexp.MustCompile(`(?im)^[ \t]*</?block(?:[ \t]+n="?\d+"?)?[ \t]*>[ \t]*(?:\n|$)`)
)

// takePlace reads where the model says the draft goes and drops the tag
// (and any block tags it copied). The place is nil when it said nothing the
// request allows: a range of blocks it was not shown whole, "replace" with
// no blocks for a doc, a cursor or end for a selection.
func takePlace(text string, r writeRequest) (string, *writePlace) {
	if !r.blocks && !r.placeSelection {
		return text, nil
	}
	if r.blocks {
		text = blockTagLine.ReplaceAllString(text, "")
	}
	m := placeLine.FindStringSubmatchIndex(text)
	if m == nil {
		return text, nil
	}
	group := func(i int) string {
		if m[2*i] < 0 {
			return ""
		}
		return text[m[2*i]:m[2*i+1]]
	}
	mode, from, to := strings.ToLower(group(1)), group(2), group(3)
	text = text[:m[0]] + text[m[1]:]
	if r.placeSelection {
		if mode == "replace" || mode == "below" {
			return text, &writePlace{Mode: mode}
		}
		return text, nil
	}
	switch mode {
	case "cursor", "end":
		return text, &writePlace{Mode: mode}
	case "replace":
		a, err := strconv.Atoi(from)
		if err != nil {
			return text, nil
		}
		b := a
		if to != "" {
			if b, err = strconv.Atoi(to); err != nil {
				return text, nil
			}
		}
		a, b = a-1, b-1
		if !r.targets.allows(a, b) {
			return text, nil
		}
		return text, &writePlace{Mode: "replace", From: &a, To: &b}
	}
	return text, nil
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
	// The model is read with the client, before the slow call: a key removed
	// meanwhile must not leave the answer without the model that wrote it, and
	// a Settings change while it writes does not rename it.
	_, model, _ := s.resolveModel(ctx, user(c), provider)
	req.today = s.today(ctx, user(c))
	ctx, cancel := context.WithTimeout(oneShot(ctx), writeBudget)
	defer cancel()
	reply, err := completer.Complete(ctx, writeMessages(req), nil, false)
	if errors.Is(err, context.DeadlineExceeded) && ctx.Err() != nil {
		return echo.NewHTTPError(504, "The AI took more than 3 minutes to answer. Try again, or ask for something shorter")
	}
	if err != nil {
		return oneShotError(err, "The draft was too long to finish. Ask for something shorter, or split it into parts.")
	}
	text, place := takePlace(strings.ReplaceAll(reply.Content, "\r\n", "\n"), req)
	text = cleanWritten(text, req.cursor)
	if reason, ok := declined(text); ok {
		if reason == "" {
			reason = "Try asking another way."
		}
		return echo.NewHTTPError(422, "The AI declined to write this. "+reason)
	}
	text = keepKnownLinks(text, req.Selection+"\n"+req.Text)
	// A new version of blocks may start with the line the cursor follows:
	// it takes that line's place, so it is not a repeat.
	if req.cursor && (place == nil || place.Mode == "cursor") {
		text = dropRepeatedLead(text, req.Text)
	}
	if text == "" {
		return echo.NewHTTPError(502, "The AI returned an empty answer. Try again")
	}
	return c.JSON(200, writeResponse{Text: text, Provider: provider, Model: model, Shortened: req.shortened, Place: place})
}

// writeBudget is how long Help me write waits for the model. A long draft on
// a slow or local model can take minutes; the panel's Stop ends it sooner.
const writeBudget = 3 * time.Minute

// today is the account's date and zone for the prompt, from Working hours.
func (s *Service) today(ctx context.Context, userID string) string {
	loc := time.UTC
	if hours, err := models.LoadWorkingHours(s.db.WithContext(ctx), userID); err == nil {
		loc = hours.Location(time.UTC)
	}
	now := time.Now().In(loc)
	return fmt.Sprintf("%s %s (%s)", now.Weekday(), now.Format("2006-01-02"), loc.String())
}

// oneShotError words a failed one-shot AI call (Help me write, view
// queries, checklist names, card descriptions) for the person: a timeout and
// an answer cut at the model's limit get their own words; a provider's own
// message is kept.
func oneShotError(err error, tooLong string) error {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return echo.NewHTTPError(504, "The AI took too long to answer. Try again")
	case errors.Is(err, chat.ErrOutputTooLong):
		return echo.NewHTTPError(502, tooLong)
	}
	return echo.NewHTTPError(502, err.Error())
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
