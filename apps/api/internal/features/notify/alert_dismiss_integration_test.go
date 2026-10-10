package notify

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/decide"
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

	"gorm.io/gorm"
)

// A smart alert deleted or cleared without its step counts once as a
// suggestion not kept, is hidden but kept to count, and opening one is
// neutral. A kind dismissed three times in 14 days and never acted on is
// left out of the next run.
func TestIntegrationSmartAlertDismissals(t *testing.T) {
	_, db := zoneService(t, models.NotificationSettings{Reminders: true})
	tasks := task.NewTaskRepository(db)
	sched := schedule.NewRepository(db)
	place := placement.New(db, sched.GetWorkingHours)
	indexer := embed.New(db)
	taskService := task.NewTaskService(tasks, project.NewProjectRepository(db), workspace.NewWorkspaceRepository(db), recurrence.NewStore(db), place, indexer)
	svc := NewService(db, jobs.NewQueue(db), nil, taskService, schedule.NewService(sched, tasks, event.NewEventRepository(db), place), indexer)
	dec := decide.New(db, nil, nil)
	svc.SetDecisions(func(context.Context, string) bool { return true }, dec.Feedback)
	svc.SetDismissed(dec.Dismissed)

	user := zoneTestUser
	ws := models.Workspace{ID: "ws_dismiss", Name: "Home", UserID: &user}
	if err := db.Create(&ws).Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"tsk_a", "tsk_b", "tsk_c"} {
		if err := db.Create(&models.Task{ID: id, Name: "Work " + id, Kind: models.KindTask, Duration: 30, UserID: &user, WorkspaceID: &ws.ID}).Error; err != nil {
			t.Fatal(err)
		}
	}
	// Seven earlier smart alert decisions the person did not keep, and the
	// one behind today's alerts.
	no := false
	earlier := time.Now().UTC().Add(-time.Hour)
	for i := range 7 {
		if err := db.Create(&decide.DecisionLog{ID: fmt.Sprintf("dec_old%d", i), UserID: user, Feature: "smart_alerts", Provider: "typesafe", OK: true,
			Accepted: &no, CreatedAt: earlier, DecidedAt: &earlier}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&decide.DecisionLog{ID: "dec_today", UserID: user, Feature: "smart_alerts", Provider: "typesafe", OK: true, CreatedAt: time.Now().UTC()}).Error; err != nil {
		t.Fatal(err)
	}
	answer := func() *bool {
		t.Helper()
		var row decide.DecisionLog
		if err := db.First(&row, "id = ?", "dec_today").Error; err != nil {
			t.Fatal(err)
		}
		return row.Accepted
	}

	var muted []map[string]bool
	svc.SetAlerts(func(_ context.Context, _ string, _ time.Time, _, m map[string]bool) []Alert {
		muted = append(muted, m)
		one := func(kind, id string) Alert {
			return Alert{Key: kind + ":" + id, Kind: kind, Title: "Work " + id, Action: AlertReview, Items: []AlertItem{{ID: id, Name: "Work " + id}}, LogID: "dec_today"}
		}
		return []Alert{one("stale", "tsk_a"), one("stale", "tsk_b"), one("due", "tsk_c")}
	})
	day := time.Now().Format("2006-01-02")
	job := &models.Job{UserID: user, Kind: models.JobSmartAlerts, Payload: models.JobPayload{"date": day}}
	if err := svc.HandleSmartAlerts(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	var sent []models.Notification
	db.Where("user_id = ? AND category = ?", user, models.NotifySuggestion).Find(&sent)
	byKey := map[string]models.Notification{}
	for _, n := range sent {
		byKey[strings.TrimPrefix(*n.DedupeKey, "suggestion:"+user+":"+day+":")] = n
	}
	a, c := byKey["stale:tsk_a"], byKey["due:tsk_c"]
	if len(sent) != 3 || a.ID == "" || c.ID == "" {
		t.Fatalf("sent %d", len(sent))
	}
	for _, id := range []string{"ntf_r1", "ntf_r2"} {
		if err := db.Create(&models.Notification{ID: id, UserID: user, Category: models.NotifyReminder, Title: "Reminder", Data: models.JobPayload{}, CreatedAt: time.Now().UTC()}).Error; err != nil {
			t.Fatal(err)
		}
	}

	// Opening an alert marks it read and changes nothing else.
	if _, err := svc.MarkRead(user, a.ID); err != nil {
		t.Fatal(err)
	}
	if answer() != nil {
		t.Fatal("opening an alert recorded an answer")
	}

	// Deleting it dismisses it: hidden, kept as a row, counted once.
	if err := svc.Delete(user, a.ID); err != nil {
		t.Fatal(err)
	}
	if got := answer(); got == nil || *got {
		t.Fatalf("dismissed alert answer %v, want not kept", got)
	}
	if err := svc.Delete(user, a.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("second delete: %v", err)
	}
	list, _ := svc.List(user, false, 0)
	if len(list) != 4 {
		t.Fatalf("listed %d, want the two other alerts and two reminders", len(list))
	}
	for _, n := range list {
		if n.ID == a.ID {
			t.Fatal("dismissed alert still listed")
		}
	}
	if unread, _ := svc.UnreadCount(user); unread != 4 {
		t.Fatalf("unread %d", unread)
	}
	// Learned defaults now see eight answered alerts, none kept.
	learned, err := dec.LearnedFor(user)
	if err != nil || len(learned) != 1 || learned[0].Decided != 8 || learned[0].Kept != 0 || learned[0].Raise == 0 {
		t.Fatalf("learned %+v %v", learned, err)
	}

	// A plain notification is deleted outright.
	if err := svc.Delete(user, "ntf_r1"); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&models.Notification{}).Where("id = ?", "ntf_r1").Count(&count)
	if count != 0 {
		t.Fatal("reminder kept after delete")
	}

	// Taking the due alert's step counts as kept, and clearing it later
	// does not undo that.
	if _, err := svc.ApplyTriage(user, c.ID, AlertReview); err != nil {
		t.Fatal(err)
	}
	if got := answer(); got == nil || !*got {
		t.Fatalf("acted alert answer %v, want kept", got)
	}
	if err := svc.ClearAll(user); err != nil {
		t.Fatal(err)
	}
	if got := answer(); got == nil || !*got {
		t.Fatalf("clear overwrote a kept answer: %v", got)
	}
	if list, _ := svc.List(user, false, 0); len(list) != 0 {
		t.Fatalf("listed %d after clear", len(list))
	}
	db.Model(&models.Notification{}).Where("user_id = ? AND category = ? AND dismissed_at IS NOT NULL", user, models.NotifySuggestion).Count(&count)
	if count != 3 {
		t.Fatalf("hidden alerts %d, want 3", count)
	}
	db.Model(&models.Notification{}).Where("user_id = ? AND category = ?", user, models.NotifyReminder).Count(&count)
	if count != 0 {
		t.Fatal("clear kept a reminder")
	}
	if skip, _ := svc.repo.RecentlyAlerted(user, time.Now().AddDate(0, 0, -alertQuietDays)); !skip["tsk_a"] || !skip["tsk_c"] {
		t.Fatalf("cleared alerts dropped from the quiet week: %v", skip)
	}

	// Today's two stale dismissals (one delete, one clear) count as one day;
	// two more days this fortnight make three, so stale is muted. Due (acted
	// on today) is not. A dismissal from 31 days ago is pruned by the sweep,
	// whatever the smart alerts setting.
	old := func(id string, days int) {
		at := time.Now().UTC().AddDate(0, 0, -days)
		if err := db.Create(&models.Notification{ID: id, UserID: user, Category: models.NotifySuggestion, Title: "Old", Data: models.JobPayload{"kind": "stale"},
			CreatedAt: at, ReadAt: &at, DismissedAt: &at}).Error; err != nil {
			t.Fatal(err)
		}
	}
	old("ntf_stale_week", 3)
	old("ntf_stale_month", 31)
	if err := svc.HandleSmartAlerts(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	if len(muted) != 2 || len(muted[0]) != 0 || muted[1]["stale"] || muted[1]["due"] {
		t.Fatalf("one clear counted as several days: %v", muted)
	}
	old("ntf_stale_week2", 5)
	if err := svc.HandleSmartAlerts(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	if len(muted) != 3 || !muted[2]["stale"] || muted[2]["due"] {
		t.Fatalf("muted %v", muted)
	}
	// The step on the due alert is dated, so it only counts for 14 days.
	var acted models.Notification
	if err := db.First(&acted, "id = ?", c.ID).Error; err != nil || acted.Data.String("actedAt") == "" {
		t.Fatalf("acted alert has no actedAt: %v %v", acted.Data, err)
	}
	outcomes, err := svc.repo.AlertOutcomes(user)
	if err != nil {
		t.Fatal(err)
	}
	actedRows := 0
	for _, o := range outcomes {
		if o.ActedAt != nil {
			actedRows++
			if time.Since(*o.ActedAt) > time.Hour {
				t.Fatalf("acted at %v", o.ActedAt)
			}
		}
	}
	if actedRows != 1 {
		t.Fatalf("%d acted outcomes, want 1", actedRows)
	}

	// The sweep prunes with smart suggestions off too.
	svc.SetDecisions(func(context.Context, string) bool { return false }, dec.Feedback)
	if err := svc.sweepDismissed(user, time.Now()); err != nil {
		t.Fatal(err)
	}
	db.Model(&models.Notification{}).Where("id = ?", "ntf_stale_month").Count(&count)
	if count != 0 {
		t.Fatal("a month-old dismissal was kept")
	}
	db.Model(&models.Notification{}).Where("id = ?", "ntf_stale_week").Count(&count)
	if count != 1 {
		t.Fatal("a recent dismissal was pruned")
	}
}

// A smart alert dismissed before its deferred push job runs is marked
// delivered and never pushed.
func TestIntegrationDismissedAlertIsNotPushed(t *testing.T) {
	svc, db := zoneService(t, models.NotificationSettings{Reminders: true})
	user := zoneTestUser
	pushes := 0
	svc.http = &http.Client{Transport: roundTrip(func(*http.Request) (*http.Response, error) {
		pushes++
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"data":[]}`)), Header: http.Header{}}, nil
	})}
	now := time.Now().UTC()
	if err := db.Create(&models.PushDevice{ID: "dev_dismiss", UserID: user, Token: "ExponentPushToken[test]", CreatedAt: now, UpdatedAt: now, LastSeenAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	for _, n := range []models.Notification{
		{ID: "ntf_dismissed", UserID: user, Category: models.NotifySuggestion, Title: "Stale", Data: models.JobPayload{"kind": "stale"}, CreatedAt: now, DismissedAt: &now},
		{ID: "ntf_open", UserID: user, Category: models.NotifySuggestion, Title: "Stale", Data: models.JobPayload{"kind": "stale"}, CreatedAt: now},
	} {
		if err := db.Create(&n).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []string{"ntf_dismissed", "ntf_open"} {
		job := &models.Job{UserID: user, Kind: models.JobSendPush, Payload: models.JobPayload{"notificationId": id}}
		if err := svc.HandlePush(context.Background(), job); err != nil {
			t.Fatal(err)
		}
		var row models.Notification
		if err := db.First(&row, "id = ?", id).Error; err != nil || row.DeliveredAt == nil {
			t.Fatalf("%s not marked delivered: %v", id, err)
		}
		if id == "ntf_dismissed" && pushes != 0 {
			t.Fatal("a dismissed alert was pushed")
		}
	}
	if pushes != 1 {
		t.Fatalf("pushes %d, want only the open alert", pushes)
	}
}

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
