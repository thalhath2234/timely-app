package notify

import (
	"testing"
	"time"

	"timely-api/internal/features/calendar"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
)

type rangeStub struct {
	calendar.Service
	items []calendar.Item
}

func (s rangeStub) Range(_ string, from, to time.Time) (*calendar.Response, error) {
	var out []calendar.Item
	for _, item := range s.items {
		if !item.Start.Before(from) && item.Start.Before(to) {
			out = append(out, item)
		}
	}
	return &calendar.Response{Items: out}, nil
}

// A reminder that came due while the server was not sweeping (the computer
// slept, the app was closed) still goes out, once, but never one from an
// earlier day.
func TestIntegrationRemindersCatchUpAfterAGap(t *testing.T) {
	_, db := zoneService(t, models.NotificationSettings{Reminders: true})
	prev := time.Local
	t.Cleanup(func() { time.Local = prev })
	time.Local = time.UTC
	now := time.Date(2030, 3, 5, 9, 30, 0, 0, time.UTC)
	reminder := func(id string, at time.Time) calendar.Item {
		return calendar.Item{ID: id, Kind: "task", TaskID: id, Title: id, Start: at, Reminder: true}
	}
	stub := rangeStub{items: []calendar.Item{
		reminder("tsk_yesterday", now.Add(-11*time.Hour-30*time.Minute)),
		reminder("tsk_slept_through", now.Add(-90*time.Minute)),
		reminder("tsk_now", now.Add(30*time.Second)),
		reminder("tsk_later", now.Add(2*time.Hour)),
	}}
	svc := NewService(db, jobs.NewQueue(db), stub, nil, nil, nil)
	queued := func() map[string]bool {
		var rows []models.Job
		if err := db.Where("kind = ?", models.JobSendReminder).Find(&rows).Error; err != nil {
			t.Fatal(err)
		}
		got := map[string]bool{}
		for _, row := range rows {
			got[row.Payload.String("taskId")] = true
		}
		return got
	}
	sweep := func(at time.Time) {
		if err := svc.sweepReminders(zoneTestUser, at); err != nil {
			t.Fatal(err)
		}
	}

	sweep(now)
	got := queued()
	if !got["tsk_slept_through"] || !got["tsk_now"] || got["tsk_yesterday"] || got["tsk_later"] || len(got) != 2 {
		t.Fatalf("first sweep after start queued %v", got)
	}

	// Sent and then cleared from the notification center: it stays sent.
	db.Model(&models.Job{}).Where("kind = ?", models.JobSendReminder).Update("status", models.JobSucceeded)
	db.Where("1 = 1").Delete(&models.Notification{})
	sweep(now.Add(10 * time.Second))
	var count int64
	db.Model(&models.Job{}).Where("kind = ?", models.JobSendReminder).Count(&count)
	if count != 2 {
		t.Fatalf("a cleared reminder was queued again: %d jobs", count)
	}

	// Three hours with no sweep: the reminder due in that gap goes out late.
	sweep(now.Add(3 * time.Hour))
	if got = queued(); !got["tsk_later"] || got["tsk_yesterday"] || len(got) != 3 {
		t.Fatalf("sweep after a gap queued %v", got)
	}
}
