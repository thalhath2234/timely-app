package notify

import (
	"context"
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

// Snoozing a reminder for 15 minutes sends it again once, 15 minutes later:
// not on the worker's next poll, and not a second time from the sweep. The
// snoozed notification keeps its row (and dedupe key), so the sweep never
// sends the original time again. The phone saw the snoozed copy 5 seconds
// after tapping 15m because the worker claimed jobs by the database clock,
// which ran ahead of the API's.
func TestIntegrationSnoozedReminderWaitsForItsTime(t *testing.T) {
	_, db := zoneService(t, models.NotificationSettings{Reminders: true})
	tasks := task.NewTaskRepository(db)
	sched := schedule.NewRepository(db)
	place := placement.New(db, sched.GetWorkingHours)
	indexer := embed.New(db)
	taskService := task.NewTaskService(tasks, project.NewProjectRepository(db), workspace.NewWorkspaceRepository(db), recurrence.NewStore(db), place, indexer)
	cal := calendar.NewService(tasks, event.NewEventRepository(db), sched.GetWorkingHours)
	queue := jobs.NewQueue(db)
	svc := NewService(db, queue, cal, taskService, schedule.NewService(sched, tasks, event.NewEventRepository(db), place), indexer)
	ctx := context.Background()

	user := zoneTestUser
	now := time.Now().UTC().Truncate(time.Second)
	due := now.Add(-20 * time.Second).Format(time.RFC3339)
	if err := db.Create(&models.Task{ID: "tsk_snooze", Name: "Call the bank", Kind: models.KindReminder, ScheduledOn: &due, UserID: &user}).Error; err != nil {
		t.Fatal(err)
	}

	reminderJobs := func() []models.Job {
		t.Helper()
		var rows []models.Job
		if err := db.Where("kind = ?", models.JobSendReminder).Order("run_at").Find(&rows).Error; err != nil {
			t.Fatal(err)
		}
		return rows
	}
	reminders := func() []models.Notification {
		t.Helper()
		var rows []models.Notification
		if err := db.Where("category = ?", models.NotifyReminder).Order("created_at").Find(&rows).Error; err != nil {
			t.Fatal(err)
		}
		return rows
	}
	sweep := func(at time.Time) {
		t.Helper()
		if err := svc.sweepReminders(user, at); err != nil {
			t.Fatal(err)
		}
	}
	// runDue runs every job the worker would claim right now.
	runDue := func() int {
		t.Helper()
		n := 0
		for {
			job, err := queue.Claim(ctx, "test")
			if err != nil {
				t.Fatal(err)
			}
			if job == nil {
				return n
			}
			n++
			if job.Kind == models.JobSendReminder {
				if err := svc.HandleReminder(ctx, job); err != nil {
					t.Fatal(err)
				}
			}
			if err := queue.Succeed(job); err != nil {
				t.Fatal(err)
			}
		}
	}

	// The reminder comes due and goes out.
	sweep(now)
	if got := runDue(); got != 1 {
		t.Fatalf("the due reminder ran %d jobs, want 1", got)
	}
	sent := reminders()
	if len(sent) != 1 {
		t.Fatalf("want 1 reminder notification, got %d", len(sent))
	}

	// Tap 15m.
	snoozed, err := svc.Snooze(user, sent[0].ID, SnoozeInput{Minutes: 15})
	if err != nil {
		t.Fatal(err)
	}
	if snoozed.ID != sent[0].ID || snoozed.SnoozedUntil == nil || snoozed.ReadAt == nil {
		t.Fatalf("snooze did not mark the original notification: %+v", snoozed)
	}
	until := snoozed.SnoozedUntil.UTC()
	if d := until.Sub(now); d < 14*time.Minute || d > 16*time.Minute {
		t.Fatalf("snoozed until %s, want about 15 minutes after %s", until, now)
	}

	// The next polls and sweeps in the following minute send nothing.
	for _, after := range []time.Duration{5 * time.Second, 30 * time.Second, 60 * time.Second} {
		sweep(now.Add(after))
		if got := runDue(); got != 0 {
			t.Fatalf("%s after snoozing, %d jobs ran; the snoozed reminder went out early", after, got)
		}
	}
	if got := reminders(); len(got) != 1 || got[0].SnoozedUntil == nil {
		t.Fatalf("after snoozing: %d reminder notifications, want only the snoozed original", len(got))
	}
	queued := reminderJobs()
	if len(queued) != 2 || queued[1].Status != models.JobPending || queued[1].RunAt.Sub(until).Abs() > time.Second {
		t.Fatalf("want the sent job and one pending job at %s, got %+v", until, queued)
	}

	// At the snoozed time the sweep finds the moved reminder and reuses the
	// pending job; the reminder goes out once.
	sweep(until)
	if got := len(reminderJobs()); got != 2 {
		t.Fatalf("the sweep at the snoozed time queued a second job: %d reminder jobs", got)
	}
	job, err := queue.Claim(ctx, "test")
	if err != nil {
		t.Fatal(err)
	}
	if job != nil {
		t.Fatalf("the snoozed job was claimable before its time: %+v", job)
	}
	queued = reminderJobs()
	if err := svc.HandleReminder(ctx, &queued[1]); err != nil {
		t.Fatal(err)
	}
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(queue.Succeed(&queued[1]))
	sweep(until.Add(10 * time.Second))
	if got := reminders(); len(got) != 2 {
		t.Fatalf("want the original and one snoozed reminder, got %d", len(got))
	}
	if got := len(reminderJobs()); got != 2 {
		t.Fatalf("the reminder was queued again after it went out: %d jobs", got)
	}
}
