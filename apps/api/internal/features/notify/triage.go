package notify

import (
	"context"
	"errors"
	"fmt"
	"log"
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

// triageParallel caps how many suggestions are asked at once, so a sweep of
// many overdue tasks never queues a burst of model calls.
const triageParallel = 2

// suggestLater asks the Triager for a new notification's next step in the
// background and adds it to the notification's text and data. The job (and
// the push) never waits on the model, so reminders behind it stay on time.
func (s *Service) suggestLater(notificationID, userID string, item *models.Task, category, kind string, overdueDays int) {
	if s.triage == nil {
		return
	}
	s.triageWait.Add(1)
	go func() {
		defer s.triageWait.Done()
		s.triageSlots <- struct{}{}
		defer func() { <-s.triageSlots }()
		step := s.triage(context.Background(), userID, item, kind, overdueDays)
		if body, ok := triageBody[category][step]; ok {
			if err := s.repo.SetSuggestion(notificationID, step, body); err != nil {
				log.Printf("notify: save suggested step: %v", err)
			}
		}
	}()
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
	// A dry run comes first: Apply drops those blocks even when the engine
	// finds no new time, so nothing changes unless the task gets placed.
	replan := func() error {
		req := schedule.PlanRequest{TaskIDs: []string{item.ID}, Timezone: s.notificationTimezone(userID), IncludeManual: true}
		plan, err := s.schedule.Preview(userID, req)
		if err != nil {
			return err
		}
		if !placed(plan, item.ID) {
			return errNoTime
		}
		plan, err = s.schedule.Apply(userID, req)
		if err != nil {
			return err
		}
		if !placed(plan, item.ID) {
			return errNoTime
		}
		return nil
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
		message = "Moved it to your next free time"
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
			if errors.Is(err, errNoTime) {
				previous := item.Duration
				_, _ = s.tasks.Update(userID, item.ID, task.TaskUpdate{Duration: &previous})
			}
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

// errNoTime is a move or added time the engine found no room for.
var errNoTime = errors.New("no free time for it in the planning window, so nothing changed")

// placed is true when plan gives the task at least one block.
func placed(plan *schedule.PlanResponse, taskID string) bool {
	for _, p := range plan.Proposals {
		if p.TaskID == taskID && len(p.Blocks) > 0 {
			return true
		}
	}
	return false
}

func derefPriority(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
