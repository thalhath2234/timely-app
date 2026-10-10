package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"timely-api/internal/features/decide"
)

// Long docs (ADR 0012): when the agent reads a long doc for something in
// particular (get_doc's focus), code splits the markdown into sections by
// heading and Jev answers yes/no per section whether it is about that. The
// relevant sections come back in full and the others as one placeholder line
// naming the doc and the section's hash. Writing the placeholder back keeps
// the section as it was, like the [kept ...] lines of big blocks. With Jev
// off, no focus, a short doc or nothing relevant, the doc comes back whole.

const (
	passageMinDoc     = 12000 // markdown bytes before a doc is worth trimming
	passageMinSection = 600   // shorter sections are always shown
	passageMinSaving  = 2000  // trim only when it leaves out at least this much
	passageMaxAsked   = 40    // sections Jev is asked about; later ones are shown
	passageBudget     = 3 * time.Second
)

// Decider asks Jev; *decide.Service implements it.
type Decider interface {
	Ask(ctx context.Context, userID string, req decide.Request) (decide.Answers, error)
}

var (
	headingRe = regexp.MustCompile(`^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$`)
	fenceRe   = regexp.MustCompile("^ {0,3}(`{3,}|~{3,})")
	sectionRe = regexp.MustCompile(`^\[section kept out ([A-Za-z0-9_-]+)#([0-9a-f]{12})(?::[^\]\n]*)?\]$`)
	// sectionRefRe finds a placeholder anywhere in a line, to catch one the
	// model reformatted (a list marker, backticks, an indent, text around it).
	sectionRefRe = regexp.MustCompile(`\[section kept out [A-Za-z0-9_-]+#`)
)

// docSection is a run of markdown lines starting at a heading (or the text
// before the first heading). Joining every section's Text with "\n" gives
// the doc back exactly.
type docSection struct {
	Heading string
	Text    string
	// Lead is the text before the first heading at the split level, with
	// the doc's title heading if it has one; it is always shown.
	Lead bool
}

// markdownLines tells which lines of src are headings, skipping fenced code
// and the frontmatter at the top. level is 0 for a line that is no heading.
func markdownLines(src string) (lines []string, level []int, title []string) {
	lines = strings.Split(src, "\n")
	level = make([]int, len(lines))
	title = make([]string, len(lines))
	fence := ""
	start := 0
	if len(lines) > 0 && strings.TrimSpace(lines[0]) == "---" {
		for i := 1; i < len(lines); i++ {
			if strings.TrimSpace(lines[i]) == "---" {
				start = i + 1
				break
			}
		}
	}
	for i := start; i < len(lines); i++ {
		line := lines[i]
		if m := fenceRe.FindStringSubmatch(line); m != nil {
			marker := m[1]
			if fence == "" {
				fence = marker
			} else if marker[0] == fence[0] && len(marker) >= len(fence) && strings.TrimSpace(line) == marker {
				fence = ""
			}
			continue
		}
		if fence != "" {
			continue
		}
		if m := headingRe.FindStringSubmatch(line); m != nil {
			text := strings.TrimSpace(strings.TrimRight(m[2], "#"))
			if text == "" {
				continue
			}
			level[i], title[i] = len(m[1]), text
		}
	}
	return lines, level, title
}

// splitAt splits src at every heading of level depth, and at shallower ones
// after the first such heading. Everything before it (frontmatter, the title
// heading, an intro) is the lead.
func splitAt(lines []string, level []int, title []string, depth int) []docSection {
	var out []docSection
	cur := docSection{Lead: true}
	from, started := 0, false
	for i := range lines {
		l := level[i]
		if l == 0 || l > depth || (l < depth && !started) {
			continue
		}
		started = true
		if i > 0 {
			cur.Text = strings.Join(lines[from:i], "\n")
			out = append(out, cur)
		}
		cur, from = docSection{Heading: title[i]}, i
	}
	cur.Text = strings.Join(lines[from:], "\n")
	return append(out, cur)
}

// splitSections splits a doc's markdown at the shallowest heading level that
// appears at least twice, so a lone title heading does not swallow the doc.
// It returns nil when the doc has no such level.
func splitSections(src string) []docSection {
	lines, level, title := markdownLines(src)
	counts := [7]int{}
	for _, l := range level {
		counts[l]++
	}
	for depth := 1; depth <= 6; depth++ {
		if counts[depth] >= 2 {
			return splitAt(lines, level, title, depth)
		}
	}
	return nil
}

