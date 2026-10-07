package placement

import (
	"errors"
	"time"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"
	"timely-api/internal/utils"
)

// ResolveEnd is the end of a Block the person (or the agent) placed: an explicit
// end, else a duration, else fallbackMinutes (the task's estimate or the moved
// Block's length), else 30 minutes.
func ResolveEnd(start time.Time, endRaw *string, durationMinutes *int, fallbackMinutes int) (time.Time, error) {
	if endRaw != nil && *endRaw != "" {
		end, err := recurrence.ParseTime(*endRaw)
		if err != nil {
			return time.Time{}, errors.New("invalid end")
		}
		if !end.After(start) {
			return time.Time{}, errors.New("block must end after it starts")
		}
		return end, nil
	}
	minutes := fallbackMinutes
	if durationMinutes != nil && *durationMinutes > 0 {
		minutes = *durationMinutes
	}
	if minutes <= 0 {
		minutes = 30
	}
	return start.Add(time.Duration(minutes) * time.Minute), nil
}

// PlaceByHand writes a Manual block for Work the person placed (drag,
// schedule_task) and pushes aside the other replaceable Work Blocks it covers,
// so Auto-schedule can re-place them. Pinned time and an Event's time are never
// removed; the new Block just overlaps them (ADR 0010). With replace the task's
// existing Blocks are swapped for the new one, otherwise it is added as another
// chunk. The task must be Work (not an Inbox item, Reminder, or series).
func (s *Service) PlaceByHand(userID string, task *models.Task, start, end time.Time, replace bool) error {
	if err := s.ready(); err != nil {
		return err
	}
	block := models.ScheduledBlock{
		TaskID:  task.ID,
		UserID:  userID,
		StartAt: start,
		EndAt:   end,
		Source:  models.BlockSourceManual,
	}
	keepID := ""
	if replace {
		next := []models.ScheduledBlock{block}
		if err := s.blocks.ReplaceForTask(task.ID, userID, "", next); err != nil {
			return err
		}
		keepID = next[0].ID
	} else {
		existing, err := s.blocks.ListForTask(task.ID)
		if err != nil {
			return err
		}
		block.ChunkIndex = len(existing)
		created, err := s.blocks.Create(&block)
		if err != nil {
			return err
		}
		keepID = created.ID
	}
	return s.displaceOverlapping(userID, start, end, keepID)
}

// MoveByHand moves one Block by hand. It becomes a Manual block and pushes
// aside other replaceable Work the way PlaceByHand does. A missing end keeps the
// Block's length.
func (s *Service) MoveByHand(userID, blockID, startRaw string, endRaw *string) (*models.ScheduledBlock, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	block, err := s.blocks.Get(userID, blockID)
	if err != nil {
		return nil, err
	}
	start, err := recurrence.ParseTime(startRaw)
	if err != nil {
		return nil, errors.New("invalid start")
	}
	length := int(block.EndAt.Sub(block.StartAt).Minutes())
	end, err := ResolveEnd(start, endRaw, nil, length)
	if err != nil {
		return nil, err
	}
	if err := s.blocks.Move(block, start, end); err != nil {
		return nil, err
	}
	if err := s.displaceOverlapping(userID, start, end, block.ID); err != nil {
		return nil, err
	}
	return block, nil
}

// DeleteBlock removes one Block.
func (s *Service) DeleteBlock(userID, blockID string) error {
	if err := s.ready(); err != nil {
		return err
	}
	block, err := s.blocks.Get(userID, blockID)
	if err != nil {
		return err
	}
	return s.blocks.Delete(block)
}

// PinBlock sets whether one Block is Pinned. Pinning a Block makes it a Manual
// block, since the person chose to keep that time.
func (s *Service) PinBlock(userID, blockID string, locked bool) (*models.ScheduledBlock, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
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

// displaceOverlapping drops other replaceable work blocks that cover
// [start, end) so the block the user just placed can keep that slot. The
// schedule engine then re-places those tasks in the next free time.
// keepBlockID is the pin. Time the person protected stays put and simply
// overlaps: a pinned block, every block of a pinned task, and an Event's time.
func (s *Service) displaceOverlapping(userID string, start, end time.Time, keepBlockID string) error {
	blocks, err := s.blocks.ListInRange(userID, start, end)
	if err != nil {
		return err
	}
	lockedTasks, err := s.lockedTaskIDs(blocks)
	if err != nil {
		return err
	}
	for i := range blocks {
		block := &blocks[i]
		if keepBlockID != "" && block.ID == keepBlockID {
			continue
		}
		if block.Locked || block.EventID != nil || block.TaskID == "" || lockedTasks[block.TaskID] {
			continue
		}
		if err := s.blocks.Delete(block); err != nil {
			return err
		}
	}
	return nil
}

// lockedTaskIDs returns the tasks among the blocks' owners that are pinned
// as a whole (scheduleLocked).
func (s *Service) lockedTaskIDs(blocks []models.ScheduledBlock) (map[string]bool, error) {
	ids := []string{}
	for i := range blocks {
		if blocks[i].TaskID != "" {
			ids = append(ids, blocks[i].TaskID)
		}
	}
	locked := map[string]bool{}
	if len(ids) == 0 {
		return locked, nil
	}
	var lockedIDs []string
	if err := s.blocks.DB().Model(&models.Task{}).
		Where("id IN ? AND schedule_locked = ?", ids, true).
		Pluck("id", &lockedIDs).Error; err != nil {
		return nil, err
	}
	for _, id := range lockedIDs {
		locked[id] = true
	}
	return locked, nil
}
