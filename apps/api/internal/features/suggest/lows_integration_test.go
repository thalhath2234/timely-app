package suggest

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"timely-api/internal/models"
)

// A yes/no field is filled only by a clear yes or no (any spelling of the
// offered names), and a select field with more values than a choice holds
// is skipped while the other hints still come.
func TestIntegrationTaskHintsYesNoAndWideSelects(t *testing.T) {
	w := newWorld(t)
	must(t, w.db.Create(&models.Status{ID: "tst_todo_" + w.ws[:8], Name: "To do", WorkspaceID: w.ws}).Error)
	waiting := models.Status{ID: "tst_wait_" + w.ws[:8], Name: "Waiting", WorkspaceID: w.ws}
	must(t, w.db.Create(&waiting).Error)
	billable := models.CustomField{ID: "cf_bill_" + w.ws[:8], Name: "Billable", WorkspaceID: w.ws, Type: models.CustomFieldTypeBoolean}
	must(t, w.db.Create(&billable).Error)
	wide := models.CustomField{ID: "cf_wide_" + w.ws[:8], Name: "Size", WorkspaceID: w.ws, Type: models.CustomFieldTypeSelect}
	for i := range 255 {
		wide.Options.Options = append(wide.Options.Options, models.Option{ID: fmt.Sprintf("o%d", i), Value: fmt.Sprintf("Size %d", i)})
	}
	must(t, w.db.Create(&wide).Error)
	task := w.task(t, "Client logo redesign", func(task *models.Task) {
		task.Description = "This client work is billable at the agency rate."
	})

	jev := &jevStub{answers: map[string]any{"status": choice("Waiting"), "field1": choice("Yes")}}
	s := New(w.db, jev.service(t), nil)
	out, err := s.TaskHints(context.Background(), w.user, task.ID)
	must(t, err)
	if out.Error != "" || out.StatusID != waiting.ID {
		t.Fatalf("%+v", out)
	}
	if len(out.Fields) != 1 || out.Fields[0].FieldID != billable.ID || out.Fields[0].Value != "true" {
		t.Fatalf("fields %+v", out.Fields)
	}
	if _, asked := jev.asked(0)["field2"]; asked {
		t.Fatal("asked about a select with 255 values")
	}

	// "unknown" leaves the field alone instead of filling "No".
	jev.answers = map[string]any{"status": choice("Waiting"), "field1": choice("unknown")}
	must(t, w.db.Model(&models.Task{}).Where("id = ?", task.ID).Update("description", "Billable? Ask the client.").Error)
	out, err = s.TaskHints(context.Background(), w.user, task.ID)
	must(t, err)
	if len(out.Fields) != 0 {
		t.Fatalf("an unsure answer filled %+v", out.Fields)
	}
}

// With less time left than the move call needs, the misfiled task shows
// without a target instead of starting a call that would only be cut off.
func TestIntegrationMoveTargetsNeedTimeLeft(t *testing.T) {
	w := newWorld(t)
	now := time.Now()
	kitchen := models.Project{ID: "pr_k_" + w.ws[:8], Title: "Kitchen remodel", Description: "New kitchen by spring.", WorkspaceID: &w.ws}
	garden := models.Project{ID: "pr_g_" + w.ws[:8], Title: "Garden", WorkspaceID: &w.ws}
	must(t, w.db.Create(&kitchen).Error)
	must(t, w.db.Create(&garden).Error)
	w.task(t, "Choose tiles", func(task *models.Task) { task.ProjectID = &kitchen.ID })
	hedge := w.task(t, "Trim the hedge", func(task *models.Task) { task.ProjectID = &kitchen.ID })

	jev := &jevStub{answers: map[string]any{"fit1": yesNo(0.95), "fit2": yesNo(0.02), "move1": choice("Garden")}}
	s := New(w.db, jev.service(t), nil)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	out, err := s.ProjectInsights(ctx, w.user, kitchen.ID, "", now)
	must(t, err)
	if len(out.Misfiled) != 1 || out.Misfiled[0].TaskID != hedge.ID || out.Misfiled[0].MoveTo != "" {
		t.Fatalf("misfiled %+v", out.Misfiled)
	}
	jev.mu.Lock()
	defer jev.mu.Unlock()
	for _, r := range jev.requests {
		if _, ok := r.Questions["move1"]; ok {
			t.Fatal("started the move call with under a second left")
		}
	}
}

