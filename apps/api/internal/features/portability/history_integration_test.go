package portability

import (
	"testing"
	"time"

	"timely-api/internal/jobs"
	"timely-api/internal/models"
)

// GB22, GB23 and GB25: a restore deleted every job, which is the record the
// sweep checks before queueing the day's digest, smart alerts and overdue
// alerts again, so each restore sent them, and paid for their AI calls, a
// second time. GB24: it also deleted the goal tags, so the next goal progress
// asked about every task again although none had changed.
func TestIntegrationRestoreKeepsWhatWasAlreadyDone(t *testing.T) {
	db := migratedDB(t)
	const uid = "usr_portability_history"
	if err := db.Create(&models.User{ID: uid, Email: "history@example.invalid", Password: "not-a-real-hash"}).Error; err != nil {
		t.Fatal(err)
	}
	seedAccountBasics(t, db, uid, true)
	now := time.Now().UTC()
	key := func(s string) *string { return &s }
	for _, job := range []models.Job{
		{ID: "job_alerts", Kind: models.JobSmartAlerts, Status: models.JobSucceeded, DedupeKey: key("smart_alerts:" + uid + ":2026-10-31")},
		{ID: "job_digest", Kind: models.JobDailyDigest, Status: models.JobSucceeded, DedupeKey: key("digest:morning:" + uid + ":2026-10-31")},
		{ID: "job_waiting", Kind: models.JobSendReminder, Status: models.JobPending, DedupeKey: key("reminder:tsk_1:x")},
		{ID: "job_failed", Kind: models.JobIndexEntity, Status: models.JobFailed},
	} {
		job.UserID, job.Payload, job.RunAt, job.MaxAttempts, job.CreatedAt, job.UpdatedAt = uid, models.JobPayload{}, now, 8, now, now
		if err := db.Create(&job).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Exec(`INSERT INTO goal_task_tags (user_id, task_id, goals_hash, task_hash, goal_id) VALUES (?, 'tsk_1', 'gh', 'th', 'goal_1')`, uid).Error; err != nil {
		t.Fatal(err)
	}

	service := NewService(db, nil)
	backup, err := service.Export(uid)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Restore(uid, backup); err != nil {
		t.Fatal(err)
	}

	var kept []string
	db.Model(&models.Job{}).Where("user_id = ?", uid).Order("id").Pluck("id", &kept)
	if len(kept) != 2 || kept[0] != "job_alerts" || kept[1] != "job_digest" {
		t.Fatalf("jobs after the restore: %v; want only the finished ones", kept)
	}
	queue := jobs.NewQueue(db)
	if !queue.HasJob("smart_alerts:"+uid+":2026-10-31") || !queue.HasJob("digest:morning:"+uid+":2026-10-31") {
		t.Fatal("the sweep would send the day's smart alerts or digest again")
	}
	var tags int64
	db.Table("goal_task_tags").Where("user_id = ?", uid).Count(&tags)
	if tags != 1 {
		t.Fatal("the restore dropped the goal tags")
	}
}
