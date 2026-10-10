package notify

import (
	"context"
	"errors"
	"testing"
	"time"

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
	svc.triageWait.Wait()
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

	// The deadline is a week out now, so an old chip changes nothing.
	for _, step := range []string{"extend", "lower", "reschedule"} {
		if _, err := svc.ApplyTriage(user, ntf.ID, step); err == nil {
			t.Fatalf("%s ran on work no longer past its deadline", step)
		}
	}
	db.First(&after, "id = ?", item.ID)
	if *after.PriorityLevel != models.PriorityHigh {
		t.Fatalf("priority changed to %s", *after.PriorityLevel)
	}
	db.Model(&models.Task{}).Where("id = ?", item.ID).Update("deadline", deadline)
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
	svc.triageWait.Wait()
	var plain models.Notification
	db.Where("dedupe_key = ?", *job.DedupeKey).First(&plain)
	if plain.Body != "Past deadline. Reschedule as urgent?" || plain.Data.String("suggest") != "" {
		t.Fatalf("plain %q %+v", plain.Body, plain.Data)
	}
}

// Moving missed work the engine has no room for changes nothing: the
// hand-placed block stays and the step reports why.
func TestIntegrationMissedMoveWithoutRoomKeepsBlocks(t *testing.T) {
	_, db := zoneService(t, models.NotificationSettings{Reminders: true})
	tasks := task.NewTaskRepository(db)
	sched := schedule.NewRepository(db)
	place := placement.New(db, sched.GetWorkingHours)
	indexer := embed.New(db)
	taskService := task.NewTaskService(tasks, project.NewProjectRepository(db), workspace.NewWorkspaceRepository(db), recurrence.NewStore(db), place, indexer)
	svc := NewService(db, jobs.NewQueue(db), nil, taskService, schedule.NewService(sched, tasks, event.NewEventRepository(db), place), indexer)

	user := zoneTestUser
	ws := models.Workspace{ID: "ws_room", Name: "Home", UserID: &user}
	if err := db.Create(&ws).Error; err != nil {
		t.Fatal(err)
	}
	// One unbroken 20-hour stretch never fits a working day.
	item := models.Task{ID: "tsk_room", Name: "Write the thesis", Kind: models.KindTask, Duration: 1200, Contiguous: true, UserID: &user, WorkspaceID: &ws.ID}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	end := time.Now().Add(-time.Hour).UTC()
	block := models.ScheduledBlock{ID: "blk_room", TaskID: item.ID, UserID: user, StartAt: end.Add(-time.Hour), EndAt: end, Source: models.BlockSourceManual}
	if err := db.Create(&block).Error; err != nil {
		t.Fatal(err)
	}
	ntf, err := svc.repo.Upsert(&models.Notification{UserID: user, Category: models.NotifyMissed, Title: item.Name, Body: "missed",
		EntityType: ptrTo("task"), EntityID: &item.ID, Data: models.JobPayload{"taskId": item.ID}})
	if err != nil {
		t.Fatal(err)
	}
	for _, step := range []string{"move", "addtime"} {
		if _, err := svc.ApplyTriage(user, ntf.ID, step); err == nil {
			t.Fatalf("%s ran without room", step)
		}
	}
	var count int64
	db.Model(&models.ScheduledBlock{}).Where("task_id = ? AND source = ?", item.ID, models.BlockSourceManual).Count(&count)
	var after models.Task
	db.First(&after, "id = ?", item.ID)
	db.First(ntf, "id = ?", ntf.ID)
	if count != 1 || after.Duration != 1200 || ntf.ReadAt != nil {
		t.Fatalf("block kept %d, duration %d, read %v", count, after.Duration, ntf.ReadAt)
	}
}

