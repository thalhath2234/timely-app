package schedule

import (
	"fmt"
	"time"
	"timely-api/internal/models"
)

// ScoreInput is the shared ranking policy for what_next and the engine.
// The number is an ordering hint, not a probability.
type ScoreInput struct {
	Priority      string
	Deadline      *time.Time
	Now           time.Time
	Blocked       bool
	Unscheduled   bool
	TodayFocus    bool
	ActualMinutes int
	Duration      int
}

type Rank struct {
	Score   int      `json:"score"`
	Reasons []string `json:"reasons"`
}

// ScoreTask ranks work the same way in what_next and auto-schedule.
// Higher is sooner. Reasons explain the rank; they are not certainty.
func ScoreTask(in ScoreInput) Rank {
	score := 0
	var reasons []string
	if in.Blocked {
		score -= 80
		reasons = append(reasons, "waiting on another task")
	}
	if in.Deadline != nil {
		day := time.Date(in.Deadline.Year(), in.Deadline.Month(), in.Deadline.Day(), 0, 0, 0, 0, in.Deadline.Location())
		today := time.Date(in.Now.Year(), in.Now.Month(), in.Now.Day(), 0, 0, 0, 0, in.Now.Location())
		slack := int(day.Sub(today).Hours() / 24)
		switch {
		case slack < 0:
			score += 100
			reasons = append(reasons, "overdue")
		case slack == 0:
			score += 50
			reasons = append(reasons, "due today")
		default:
			boost := 40 - slack*4
			if boost < 0 {
				boost = 0
			}
			score += boost
			if boost > 0 {
				reasons = append(reasons, fmt.Sprintf("due in %d days", slack))
			}
		}
	}
	switch models.NormalizePriority(in.Priority) {
	case models.PriorityUrgent:
		score += 40
		reasons = append(reasons, "urgent")
	case models.PriorityHigh:
		score += 25
		reasons = append(reasons, "high priority")
	case models.PriorityMedium:
		score += 10
		reasons = append(reasons, "medium priority")
	}
	if in.TodayFocus {
		score += 35
		reasons = append(reasons, "in Today focus")
	}
	if in.Unscheduled {
		score += 5
		reasons = append(reasons, "unscheduled")
	}
	if in.ActualMinutes > 0 && in.Duration > 0 {
		score += 8
		reasons = append(reasons, "already started")
	}
	if len(reasons) == 0 {
		reasons = append(reasons, "open work")
	}
	return Rank{Score: score, Reasons: reasons}
}

func ExplainSkip(reason string) string {
	switch reason {
	case ReasonNoCapacity:
		return "Not enough free working hours in the planning window"
	case ReasonBlocked:
		return "Waiting on another task to finish"
	case ReasonManual:
		return "Already placed by hand — pin stays unless you include manual blocks"
	case ReasonNoDuration:
		return "Needs a time estimate before it can be placed"
	case ReasonReminder:
		return "Reminders stay at their ping time"
	case ReasonRecurring:
		return "This repeating item is placed as calendar occurrences, not work blocks"
	case ReasonCompleted:
		return "Already done"
	case ReasonInbox:
		return "Clarify this inbox item before scheduling"
	case ReasonHasSubtasks:
		return "Schedulable subtasks replace the parent"
	case ReasonLocked:
		return "Pinned — the engine will not move it"
	case ReasonFrozen:
		return "Inside the freeze window, so near-term blocks stay put"
	case ReasonWorkspace:
		return "This workspace is excluded from auto-schedule"
	case ReasonContiguous:
		return "Must run in one sitting and no single free slot is long enough"
	case ReasonBeforeEarliest:
		return "Cannot start before the earliest start time"
	default:
		return reason
	}
}
