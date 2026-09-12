package task

import (
	"time"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"
)

// IsOverdue reports whether an open work task is past due. That is true when
// the deadline is before today, or every reserved block (and scheduledOn
// fallback) already ended before today. Reminders never count; recurring series
// only use the deadline because missed occurrences are handled separately.
func IsOverdue(t models.Task, now time.Time) bool {
	if t.IsCompleted() || t.IsReminder() || t.IsInbox() {
		return false
	}
	loc := now.Location()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	todayStr := today.Format("2006-01-02")
	if t.Deadline != nil && *t.Deadline != "" && *t.Deadline < todayStr {
		return true
	}
	if t.IsRecurring() {
		return false
	}
	latest, ok := latestScheduleEnd(t, loc)
	return ok && latest.Before(today)
}

// HasRemainingSchedule is true when a one-off task still has a block (or
// scheduledOn) on or after today. Agenda views use this to keep those tasks in
// the day list instead of duplicating them under Overdue.
func HasRemainingSchedule(t models.Task, now time.Time) bool {
	if t.IsRecurring() {
		return false
	}
	loc := now.Location()
	latest, ok := latestScheduleEnd(t, loc)
	if !ok {
		return false
	}
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	return !latest.Before(today)
}

func latestScheduleEnd(t models.Task, loc *time.Location) (time.Time, bool) {
	var latest time.Time
	found := false
	for _, block := range t.Blocks {
		end := block.EndAt.In(loc)
		if !found || end.After(latest) {
			latest = end
			found = true
		}
	}
	if t.ScheduledOn == nil || *t.ScheduledOn == "" {
		return latest, found
	}
	parsed, err := recurrence.ParseTimeIn(*t.ScheduledOn, loc)
	if err != nil {
		return latest, found
	}
	at := parsed.In(loc)
	if !found || at.After(latest) {
		return at, true
	}
	return latest, found
}
