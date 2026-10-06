package task

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"timely-api/internal/models"
)

// Domain limits shared by create, update and bulk paths. The web forms enforce
// the same numbers; the service is the source of truth so MCP, native and
// direct API clients cannot persist unusable work.
const (
	// maxDurationMinutes caps a single task's estimate at four 40-hour weeks.
	// Anything larger is a project, not a block the scheduler can place.
	maxDurationMinutes = 4 * 40 * 60
)

var (
	errNameEmpty          = errors.New("task name cannot be empty")
	errNameTooLong        = fmt.Errorf("task name cannot exceed %d characters", maxNameLength)
	errDurationTooLong    = fmt.Errorf("duration cannot exceed %d minutes", maxDurationMinutes)
	errDurationNegative   = errors.New("duration cannot be negative")
	errStartAfterDeadline = errors.New("start date cannot be after the deadline")
	errReminderNeedsPing  = errors.New("reminders need a notify time (scheduledOn) or a repeat rule")
	errDependencyCycle    = errors.New("this dependency would create a cycle: a task cannot wait on work that already waits on it")
)

// normalizeName trims whitespace and rejects blank or oversized titles.
// Length is measured in runes so multi-byte names are not cut mid-character.
func normalizeName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", errNameEmpty
	}
	if utf8.RuneCountInString(name) > maxNameLength {
		return "", errNameTooLong
	}
	return name, nil
}

func validateDuration(minutes int) error {
	if minutes < 0 {
		return errDurationNegative
	}
	if minutes > maxDurationMinutes {
		return errDurationTooLong
	}
	return nil
}

// validateDateRange rejects a start date after the deadline. Both values are
// date-only or ISO strings; only the calendar day is compared so a deadline
// at 09:00 on the same day as the start is still fine.
func validateDateRange(startDate, deadline *string) error {
	start := models.NormalizeDate(deref(startDate))
	due := models.NormalizeDate(deref(deadline))
	if start == "" || due == "" {
		return nil
	}
	if start > due {
		return errStartAfterDeadline
	}
	return nil
}

// validatePreferredWindows rejects windows that cannot be parsed or that end
// before they start. An inverted window silently disables the preference in
// the engine, which is worse than an error.
func validatePreferredWindows(windows models.PreferredWindows) error {
	for i, window := range windows {
		startMin, err := models.ParseClock(window.Start)
		if err != nil {
			return fmt.Errorf("preferredWindows[%d]: invalid start %q", i, window.Start)
		}
		endMin, err := models.ParseClock(window.End)
		if err != nil {
			return fmt.Errorf("preferredWindows[%d]: invalid end %q", i, window.End)
		}
		if endMin <= startMin {
			return fmt.Errorf("preferredWindows[%d]: end must be after start", i)
		}
	}
	return nil
}

// reminderHasPing is the reminder invariant: a reminder without a time can
// never notify, so it is not allowed to exist.
func reminderHasPing(scheduledOn *string, hasRecurrence bool) bool {
	return hasRecurrence || (scheduledOn != nil && strings.TrimSpace(*scheduledOn) != "")
}

// assertReminderPing enforces the reminder invariant on updates: whatever the
// row looks like after this change, a reminder must still have a ping time or
// a repeat rule. Covers type conversion, clearing scheduledOn, and dropping a
// recurrence from a reminder that had no one-off time.
func assertReminderPing(before *models.Task, update TaskUpdate, updates map[string]any) error {
	kind := before.Kind
	if next, ok := updates["kind"].(string); ok && next != "" {
		kind = next
	}
	if kind != models.KindReminder {
		return nil
	}

	scheduledOn := before.ScheduledOn
	if update.ScheduledOn != nil {
		scheduledOn = update.ScheduledOn
	}

	recurring := before.IsRecurring()
	if update.RecurrenceSet {
		recurring = update.Recurrence != nil && strings.TrimSpace(update.Recurrence.RRule) != ""
	}

	if !reminderHasPing(scheduledOn, recurring) {
		return errReminderNeedsPing
	}
	return nil
}

// assertNoDependencyCycle walks the blocked-by chain starting from the task
// the caller wants to depend on. If that chain ever reaches taskID, the new
// edge would close a loop (A→B→…→A) and nothing in it could ever become ready.
func (s *taskService) assertNoDependencyCycle(userID, taskID, blockedByID string) error {
	if blockedByID == "" {
		return nil
	}
	if blockedByID == taskID {
		return errors.New("a task cannot block itself")
	}
	all, err := s.taskRepo.GetAllTaskByUser(userID)
	if err != nil {
		return err
	}
	blockedBy := make(map[string]string, len(all))
	for i := range all {
		if id := deref(all[i].BlockedByID); id != "" {
			blockedBy[all[i].ID] = id
		}
	}
	seen := map[string]bool{}
	for current := blockedByID; current != ""; current = blockedBy[current] {
		if current == taskID {
			return errDependencyCycle
		}
		if seen[current] {
			// Pre-existing loop elsewhere in the graph; do not spin on it.
			return errDependencyCycle
		}
		seen[current] = true
	}
	return nil
}
