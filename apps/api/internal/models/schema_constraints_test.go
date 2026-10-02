package models

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// latestCheckList returns the value list of the newest "ADD CONSTRAINT <name>
// CHECK (<column> IN (...))" statement in the Up sections of the migrations,
// which is the constraint a fresh database ends up with.
func latestCheckList(t *testing.T, constraint string) []string {
	t.Helper()
	files, err := filepath.Glob(filepath.Join("..", "..", "migrations", "*.sql"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no migrations found: %v", err)
	}
	sort.Strings(files)
	pattern := regexp.MustCompile(`(?is)ADD CONSTRAINT\s+` + constraint + `\s+CHECK\s*\(\s*\w+\s+IN\s*\(([^)]*)\)`)
	var latest []string
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		up := strings.Split(string(raw), "-- +goose Down")[0]
		for _, match := range pattern.FindAllStringSubmatch(up, -1) {
			latest = latest[:0]
			for _, value := range strings.Split(match[1], ",") {
				latest = append(latest, strings.Trim(strings.TrimSpace(value), "'"))
			}
		}
	}
	if len(latest) == 0 {
		t.Fatalf("constraint %s not defined by any migration", constraint)
	}
	return latest
}

func assertAllowed(t *testing.T, constraint string, allowed []string, values ...string) {
	t.Helper()
	set := map[string]bool{}
	for _, value := range allowed {
		set[value] = true
	}
	for _, value := range values {
		if !set[value] {
			t.Errorf("%s rejects %q; the database refuses rows the code writes (allowed: %v)", constraint, value, allowed)
		}
	}
}

// QA-08: every job kind the code enqueues must be accepted by jobs_kind_check,
// and every notification category it writes by notifications_category_check.
func TestMigrationsAcceptEveryJobKind(t *testing.T) {
	assertAllowed(t, "jobs_kind_check", latestCheckList(t, "jobs_kind_check"),
		JobSendReminder, JobIndexEntity, JobDailyDigest, JobOverdueTask, JobMissedBlock, JobStartSoon, JobSendPush, JobCreateBackup, JobReindexUser)
}

func TestMigrationsAcceptEveryNotificationCategory(t *testing.T) {
	assertAllowed(t, "notifications_category_check", latestCheckList(t, "notifications_category_check"),
		NotifyReminder, NotifyDigest, NotifyPlanning, NotifyOverdue, NotifyMissed, NotifyStart, "agent")
}
