package task

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"timely-api/internal/models"
	"timely-api/internal/utils"

	"github.com/labstack/echo/v5"
)

// focusing creates a work task whose focus started ago, as if StartFocus had
// run then; elapsedFocusMinutes ignores stretches under 15 seconds.
func (f *kindFixture) focusing(name string, ago time.Duration) (*models.Task, time.Time) {
	f.t.Helper()
	in := f.board(models.KindTask, 60, nil)
	in.Name = name
	created, err := f.svc.Create(in, nil, nil)
	if err != nil {
		f.t.Fatalf("create %s: %v", name, err)
	}
	start := time.Now().Add(-ago).UTC().Truncate(time.Second)
	if err := f.db.Model(&models.Task{}).Where("id = ?", created.ID).
		Update("focus_started_at", start.Format(time.RFC3339)).Error; err != nil {
		f.t.Fatal(err)
	}
	return created, start
}

func (f *kindFixture) focusSessions(taskID string) []models.FocusSession {
	f.t.Helper()
	var rows []models.FocusSession
	if err := f.db.Where("task_id = ?", taskID).Order("ended_at").Find(&rows).Error; err != nil {
		f.t.Fatal(err)
	}
	return rows
}

func (f *kindFixture) assertOneSession(taskID, name string, start time.Time, minutes int) {
	f.t.Helper()
	rows := f.focusSessions(taskID)
	if len(rows) != 1 {
		f.t.Fatalf("%s: %d focus sessions, want 1", name, len(rows))
	}
	got := rows[0]
	if got.UserID != kindTestUser || got.TaskName != name || got.Minutes != minutes {
		f.t.Fatalf("%s: session %+v, want user %s, %d minutes", name, got, kindTestUser, minutes)
	}
	if !got.StartedAt.Equal(start) {
		f.t.Fatalf("%s: started_at %v, want %v", name, got.StartedAt, start)
	}
	if d := time.Since(got.EndedAt); d < 0 || d > time.Minute {
		f.t.Fatalf("%s: ended_at %v is not now", name, got.EndedAt)
	}
	var task models.Task
	if err := f.db.Select("actual_minutes").Where("id = ?", taskID).First(&task).Error; err != nil {
		f.t.Fatal(err)
	}
	if task.ActualMinutes != minutes {
		f.t.Fatalf("%s: actual_minutes %d, want %d", name, task.ActualMinutes, minutes)
	}
}

func TestIntegrationPauseFocusLogsSession(t *testing.T) {
	f := newKindFixture(t)
	task, start := f.focusing("Pause me", 25*time.Minute)
	if _, err := f.svc.PauseFocus(kindTestUser, task.ID); err != nil {
		t.Fatalf("pause: %v", err)
	}
	f.assertOneSession(task.ID, "Pause me", start, 25)

	// Pausing again is a no-op and logs nothing more.
	if _, err := f.svc.PauseFocus(kindTestUser, task.ID); err != nil {
		t.Fatalf("second pause: %v", err)
	}
	if n := len(f.focusSessions(task.ID)); n != 1 {
		t.Fatalf("%d sessions after a repeated pause, want 1", n)
	}
}

func TestIntegrationStopFocusLogsSession(t *testing.T) {
	f := newKindFixture(t)
	task, start := f.focusing("Stop me", 40*time.Minute)
	if _, err := f.svc.StopFocus(kindTestUser, task.ID); err != nil {
		t.Fatalf("stop: %v", err)
	}
	f.assertOneSession(task.ID, "Stop me", start, 40)
}

