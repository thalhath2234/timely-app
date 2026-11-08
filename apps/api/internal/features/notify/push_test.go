package notify

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"timely-api/internal/models"
)

func TestExpoBaseURL(t *testing.T) {
	for _, c := range []struct {
		raw, want string
		ok        bool
	}{
		{"", defaultExpoBase, true},
		{"  ", defaultExpoBase, true},
		{"https://push.example.com/--/api/v2/push/", "https://push.example.com/--/api/v2/push", true},
		{"https://exp.host/--/api/v2/push", "https://exp.host/--/api/v2/push", true},
		{"http://127.0.0.1:9999", "http://127.0.0.1:9999", true},
		{"http://localhost:9999/push", "http://localhost:9999/push", true},
		{"http://[::1]:9999", "http://[::1]:9999", true},
		{"http://example.com/push", defaultExpoBase, false},
		{"http://127.0.0.1.example.com", defaultExpoBase, false},
		{"ftp://exp.host", defaultExpoBase, false},
		{"https://user:pass@exp.host", defaultExpoBase, false},
		{"exp.host/--/api/v2/push", defaultExpoBase, false},
		{"::not a url", defaultExpoBase, false},
	} {
		got, err := expoBaseURL(c.raw)
		if got != c.want || (err == nil) != c.ok {
			t.Errorf("expoBaseURL(%q) = %q, %v; want %q, ok %v", c.raw, got, err, c.want, c.ok)
		}
	}
}

func botPushNotification(data models.JobPayload) *models.Notification {
	kind, bid := "bot", "bot_a"
	return &models.Notification{ID: "ntf-b", Category: models.NotifyBot, Title: "Sony WH-1000XM6 is down to ₹24,900",
		Body: "now ₹24,900 (was ₹27,499) at shop.example.com", EntityType: &kind, EntityID: &bid, Data: data}
}

// A Bot alert's push goes on the bots channel with what the phone needs to
// open it and offer Resume; only a resumable paused alert gets the Resume
// category.
func TestBotPushChannelDataAndCategory(t *testing.T) {
	n := botPushNotification(models.JobPayload{"botId": "bot_a", "alertId": "bal_1", "checkId": "bck_1",
		"url": "https://shop.example.com/sony", "botAlert": "alert", "phone": true})
	m := notificationPushMessage(n, "ExponentPushToken[a]", models.NotificationSettings{})
	if m.ChannelID != "bots" || m.CategoryID != "" || m.Title != n.Title || m.Body != n.Body {
		t.Fatalf("bot push = %q/%q on %q (%q)", m.Title, m.Body, m.ChannelID, m.CategoryID)
	}
	for key, want := range map[string]any{"botAlert": "alert", "resume": false, "alertId": "bal_1", "checkId": "bck_1",
		"url": "https://shop.example.com/sony", "botId": "bot_a"} {
		if m.Data[key] != want {
			t.Errorf("data[%s] = %v, want %v", key, m.Data[key], want)
		}
	}

	for _, c := range []struct {
		data models.JobPayload
		want string
	}{
		{models.JobPayload{"botAlert": "paused", "resume": true}, "timely_bot_paused"},
		{models.JobPayload{"botAlert": "paused"}, ""},
		{models.JobPayload{"botAlert": "paused", "resume": false}, ""},
		{models.JobPayload{"botAlert": "alert", "resume": true}, ""},
	} {
		m := notificationPushMessage(botPushNotification(c.data), "t", models.NotificationSettings{})
		if m.CategoryID != c.want || m.Data["resume"] != dataBool(c.data, "resume", false) {
			t.Errorf("%v: category %q resume %v, want %q", c.data, m.CategoryID, m.Data["resume"], c.want)
		}
	}
	// A reminder that happens to carry the same keys is not a Bot's.
	r := &models.Notification{ID: "ntf-r", Category: models.NotifyReminder, Data: models.JobPayload{"botAlert": "paused", "resume": true}}
	if m := notificationPushMessage(r, "t", models.NotificationSettings{}); m.CategoryID != "" || m.ChannelID != "reminders" {
		t.Fatalf("reminder push = %q on %q", m.CategoryID, m.ChannelID)
	}
}

