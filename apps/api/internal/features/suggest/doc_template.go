package suggest

import (
	"context"
	"fmt"
	"strings"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/decide"
)

// New-doc template: when a person names a doc before creating it (the
// phone's new-doc picker), one question asks which template it should start
// from: one of their own template docs or a built-in. It only highlights a
// row in the picker; the person still taps it.

// builtinDocTemplates mirror BUILTIN_TEMPLATES in
// packages/contract/src/templates.ts; the client fills in their content.
var builtinDocTemplates = []struct{ id, title, desc string }{
	{"builtin:meeting", "Meeting notes", "Notes from a meeting or call: agenda, notes, decisions, action items"},
	{"builtin:project", "Project plan", "A project plan: goal, scope, milestones, risks"},
	{"builtin:weekly", "Weekly review", "A weekly review: what went well, what did not, next week"},
	{"builtin:daily", "Daily note", "A daily note: top three things, notes, what got done today"},
}

// DocTemplateSuggestion names the template a new doc's title calls for.
type DocTemplateSuggestion struct {
	Available  bool   `json:"available"`
	LogID      string `json:"logId,omitempty"`
	TemplateID string `json:"templateId,omitempty"`
	Title      string `json:"title,omitempty"`
}

func (s *Service) docTemplate(c *echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), sheetBudget)
	defer cancel()
	return c.JSON(200, s.DocTemplate(ctx, user(c), c.QueryParam("title")))
}

// DocTemplate asks which template a doc with this title should start from,
// or none. "Untitled" and titles under two letters ask nothing.
func (s *Service) DocTemplate(ctx context.Context, userID, title string) DocTemplateSuggestion {
	on, _ := s.decide.Status(ctx, userID)
	out := DocTemplateSuggestion{Available: on}
	title = strings.TrimSpace(title)
	if !on || len([]rune(title)) < 2 || strings.EqualFold(title, "untitled") {
		return out
	}
	type candidate struct{ id, title string }
	var cands []candidate
	opts := []decide.Option{{Name: "none", Description: "Start blank; no template fits"}}
	own := map[string]bool{}
	for _, t := range s.docTemplates(ctx, userID, "") {
		desc := fmt.Sprintf("Their template “%s”", clip(t.Title, 80))
		if p := strings.TrimSpace(t.PlainText); p != "" {
			desc += ": " + clip(p, 160)
		}
		cands = append(cands, candidate{t.ID, t.Title})
		opts = append(opts, decide.Option{Name: fmt.Sprintf("t%d", len(cands)), Description: desc})
		own[strings.ToLower(strings.TrimSpace(t.Title))] = true
	}
	// A template of their own with the same name stands in for the built-in.
	for _, b := range builtinDocTemplates {
		if own[strings.ToLower(b.title)] {
			continue
		}
		cands = append(cands, candidate{b.id, b.title})
		opts = append(opts, decide.Option{Name: fmt.Sprintf("t%d", len(cands)), Description: fmt.Sprintf("Built-in “%s”. %s", b.title, b.desc)})
	}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "doc_template", State: map[string]string{"newDocTitle": clip(title, 200)},
		Questions: map[string]decide.Question{"template": decide.Choice("The person is creating a new doc with this title. Which template is made for this kind of doc, if any?", opts...)}})
	if err != nil {
		return out
	}
	out.LogID = a.LogID
	choice, ok := a.Choice("template", decide.Prefill)
	var n int
	if ok && choice != "none" {
		if _, err := fmt.Sscanf(choice, "t%d", &n); err == nil && n >= 1 && n <= len(cands) {
			out.TemplateID, out.Title = cands[n-1].id, cands[n-1].title
		}
	}
	return out
}
