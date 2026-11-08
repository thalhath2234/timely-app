package notify

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"timely-api/internal/jobs"
	"timely-api/internal/models"
)

// The morning digest carries a "From your bots" section, marks it sent only
// when it saved a new row, and still goes out when Bots fail.
func TestIntegrationDigestFromYourBots(t *testing.T) {
	_, db := zoneService(t, models.NotificationSettings{DigestMorning: true, DigestEvening: true})
	asked := 0
	svc := NewService(db, jobs.NewQueue(db), countingToday{asked: &asked}, nil, nil, nil)
	lines, fail := []string{"BTC dip: below 25,000", "News: 3 new items"}, error(nil)
	dones := 0
	svc.SetBotDigest(func(_ context.Context, userID string, _ time.Time) ([]string, func() error, error) {
		if userID != zoneTestUser {
			t.Errorf("asked for %s", userID)
		}
		return lines, func() error { dones++; return nil }, fail
	})
	today := time.Now().Format("2006-01-02")
	digest := func(kind string) models.Notification {
		t.Helper()
		key := "digest:" + kind + ":" + zoneTestUser + ":" + today
		job := &models.Job{UserID: zoneTestUser, Kind: models.JobDailyDigest, DedupeKey: &key,
			Payload: models.JobPayload{"kind": kind, "date": today, "timezone": "UTC"}}
		if err := svc.HandleDigest(context.Background(), job); err != nil {
			t.Fatal(err)
		}
		svc.triageWait.Wait()
		if _, ok := job.Payload["bots"]; ok {
			t.Fatal("the job's payload was changed")
		}
		var row models.Notification
		if err := db.Where("dedupe_key = ?", key).First(&row).Error; err != nil {
			t.Fatal(err)
		}
		return row
	}

	row := digest("morning")
	want := "\n\nFrom your bots:\n• BTC dip: below 25,000\n• News: 3 new items"
	if !strings.HasSuffix(row.Body, want) || dones != 1 {
		t.Fatalf("body %q, done %d times", row.Body, dones)
	}
	if got, _ := row.Data["bots"].([]any); len(got) != 2 || got[0] != "BTC dip: below 25,000" || row.Data.String("kind") != "morning" {
		t.Fatalf("data %+v", row.Data)
	}
	// A retry finds the saved row, so nothing new is marked sent.
	digest("morning")
	if dones != 1 {
		t.Fatalf("a retried digest marked findings %d times", dones)
	}
	if row := digest("evening"); strings.Contains(row.Body, "From your bots") || dones != 1 {
		t.Fatalf("evening body %q", row.Body)
	}

	db.Where("user_id = ?", zoneTestUser).Delete(&models.Notification{})
	fail = errors.New("bots are down")
	if row := digest("morning"); strings.Contains(row.Body, "From your bots") || row.Data["bots"] != nil || dones != 1 {
		t.Fatalf("a failed bot digest gave %q", row.Body)
	}
	db.Where("user_id = ?", zoneTestUser).Delete(&models.Notification{})
	lines, fail = nil, nil
	if row := digest("morning"); strings.Contains(row.Body, "From your bots") || dones != 1 {
		t.Fatalf("no findings gave %q", row.Body)
	}
}
