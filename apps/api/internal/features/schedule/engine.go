package schedule

import (
	"sort"
	"time"
	"timely-api/internal/models"
)

// Skip reasons returned when a task could not be placed.
const (
	ReasonNoCapacity     = "no_capacity"
	ReasonBlocked        = "blocked"
	ReasonManual         = "manual"
	ReasonNoDuration     = "no_duration"
	ReasonReminder       = "reminder"
	ReasonRecurring      = "recurring"
	ReasonCompleted      = "completed"
	ReasonInbox          = "inbox"
	ReasonHasSubtasks    = "parent_has_subtasks"
	ReasonLocked         = "locked"
	ReasonFrozen         = "frozen"
	ReasonWorkspace      = "workspace_excluded"
	ReasonContiguous     = "contiguous_no_fit"
	ReasonBeforeEarliest = "before_earliest"
	defaultBreakMinute   = 5
	slotGranularity      = 5 * time.Minute
)

type Interval struct {
	Start time.Time `json:"start"`
	End   time.Time `json:"end"`
}

func (i Interval) Minutes() int {
	return int(i.End.Sub(i.Start).Minutes())
}

// FreeMinutes is the total length of the intervals.
func FreeMinutes(slots []Interval) int {
	minutes := 0
	for _, slot := range slots {
		minutes += slot.Minutes()
	}
	return minutes
}

// Candidate is a one-off task or one recurring occurrence the engine may place.
type Candidate struct {
	ID                 string
	TaskID             string
	Name               string
	DurationMinutes    int
	ChunkMinutes       int
	MinChunkMinutes    int
	Contiguous         bool
	Priority           string
	CreatedAt          string
	Deadline           *time.Time
	StartDate          *time.Time
	EarliestStart      *time.Time
	PreferredWindows   []models.PreferredWindow
	BlockedByID        string
	ExternalBlocked    bool
	ExternalBlockerEnd *time.Time
	OccurrenceStart    *time.Time
	TodayFocus         bool
	ActualMinutes      int
	Unscheduled        bool
	Rank               Rank
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
	TaskID          string     `json:"taskId"`
	TaskName        string     `json:"taskName"`
	Blocks          []Interval `json:"blocks"`
	EndsAt          time.Time  `json:"endsAt"`
	Deadline        *time.Time `json:"deadline,omitempty"`
	PastDeadline    bool       `json:"pastDeadline"`
	Reason          string     `json:"reason"`
	OccurrenceStart *time.Time `json:"occurrenceStart,omitempty"`
	CandidateID     string     `json:"-"`
	// RequiredMinutes is the estimate; PlacedMinutes what the blocks cover.
	// ShortfallMinutes > 0 marks a partial placement that must be surfaced.
	RequiredMinutes  int `json:"requiredMinutes"`
	PlacedMinutes    int `json:"placedMinutes"`
	ShortfallMinutes int `json:"shortfallMinutes"`
}

type Skipped struct {
	TaskID   string `json:"taskId"`
	TaskName string `json:"taskName"`
	Reason   string `json:"reason"`
	Message  string `json:"message"`
}

type PlanResult struct {
	Proposals      []Proposal `json:"proposals"`
	Skipped        []Skipped  `json:"skipped"`
	FreeMinutes    int        `json:"freeMinutes"`
	PlannedMinutes int        `json:"plannedMinutes"`
}

func skip(id, name, reason string) Skipped {
	return Skipped{TaskID: id, TaskName: name, Reason: reason, Message: ExplainSkip(reason)}
}

