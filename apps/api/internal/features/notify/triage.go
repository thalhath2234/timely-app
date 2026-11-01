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

// TriageItem is one notification's Work for the Triager: Kind is "missed"
// (its block ended unfinished) or "overdue" (past its deadline by
// OverdueDays).
type TriageItem struct {
	Task        *models.Task
	Kind        string
	OverdueDays int
}

// Triager picks the next step for each item, in order; "" where it has no
// suggestion. One call takes a whole batch. Smart suggestions supply it;
// without it notifications read as before.
type Triager func(ctx context.Context, userID string, items []TriageItem) []string

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

const (
	// triageParallel caps how many triage calls run at once across the
	// server. Each account asks one at a time, so one account's backlog holds
	// at most one of them.
	triageParallel = 2
	// triageBatch is how many notifications one call covers.
	triageBatch = 10
	// triageGather is how long an account's first new notification waits
	// for the rest of the sweep before its call, so they share one batch.
	triageGather = 2 * time.Second
)

// triageWork is a new notification waiting for its suggested step.
type triageWork struct {
	notificationID, category string
	item                     TriageItem
}

// suggestLater asks the Triager for a new notification's next step in the
// background and adds it to the notification's text and data. The job (and
// the push) never waits on the model, so reminders behind it stay on time.
// An account's notifications are asked about in batches (see runTriage).
func (s *Service) suggestLater(notificationID, userID string, item *models.Task, category, kind string, overdueDays int) {
	if s.triage == nil {
		return
	}
	work := triageWork{notificationID: notificationID, category: category, item: TriageItem{Task: item, Kind: kind, OverdueDays: overdueDays}}
	s.triageMu.Lock()
	pending, running := s.triagePending[userID]
	s.triagePending[userID] = append(pending, work)
	if !running {
		s.triageWait.Add(1)
	}
	s.triageMu.Unlock()
	if !running {
		go s.runTriage(userID)
	}
}

// runTriage asks for one account's waiting steps, a batch per call and one
// call at a time, until none are left. Asking one at a time is what keeps a
// backlog of one account (hundreds of imported overdue tasks) from taking
// every slot from other accounts.
func (s *Service) runTriage(userID string) {
	defer s.triageWait.Done()
	time.Sleep(s.triageGather)
	for {
		s.triageMu.Lock()
		pending := s.triagePending[userID]
		if len(pending) == 0 {
			delete(s.triagePending, userID)
			s.triageMu.Unlock()
			return
		}
		n := min(len(pending), triageBatch)
		batch := pending[:n:n]
		s.triagePending[userID] = pending[n:]
		s.triageMu.Unlock()

		items := make([]TriageItem, len(batch))
		for i, w := range batch {
			items[i] = w.item
		}
		s.triageSlots <- struct{}{}
		steps := s.triage(context.Background(), userID, items)
		<-s.triageSlots
		for i, w := range batch {
			if i >= len(steps) || !triageFits(w.category, steps[i], w.item.Task) {
				continue
			}
			if body, ok := triageBody[w.category][steps[i]]; ok {
				if err := s.repo.SetSuggestion(w.notificationID, steps[i], body); err != nil {
					log.Printf("notify: save suggested step: %v", err)
				}
			}
		}
	}
}

// triageFits reports whether step can run on the notification's task. A
// repeating task's missed block only offers a lower priority: adding time or
// moving it would change every occurrence, not the one that was missed.
func triageFits(category, step string, item *models.Task) bool {
	if category == models.NotifyMissed && item != nil && item.IsRecurring() {
		return step == triageLower
	}
	return true
}

// errRepeats and errLocked are the steps triage refuses rather than half-do.
var (
	errRepeats = errors.New("it repeats, so this would change every occurrence; move this one from the calendar")
	errLocked  = errors.New("it has time you locked; move it from the calendar")
)

func daysPast(deadline string, today task.Today) int {
	d, err := time.ParseInLocation("2006-01-02", models.NormalizeDate(deadline), today.Location())
	if err != nil {
		return 0
	}
	t, _ := time.ParseInLocation("2006-01-02", today.Date(), today.Location())
	return DaysBetween(d, t)
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
	if n.Category == models.NotifySuggestion {
		return s.applyAlert(userID, n, action)
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
	if !triageFits(n.Category, action, item) {
		return "", errRepeats
	}
	// An old chip may run after the person already moved the deadline.
	if n.Category == models.NotifyOverdue &&
		(item.Deadline == nil || !overdueTaskCurrent(item, *item.Deadline, s.notificationToday(userID))) {
		return "", errors.New("it's no longer past its deadline")
	}
	// The person asked to move this task, so its hand-placed blocks still
	// ahead are replaced too (a missed hand-placed block is history and
	// stays; engine time missed earlier today moves with the task); other
	// tasks are not touched. A dry run comes first: Apply drops those blocks
	// even when the engine finds no new time, so nothing changes unless the
	// task gets placed. It skips the Preview hook, so no model call waits.
	replan := func() error {
		req := schedule.PlanRequest{TaskIDs: []string{item.ID}, Timezone: s.notificationTimezone(userID), IncludeManual: true}
		plan, err := s.schedule.DryRun(userID, req)
		if err != nil {
			return err
		}
		if pinned(plan, item.ID) {
			return errLocked
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
		// Never earlier than the deadline it has now.
		if item.Deadline != nil && models.NormalizeDate(*item.Deadline) >= date {
			return "", errors.New("its deadline is already a week or more away")
		}
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
			if errors.Is(err, errNoTime) || errors.Is(err, errLocked) {
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

// pinned is true when the plan left the task alone because it is pinned or
// has locked time ahead.
func pinned(plan *schedule.PlanResponse, taskID string) bool {
	for _, s := range plan.Skipped {
		if s.TaskID == taskID && s.Reason == schedule.ReasonLocked {
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
