package suggest

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
	"timely-api/internal/models"
)

// goesTo sends PUT /suggestions/doc/:id/goes-to as the person and returns
// the status code.
func goesTo(t *testing.T, s *Service, userID, docID, target string) int {
	t.Helper()
	e := echo.New()
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			c.Set("userID", userID)
			return next(c)
		}
	})
	s.docRoutes(e.Group(""))
	raw, _ := json.Marshal(map[string]string{"target": target})
	req := httptest.NewRequest("PUT", "/suggestions/doc/"+docID+"/goes-to", strings.NewReader(string(raw)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec.Code
}

func TestIntegrationDocGoesTo(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	own := models.Project{ID: "pr_own", Title: "Garden", WorkspaceID: &w.ws}
	proposed := models.Project{ID: "pr_proposed", Title: "Timely", WorkspaceID: &w.ws}
	// A project in another of the person's workspaces is a place too, and
	// the task is made in that workspace.
	work := "ws_work_" + w.ws
	must(t, w.db.Create(&models.Workspace{ID: work, Name: "Work", UserID: &w.user}).Error)
	picked := models.Project{ID: "pr_picked", Title: "Launch", WorkspaceID: &work}
	for _, p := range []*models.Project{&own, &proposed, &picked} {
		must(t, w.db.Create(p).Error)
	}
	doc := models.Document{ID: "doc_goes_to", Title: "Weekend", WorkspaceID: w.ws, UserID: w.user, ProjectID: &own.ID, CreatedAt: "2026-10-01T09:00:00Z"}
	must(t, w.db.Create(&doc).Error)
	s := New(w.db, nil, nil)
	check := func(label, wantPicked, wantProject, wantWorkspace string) {
		t.Helper()
		out, err := s.DocChecklist(ctx, w.user, doc.ID, []string{"Call the plumber"}, proposed.ID)
		must(t, err)
		got, ws := "", ""
		if out.Project != nil {
			got, ws = out.Project.ID, out.Project.WorkspaceID
		}
		if out.Picked != wantPicked || got != wantProject || ws != wantWorkspace {
			t.Fatalf("%s: picked %q project %q in %q, want %q %q in %q", label, out.Picked, got, ws, wantPicked, wantProject, wantWorkspace)
		}
	}

	// No pick: the doc's own project, as before.
	check("automatic", "", own.ID, w.ws)

	// A picked project wins over the doc's project and the proposal, and
	// the doc's own project is left alone.
	if code := goesTo(t, s, w.user, doc.ID, picked.ID); code != 204 {
		t.Fatalf("set project: %d", code)
	}
	check("project", picked.ID, picked.ID, work)
	var kept models.Document
	must(t, w.db.Select("project_id").Where("id = ?", doc.ID).First(&kept).Error)
	if kept.ProjectID == nil || *kept.ProjectID != own.ID {
		t.Fatalf("doc project changed: %v", kept.ProjectID)
	}

	// Inbox: no project, even though the doc has one.
	if code := goesTo(t, s, w.user, doc.ID, "inbox"); code != 204 {
		t.Fatalf("set inbox: %d", code)
	}
	check("inbox", "inbox", "", "")

	// Cleared: automatic again.
	if code := goesTo(t, s, w.user, doc.ID, ""); code != 204 {
		t.Fatalf("clear: %d", code)
	}
	check("cleared", "", own.ID, w.ws)

	// Another account's project is no place; its doc is not found.
	other := world{db: w.db, user: "usr_other_" + w.user, ws: "ws_other_" + w.ws}
	must(t, w.db.Create(&models.User{ID: other.user, Email: other.user + "@test.local"}).Error)
	must(t, w.db.Create(&models.Workspace{ID: other.ws, Name: "Theirs", UserID: &other.user}).Error)
	foreign := models.Project{ID: "pr_theirs", Title: "Not yours", WorkspaceID: &other.ws}
	must(t, w.db.Create(&foreign).Error)
	if code := goesTo(t, s, w.user, doc.ID, foreign.ID); code != 400 {
		t.Fatalf("another account's project: %d", code)
	}
	if code := goesTo(t, s, w.user, doc.ID, "pr_missing"); code != 400 {
		t.Fatalf("missing project: %d", code)
	}
	if code := goesTo(t, s, other.user, doc.ID, "inbox"); code != 404 {
		t.Fatalf("another account's doc: %d", code)
	}
	check("after rejected picks", "", own.ID, w.ws)

	// A finished project cannot be picked, and one finished after it was
	// picked falls back to the automatic place.
	if code := goesTo(t, s, w.user, doc.ID, picked.ID); code != 204 {
		t.Fatalf("set project again: %d", code)
	}
	must(t, w.db.Model(&models.Project{}).Where("id = ?", picked.ID).Update("completed_at", "2026-10-30T00:00:00Z").Error)
	check("finished pick", "", own.ID, w.ws)
	if code := goesTo(t, s, w.user, doc.ID, picked.ID); code != 400 {
		t.Fatalf("finished project picked: %d", code)
	}

	// With no project of its own the doc takes the proposal when automatic.
	must(t, w.db.Model(&models.Document{}).Where("id = ?", doc.ID).Update("project_id", nil).Error)
	check("proposal", "", proposed.ID, w.ws)

	// Deleting the doc forgets its pick.
	must(t, s.SetDocOfferTarget(ctx, w.user, doc.ID, "inbox"))
	must(t, w.db.Delete(&models.Document{}, "id = ?", doc.ID).Error)
	var left int64
	must(t, w.db.Table("doc_offer_targets").Where("doc_id = ?", doc.ID).Count(&left).Error)
	if left != 0 {
		t.Fatalf("pick kept after the doc was deleted")
	}
	// A pick for a doc that is gone is a 404, not a foreign key error.
	if code := goesTo(t, s, w.user, doc.ID, "inbox"); code != 404 {
		t.Fatalf("deleted doc: %d", code)
	}
	if code := goesTo(t, s, w.user, doc.ID, ""); code != 404 {
		t.Fatalf("deleted doc, clear: %d", code)
	}
}
