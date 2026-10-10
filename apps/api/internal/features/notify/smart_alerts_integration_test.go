package notify

import (
	"context"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/calendar"
	"timely-api/internal/features/embed"
	"timely-api/internal/features/event"
	"timely-api/internal/features/placement"
	"timely-api/internal/features/project"
	"timely-api/internal/features/schedule"
	"timely-api/internal/features/task"
	"timely-api/internal/features/workspace"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"
)

// Smart alerts are capped at three a day, sent once, skip Work alerted about
// this week, and their Focus step runs from the notification.
func TestIntegrationSmartAlertsSendOnceAndApply(t *testing.T) {
	_, db := zoneService(t, models.NotificationSettings{Reminders: true})
	tasks := task.NewTaskRepository(db)
	sched := schedule.NewRepository(db)
	place := placement.New(db, sched.GetWorkingHours)
	indexer := embed.New(db)
	taskService := task.NewTaskService(tasks, project.NewProjectRepository(db), workspace.NewWorkspaceRepository(db), recurrence.NewStore(db), place, indexer)
	svc := NewService(db, jobs.NewQueue(db), nil, taskService, schedule.NewService(sched, tasks, event.NewEventRepository(db), place), indexer)

	user := zoneTestUser
	ws := models.Workspace{ID: "ws_alerts", Name: "Home", UserID: &user}
	if err := db.Create(&ws).Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"tsk_a", "tsk_b", "tsk_c", "tsk_d"} {
		if err := db.Create(&models.Task{ID: id, Name: "Work " + id, Kind: models.KindTask, Duration: 30, UserID: &user, WorkspaceID: &ws.ID}).Error; err != nil {
			t.Fatal(err)
		}
	}

	var kept []string
	svc.SetDecisions(nil, func(_, logID string, accepted bool) error {
		if accepted {
			kept = append(kept, logID)
		}
		return nil
	})
	var skipped []map[string]bool
	svc.SetAlerts(func(_ context.Context, _ string, _ time.Time, skip, _ map[string]bool) []Alert {
		skipped = append(skipped, skip)
		return []Alert{
			{Key: "project:pr_1", Kind: "project", ProjectID: "pr_1", Title: "Project “Kitchen” is due in 2 days", Body: "It is due in 2 days.", Action: AlertReview,
				Items: []AlertItem{{ID: "tsk_a", Name: "Work tsk_a"}, {ID: "tsk_b", Name: "Work tsk_b"}}},
			{Key: "unblocked:tsk_c", Kind: "unblocked", Title: "“Work tsk_c” is ready to start", Action: AlertFocus, Items: []AlertItem{{ID: "tsk_c", Name: "Work tsk_c"}}, LogID: "dec_alerts"},
			{Key: "stale:tsk_d", Kind: "stale", Title: "Idle", Action: AlertReview, Items: []AlertItem{{ID: "tsk_d", Name: "Work tsk_d"}}},
			{Key: "inbox", Kind: "inbox", Title: "Inbox", Action: AlertClarify, Items: []AlertItem{{ID: "tsk_x", Name: "x"}}},
		}
	})
	day := time.Now().Format("2006-01-02")
	job := &models.Job{UserID: user, Kind: models.JobSmartAlerts, Payload: models.JobPayload{"date": day}}
	if err := svc.HandleSmartAlerts(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	var sent []models.Notification
	db.Where("user_id = ? AND category = ?", user, models.NotifySuggestion).Order("created_at").Find(&sent)
	if len(sent) != 3 || len(skipped[0]) != 0 {
		t.Fatalf("sent %d, first skip %v", len(sent), skipped[0])
	}
	byKey := map[string]models.Notification{}
	for _, n := range sent {
		byKey[strings.TrimPrefix(*n.DedupeKey, "suggestion:"+user+":"+day+":")] = n
	}
	project, focus := byKey["project:pr_1"], byKey["unblocked:tsk_c"]
	if project.EntityID != nil || project.Data.String("projectId") != "pr_1" || project.Data.String("action") != AlertReview || project.DeliveredAt == nil {
		t.Fatalf("project alert %+v", project)
	}
	if focus.EntityID == nil || *focus.EntityID != "tsk_c" || focus.Data.String("kind") != "unblocked" || focus.Data.String("logId") != "dec_alerts" {
		t.Fatalf("focus alert %+v", focus)
	}

	// The same day again sends nothing new, and this week's Work is skipped.
	if err := svc.HandleSmartAlerts(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&models.Notification{}).Where("user_id = ? AND category = ?", user, models.NotifySuggestion).Count(&count)
	if count != 3 || !skipped[1]["tsk_a"] || !skipped[1]["tsk_c"] || !skipped[1]["tsk_d"] || skipped[1]["tsk_x"] {
		t.Fatalf("count %d, skip %v", count, skipped[1])
	}

	// A retried job never goes past three alerts for the day.
	svc.SetAlerts(func(context.Context, string, time.Time, map[string]bool, map[string]bool) []Alert {
		return []Alert{{Key: "stale:new", Kind: "stale", Title: "New", Action: AlertReview, Items: []AlertItem{{ID: "tsk_new", Name: "New"}}}}
	})
	if err := svc.HandleSmartAlerts(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	db.Model(&models.Notification{}).Where("user_id = ? AND category = ?", user, models.NotifySuggestion).Count(&count)
	if count != 3 {
		t.Fatalf("retry sent past the cap: %d", count)
	}

	// A step that does not fit the alert's kind never runs.
	if _, err := svc.ApplyTriage(user, project.ID, AlertClarify); err == nil {
		t.Fatal("clarify ran on a project alert")
	}
	message, err := svc.ApplyTriage(user, focus.ID, AlertFocus)
	if err != nil || message != "Added to today's Focus" {
		t.Fatalf("focus: %q %v", message, err)
	}
	if len(kept) != 1 || kept[0] != "dec_alerts" {
		t.Fatalf("feedback %v", kept)
	}
	var item models.Task
	db.First(&item, "id = ?", "tsk_c")
	if item.TodayFocusOn == nil || models.NormalizeDate(*item.TodayFocusOn) != svc.notificationToday(user).Date() {
		t.Fatalf("focus day %v", item.TodayFocusOn)
	}
	if message, err := svc.ApplyTriage(user, project.ID, AlertReview); err != nil || message != "" {
		t.Fatalf("review: %q %v", message, err)
	}
	db.First(&project, "id = ?", project.ID)
	if project.ReadAt == nil {
		t.Fatal("review left the alert unread")
	}
	if _, err := svc.ApplyTriage(user, focus.ID, "extend"); err == nil {
		t.Fatal("an overdue step ran on a smart alert")
	}

	// With smart suggestions off the day's job asks for no alerts.
	svc.SetDecisions(func(context.Context, string) bool { return false }, nil)
	asked := len(skipped)
	if err := svc.HandleSmartAlerts(context.Background(), job); err != nil || len(skipped) != asked {
		t.Fatalf("asked with suggestions off: %d %v", len(skipped)-asked, err)
	}
	svc.SetDecisions(func(context.Context, string) bool { return true }, nil)

	// Turned off: no alerts are asked for.
	off := false
	if err := db.Model(&models.Config{}).Where("user_id = ?", user).Update("notification_settings", models.NotificationSettings{Reminders: true, SmartAlerts: &off}).Error; err != nil {
		t.Fatal(err)
	}
	svc.SetAlerts(func(_ context.Context, _ string, _ time.Time, skip, _ map[string]bool) []Alert {
		skipped = append(skipped, skip)
		return nil
	})
	if err := svc.HandleSmartAlerts(context.Background(), job); err != nil || len(skipped) != 2 {
		t.Fatalf("asked while off: %d %v", len(skipped), err)
	}
}

type todayStub struct {
	calendar.Service
	today *calendar.TodayResponse
}

func (s todayStub) Today(string, string, string) (*calendar.TodayResponse, error) {
	return s.today, nil
}

// The morning briefing names the top items Smart suggestions pick, then sends.
func TestIntegrationMorningBriefingNamesTopItems(t *testing.T) {
	_, db := zoneService(t, models.NotificationSettings{DigestMorning: true})
	date := time.Now().Format("2006-01-02")
	overdue := time.Now().AddDate(0, 0, -2).Format("2006-01-02")
	high := models.PriorityHigh
	start := time.Date(2026, 10, 10, 10, 0, 0, 0, time.UTC)
	today := &calendar.TodayResponse{Date: date, Timezone: "UTC",
		Overdue: []models.Task{{ID: "tsk_rent", Name: "Pay rent", Deadline: &overdue, PriorityLevel: &high}},
		Items:   []calendar.Item{{ID: "evt_1", Kind: "event", EventID: "evt_1", Title: "Board meeting", Start: start}, {ID: "blk_1", TaskID: "tsk_plants", Title: "Water plants", Start: start.Add(8 * time.Hour)}},
	}
	svc := NewService(db, jobs.NewQueue(db), todayStub{today: today}, nil, nil, nil)
	var got []BriefItem
	svc.SetBriefing(func(_ context.Context, _ string, items []BriefItem) []int {
		got = items
		return []int{1, 0, 7}
	})
	job := &models.Job{UserID: zoneTestUser, Kind: models.JobDailyDigest, DedupeKey: ptrTo("digest:morning:" + date),
		Payload: models.JobPayload{"kind": "morning", "date": date, "timezone": "UTC"}}
	if err := svc.HandleDigest(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	svc.triageWait.Wait()
	if len(got) != 3 || got[0].Note != "past its deadline by 2 days, priority high" || got[1].Note != "calendar event at 10:00" {
		t.Fatalf("items %+v", got)
	}
	var ntf models.Notification
	db.Where("dedupe_key = ?", *job.DedupeKey).First(&ntf)
	if !strings.HasPrefix(ntf.Body, "Top today: Board meeting at 10:00 and Pay rent. On the calendar: 2.") || ntf.DeliveredAt == nil {
		t.Fatalf("briefing %q delivered %v", ntf.Body, ntf.DeliveredAt)
	}
	// A fallback push is queued in case the background send never finishes.
	if !svc.queue.HasJob("push:" + ntf.ID) {
		t.Fatal("no fallback push for the briefing")
	}

	// With nothing picked the briefing still goes out as before.
	svc.SetBriefing(func(context.Context, string, []BriefItem) []int { return nil })
	job.DedupeKey = ptrTo("digest:morning:again")
	if err := svc.HandleDigest(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	svc.triageWait.Wait()
	var plain models.Notification
	db.Where("dedupe_key = ?", *job.DedupeKey).First(&plain)
	if !strings.HasPrefix(plain.Body, "On the calendar: 2.") || plain.DeliveredAt == nil {
		t.Fatalf("plain %q delivered %v", plain.Body, plain.DeliveredAt)
	}

	// With smart suggestions off the briefing is sent inline, never asked.
	asked := false
	svc.SetBriefing(func(context.Context, string, []BriefItem) []int { asked = true; return nil })
	svc.SetDecisions(func(context.Context, string) bool { return false }, nil)
	job.DedupeKey = ptrTo("digest:morning:off")
	if err := svc.HandleDigest(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	var off models.Notification
	db.Where("dedupe_key = ?", *job.DedupeKey).First(&off)
	if asked || off.DeliveredAt == nil || svc.queue.HasJob("push:"+off.ID) {
		t.Fatalf("off: asked %v delivered %v", asked, off.DeliveredAt)
	}
}
