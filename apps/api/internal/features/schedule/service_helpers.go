package schedule

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
	"timely-api/internal/features/placement"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"
	"timely-api/internal/utils"
)

func (s *service) GetSettings(userID string) (models.ScheduleSettings, error) {
	if userID == "" {
		return models.ScheduleSettings{}, errors.New("user not authenticated")
	}
	settings, err := s.repo.GetSettings(userID)
	if err != nil {
		return models.ScheduleSettings{}, err
	}
	return settings.Normalized(), nil
}

func (s *service) UpdateSettings(userID string, settings models.ScheduleSettings) (models.ScheduleSettings, error) {
	if userID == "" {
		return models.ScheduleSettings{}, errors.New("user not authenticated")
	}
	normalized := settings.Normalized()
	if err := s.repo.UpdateSettings(userID, normalized); err != nil {
		return models.ScheduleSettings{}, err
	}
	return normalized, nil
}

func (s *service) PinTask(userID, taskID string, locked bool) (*models.Task, error) {
	return s.tasks.UpdateTask(userID, taskID, map[string]any{
		"schedule_locked": locked,
		"updated_at":      utils.GetCurrentTime(),
	})
}

func (s *service) PinBlock(userID, blockID string, locked bool) (*models.ScheduledBlock, error) {
	return s.placement.PinBlock(userID, blockID, locked)
}

// revisionSnapshot is what Apply stores for Undo: the engine blocks it
// replaced and every task whose engine blocks it rewrote. Undo must clear the
// blocks Apply added for all of those tasks, including tasks that had no
// blocks before (otherwise undoing a first auto-schedule removed nothing).
// Revisions written before this held only the block array.
type revisionSnapshot struct {
	Blocks  []models.ScheduledBlock `json:"blocks"`
	TaskIDs []string                `json:"taskIds"`
}

