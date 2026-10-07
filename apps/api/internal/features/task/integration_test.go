package task

import (
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	_ "timely-api/internal/database" // sets goose's embedded migrations
	"timely-api/internal/features/placement"
	"timely-api/internal/features/project"
	"timely-api/internal/features/workspace"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"
	"timely-api/internal/utils"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const (
	kindTestUser = "usr_kind_test"
	kindPing     = "2026-12-02T10:00:00Z"
)

type kindFixture struct {
	t         *testing.T
	db        *gorm.DB
	svc       *taskService
	workspace string
	project   string
	status    string
	stage     string
	label     string
}

// newKindFixture migrates an isolated PostgreSQL schema and seeds one account
// with a workspace, status, project, stage and label, so Create and Clarify
// run against the real tables, scope checks and constraints.
func newKindFixture(t *testing.T) *kindFixture {
	t.Helper()
	file := os.Getenv("CHAT_TEST_ENV")
	if file == "" {
		t.Skip("run make test-chat-integration")
	}
	env, err := godotenv.Read(file)
	if err != nil {
		t.Fatal(err)
	}
	u := &url.URL{Scheme: "postgres", Host: env["DB_HOST"] + ":" + env["DB_PORT"], Path: env["DB_NAME"], User: url.UserPassword(env["DB_USER"], env["DB_PASSWORD"])}
	q := url.Values{"sslmode": []string{env["DB_SSLMODE"]}}
	u.RawQuery = q.Encode()
	root, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal("test database unavailable")
	}
	schema := "task_kind_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err = root.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec("DROP SCHEMA " + schema + " CASCADE"); sqlDB, _ := root.DB(); sqlDB.Close() })
	q.Set("search_path", schema+",public")
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { sqlDB.Close() })
	goose.SetTableName(schema + ".goose_db_version")
	t.Cleanup(func() { goose.SetTableName("goose_db_version") })
	if err = goose.Up(sqlDB, "."); err != nil {
		t.Fatal(err)
	}

	user := kindTestUser
	f := &kindFixture{t: t, db: db, workspace: "wsp_kind_test", project: "prj_kind_test", status: "sts_kind_test", stage: "stg_kind_test", label: "lbl_kind_test"}
	for _, row := range []any{
		&models.User{ID: kindTestUser, Email: "kind@example.invalid", Password: "not-a-real-hash"},
		&models.Workspace{ID: f.workspace, Name: "Kind", UserID: &user},
		&models.Status{ID: f.status, Name: "Todo", WorkspaceID: f.workspace, IsDefault: true},
		&models.Project{ID: f.project, Title: "Project", WorkspaceID: &f.workspace},
		&models.Stage{ID: f.stage, Name: "Stage", ProjectID: &f.project},
		&models.Lable{ID: f.label, Name: "Label", WorkspaceID: f.workspace},
	} {
		if err = db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	f.svc = &taskService{
		taskRepo:    NewTaskRepository(db),
		projectRepo: project.NewProjectRepository(db),
		workspaces:  workspace.NewWorkspaceRepository(db),
		recurrence:  recurrence.NewStore(db),
		placement:   placement.New(db, nil),
	}
	return f
}

func (f *kindFixture) id(v string) *string { return &v }

// board returns a task payload that carries every board field.
func (f *kindFixture) board(kind string, duration int, scheduledOn *string) *models.Task {
	user := kindTestUser
	return &models.Task{
		Name: "Thing", Kind: kind, Duration: duration, ScheduledOn: scheduledOn, UserID: &user,
		WorkspaceID: f.id(f.workspace), ProjectID: f.id(f.project), StatusID: f.id(f.status), StageID: f.id(f.stage),
	}
}

func assertNoBoardFields(t *testing.T, got *models.Task) {
	t.Helper()
	if got.ProjectID != nil || got.StageID != nil {
		t.Fatalf("project=%v stage=%v, want none", got.ProjectID, got.StageID)
	}
	if got.StatusID != nil {
		t.Fatalf("status=%v, want none", *got.StatusID)
	}
}

