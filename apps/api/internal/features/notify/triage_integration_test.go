package notify

import (
	"context"
	"testing"

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

// An overdue notification carries the suggested step in its text and data,
// and the step runs from the notification.
func TestIntegrationOverdueTriageSuggestsAndApplies(t *testing.T) {
	_, db := zoneService(t, models.NotificationSettings{Reminders: true})
	tasks := task.NewTaskRepository(db)
	sched := schedule.NewRepository(db)
	place := placement.New(db, sched.GetWorkingHours)
	indexer := embed.New(db)
	taskService := task.NewTaskService(tasks, project.NewProjectRepository(db), workspace.NewWorkspaceRepository(db), recurrence.NewStore(db), place, indexer)
	svc := NewService(db, jobs.NewQueue(db), nil, taskService, schedule.NewService(sched, tasks, event.NewEventRepository(db), place), indexer)

	user := zoneTestUser
	ws := models.Workspace{ID: "ws_triage", Name: "Home", UserID: &user}
	if err := db.Create(&ws).Error; err != nil {
		t.Fatal(err)
	}
	today := svc.notificationToday(user)
	deadline := today.Now().AddDate(0, 0, -3).Format("2006-01-02")
	high := models.PriorityHigh
	item := models.Task{ID: "tsk_triage", Name: "Send the invoice", Kind: models.KindTask, Duration: 30, UserID: &user, WorkspaceID: &ws.ID, Deadline: &deadline, PriorityLevel: &high}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}

	var asked struct {
		kind string
		days int
	}
	svc.SetTriage(func(_ context.Context, _ string, _ *models.Task, kind string, days int) string {
		asked.kind, asked.days = kind, days
		return "extend"
	})
	job := &models.Job{UserID: user, Kind: models.JobOverdueTask, DedupeKey: ptrTo("overdue:tsk_triage:" + deadline),
		Payload: models.JobPayload{"taskId": item.ID, "deadline": deadline}}
	if err := svc.HandleOverdueTask(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	var ntf models.Notification
	if err := db.Where("user_id = ? AND category = ?", user, models.NotifyOverdue).First(&ntf).Error; err != nil {
		t.Fatal(err)
	}
	if asked.kind != "overdue" || asked.days != 3 || ntf.Data.String("suggest") != "extend" || ntf.Body != "Past deadline. Suggested: move the deadline a week later." {
		t.Fatalf("asked %+v, notification %q %+v", asked, ntf.Body, ntf.Data)
	}

	message, err := svc.ApplyTriage(user, ntf.ID, "extend")
	if err != nil {
		t.Fatal(err)
	}
	var after models.Task
	db.First(&after, "id = ?", item.ID)
	if want := today.Now().AddDate(0, 0, 7).Format("2006-01-02"); models.NormalizeDate(*after.Deadline) != want || message == "" {
		t.Fatalf("deadline %s, message %q", *after.Deadline, message)
	}
	db.First(&ntf, "id = ?", ntf.ID)
	if ntf.ReadAt == nil {
		t.Fatal("the notification stayed unread")
	}

	if _, err := svc.ApplyTriage(user, ntf.ID, "lower"); err != nil {
		t.Fatal(err)
	}
	db.First(&after, "id = ?", item.ID)
	if *after.PriorityLevel != models.PriorityMedium {
		t.Fatalf("priority %s", *after.PriorityLevel)
	}
	if _, err := svc.ApplyTriage(user, ntf.ID, "nonsense"); err == nil {
		t.Fatal("an unknown step ran")
	}

	// Without a suggestion the notification reads as before.
	svc.SetTriage(func(context.Context, string, *models.Task, string, int) string { return "" })
	past := today.Now().AddDate(0, 0, -1).Format("2006-01-02")
	db.Model(&models.Task{}).Where("id = ?", item.ID).Update("deadline", past)
	job.DedupeKey, job.Payload = ptrTo("overdue:tsk_triage:"+past), models.JobPayload{"taskId": item.ID, "deadline": past}
	if err := svc.HandleOverdueTask(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	var plain models.Notification
	db.Where("dedupe_key = ?", *job.DedupeKey).First(&plain)
	if plain.Body != "Past deadline. Reschedule as urgent?" || plain.Data.String("suggest") != "" {
		t.Fatalf("plain %q %+v", plain.Body, plain.Data)
	}
}

func ptrTo(s string) *string { return &s }
