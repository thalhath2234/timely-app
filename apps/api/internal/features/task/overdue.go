package task

import (
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
