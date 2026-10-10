package task

import (
	"testing"
	"time"

	"timely-api/internal/models"
)

// A project started from an earlier one restarts a repeating task's series
// on the new project's start, on the first day the rule falls on, and on
// today when the new project has no start. A plain copy keeps the old start.
func TestIntegrationCopyProjectTasksFreshRestartsSeries(t *testing.T) {
	f := newKindFixture(t)
	// Monday 6 January 2025 at 09:00 UTC, weekly on Mondays.
	rec := &models.RecurrenceInput{RRule: "FREQ=WEEKLY;BYDAY=MO", Dtstart: "2025-01-06T09:00:00Z", Timezone: "UTC"}
	series := f.board(models.KindTask, 30, nil)
	series.StageID = nil // the copies go to projects without that stage
	if _, err := f.svc.Create(series, nil, rec); err != nil {
		t.Fatalf("create series: %v", err)
	}
	dated := models.Project{ID: "prj_kind_dated", Title: "Dated", WorkspaceID: f.id(f.workspace), StartDate: f.id("2026-11-04")}
	undated := models.Project{ID: "prj_kind_undated", Title: "Undated", WorkspaceID: f.id(f.workspace)}
	plain := models.Project{ID: "prj_kind_plain", Title: "Plain", WorkspaceID: f.id(f.workspace), StartDate: f.id("2026-11-04")}
	for _, row := range []any{&dated, &undated, &plain} {
		if err := f.db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	copyInto := func(target string, fresh bool) *models.RecurrenceRule {
		t.Helper()
		if err := f.svc.CopyProjectTasks(kindTestUser, f.project, target, nil, fresh); err != nil {
			t.Fatalf("copy into %s: %v", target, err)
		}
		var c models.Task
		if err := f.db.Where("project_id = ?", target).First(&c).Error; err != nil {
			t.Fatal(err)
		}
		got, err := f.svc.GetForUser(kindTestUser, c.ID)
		if err != nil {
			t.Fatal(err)
		}
		if !got.IsRecurring() || got.Recurrence == nil || got.Recurrence.RRule != rec.RRule {
			t.Fatalf("copy in %s recurrence = %+v, want %s", target, got.Recurrence, rec.RRule)
		}
		return got.Recurrence
	}

	// Wednesday 4 November 2026: the first Monday on or after is the 9th.
	if got := copyInto(dated.ID, true); !got.Dtstart.Equal(time.Date(2026, 11, 9, 9, 0, 0, 0, time.UTC)) {
		t.Fatalf("dated series starts %v, want Monday 9 November 09:00", got.Dtstart)
	}

	got := copyInto(undated.ID, true).Dtstart
	today := time.Now().UTC()
	today = time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)
	if got.Weekday() != time.Monday || got.Hour() != 9 || got.Before(today) || !got.Before(today.AddDate(0, 0, 7)) {
		t.Fatalf("undated series starts %v, want the first Monday from today at 09:00", got)
	}

	if got := copyInto(plain.ID, false); !got.Dtstart.Equal(time.Date(2025, 1, 6, 9, 0, 0, 0, time.UTC)) {
		t.Fatalf("plain copy starts %v, want the old start", got.Dtstart)
	}
}
