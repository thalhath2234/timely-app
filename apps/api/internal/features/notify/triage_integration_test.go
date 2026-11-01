package notify

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
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
	svc.triageGather = 0
	svc.SetTriage(func(_ context.Context, _ string, items []TriageItem) []string {
		asked.kind, asked.days = items[0].Kind, items[0].OverdueDays
		return []string{"extend"}
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
	svc.SetTriage(func(_ context.Context, _ string, items []TriageItem) []string { return make([]string, len(items)) })
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

	// A suggestion that comes back after the person acted on the
	// notification is dropped, so it cannot contradict what they did.
	acted := make(chan struct{})
	svc.SetTriage(func(_ context.Context, _ string, items []TriageItem) []string {
		<-acted
		return []string{"reschedule"}
	})
	late := today.Now().AddDate(0, 0, -2).Format("2006-01-02")
	db.Model(&models.Task{}).Where("id = ?", item.ID).Updates(map[string]any{"deadline": late, "priority_level": models.PriorityHigh})
	job.DedupeKey, job.Payload = ptrTo("overdue:tsk_triage:"+late), models.JobPayload{"taskId": item.ID, "deadline": late}
	if err := svc.HandleOverdueTask(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	var pending models.Notification
	db.Where("dedupe_key = ?", *job.DedupeKey).First(&pending)
	if _, err := svc.ApplyTriage(user, pending.ID, "lower"); err != nil {
		t.Fatal(err)
	}
	close(acted)
	svc.triageWait.Wait()
	db.First(&pending, "id = ?", pending.ID)
	if pending.Body != "Past deadline. Reschedule as urgent?" || pending.Data.String("suggest") != "" {
		t.Fatalf("a late suggestion rewrote an acted-on notification: %q %+v", pending.Body, pending.Data)
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

// Adding time to missed work keeps the missed block as it was: a block that
// would now end in the future must not be stretched and then replanned away.
func TestIntegrationMissedAddTimeKeepsHistory(t *testing.T) {
	_, db := zoneService(t, models.NotificationSettings{Reminders: true})
	tasks := task.NewTaskRepository(db)
	sched := schedule.NewRepository(db)
	place := placement.New(db, sched.GetWorkingHours)
	indexer := embed.New(db)
	taskService := task.NewTaskService(tasks, project.NewProjectRepository(db), workspace.NewWorkspaceRepository(db), recurrence.NewStore(db), place, indexer)
	svc := NewService(db, jobs.NewQueue(db), nil, taskService, schedule.NewService(sched, tasks, event.NewEventRepository(db), place), indexer)

	user := zoneTestUser
	ws := models.Workspace{ID: "ws_addtime", Name: "Home", UserID: &user}
	if err := db.Create(&ws).Error; err != nil {
		t.Fatal(err)
	}
	item := models.Task{ID: "tsk_addtime", Name: "Draft the email", Kind: models.KindTask, Duration: 30, UserID: &user, WorkspaceID: &ws.ID}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	// Ended five minutes ago; 45 minutes from its start would end in the future.
	end := time.Now().Add(-5 * time.Minute).UTC().Truncate(time.Second)
	block := models.ScheduledBlock{ID: "blk_addtime", TaskID: item.ID, UserID: user, StartAt: end.Add(-30 * time.Minute), EndAt: end, Source: models.BlockSourceManual}
	if err := db.Create(&block).Error; err != nil {
		t.Fatal(err)
	}
	ntf, err := svc.repo.Upsert(&models.Notification{UserID: user, Category: models.NotifyMissed, Title: item.Name, Body: "missed",
		EntityType: ptrTo("task"), EntityID: &item.ID, Data: models.JobPayload{"taskId": item.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ApplyTriage(user, ntf.ID, "addtime"); err != nil && !errors.Is(err, errNoTime) {
		t.Fatal(err)
	}
	var kept models.ScheduledBlock
	if err := db.First(&kept, "id = ?", block.ID).Error; err != nil {
		t.Fatalf("the missed block is gone: %v", err)
	}
	if !kept.EndAt.Equal(end) {
		t.Fatalf("missed block ends %v, want %v", kept.EndAt, end)
	}
}

// Finishing a task settles its overdue and missed notices, so they stop
// offering steps that would fail with "already done". A repeating task's
// missed notice and another task's notice stay unread.
func TestIntegrationDoneTaskSettlesAlerts(t *testing.T) {
	svc, db := zoneService(t, models.NotificationSettings{Reminders: true})
	user := zoneTestUser
	ws := models.Workspace{ID: "ws_settle", Name: "Home", UserID: &user}
	if err := db.Create(&ws).Error; err != nil {
		t.Fatal(err)
	}
	done := time.Now().UTC().Format(time.RFC3339)
	rows := []models.Task{
		{ID: "tsk_done", Name: "Send the invoice", Kind: models.KindTask, Duration: 30, UserID: &user, WorkspaceID: &ws.ID, CompletedAt: &done},
		{ID: "tsk_open", Name: "Draft the brief", Kind: models.KindTask, Duration: 30, UserID: &user, WorkspaceID: &ws.ID},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	add := func(id, category, entity string) {
		row := models.Notification{ID: id, UserID: user, Category: category, Title: id, EntityType: ptrTo("task"), EntityID: ptrTo(entity)}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	add("ntf_overdue_done", models.NotifyOverdue, "tsk_done")
	add("ntf_missed_done", models.NotifyMissed, "tsk_done")
	add("ntf_missed_gone", models.NotifyMissed, "tsk_deleted")
	add("ntf_overdue_open", models.NotifyOverdue, "tsk_open")
	add("ntf_reminder_done", models.NotifyReminder, "tsk_done")

	count, err := svc.UnreadCount(user)
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("unread %d, want the open task's overdue notice and the reminder", count)
	}
	list, err := svc.List(user, true, 50)
	if err != nil {
		t.Fatal(err)
	}
	unread := map[string]bool{}
	for _, row := range list {
		unread[row.ID] = true
	}
	if len(unread) != 2 || !unread["ntf_overdue_open"] || !unread["ntf_reminder_done"] {
		t.Fatalf("unread after settling: %v", unread)
	}
}

// A sweep of many overdue tasks is asked about in batches, one call at a time
// per account, so a backlog never takes every slot; and while two accounts'
// backlogs hold both triage slots, a third account's morning briefing still
// names its top items.
func TestIntegrationTriageBatchesAndNeverStarvesTheBriefing(t *testing.T) {
	_, db := zoneService(t, models.NotificationSettings{Reminders: true})
	tasks := task.NewTaskRepository(db)
	sched := schedule.NewRepository(db)
	place := placement.New(db, sched.GetWorkingHours)
	indexer := embed.New(db)
	taskService := task.NewTaskService(tasks, project.NewProjectRepository(db), workspace.NewWorkspaceRepository(db), recurrence.NewStore(db), place, indexer)
	date := time.Now().Format("2006-01-02")
	today := &calendar.TodayResponse{Date: date, Timezone: "UTC",
		Items: []calendar.Item{{ID: "evt_1", Kind: "event", EventID: "evt_1", Title: "Board meeting", Start: time.Date(2026, 10, 10, 10, 0, 0, 0, time.UTC)}}}
	svc := NewService(db, jobs.NewQueue(db), todayStub{today: today}, taskService, schedule.NewService(sched, tasks, event.NewEventRepository(db), place), indexer)
	svc.triageGather = 50 * time.Millisecond

	busy := []string{zoneTestUser, "usr_notify_backlog_test"}
	other := "usr_notify_brief_test"
	for _, row := range []any{
		&models.User{ID: busy[1], Email: "notify-backlog@example.invalid", Password: "not-a-real-hash"},
		&models.Config{ID: "cfg_notify_backlog_test", UserID: busy[1], NotificationSettings: models.NotificationSettings{Reminders: true}},
		&models.User{ID: other, Email: "notify-brief@example.invalid", Password: "not-a-real-hash"},
		&models.Config{ID: "cfg_notify_brief_test", UserID: other, NotificationSettings: models.NotificationSettings{DigestMorning: true}},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}

	release := make(chan struct{})
	var mu sync.Mutex
	batches := map[string][]int{}
	inFlight, most := map[string]int{}, map[string]int{}
	held := 0
	svc.SetTriage(func(_ context.Context, userID string, items []TriageItem) []string {
		mu.Lock()
		batches[userID] = append(batches[userID], len(items))
		inFlight[userID]++
		held++
		most[userID] = max(most[userID], inFlight[userID])
		mu.Unlock()
		<-release
		mu.Lock()
		inFlight[userID]--
		held--
		mu.Unlock()
		out := make([]string, len(items))
		for i := range out {
			out[i] = "lower"
		}
		return out
	})
	svc.SetBriefing(func(context.Context, string, []BriefItem) []int { return []int{0} })

	const backlog = 25
	for n, user := range busy {
		ws := models.Workspace{ID: fmt.Sprintf("ws_backlog_%d", n), Name: "Home", UserID: &user}
		if err := db.Create(&ws).Error; err != nil {
			t.Fatal(err)
		}
		deadline := svc.notificationToday(user).Now().AddDate(0, 0, -2).Format("2006-01-02")
		for i := 0; i < backlog; i++ {
			id := fmt.Sprintf("tsk_backlog_%d_%02d", n, i)
			if err := db.Create(&models.Task{ID: id, Name: "Imported " + id, Kind: models.KindTask, Duration: 30, UserID: &user, WorkspaceID: &ws.ID, Deadline: &deadline}).Error; err != nil {
				t.Fatal(err)
			}
			job := &models.Job{UserID: user, Kind: models.JobOverdueTask, DedupeKey: ptrTo("overdue:" + id + ":" + deadline),
				Payload: models.JobPayload{"taskId": id, "deadline": deadline}}
			if err := svc.HandleOverdueTask(context.Background(), job); err != nil {
				t.Fatal(err)
			}
		}
	}
	for start := time.Now(); time.Since(start) < 5*time.Second; time.Sleep(20 * time.Millisecond) {
		mu.Lock()
		full := held == triageParallel
		mu.Unlock()
		if full {
			break
		}
	}

	// Both triage slots are taken; the briefing does not wait behind them.
	brief := &models.Job{UserID: other, Kind: models.JobDailyDigest, DedupeKey: ptrTo("digest:morning:" + date),
		Payload: models.JobPayload{"kind": "morning", "date": date, "timezone": "UTC"}}
	if err := svc.HandleDigest(context.Background(), brief); err != nil {
		t.Fatal(err)
	}
	var ntf models.Notification
	for start := time.Now(); time.Since(start) < 5*time.Second; time.Sleep(50 * time.Millisecond) {
		db.Where("dedupe_key = ?", *brief.DedupeKey).First(&ntf)
		if strings.HasPrefix(ntf.Body, "Top today: Board meeting") {
			break
		}
	}
	mu.Lock()
	heldDuringBrief := held
	mu.Unlock()
	if heldDuringBrief != triageParallel || !strings.HasPrefix(ntf.Body, "Top today: Board meeting") {
		t.Fatalf("with %d triage slots held, the briefing reads %q", heldDuringBrief, ntf.Body)
	}

	close(release)
	svc.triageWait.Wait()
	for _, user := range busy {
		// In batches of at most ten: the first is what arrived within the
		// gather wait, the rest queued behind its call.
		asked := 0
		for _, n := range batches[user] {
			asked += n
			if n > triageBatch {
				t.Fatalf("a batch of %d", n)
			}
		}
		if most[user] != 1 || asked != backlog || len(batches[user]) > 4 {
			t.Fatalf("%s: batches %v, at most %d calls at once", user, batches[user], most[user])
		}
	}
	var suggested int64
	db.Model(&models.Notification{}).Where("category = ? AND body = ?", models.NotifyOverdue, "Past deadline. Suggested: lower its priority.").Count(&suggested)
	if suggested != 2*backlog {
		t.Fatalf("%d of %d notifications got their step", suggested, 2*backlog)
	}
}