// Clarify offers at most a choice's worth of workspaces, and project names
// up to a byte budget, instead of failing to build the request; a project
// named "none" stays a project.
func TestIntegrationClarifyOptionLimits(t *testing.T) {
	w := newWorld(t)
	for i := range 259 {
		must(t, w.db.Create(&models.Workspace{ID: fmt.Sprintf("%s-%03d", w.ws, i), Name: fmt.Sprintf("Space %d", i), UserID: &w.user}).Error)
	}
	for i := range 199 {
		must(t, w.db.Create(&models.Project{ID: fmt.Sprintf("pr_%s_%03d", w.ws[:8], i), Title: fmt.Sprintf("%03d %s", i, strings.Repeat("long title ", 30)), WorkspaceID: &w.ws}).Error)
	}
	item := w.task(t, "Weed the garden beds", func(task *models.Task) { task.Kind = models.KindInbox })

	jev := &jevStub{answers: map[string]any{"kind": choice("work")}}
	s := New(w.db, jev.service(t), nil)
	out, err := s.Clarify(context.Background(), w.user, item.ID)
	must(t, err)
	if out.Error != "" || !out.Available {
		t.Fatalf("%+v", out)
	}
	criteria := func(id string) map[string]any {
		var q struct {
			Criteria map[string]any `json:"criteria"`
		}
		must(t, json.Unmarshal(jev.asked(0)[id], &q))
		return q.Criteria
	}
	if n := len(criteria("workspace")); n != 255 {
		t.Fatalf("offered %d workspaces", n)
	}
	projects := criteria("project")
	total := 0
	for name := range projects {
		total += len(name)
	}
	if total > maxOptionBytes+len("none") || len(projects) < 10 || len(projects) > 120 {
		t.Fatalf("%d project options, %d bytes", len(projects), total)
	}
}

// With one workspace a project named "none" is offered under its own name,
// apart from the "none" answer, and can be picked.
func TestIntegrationClarifyProjectNamedNone(t *testing.T) {
	w := newWorld(t)
	none := models.Project{ID: "pr_none_" + w.ws[:8], Title: "none", WorkspaceID: &w.ws}
	must(t, w.db.Create(&none).Error)
	must(t, w.db.Create(&models.Project{ID: "pr_gdn_" + w.ws[:8], Title: "Garden", WorkspaceID: &w.ws}).Error)
	item := w.task(t, "Sort the misc pile", func(task *models.Task) { task.Kind = models.KindInbox })

	jev := &jevStub{answers: map[string]any{"kind": choice("work"), "project": choice("none (project)")}}
	s := New(w.db, jev.service(t), nil)
	out, err := s.Clarify(context.Background(), w.user, item.ID)
	must(t, err)
	if out.ProjectID != none.ID {
		t.Fatalf("project %q, want the one named none", out.ProjectID)
	}
}

// The stale-work review tells Jev the person's date, which can be a day
// ahead of the server's.
func TestIntegrationStaleWorkUsesThePersonsDate(t *testing.T) {
	w := newWorld(t)
	now := time.Date(2026, 10, 31, 20, 13, 0, 0, time.UTC) // Sun 1 Nov 09:13 in Auckland
	old := now.AddDate(0, 0, -30).Format("2006-01-02")
	task := w.task(t, "Prepare slides for the board meeting", nil)
	must(t, w.db.Model(&models.Task{}).Where("id = ?", task.ID).UpdateColumns(map[string]any{"created_at": old, "updated_at": old}).Error)

	jev := &jevStub{answers: map[string]any{"task1": choice("obsolete")}}
	s := New(w.db, jev.service(t), nil)
	_, err := s.StaleWork(context.Background(), w.user, "Pacific/Auckland", now)
	must(t, err)
	jev.mu.Lock()
	defer jev.mu.Unlock()
	if len(jev.requests) != 1 {
		t.Fatalf("%d calls", len(jev.requests))
	}
	if got := jev.requests[0].State["today"]; got != "Sunday 1 November 2026" {
		t.Fatalf("today = %v", got)
	}
}
