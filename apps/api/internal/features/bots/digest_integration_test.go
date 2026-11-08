package bots

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/calendar"
	"timely-api/internal/features/notify"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

func (e *engine) finding(userID, botID, title string, at time.Time) string {
	e.t.Helper()
	f := Finding{ID: utils.PrefixedUUID("bfd"), BotID: botID, UserID: userID, Kind: "price", Title: title,
		Urgency: "normal", OutsideData: true, CreatedAt: at}
	must(e.t, e.db.Create(&f).Error)
	return f.ID
}

func TestIntegrationBotDigestLines(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	if lines, done, err := e.s.DigestLines(ctx, e.user, e.now); err != nil || lines != nil || done != nil {
		t.Fatalf("no findings gave %v, %v", lines, err)
	}
	var ids []string
	for i := 1; i <= 10; i++ {
		ids = append(ids, e.create(btcBot(fmt.Sprintf("Bot %02d", i))).ID)
	}
	// Bot 01 has the five newest findings, then Bots 02 to 10 one each.
	for i := range 5 {
		e.finding(e.user, ids[0], fmt.Sprintf("note %d", i), e.now.Add(-time.Duration(i+1)*time.Minute))
	}
	for i := 1; i < 10; i++ {
		e.finding(e.user, ids[i], "note", e.now.Add(-time.Duration(i+1)*time.Hour))
	}
	old := e.finding(e.user, ids[1], "too old", e.now.Add(-25*time.Hour))
	sent := e.finding(e.user, ids[1], "already sent", e.now.Add(-time.Hour))
	must(t, e.db.Model(&Finding{}).Where("id = ?", sent).Update("digested_at", e.now.Add(-time.Hour)).Error)
	other := addUser(t, e.db)
	theirs, err := e.s.Create(ctx, other, btcBot("Bot 01"), OriginApp)
	must(t, err)
	e.finding(other, theirs.ID, "not yours", e.now.Add(-time.Minute))

	lines, done, err := e.s.DigestLines(ctx, e.user, e.now)
	must(t, err)
	want := []string{"Bot 01: note 0", "Bot 01: note 1", "Bot 01: note 2"}
	for i := 2; i <= 8; i++ {
		want = append(want, fmt.Sprintf("Bot %02d: note", i))
	}
	want = append(want, "and 4 more")
	if !slices.Equal(lines, want) {
		t.Fatalf("lines\n%s\nwant\n%s", strings.Join(lines, "\n"), strings.Join(want, "\n"))
	}

	// A finding written after the lines were read stays for the next digest.
	later := e.finding(e.user, ids[2], "came later", e.now)
	must(t, done())
	if n := e.count("bot_findings", "user_id = ? AND digested_at = ?", e.user, e.now); n != 14 {
		t.Fatalf("%d findings marked digested; want the 14 the lines cover", n)
	}
	if n := e.count("bot_findings", "id IN ? AND digested_at IS NULL", []string{old, later}); n != 2 {
		t.Fatalf("marked findings the lines did not cover")
	}
	if n := e.count("bot_findings", "user_id = ? AND digested_at IS NULL", other); n != 1 {
		t.Fatal("marked another account's finding")
	}
	lines, _, err = e.s.DigestLines(ctx, e.user, e.now.Add(time.Minute))
	must(t, err)
	if !slices.Equal(lines, []string{"Bot 03: came later"}) {
		t.Fatalf("next digest %v", lines)
	}
}

type emptyToday struct{ calendar.Service }

func (emptyToday) Today(string, string, string) (*calendar.TodayResponse, error) {
	return &calendar.TodayResponse{}, nil
}

// The 08:00 digest names the past day's findings and marks them digested.
func TestIntegrationBotMorningDigest(t *testing.T) {
	e := newEngine(t)
	e.zone(models.NotificationSettings{DigestMorning: true})
	v := e.create(btcBot("BTC dip", Rule{Kind: RuleBelow, Threshold: f64(25000)}))
	id := e.finding(e.user, v.ID, "below 25,000", time.Now().Add(-time.Hour))

	svc := notify.NewService(e.db, jobs.NewQueue(e.db), emptyToday{}, nil, nil, nil)
	svc.SetBotDigest(e.s.DigestLines)
	today := time.Now().Format("2006-01-02")
	key := "digest:morning:" + e.user + ":" + today
	must(t, svc.HandleDigest(context.Background(), &models.Job{UserID: e.user, Kind: models.JobDailyDigest, DedupeKey: &key,
		Payload: models.JobPayload{"kind": "morning", "date": today, "timezone": "UTC"}}))

	var row models.Notification
	must(t, e.db.Where("dedupe_key = ?", key).First(&row).Error)
	if !strings.Contains(row.Body, "From your bots:\n• BTC dip: below 25,000") {
		t.Fatalf("morning body %q", row.Body)
	}
	if n := e.count("bot_findings", "id = ? AND digested_at IS NOT NULL", id); n != 1 {
		t.Fatal("the finding was not marked digested")
	}
}
