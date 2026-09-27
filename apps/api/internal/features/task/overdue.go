package task

import (
	"time"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"
)

// IsOverdue reports whether open Work has a deadline date before today.
// Inbox items, Reminders, and completed Work never count. Missed Blocks are not Overdue.
func IsOverdue(t models.Task, now time.Time) bool {
	if t.IsCompleted() || t.IsReminder() || t.IsInbox() {
		return false
	}
	loc := now.Location()
	todayStr := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).Format("2006-01-02")
	return t.Deadline != nil && *t.Deadline != "" && *t.Deadline < todayStr
}

// IsMissed reports whether open Work has a Block (or scheduledOn ping for the
// schedule fallback) that already ended, and the Work is still incomplete.
func IsMissed(t models.Task, now time.Time) bool {
	if t.IsCompleted() || t.IsReminder() || t.IsInbox() {
		return false
	}
	if t.IsRecurring() {
		return false
	}
	latest, ok := latestScheduleEnd(t, now.Location())
	return ok && latest.Before(now)
}

// IsUnscheduled reports whether Work has no Block on the current date.
func IsUnscheduled(t models.Task, now time.Time) bool {
	if t.IsCompleted() || t.IsReminder() || t.IsInbox() {
		return false
	}
	loc := now.Location()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	tomorrow := today.AddDate(0, 0, 1)
	for _, block := range t.Blocks {
		if !block.EndAt.Before(today) && block.StartAt.Before(tomorrow) {
			return false
		}
	}
	if t.ScheduledOn != nil && *t.ScheduledOn != "" {
		parsed, err := recurrence.ParseTimeIn(*t.ScheduledOn, loc)
		if err == nil {
			at := parsed.In(loc)
			if !at.Before(today) && at.Before(tomorrow) {
				return false
			}
		}
	}
	return true
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
