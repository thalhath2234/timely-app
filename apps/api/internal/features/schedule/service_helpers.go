package schedule

import (
	"encoding/json"
	"errors"
	"time"
	"timely-api/internal/features/calendar"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"
	"timely-api/internal/utils"

	"gorm.io/gorm"
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
	block, err := s.blocks.Get(userID, blockID)
	if err != nil {
		return nil, err
	}
	if err := s.blocks.DB().Model(block).Updates(map[string]any{
		"locked":     locked,
		"source":     models.BlockSourceManual,
		"updated_at": utils.GetCurrentTimestamp(),
	}).Error; err != nil {
		return nil, err
	}
	block.Locked = locked
	block.Source = models.BlockSourceManual
	return block, nil
}

func (s *service) Undo(userID string) (*PlanResponse, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	rev, err := s.repo.LatestRevision(userID)
	if err != nil {
		return nil, errors.New("nothing to undo")
	}
	var snapshot []models.ScheduledBlock
	if err := json.Unmarshal(rev.Snapshot, &snapshot); err != nil {
		return nil, err
	}
	from, err := time.Parse(time.RFC3339, rev.HorizonFrom)
	if err != nil {
		return nil, err
	}
	to, err := time.Parse(time.RFC3339, rev.HorizonTo)
	if err != nil {
		return nil, err
	}
	taskIDs := map[string]bool{}
	for _, block := range snapshot {
		taskIDs[block.TaskID] = true
	}
	ids := make([]string, 0, len(taskIDs))
	for id := range taskIDs {
		ids = append(ids, id)
	}
	err = s.blocks.DB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", userID).Error; err != nil {
			return err
		}
		store := s.blocks.WithTx(tx)
		if err := store.DeleteEngineBlocksInRange(tx, ids, from, to, time.Time{}); err != nil {
			return err
		}
		if err := store.InsertMany(tx, snapshot); err != nil {
			return err
		}
		return tx.Where("id = ? AND user_id = ?", rev.ID, userID).Delete(&models.ScheduleRevision{}).Error
	})
	if err != nil {
		return nil, err
	}
	return s.Preview(userID, PlanRequest{})
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

func snapshotEngineBlocks(tx *gorm.DB, userID string, taskIDs []string, from, to time.Time) ([]models.ScheduledBlock, error) {
	if len(taskIDs) == 0 {
		return []models.ScheduledBlock{}, nil
	}
	var out []models.ScheduledBlock
	err := tx.Where("user_id = ? AND task_id IN ? AND source = ? AND start_at < ? AND end_at > ?",
		userID, taskIDs, models.BlockSourceEngine, to, from).
		Order("start_at ASC").
		Find(&out).Error
	if out == nil {
		out = []models.ScheduledBlock{}
	}
	return out, err
}

func currentEngineBlocks(tasks []models.Task, from, to time.Time) map[string][]BlockOut {
	out := map[string][]BlockOut{}
	for i := range tasks {
		t := &tasks[i]
		for _, block := range t.Blocks {
			if block.Source != models.BlockSourceEngine {
				continue
			}
			if !block.StartAt.Before(to) || !block.EndAt.After(from) {
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

func diffPlan(current map[string][]BlockOut, proposals []ProposalOut, skipped []Skipped) []PlanChange {
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
		changes = append(changes, PlanChange{
			Action: "remove", TaskID: id, Message: "Remove previous engine block",
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

func dayCapacity(from, to time.Time, loc *time.Location, hours models.WorkingHours, items []calendar.Item, proposals []ProposalOut) []DayCapacity {
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
		for _, item := range items {
			if item.AllDay || item.Reminder || !item.Start.Before(next) || !item.End.After(day) {
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
