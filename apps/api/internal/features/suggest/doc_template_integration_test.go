package suggest

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"timely-api/internal/models"
)

func TestIntegrationDocTemplateOffersOwnTemplatesThenBuiltIns(t *testing.T) {
	w := newWorld(t)
	must(t, w.db.Create(&models.Document{ID: "doc_tpl", Title: "Interview notes", PlainText: "Candidate\nQuestions\nVerdict", WorkspaceID: w.ws, UserID: w.user, IsTemplate: true}).Error)
	// The person's own "Weekly review" stands in for the built-in one.
	must(t, w.db.Create(&models.Document{ID: "doc_week", Title: "Weekly review", WorkspaceID: w.ws, UserID: w.user, IsTemplate: true}).Error)
	must(t, w.db.Create(&models.Document{ID: "doc_plain", Title: "Not a template", WorkspaceID: w.ws, UserID: w.user}).Error)
	jev := &jevStub{answers: map[string]any{"template": choice("t1")}}
	s := New(w.db, jev.service(t), nil)

	out := s.DocTemplate(context.Background(), w.user, "Interview with Sam")
	if out.TemplateID != "doc_tpl" && out.TemplateID != "doc_week" {
		t.Fatalf("%+v", out)
	}
	var q struct {
		Criteria map[string]any `json:"criteria"`
	}
	_ = json.Unmarshal(jev.asked(0)["template"], &q)
	// none, two own templates and three built-ins (weekly is theirs).
	if len(q.Criteria) != 6 {
		t.Fatalf("options %s", jev.asked(0)["template"])
	}
	raw := string(jev.asked(0)["template"])
	if strings.Contains(raw, "Not a template") || !strings.Contains(raw, "Meeting notes") || strings.Count(raw, "Weekly review") != 1 {
		t.Fatalf("options %s", raw)
	}

	// A built-in pick comes back by its builtin: id.
	jev.answers["template"] = choice("t3")
	out = s.DocTemplate(context.Background(), w.user, "Standup 10 Oct")
	if !strings.HasPrefix(out.TemplateID, "builtin:") || out.Title == "" {
		t.Fatalf("%+v", out)
	}
	jev.answers["template"] = choice("none")
	if out = s.DocTemplate(context.Background(), w.user, "Groceries"); out.TemplateID != "" {
		t.Fatalf("%+v", out)
	}
}
