package schedule

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	_ "timely-api/internal/database" // sets goose's embedded migrations
	"timely-api/internal/features/event"
	"timely-api/internal/features/placement"
	"timely-api/internal/features/task"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/labstack/echo/v5"
	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const freeTimeUser = "usr_free_time_test"

// freeTimeFixture migrates an isolated PostgreSQL schema and seeds one account
// with Monday to Friday 09:00-17:00 Working hours in UTC and a workspace.
func freeTimeFixture(t *testing.T) (*gorm.DB, *placement.Service, string) {
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
	schema := "free_time_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	user := freeTimeUser
	ws := "wsp_free_time_test"
	for _, row := range []any{
		&models.User{ID: freeTimeUser, Email: "free-time@example.invalid", Password: "not-a-real-hash"},
		&models.Workspace{ID: ws, Name: "Free time", UserID: &user},
		&models.Config{ID: "cfg_free_time_test", UserID: freeTimeUser, WorkingHours: models.DefaultWorkingHours("UTC")},
	} {
		if err = db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	repo := NewRepository(db)
	return db, placement.New(db, repo.GetWorkingHours), ws
}

// GET /schedule/free-time is Working hours minus Events and Blocks: the same
// service call the agent's get_free_time makes, so clients do not compute busy
// time themselves (ADR 0006).
func TestIntegrationFreeTimeEndpointSubtractsEventsAndBlocks(t *testing.T) {
	db, place, ws := freeTimeFixture(t)
	at := func(hour, minute int) time.Time { return time.Date(2026, 12, 7, hour, minute, 0, 0, time.UTC) } // a Monday

	meeting := &models.Event{ID: utils.NewEventID(), Title: "Dentist", StartAt: at(10, 0), EndAt: at(10, 30), Duration: 30, UserID: freeTimeUser}
	if err := db.Create(meeting).Error; err != nil {
		t.Fatal(err)
	}
	if err := place.PlaceEvent(freeTimeUser, meeting); err != nil {
		t.Fatal(err)
	}
	user := freeTimeUser
	work := &models.Task{ID: utils.NewTaskID(), Name: "Write", Kind: models.KindTask, Duration: 60, UserID: &user, WorkspaceID: &ws}
	if err := db.Create(work).Error; err != nil {
		t.Fatal(err)
	}
	if err := place.PlaceWork(freeTimeUser, work, at(13, 0), 60); err != nil {
		t.Fatal(err)
	}

	handler := NewHandler(NewService(NewRepository(db), task.NewTaskRepository(db), event.NewEventRepository(db), place))
	e := echo.New()
	query := url.Values{"from": {at(0, 0).Format(time.RFC3339)}, "to": {at(0, 0).AddDate(0, 0, 1).Format(time.RFC3339)}, "timezone": {"UTC"}}
	request := httptest.NewRequest(http.MethodGet, "/schedule/free-time?"+query.Encode(), nil)
	recorder := httptest.NewRecorder()
	c := e.NewContext(request, recorder)
	c.Set("userID", freeTimeUser)
	if err := handler.FreeTime(c); err != nil {
		t.Fatal(err)
	}
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", recorder.Code, recorder.Body)
	}
	var body struct {
		Slots       []Interval `json:"slots"`
		FreeMinutes int        `json:"freeMinutes"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	want := []Interval{{at(9, 0), at(10, 0)}, {at(10, 30), at(13, 0)}, {at(14, 0), at(17, 0)}}
	if len(body.Slots) != len(want) {
		t.Fatalf("slots = %v, want %v", body.Slots, want)
	}
	for i := range want {
		if !body.Slots[i].Start.Equal(want[i].Start) || !body.Slots[i].End.Equal(want[i].End) {
			t.Fatalf("slot %d = %v, want %v", i, body.Slots[i], want[i])
		}
	}
	if body.FreeMinutes != 60+150+180 {
		t.Fatalf("freeMinutes = %d, want 390", body.FreeMinutes)
	}

	// A range that ends before it starts is a 400, like capacity.
	query.Set("to", at(0, 0).AddDate(0, 0, -1).Format(time.RFC3339))
	c = e.NewContext(httptest.NewRequest(http.MethodGet, "/schedule/free-time?"+query.Encode(), nil), httptest.NewRecorder())
	c.Set("userID", freeTimeUser)
	err := handler.FreeTime(c)
	if he, ok := err.(*echo.HTTPError); !ok || he.Code != http.StatusBadRequest {
		t.Fatalf("reversed range error = %v, want 400", err)
	}
}