// Moving missed work keeps the missed block as history and places the rest;
// time the person locked, or a repeating series, is left for the calendar.
func TestIntegrationMissedMoveKeepsHistoryAndRefusesLockedAndSeries(t *testing.T) {
	_, db := zoneService(t, models.NotificationSettings{Reminders: true})
	tasks := task.NewTaskRepository(db)
	sched := schedule.NewRepository(db)
	place := placement.New(db, sched.GetWorkingHours)
	indexer := embed.New(db)
	taskService := task.NewTaskService(tasks, project.NewProjectRepository(db), workspace.NewWorkspaceRepository(db), recurrence.NewStore(db), place, indexer)
	svc := NewService(db, jobs.NewQueue(db), nil, taskService, schedule.NewService(sched, tasks, event.NewEventRepository(db), place), indexer)

	user := zoneTestUser
	ws := models.Workspace{ID: "ws_history", Name: "Home", UserID: &user}
	if err := db.Create(&ws).Error; err != nil {
		t.Fatal(err)
	}
	missed := func(id string, blocks ...models.ScheduledBlock) *models.Notification {
		t.Helper()
		item := models.Task{ID: id, Name: id, Kind: models.KindTask, Duration: 30, UserID: &user, WorkspaceID: &ws.ID}
		if err := db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
		for i := range blocks {
			blocks[i].ID, blocks[i].TaskID, blocks[i].UserID, blocks[i].Source = "blk_"+id+string(rune('a'+i)), id, user, models.BlockSourceManual
			if err := db.Create(&blocks[i]).Error; err != nil {
				t.Fatal(err)
			}
		}
		ntf, err := svc.repo.Upsert(&models.Notification{UserID: user, Category: models.NotifyMissed, Title: id, Body: "missed",
			EntityType: ptrTo("task"), EntityID: &item.ID, Data: models.JobPayload{"taskId": item.ID}})
		if err != nil {
			t.Fatal(err)
		}
		return ntf
	}
	end := time.Now().Add(-time.Hour).UTC()
	past := models.ScheduledBlock{StartAt: end.Add(-time.Hour), EndAt: end}

	ntf := missed("tsk_history", past)
	if _, err := svc.ApplyTriage(user, ntf.ID, "move"); err != nil {
		t.Fatal(err)
	}
	var manual, engine int64
	db.Model(&models.ScheduledBlock{}).Where("task_id = ? AND source = ?", "tsk_history", models.BlockSourceManual).Count(&manual)
	db.Model(&models.ScheduledBlock{}).Where("task_id = ? AND source = ?", "tsk_history", models.BlockSourceEngine).Count(&engine)
	if manual != 1 || engine == 0 {
		t.Fatalf("manual %d engine %d, want the missed block kept and new time placed", manual, engine)
	}

	ahead := time.Now().Add(48 * time.Hour).UTC()
	ntf = missed("tsk_pinned", past, models.ScheduledBlock{StartAt: ahead, EndAt: ahead.Add(time.Hour), Locked: true})
	for _, step := range []string{"move", "addtime"} {
		if _, err := svc.ApplyTriage(user, ntf.ID, step); !errors.Is(err, errLocked) {
			t.Fatalf("%s on locked time: %v", step, err)
		}
	}
	var after models.Task
	db.First(&after, "id = ?", "tsk_pinned")
	if after.Duration != 30 {
		t.Fatalf("duration %d after a refused Add time", after.Duration)
	}

	ntf = missed("tsk_series")
	if err := db.Create(&models.RecurrenceRule{ID: "rr_series", OwnerType: "task", OwnerID: "tsk_series", UserID: user, RRule: "FREQ=DAILY", Dtstart: end.Add(-48 * time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	for _, step := range []string{"move", "addtime", "reschedule"} {
		if _, err := svc.ApplyTriage(user, ntf.ID, step); !errors.Is(err, errRepeats) {
			t.Fatalf("%s on a series: %v", step, err)
		}
	}
	db.First(&after, "id = ?", "tsk_series")
	if after.Duration != 30 {
		t.Fatalf("series duration %d", after.Duration)
	}
	if _, err := svc.ApplyTriage(user, ntf.ID, "lower"); err != nil {
		t.Fatal(err)
	}
}

func ptrTo(s string) *string { return &s }
