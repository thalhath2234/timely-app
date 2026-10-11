package placement

import (
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	_ "timely-api/internal/database" // sets goose's embedded migrations
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const testUser = "usr_placement_test"

// placementDB migrates an isolated PostgreSQL schema and seeds one account and
// workspace, so Placement runs against the real tables and constraints.
func placementDB(t *testing.T) (*gorm.DB, string) {
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
	schema := "placement_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err = db.Create(&models.User{ID: testUser, Email: "placement@example.invalid", Password: "not-a-real-hash"}).Error; err != nil {
		t.Fatal(err)
	}
	user := testUser
	ws := &models.Workspace{ID: "wsp_placement_test", Name: "Placement", UserID: &user}
	if err = db.Create(ws).Error; err != nil {
		t.Fatal(err)
	}
	return db, ws.ID
}

type fixture struct {
	t         *testing.T
	db        *gorm.DB
	workspace string
	svc       *Service
}

func newFixture(t *testing.T) *fixture {
	db, ws := placementDB(t)
	return &fixture{t: t, db: db, workspace: ws, svc: New(db, nil)}
}

func (f *fixture) task(kind string, duration int) *models.Task {
	f.t.Helper()
	user := testUser
	ws := f.workspace
	task := &models.Task{ID: utils.NewTaskID(), Name: "Work", Kind: kind, Duration: duration, UserID: &user, WorkspaceID: &ws}
	if err := f.db.Create(task).Error; err != nil {
		f.t.Fatal(err)
	}
	return task
}

func (f *fixture) event(start time.Time) *models.Event {
	f.t.Helper()
	event := &models.Event{ID: utils.NewEventID(), Title: "Dentist", StartAt: start, EndAt: start.Add(30 * time.Minute), Duration: 30, UserID: testUser}
	if err := f.db.Create(event).Error; err != nil {
		f.t.Fatal(err)
	}
	if err := f.svc.PlaceEvent(testUser, event); err != nil {
		f.t.Fatal(err)
	}
	return event
}

func (f *fixture) blocks(taskID string) []models.ScheduledBlock {
	f.t.Helper()
	var out []models.ScheduledBlock
	if err := f.db.Where("task_id = ?", taskID).Order("start_at").Find(&out).Error; err != nil {
		f.t.Fatal(err)
	}
	return out
}

func (f *fixture) eventBlocks(eventID string) int {
	f.t.Helper()
	var n int64
	if err := f.db.Model(&models.ScheduledBlock{}).Where("event_id = ?", eventID).Count(&n).Error; err != nil {
		f.t.Fatal(err)
	}
	return int(n)
}

// span is a Block's interval, compared by instant.
type span struct{ start, end time.Time }

func (f *fixture) spans(where string, id string) []span {
	f.t.Helper()
	var rows []models.ScheduledBlock
	if err := f.db.Where(where, id).Order("start_at").Find(&rows).Error; err != nil {
		f.t.Fatal(err)
	}
	out := make([]span, len(rows))
	for i, row := range rows {
		out[i] = span{row.StartAt, row.EndAt}
	}
	return out
}

func sameSpans(a, b []span) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if !a[i].start.Equal(b[i].start) || !a[i].end.Equal(b[i].end) {
			return false
		}
	}
	return true
}

func (f *fixture) reload(id string) *models.Task {
	f.t.Helper()
	var task models.Task
	if err := f.db.First(&task, "id = ?", id).Error; err != nil {
		f.t.Fatal(err)
	}
	return &task
}

func at(hour, minute int) time.Time {
	return time.Date(2026, 12, 2, hour, minute, 0, 0, time.UTC)
}

// placeByHand places a 30 minute Block for task starting at start.
func (f *fixture) placeByHand(task *models.Task, start time.Time, replace bool) {
	f.t.Helper()
	if err := f.svc.PlaceByHand(testUser, task, start, start.Add(30*time.Minute), replace); err != nil {
		f.t.Fatal(err)
	}
}

