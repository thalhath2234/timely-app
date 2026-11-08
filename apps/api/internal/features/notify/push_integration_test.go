package notify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"timely-api/internal/models"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
)

// fakeExpo is Expo's push API on localhost. send answers each message by its
// token: tokens in dead get DeviceNotRegistered, in failing another error,
// the rest an ok ticket "tk-dev<n>" (never the token). fail lists the
// request numbers (from 1) answered with a 500.
type fakeExpo struct {
	mu       sync.Mutex
	server   *httptest.Server
	dead     map[string]bool
	failing  map[string]bool
	fail     map[int]bool
	receipts map[string]expoTicket
	calls    []fakeCall
}

type fakeCall struct {
	path, auth string
	messages   []expoMessage
	ids        []string
}

func newFakeExpo(t *testing.T, svc *Service) *fakeExpo {
	t.Helper()
	f := &fakeExpo{dead: map[string]bool{}, failing: map[string]bool{}, fail: map[int]bool{}, receipts: map[string]expoTicket{}}
	f.server = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.server.Close)
	svc.expoBase = f.server.URL + "/--/api/v2/push"
	svc.http = f.server.Client()
	return f
}

func (f *fakeExpo) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	raw, _ := io.ReadAll(r.Body)
	call := fakeCall{path: r.URL.Path, auth: r.Header.Get("Authorization")}
	switch r.URL.Path {
	case "/--/api/v2/push/send":
		_ = json.Unmarshal(raw, &call.messages)
	case "/--/api/v2/push/getReceipts":
		var body struct {
			IDs []string `json:"ids"`
		}
		_ = json.Unmarshal(raw, &body)
		call.ids = body.IDs
	default:
		http.NotFound(w, r)
		return
	}
	f.calls = append(f.calls, call)
	if f.fail[len(f.calls)] {
		http.Error(w, `{"errors":[{"code":"INTERNAL"}]}`, http.StatusInternalServerError)
		return
	}
	if call.ids != nil {
		data := map[string]expoTicket{}
		for _, id := range call.ids {
			if receipt, ok := f.receipts[id]; ok {
				data[id] = receipt
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
		return
	}
	tickets := make([]map[string]any, 0, len(call.messages))
	for _, m := range call.messages {
		switch {
		case f.dead[m.To]:
			tickets = append(tickets, map[string]any{"status": "error", "message": "not registered", "details": map[string]any{"error": "DeviceNotRegistered"}})
		case f.failing[m.To]:
			tickets = append(tickets, map[string]any{"status": "error", "message": "too big", "details": map[string]any{"error": "MessageTooBig"}})
		default:
			tickets = append(tickets, map[string]any{"status": "ok", "id": "tk-" + strings.TrimSuffix(strings.TrimPrefix(m.To, "ExponentPushToken["), "]")})
		}
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"data": tickets})
}

func (f *fakeExpo) sends() []fakeCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []fakeCall
	for _, c := range f.calls {
		if c.ids == nil {
			out = append(out, c)
		}
	}
	return out
}

func deadReceipt() expoTicket {
	var t expoTicket
	t.Status, t.Message, t.Details.Error = "error", "not registered", expoDeadToken
	return t
}

const devicesSession = "ses_notify_devices"

func pushToken(i int) string { return fmt.Sprintf("ExponentPushToken[dev%03d]", i) }

func ticketID(i int) string { return fmt.Sprintf("tk-dev%03d", i) }

// addDevices registers n devices for the test account under one live
// sign-in (devicesSession), updated at when.
func addDevices(t *testing.T, db *gorm.DB, n int, when time.Time) []models.PushDevice {
	t.Helper()
	session := testSession(t, db, devicesSession)
	rows := make([]models.PushDevice, n)
	for i := range rows {
		rows[i] = models.PushDevice{ID: fmt.Sprintf("dev_%03d", i), UserID: zoneTestUser, SessionID: &session, Token: pushToken(i), Platform: "android", CreatedAt: when, UpdatedAt: when, LastSeenAt: when}
	}
	if err := db.CreateInBatches(rows, 100).Error; err != nil {
		t.Fatal(err)
	}
	return rows
}