func TestIntegrationStartFocusLogsTheTaskItStops(t *testing.T) {
	f := newKindFixture(t)
	first, start := f.focusing("First", 10*time.Minute)
	second, err := f.svc.Create(f.board(models.KindTask, 30, nil), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.StartFocus(kindTestUser, second.ID); err != nil {
		t.Fatalf("start: %v", err)
	}
	f.assertOneSession(first.ID, "First", start, 10)
	if n := len(f.focusSessions(second.ID)); n != 0 {
		t.Fatalf("the started task has %d sessions, want 0", n)
	}
}

func TestIntegrationCompleteWhileFocusingLogsSession(t *testing.T) {
	f := newKindFixture(t)
	task, start := f.focusing("Finish me", 15*time.Minute)
	done := utils.GetCurrentTimestamp()
	if _, err := f.svc.Update(kindTestUser, task.ID, TaskUpdate{CompletedAt: &done}); err != nil {
		t.Fatalf("complete: %v", err)
	}
	f.assertOneSession(task.ID, "Finish me", start, 15)
}

func TestIntegrationShortFocusLogsNothing(t *testing.T) {
	f := newKindFixture(t)
	task, _ := f.focusing("Blink", 2*time.Second)
	if _, err := f.svc.StopFocus(kindTestUser, task.ID); err != nil {
		t.Fatalf("stop: %v", err)
	}
	if n := len(f.focusSessions(task.ID)); n != 0 {
		t.Fatalf("%d sessions for a 2 second focus, want 0", n)
	}
}

func TestIntegrationFocusSessionOutlivesItsTask(t *testing.T) {
	f := newKindFixture(t)
	task, _ := f.focusing("Gone soon", 5*time.Minute)
	if _, err := f.svc.StopFocus(kindTestUser, task.ID); err != nil {
		t.Fatalf("stop: %v", err)
	}
	if err := f.svc.Delete(kindTestUser, task.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	var rows []models.FocusSession
	if err := f.db.Where("user_id = ?", kindTestUser).Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].TaskID != nil || rows[0].TaskName != "Gone soon" || rows[0].Minutes != 5 {
		t.Fatalf("sessions after delete = %+v, want one with no task and the old name", rows)
	}
}

func TestIntegrationFocusSessionsEndpointFiltersByUserAndRange(t *testing.T) {
	f := newKindFixture(t)
	const other = "usr_focus_other"
	if err := f.db.Create(&models.User{ID: other, Email: "other@example.invalid", Password: "not-a-real-hash"}).Error; err != nil {
		t.Fatal(err)
	}
	from := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 0, 7)
	add := func(user, name string, ended time.Time) {
		row := &models.FocusSession{UserID: user, TaskName: name, StartedAt: ended.Add(-20 * time.Minute), EndedAt: ended, Minutes: 20}
		if err := f.db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	add(kindTestUser, "late", to.Add(-time.Minute))
	add(kindTestUser, "at from", from)
	add(kindTestUser, "middle", from.Add(50*time.Hour))
	add(kindTestUser, "before", from.Add(-time.Second))
	add(kindTestUser, "at to", to)
	add(other, "someone else", from.Add(time.Hour))

	handler := NewHandler(f.svc)
	query := url.Values{"from": {from.Format(time.RFC3339)}, "to": {to.Format(time.RFC3339)}}
	recorder := httptest.NewRecorder()
	c := echo.New().NewContext(httptest.NewRequest(http.MethodGet, "/tasks/focus-sessions?"+query.Encode(), nil), recorder)
	c.Set("userID", kindTestUser)
	if err := handler.ListFocusSessions(c); err != nil {
		t.Fatal(err)
	}
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", recorder.Code, recorder.Body)
	}
	var body struct {
		Sessions []map[string]any `json:"sessions"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, s := range body.Sessions {
		names = append(names, s["taskName"].(string))
		for _, key := range []string{"id", "taskId", "taskName", "startedAt", "endedAt", "minutes"} {
			if _, ok := s[key]; !ok {
				t.Fatalf("session %v lacks %s", s, key)
			}
		}
		if _, ok := s["userId"]; ok {
			t.Fatalf("session %v exposes userId", s)
		}
	}
	want := []string{"at from", "middle", "late"}
	if len(names) != len(want) {
		t.Fatalf("sessions = %v, want %v", names, want)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("sessions = %v, want %v", names, want)
		}
	}

	// The other account sees only its own row.
	recorder = httptest.NewRecorder()
	c = echo.New().NewContext(httptest.NewRequest(http.MethodGet, "/tasks/focus-sessions?"+query.Encode(), nil), recorder)
	c.Set("userID", other)
	if err := handler.ListFocusSessions(c); err != nil {
		t.Fatal(err)
	}
	body.Sessions = nil
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Sessions) != 1 || body.Sessions[0]["taskName"] != "someone else" {
		t.Fatalf("other user's sessions = %v", body.Sessions)
	}
}
