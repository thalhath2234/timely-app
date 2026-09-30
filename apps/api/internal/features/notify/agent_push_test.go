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
		message := notificationPushMessage(n, "ExponentPushToken[test]")
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
	message := notificationPushMessage(n, "test")
	if message.Title != n.Title || message.Body != n.Body || message.Data["taskId"] != "task-a" || message.ChannelID != "reminders" {
		t.Fatal("reminder payload regressed")
	}
}