// With the alert text hidden, Expo and Google see only fixed words and ids.
func TestBotPushHiddenCarriesNoText(t *testing.T) {
	n := botPushNotification(models.JobPayload{"botId": "bot_a", "alertId": "bal_1", "checkId": "bck_1",
		"url": "https://shop.example.com/sony", "botAlert": "paused", "resume": true, "phone": true, "urgent": true,
		"figures": map[string]any{"price": "₹24,900"}, "note": "a future field"})
	m := notificationPushMessage(n, "ExponentPushToken[a]", models.NotificationSettings{HidePushText: true})
	if m.Title != HiddenPushTitle || m.Body != HiddenPushBody || m.ChannelID != "bots" || m.CategoryID != "timely_bot_paused" {
		t.Fatalf("hidden push = %q/%q on %q (%q)", m.Title, m.Body, m.ChannelID, m.CategoryID)
	}
	keys := make([]string, 0, len(m.Data))
	for key := range m.Data {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	want := []string{"alertId", "botAlert", "botId", "category", "checkId", "entityId", "entityType", "notificationId", "resume"}
	if !slices.Equal(keys, want) {
		t.Fatalf("hidden data keys = %v, want %v", keys, want)
	}
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{n.Title, n.Body, "https://shop.example.com/sony", "shop.example.com", "₹24,900", "a future field"} {
		if strings.Contains(string(raw), secret) {
			t.Errorf("hidden push carries %q: %s", secret, raw)
		}
	}
}

// A hidden digest keeps its own text and cuts its Bots section; a reminder
// is not a Bot alert and keeps its text.
func TestHiddenPushDigestAndReminder(t *testing.T) {
	hidden := models.NotificationSettings{HidePushText: true}
	for _, category := range []string{models.NotifyDigest, models.NotifyPlanning} {
		d := &models.Notification{ID: "ntf-d", Category: category, Title: "Good morning",
			Body: "3 tasks today.\n\nFrom your bots:\n• Sony WH-1000XM6: below ₹25,000\n• News: 3 new items"}
		m := notificationPushMessage(d, "t", hidden)
		if m.Title != "Good morning" || m.Body != "3 tasks today.\n\n"+hiddenDigestBots || !strings.HasSuffix(m.Body, "Your bots have news.") {
			t.Fatalf("%s hidden = %q / %q", category, m.Title, m.Body)
		}
		if m := notificationPushMessage(d, "t", models.NotificationSettings{}); m.Body != d.Body {
			t.Fatalf("%s shown = %q", category, m.Body)
		}
	}
	plain := &models.Notification{ID: "ntf-d", Category: models.NotifyDigest, Title: "Good morning", Body: "3 tasks today."}
	if m := notificationPushMessage(plain, "t", hidden); m.Body != plain.Body {
		t.Fatalf("a digest with no bots = %q", m.Body)
	}

	r := &models.Notification{ID: "ntf-r", Category: models.NotifyReminder, Title: "Reminder", Body: "Call the bank", Data: models.JobPayload{"taskId": "task-a"}}
	shown := notificationPushMessage(r, "t", models.NotificationSettings{})
	m := notificationPushMessage(r, "t", hidden)
	a, _ := json.Marshal(shown)
	b, _ := json.Marshal(m)
	if string(a) != string(b) {
		t.Fatalf("hiding changed a reminder:\n%s\n%s", a, b)
	}
}

// Expo's error replies can echo the request's tokens; the error text masks
// them and stays short.
func TestExpoErrorText(t *testing.T) {
	raw := []byte(`{"errors":[{"code":"PUSH_TOO_MANY_EXPERIENCE_IDS","details":{"@a/x":["ExponentPushToken[aaaa]"],"@b/y":["ExpoPushToken[bbbb]"]}}]}` + strings.Repeat("x", 400))
	got := expoErrorText(raw)
	if strings.Contains(got, "aaaa") || strings.Contains(got, "bbbb") || !strings.Contains(got, "PUSH_TOO_MANY_EXPERIENCE_IDS") || len(got) > 303 {
		t.Fatalf("expoErrorText = %q", got)
	}
}