func decodeRevision(raw json.RawMessage) (revisionSnapshot, []string, error) {
	var out revisionSnapshot
	var err error
	if trimmed := strings.TrimSpace(string(raw)); strings.HasPrefix(trimmed, "[") {
		err = json.Unmarshal(raw, &out.Blocks)
	} else {
		err = json.Unmarshal(raw, &out)
	}
	if err != nil {
		return out, nil, err
	}
	seen := map[string]bool{}
	ids := []string{}
	for _, id := range out.TaskIDs {
		if id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	for _, block := range out.Blocks {
		if block.TaskID != "" && !seen[block.TaskID] {
			seen[block.TaskID] = true
			ids = append(ids, block.TaskID)
		}
	}
	if out.Blocks == nil {
		out.Blocks = []models.ScheduledBlock{}
	}
	return out, ids, nil
}

func (s *service) latestRevision(userID string) (*models.ScheduleRevision, revisionSnapshot, []string, time.Time, time.Time, error) {
	var none revisionSnapshot
	rev, err := s.repo.LatestRevision(userID)
	if err != nil {
		return nil, none, nil, time.Time{}, time.Time{}, errors.New("nothing to undo")
	}
	snapshot, ids, err := decodeRevision(rev.Snapshot)
	if err != nil {
		return nil, none, nil, time.Time{}, time.Time{}, err
	}
	from, err := time.Parse(time.RFC3339, rev.HorizonFrom)
	if err != nil {
		return nil, none, nil, time.Time{}, time.Time{}, err
	}
	to, err := time.Parse(time.RFC3339, rev.HorizonTo)
	if err != nil {
		return nil, none, nil, time.Time{}, time.Time{}, err
	}
	return rev, snapshot, ids, from, to, nil
}

func (s *service) Undo(userID string) (*PlanResponse, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	rev, snapshot, ids, from, to, err := s.latestRevision(userID)
	if err != nil {
		return nil, err
	}
	err = s.placement.UndoAutoSchedule(userID, placement.AutoScheduleUndo{
		RevisionID: rev.ID,
		TaskIDs:    ids,
		From:       from,
		To:         to,
		Restore:    snapshot.Blocks,
	})
	if err != nil {
		return nil, err
	}
	return s.Preview(userID, PlanRequest{})
}

// UndoBlock is one engine block an undo removes or restores.
type UndoBlock struct {
	TaskID   string    `json:"taskId"`
	TaskName string    `json:"taskName"`
	Start    time.Time `json:"start"`
	End      time.Time `json:"end"`
}

// UndoPreview lists what undoing the last auto-schedule would change, so the
// change can be reviewed before it is made.
type UndoPreview struct {
	CanUndo   bool        `json:"canUndo"`
	AppliedAt string      `json:"appliedAt,omitempty"`
	From      *time.Time  `json:"from,omitempty"`
	To        *time.Time  `json:"to,omitempty"`
	Remove    []UndoBlock `json:"remove"`
	Restore   []UndoBlock `json:"restore"`
}

func (s *service) PreviewUndo(userID string) (*UndoPreview, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	rev, snapshot, ids, from, to, err := s.latestRevision(userID)
	if err != nil {
		return &UndoPreview{Remove: []UndoBlock{}, Restore: []UndoBlock{}}, nil
	}
	current, err := s.placement.EngineBlocksInRange(userID, ids, from, to)
	if err != nil {
		return nil, err
	}
	names, err := s.repo.TaskNames(userID, ids)
	if err != nil {
		return nil, err
	}
	list := func(blocks []models.ScheduledBlock) []UndoBlock {
		out := make([]UndoBlock, 0, len(blocks))
		for _, b := range blocks {
			out = append(out, UndoBlock{TaskID: b.TaskID, TaskName: names[b.TaskID], Start: b.StartAt, End: b.EndAt})
		}
		return out
	}
	return &UndoPreview{CanUndo: true, AppliedAt: rev.CreatedAt, From: &from, To: &to, Remove: list(current), Restore: list(snapshot.Blocks)}, nil
}

func (s *service) Capacity(userID string, from, to time.Time, timezone string) ([]DayCapacity, error) {
	plan, err := s.Preview(userID, PlanRequest{
		From:     strPtrTime(from),
		To:       strPtrTime(to),
		Timezone: timezone,
	})
	if err != nil {
		return nil, err
	}
	return plan.Capacity, nil
}

func strPtrTime(t time.Time) *string {
	v := t.UTC().Format(time.RFC3339)
	return &v
}

func (s *service) makeCandidate(t *models.Task, loc *time.Location, todayStamp string, now time.Time) Candidate {
	remaining := t.Duration
	cand := Candidate{
		ID:               t.ID,
		TaskID:           t.ID,
		Name:             t.Name,
		DurationMinutes:  remaining,
		ChunkMinutes:     t.ChunkMinutes(),
		MinChunkMinutes:  t.MinChunk(),
		Contiguous:       t.Contiguous,
		Priority:         derefString(t.PriorityLevel),
		CreatedAt:        t.CreatedAt,
		Deadline:         parseDay(t.Deadline, loc),
		StartDate:        parseDay(t.StartDate, loc),
		PreferredWindows: t.PreferredWindows,
		BlockedByID:      derefString(t.BlockedByID),
		TodayFocus:       models.NormalizeDate(derefString(t.TodayFocusOn)) == todayStamp,
		ActualMinutes:    t.ActualMinutes,
	}
	if t.EarliestStartAt != nil && *t.EarliestStartAt != "" {
		if parsed, err := recurrence.ParseTimeIn(*t.EarliestStartAt, loc); err == nil {
			cand.EarliestStart = &parsed
		}
	}
	return cand
}

func hasPinnedBlock(t *models.Task, freezeUntil time.Time) bool {
	for _, block := range t.Blocks {
		if block.Source == models.BlockSourceManual || block.Locked {
			return true
		}
		if !freezeUntil.IsZero() && block.StartAt.Before(freezeUntil) && block.Source == models.BlockSourceEngine {
			return false
		}
	}
	return hasManualBlock(t)
}

func frozenOnly(t *models.Task, freezeUntil time.Time) bool {
	if freezeUntil.IsZero() || len(t.Blocks) == 0 {
		return false
	}
	remaining := t.Duration
	for _, block := range t.Blocks {
		if block.StartAt.Before(freezeUntil) {
			remaining -= int(block.EndAt.Sub(block.StartAt).Minutes())
		}
	}
	return remaining <= 0
}

func blockLockedOrFrozen(t *models.Task, original time.Time, freezeUntil time.Time) bool {
	for _, block := range t.Blocks {
		if block.OccurrenceStart == nil || !block.OccurrenceStart.Equal(original) {
			continue
		}
		if block.Locked || block.Source == models.BlockSourceManual {
			return true
		}
		if !freezeUntil.IsZero() && block.StartAt.Before(freezeUntil) {
			return true
		}
	}
	return false
}

func hasOccurrenceBlock(t *models.Task, original time.Time) bool {
	for _, block := range t.Blocks {
		if block.OccurrenceStart != nil && block.OccurrenceStart.Equal(original) {
			return true
		}
	}
	return false
}

func maxTimePtr(a, b *time.Time) *time.Time {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	if b.After(*a) {
		return b
	}
	return a
}

type blockSnap struct {
	TaskID          string     `json:"taskId"`
	UserID          string     `json:"userId"`
	StartAt         time.Time  `json:"start"`
	EndAt           time.Time  `json:"end"`
	Source          string     `json:"source"`
	ChunkIndex      int        `json:"chunkIndex"`
	Locked          bool       `json:"locked"`
	OccurrenceStart *time.Time `json:"occurrenceStart,omitempty"`
}

// currentEngineBlocks returns the engine blocks Apply is allowed to replace,
// using exactly the predicate of Placement's Engine-block delete: candidate
// tasks only, engine source, not locked, overlapping [from, to), and not
// starting inside the freeze window. Preview "remove" rows are derived from
// this map, so anything outside the predicate must not appear here or the
// preview would describe deletions Apply never performs.
func currentEngineBlocks(tasks []models.Task, candidates map[string]bool, from, to, freezeUntil time.Time) map[string][]BlockOut {
	out := map[string][]BlockOut{}
	for i := range tasks {
		t := &tasks[i]
		if t.IsCompleted() {
			continue
		}
		if candidates != nil && !candidates[t.ID] {
			continue
		}
		for _, block := range t.Blocks {
			if block.Source != models.BlockSourceEngine || block.Locked {
				continue
			}
			if !block.StartAt.Before(to) || !block.EndAt.After(from) {
				continue
			}
			if !freezeUntil.IsZero() && block.StartAt.Before(freezeUntil) {
				continue
			}
			out[t.ID] = append(out[t.ID], BlockOut{
				Start:           block.StartAt,
				End:             block.EndAt,
				ChunkIndex:      block.ChunkIndex,
				OccurrenceStart: block.OccurrenceStart,
			})
		}
	}
	return out
}

func classifyChange(before, after []BlockOut) string {
	if len(before) == 0 {
		return "add"
	}
	if sameBlocks(before, after) {
		return "keep"
	}
	return "move"
}

func sameBlocks(a, b []BlockOut) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if !a[i].Start.Equal(b[i].Start) || !a[i].End.Equal(b[i].End) {
			return false
		}
	}
	return true
}

