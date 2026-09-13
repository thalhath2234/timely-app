package recurrence

import (
	"errors"
	"time"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

// Store persists rules and exceptions. It is shared by the task, event,
// calendar and schedule features so all of them agree on the series model.
type Store struct {
	db *gorm.DB
}

func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

// WithTx returns a store bound to a transaction.
func (s *Store) WithTx(tx *gorm.DB) *Store {
	return &Store{db: tx}
}

func (s *Store) Get(ownerType, ownerID string) (*models.RecurrenceRule, error) {
	var rule models.RecurrenceRule
	err := s.db.
		Preload("Exceptions").
		Where("owner_type = ? AND owner_id = ?", ownerType, ownerID).
		First(&rule).Error
	if err != nil {
		return nil, err
	}
	return &rule, nil
}

// ForOwners loads the rules of many owners at once, keyed by owner id.
func (s *Store) ForOwners(ownerType string, ownerIDs []string) (map[string]*models.RecurrenceRule, error) {
	out := map[string]*models.RecurrenceRule{}
	if len(ownerIDs) == 0 {
		return out, nil
	}
	var rules []models.RecurrenceRule
	err := s.db.
		Preload("Exceptions").
		Where("owner_type = ? AND owner_id IN ?", ownerType, ownerIDs).
		Find(&rules).Error
	if err != nil {
		return nil, err
	}
	for i := range rules {
		out[rules[i].OwnerID] = &rules[i]
	}
	return out, nil
}

// Upsert replaces the owner's rule. Existing exceptions are dropped when the
// pattern changes because their original starts no longer line up.
func (s *Store) Upsert(ownerType, ownerID, userID string, input models.RecurrenceInput) (*models.RecurrenceRule, error) {
	parsed, dtstart, loc, err := ParseInput(input)
	if err != nil {
		return nil, err
	}

	existing, err := s.Get(ownerType, ownerID)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	if existing != nil {
		patternChanged := existing.RRule != parsed.String() || !existing.Dtstart.Equal(dtstart)
		existing.RRule = parsed.String()
		existing.Dtstart = dtstart
		existing.Timezone = loc.String()
		if err := s.db.Model(existing).Select("RRule", "Dtstart", "Timezone", "UpdatedAt").Updates(existing).Error; err != nil {
			return nil, err
		}
		if patternChanged {
			if err := s.db.Where("rule_id = ?", existing.ID).Delete(&models.RecurrenceException{}).Error; err != nil {
				return nil, err
			}
			existing.Exceptions = nil
		}
		return existing, nil
	}

	rule := &models.RecurrenceRule{
		ID:        utils.NewRecurrenceRuleID(),
		OwnerType: ownerType,
		OwnerID:   ownerID,
		UserID:    userID,
		RRule:     parsed.String(),
		Dtstart:   dtstart,
		Timezone:  loc.String(),
	}
	if err := s.db.Create(rule).Error; err != nil {
		return nil, err
	}
	return rule, nil
}

func (s *Store) Delete(ownerType, ownerID string) error {
	return s.db.
		Where("owner_type = ? AND owner_id = ?", ownerType, ownerID).
		Delete(&models.RecurrenceRule{}).Error
}

// CloseBefore ends the series just before `cutoff`, keeping earlier instances
// and exceptions intact. It is the first half of a "this and future" split.
func (s *Store) CloseBefore(rule *models.RecurrenceRule, cutoff time.Time) error {
	parsed, err := Parse(rule.RRule)
	if err != nil {
		return err
	}
	closed := parsed.WithUntil(cutoff)
	rule.RRule = closed.String()
	if err := s.db.Model(rule).Select("RRule", "UpdatedAt").Updates(rule).Error; err != nil {
		return err
	}
	return s.db.
		Where("rule_id = ? AND original_start >= ?", rule.ID, cutoff).
		Delete(&models.RecurrenceException{}).Error
}

// ExceptionPatch describes how one instance deviates from the series. Nil
// pointers leave the stored value untouched.
type ExceptionPatch struct {
	NewStart    *time.Time
	NewEnd      *time.Time
	ClearMove   bool
	IsCancelled *bool
	CompletedAt *time.Time
	ClearDone   bool
}

// UpsertException records or updates the override of one instance. The
// instance must be a real occurrence of the rule.
func (s *Store) UpsertException(rule *models.RecurrenceRule, originalStart time.Time, patch ExceptionPatch) (*models.RecurrenceException, error) {
	if !IsOccurrence(rule, originalStart) {
		return nil, errors.New("not an occurrence of this series")
	}

	var exception models.RecurrenceException
	err := s.db.
		Where("rule_id = ? AND original_start = ?", rule.ID, originalStart).
		First(&exception).Error
	isNew := errors.Is(err, gorm.ErrRecordNotFound)
	if err != nil && !isNew {
		return nil, err
	}
	if isNew {
		exception = models.RecurrenceException{
			ID:            utils.NewRecurrenceExceptionID(),
			RuleID:        rule.ID,
			OriginalStart: originalStart,
		}
	}

	if patch.ClearMove {
		exception.NewStart = nil
		exception.NewEnd = nil
	}
	if patch.NewStart != nil {
		exception.NewStart = patch.NewStart
		exception.NewEnd = patch.NewEnd
	}
	if patch.IsCancelled != nil {
		exception.IsCancelled = *patch.IsCancelled
	}
	if patch.ClearDone {
		exception.CompletedAt = nil
	}
	if patch.CompletedAt != nil {
		exception.CompletedAt = patch.CompletedAt
	}

	// An override that no longer changes anything is just noise.
	if !exception.IsCancelled && exception.NewStart == nil && exception.CompletedAt == nil {
		if !isNew {
			if err := s.db.Delete(&exception).Error; err != nil {
				return nil, err
			}
		}
		return &exception, nil
	}

	if isNew {
		err = s.db.Create(&exception).Error
	} else {
		err = s.db.Model(&exception).
			Select("NewStart", "NewEnd", "IsCancelled", "CompletedAt", "UpdatedAt").
			Updates(&exception).Error
	}
	if err != nil {
		return nil, err
	}
	return &exception, nil
}
