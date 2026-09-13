package event

import (
	"time"
	"timely-api/internal/models"

	"gorm.io/gorm"
)

type EventRepository interface {
	Create(event *models.Event) (*models.Event, error)
	GetByID(userID, eventID string) (*models.Event, error)
	ListByUser(userID string) ([]models.Event, error)
	// ListInRange returns one-off events overlapping [from, to) plus every
	// recurring event, since a series can produce instances anywhere.
	ListInRange(userID string, from, to time.Time) ([]models.Event, error)
	Update(userID, eventID string, updates map[string]any) (*models.Event, error)
	Delete(userID, eventID string) error
	WorkspaceBelongsToUser(userID, workspaceID string) (bool, error)
	DB() *gorm.DB
}

type eventRepository struct {
	db *gorm.DB
}

func NewEventRepository(db *gorm.DB) EventRepository {
	return &eventRepository{db: db}
}

func (r *eventRepository) DB() *gorm.DB {
	return r.db
}

func (r *eventRepository) withRelations() *gorm.DB {
	return r.db.Preload("Recurrence.Exceptions")
}

func (r *eventRepository) Create(event *models.Event) (*models.Event, error) {
	if err := r.db.Omit("Recurrence").Create(event).Error; err != nil {
		return nil, err
	}
	return r.GetByID(event.UserID, event.ID)
}

func (r *eventRepository) GetByID(userID, eventID string) (*models.Event, error) {
	var event models.Event
	err := r.withRelations().
		Where("id = ? AND user_id = ?", eventID, userID).
		First(&event).Error
	if err != nil {
		return nil, err
	}
	return &event, nil
}

func (r *eventRepository) ListByUser(userID string) ([]models.Event, error) {
	var events []models.Event
	err := r.withRelations().
		Where("user_id = ?", userID).
		Order("start_at ASC").
		Find(&events).Error
	if err != nil {
		return nil, err
	}
	return events, nil
}

func (r *eventRepository) ListInRange(userID string, from, to time.Time) ([]models.Event, error) {
	var events []models.Event
	err := r.withRelations().
		Where("user_id = ?", userID).
		Where(
			"(start_at < ? AND end_at > ?) OR id IN (SELECT owner_id FROM recurrence_rules WHERE owner_type = ? AND user_id = ?)",
			to, from, models.RecurrenceOwnerEvent, userID,
		).
		Order("start_at ASC").
		Find(&events).Error
	if err != nil {
		return nil, err
	}
	return events, nil
}

func (r *eventRepository) Update(userID, eventID string, updates map[string]any) (*models.Event, error) {
	if len(updates) > 0 {
		result := r.db.Model(&models.Event{}).
			Where("id = ? AND user_id = ?", eventID, userID).
			Updates(updates)
		if result.Error != nil {
			return nil, result.Error
		}
		if result.RowsAffected == 0 {
			return nil, gorm.ErrRecordNotFound
		}
	}
	return r.GetByID(userID, eventID)
}

func (r *eventRepository) Delete(userID, eventID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Where("id = ? AND user_id = ?", eventID, userID).Delete(&models.Event{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return tx.
			Where("owner_type = ? AND owner_id = ?", models.RecurrenceOwnerEvent, eventID).
			Delete(&models.RecurrenceRule{}).Error
	})
}

func (r *eventRepository) WorkspaceBelongsToUser(userID, workspaceID string) (bool, error) {
	var count int64
	err := r.db.Model(&models.Workspace{}).
		Where("id = ? AND user_id = ?", workspaceID, userID).
		Count(&count).Error
	return count > 0, err
}