func diffPlan(current map[string][]BlockOut, proposals []ProposalOut, skipped []Skipped, names map[string]string) []PlanChange {
	seen := map[string]bool{}
	var changes []PlanChange
	for _, proposal := range proposals {
		seen[proposal.TaskID] = true
		before := current[proposal.TaskID]
		switch proposal.Change {
		case "keep":
			changes = append(changes, PlanChange{
				Action: "pin", TaskID: proposal.TaskID, TaskName: proposal.TaskName,
				Message: "Unchanged",
			})
		case "move":
			var prev *BlockOut
			if len(before) > 0 {
				prev = &before[0]
			}
			var next *BlockOut
			if len(proposal.Blocks) > 0 {
				next = &proposal.Blocks[0]
			}
			changes = append(changes, PlanChange{
				Action: "move", TaskID: proposal.TaskID, TaskName: proposal.TaskName,
				Message: "Move " + proposal.TaskName, Before: prev, After: next,
			})
		default:
			var next *BlockOut
			if len(proposal.Blocks) > 0 {
				next = &proposal.Blocks[0]
			}
			changes = append(changes, PlanChange{
				Action: "add", TaskID: proposal.TaskID, TaskName: proposal.TaskName,
				Message: "Add " + proposal.TaskName, After: next,
			})
		}
	}
	for id, blocks := range current {
		if seen[id] || len(blocks) == 0 {
			continue
		}
		name := names[id]
		if name == "" {
			name = "Untitled"
		}
		changes = append(changes, PlanChange{
			Action: "remove", TaskID: id, TaskName: name, Message: "Remove previous engine block",
			Before: &blocks[0],
		})
	}
	for _, item := range skipped {
		if item.Reason == ReasonLocked || item.Reason == ReasonManual || item.Reason == ReasonFrozen {
			changes = append(changes, PlanChange{
				Action: "pin", TaskID: item.TaskID, TaskName: item.TaskName, Message: item.Message,
			})
		}
	}
	if changes == nil {
		changes = []PlanChange{}
	}
	return changes
}

func dayCapacity(from, to time.Time, loc *time.Location, hours models.WorkingHours, occupied []Interval, proposals []ProposalOut) []DayCapacity {
	var out []DayCapacity
	day := time.Date(from.In(loc).Year(), from.In(loc).Month(), from.In(loc).Day(), 0, 0, 0, 0, loc)
	end := to.In(loc)
	for day.Before(end) {
		next := day.AddDate(0, 0, 1)
		available := 0
		for _, interval := range workingIntervals(day, next, hours, loc) {
			available += interval.Minutes()
		}
		scheduled := 0
		atRisk := false
		for _, item := range occupied {
			if !item.Start.Before(next) || !item.End.After(day) {
				continue
			}
			start := maxTime(item.Start, day)
			finish := item.End
			if next.Before(finish) {
				finish = next
			}
			scheduled += int(finish.Sub(start).Minutes())
		}
		planned := 0
		for _, proposal := range proposals {
			for _, block := range proposal.Blocks {
				if !block.Start.Before(next) || !block.End.After(day) {
					continue
				}
				start := maxTime(block.Start, day)
				finish := block.End
				if next.Before(finish) {
					finish = next
				}
				planned += int(finish.Sub(start).Minutes())
			}
			if proposal.PastDeadline {
				atRisk = true
			}
		}
		out = append(out, DayCapacity{
			Date:             day.Format("2006-01-02"),
			AvailableMinutes: available,
			ScheduledMinutes: scheduled,
			PlannedMinutes:   planned,
			OverCapacity:     planned > available && available >= 0,
			AtRisk:           atRisk || planned > available,
		})
		day = next
	}
	return out
}
