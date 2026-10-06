package placement

import (
	"time"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

// blockStore persists the calendar intervals reserved for tasks and Events and
// keeps tasks.scheduled_on in sync with them. Only Placement holds one.
type blockStore struct {
	db *gorm.DB
}

func newBlockStore(db *gorm.DB) *blockStore {
	return &blockStore{db: db}
}

func (s *blockStore) WithTx(tx *gorm.DB) *blockStore {
	return &blockStore{db: tx}
}

func (s *blockStore) Get(userID, blockID string) (*models.ScheduledBlock, error) {
	var block models.ScheduledBlock
	err := s.db.Where("id = ? AND user_id = ?", blockID, userID).First(&block).Error
	if err != nil {
		return nil, err
	}
	return &block, nil
}

func (s *blockStore) ListForTask(taskID string) ([]models.ScheduledBlock, error) {
	var out []models.ScheduledBlock
	err := s.db.Where("task_id = ?", taskID).Order("start_at ASC").Find(&out).Error
	return out, err
}

// ListInRange returns the user's blocks overlapping [from, to).
func (s *blockStore) ListInRange(userID string, from, to time.Time) ([]models.ScheduledBlock, error) {
	var out []models.ScheduledBlock
	err := s.db.
		Where("user_id = ? AND start_at < ? AND end_at > ?", userID, to, from).
		Order("start_at ASC").
		Find(&out).Error
	return out, err
}

// Create adds one block and refreshes the task's scheduled_on.
func (s *blockStore) Create(block *models.ScheduledBlock) (*models.ScheduledBlock, error) {
	if block.ID == "" {
		block.ID = utils.NewBlockID()
	}
	if block.Source == "" {
		block.Source = models.BlockSourceManual
	}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(block).Error; err != nil {
			return err
		}
		return syncScheduledOn(tx, block.TaskID)
	})
	if err != nil {
		return nil, err
	}
	return block, nil
}

// Move changes one block's interval. A block moved by hand becomes manual so
// the engine stops rewriting it.
func (s *blockStore) Move(block *models.ScheduledBlock, start, end time.Time) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		block.StartAt = start
		block.EndAt = end
		block.Source = models.BlockSourceManual
		if err := tx.Model(block).Select("StartAt", "EndAt", "Source", "UpdatedAt").Updates(block).Error; err != nil {
			return err
		}
		return syncScheduledOn(tx, block.TaskID)
	})
}

func (s *blockStore) Delete(block *models.ScheduledBlock) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(block).Error; err != nil {
			return err
		}
		return syncScheduledOn(tx, block.TaskID)
	})
}

// ReplaceForTask drops the task's blocks (all of them, or only `source` when
// given) and writes the new set in one transaction.
func (s *blockStore) ReplaceForTask(taskID, userID, source string, next []models.ScheduledBlock) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		query := tx.Where("task_id = ?", taskID)
		if source != "" {
			query = query.Where("source = ?", source)
		}
		if err := query.Delete(&models.ScheduledBlock{}).Error; err != nil {
			return err
		}
		for i := range next {
			next[i].ID = utils.NewBlockID()
			next[i].TaskID = taskID
			next[i].UserID = userID
			if next[i].Source == "" {
				next[i].Source = models.BlockSourceManual
			}
		}
		if len(next) > 0 {
			if err := tx.Create(&next).Error; err != nil {
				return err
			}
		}
		return syncScheduledOn(tx, taskID)
	})
}

// DeleteForTask removes the task's blocks, optionally only those of `source`.
func (s *blockStore) DeleteForTask(taskID, source string) error {
	return s.ReplaceForTask(taskID, "", source, nil)
}

// DeleteEngineBlocksInRange clears replaceable engine blocks overlapping
// [from, to). Locked blocks and anything that starts before freezeUntil stay.
func (s *blockStore) DeleteEngineBlocksInRange(tx *gorm.DB, taskIDs []string, from, to, freezeUntil time.Time) error {
	if len(taskIDs) == 0 {
		return nil
	}
	query := tx.Where("task_id IN ? AND source = ? AND locked = ? AND start_at < ? AND end_at > ?",
		taskIDs, models.BlockSourceEngine, false, to, from)
	if !freezeUntil.IsZero() {
		query = query.Where("start_at >= ?", freezeUntil)
	}
	if err := query.Delete(&models.ScheduledBlock{}).Error; err != nil {
		return err
	}
	for _, id := range taskIDs {
		if err := syncScheduledOn(tx, id); err != nil {
			return err
		}
	}
	return nil
}

// InsertMany writes prepared blocks and refreshes their tasks' scheduled_on.
func (s *blockStore) InsertMany(tx *gorm.DB, next []models.ScheduledBlock) error {
	if len(next) == 0 {
		return nil
	}
	touched := map[string]bool{}
	for i := range next {
		if next[i].ID == "" {
			next[i].ID = utils.NewBlockID()
		}
		if next[i].TaskID != "" {
			touched[next[i].TaskID] = true
		}
	}
	if err := tx.Create(&next).Error; err != nil {
		return err
	}
	for id := range touched {
		if err := syncScheduledOn(tx, id); err != nil {
			return err
		}
	}
	return nil
}

// DB exposes the underlying handle for callers that need a transaction.
func (s *blockStore) DB() *gorm.DB {
	return s.db
}

// ReplaceForEvent drops the Event's blocks and writes the new Manual set.
// task_id stays NULL so the Work FK does not fire.
func (s *blockStore) ReplaceForEvent(eventID, userID string, next []models.ScheduledBlock) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("event_id = ?", eventID).Delete(&models.ScheduledBlock{}).Error; err != nil {
			return err
		}
		for i := range next {
			next[i].ID = utils.NewBlockID()
			id := eventID
			next[i].EventID = &id
			next[i].TaskID = ""
			next[i].UserID = userID
			if next[i].Source == "" {
				next[i].Source = models.BlockSourceManual
			}
			if err := tx.Exec(`
				INSERT INTO scheduled_blocks (id, task_id, event_id, user_id, start_at, end_at, source, chunk_index, locked, occurrence_start, created_at, updated_at)
				VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				next[i].ID, eventID, userID, next[i].StartAt, next[i].EndAt, next[i].Source, next[i].ChunkIndex, next[i].Locked, next[i].OccurrenceStart,
				utils.GetCurrentTimestamp(), utils.GetCurrentTimestamp(),
			).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *blockStore) ListForEvent(eventID string) ([]models.ScheduledBlock, error) {
	var out []models.ScheduledBlock
	err := s.db.Where("event_id = ?", eventID).Order("start_at ASC").Find(&out).Error
	return out, err
}

// syncScheduledOn mirrors the earliest block start onto the task so list views
// and sorting keep working without knowing about blocks.
func syncScheduledOn(tx *gorm.DB, taskID string) error {
	if taskID == "" {
		return nil
	}
	// Reminders (duration 0) keep scheduled_on as the ping time and have no
	// blocks. Recurring series keep scheduled_on as the rule's dtstart.
	return tx.Exec(`
		UPDATE tasks
		SET scheduled_on = (SELECT MIN(start_at) FROM scheduled_blocks WHERE task_id = ?)
		WHERE id = ?
		  AND duration > 0
		  AND NOT EXISTS (
		    SELECT 1 FROM recurrence_rules WHERE owner_type = 'task' AND owner_id = ?
		  )`,
		taskID, taskID, taskID,
	).Error
}
