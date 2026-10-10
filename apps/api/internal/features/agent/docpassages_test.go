package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"timely-api/internal/features/decide"
	"timely-api/internal/features/doc"
	"timely-api/internal/models"
	"timely-api/internal/richtext"

	mcpauth "github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// passageJev is a decide.Service whose Jev answers each yes/no from a table
// of probabilities and records the state it was sent.
func passageJev(t *testing.T, enabled bool, yes map[string]float64, calls *atomic.Int32, state *json.RawMessage) Decider {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		raw, _ := io.ReadAll(r.Body)
		var req struct {
			State     json.RawMessage            `json:"state"`
			Questions map[string]json.RawMessage `json:"questions"`
		}
		_ = json.Unmarshal(raw, &req)
		if state != nil {
			*state = req.State
		}
		out := map[string]any{}
		for id := range req.Questions {
			if p, ok := yes[id]; ok {
				out[id] = map[string]any{"type": "noul", "noul": p}
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "jev-1.13.0", "answers": out})
	}))
	t.Cleanup(srv.Close)
	client := decide.NewClient(nil)
	client.TypeSafeURL = srv.URL
	keys := decide.Keys{Enabled: enabled, TypeSafe: "ts-test-key-123"}
	return decide.New(nil, func(context.Context, string) (decide.Keys, error) { return keys, nil }, client)
}

// longDoc has a title, an intro and four long sections.
func longDoc() string {
	var b strings.Builder
	b.WriteString("# Handbook\n\nIntro for everyone.\n")
	for _, name := range []string{"Travel policy", "Budget", "Hiring", "Office"} {
		fmt.Fprintf(&b, "\n## %s\n\n", name)
		for i := range 60 {
			fmt.Fprintf(&b, "- %s rule %d: a line that says something about %s.\n", name, i, strings.ToLower(name))
		}
	}
	return b.String()
}

func TestSplitSectionsSkipsFencesAndFrontmatter(t *testing.T) {
	src := "---\ntitle: x\n# not a heading\n---\n# Title\n\nIntro\n\n## One\n\n```md\n## not a heading either\n```\n\n## Two\ntext\n### Two.a\nmore"
	sections := splitSections(src)
	if len(sections) != 3 {
		t.Fatalf("got %d sections, want 3: %+v", len(sections), sections)
	}
	if !sections[0].Lead || !strings.Contains(sections[0].Text, "# Title\n\nIntro") || sections[1].Heading != "One" || sections[2].Heading != "Two" || sections[1].Lead {
		t.Fatalf("unexpected sections: %+v", sections)
	}
	if !strings.Contains(sections[1].Text, "## not a heading either") || !strings.Contains(sections[2].Text, "### Two.a") {
		t.Fatalf("fenced heading or subsection split off: %+v", sections)
	}
	parts := make([]string, len(sections))
	for i, sec := range sections {
		parts[i] = sec.Text
	}
	if strings.Join(parts, "\n") != src {
		t.Fatal("sections do not join back into the doc")
	}
	// A doc starting at a split heading has no lead; one with a single
	// heading per level does not split.
	if s := splitSections("## A\ntext\n## B\ntext"); len(s) != 2 || s[0].Lead {
		t.Fatalf("unexpected split: %+v", s)
	}
	if s := splitSections("# A\ntext\n## B\ntext"); s != nil {
		t.Fatalf("want no split, got %+v", s)
	}
}

