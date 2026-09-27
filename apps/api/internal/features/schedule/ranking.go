package schedule

import (
	"fmt"
	"sort"
	"time"
	"timely-api/internal/features/task"
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

// RankedTask is Unscheduled or Overdue Work with its Rank. Callers do not copy
// this policy; they consume the list.
type RankedTask struct {
	Task    models.Task `json:"task"`
	Score   int         `json:"score"`
	Reasons []string    `json:"reasons"`
}

// RankList is the next-Work list: Unscheduled or Overdue, ordered by Rank.
func RankList(tasks []models.Task, now time.Time) []RankedTask {
	today := now.Format("2006-01-02")
	var list []RankedTask
	for i := range tasks {
		t := tasks[i]
		if t.IsInbox() || t.IsReminder() || t.IsCompleted() {
			continue
		}
		if !task.IsUnscheduled(t, now) && !task.IsOverdue(t, now) {
			continue
		}
		deadline := (*time.Time)(nil)
		if t.Deadline != nil && *t.Deadline != "" {
			if parsed, err := time.Parse("2006-01-02", models.NormalizeDate(*t.Deadline)); err == nil {
				deadline = &parsed
			}
		}
		rank := ScoreTask(ScoreInput{
			Priority:      derefRank(t.PriorityLevel),
			Deadline:      deadline,
			Now:           now,
			Blocked:       t.BlockedByID != nil && *t.BlockedByID != "",
			Unscheduled:   task.IsUnscheduled(t, now),
			TodayFocus:    models.NormalizeDate(derefRank(t.TodayFocusOn)) == today,
			ActualMinutes: t.ActualMinutes,
			Duration:      t.Duration,
		})
		list = append(list, RankedTask{Task: t, Score: rank.Score, Reasons: rank.Reasons})
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].Score != list[j].Score {
			return list[i].Score > list[j].Score
		}
		return list[i].Task.ID < list[j].Task.ID
	})
	return list
}

func derefRank(v *string) string {
	if v == nil {
		return ""
	}
	return *v
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