func deviceExists(t *testing.T, db *gorm.DB, id string) bool {
	t.Helper()
	var n int64
	if err := db.Model(&models.PushDevice{}).Where("id = ?", id).Count(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n == 1
}

func receiptJobs(t *testing.T, db *gorm.DB) []models.Job {
	t.Helper()
	var rows []models.Job
	if err := db.Where("kind = ?", models.JobPushReceipts).Order("created_at").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	return rows
}

func reminderRow(t *testing.T, db *gorm.DB, id string) *models.Notification {
	t.Helper()
	n := &models.Notification{ID: id, UserID: zoneTestUser, Category: models.NotifyReminder, Title: "Reminder", Body: "Call the bank", Data: models.JobPayload{"taskId": "task-a"}, CreatedAt: time.Now().UTC()}
	if err := db.Create(n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

// 250 devices go out in three requests of at most 100; a dead token's device
// is deleted at once, and the ok tickets are checked again 15 minutes later
// by one push_receipts job that names devices, never tokens.
func TestIntegrationExpoSendChunksAndQueuesReceipts(t *testing.T) {
	svc, db := zoneService(t, models.NotificationSettings{})
	fake := newFakeExpo(t, svc)
	devices := addDevices(t, db, 250, time.Now().UTC().Add(-time.Hour))
	fake.dead[pushToken(5)] = true
	fake.failing[pushToken(7)] = true
	n := reminderRow(t, db, "ntf_chunks")

	before := time.Now().UTC()
	if err := svc.sendPush(context.Background(), n, models.NotificationSettings{}); err != nil {
		t.Fatal(err)
	}
	sends := fake.sends()
	if len(sends) != 3 || len(sends[0].messages) != 100 || len(sends[1].messages) != 100 || len(sends[2].messages) != 50 {
		t.Fatalf("sends = %d", len(sends))
	}
	for _, c := range sends {
		if c.auth != "" {
			t.Fatalf("Authorization %q sent with no access token", c.auth)
		}
	}
	if deviceExists(t, db, devices[5].ID) || !deviceExists(t, db, devices[7].ID) || !deviceExists(t, db, devices[6].ID) {
		t.Fatal("only the dead token's device should be deleted")
	}
	if notificationRow(t, db, n.ID).DeliveredAt == nil {
		t.Fatal("the reminder was not marked delivered")
	}

	queued := receiptJobs(t, db)
	if len(queued) != 1 {
		t.Fatalf("receipt jobs = %d, want 1", len(queued))
	}
	job := queued[0]
	sentAt, err := time.Parse(time.RFC3339Nano, job.Payload.String("sentAt"))
	if err != nil || sentAt.Before(before) || job.RunAt.Sub(sentAt.Add(receiptsAfter)).Abs() > time.Millisecond || job.MaxAttempts != 3 || job.UserID != zoneTestUser {
		t.Fatalf("receipt job = run %v sentAt %v (%v) attempts %d", job.RunAt, sentAt, err, job.MaxAttempts)
	}
	tickets, _ := job.Payload["tickets"].(map[string]any)
	if len(tickets) != 248 || tickets[ticketID(0)] != devices[0].ID || tickets[ticketID(249)] != devices[249].ID || tickets[ticketID(5)] != nil {
		t.Fatalf("receipt tickets = %d entries", len(tickets))
	}
	raw, _ := json.Marshal(job.Payload)
	if strings.Contains(string(raw), "ExponentPushToken") {
		t.Fatalf("the receipts payload carries a push token: %.200s", raw)
	}
}

// Only a failed first request is an error; a failed later one is logged and
// the rest still go out, with their tickets queued.
func TestIntegrationExpoChunkFailures(t *testing.T) {
	svc, db := zoneService(t, models.NotificationSettings{})
	fake := newFakeExpo(t, svc)
	addDevices(t, db, 250, time.Now().UTC().Add(-time.Hour))

	fake.fail[1] = true
	first := reminderRow(t, db, "ntf_first_fails")
	if err := svc.sendPush(context.Background(), first, models.NotificationSettings{}); err == nil {
		t.Fatal("a failed first chunk was not an error")
	}
	if len(fake.sends()) != 1 || len(receiptJobs(t, db)) != 0 || notificationRow(t, db, first.ID).DeliveredAt != nil {
		t.Fatalf("after a failed first chunk: %d sends, %d receipt jobs", len(fake.sends()), len(receiptJobs(t, db)))
	}

	fake.mu.Lock()
	fake.calls, fake.fail = nil, map[int]bool{2: true}
	fake.mu.Unlock()
	second := reminderRow(t, db, "ntf_second_fails")
	if err := svc.sendPush(context.Background(), second, models.NotificationSettings{}); err != nil {
		t.Fatalf("a failed second chunk = %v", err)
	}
	if len(fake.sends()) != 3 || notificationRow(t, db, second.ID).DeliveredAt == nil {
		t.Fatalf("after a failed second chunk: %d sends", len(fake.sends()))
	}
	queued := receiptJobs(t, db)
	if len(queued) != 1 {
		t.Fatalf("receipt jobs = %d", len(queued))
	}
	tickets, _ := queued[0].Payload["tickets"].(map[string]any)
	if len(tickets) != 150 || tickets[ticketID(0)] == nil || tickets[ticketID(249)] == nil || tickets[ticketID(150)] != nil {
		t.Fatalf("tickets after a failed second chunk = %d", len(tickets))
	}
}

// An access token goes as a Bearer header on every call, only when set.
func TestIntegrationExpoAccessToken(t *testing.T) {
	svc, db := zoneService(t, models.NotificationSettings{})
	fake := newFakeExpo(t, svc)
	svc.expoToken = "expo-access-test"
	devices := addDevices(t, db, 1, time.Now().UTC().Add(-time.Hour))
	if err := svc.sendPush(context.Background(), reminderRow(t, db, "ntf_bearer"), models.NotificationSettings{}); err != nil {
		t.Fatal(err)
	}
	job := receiptJobs(t, db)[0]
	if err := svc.HandleReceipts(context.Background(), &job); err != nil {
		t.Fatal(err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if len(fake.calls) != 2 || fake.calls[1].ids[0] != ticketID(0) || devices[0].ID == "" {
		t.Fatalf("calls = %+v", fake.calls)
	}
	for _, c := range fake.calls {
		if c.auth != "Bearer expo-access-test" {
			t.Fatalf("%s Authorization = %q", c.path, c.auth)
		}
	}
}

// HandleReceipts deletes a device Expo no longer knows, unless it was
// registered again since the push, by this account or by another one the
// token moved to; a receipt Expo no longer has is skipped, and a failed call
// is retried.
func TestIntegrationExpoReceipts(t *testing.T) {
	svc, db := zoneService(t, models.NotificationSettings{})
	fake := newFakeExpo(t, svc)
	other := "usr_notify_push_other"
	if err := db.Create(&models.User{ID: other, Email: "notify-push-other@example.invalid", Password: "not-a-real-hash"}).Error; err != nil {
		t.Fatal(err)
	}
	devices := addDevices(t, db, 5, time.Now().UTC().Add(-time.Hour))
	sentAt := time.Now().UTC().Add(-time.Minute)
	// Registered again after the push: same row, newer updated_at.
	if _, err := svc.repo.RegisterDevice(zoneTestUser, devicesSession, devices[3].Token, "android"); err != nil {
		t.Fatal(err)
	}
	// The same token moved to another account after the push.
	otherSession := liveSession(t, db, other, "ses_notify_push_other", time.Now().Add(time.Hour))
	if _, err := svc.repo.RegisterDevice(other, otherSession, devices[4].Token, "android"); err != nil {
		t.Fatal(err)
	}
	tickets := map[string]any{}
	for i, d := range devices {
		tickets[fmt.Sprintf("tk-%d", i)] = d.ID
	}
	var ok expoTicket
	ok.Status = "ok"
	fake.receipts = map[string]expoTicket{"tk-0": deadReceipt(), "tk-2": ok, "tk-3": deadReceipt(), "tk-4": deadReceipt()} // tk-1 is gone
	job := &models.Job{UserID: zoneTestUser, Kind: models.JobPushReceipts, Payload: models.JobPayload{"sentAt": sentAt.Format(time.RFC3339Nano), "tickets": tickets}}

	fake.fail[1] = true
	if err := svc.HandleReceipts(context.Background(), job); err == nil {
		t.Fatal("a failed receipts call was not an error")
	}
	if !deviceExists(t, db, devices[0].ID) {
		t.Fatal("a failed receipts call deleted a device")
	}
	if err := svc.HandleReceipts(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	want := map[int]bool{0: false, 1: true, 2: true, 3: true, 4: true}
	for i, keep := range want {
		if deviceExists(t, db, devices[i].ID) != keep {
			t.Errorf("device %d kept = %v, want %v", i, !keep, keep)
		}
	}
	fake.mu.Lock()
	ids := fake.calls[len(fake.calls)-1].ids
	fake.mu.Unlock()
	if len(ids) != 5 || ids[0] != "tk-0" || ids[4] != "tk-4" {
		t.Fatalf("receipt ids = %v", ids)
	}

	// A bad payload is not retried.
	bad := &models.Job{UserID: zoneTestUser, Kind: models.JobPushReceipts, Payload: models.JobPayload{"sentAt": "yesterday"}}
	if err := svc.HandleReceipts(context.Background(), bad); err == nil {
		t.Fatal("a bad sentAt was accepted")
	}
}

// A ticket that says DeviceNotRegistered spares a device registered again
// while the push was going out.
func TestIntegrationDeleteDeviceGuard(t *testing.T) {
	svc, db := zoneService(t, models.NotificationSettings{})
	devices := addDevices(t, db, 2, time.Now().UTC().Add(-time.Hour))
	cut := time.Now().UTC().Add(-time.Minute)
	if err := svc.repo.DeleteDevice(devices[0].ID, "usr_someone_else", cut); err != nil || !deviceExists(t, db, devices[0].ID) {
		t.Fatalf("another account deleted a device (%v)", err)
	}
	if err := svc.repo.DeleteDevice(devices[0].ID, zoneTestUser, devices[0].UpdatedAt.Add(-time.Second)); err != nil || !deviceExists(t, db, devices[0].ID) {
		t.Fatalf("a newer device was deleted (%v)", err)
	}
	if err := svc.repo.DeleteDevice(devices[0].ID, zoneTestUser, cut); err != nil || deviceExists(t, db, devices[0].ID) || !deviceExists(t, db, devices[1].ID) {
		t.Fatalf("the dead device was not deleted alone (%v)", err)
	}
}

func settingsCall(t *testing.T, h *Handler, method, path, body string, handle func(*echo.Context) error) (int, models.NotificationSettings) {
	t.Helper()
	e := echo.New()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.Set("userID", zoneTestUser)
	if err := handle(c); err != nil {
		var he *echo.HTTPError
		if errors.As(err, &he) {
			return he.Code, models.NotificationSettings{}
		}
		t.Fatal(err)
	}
	var out models.NotificationSettings
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("%s %s reply %q: %v", method, path, rec.Body.String(), err)
	}
	return rec.Code, out
}

// Only PUT /notifications/settings/push-text changes hidePushText; saving
// the settings form, with any value of it, keeps the stored one.
func TestIntegrationHidePushTextSetting(t *testing.T) {
	svc, db := zoneService(t, models.NotificationSettings{Reminders: true, QuietHoursStart: "22:00", QuietHoursEnd: "07:00"})
	h := NewHandler(svc, svc.queue)

	if code, got := settingsCall(t, h, http.MethodPut, "/notifications/settings/push-text", `{"hidden":true}`, h.SetPushText); code != http.StatusOK || !got.HidePushText || got.QuietHoursStart != "22:00" || !got.Reminders {
		t.Fatalf("push-text on = %d %+v", code, got)
	}
	for _, body := range []string{`{}`, `{"hidden":"yes"}`, `nope`} {
		if code, _ := settingsCall(t, h, http.MethodPut, "/notifications/settings/push-text", body, h.SetPushText); code != http.StatusBadRequest {
			t.Fatalf("push-text %s = %d", body, code)
		}
	}
	if s, _ := svc.GetSettings(zoneTestUser); !s.HidePushText {
		t.Fatal("a bad body changed the switch")
	}

	code, got := settingsCall(t, h, http.MethodPut, "/notifications/settings", `{"reminders":false,"quietHoursStart":"23:00","quietHoursEnd":"06:00","hidePushText":false}`, h.UpdateSettings)
	if code != http.StatusOK || !got.HidePushText || got.Reminders || got.QuietHoursStart != "23:00" {
		t.Fatalf("settings save = %d %+v", code, got)
	}
	if s, _ := svc.GetSettings(zoneTestUser); !s.HidePushText || s.QuietHoursEnd != "06:00" {
		t.Fatalf("stored after a settings save = %+v", s)
	}

	if code, got := settingsCall(t, h, http.MethodPut, "/notifications/settings/push-text", `{"hidden":false}`, h.SetPushText); code != http.StatusOK || got.HidePushText || got.QuietHoursStart != "23:00" {
		t.Fatalf("push-text off = %d %+v", code, got)
	}
	// A save with hidePushText true does not turn it on either.
	if _, err := svc.UpdateSettings(zoneTestUser, models.NotificationSettings{HidePushText: true}); err != nil {
		t.Fatal(err)
	}
	if s, _ := svc.GetSettings(zoneTestUser); s.HidePushText {
		t.Fatal("a settings save turned hidePushText on")
	}
	if _, err := svc.SetPushTextHidden("usr_nobody", true); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("push-text for an account with no config = %v", err)
	}
	var raw string
	if err := db.Raw("SELECT notification_settings::text FROM configs WHERE user_id = ?", zoneTestUser).Scan(&raw).Error; err != nil || !strings.Contains(raw, `"hidePushText": false`) {
		t.Fatalf("stored settings = %s (%v)", raw, err)
	}
}

// An account that never saved its settings stores '{}', which reads as the
// defaults; the switch keeps them instead of turning everything else off.
func TestIntegrationHidePushTextOnUnsavedSettings(t *testing.T) {
	svc, db := zoneService(t, models.NotificationSettings{})
	if err := db.Exec(`UPDATE configs SET notification_settings = '{}'::jsonb WHERE user_id = ?`, zoneTestUser).Error; err != nil {
		t.Fatal(err)
	}
	h := NewHandler(svc, svc.queue)
	if code, _ := settingsCall(t, h, http.MethodPut, "/notifications/settings/push-text", `{"hidden":true}`, h.SetPushText); code != http.StatusOK {
		t.Fatalf("push-text on = %d", code)
	}
	code, got := settingsCall(t, h, http.MethodGet, "/notifications/settings", ``, h.GetSettings)
	if code != http.StatusOK || !got.HidePushText || !got.Reminders || !got.DigestMorning || !got.DigestEvening || !got.Planning || got.MorningDigestAt != "08:00" {
		t.Fatalf("settings after the switch on '{}' = %d %+v", code, got)
	}
}

// Settings saves racing the switch never undo it.
func TestIntegrationHidePushTextSurvivesConcurrentSaves(t *testing.T) {
	svc, _ := zoneService(t, models.NotificationSettings{Reminders: true})
	var wg sync.WaitGroup
	errs := make(chan error, 100)
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 50; i++ {
			_, err := svc.UpdateSettings(zoneTestUser, models.NotificationSettings{Reminders: i%2 == 0, QuietHoursStart: "22:00", QuietHoursEnd: "07:00"})
			errs <- err
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 50; i++ {
			_, err := svc.SetPushTextHidden(zoneTestUser, true)
			errs <- err
		}
	}()
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	s, err := svc.GetSettings(zoneTestUser)
	if err != nil || !s.HidePushText || s.QuietHoursStart != "22:00" {
		t.Fatalf("after the race = %+v (%v)", s, err)
	}
}