// ADR 0010: placing by hand pushes aside replaceable Work but keeps Pinned
// Blocks, Pinned Work, and an Event's time, and overlaps them instead.
func TestIntegrationPlaceByHandPushesAsideWorkButKeepsProtectedTime(t *testing.T) {
	f := newFixture(t)

	pinnedBlock := f.task(models.KindTask, 30)
	f.placeByHand(pinnedBlock, at(13, 0), false)
	if _, err := f.svc.PinBlock(testUser, f.blocks(pinnedBlock.ID)[0].ID, true); err != nil {
		t.Fatal(err)
	}

	pinnedTask := f.task(models.KindTask, 30)
	f.placeByHand(pinnedTask, at(14, 0), false)
	if err := f.db.Model(&models.Task{}).Where("id = ?", pinnedTask.ID).Update("schedule_locked", true).Error; err != nil {
		t.Fatal(err)
	}

	event := f.event(at(15, 0))

	loose := f.task(models.KindTask, 30)
	f.placeByHand(loose, at(16, 0), false)
	engine := f.task(models.KindTask, 30)
	if err := f.svc.ApplyAutoSchedule(testUser, AutoScheduleApply{
		CandidateIDs: []string{engine.ID},
		From:         at(0, 0), To: at(23, 59),
		Next:     []models.ScheduledBlock{{TaskID: engine.ID, UserID: testUser, StartAt: at(16, 0), EndAt: at(16, 30), Source: models.BlockSourceEngine}},
		Revision: func([]models.ScheduledBlock) (*models.ScheduleRevision, error) { return revision(), nil },
	}); err != nil {
		t.Fatal(err)
	}

	for _, slot := range []struct {
		name  string
		start time.Time
		keep  func() []span
	}{
		{"Pinned Block", at(13, 0), func() []span { return f.spans("task_id = ?", pinnedBlock.ID) }},
		{"Pinned Work", at(14, 0), func() []span { return f.spans("task_id = ?", pinnedTask.ID) }},
		{"Event", at(15, 0), func() []span { return f.spans("event_id = ?", event.ID) }},
	} {
		mover := f.task(models.KindTask, 30)
		before := slot.keep()
		f.placeByHand(mover, slot.start, false)
		if len(before) != 1 || !sameSpans(before, slot.keep()) {
			t.Fatalf("placing over a %s changed it: before %v, after %v", slot.name, before, slot.keep())
		}
		if len(f.blocks(mover.ID)) != 1 {
			t.Fatalf("the new Block over a %s was not kept", slot.name)
		}
	}

	mover := f.task(models.KindTask, 30)
	f.placeByHand(mover, at(16, 0), false)
	if len(f.blocks(loose.ID)) != 0 || len(f.blocks(engine.ID)) != 0 {
		t.Fatal("replaceable Work (Manual or Engine block) was not pushed aside")
	}
	if got := f.blocks(mover.ID); len(got) != 1 || got[0].Source != models.BlockSourceManual {
		t.Fatalf("new Block = %+v, want one Manual block", got)
	}
}

func TestIntegrationPlaceByHandReplaceSwapsTheTasksOwnBlocks(t *testing.T) {
	f := newFixture(t)
	task := f.task(models.KindTask, 30)
	f.placeByHand(task, at(9, 0), false)
	f.placeByHand(task, at(10, 0), false)
	if got := f.blocks(task.ID); len(got) != 2 || got[1].ChunkIndex != 1 {
		t.Fatalf("adding chunks gave %+v", got)
	}
	f.placeByHand(task, at(11, 0), true)
	got := f.blocks(task.ID)
	if len(got) != 1 || !got[0].StartAt.Equal(at(11, 0)) {
		t.Fatalf("replace gave %+v", got)
	}
	if on := f.reload(task.ID).ScheduledOn; on == nil || !at(11, 0).Equal(mustParse(t, *on)) {
		t.Fatalf("scheduled_on = %v, want the Block start", on)
	}
}