func TestIntegrationCreateReminderDropsBoardFields(t *testing.T) {
	f := newKindFixture(t)
	got, err := f.svc.Create(f.board(models.KindReminder, 0, f.id(kindPing)), nil, nil)
	if err != nil {
		t.Fatalf("create reminder: %v", err)
	}
	if got.Kind != models.KindReminder || got.Duration != 0 {
		t.Fatalf("kind=%s duration=%d", got.Kind, got.Duration)
	}
	assertNoBoardFields(t, got)
	if got.WorkspaceID != nil {
		t.Fatalf("workspace=%v, a bare reminder keeps none", *got.WorkspaceID)
	}
}

func TestIntegrationCreateReminderWithLabelKeepsWorkspace(t *testing.T) {
	f := newKindFixture(t)
	in := f.board(models.KindReminder, 0, f.id(kindPing))
	in.LabelIDs = models.LabelInputs{{Id: f.label}}
	got, err := f.svc.Create(in, nil, nil)
	if err != nil {
		t.Fatalf("create reminder: %v", err)
	}
	if got.WorkspaceID == nil || *got.WorkspaceID != f.workspace {
		t.Fatalf("workspace=%v, want %s", got.WorkspaceID, f.workspace)
	}
	if got.ProjectID != nil || got.StageID != nil {
		t.Fatalf("project=%v stage=%v, want none", got.ProjectID, got.StageID)
	}
}

func TestIntegrationClarifyReminderDropsBoardFields(t *testing.T) {
	f := newKindFixture(t)
	inbox, err := f.svc.Capture(kindTestUser, "Call bank")
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	got, err := f.svc.Clarify(kindTestUser, inbox.ID, ClarifyInput{
		Kind: models.KindReminder, ScheduledOn: f.id(kindPing),
		WorkspaceID: f.id(f.workspace), ProjectID: f.id(f.project), StatusID: f.id(f.status), StageID: f.id(f.stage),
	})
	if err != nil {
		t.Fatalf("clarify: %v", err)
	}
	if got.Kind != models.KindReminder {
		t.Fatalf("kind=%s", got.Kind)
	}
	assertNoBoardFields(t, got)
	if _, err := f.svc.taskRepo.GetTaskById(inbox.ID); err == nil {
		t.Fatal("inbox item should be gone")
	}
}

func TestIntegrationCreateWorkRequiresWorkspace(t *testing.T) {
	f := newKindFixture(t)
	in := f.board(models.KindTask, 30, nil)
	in.WorkspaceID, in.ProjectID, in.StatusID, in.StageID = nil, nil, nil, nil
	if _, err := f.svc.Create(in, nil, nil); err != ErrWorkspaceRequired {
		t.Fatalf("error = %v, want %v", err, ErrWorkspaceRequired)
	}
	// Duration alone implies Work, so it needs a workspace too.
	in = f.board("", 30, nil)
	in.WorkspaceID = f.id("")
	if _, err := f.svc.Create(in, nil, nil); err != ErrWorkspaceRequired {
		t.Fatalf("inferred work error = %v, want %v", err, ErrWorkspaceRequired)
	}
	// The rule runs before field validation so callers see it first.
	in = f.board(models.KindTask, 0, nil)
	in.WorkspaceID = nil
	if _, err := f.svc.Create(in, nil, nil); err != ErrWorkspaceRequired {
		t.Fatalf("zero-duration error = %v, want %v", err, ErrWorkspaceRequired)
	}
}

func TestIntegrationCreateWorkKeepsBoardFields(t *testing.T) {
	f := newKindFixture(t)
	got, err := f.svc.Create(f.board(models.KindTask, 30, nil), nil, nil)
	if err != nil {
		t.Fatalf("create work: %v", err)
	}
	if got.ProjectID == nil || *got.ProjectID != f.project || got.StageID == nil || *got.StageID != f.stage ||
		got.StatusID == nil || *got.StatusID != f.status || got.WorkspaceID == nil {
		t.Fatalf("work lost board fields: %+v", got)
	}
}

func TestIntegrationCreateInboxClearsFields(t *testing.T) {
	f := newKindFixture(t)
	in := f.board(models.KindInbox, 45, f.id(kindPing))
	in.Deadline, in.StartDate, in.PriorityLevel = f.id("2026-12-05"), f.id("2026-12-01"), f.id("high")
	in.LabelIDs = models.LabelInputs{{Id: f.label}}
	got, err := f.svc.Create(in, nil, nil)
	if err != nil {
		t.Fatalf("create inbox: %v", err)
	}
	if got.Kind != models.KindInbox || got.Duration != 0 || got.ScheduledOn != nil || got.WorkspaceID != nil ||
		got.Deadline != nil || got.StartDate != nil || len(got.Labels) != 0 {
		t.Fatalf("inbox kept fields: %+v", got)
	}
	assertNoBoardFields(t, got)
	if got.PriorityLevel != nil && *got.PriorityLevel == "high" {
		t.Fatal("inbox kept priority")
	}
}