// Plan is the deterministic v2 engine: score (shared with what_next), then
// hoist blockers, then earliest fit with chunk/contiguous/window rules.
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
		taskID := candidate.TaskID
		if taskID == "" {
			taskID = candidate.ID
		}
		if candidate.DurationMinutes <= 0 {
			result.Skipped = append(result.Skipped, skip(taskID, candidate.Name, ReasonNoDuration))
			skipped[candidate.ID] = true
			continue
		}

		earliest := input.From
		if candidate.StartDate != nil && candidate.StartDate.After(earliest) {
			earliest = *candidate.StartDate
		}
		if candidate.EarliestStart != nil && candidate.EarliestStart.After(earliest) {
			earliest = *candidate.EarliestStart
		}

		if candidate.BlockedByID != "" {
			if _, isCandidate := byID[candidate.BlockedByID]; isCandidate {
				if skipped[candidate.BlockedByID] {
					result.Skipped = append(result.Skipped, skip(taskID, candidate.Name, ReasonBlocked))
					skipped[candidate.ID] = true
					continue
				}
				if end, ok := ends[candidate.BlockedByID]; ok && end.After(earliest) {
					earliest = end
				}
			} else if candidate.ExternalBlocked {
				result.Skipped = append(result.Skipped, skip(taskID, candidate.Name, ReasonBlocked))
				skipped[candidate.ID] = true
				continue
			} else if candidate.ExternalBlockerEnd != nil && candidate.ExternalBlockerEnd.After(earliest) {
				earliest = *candidate.ExternalBlockerEnd
			}
		}

		if !earliest.Before(input.To) {
			result.Skipped = append(result.Skipped, skip(taskID, candidate.Name, ReasonBeforeEarliest))
			skipped[candidate.ID] = true
			continue
		}

		slotFree := free
		if len(candidate.PreferredWindows) > 0 {
			slotFree = intersectPreferred(free, candidate.PreferredWindows, loc)
		}

		minChunk := candidate.MinChunkMinutes
		if minChunk < 15 {
			minChunk = 15
		}
		blocks, shortfall := place(slotFree, earliest, candidate.DurationMinutes, minChunk, candidate.ChunkMinutes, breakMinutes, candidate.Contiguous)
		if len(blocks) == 0 {
			reason := ReasonNoCapacity
			if candidate.Contiguous {
				reason = ReasonContiguous
			}
			result.Skipped = append(result.Skipped, skip(taskID, candidate.Name, reason))
			skipped[candidate.ID] = true
			continue
		}

		placed := 0
		for _, block := range blocks {
			padded := Interval{Start: block.Start, End: block.End.Add(time.Duration(breakMinutes) * time.Minute)}
			free = subtract(free, padded)
			result.PlannedMinutes += block.Minutes()
			placed += block.Minutes()
		}

		endsAt := blocks[len(blocks)-1].End
		ends[candidate.ID] = endsAt
		if candidate.TaskID != "" {
			ends[candidate.TaskID] = endsAt
		}
		proposal := Proposal{
			TaskID:           taskID,
			TaskName:         candidate.Name,
			Blocks:           blocks,
			EndsAt:           endsAt,
			Reason:           joinReasons(candidate.Rank.Reasons),
			OccurrenceStart:  candidate.OccurrenceStart,
			CandidateID:      candidate.ID,
			RequiredMinutes:  candidate.DurationMinutes,
			PlacedMinutes:    placed,
			ShortfallMinutes: shortfall,
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
		if a.Rank.Score != b.Rank.Score {
			return a.Rank.Score > b.Rank.Score
		}
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
	return models.PriorityRank(priority)
}