func TestFocusPassagesTrimsAndRestores(t *testing.T) {
	src := longDoc()
	var calls atomic.Int32
	var state json.RawMessage
	// Section 1 is the lead (never asked); 2 Travel, 3 Budget, 4 Hiring, 5 Office.
	d := passageJev(t, true, map[string]float64{"part2": 0.95, "part3": 0.1, "part4": 0.6}, &calls, &state)
	trimmed, hidden, total, ok := focusPassages(context.Background(), d, "usr_1", "doc_1", "Handbook", "what can I spend on flights", src)
	if !ok || hidden != 2 || total != 5 || calls.Load() != 1 {
		t.Fatalf("ok=%v hidden=%d total=%d calls=%d", ok, hidden, total, calls.Load())
	}
	if !strings.Contains(trimmed, "Intro for everyone.") || !strings.Contains(trimmed, "Travel policy rule 39") {
		t.Fatalf("lead or relevant section missing:\n%s", trimmed)
	}
	// Unsure (part4) and a no (part3) are left out; Office got no answer and stays.
	for _, gone := range []string{"Budget rule 0", "Hiring rule 0"} {
		if strings.Contains(trimmed, gone) {
			t.Fatalf("%q should be kept out", gone)
		}
	}
	if !strings.Contains(trimmed, "Office rule 0") {
		t.Fatal("a section Jev did not answer about should be shown")
	}
	if !strings.Contains(trimmed, "[section kept out doc_1#") || !strings.Contains(trimmed, ": Budget, 62 lines; call get_doc with full=true to read it]") {
		t.Fatalf("missing placeholder:\n%s", trimmed)
	}
	if !strings.Contains(string(state), "flights") || strings.Contains(string(state), "Intro for everyone") {
		t.Fatalf("unexpected state: %s", state)
	}

	// The agent edits the visible text and writes the rest back as is.
	edited := strings.Replace(trimmed, "Travel policy rule 3:", "Travel policy rule three:", 1)
	restored, err := restoreSections(edited, func(id string) (string, error) {
		if id != "doc_1" {
			return "", errors.New("not found")
		}
		return src, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	want, _ := richtext.FromMarkdown(strings.Replace(src, "Travel policy rule 3:", "Travel policy rule three:", 1))
	got, _ := richtext.FromMarkdown(restored)
	if wj, gj := mustJSON(t, want), mustJSON(t, got); wj != gj {
		t.Fatalf("restored doc differs:\n%s", restored)
	}

	// A section edited since the read is refused.
	_, err = restoreSections(edited, func(string) (string, error) {
		return strings.Replace(src, "Budget rule 5", "Budget rule five", 1), nil
	})
	if err == nil || !strings.Contains(err.Error(), "get_doc again") {
		t.Fatalf("want a stale section error, got %v", err)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestFocusPassagesReturnsWholeDoc(t *testing.T) {
	src := longDoc()
	relevant := map[string]float64{"part2": 0.95, "part3": 0.05, "part4": 0.05, "part5": 0.05}
	cases := []struct {
		name    string
		ctx     context.Context
		enabled bool
		yes     map[string]float64
		focus   string
		src     string
		nilJev  bool
		asks    bool
	}{
		{"jev off", context.Background(), false, relevant, "flights", src, false, false},
		{"no decider", context.Background(), true, relevant, "flights", src, true, false},
		{"no focus", context.Background(), true, relevant, "  ", src, false, false},
		{"short doc", context.Background(), true, relevant, "flights", "## A\n" + strings.Repeat("a\n", 400) + "## B\n" + strings.Repeat("b\n", 400), false, false},
		{"sensitive", decide.WithSensitive(context.Background()), true, relevant, "flights", src, false, false},
		{"nothing relevant", context.Background(), true, map[string]float64{"part2": 0.3, "part3": 0.05}, "flights", src, false, true},
		{"too little left out", context.Background(), true, map[string]float64{"part2": 0.95, "part3": 0.95, "part4": 0.95, "part5": 0.6}, "flights", shortOffice(src), false, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var calls atomic.Int32
			var d Decider = passageJev(t, c.enabled, c.yes, &calls, nil)
			if c.nilJev {
				d = nil
			}
			if _, _, _, ok := focusPassages(c.ctx, d, "usr_1", "doc_1", "Handbook", c.focus, c.src); ok {
				t.Fatal("want the whole doc")
			}
			if asked := calls.Load() > 0; asked != c.asks {
				t.Fatalf("asked Jev = %v, want %v", asked, c.asks)
			}
		})
	}
}

// shortOffice cuts the last section to a dozen lines (still asked about).
func shortOffice(src string) string {
	return src[:strings.Index(src, "\n## Office")] + "\n## Office\n\n" + strings.Repeat("- Office rule: a line that says something about office.\n", 12)
}

func TestPassageStateFitsLimit(t *testing.T) {
	var b strings.Builder
	for i := range 60 {
		fmt.Fprintf(&b, "## Section %d %s\n\n%s\n\n", i, strings.Repeat("long heading ", 20), strings.Repeat("word ", 400))
	}
	sections := splitSections(b.String())
	asked := askedSections(sections)
	if len(asked) != passageMaxAsked {
		t.Fatalf("asked %d sections, want %d", len(asked), passageMaxAsked)
	}
	state, questions := passageQuestions("Big", strings.Repeat("focus ", 100), sections, asked)
	raw, _ := json.Marshal(state)
	if len(raw) >= decide.MaxStateBytes || len(questions) != passageMaxAsked {
		t.Fatalf("state %d bytes, %d questions", len(raw), len(questions))
	}
}

// passageDocs is a doc service holding one doc; Update records the content.
type passageDocs struct {
	doc.DocumentService
	d       *models.Document
	updated models.JSONMap
}

func (p *passageDocs) GetByID(_, id string) (*models.Document, error) {
	if id != p.d.ID {
		return nil, errors.New("not found")
	}
	return p.d, nil
}

func (p *passageDocs) Update(_, id string, u doc.DocumentUpdate) (*models.Document, error) {
	if u.Content != nil {
		p.updated = *u.Content
	}
	return p.d, nil
}

func TestGetDocFocusAndWriteBack(t *testing.T) {
	src := longDoc()
	content, plain := richtext.FromMarkdown(src)
	docs := &passageDocs{d: &models.Document{ID: "doc_1", Title: "Handbook", Content: content, PlainText: plain}}
	var calls atomic.Int32
	s := &Server{Deps: Deps{Docs: docs, Decisions: passageJev(t, true, map[string]float64{"part2": 0.95, "part3": 0.05, "part4": 0.05, "part5": 0.05}, &calls, nil)}}
	req := &mcp.CallToolRequest{Extra: &mcp.RequestExtra{TokenInfo: &mcpauth.TokenInfo{UserID: "usr_1"}}}

	_, out, err := s.getDoc(context.Background(), req, getDocIn{DocID: "doc_1", Focus: "flights"})
	if err != nil {
		t.Fatal(err)
	}
	payload := out.(map[string]any)
	markdown := payload["markdown"].(string)
	if _, has := payload["plainText"]; has || payload["sectionsKeptOut"] == nil || strings.Contains(markdown, "Budget rule") {
		t.Fatalf("not trimmed: %v", payload["sectionsKeptOut"])
	}

	// full=true and a read with no focus return the doc as before.
	for _, in := range []getDocIn{{DocID: "doc_1", Focus: "flights", Full: true}, {DocID: "doc_1"}} {
		_, out, _ := s.getDoc(context.Background(), req, in)
		if full := out.(map[string]any); !strings.Contains(full["markdown"].(string), "Budget rule 39") || full["sectionsKeptOut"] != nil {
			t.Fatalf("%+v did not return the whole doc", in)
		}
	}

	// update_doc with the trimmed markdown keeps every section.
	edited := markdown + "\n\nA new closing line."
	if _, _, err := s.updateDoc(context.Background(), req, updateDocIn{DocID: "doc_1", Markdown: &edited}); err != nil {
		t.Fatal(err)
	}
	saved := richtext.ToMarkdown(docs.updated)
	if strings.Contains(saved, "section kept out") || !strings.Contains(saved, "Budget rule 39") || !strings.Contains(saved, "Office rule 0") || !strings.Contains(saved, "A new closing line.") {
		t.Fatalf("placeholders were not restored:\n%s", saved)
	}
}

func TestRestoreSectionsRefusesAReformattedPlaceholder(t *testing.T) {
	src := longDoc()
	sections := splitSections(src)
	placeholder := sectionPlaceholder("doc_1", sections[2])
	load := func(string) (string, error) { return src, nil }

	// The exact line, also with a trailing space or a CRLF ending, is restored.
	for _, line := range []string{placeholder, placeholder + " ", placeholder + "\r"} {
		restored, err := restoreSections("Intro\n\n"+line+"\n\nEnd", load)
		if err != nil || !strings.Contains(restored, "Budget rule 39") || strings.Contains(restored, "section kept out") {
			t.Fatalf("exact placeholder %q not restored: %v", line, err)
		}
	}
	reformatted := []string{
		"- " + placeholder,
		"`" + placeholder + "`",
		"    " + placeholder,
		"  " + placeholder,
		"> " + placeholder,
		"See " + placeholder,
		placeholder + " and more",
		"1. " + placeholder,
		"```\n" + placeholder + "\n```",
	}
	for _, line := range reformatted {
		_, err := restoreSections("Intro\n\n"+line+"\n\nEnd", load)
		if err == nil || !strings.Contains(err.Error(), "exactly as get_doc returned it") || !strings.Contains(err.Error(), "full=true") {
			t.Fatalf("reformatted placeholder %q was accepted: %v", line, err)
		}
	}
	// Prose about the feature with no doc id is plain text.
	if out, err := restoreSections("A [section kept out ...] line stands for a section.", load); err != nil || !strings.Contains(out, "section kept out") {
		t.Fatalf("prose rejected: %v", err)
	}
}

func TestRestoreSectionsThroughTheCatalog(t *testing.T) {
	src := longDoc()
	placeholder := sectionPlaceholder("doc_1", splitSections(src)[3])
	asked := 0
	catalog := Catalog{"get_doc": {Call: func(_ context.Context, uid string, args json.RawMessage) (any, error) {
		asked++
		var in map[string]any
		_ = json.Unmarshal(args, &in)
		if uid != "usr_1" || len(in) != 1 || in["docId"] != "doc_1" {
			return nil, fmt.Errorf("unexpected read %s", args)
		}
		return map[string]any{"markdown": src}, nil
	}}}
	out, err := RestoreSections(context.Background(), catalog, "usr_1", "# New\n\n"+placeholder+"\n\n"+placeholder)
	if err != nil || asked != 1 || strings.Count(out, "Hiring rule 59") != 2 || strings.Contains(out, "section kept out") {
		t.Fatalf("asked=%d err=%v\n%s", asked, err, out)
	}
	if out, err := RestoreSections(context.Background(), Catalog{}, "usr_1", "no placeholders"); err != nil || out != "no placeholders" {
		t.Fatalf("plain markdown changed: %q %v", out, err)
	}
}

func TestAppendToDocRestoresOnlyTheAppendedText(t *testing.T) {
	src := longDoc()
	placeholder := sectionPlaceholder("doc_1", splitSections(src)[2])
	content, plain := richtext.FromMarkdown(src)
	docs := &passageDocs{d: &models.Document{ID: "doc_1", Title: "Handbook", Content: content, PlainText: plain}}
	s := &Server{Deps: Deps{Docs: docs}}
	req := &mcp.CallToolRequest{Extra: &mcp.RequestExtra{TokenInfo: &mcpauth.TokenInfo{UserID: "usr_1"}}}
	if _, _, err := s.appendToDoc(context.Background(), req, appendDocIn{DocID: "doc_1", Markdown: "## Copy\n\n" + placeholder}); err != nil {
		t.Fatal(err)
	}
	if saved := richtext.ToMarkdown(docs.updated); strings.Count(saved, "Budget rule 39") != 2 || strings.Contains(saved, "section kept out") {
		t.Fatalf("appended placeholder not restored:\n%s", saved)
	}
	docs.updated = nil
	bad := "- " + placeholder
	if _, _, err := s.appendToDoc(context.Background(), req, appendDocIn{DocID: "doc_1", Markdown: bad}); err == nil || docs.updated != nil {
		t.Fatal("a reformatted placeholder was appended as text")
	}
}