func TestIntegrationClarifyReminderClearsBogusBoardIDs(t *testing.T) {
	f := newKindFixture(t)
	inbox, err := f.svc.Capture(kindTestUser, "Call bank")
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	got, err := f.svc.Clarify(kindTestUser, inbox.ID, ClarifyInput{
		Kind: models.KindReminder, ScheduledOn: f.id(kindPing),
		WorkspaceID: f.id("wsp_missing"), ProjectID: f.id("prj_missing"), StatusID: f.id("sts_missing"), StageID: f.id("stg_missing"),
	})
	if err != nil {
		t.Fatalf("clarify: %v", err)
	}
	var stored models.Task
	if err := f.db.First(&stored, "id = ?", got.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.WorkspaceID != nil || stored.ProjectID != nil || stored.StatusID != nil || stored.StageID != nil {
		t.Fatalf("stored workspace=%v project=%v status=%v stage=%v, want all nil", stored.WorkspaceID, stored.ProjectID, stored.StatusID, stored.StageID)
	}
}

// blockSpans is the Blocks that hold a task's or an Event's time, by column.
func (f *kindFixture) blockSpans(column, id string) [][2]time.Time {
	f.t.Helper()
	var rows []models.ScheduledBlock
	if err := f.db.Where(column+" = ?", id).Order("start_at").Find(&rows).Error; err != nil {
		f.t.Fatal(err)
	}
	out := make([][2]time.Time, len(rows))
	for i, row := range rows {
		out[i] = [2]time.Time{row.StartAt, row.EndAt}
	}
	return out
}

// ADR 0010: setting scheduledOn on an existing Work is placing by hand. The
// task's own Blocks are replaced and other replaceable Work is pushed aside,
// while Pinned time and an Event's time stay and are overlapped.
func TestIntegrationUpdateScheduledOnPlacesByHand(t *testing.T) {
	f := newKindFixture(t)
	slot := func(hour int) string { return time.Date(2026, 12, 2, hour, 0, 0, 0, time.UTC).Format(time.RFC3339) }
	work := func(scheduledOn string) *models.Task {
		t.Helper()
		got, err := f.svc.Create(f.board(models.KindTask, 30, f.id(scheduledOn)), nil, nil)
		if err != nil {
			t.Fatalf("create work: %v", err)
		}
		return got
	}

	loose := work(slot(9))
	pinnedWork := work(slot(10))
	if err := f.db.Model(&models.Task{}).Where("id = ?", pinnedWork.ID).Update("schedule_locked", true).Error; err != nil {
		t.Fatal(err)
	}
	eventStart := time.Date(2026, 12, 2, 11, 0, 0, 0, time.UTC)
	event := &models.Event{ID: utils.NewEventID(), Title: "Dentist", StartAt: eventStart, EndAt: eventStart.Add(30 * time.Minute), Duration: 30, UserID: kindTestUser}
	if err := f.db.Create(event).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.svc.placement.PlaceEvent(kindTestUser, event); err != nil {
		t.Fatal(err)
	}
	mover := work(slot(15))
	pinnedSpans := f.blockSpans("task_id", pinnedWork.ID)
	eventSpans := f.blockSpans("event_id", event.ID)

	for _, hour := range []int{9, 10, 11} {
		on := slot(hour)
		if _, err := f.svc.Update(kindTestUser, mover.ID, TaskUpdate{ScheduledOn: &on}); err != nil {
			t.Fatalf("update scheduledOn %d:00: %v", hour, err)
		}
		own := f.blockSpans("task_id", mover.ID)
		if len(own) != 1 || !own[0][0].Equal(time.Date(2026, 12, 2, hour, 0, 0, 0, time.UTC)) {
			t.Fatalf("mover Blocks after moving to %d:00 = %v, want one starting there", hour, own)
		}
	}
	if got := f.blockSpans("task_id", loose.ID); len(got) != 0 {
		t.Fatalf("replaceable Work was not pushed aside: %v", got)
	}
	if got := f.blockSpans("task_id", pinnedWork.ID); len(got) != 1 || !got[0][0].Equal(pinnedSpans[0][0]) {
		t.Fatalf("Pinned Work changed: before %v, after %v", pinnedSpans, got)
	}
	if got := f.blockSpans("event_id", event.ID); len(got) != 1 || !got[0][0].Equal(eventSpans[0][0]) {
		t.Fatalf("Event time changed: before %v, after %v", eventSpans, got)
	}
}

func TestIntegrationUpdateWorkToReminderDropsBoardFields(t *testing.T) {
	f := newKindFixture(t)
	work, err := f.svc.Create(f.board(models.KindTask, 30, nil), nil, nil)
	if err != nil {
		t.Fatalf("create work: %v", err)
	}
	reminder := models.KindReminder
	got, err := f.svc.Update(kindTestUser, work.ID, TaskUpdate{Kind: &reminder, ScheduledOn: f.id(kindPing)})
	if err != nil {
		t.Fatalf("update to reminder: %v", err)
	}
	if got.Kind != models.KindReminder || got.Duration != 0 {
		t.Fatalf("kind=%s duration=%d", got.Kind, got.Duration)
	}
	assertNoBoardFields(t, got)
	if got.WorkspaceID != nil {
		t.Fatalf("workspace=%v, a bare reminder keeps none", *got.WorkspaceID)
	}
}

func TestIntegrationUpdateWorkToReminderWithLabelKeepsWorkspace(t *testing.T) {
	f := newKindFixture(t)
	in := f.board(models.KindTask, 30, nil)
	in.LabelIDs = models.LabelInputs{{Id: f.label}}
	work, err := f.svc.Create(in, nil, nil)
	if err != nil {
		t.Fatalf("create work: %v", err)
	}
	reminder := models.KindReminder
	got, err := f.svc.Update(kindTestUser, work.ID, TaskUpdate{Kind: &reminder, ScheduledOn: f.id(kindPing)})
	if err != nil {
		t.Fatalf("update to reminder: %v", err)
	}
	assertNoBoardFields(t, got)
	if got.WorkspaceID == nil || *got.WorkspaceID != f.workspace {
		t.Fatalf("workspace=%v, want %s kept for the label", got.WorkspaceID, f.workspace)
	}
}

func TestIntegrationDuplicateReminderCarriesItsPing(t *testing.T) {
	f := newKindFixture(t)
	reminder, err := f.svc.Create(f.board(models.KindReminder, 0, f.id(kindPing)), nil, nil)
	if err != nil {
		t.Fatalf("create reminder: %v", err)
	}
	copied, err := f.svc.Duplicate(kindTestUser, reminder.ID)
	if err != nil {
		t.Fatalf("duplicate reminder: %v", err)
	}
	if copied.ID == reminder.ID || copied.Kind != models.KindReminder || copied.Name != "Copy of Thing" {
		t.Fatalf("copy = %+v", copied)
	}
	if copied.ScheduledOn == nil || !sameInstant(t, *copied.ScheduledOn, kindPing) {
		t.Fatalf("copy ping = %v, want %s", copied.ScheduledOn, kindPing)
	}
}

// Cloning a project copies every task in it, including a Reminder that sits in
// the project (rows from before Reminders stopped carrying one).
func TestIntegrationCloneProjectCopiesReminder(t *testing.T) {
	f := newKindFixture(t)
	reminder, err := f.svc.Create(f.board(models.KindReminder, 0, f.id(kindPing)), nil, nil)
	if err != nil {
		t.Fatalf("create reminder: %v", err)
	}
	if err := f.db.Model(&models.Task{}).Where("id = ?", reminder.ID).Update("project_id", f.project).Error; err != nil {
		t.Fatal(err)
	}
	work, err := f.svc.Create(f.board(models.KindTask, 30, nil), nil, nil)
	if err != nil {
		t.Fatalf("create work: %v", err)
	}

	target := models.Project{ID: "prj_kind_clone", Title: "Clone", WorkspaceID: f.id(f.workspace)}
	targetStage := models.Stage{ID: "stg_kind_clone", Name: "Stage", ProjectID: &target.ID}
	for _, row := range []any{&target, &targetStage} {
		if err := f.db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	stageMap := map[string]string{f.stage: targetStage.ID}
	if err := f.svc.CopyProjectTasks(kindTestUser, f.project, target.ID, stageMap); err != nil {
		t.Fatalf("copy project tasks: %v", err)
	}

	var copies []models.Task
	if err := f.db.Where("name LIKE ?", "%Thing").Where("id NOT IN ?", []string{reminder.ID, work.ID}).Find(&copies).Error; err != nil {
		t.Fatal(err)
	}
	if len(copies) != 2 {
		t.Fatalf("copied %d tasks, want the Reminder and the Work", len(copies))
	}
	for _, c := range copies {
		if c.Kind != models.KindReminder {
			continue
		}
		if c.ScheduledOn == nil || !sameInstant(t, *c.ScheduledOn, kindPing) {
			t.Fatalf("cloned Reminder ping = %v, want %s", c.ScheduledOn, kindPing)
		}
		return
	}
	t.Fatal("the Reminder was not cloned")
}

func sameInstant(t *testing.T, a, b string) bool {
	t.Helper()
	left, err := time.Parse(time.RFC3339Nano, a)
	if err != nil {
		t.Fatalf("parse %q: %v", a, err)
	}
	right, err := time.Parse(time.RFC3339Nano, b)
	if err != nil {
		t.Fatalf("parse %q: %v", b, err)
	}
	return left.Equal(right)
}

func TestIntegrationDuplicateRepeatingReminderKeepsItsRule(t *testing.T) {
	f := newKindFixture(t)
	rec := &models.RecurrenceInput{RRule: "FREQ=DAILY", Dtstart: kindPing}
	reminder, err := f.svc.Create(f.board(models.KindReminder, 0, nil), nil, rec)
	if err != nil {
		t.Fatalf("create repeating reminder: %v", err)
	}
	copied, err := f.svc.Duplicate(kindTestUser, reminder.ID)
	if err != nil {
		t.Fatalf("duplicate repeating reminder: %v", err)
	}
	if !copied.IsRecurring() || copied.Recurrence == nil || copied.Recurrence.RRule != "FREQ=DAILY" {
		t.Fatalf("copy recurrence = %+v, want FREQ=DAILY", copied.Recurrence)
	}
}

// ADR 0004: the task that continues a series gets its scheduled_on mirror from
// Placement, in the same transaction as the row and its rule.
func TestIntegrationSplitContinuesSeriesThroughPlacement(t *testing.T) {
	f := newKindFixture(t)
	rec := &models.RecurrenceInput{RRule: "FREQ=DAILY", Dtstart: kindPing}
	source, err := f.svc.Create(f.board(models.KindTask, 30, nil), nil, rec)
	if err != nil {
		t.Fatalf("create series: %v", err)
	}
	from := "2026-12-05T10:00:00Z"
	next, err := f.svc.Split(kindTestUser, source.ID, SplitInput{FromStart: from})
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	if next.ID == source.ID || !next.IsRecurring() {
		t.Fatalf("continuation = %+v, want a new recurring task", next)
	}
	if next.ScheduledOn == nil || !sameInstant(t, *next.ScheduledOn, from) {
		t.Fatalf("continuation scheduled_on = %v, want the series start %s", next.ScheduledOn, from)
	}
	if got := f.blockSpans("task_id", next.ID); len(got) != 0 {
		t.Fatalf("a series holds no Blocks, got %v", got)
	}
}

// Every Working hours read (task, schedule, notify) goes through
// models.LoadWorkingHours: saved hours come back, and an account with no config
// row reports gorm.ErrRecordNotFound.
func TestIntegrationWorkingHoursReader(t *testing.T) {
	f := newKindFixture(t)
	if _, err := models.LoadWorkingHours(f.db, kindTestUser); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("no config row: err = %v, want gorm.ErrRecordNotFound", err)
	}
	saved := models.DefaultWorkingHours("Europe/Berlin")
	if err := f.db.Create(&models.Config{ID: "cfg_kind_test", UserID: kindTestUser, WorkingHours: saved}).Error; err != nil {
		t.Fatal(err)
	}
	got, err := f.svc.taskRepo.GetWorkingHours(kindTestUser)
	if err != nil {
		t.Fatalf("read saved hours: %v", err)
	}
	if got.Timezone != "Europe/Berlin" || got.IsEmpty() {
		t.Fatalf("hours = %+v, want the saved Europe/Berlin hours", got)
	}
}