// PlaceWork (Clarify, task create) does not push
// aside overlapping Work; only placing by hand does. Do not merge the two
// without deciding the product question.
func TestIntegrationPlaceWorkDoesNotDisplaceOverlappingWork(t *testing.T) {
	f := newFixture(t)
	other := f.task(models.KindTask, 30)
	f.placeByHand(other, at(9, 0), false)

	task := f.task(models.KindTask, 30)
	if err := f.svc.PlaceWork(testUser, task, at(9, 0), 30); err != nil {
		t.Fatal(err)
	}
	if len(f.blocks(other.ID)) != 1 {
		t.Fatal("PlaceWork displaced another Work Block")
	}
	got := f.blocks(task.ID)
	if len(got) != 1 || got[0].Source != models.BlockSourceManual || !got[0].EndAt.Equal(at(9, 30)) {
		t.Fatalf("PlaceWork wrote %+v, want one 30 minute Manual block", got)
	}

	if err := f.svc.PlaceWork(testUser, task, at(11, 0), 45); err != nil {
		t.Fatal(err)
	}
	if got := f.blocks(task.ID); len(got) != 1 || !got[0].StartAt.Equal(at(11, 0)) || !got[0].EndAt.Equal(at(11, 45)) {
		t.Fatalf("PlaceWork again wrote %+v, want it to replace the earlier Block", got)
	}
}