// place fills `duration` minutes into the free intervals starting at or after
// `earliest`. preferredChunk is a ceiling; minChunk is the smallest block the
// engine will write. Contiguous tasks must fit in a single interval.
//
// It returns the blocks it could reserve and the minutes still unplaced. A
// shortfall of 0 means the estimate is fully covered; a positive shortfall
// with blocks means a partial placement the caller must surface, never treat
// as done. A leftover smaller than minChunk is rounded up to minChunk rather
// than dropped, so the task is never silently under-booked.
func place(free []Interval, earliest time.Time, duration, minChunk, preferredChunk, gap int, contiguous bool) ([]Interval, int) {
	if minChunk < 15 {
		minChunk = 15
	}
	if preferredChunk <= 0 || preferredChunk > duration {
		preferredChunk = duration
	}
	if preferredChunk < minChunk {
		preferredChunk = minChunk
	}
	if contiguous {
		if blocks, ok := placeContiguous(free, earliest, duration); ok {
			return blocks, 0
		}
		return nil, duration
	}

	remaining := duration
	var blocks []Interval

	for _, interval := range free {
		if !interval.End.After(earliest) {
			continue
		}
		cursor := roundUp(maxTime(interval.Start, earliest))
		for remaining > 0 {
			size := preferredChunk
			if remaining < size {
				size = remaining
			}
			if size < minChunk {
				// Never write a sliver: book a minimum chunk instead of
				// pretending the last few minutes do not exist.
				size = minChunk
			}
			end := cursor.Add(time.Duration(size) * time.Minute)
			if end.After(interval.End) {
				room := int(interval.End.Sub(cursor).Minutes())
				if room >= minChunk && room < size && room*2 >= size {
					take := room
					// Never leave a sliver smaller than minChunk for later: shrink
					// this chunk so exactly one minimum chunk carries over and the
					// total lands on the estimate instead of overshooting it.
					if left := remaining - room; left > 0 && left < minChunk {
						take = remaining - minChunk
					}
					if take >= minChunk {
						blocks = append(blocks, Interval{Start: cursor, End: cursor.Add(time.Duration(take) * time.Minute)})
						remaining -= take
					}
				}
				break
			}
			blocks = append(blocks, Interval{Start: cursor, End: end})
			remaining -= size
			cursor = end.Add(time.Duration(gap) * time.Minute)
		}
		if remaining <= 0 {
			return blocks, 0
		}
	}
	if remaining < 0 {
		remaining = 0
	}
	return blocks, remaining
}

func placeContiguous(free []Interval, earliest time.Time, duration int) ([]Interval, bool) {
	need := time.Duration(duration) * time.Minute
	for _, interval := range free {
		if !interval.End.After(earliest) {
			continue
		}
		cursor := roundUp(maxTime(interval.Start, earliest))
		end := cursor.Add(need)
		if !end.After(interval.End) {
			return []Interval{{Start: cursor, End: end}}, true
		}
	}
	return nil, false
}

func intersectPreferred(free []Interval, windows []models.PreferredWindow, loc *time.Location) []Interval {
	var allowed []Interval
	for _, interval := range free {
		day := time.Date(interval.Start.In(loc).Year(), interval.Start.In(loc).Month(), interval.Start.In(loc).Day(), 0, 0, 0, 0, loc)
		key := models.WeekdayKey(day.Weekday())
		for _, window := range windows {
			if len(window.Days) > 0 && !containsDay(window.Days, key) {
				continue
			}
			startMin, err := models.ParseClock(window.Start)
			if err != nil {
				continue
			}
			endMin, err := models.ParseClock(window.End)
			if err != nil || endMin <= startMin {
				continue
			}
			win := Interval{Start: day.Add(time.Duration(startMin) * time.Minute), End: day.Add(time.Duration(endMin) * time.Minute)}
			start := maxTime(interval.Start, win.Start)
			end := interval.End
			if win.End.Before(end) {
				end = win.End
			}
			if end.After(start) {
				allowed = append(allowed, Interval{Start: start, End: end})
			}
		}
	}
	sort.Slice(allowed, func(i, j int) bool { return allowed[i].Start.Before(allowed[j].Start) })
	return allowed
}

func containsDay(days []string, key string) bool {
	for _, day := range days {
		if day == key {
			return true
		}
	}
	return false
}

func joinReasons(reasons []string) string {
	if len(reasons) == 0 {
		return "open work"
	}
	out := reasons[0]
	for i := 1; i < len(reasons); i++ {
		out += ", " + reasons[i]
	}
	return out
}

// workingIntervals lays the weekly template over [from, to).
func workingIntervals(from, to time.Time, hours models.WorkingHours, loc *time.Location) []Interval {
	if hours.IsEmpty() {
		hours = models.DefaultWorkingHours(models.ZoneName(loc))
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
