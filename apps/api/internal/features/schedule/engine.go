package schedule

import (
	"sort"
	"strings"
	"time"
	"timely-api/internal/models"
)

// Skip reasons returned when a task could not be placed.
const (
	ReasonNoCapacity   = "no_capacity"
	ReasonBlocked      = "blocked"
	ReasonManual       = "manual"
	ReasonNoDuration   = "no_duration"
	ReasonRecurring    = "recurring"
	ReasonCompleted    = "completed"
	defaultBreakMinute = 5
	slotGranularity    = 5 * time.Minute
)

type Interval struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}

func (i Interval) Minutes() int {
	return int(i.End.Sub(i.Start).Minutes())
}

// Candidate is a one-off task the engine may place.
type Candidate struct {
	ID              string
	Name            string
	DurationMinutes int
	ChunkMinutes    int
	Priority        string
	CreatedAt       string
	// Deadline / StartDate are calendar days in the planning zone.
	Deadline  *time.Time
	StartDate *time.Time
	// BlockedByID references another task. When that task is also a candidate
	// the engine orders them; otherwise the caller resolves it into
	// ExternalBlocked or ExternalBlockerEnd.
	BlockedByID        string
	ExternalBlocked    bool
	ExternalBlockerEnd *time.Time
}

type PlanInput struct {
	From         time.Time
	To           time.Time
	Location     *time.Location
	Hours        models.WorkingHours
	Busy         []Interval
	Candidates   []Candidate
	BreakMinutes int
}

type Proposal struct {
	TaskID       string     `json:"taskId"`
	TaskName     string     `json:"taskName"`
	Blocks       []Interval `json:"blocks"`
	EndsAt       time.Time  `json:"endsAt"`
	Deadline     *time.Time `json:"deadline,omitempty"`
	PastDeadline bool       `json:"pastDeadline"`
}

type Skipped struct {
	TaskID   string `json:"taskId"`
	TaskName string `json:"taskName"`
	Reason   string `json:"reason"`
}

type PlanResult struct {
	Proposals      []Proposal `json:"proposals"`
	Skipped        []Skipped  `json:"skipped"`
	FreeMinutes    int        `json:"freeMinutes"`
	PlannedMinutes int        `json:"plannedMinutes"`
}

// Plan is the deterministic v1 engine: blockers first, then deadline urgency,
// then priority; each task goes into the earliest free working time after its
// start date, split into chunks with a short break between them.
func Plan(input PlanInput) PlanResult {
	loc := input.Location
	if loc == nil {
		loc = time.UTC
	}
	breakMinutes := input.BreakMinutes
	if breakMinutes <= 0 {
		breakMinutes = defaultBreakMinute
	}

	free := workingIntervals(input.From, input.To, input.Hours, loc)
	for _, busy := range mergeIntervals(input.Busy) {
		free = subtract(free, busy)
	}

	result := PlanResult{Proposals: []Proposal{}, Skipped: []Skipped{}}
	for _, interval := range free {
		result.FreeMinutes += interval.Minutes()
	}

	byID := make(map[string]*Candidate, len(input.Candidates))
	for i := range input.Candidates {
		byID[input.Candidates[i].ID] = &input.Candidates[i]
	}

	ends := map[string]time.Time{}
	skipped := map[string]bool{}

	for _, candidate := range order(input.Candidates, byID) {
		if candidate.DurationMinutes <= 0 {
			result.Skipped = append(result.Skipped, Skipped{candidate.ID, candidate.Name, ReasonNoDuration})
			skipped[candidate.ID] = true
			continue
		}

		earliest := input.From
		if candidate.StartDate != nil && candidate.StartDate.After(earliest) {
			earliest = *candidate.StartDate
		}

		if candidate.BlockedByID != "" {
			if _, isCandidate := byID[candidate.BlockedByID]; isCandidate {
				if skipped[candidate.BlockedByID] {
					result.Skipped = append(result.Skipped, Skipped{candidate.ID, candidate.Name, ReasonBlocked})
					skipped[candidate.ID] = true
					continue
				}
				if end, ok := ends[candidate.BlockedByID]; ok && end.After(earliest) {
					earliest = end
				}
			} else if candidate.ExternalBlocked {
				result.Skipped = append(result.Skipped, Skipped{candidate.ID, candidate.Name, ReasonBlocked})
				skipped[candidate.ID] = true
				continue
			} else if candidate.ExternalBlockerEnd != nil && candidate.ExternalBlockerEnd.After(earliest) {
				earliest = *candidate.ExternalBlockerEnd
			}
		}

		blocks, ok := place(free, earliest, candidate.DurationMinutes, candidate.ChunkMinutes, breakMinutes)
		if !ok {
			result.Skipped = append(result.Skipped, Skipped{candidate.ID, candidate.Name, ReasonNoCapacity})
			skipped[candidate.ID] = true
			continue
		}

		for _, block := range blocks {
			padded := Interval{Start: block.Start, End: block.End.Add(time.Duration(breakMinutes) * time.Minute)}
			free = subtract(free, padded)
			result.PlannedMinutes += block.Minutes()
		}

		endsAt := blocks[len(blocks)-1].End
		ends[candidate.ID] = endsAt
		proposal := Proposal{
			TaskID:   candidate.ID,
			TaskName: candidate.Name,
			Blocks:   blocks,
			EndsAt:   endsAt,
		}
		if candidate.Deadline != nil {
			deadlineEnd := endOfDay(*candidate.Deadline, loc)
			proposal.Deadline = &deadlineEnd
			proposal.PastDeadline = endsAt.After(deadlineEnd)
		}
		result.Proposals = append(result.Proposals, proposal)
	}

	return result
}