// sectionLines counts a section's lines without its trailing blank lines.
func sectionLines(text string) int {
	return strings.Count(strings.TrimRight(text, " \t\n"), "\n") + 1
}

func sectionPlaceholder(docID string, sec docSection) string {
	heading := clipRunes(strings.ReplaceAll(sec.Heading, "]", ")"), 120)
	return fmt.Sprintf("[section kept out %s#%s: %s, %d lines; call get_doc with full=true to read it]", docID, blockHash(sec.Text), heading, sectionLines(sec.Text))
}

func clipRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:n])) + "…"
}

// sectionStart is the first words of a section after its heading line.
func sectionStart(sec docSection, n int) string {
	body := sec.Text
	if sec.Heading != "" {
		if i := strings.IndexByte(body, '\n'); i >= 0 {
			body = body[i+1:]
		} else {
			body = ""
		}
	}
	return clipRunes(strings.Join(strings.Fields(body), " "), n)
}

type passageState struct {
	N       int    `json:"n"`
	Heading string `json:"heading"`
	Start   string `json:"start,omitempty"`
}

// passageQuestions builds the yes/no per asked section, shortening each
// section's start until the state fits decide.MaxStateBytes.
func passageQuestions(title, focus string, sections []docSection, asked []int) (map[string]any, map[string]decide.Question) {
	questions := map[string]decide.Question{}
	for _, i := range asked {
		questions[fmt.Sprintf("part%d", i+1)] = decide.YesNo(
			fmt.Sprintf("Is section number %d of the doc about what the person is looking for, or needed to answer it?", i+1),
			"Yes, it is about what they are looking for", "No, it is about something else")
	}
	var state map[string]any
	for _, n := range []int{300, 180, 100, 40, 0} {
		parts := make([]passageState, 0, len(asked))
		for _, i := range asked {
			parts = append(parts, passageState{N: i + 1, Heading: clipRunes(sections[i].Heading, 120), Start: sectionStart(sections[i], n)})
		}
		state = map[string]any{"lookingFor": clipRunes(focus, 300), "doc": clipRunes(title, 200), "sections": parts}
		if raw, err := json.Marshal(state); err == nil && len(raw) < decide.MaxStateBytes {
			break
		}
	}
	return state, questions
}

// trimSections returns the markdown with the sections Jev did not mark
// relevant (Flag) replaced by placeholders, and how many it left out. A
// section Jev gave no answer about is shown. ok is false when nothing should
// be trimmed: none relevant, or too little left out to be worth it.
func trimSections(docID string, sections []docSection, asked []int, answers decide.Answers) (string, int, bool) {
	hide := map[int]bool{}
	relevant := 0
	for _, i := range asked {
		id := fmt.Sprintf("part%d", i+1)
		if _, answered := answers.Raw(id); !answered {
			continue
		}
		if yes, sure := answers.Yes(id, decide.Flag); sure && yes {
			relevant++
			continue
		}
		hide[i] = true
	}
	if relevant == 0 || len(hide) == 0 {
		return "", 0, false
	}
	saved := 0
	parts := make([]string, len(sections))
	for i, sec := range sections {
		if !hide[i] {
			parts[i] = sec.Text
			continue
		}
		placeholder := sectionPlaceholder(docID, sec)
		saved += len(sec.Text) - len(placeholder)
		// Keep the blank line before the next heading.
		parts[i] = placeholder + "\n"
	}
	if saved < passageMinSaving {
		return "", 0, false
	}
	return strings.Join(parts, "\n"), len(hide), true
}

// askedSections lists the sections worth asking about: not the text before
// the first heading, not short ones, at most passageMaxAsked.
func askedSections(sections []docSection) []int {
	var asked []int
	for i, sec := range sections {
		if sec.Lead || len(sec.Text) < passageMinSection {
			continue
		}
		if len(asked) == passageMaxAsked {
			break
		}
		asked = append(asked, i)
	}
	return asked
}

