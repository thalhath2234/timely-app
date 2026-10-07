package task

import (
	"time"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"
)

// IsOverdue reports whether open Work has a deadline date before today.
// Inbox items, Reminders, and completed Work never count. Missed Blocks and
// remaining Blocks do not change it: only the deadline date decides.
func IsOverdue(t models.Task, today Today) bool {
	if t.IsCompleted() || t.IsReminder() || t.IsInbox() {
		return false
	}
	return t.Deadline != nil && *t.Deadline != "" && *t.Deadline < today.Date()
}

// IsMissed reports whether open Work has a Block (or scheduledOn ping for the
// schedule fallback) that already ended, and the Work is still incomplete.
func IsMissed(t models.Task, today Today) bool {
	if t.IsCompleted() || t.IsReminder() || t.IsInbox() {
		return false
	}
	if t.IsRecurring() {
		return false
	}
	latest, ok := latestScheduleEnd(t, today.Location())
	return ok && latest.Before(today.Now())
}

// IsUnscheduled reports whether open Work has no Block on today's date. A
// Block on a later date does not change today's status.
func IsUnscheduled(t models.Task, today Today) bool {
	if t.IsCompleted() || t.IsReminder() || t.IsInbox() {
		return false
	}
	loc := today.Location()
	start := today.Start()
	tomorrow := start.AddDate(0, 0, 1)
	for _, block := range t.Blocks {
		if !block.EndAt.Before(start) && block.StartAt.Before(tomorrow) {
			return false
		}
	}
	if t.ScheduledOn != nil && *t.ScheduledOn != "" {
		parsed, err := recurrence.ParseTimeIn(*t.ScheduledOn, loc)
		if err == nil {
			at := parsed.In(loc)
			if !at.Before(start) && at.Before(tomorrow) {
				return false
			}
		}
	}
	return true
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