// order sorts by urgency and then hoists every blocker in front of the tasks
// it blocks, so dependencies are always placed first.
func order(candidates []Candidate, byID map[string]*Candidate) []Candidate {
	sorted := append([]Candidate(nil), candidates...)
	sort.SliceStable(sorted, func(i, j int) bool {
		a, b := sorted[i], sorted[j]
		if (a.Deadline == nil) != (b.Deadline == nil) {
			return a.Deadline != nil
		}
		if a.Deadline != nil && !a.Deadline.Equal(*b.Deadline) {
			return a.Deadline.Before(*b.Deadline)
		}
		if priorityRank(a.Priority) != priorityRank(b.Priority) {
			return priorityRank(a.Priority) < priorityRank(b.Priority)
		}
		return a.CreatedAt < b.CreatedAt
	})

	var out []Candidate
	visited := map[string]bool{}
	visiting := map[string]bool{}
	var visit func(c Candidate)
	visit = func(c Candidate) {
		if visited[c.ID] || visiting[c.ID] {
			return
		}
		visiting[c.ID] = true
		if blocker, ok := byID[c.BlockedByID]; ok && c.BlockedByID != c.ID {
			visit(*blocker)
		}
		visiting[c.ID] = false
		visited[c.ID] = true
		out = append(out, c)
	}
	for _, candidate := range sorted {
		visit(candidate)
	}
	return out
}

func priorityRank(priority string) int {
	switch strings.ToLower(strings.TrimSpace(priority)) {
	case "critical", "urgent":
		return 0
	case "high":
		return 1
	case "medium":
		return 2
	case "low":
		return 3
	default:
		return 2
	}
}

