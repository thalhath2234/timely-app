package notify

import (
	"context"
	"testing"
	"time"

	"timely-api/internal/models"
)

func addLearnedBot(t *testing.T, svc *Service) {
	t.Helper()
	if err := svc.repo.db.Exec(`INSERT INTO bots (id, user_id, name, interval_seconds, next_check_at) VALUES ('bot_learn', ?, 'GPU deals', 900, now())`, zoneTestUser).Error; err != nil {
		t.Fatal(err)
	}
}

func learnedJobs(t *testing.T, svc *Service) []models.Job {
	t.Helper()
	var rows []models.Job
	if err := svc.repo.db.Where("kind = ? AND user_id = ?", models.JobSendPush, zoneTestUser).Order("created_at").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	return rows
}

// One push per staged Bot suggestion ("<bot> learned something - Keep?"),
// opening the Bot (data botId), in its own category; the same suggestion
// again sends nothing more.
func TestIntegrationBotLearnedPushOncePerSuggestion(t *testing.T) {
	svc, db := zoneService(t, models.NotificationSettings{Timezone: "UTC"})
	fake := newFakeExpo(t, svc)
	addDevices(t, db, 1, time.Now().UTC().Add(-time.Hour))
	addLearnedBot(t, svc)
	ctx := context.Background()
	for range 2 {
		if err := svc.BotLearned(ctx, zoneTestUser, "bot_learn", "pend-1", time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	if err := svc.BotLearned(ctx, zoneTestUser, "bot_gone", "pend-2", time.Now()); err != nil {
		t.Fatal(err)
	}
	var rows []models.Notification
	if err := db.Where("user_id = ? AND category = ?", zoneTestUser, models.NotifyBotLearned).Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Title != "GPU deals learned something - Keep?" || rows[0].Data.String("botId") != "bot_learn" || rows[0].SnoozedUntil != nil {
		t.Fatalf("notifications %+v", rows)
	}
	jobs := learnedJobs(t, svc)
	if len(jobs) != 1 {
		t.Fatalf("%d push jobs", len(jobs))
	}
	if err := svc.HandlePush(ctx, &jobs[0]); err != nil {
		t.Fatal(err)
	}
	sends := fake.sends()
	if len(sends) != 1 || len(sends[0].messages) != 1 {
		t.Fatalf("sends %+v", sends)
	}
	m := sends[0].messages[0]
	if m.Title != "GPU deals learned something - Keep?" || m.Data["category"] != models.NotifyBotLearned || m.Data["botId"] != "bot_learn" || m.ChannelID != "bots" {
		t.Fatalf("push %+v", m)
	}
	// Delivered: the job again sends nothing.
	if err := svc.HandlePush(ctx, &jobs[0]); err != nil {
		t.Fatal(err)
	}
	if n := len(fake.sends()); n != 1 {
		t.Fatalf("%d sends after a repeat", n)
	}
}

// In quiet hours the push waits for their end.
func TestIntegrationBotLearnedPushWaitsForQuietHours(t *testing.T) {
	now := time.Now().UTC()
	svc, db := zoneService(t, models.NotificationSettings{Timezone: "UTC",
		QuietHoursStart: now.Add(-time.Hour).Format("15:04"), QuietHoursEnd: now.Add(time.Hour).Format("15:04")})
	fake := newFakeExpo(t, svc)
	addDevices(t, db, 1, now.Add(-time.Hour))
	addLearnedBot(t, svc)
	ctx := context.Background()
	if err := svc.BotLearned(ctx, zoneTestUser, "bot_learn", "pend-q", now); err != nil {
		t.Fatal(err)
	}
	jobs := learnedJobs(t, svc)
	if len(jobs) != 1 || !jobs[0].RunAt.After(now.Add(30*time.Minute)) {
		t.Fatalf("push jobs %+v", jobs)
	}
	// Run early anyway: still quiet, nothing goes out.
	if err := svc.HandlePush(ctx, &jobs[0]); err != nil {
		t.Fatal(err)
	}
	if n := len(fake.sends()); n != 0 {
		t.Fatalf("%d sends in quiet hours", n)
	}
}