// focusPassages trims a long doc's markdown to the sections about focus. ok
// is false when the doc should come back whole.
func focusPassages(ctx context.Context, d Decider, userID, docID, title, focus, markdown string) (trimmed string, hidden, total int, ok bool) {
	focus = strings.TrimSpace(focus)
	if d == nil || focus == "" || len(markdown) < passageMinDoc || decide.IsSensitive(ctx) {
		return "", 0, 0, false
	}
	sections := splitSections(markdown)
	asked := askedSections(sections)
	if len(asked) < 2 {
		return "", 0, 0, false
	}
	ctx, cancel := context.WithTimeout(ctx, passageBudget)
	defer cancel()
	state, questions := passageQuestions(title, focus, sections, asked)
	answers, err := d.Ask(ctx, userID, decide.Request{Feature: "doc_passages", State: state, Questions: questions})
	if err != nil {
		return "", 0, 0, false
	}
	trimmed, hidden, ok = trimSections(docID, sections, asked, answers)
	return trimmed, hidden, len(sections), ok
}

// restoreSections swaps every [section kept out ...] line of src for the
// section it names, read from the doc's markdown as get_doc renders it (big
// blocks still as [kept ...] lines, which the doc tools restore next). A
// placeholder must stand alone on its line, outside code, exactly as get_doc
// wrote it; any other line naming one fails the write, since saving it as
// text would lose the section it stands for.
func restoreSections(src string, load func(docID string) (string, error)) (string, error) {
	if !strings.Contains(src, "[section kept out ") {
		return src, nil
	}
	lines := strings.Split(src, "\n")
	fence := ""
	byDoc := map[string]map[string]string{}
	changed := false
	for i, line := range lines {
		inCode := fence != ""
		if m := fenceRe.FindStringSubmatch(line); m != nil {
			if fence == "" {
				fence = m[1]
			} else if m[1][0] == fence[0] && len(m[1]) >= len(fence) && strings.TrimSpace(line) == m[1] {
				fence = ""
			}
			inCode = true
		}
		if !strings.Contains(line, "[section kept out ") {
			continue
		}
		m := sectionRe.FindStringSubmatch(strings.TrimRight(line, " \t\r"))
		if m == nil || inCode {
			if sectionRefRe.MatchString(line) {
				return "", fmt.Errorf("Line %d has a [section kept out ...] placeholder that was changed or has text around it: %q. Keep each placeholder line exactly as get_doc returned it, alone on its own line with no list marker, indent, quote or backticks, or call get_doc with full=true and write the section out in full", i+1, clipRunes(strings.TrimSpace(line), 160))
			}
			continue
		}
		docID, hash := m[1], m[2]
		byHash, seen := byDoc[docID]
		if !seen {
			source, err := load(docID)
			if err != nil {
				return "", fmt.Errorf("A [section kept out %s#%s] line names a doc that can't be read: %w", docID, hash, err)
			}
			byHash = sectionsByHash(source)
			byDoc[docID] = byHash
		}
		text, found := byHash[hash]
		if !found {
			return "", fmt.Errorf("The section [section kept out %s#%s] is no longer in that doc (it changed after you read it). Call get_doc again and use the lines it returns now", docID, hash)
		}
		lines[i] = strings.TrimRight(text, "\n")
		changed = true
	}
	if !changed {
		return src, nil
	}
	return strings.Join(lines, "\n"), nil
}

// RestoreSections puts back the sections a focused get_doc left out of a
// doc's new markdown, reading each doc with the catalog's plain get_doc (which
// never asks Jev). Chat proposals use it so the person reviews the markdown
// that will be written; big blocks stay [kept ...] lines.
func RestoreSections(ctx context.Context, catalog Catalog, uid, src string) (string, error) {
	return restoreSections(src, func(docID string) (string, error) {
		get := catalog["get_doc"].Call
		if get == nil {
			return "", fmt.Errorf("get_doc is not available")
		}
		args, _ := json.Marshal(map[string]string{"docId": docID})
		result, err := get(ctx, uid, args)
		if err != nil {
			return "", err
		}
		encoded, err := json.Marshal(result)
		if err != nil {
			return "", err
		}
		var payload struct {
			Markdown string `json:"markdown"`
		}
		if err := json.Unmarshal(encoded, &payload); err != nil {
			return "", err
		}
		return payload.Markdown, nil
	})
}

// sectionsByHash indexes a doc's sections at every heading depth, so a
// placeholder still resolves when an edit elsewhere changed the split level.
func sectionsByHash(markdown string) map[string]string {
	lines, level, title := markdownLines(markdown)
	out := map[string]string{}
	for depth := 1; depth <= 6; depth++ {
		for _, sec := range splitAt(lines, level, title, depth) {
			out[blockHash(sec.Text)] = sec.Text
		}
	}
	return out
}
