// Package blocks persists the calendar intervals reserved for tasks and keeps
// tasks.scheduled_on in sync with them. It is shared by the task feature (manual
// placement) and the schedule feature (engine placement).
package blocks

import (
	"time"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

type Store struct {
	db *gorm.DB
}

func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

func (s *Store) WithTx(tx *gorm.DB) *Store {
	return &Store{db: tx}
}

func (s *Store) Get(userID, blockID string) (*models.ScheduledBlock, error) {
	var block models.ScheduledBlock
	err := s.db.Where("id = ? AND user_id = ?", blockID, userID).First(&block).Error
	if err != nil {
		return nil, err
	}
	return &block, nil
}

func (s *Store) ListForTask(taskID string) ([]models.ScheduledBlock, error) {
	var out []models.ScheduledBlock
	err := s.db.Where("task_id = ?", taskID).Order("start_at ASC").Find(&out).Error
	return out, err
}

// ListInRange returns the user's blocks overlapping [from, to).
func (s *Store) ListInRange(userID string, from, to time.Time) ([]models.ScheduledBlock, error) {
	var out []models.ScheduledBlock
	err := s.db.
		Where("user_id = ? AND start_at < ? AND end_at > ?", userID, to, from).
		Order("start_at ASC").
		Find(&out).Error
	return out, err
}

// Create adds one block and refreshes the task's scheduled_on.
func (s *Store) Create(block *models.ScheduledBlock) (*models.ScheduledBlock, error) {
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
func (s *Store) Move(block *models.ScheduledBlock, start, end time.Time) error {
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

func (s *Store) Delete(block *models.ScheduledBlock) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(block).Error; err != nil {
			return err
		}
		return syncScheduledOn(tx, block.TaskID)
	})
}

// ReplaceForTask drops the task's blocks (all of them, or only `source` when
// given) and writes the new set in one transaction.
func (s *Store) ReplaceForTask(taskID, userID, source string, next []models.ScheduledBlock) error {
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
func (s *Store) DeleteForTask(taskID, source string) error {
	return s.ReplaceForTask(taskID, "", source, nil)
}

// DeleteEngineBlocksForTasks clears engine-owned blocks for many tasks so a
// reschedule starts from a clean slate. Manual blocks are never touched here.
func (s *Store) DeleteEngineBlocksForTasks(tx *gorm.DB, taskIDs []string) error {
	if len(taskIDs) == 0 {
		return nil
	}
	if err := tx.
		Where("task_id IN ? AND source = ?", taskIDs, models.BlockSourceEngine).
		Delete(&models.ScheduledBlock{}).Error; err != nil {
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
func (s *Store) InsertMany(tx *gorm.DB, next []models.ScheduledBlock) error {
	if len(next) == 0 {
		return nil
	}
	touched := map[string]bool{}
	for i := range next {
		if next[i].ID == "" {
			next[i].ID = utils.NewBlockID()
		}
		touched[next[i].TaskID] = true
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
func (s *Store) DB() *gorm.DB {
	return s.db
}

// syncScheduledOn mirrors the earliest block start onto the task so list views
// and sorting keep working without knowing about blocks.
func syncScheduledOn(tx *gorm.DB, taskID string) error {
	return tx.Exec(`
		UPDATE tasks
		SET scheduled_on = (SELECT MIN(start_at) FROM scheduled_blocks WHERE task_id = ?)
		WHERE id = ?
		  AND NOT EXISTS (
		    SELECT 1 FROM recurrence_rules WHERE owner_type = 'task' AND owner_id = ?
		  )`,
		taskID, taskID, taskID,
	).Error
}