// place fills `duration` minutes into the free intervals starting at or after
// `earliest`, in chunks of at most `chunk` minutes separated by `gap`. A chunk
// that does not fit the remaining room is cut to fit, so `chunk` is a ceiling.
func place(free []Interval, earliest time.Time, duration, chunk, gap int) ([]Interval, bool) {
	if chunk <= 0 || chunk > duration {
		chunk = duration
	}
	if chunk < 15 {
		chunk = 15
	}
	remaining := duration
	var blocks []Interval

	for _, interval := range free {
		if !interval.End.After(earliest) {
			continue
		}
		cursor := roundUp(maxTime(interval.Start, earliest))
		for remaining > 0 {
			size := chunk
			if remaining < size {
				size = remaining
			}
			end := cursor.Add(time.Duration(size) * time.Minute)
			if end.After(interval.End) {
				// Not enough room for a whole chunk. Use the gap only if it is
				// a meaningful share of the chunk (at least half, and 15 min);
				// a 45-minute task should not become 20 + 25 across two days.
				room := int(interval.End.Sub(cursor).Minutes())
				if room >= 15 && room < size && room*2 >= size {
					blocks = append(blocks, Interval{Start: cursor, End: interval.End})
					remaining -= room
					// A sliver left over is absorbed rather than scheduled on its own.
					if remaining < 15 {
						remaining = 0
					}
				}
				break
			}
			blocks = append(blocks, Interval{Start: cursor, End: end})
			remaining -= size
			cursor = end.Add(time.Duration(gap) * time.Minute)
		}
		if remaining <= 0 {
			return blocks, true
		}
	}
	return nil, false
}

// workingIntervals lays the weekly template over [from, to).
func workingIntervals(from, to time.Time, hours models.WorkingHours, loc *time.Location) []Interval {
	if hours.IsEmpty() {
		hours = models.DefaultWorkingHours(loc.String())
	}
	var out []Interval
	day := time.Date(from.In(loc).Year(), from.In(loc).Month(), from.In(loc).Day(), 0, 0, 0, 0, loc)
	for day.Before(to) {
		for _, window := range hours.Days[models.WeekdayKey(day.Weekday())] {
			startMin, err := models.ParseClock(window.Start)
			if err != nil {
				continue
			}
			endMin, err := models.ParseClock(window.End)
			if err != nil || endMin <= startMin {
				continue
			}
			start := day.Add(time.Duration(startMin) * time.Minute)
			end := day.Add(time.Duration(endMin) * time.Minute)
			if start.Before(from) {
				start = from
			}
			if end.After(to) {
				end = to
			}
			if end.After(start) {
				out = append(out, Interval{Start: start, End: end})
			}
		}
		day = day.AddDate(0, 0, 1)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Start.Before(out[j].Start) })
	return out
}

// FreeIntervals is working time minus busy intervals, used by the agent to
// answer "what fits today".
func FreeIntervals(from, to time.Time, hours models.WorkingHours, loc *time.Location, busy []Interval) []Interval {
	if loc == nil {
		loc = time.UTC
	}
	free := workingIntervals(from, to, hours, loc)
	for _, item := range mergeIntervals(busy) {
		free = subtract(free, item)
	}
	return free
}

func mergeIntervals(items []Interval) []Interval {
	if len(items) == 0 {
		return nil
	}
	sorted := append([]Interval(nil), items...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Start.Before(sorted[j].Start) })
	out := []Interval{sorted[0]}
	for _, item := range sorted[1:] {
		last := &out[len(out)-1]
		if !item.Start.After(last.End) {
			if item.End.After(last.End) {
				last.End = item.End
			}
			continue
		}
		out = append(out, item)
	}
	return out
}

// subtract removes `busy` from every free interval, splitting as needed.
func subtract(free []Interval, busy Interval) []Interval {
	var out []Interval
	for _, interval := range free {
		if !busy.Start.Before(interval.End) || !busy.End.After(interval.Start) {
			out = append(out, interval)
			continue
		}
		if busy.Start.After(interval.Start) {
			out = append(out, Interval{Start: interval.Start, End: busy.Start})
		}
		if busy.End.Before(interval.End) {
			out = append(out, Interval{Start: busy.End, End: interval.End})
		}
	}
	return out
}

func roundUp(t time.Time) time.Time {
	rounded := t.Truncate(slotGranularity)
	if rounded.Before(t) {
		rounded = rounded.Add(slotGranularity)
	}
	return rounded
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func endOfDay(day time.Time, loc *time.Location) time.Time {
	local := day.In(loc)
	return time.Date(local.Year(), local.Month(), local.Day(), 23, 59, 59, 0, loc)
}
