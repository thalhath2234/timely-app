package schedule

import (
	"testing"
	"time"
	"timely-api/internal/features/task"
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

	got := RankList([]models.Task{unscheduled, overdue, inbox, placed}, task.TodayAt(now, time.UTC))
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

	got := RankList([]models.Task{later, earlier}, task.TodayAt(now, time.UTC))
	if len(got) != 2 {
		t.Fatalf("want 2, got %d", len(got))
	}
	if got[0].Task.ID != "a" || got[1].Task.ID != "b" {
		t.Fatalf("equal scores should order by task id, got %s then %s", got[0].Task.ID, got[1].Task.ID)
	}
}

// QA-03: a new account without saved Working hours must rank "today" in the
// same location Auto-schedule plans in. When the client's local date is already
// October 1 but UTC is still September 30, Work placed at 09:00 local on
// October 1 is scheduled for today, not Unscheduled.
func TestRankUsesClientTimezoneWhenNoWorkingHoursSaved(t *testing.T) {
	tokyo, err := time.LoadLocation("Asia/Tokyo")
	if err != nil {
		t.Fatal(err)
	}
	ws := "ws_1"
	placedToday := models.Task{
		ID: "p", Name: "Placed", Kind: models.KindTask, Duration: 30, WorkspaceID: &ws,
		Blocks: []models.ScheduledBlock{{
			StartAt: time.Date(2026, 10, 1, 9, 0, 0, 0, tokyo),
			EndAt:   time.Date(2026, 10, 1, 10, 0, 0, 0, tokyo),
		}},
	}
	// 00:30 on October 1 in Tokyo is 15:30 on September 30 in UTC.
	instant := time.Date(2026, 10, 1, 0, 30, 0, 0, tokyo)
	var noHours models.WorkingHours

	utcNow := task.TodayFor(noHours, "", instant)
	if got := RankList([]models.Task{placedToday}, utcNow); len(got) != 1 {
		t.Fatalf("with a UTC day boundary the block is tomorrow, want 1 ranked task, got %d", len(got))
	}

	clientNow := task.TodayFor(noHours, "Asia/Tokyo", instant)
	if got := RankList([]models.Task{placedToday}, clientNow); len(got) != 0 {
		t.Fatalf("with the client's day boundary the block is today, want 0 ranked tasks, got %d", len(got))
	}
}
