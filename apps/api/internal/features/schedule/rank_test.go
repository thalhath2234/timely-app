package schedule

import (
	"testing"
	"time"
	"timely-api/internal/models"
)

func TestRankListIsUnscheduledOrOverdue(t *testing.T) {
	now := time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC)
	past := "2026-09-20"
	ws := "ws_1"
	unscheduled := models.Task{ID: "u", Name: "Do it", Kind: models.KindTask, Duration: 30, WorkspaceID: &ws}
	overdue := models.Task{
		ID: "o", Name: "Late", Kind: models.KindTask, Duration: 30, WorkspaceID: &ws, Deadline: &past,
		Blocks: []models.ScheduledBlock{{
			StartAt: time.Date(2026, 9, 27, 9, 0, 0, 0, time.UTC),
			EndAt:   time.Date(2026, 9, 27, 10, 0, 0, 0, time.UTC),
		}},
	}
	inbox := models.Task{ID: "i", Name: "Thought", Kind: models.KindInbox}
	placed := models.Task{
		ID: "p", Name: "Placed", Kind: models.KindTask, Duration: 30, WorkspaceID: &ws,
		Blocks: []models.ScheduledBlock{{
			StartAt: time.Date(2026, 9, 27, 14, 0, 0, 0, time.UTC),
			EndAt:   time.Date(2026, 9, 27, 15, 0, 0, 0, time.UTC),
		}},
	}

	got := RankList([]models.Task{unscheduled, overdue, inbox, placed}, now)
	if len(got) != 2 {
		t.Fatalf("want unscheduled + overdue, got %d", len(got))
	}
	ids := map[string]bool{}
	for _, row := range got {
		ids[row.Task.ID] = true
	}
	if !ids["u"] || !ids["o"] {
		t.Fatalf("missing members: %#v", ids)
	}
	if ids["i"] || ids["p"] {
		t.Fatal("inbox and placed-today work must not be on Rank")
	}
}

func TestRankListTieBreaksByTaskID(t *testing.T) {
	now := time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC)
	ws := "ws_1"
	later := models.Task{ID: "b", Name: "Later id", Kind: models.KindTask, Duration: 30, WorkspaceID: &ws}
	earlier := models.Task{ID: "a", Name: "Earlier id", Kind: models.KindTask, Duration: 30, WorkspaceID: &ws}

	got := RankList([]models.Task{later, earlier}, now)
	if len(got) != 2 {
		t.Fatalf("want 2, got %d", len(got))
	}
	if got[0].Task.ID != "a" || got[1].Task.ID != "b" {
		t.Fatalf("equal scores should order by task id, got %s then %s", got[0].Task.ID, got[1].Task.ID)
	}
}
