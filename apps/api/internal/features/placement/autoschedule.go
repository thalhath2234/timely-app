package placement

import (
	"errors"
	"time"
	"timely-api/internal/models"

	"gorm.io/gorm"
)

// AutoScheduleApply is one Auto-schedule Apply: the Engine blocks to write and
// the scope they replace. Preview and ranking stay in the schedule feature.
type AutoScheduleApply struct {
	// CandidateIDs are the tasks whose Engine blocks in [From, To) are replaced.
	CandidateIDs []string
	From, To     time.Time
	// FreezeUntil keeps Engine blocks that start before it (zero means none).
	FreezeUntil time.Time
	// ReplaceManualIDs are tasks whose Manual blocks the person agreed to replace.
	ReplaceManualIDs []string
	// Next are the new Engine blocks.
	Next []models.ScheduledBlock
	// Revision builds the Undo record from the Engine blocks being replaced. It
	// is saved in the same transaction as the Block writes.
	Revision func(replaced []models.ScheduledBlock) (*models.ScheduleRevision, error)
}

// AutoScheduleUndo reverses a stored revision.
type AutoScheduleUndo struct {
	RevisionID string
	TaskIDs    []string
	From, To   time.Time
	// Restore are the Engine blocks the revision replaced.
	Restore []models.ScheduledBlock
}

// ApplyAutoSchedule replaces the candidates' Engine blocks with in.Next and
// records the revision, all in one transaction. Concurrent applies and undos
// for one user serialize. Pinned blocks and Manual blocks outside
// ReplaceManualIDs are never touched.
func (s *Service) ApplyAutoSchedule(userID string, in AutoScheduleApply) error {
	if err := s.ready(); err != nil {
		return err
	}
	if in.Revision == nil {
		return errors.New("auto-schedule apply needs a revision so it can be undone")
	}
	return s.blocks.DB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", userID).Error; err != nil {
			return err
		}
		store := s.blocks.WithTx(tx)
		replaced, err := store.engineBlocksInRange(userID, in.CandidateIDs, in.From, in.To)
		if err != nil {
			return err
		}
		if err := store.DeleteEngineBlocksInRange(tx, in.CandidateIDs, in.From, in.To, in.FreezeUntil); err != nil {
			return err
		}
		for _, id := range in.ReplaceManualIDs {
			if err := store.DeleteForTask(id, models.BlockSourceManual); err != nil {
				return err
			}
		}
		if err := store.InsertMany(tx, in.Next); err != nil {
			return err
		}
		revision, err := in.Revision(replaced)
		if err != nil {
			return err
		}
		return tx.Create(revision).Error
	})
}

// UndoAutoSchedule removes the Engine blocks an Apply wrote, restores the ones
// it replaced, and deletes the revision, in one transaction.
func (s *Service) UndoAutoSchedule(userID string, in AutoScheduleUndo) error {
	if err := s.ready(); err != nil {
		return err
	}
	return s.blocks.DB().Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", userID).Error; err != nil {
			return err
		}
		store := s.blocks.WithTx(tx)
		if err := store.DeleteEngineBlocksInRange(tx, in.TaskIDs, in.From, in.To, time.Time{}); err != nil {
			return err
		}
		if err := store.InsertMany(tx, in.Restore); err != nil {
			return err
		}
		return tx.Where("id = ? AND user_id = ?", in.RevisionID, userID).Delete(&models.ScheduleRevision{}).Error
	})
}

// EngineBlocksInRange lists the user's Engine blocks for the tasks that overlap
// [from, to), so a preview can say what an Undo would remove.
func (s *Service) EngineBlocksInRange(userID string, taskIDs []string, from, to time.Time) ([]models.ScheduledBlock, error) {
	if err := s.ready(); err != nil {
		return nil, err
	}
	return s.blocks.engineBlocksInRange(userID, taskIDs, from, to)
}

// engineBlocksInRange is the snapshot Apply stores for Undo.
func (s *blockStore) engineBlocksInRange(userID string, taskIDs []string, from, to time.Time) ([]models.ScheduledBlock, error) {
	if len(taskIDs) == 0 {
		return []models.ScheduledBlock{}, nil
	}
	var out []models.ScheduledBlock
	err := s.db.Where("user_id = ? AND task_id IN ? AND source = ? AND start_at < ? AND end_at > ?",
		userID, taskIDs, models.BlockSourceEngine, to, from).
		Order("start_at ASC").
		Find(&out).Error
	if out == nil {
		out = []models.ScheduledBlock{}
	}
	return out, err
}
