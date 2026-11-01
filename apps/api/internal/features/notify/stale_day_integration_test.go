package notify

import (
	"context"
	"testing"
	"time"

	"timely-api/internal/features/calendar"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
)

// GB11: retrying a smart alerts job from an earlier day sent three more
// alerts today, past the three-a-day cap, since the cap counted that day's.
// GB26: alerts were written for Work a restore removed while smart
// suggestions were still answering.
func TestIntegrationSmartAlertsSkipEarlierDaysAndGoneWork(t *testing.T) {
	_, db := zoneService(t, models.NotificationSettings{Reminders: true})
	svc := NewService(db, jobs.NewQueue(db), nil, nil, nil, nil)
	user := zoneTestUser
	done := time.Now().Format(time.RFC3339)
	for _, row := range []models.Task{
		{ID: "tsk_open", Name: "Send the invoice", Kind: models.KindTask, UserID: &user},
		{ID: "tsk_done", Name: "Book the venue", Kind: models.KindTask, UserID: &user, CompletedAt: &done},
	} {
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	calls := 0
	svc.SetAlerts(func(context.Context, string, time.Time, map[string]bool, map[string]bool) ([]Alert, error) {
		calls++
		return []Alert{
			{Key: "stale:tsk_open", Kind: "stale", Title: "Idle", Action: AlertReview, Items: []AlertItem{{ID: "tsk_open", Name: "Send the invoice"}}},
			{Key: "stale:tsk_done", Kind: "stale", Title: "Idle", Action: AlertReview, Items: []AlertItem{{ID: "tsk_done", Name: "Book the venue"}}},
			{Key: "stale:tsk_gone", Kind: "stale", Title: "Idle", Action: AlertReview, Items: []AlertItem{{ID: "tsk_gone", Name: "Removed by a restore"}}},
		}, nil
	})
	sent := func() []models.Notification {
		var rows []models.Notification
		db.Where("user_id = ? AND category = ?", user, models.NotifySuggestion).Find(&rows)
		return rows
	}

	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	if err := svc.HandleSmartAlerts(context.Background(), &models.Job{UserID: user, Kind: models.JobSmartAlerts, Payload: models.JobPayload{"date": yesterday}}); err != nil {
		t.Fatal(err)
	}
	if calls != 0 || len(sent()) != 0 {
		t.Fatalf("yesterday's job asked %d times and sent %d alerts", calls, len(sent()))
	}

	today := time.Now().Format("2006-01-02")
	if err := svc.HandleSmartAlerts(context.Background(), &models.Job{UserID: user, Kind: models.JobSmartAlerts, Payload: models.JobPayload{"date": today}}); err != nil {
		t.Fatal(err)
	}
	rows := sent()
	if len(rows) != 1 || *rows[0].DedupeKey != "suggestion:"+user+":"+today+":stale:tsk_open" {
		t.Fatalf("sent %+v; want only the alert about open Work", rows)
	}
}

// countingToday is a calendar that counts the days it was asked about.
type countingToday struct {
	calendar.Service
	asked *int
}

func (c countingToday) Today(string, string, string) (*calendar.TodayResponse, error) {
	*c.asked++
	return &calendar.TodayResponse{}, nil
}

// GB29: retrying an old morning digest sent a new "Plan your day" now, with
// today's counts and a briefing that read the old date.
func TestIntegrationDigestForAnEarlierDayIsSkipped(t *testing.T) {
	_, db := zoneService(t, models.NotificationSettings{DigestMorning: true})
	asked := 0
	svc := NewService(db, jobs.NewQueue(db), countingToday{asked: &asked}, nil, nil, nil)
	old := time.Now().AddDate(0, 0, -3).Format("2006-01-02")
	key := "digest:morning:" + zoneTestUser + ":" + old
	job := &models.Job{UserID: zoneTestUser, Kind: models.JobDailyDigest, DedupeKey: &key,
		Payload: models.JobPayload{"kind": "morning", "date": old, "timezone": "UTC"}}
	if err := svc.HandleDigest(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	var n int64
	db.Model(&models.Notification{}).Where("user_id = ?", zoneTestUser).Count(&n)
	if asked != 0 || n != 0 {
		t.Fatalf("an old digest read the day %d times and sent %d notifications", asked, n)
	}

	today := time.Now().Format("2006-01-02")
	todayKey := "digest:morning:" + zoneTestUser + ":" + today
	job = &models.Job{UserID: zoneTestUser, Kind: models.JobDailyDigest, DedupeKey: &todayKey,
		Payload: models.JobPayload{"kind": "morning", "date": today, "timezone": "UTC"}}
	if err := svc.HandleDigest(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	svc.triageWait.Wait()
	db.Model(&models.Notification{}).Where("user_id = ?", zoneTestUser).Count(&n)
	if asked != 1 || n != 1 {
		t.Fatalf("today's digest read the day %d times and sent %d notifications", asked, n)
	}
}
