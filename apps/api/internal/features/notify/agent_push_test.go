package notify

import (
	"encoding/json"
	"strings"
	"testing"
	"timely-api/internal/models"
)

func TestAgentPushKeepsPrivateDetailsOffLockScreenAndTargetsChat(t *testing.T) {
	kind, cid := "chat", "chat-a"
	for _, status := range []string{"approval", "failed", "completed"} {
		n := &models.Notification{ID: "ntf-a", Category: "agent", Title: "Private acquisition", Body: "Secret financial details", EntityType: &kind, EntityID: &cid, Data: models.JobPayload{"status": status}}
		message := notificationPushMessage(n, "ExponentPushToken[test]", models.NotificationSettings{})
		raw, err := json.Marshal(message)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(raw), "Private acquisition") || strings.Contains(string(raw), "Secret financial details") {
			t.Fatal("private content leaked into push")
		}
		if message.ChannelID != "agent" || !strings.Contains(string(raw), `"entityType":"chat"`) || !strings.Contains(string(raw), `"entityId":"chat-a"`) {
			t.Fatal("push lost its chat target")
		}
	}
}
func TestReminderPushRetainsContentAndTaskTarget(t *testing.T) {
	n := &models.Notification{ID: "ntf-a", Category: models.NotifyReminder, Title: "Reminder", Body: "A task", Data: models.JobPayload{"taskId": "task-a"}}
	message := notificationPushMessage(n, "test", models.NotificationSettings{})
	if message.Title != n.Title || message.Body != n.Body || message.Data["taskId"] != "task-a" || message.ChannelID != "reminders" {
		t.Fatal("reminder payload regressed")
	}
}

// A Bot alert shows its own text on the bots channel and names its Bot, and
// a Bot's data never sets the routing kind.
func TestBotPushKeepsContentAndNamesBot(t *testing.T) {
	kind, bid := "bot", "bot_a"
	n := &models.Notification{ID: "ntf-b", Category: models.NotifyBot, Title: "Price check: below 25,000", Body: "now ₹24,900", EntityType: &kind, EntityID: &bid, Data: models.JobPayload{"botId": bid, "botAlert": "alert", "phone": true}}
	message := notificationPushMessage(n, "ExponentPushToken[test]", models.NotificationSettings{})
	if message.ChannelID != "bots" || message.Title != n.Title || message.Body != n.Body {
		t.Fatalf("bot push = %q/%q on %q", message.Title, message.Body, message.ChannelID)
	}
	if message.Data["botId"] != bid || message.Data["kind"] != "" || message.Data["category"] != models.NotifyBot {
		t.Fatalf("bot push data = %v", message.Data)
	}
}

func TestDataBool(t *testing.T) {
	p := models.JobPayload{"on": true, "off": false, "text": "false"}
	for _, c := range []struct {
		key       string
		def, want bool
	}{{"on", false, true}, {"off", true, false}, {"text", true, true}, {"missing", true, true}, {"missing", false, false}} {
		if got := dataBool(p, c.key, c.def); got != c.want {
			t.Errorf("dataBool(%q, %v) = %v, want %v", c.key, c.def, got, c.want)
		}
	}
	if !dataBool(nil, "phone", true) {
		t.Error("a nil payload lost the default")
	}
}
