package notify

import (
	"context"
	"errors"
	"fmt"
	"time"

	"timely-api/internal/features/schedule"
	"timely-api/internal/features/task"
	"timely-api/internal/models"
)

// Triager picks the next step for Work whose block ended unfinished ("missed")
// or that is past its deadline ("overdue"); "" when it has no suggestion.
// Smart suggestions supply it; without it notifications read as before.
type Triager func(ctx context.Context, userID string, t *models.Task, kind string, overdueDays int) string

// SetTriage connects smart suggestions to missed and overdue notifications.
func (s *Service) SetTriage(fn Triager) { s.triage = fn }

// Triage actions, as suggest.Triage* names them.
const (
	triageReschedule = "reschedule"
	triageExtend     = "extend"
	triageAddTime    = "addtime"
	triageMove       = "move"
	triageLower      = "lower"
)

// triageBody is the notification text with the suggested step.
var triageBody = map[string]map[string]string{
	models.NotifyOverdue: {
		triageReschedule: "Past deadline. Suggested: make it urgent and reschedule it.",
		triageExtend:     "Past deadline. Suggested: move the deadline a week later.",
		triageLower:      "Past deadline. Suggested: lower its priority.",
	},
	models.NotifyMissed: {
		triageAddTime: "This block ended and the work is still open. Suggested: give it more time.",
		triageMove:    "This block ended and the work is still open. Suggested: move the rest to your next free time.",
		triageLower:   "This block ended and the work is still open. Suggested: lower its priority.",
	},
}

// suggestStep asks the Triager and returns the step and its body, or "" and
// the fallback body.
func (s *Service) suggestStep(ctx context.Context, userID string, item *models.Task, category, kind string, overdueDays int, fallback string) (string, string) {
	if s.triage == nil {
		return "", fallback
	}
	step := s.triage(ctx, userID, item, kind, overdueDays)
	if body, ok := triageBody[category][step]; ok {
		return step, body
	}
	return "", fallback
}

func daysPast(deadline string, today task.Today) int {
	d, err := time.ParseInLocation("2006-01-02", models.NormalizeDate(deadline), today.Location())
	if err != nil {
		return 0
	}
	t, _ := time.ParseInLocation("2006-01-02", today.Date(), today.Location())
	return int(t.Sub(d).Hours() / 24)
}

// lowerPriority is one step down; Low stays Low.
func lowerPriority(p string) string {
	switch models.NormalizePriority(p) {
	case models.PriorityUrgent:
		return models.PriorityHigh
	case models.PriorityHigh:
		return models.PriorityMedium
	default:
		return models.PriorityLow
	}
}

// ApplyTriage runs one triage step for a missed or overdue notification,
// marks it read, and returns a line saying what changed.
func (s *Service) ApplyTriage(userID, notificationID, action string) (string, error) {
	n, err := s.repo.Get(userID, notificationID)
	if err != nil {
		return "", err
	}
	if n.Category != models.NotifyOverdue && n.Category != models.NotifyMissed {
		return "", errors.New("this notification has no next step")
	}
	if _, ok := triageBody[n.Category][action]; !ok && action != triageReschedule && action != triageMove {
		return "", errors.New("unknown step")
	}
	taskID := n.Data.String("taskId")
	if taskID == "" && n.EntityID != nil {
		taskID = *n.EntityID
	}
	item, err := s.tasks.GetForUser(userID, taskID)
	if err != nil {
		return "", err
	}
	if item.IsCompleted() {
		return "", errors.New("this task is already done")
	}
	// The person asked to move this task, so its hand-placed blocks (the
	// missed one included) are replaced too; other tasks are not touched.
	replan := func() error {
		_, err := s.schedule.Apply(userID, schedule.PlanRequest{TaskIDs: []string{item.ID}, Timezone: s.notificationTimezone(userID), IncludeManual: true})
		return err
	}
	var message string
	switch action {
	case triageReschedule:
		if n.Category == models.NotifyOverdue {
			if _, err := s.PrioritizeOverdue(userID, item.ID); err != nil {
				return "", err
			}
			message = "Made it urgent and rescheduled it"
			break
		}
		fallthrough
	case triageMove:
		if err := replan(); err != nil {
			return "", err
		}
		message = "Moved the rest to your next free time"
	case triageExtend:
		day := s.notificationToday(userID).Now().AddDate(0, 0, 7)
		date := day.Format("2006-01-02")
		if _, err := s.tasks.Update(userID, item.ID, task.TaskUpdate{Deadline: &date}); err != nil {
			return "", err
		}
		message = "Deadline moved to " + day.Format("Mon 2 Jan")
	case triageLower:
		p := lowerPriority(derefPriority(item.PriorityLevel))
		if _, err := s.tasks.Update(userID, item.ID, task.TaskUpdate{PriorityLevel: &p}); err != nil {
			return "", err
		}
		message = "Priority lowered to " + p
	case triageAddTime:
		extra := ((item.Duration/2 + 14) / 15) * 15
		if extra < 15 {
			extra = 15
		}
		minutes := item.Duration + extra
		if _, err := s.tasks.Update(userID, item.ID, task.TaskUpdate{Duration: &minutes}); err != nil {
			return "", err
		}
		if err := replan(); err != nil {
			return "", err
		}
		message = fmt.Sprintf("Added %d minutes and found time for it", extra)
	}
	if n.Category == models.NotifyOverdue {
		_ = s.repo.MarkOverdueRead(userID, item.ID)
	}
	if _, err := s.repo.MarkRead(userID, n.ID); err != nil {
		return "", err
	}
	return message, nil
}

func derefPriority(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