func TestIntegrationPinBlockMakesItManualAndLocked(t *testing.T) {
	f := newFixture(t)
	task := f.task(models.KindTask, 30)
	if err := f.db.Create(&models.ScheduledBlock{ID: utils.NewBlockID(), TaskID: task.ID, UserID: testUser, StartAt: at(9, 0), EndAt: at(9, 30), Source: models.BlockSourceEngine}).Error; err != nil {
		t.Fatal(err)
	}
	block := f.blocks(task.ID)[0]
	pinned, err := f.svc.PinBlock(testUser, block.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if !pinned.Locked || pinned.Source != models.BlockSourceManual {
		t.Fatalf("returned %+v", pinned)
	}
	if saved := f.blocks(task.ID)[0]; !saved.Locked || saved.Source != models.BlockSourceManual {
		t.Fatalf("saved %+v", saved)
	}
	if _, err := f.svc.PinBlock(testUser, block.ID, false); err != nil {
		t.Fatal(err)
	}
	if f.blocks(task.ID)[0].Locked {
		t.Fatal("unpin left the Block locked")
	}
	if _, err := f.svc.PinBlock("usr_someone_else", block.ID, true); err == nil {
		t.Fatal("pinned another account's Block")
	}
}

func TestIntegrationMoveByHandKeepsLengthAndPushesAsideWork(t *testing.T) {
	f := newFixture(t)
	mover := f.task(models.KindTask, 45)
	if err := f.svc.PlaceByHand(testUser, mover, at(9, 0), at(9, 45), false); err != nil {
		t.Fatal(err)
	}
	loose := f.task(models.KindTask, 30)
	f.placeByHand(loose, at(12, 0), false)
	protected := f.task(models.KindTask, 30)
	f.placeByHand(protected, at(12, 30), false)
	if _, err := f.svc.PinBlock(testUser, f.blocks(protected.ID)[0].ID, true); err != nil {
		t.Fatal(err)
	}

	protectedBefore := f.spans("task_id = ?", protected.ID)
	moved, err := f.svc.MoveByHand(testUser, f.blocks(mover.ID)[0].ID, at(12, 0).Format(time.RFC3339), nil)
	if err != nil {
		t.Fatal(err)
	}
	if !moved.StartAt.Equal(at(12, 0)) || !moved.EndAt.Equal(at(12, 45)) || moved.Source != models.BlockSourceManual {
		t.Fatalf("moved to %+v", moved)
	}
	if len(f.blocks(loose.ID)) != 0 {
		t.Fatal("moving over replaceable Work did not push it aside")
	}
	if !sameSpans(protectedBefore, f.spans("task_id = ?", protected.ID)) || len(protectedBefore) != 1 {
		t.Fatal("moving over a Pinned Block changed it")
	}
	if _, err := f.svc.MoveByHand(testUser, moved.ID, "not a time", nil); err == nil {
		t.Fatal("accepted an invalid start")
	}
	end := at(11, 0).Format(time.RFC3339)
	if _, err := f.svc.MoveByHand(testUser, moved.ID, at(12, 0).Format(time.RFC3339), &end); err == nil {
		t.Fatal("accepted an end before the start")
	}
}

func TestIntegrationDeleteBlockAndClearWork(t *testing.T) {
	f := newFixture(t)
	task := f.task(models.KindTask, 30)
	f.placeByHand(task, at(9, 0), false)
	f.placeByHand(task, at(10, 0), false)

	if err := f.svc.DeleteBlock("usr_someone_else", f.blocks(task.ID)[0].ID); err == nil {
		t.Fatal("deleted another account's Block")
	}
	if err := f.svc.DeleteBlock(testUser, f.blocks(task.ID)[0].ID); err != nil {
		t.Fatal(err)
	}
	got := f.blocks(task.ID)
	if len(got) != 1 || !got[0].StartAt.Equal(at(10, 0)) {
		t.Fatalf("after delete: %+v", got)
	}
	if on := f.reload(task.ID).ScheduledOn; on == nil || !at(10, 0).Equal(mustParse(t, *on)) {
		t.Fatalf("scheduled_on = %v, want the remaining Block", on)
	}

	if err := f.svc.ClearTimes(testUser, f.reload(task.ID)); err != nil {
		t.Fatal(err)
	}
	if len(f.blocks(task.ID)) != 0 {
		t.Fatal("clear left Blocks behind")
	}
}

func TestIntegrationReminderPingIsNotABlock(t *testing.T) {
	f := newFixture(t)
	reminder := f.task(models.KindReminder, 0)
	if err := f.svc.PlacePing(testUser, reminder, at(8, 0)); err != nil {
		t.Fatal(err)
	}
	if len(f.blocks(reminder.ID)) != 0 {
		t.Fatal("a Reminder ping reserved a Block")
	}
	if on := f.reload(reminder.ID).ScheduledOn; on == nil || !at(8, 0).Equal(mustParse(t, *on)) {
		t.Fatalf("scheduled_on = %v, want the ping", on)
	}
	// PlaceWork with no duration is a ping too.
	if err := f.svc.PlaceWork(testUser, reminder, at(9, 0), 0); err != nil {
		t.Fatal(err)
	}
	if on := f.reload(reminder.ID).ScheduledOn; on == nil || !at(9, 0).Equal(mustParse(t, *on)) {
		t.Fatalf("scheduled_on = %v after PlaceWork", on)
	}
	if err := f.svc.ClearTimes(testUser, reminder); err != nil {
		t.Fatal(err)
	}
	if on := f.reload(reminder.ID).ScheduledOn; on != nil {
		t.Fatalf("clear left the ping %v", *on)
	}
}

func TestIntegrationPlaceSeriesDropsBlocksAndAnchorsTheStart(t *testing.T) {
	f := newFixture(t)
	task := f.task(models.KindTask, 30)
	f.placeByHand(task, at(9, 0), false)
	if err := f.svc.PlaceSeries(testUser, task, at(7, 0)); err != nil {
		t.Fatal(err)
	}
	if len(f.blocks(task.ID)) != 0 {
		t.Fatal("a series kept its one-off Blocks")
	}
	if on := f.reload(task.ID).ScheduledOn; on == nil || !at(7, 0).Equal(mustParse(t, *on)) {
		t.Fatalf("scheduled_on = %v, want the series start", on)
	}
}

// Apply writes Engine blocks and a revision together; Undo takes them back,
// restores what was replaced, and never touches Manual or Pinned blocks.
func TestIntegrationAutoScheduleApplyAndUndo(t *testing.T) {
	f := newFixture(t)
	task := f.task(models.KindTask, 30)
	manual := f.task(models.KindTask, 30)
	f.placeByHand(manual, at(9, 0), false)
	if err := f.db.Create(&models.ScheduledBlock{ID: utils.NewBlockID(), TaskID: task.ID, UserID: testUser, StartAt: at(10, 0), EndAt: at(10, 30), Source: models.BlockSourceEngine}).Error; err != nil {
		t.Fatal(err)
	}
	engineBefore := f.blocks(task.ID)[0]

	var replaced []models.ScheduledBlock
	rev := revision()
	err := f.svc.ApplyAutoSchedule(testUser, AutoScheduleApply{
		CandidateIDs: []string{task.ID},
		From:         at(0, 0), To: at(23, 59),
		Next: []models.ScheduledBlock{{TaskID: task.ID, UserID: testUser, StartAt: at(11, 0), EndAt: at(11, 30), Source: models.BlockSourceEngine}},
		Revision: func(r []models.ScheduledBlock) (*models.ScheduleRevision, error) {
			replaced = r
			return rev, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(replaced) != 1 || replaced[0].ID != engineBefore.ID {
		t.Fatalf("revision saw %+v, want the replaced Engine block", replaced)
	}
	if got := f.blocks(task.ID); len(got) != 1 || !got[0].StartAt.Equal(at(11, 0)) {
		t.Fatalf("after apply: %+v", got)
	}
	if len(f.blocks(manual.ID)) != 1 {
		t.Fatal("Apply touched a Manual block")
	}
	var revisions int64
	f.db.Model(&models.ScheduleRevision{}).Where("id = ?", rev.ID).Count(&revisions)
	if revisions != 1 {
		t.Fatal("Apply did not store the revision")
	}

	listed, err := f.svc.EngineBlocksInRange(testUser, []string{task.ID}, at(0, 0), at(23, 59))
	if err != nil || len(listed) != 1 {
		t.Fatalf("EngineBlocksInRange = %+v, %v", listed, err)
	}

	if err := f.svc.UndoAutoSchedule(testUser, AutoScheduleUndo{
		RevisionID: rev.ID, TaskIDs: []string{task.ID}, From: at(0, 0), To: at(23, 59), Restore: replaced,
	}); err != nil {
		t.Fatal(err)
	}
	if got := f.blocks(task.ID); len(got) != 1 || !got[0].StartAt.Equal(at(10, 0)) {
		t.Fatalf("after undo: %+v", got)
	}
	f.db.Model(&models.ScheduleRevision{}).Where("id = ?", rev.ID).Count(&revisions)
	if revisions != 0 {
		t.Fatal("Undo left the revision")
	}
	if len(f.blocks(manual.ID)) != 1 {
		t.Fatal("Undo touched a Manual block")
	}
}

// Apply keeps Engine blocks that start inside the freeze window, replaces a
// Manual block only for tasks the person agreed to replace, and a Block that
// merely ends where a new one starts is not displaced.
func TestIntegrationAutoScheduleApplyScope(t *testing.T) {
	f := newFixture(t)
	frozen := f.task(models.KindTask, 30)
	replaceable := f.task(models.KindTask, 30)
	kept := f.task(models.KindTask, 30)
	for _, b := range []models.ScheduledBlock{
		{TaskID: frozen.ID, StartAt: at(9, 0), EndAt: at(9, 30), Source: models.BlockSourceEngine},
		{TaskID: replaceable.ID, StartAt: at(12, 0), EndAt: at(12, 30), Source: models.BlockSourceManual},
		{TaskID: kept.ID, StartAt: at(13, 0), EndAt: at(13, 30), Source: models.BlockSourceManual},
	} {
		b.ID, b.UserID = utils.NewBlockID(), testUser
		if err := f.db.Create(&b).Error; err != nil {
			t.Fatal(err)
		}
	}
	err := f.svc.ApplyAutoSchedule(testUser, AutoScheduleApply{
		CandidateIDs: []string{frozen.ID, replaceable.ID},
		From:         at(0, 0), To: at(23, 59),
		FreezeUntil:      at(10, 0),
		ReplaceManualIDs: []string{replaceable.ID},
		Next:             []models.ScheduledBlock{{TaskID: replaceable.ID, UserID: testUser, StartAt: at(15, 0), EndAt: at(15, 30), Source: models.BlockSourceEngine}},
		Revision:         func([]models.ScheduledBlock) (*models.ScheduleRevision, error) { return revision(), nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := f.blocks(frozen.ID); len(got) != 1 || !got[0].StartAt.Equal(at(9, 0)) {
		t.Fatalf("frozen Engine block = %+v, want it kept", got)
	}
	if got := f.blocks(replaceable.ID); len(got) != 1 || !got[0].StartAt.Equal(at(15, 0)) {
		t.Fatalf("replaced task = %+v, want only the new Engine block", got)
	}
	if len(f.blocks(kept.ID)) != 1 {
		t.Fatal("Apply removed a Manual block it was not allowed to replace")
	}

	// A Block ending exactly where the new one starts stays.
	touching := f.task(models.KindTask, 30)
	f.placeByHand(touching, at(13, 30), false)
	if len(f.blocks(kept.ID)) != 1 {
		t.Fatal("placing next to a Block displaced it")
	}
}

// Replacing a task's Manual blocks removes only unlocked ones that end after
// From: past blocks are history and locked ones stay. The removed ones go in
// the revision, and Undo brings them back as Manual.
func TestIntegrationReplaceManualKeepsPastAndLockedAndUndoes(t *testing.T) {
	f := newFixture(t)
	task := f.task(models.KindTask, 30)
	blocks := []models.ScheduledBlock{
		{StartAt: at(8, 0), EndAt: at(8, 30)},                 // past: history
		{StartAt: at(12, 0), EndAt: at(12, 30)},               // ahead: replaced
		{StartAt: at(14, 0), EndAt: at(14, 30), Locked: true}, // locked: stays
	}
	for i := range blocks {
		blocks[i].ID, blocks[i].TaskID, blocks[i].UserID, blocks[i].Source = utils.NewBlockID(), task.ID, testUser, models.BlockSourceManual
		if err := f.db.Create(&blocks[i]).Error; err != nil {
			t.Fatal(err)
		}
	}
	var replaced []models.ScheduledBlock
	rev := revision()
	err := f.svc.ApplyAutoSchedule(testUser, AutoScheduleApply{
		CandidateIDs: []string{task.ID},
		From:         at(10, 0), To: at(23, 59),
		ReplaceManualIDs: []string{task.ID},
		Next:             []models.ScheduledBlock{{TaskID: task.ID, UserID: testUser, StartAt: at(15, 0), EndAt: at(15, 30), Source: models.BlockSourceEngine}},
		Revision: func(r []models.ScheduledBlock) (*models.ScheduleRevision, error) {
			replaced = r
			return rev, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []span{{at(8, 0), at(8, 30)}, {at(14, 0), at(14, 30)}, {at(15, 0), at(15, 30)}}
	if got := f.spans("task_id = ?", task.ID); !sameSpans(got, want) {
		t.Fatalf("after apply %+v, want %+v", got, want)
	}
	if len(replaced) != 1 || replaced[0].ID != blocks[1].ID {
		t.Fatalf("revision saw %+v, want the replaced Manual block", replaced)
	}
	if err := f.svc.UndoAutoSchedule(testUser, AutoScheduleUndo{
		RevisionID: rev.ID, TaskIDs: []string{task.ID}, From: at(10, 0), To: at(23, 59), Restore: replaced,
	}); err != nil {
		t.Fatal(err)
	}
	got := f.blocks(task.ID)
	if len(got) != 3 || !got[1].StartAt.Equal(at(12, 0)) || got[1].Source != models.BlockSourceManual || got[1].Locked || !got[2].Locked {
		t.Fatalf("after undo %+v", got)
	}
}

// A failing revision rolls the Block writes back with it.
func TestIntegrationAutoScheduleApplyIsAtomic(t *testing.T) {
	f := newFixture(t)
	task := f.task(models.KindTask, 30)
	err := f.svc.ApplyAutoSchedule(testUser, AutoScheduleApply{
		CandidateIDs: []string{task.ID},
		From:         at(0, 0), To: at(23, 59),
		Next: []models.ScheduledBlock{{TaskID: task.ID, UserID: testUser, StartAt: at(11, 0), EndAt: at(11, 30), Source: models.BlockSourceEngine}},
		Revision: func([]models.ScheduledBlock) (*models.ScheduleRevision, error) {
			return nil, os.ErrInvalid
		},
	})
	if err == nil {
		t.Fatal("apply ignored the revision error")
	}
	if len(f.blocks(task.ID)) != 0 {
		t.Fatal("a failed Apply left Blocks behind")
	}
}

func TestIntegrationUnconfiguredPlacementFailsLoudly(t *testing.T) {
	var s *Service
	if err := s.PlaceByHand(testUser, &models.Task{}, at(9, 0), at(9, 30), false); err == nil {
		t.Fatal("PlaceByHand on a nil Service reported success")
	}
	if err := s.ApplyAutoSchedule(testUser, AutoScheduleApply{}); err == nil {
		t.Fatal("ApplyAutoSchedule on a nil Service reported success")
	}
}

func TestIntegrationApplyNeedsARevision(t *testing.T) {
	f := newFixture(t)
	task := f.task(models.KindTask, 30)
	err := f.svc.ApplyAutoSchedule(testUser, AutoScheduleApply{
		CandidateIDs: []string{task.ID}, From: at(0, 0), To: at(23, 59),
		Next: []models.ScheduledBlock{{TaskID: task.ID, UserID: testUser, StartAt: at(11, 0), EndAt: at(11, 30), Source: models.BlockSourceEngine}},
	})
	if err == nil {
		t.Fatal("apply without a revision succeeded")
	}
	if len(f.blocks(task.ID)) != 0 {
		t.Fatal("apply without a revision wrote Blocks")
	}
}

func TestResolveEnd(t *testing.T) {
	start := at(9, 0)
	end := at(10, 0).Format(time.RFC3339)
	ten := 10
	for _, tc := range []struct {
		name     string
		end      *string
		duration *int
		fallback int
		want     time.Time
		wantErr  bool
	}{
		{"explicit end", &end, &ten, 60, at(10, 0), false},
		{"duration", nil, &ten, 60, at(9, 10), false},
		{"fallback", nil, nil, 60, at(10, 0), false},
		{"default", nil, nil, 0, at(9, 30), false},
		{"end before start", func() *string { s := at(8, 0).Format(time.RFC3339); return &s }(), nil, 0, time.Time{}, true},
		{"bad end", func() *string { s := "later"; return &s }(), nil, 0, time.Time{}, true},
	} {
		got, err := ResolveEnd(start, tc.end, tc.duration, tc.fallback)
		if (err != nil) != tc.wantErr || (!tc.wantErr && !got.Equal(tc.want)) {
			t.Errorf("%s: got %v, %v", tc.name, got, err)
		}
	}
}

func revision() *models.ScheduleRevision {
	return &models.ScheduleRevision{
		ID:          utils.NewScheduleRevisionID(),
		UserID:      testUser,
		CreatedAt:   utils.GetCurrentTimestamp(),
		HorizonFrom: at(0, 0).Format(time.RFC3339),
		HorizonTo:   at(23, 59).Format(time.RFC3339),
		Snapshot:    []byte(`{}`),
	}
}

func mustParse(t *testing.T, raw string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

// With no saved Working hours "today" for the All-day rewrite is the server's
// date (ADR 0011), not UTC's. Here the server's zone is a minute behind UTC's
// midnight, so an All-day Event on the server's today is still ahead.
func TestIntegrationRewriteFutureAllDayUsesServerToday(t *testing.T) {
	f := newFixture(t)
	prev := time.Local
	t.Cleanup(func() { time.Local = prev })
	utc := time.Now().UTC()
	behind := time.Duration(utc.Hour()*60+utc.Minute()+1) * time.Minute
	time.Local = time.FixedZone("Server", -int(behind.Seconds()))
	today := time.Now().In(time.Local)
	start := time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.Local)

	event := &models.Event{ID: utils.NewEventID(), Title: "Offsite", StartAt: start, EndAt: start.Add(24 * time.Hour), AllDay: true, UserID: testUser}
	if err := f.db.Create(event).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.svc.RewriteFutureAllDay(testUser, models.WorkingHours{}); err != nil {
		t.Fatal(err)
	}
	if f.eventBlocks(event.ID) == 0 {
		t.Fatal("an All-day Event on the server's today was skipped as past")
	}
}
