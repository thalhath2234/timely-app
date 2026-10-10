package focus

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/labstack/echo/v5"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"timely-api/internal/models"
)

// integrationDB builds the tables from the real migration, so the data copy
// of decision_goals and the foreign keys are checked too.
func integrationDB(t *testing.T) *gorm.DB {
	t.Helper()
	file := os.Getenv("CHAT_TEST_ENV")
	if file == "" {
		t.Skip("set CHAT_TEST_ENV via make test-chat-integration for isolated PostgreSQL tests")
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
	schema := "focus_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err = root.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec("DROP SCHEMA " + schema + " CASCADE"); db, _ := root.DB(); db.Close() })
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB, _ := db.DB(); sqlDB.Close() })
	if err = db.AutoMigrate(&models.User{}, &models.Workspace{}, &models.Status{}, &models.Lable{}, &models.CustomField{},
		&models.Project{}, &models.Stage{}, &models.Task{}, &models.CustomFieldValue{}); err != nil {
		t.Fatal(err)
	}
	// Only the columns the migration reads.
	must(t, db.Exec(`CREATE TABLE agent_provider_settings (user_id text PRIMARY KEY, decision_goals jsonb NOT NULL DEFAULT '[]')`).Error)
	return db
}

func migrateUp(t *testing.T, db *gorm.DB) {
	t.Helper()
	raw, err := os.ReadFile("../../../migrations/20261010121000_habits_goals.sql")
	if err != nil {
		t.Fatal(err)
	}
	must(t, db.Exec(strings.Split(string(raw), "-- +goose Down")[0]).Error)
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func addUser(t *testing.T, db *gorm.DB) string {
	t.Helper()
	id := "usr_" + uuid.NewString()
	must(t, db.Create(&models.User{ID: id, Email: id + "@test.local", Password: "x"}).Error)
	return id
}

func TestIntegrationMigrationCopiesGoals(t *testing.T) {
	db := integrationDB(t)
	a, b, c := addUser(t, db), addUser(t, db), addUser(t, db)
	must(t, db.Exec(`INSERT INTO agent_provider_settings (user_id, decision_goals) VALUES
		(?, '["  Launch  the shop ", "", "Get fit", "Learn Spanish", "   ", "Read more", "Save money", "Sixth goal"]'),
		(?, '[]'), (?, '"not a list"')`, a, b, c).Error)
	migrateUp(t, db)
	store := NewStore(db)
	ctx := context.Background()
	goals, err := store.Goals(ctx, a)
	must(t, err)
	var titles []string
	for i, g := range goals {
		titles = append(titles, g.Title)
		if g.Position != i || !strings.HasPrefix(g.ID, "goal_") {
			t.Errorf("goal %d: %+v", i, g)
		}
	}
	if strings.Join(titles, "|") != "Launch the shop|Get fit|Learn Spanish|Read more|Save money" {
		t.Fatalf("copied %q", titles)
	}
	for _, uid := range []string{b, c} {
		if goals, err := store.Goals(ctx, uid); err != nil || len(goals) != 0 {
			t.Fatalf("%s: %+v %v", uid, goals, err)
		}
	}
	// A deleted account takes its habits, checks and goals with it.
	h, err := store.AddHabit(ctx, a, "Walk")
	must(t, err)
	must(t, store.CheckHabit(ctx, a, h.ID, time.Now().UTC().Format(dayLayout), true))
	must(t, db.Exec("DELETE FROM users WHERE id = ?", a).Error)
	var left int64
	must(t, db.Raw("SELECT (SELECT count(*) FROM habits) + (SELECT count(*) FROM habit_checks) + (SELECT count(*) FROM goals WHERE user_id = ?)", a).Scan(&left).Error)
	if left != 0 {
		t.Fatalf("%d rows left after the account was deleted", left)
	}
}

func TestIntegrationHabits(t *testing.T) {
	db := integrationDB(t)
	migrateUp(t, db)
	ctx := context.Background()
	store := NewStore(db)
	me, other := addUser(t, db), addUser(t, db)

	walk, err := store.AddHabit(ctx, me, "  Walk  outside ")
	must(t, err)
	read, err := store.AddHabit(ctx, me, "Read 20 pages")
	must(t, err)
	if walk.Name != "Walk outside" || walk.Position != 0 || read.Position != 1 {
		t.Fatalf("added %+v %+v", walk, read)
	}
	var input *InputError
	if _, err := store.AddHabit(ctx, me, "walk OUTSIDE"); err == nil || !asInput(err, &input) {
		t.Fatalf("duplicate name: %v", err)
	}
	if _, err := store.RenameHabit(ctx, me, read.ID, "Walk outside"); err == nil {
		t.Fatal("rename onto another habit's name")
	}
	if _, err := store.RenameHabit(ctx, other, read.ID, "Stolen"); err != ErrNotFound {
		t.Fatalf("another account renamed it: %v", err)
	}
	read, err = store.RenameHabit(ctx, me, read.ID, "Read 30 pages")
	must(t, err)

	// Checks: yesterday and the two days before; today still open.
	today := day(t, "2026-10-10")
	for _, d := range []string{"2026-10-09", "2026-10-08", "2026-10-07", "2026-10-05"} {
		must(t, db.Create(&HabitCheck{HabitID: walk.ID, UserID: me, Day: d, CreatedAt: time.Now()}).Error)
	}
	views, err := store.Habits(ctx, me, today)
	must(t, err)
	if len(views) != 2 || views[0].ID != walk.ID || views[0].DoneToday || views[0].Streak != 3 || views[1].Streak != 0 {
		t.Fatalf("views %+v", views)
	}
	if fmt.Sprint(views[0].Last7) != "[false true false true true true false]" {
		t.Fatalf("last7 %v", views[0].Last7)
	}

	// Checking today extends the run; checking twice is harmless; unchecking undoes it.
	now := time.Now().UTC().Format(dayLayout)
	must(t, store.CheckHabit(ctx, me, read.ID, now, true))
	must(t, store.CheckHabit(ctx, me, read.ID, now, true))
	views, err = store.Habits(ctx, me, day(t, now))
	must(t, err)
	if !views[1].DoneToday || views[1].Streak != 1 {
		t.Fatalf("after check %+v", views[1])
	}
	must(t, store.CheckHabit(ctx, me, read.ID, now, false))
	views, _ = store.Habits(ctx, me, day(t, now))
	if views[1].DoneToday || views[1].Streak != 0 {
		t.Fatalf("after uncheck %+v", views[1])
	}
	for _, bad := range []string{"2026-13-01", time.Now().UTC().AddDate(0, 0, 3).Format(dayLayout), time.Now().UTC().AddDate(-2, 0, 0).Format(dayLayout)} {
		if err := store.CheckHabit(ctx, me, read.ID, bad, true); err == nil {
			t.Errorf("checked %s", bad)
		}
	}
	if err := store.CheckHabit(ctx, other, read.ID, now, true); err != ErrNotFound {
		t.Fatalf("another account checked it: %v", err)
	}

	// A streak longer than the window loads the older checks.
	long := day(t, "2026-06-30")
	for i := 0; i < 100; i++ {
		must(t, db.Create(&HabitCheck{HabitID: read.ID, UserID: me, Day: long.AddDate(0, 0, -i).Format(dayLayout), CreatedAt: time.Now()}).Error)
	}
	views, _ = store.Habits(ctx, me, long.AddDate(0, 0, 1))
	if views[1].Streak != 100 {
		t.Fatalf("long streak %d", views[1].Streak)
	}

	// Reorder, find by name, delete.
	must(t, store.ReorderHabits(ctx, me, []string{read.ID}))
	views, _ = store.Habits(ctx, me, today)
	if views[0].ID != read.ID || views[1].ID != walk.ID || views[0].Position != 0 {
		t.Fatalf("order %+v", views)
	}
	if err := store.ReorderHabits(ctx, me, []string{"hab_nope"}); err != ErrNotFound {
		t.Fatalf("unknown id: %v", err)
	}
	if h, err := store.FindHabit(ctx, me, "read 30 PAGES"); err != nil || h.ID != read.ID {
		t.Fatalf("find %+v %v", h, err)
	}
	if err := store.DeleteHabit(ctx, other, read.ID); err != ErrNotFound {
		t.Fatalf("another account deleted it: %v", err)
	}
	must(t, store.DeleteHabit(ctx, me, read.ID))
	var checks int64
	must(t, db.Model(&HabitCheck{}).Where("habit_id = ?", read.ID).Count(&checks).Error)
	if checks != 0 {
		t.Fatalf("%d checks left", checks)
	}

	// At most twenty habits.
	for i := 0; i < MaxHabits-1; i++ {
		_, err := store.AddHabit(ctx, me, fmt.Sprintf("Habit %d", i))
		must(t, err)
	}
	if _, err := store.AddHabit(ctx, me, "One too many"); err == nil {
		t.Fatal("added a 21st habit")
	}
	if views, _ := store.Habits(ctx, other, today); len(views) != 0 {
		t.Fatalf("another account sees %d habits", len(views))
	}
}

func asInput(err error, target **InputError) bool {
	e, ok := err.(*InputError)
	*target = e
	return ok
}

func TestIntegrationGoals(t *testing.T) {
	db := integrationDB(t)
	migrateUp(t, db)
	ctx := context.Background()
	store := NewStore(db)
	me := addUser(t, db)
	var ids []string
	for _, title := range []string{"Launch the shop", "Get fit", "Learn Spanish", "Read more", "Save money"} {
		g, err := store.AddGoal(ctx, me, title)
		must(t, err)
		ids = append(ids, g.ID)
	}
	if _, err := store.AddGoal(ctx, me, "Sixth"); err == nil {
		t.Fatal("added a sixth goal")
	}
	must(t, store.DeleteGoal(ctx, me, ids[4]))
	if _, err := store.AddGoal(ctx, me, "get FIT"); err == nil {
		t.Fatal("duplicate goal")
	}
	g, err := store.RenameGoal(ctx, me, ids[1], "Run a 10k")
	must(t, err)
	if g.Title != "Run a 10k" {
		t.Fatalf("renamed %+v", g)
	}
	must(t, store.ReorderGoals(ctx, me, []string{ids[2], ids[0]}))
	if titles := strings.Join(store.GoalTitles(ctx, me), "|"); titles != "Learn Spanish|Launch the shop|Run a 10k|Read more" {
		t.Fatalf("order %s", titles)
	}
}

func TestIntegrationGoalProgressCachesAnswers(t *testing.T) {
	db := integrationDB(t)
	migrateUp(t, db)
	ctx := context.Background()
	store := NewStore(db)
	me := addUser(t, db)
	ws := "ws_" + uuid.NewString()
	must(t, db.Create(&models.Workspace{ID: ws, Name: "Home", UserID: &me}).Error)
	task := func(name, deadline string, done bool) models.Task {
		tk := models.Task{ID: "tsk_" + uuid.NewString(), Name: name, UserID: &me, WorkspaceID: &ws, Kind: models.KindTask}
		if deadline != "" {
			tk.Deadline = &deadline
		}
		if done {
			now := time.Now().UTC().Format(time.RFC3339)
			tk.CompletedAt = &now
		}
		must(t, db.Create(&tk).Error)
		return tk
	}
	shoes := task("Buy running shoes", "2026-10-20", false)
	photos := task("Take product photos", "2026-10-12", false)
	task("Plan the route", "", false)
	task("Old finished run", "2026-10-01", true)
	fit, err := store.AddGoal(ctx, me, "Get fit")
	must(t, err)
	shop, err := store.AddGoal(ctx, me, "Launch the shop")
	must(t, err)

	// Soonest deadline first: photos t1, shoes t2, route t3.
	jev := &jevStub{answers: map[string]any{
		"goal_t1": choice("g2", 0.9),
		"goal_t2": choice("g1", 0.9),
		"goal_t3": choice("g1", 0.2),
	}}
	d := jev.service(t)
	out, err := store.Progress(ctx, d, me)
	must(t, err)
	if !out.Available || len(out.Goals) != 2 || out.Goals[0].GoalID != fit.ID || out.Goals[1].GoalID != shop.ID {
		t.Fatalf("progress %+v", out)
	}
	if len(out.Goals[0].Items) != 1 || out.Goals[0].Items[0].TaskID != shoes.ID || out.Goals[0].Items[0].Deadline != "2026-10-20" {
		t.Fatalf("get fit %+v", out.Goals[0].Items)
	}
	if len(out.Goals[1].Items) != 1 || out.Goals[1].Items[0].TaskID != photos.ID {
		t.Fatalf("shop %+v", out.Goals[1].Items)
	}
	if len(jev.requests) != 1 || len(jev.requests[0]) != 3 {
		t.Fatalf("asked %v", jev.requests)
	}

	// Nothing changed: no call.
	if _, err := store.Progress(ctx, d, me); err != nil || len(jev.requests) != 1 {
		t.Fatalf("asked again for unchanged work: %d calls, %v", len(jev.requests), err)
	}
	// An edited task is asked about alone.
	must(t, db.Model(&models.Task{}).Where("id = ?", shoes.ID).Update("description", "Trail shoes").Error)
	jev.answers = map[string]any{"goal_t1": choice("none", 0.9)}
	out, err = store.Progress(ctx, d, me)
	must(t, err)
	if len(jev.requests) != 2 || len(jev.requests[1]) != 1 || len(out.Goals[0].Items) != 0 {
		t.Fatalf("edited task: %d calls %v, %+v", len(jev.requests), jev.requests[len(jev.requests)-1], out.Goals[0])
	}
	// A renamed goal asks about every task again; a failed call keeps
	// nothing new and says why.
	_, err = store.RenameGoal(ctx, me, fit.ID, "Run a 10k")
	must(t, err)
	jev.fail = true
	out, err = store.Progress(ctx, d, me)
	must(t, err)
	if len(jev.requests) != 3 || len(jev.requests[2]) != 3 || out.Error == "" {
		t.Fatalf("renamed goal: %d calls, error %q", len(jev.requests), out.Error)
	}
	jev.fail = false
	jev.answers = map[string]any{"goal_t1": choice("g2", 0.9)}
	out, err = store.Progress(ctx, d, me)
	must(t, err)
	if len(jev.requests) != 4 || out.Error != "" || len(out.Goals[1].Items) != 1 {
		t.Fatalf("after failure: %d calls, %+v", len(jev.requests), out)
	}

	// Smart suggestions off: the goals are still listed by GET /goals, and
	// progress is unavailable.
	off, err := store.Progress(ctx, offDecider{}, me)
	if err != nil || off.Available {
		t.Fatalf("off %+v %v", off, err)
	}
}

func call(t *testing.T, s *Service, userID, method, path string, body any) (int, map[string]any) {
	t.Helper()
	e := echo.New()
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			c.Set("userID", userID)
			return next(c)
		}
	})
	s.Routes(e.Group(""))
	reader := strings.NewReader("")
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = strings.NewReader(string(raw))
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestIntegrationRoutes(t *testing.T) {
	db := integrationDB(t)
	migrateUp(t, db)
	me := addUser(t, db)
	s := New(db, offDecider{})

	code, body := call(t, s, me, http.MethodPost, "/habits", map[string]string{"name": "Stretch"})
	if code != http.StatusCreated {
		t.Fatalf("add habit %d %v", code, body)
	}
	id, _ := body["id"].(string)
	today := time.Now().UTC().Format(dayLayout)
	if code, body := call(t, s, me, http.MethodPost, "/habits/"+id+"/check", map[string]any{"day": today, "done": true}); code != http.StatusNoContent {
		t.Fatalf("check %d %v", code, body)
	}
	code, body = call(t, s, me, http.MethodGet, "/habits?today="+today, nil)
	habits, _ := body["habits"].([]any)
	if code != 200 || len(habits) != 1 || habits[0].(map[string]any)["doneToday"] != true || habits[0].(map[string]any)["streak"] != float64(1) {
		t.Fatalf("list %d %v", code, body)
	}
	if code, _ := call(t, s, me, http.MethodGet, "/habits?today=10/10/2026", nil); code != http.StatusBadRequest {
		t.Fatalf("bad today: %d", code)
	}
	if code, _ := call(t, s, me, http.MethodGet, "/habits", nil); code != 200 {
		t.Fatalf("no today: %d", code)
	}
	if code, _ := call(t, s, me, http.MethodPost, "/habits/"+id+"/check", map[string]any{"day": today}); code != http.StatusBadRequest {
		t.Fatalf("check without done: %d", code)
	}
	if code, body := call(t, s, me, http.MethodPatch, "/habits/"+id, map[string]string{"name": strings.Repeat("x", 81)}); code != http.StatusBadRequest || !strings.Contains(fmt.Sprint(body["message"]), "80") {
		t.Fatalf("long name %d %v", code, body)
	}
	if code, _ := call(t, s, me, http.MethodDelete, "/habits/hab_missing", nil); code != http.StatusNotFound {
		t.Fatalf("missing habit: %d", code)
	}

	code, body = call(t, s, me, http.MethodPost, "/goals", map[string]string{"title": "Get fit"})
	if code != http.StatusCreated {
		t.Fatalf("add goal %d %v", code, body)
	}
	goalID, _ := body["id"].(string)
	if code, _ := call(t, s, me, http.MethodPut, "/goals/order", map[string]any{"ids": []string{goalID}}); code != http.StatusNoContent {
		t.Fatalf("order %d", code)
	}
	code, body = call(t, s, me, http.MethodGet, "/goals", nil)
	if goals, _ := body["goals"].([]any); code != 200 || len(goals) != 1 {
		t.Fatalf("goals %d %v", code, body)
	}
	code, body = call(t, s, me, http.MethodGet, "/goals/progress", nil)
	if code != 200 || body["available"] != false {
		t.Fatalf("progress off %d %v", code, body)
	}
	if code, _ := call(t, s, me, http.MethodDelete, "/goals/"+goalID, nil); code != http.StatusNoContent {
		t.Fatalf("delete goal %d", code)
	}
}
