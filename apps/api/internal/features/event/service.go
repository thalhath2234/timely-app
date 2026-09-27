package event

import (
	"errors"
	"strings"
	"time"
	"timely-api/internal/features/embed"
	"timely-api/internal/features/placement"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

const maxTitleLength = 200

// EventUpdate carries partial changes. Nil leaves a field untouched. Recurrence
// distinguishes "absent" (RecurrenceSet=false) from "clear" (nil pointer).
type EventUpdate struct {
	Title       *string
	Description *string
	Start       *string
	End         *string
	Duration    *int
	AllDay      *bool
	Color       *string
	WorkspaceID *string
	ProjectID   *string
	TaskID      *string

	RecurrenceSet bool
	Recurrence    *models.RecurrenceInput
}

// OccurrenceAction edits one instance of a recurring event.
type OccurrenceAction struct {
	OriginalStart string
	Action        string // skip | restore | move
	NewStart      *string
	NewEnd        *string
}

// SplitInput closes the series before FromStart and starts a new event with
// the given recurrence from there ("this and future").
type SplitInput struct {
	FromStart  string
	Recurrence models.RecurrenceInput
	Title      *string
	Start      *string
	End        *string
}

type EventService interface {
	Create(userID string, event *models.Event, rec *models.RecurrenceInput) (*models.Event, error)
	GetByID(userID, eventID string) (*models.Event, error)
	ListByUser(userID string) ([]models.Event, error)
	Update(userID, eventID string, update EventUpdate) (*models.Event, error)
	Delete(userID, eventID string) error
	EditOccurrence(userID, eventID string, action OccurrenceAction) (*models.Event, error)
	Split(userID, eventID string, input SplitInput) (*models.Event, error)
}

type eventService struct {
	repo       EventRepository
	recurrence *recurrence.Store
	placement  *placement.Service
	indexer    embed.Indexer
}

func NewEventService(repo EventRepository, recurrenceStore *recurrence.Store, place *placement.Service, indexer embed.Indexer) EventService {
	return &eventService{repo: repo, recurrence: recurrenceStore, placement: place, indexer: indexer}
}

func (s *eventService) Create(userID string, event *models.Event, rec *models.RecurrenceInput) (*models.Event, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	event.Title = strings.TrimSpace(event.Title)
	if event.Title == "" {
		return nil, errors.New("event title cannot be empty")
	}
	if len(event.Title) > maxTitleLength {
		event.Title = event.Title[:maxTitleLength]
	}
	if event.AllDay {
		event.Duration = 0
	} else if event.Duration <= 0 {
		event.Duration = event.DurationMinutes()
	}
	if !event.AllDay {
		event.EndAt = event.StartAt.Add(time.Duration(event.Duration) * time.Minute)
	}
	if !event.EndAt.After(event.StartAt) && !event.AllDay {
		return nil, errors.New("event must end after it starts")
	}
	if event.WorkspaceID != nil && *event.WorkspaceID != "" {
		ok, err := s.repo.WorkspaceBelongsToUser(userID, *event.WorkspaceID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, errors.New("workspace not found")
		}
	} else {
		event.WorkspaceID = nil
	}

	event.ID = utils.NewEventID()
	event.UserID = userID

	created, err := s.repo.Create(event)
	if err != nil {
		return nil, err
	}

	if rec != nil && rec.RRule != "" {
		if rec.Dtstart == "" {
			rec.Dtstart = created.StartAt.Format(time.RFC3339)
		}
		if _, err := s.recurrence.Upsert(models.RecurrenceOwnerEvent, created.ID, userID, *rec); err != nil {
			_ = s.repo.Delete(userID, created.ID)
			return nil, err
		}
		created, err = s.repo.GetByID(userID, created.ID)
		if err != nil {
			return nil, err
		}
	}
	created = inZone(created, event.StartAt.Location())
	if err := s.placement.PlaceEvent(userID, created); err != nil {
		_ = s.repo.Delete(userID, created.ID)
		return nil, err
	}
	created, err = s.repo.GetByID(userID, created.ID)
	if err != nil {
		return nil, err
	}
	s.indexEvent(created)
	return created, nil
}

func (s *eventService) GetByID(userID, eventID string) (*models.Event, error) {
	if userID == "" || eventID == "" {
		return nil, errors.New("invalid request")
	}
	return s.repo.GetByID(userID, eventID)
}

func (s *eventService) ListByUser(userID string) ([]models.Event, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	return s.repo.ListByUser(userID)
}

func (s *eventService) Update(userID, eventID string, update EventUpdate) (*models.Event, error) {
	if userID == "" || eventID == "" {
		return nil, errors.New("invalid request")
	}
	before, err := s.repo.GetByID(userID, eventID)
	if err != nil {
		return nil, err
	}

	updates := map[string]any{}
	if update.Title != nil {
		title := strings.TrimSpace(*update.Title)
		if title == "" {
			return nil, errors.New("event title cannot be empty")
		}
		if len(title) > maxTitleLength {
			title = title[:maxTitleLength]
		}
		updates["title"] = title
	}
	if update.Description != nil {
		updates["description"] = *update.Description
	}
	if update.AllDay != nil {
		updates["all_day"] = *update.AllDay
		if *update.AllDay {
			updates["duration"] = 0
		}
	}
	if update.Duration != nil && (update.AllDay == nil || !*update.AllDay) {
		if *update.Duration <= 0 {
			return nil, errors.New("timed events need a duration greater than 0")
		}
		updates["duration"] = *update.Duration
	}
	if update.Color != nil {
		if *update.Color == "" {
			updates["color"] = nil
		} else {
			updates["color"] = *update.Color
		}
	}
	for column, value := range map[string]*string{
		"project_id": update.ProjectID,
		"task_id":    update.TaskID,
	} {
		if value == nil {
			continue
		}
		if *value == "" {
			updates[column] = nil
		} else {
			updates[column] = *value
		}
	}
	if update.WorkspaceID != nil {
		if *update.WorkspaceID == "" {
			updates["workspace_id"] = nil
		} else {
			ok, err := s.repo.WorkspaceBelongsToUser(userID, *update.WorkspaceID)
			if err != nil {
				return nil, err
			}
			if !ok {
				return nil, errors.New("workspace not found")
			}
			updates["workspace_id"] = *update.WorkspaceID
		}
	}

	start, end := before.StartAt, before.EndAt
	allDay := before.AllDay
	if update.AllDay != nil {
		allDay = *update.AllDay
	}
	duration := before.DurationMinutes()
	if update.Duration != nil && !allDay {
		duration = *update.Duration
	}
	if update.Start != nil {
		parsed, err := recurrence.ParseTime(*update.Start)
		if err != nil {
			return nil, errors.New("invalid start")
		}
		start = parsed
		updates["start_at"] = parsed
	}
	if update.End != nil {
		parsed, err := recurrence.ParseTime(*update.End)
		if err != nil {
			return nil, errors.New("invalid end")
		}
		end = parsed
		updates["end_at"] = parsed
		if !allDay {
			duration = int(end.Sub(start).Minutes())
			if duration <= 0 {
				return nil, errors.New("timed events need a duration greater than 0")
			}
			updates["duration"] = duration
		}
	} else if update.Start != nil || update.Duration != nil {
		if allDay {
			end = start.Add(24 * time.Hour)
		} else {
			end = start.Add(time.Duration(duration) * time.Minute)
		}
		updates["end_at"] = end
	}
	if !allDay && !end.After(start) {
		return nil, errors.New("event must end after it starts")
	}

	if len(updates) > 0 {
		updates["updated_at"] = utils.GetCurrentTimestamp()
		if _, err := s.repo.Update(userID, eventID, updates); err != nil {
			return nil, err
		}
	}

	if update.RecurrenceSet {
		if update.Recurrence == nil || update.Recurrence.RRule == "" {
			if err := s.recurrence.Delete(models.RecurrenceOwnerEvent, eventID); err != nil {
				return nil, err
			}
		} else {
			rec := *update.Recurrence
			if rec.Dtstart == "" {
				rec.Dtstart = start.Format(time.RFC3339)
			}
			if _, err := s.recurrence.Upsert(models.RecurrenceOwnerEvent, eventID, userID, rec); err != nil {
				return nil, err
			}
		}
	} else if before.Recurrence != nil && update.Start != nil {
		// The series start moved with the event; keep the rule anchored to it.
		rec := models.RecurrenceInput{
			RRule:    before.Recurrence.RRule,
			Dtstart:  start.Format(time.RFC3339),
			Timezone: before.Recurrence.Timezone,
		}
		if _, err := s.recurrence.Upsert(models.RecurrenceOwnerEvent, eventID, userID, rec); err != nil {
			return nil, err
		}
	}

	updated, err := s.repo.GetByID(userID, eventID)
	if err != nil {
		return nil, err
	}
	updated = inZone(updated, start.Location())
	if err := s.placement.PlaceEvent(userID, updated); err != nil {
		return nil, err
	}
	updated, err = s.repo.GetByID(userID, eventID)
	if err != nil {
		return nil, err
	}
	s.indexEvent(updated)
	return updated, nil
}

func inZone(event *models.Event, loc *time.Location) *models.Event {
	if event == nil || loc == nil {
		return event
	}
	event.StartAt = event.StartAt.In(loc)
	return event
}

func (s *eventService) Delete(userID, eventID string) error {
	if userID == "" || eventID == "" {
		return errors.New("invalid request")
	}
	if err := s.repo.Delete(userID, eventID); err != nil {
		return err
	}
	if s.indexer != nil {
		s.indexer.Delete(userID, embed.KindEvent, eventID)
	}
	return nil
}

func (s *eventService) EditOccurrence(userID, eventID string, action OccurrenceAction) (*models.Event, error) {
	event, err := s.repo.GetByID(userID, eventID)
	if err != nil {
		return nil, err
	}
	if event.Recurrence == nil {
		return nil, errors.New("event is not recurring")
	}
	originalStart, err := recurrence.ParseTime(action.OriginalStart)
	if err != nil {
		return nil, errors.New("invalid occurrence start")
	}

	patch := recurrence.ExceptionPatch{}
	switch action.Action {
	case "skip":
		cancelled := true
		patch.IsCancelled = &cancelled
	case "restore":
		cancelled := false
		patch.IsCancelled = &cancelled
		patch.ClearMove = true
	case "move":
		if action.NewStart == nil {
			return nil, errors.New("move requires newStart")
		}
		newStart, err := recurrence.ParseTime(*action.NewStart)
		if err != nil {
			return nil, errors.New("invalid newStart")
		}
		newEnd := newStart.Add(time.Duration(event.DurationMinutes()) * time.Minute)
		if action.NewEnd != nil {
			parsed, err := recurrence.ParseTime(*action.NewEnd)
			if err != nil {
				return nil, errors.New("invalid newEnd")
			}
			if !parsed.After(newStart) {
				return nil, errors.New("occurrence must end after it starts")
			}
			newEnd = parsed
		}
		cancelled := false
		patch.IsCancelled = &cancelled
		patch.NewStart = &newStart
		patch.NewEnd = &newEnd
	default:
		return nil, errors.New("unknown occurrence action")
	}

	if _, err := s.recurrence.UpsertException(event.Recurrence, originalStart, patch); err != nil {
		return nil, err
	}
	return s.repo.GetByID(userID, eventID)
}

func (s *eventService) Split(userID, eventID string, input SplitInput) (*models.Event, error) {
	source, err := s.repo.GetByID(userID, eventID)
	if err != nil {
		return nil, err
	}
	if source.Recurrence == nil {
		return nil, errors.New("event is not recurring")
	}
	fromStart, err := recurrence.ParseTime(input.FromStart)
	if err != nil {
		return nil, errors.New("invalid split point")
	}
	if !fromStart.After(source.Recurrence.Dtstart) {
		return nil, errors.New("split point must be after the series start; edit the whole series instead")
	}

	duration := source.EndAt.Sub(source.StartAt)
	newStart := fromStart
	if input.Start != nil {
		parsed, err := recurrence.ParseTime(*input.Start)
		if err != nil {
			return nil, errors.New("invalid start")
		}
		newStart = parsed
	}
	newEnd := newStart.Add(duration)
	if input.End != nil {
		parsed, err := recurrence.ParseTime(*input.End)
		if err != nil {
			return nil, errors.New("invalid end")
		}
		newEnd = parsed
	}
	if !newEnd.After(newStart) {
		return nil, errors.New("event must end after it starts")
	}

	next := &models.Event{
		ID:          utils.NewEventID(),
		Title:       source.Title,
		Description: source.Description,
		StartAt:     newStart,
		EndAt:       newEnd,
		AllDay:      source.AllDay,
		Color:       source.Color,
		UserID:      userID,
		WorkspaceID: source.WorkspaceID,
		ProjectID:   source.ProjectID,
		TaskID:      source.TaskID,
	}
	if input.Title != nil && strings.TrimSpace(*input.Title) != "" {
		next.Title = strings.TrimSpace(*input.Title)
	}

	rec := input.Recurrence
	if rec.RRule == "" {
		rec.RRule = source.Recurrence.RRule
	}
	if rec.Timezone == "" {
		rec.Timezone = source.Recurrence.Timezone
	}
	rec.Dtstart = newStart.Format(time.RFC3339)

	err = s.repo.DB().Transaction(func(tx *gorm.DB) error {
		store := s.recurrence.WithTx(tx)
		if err := store.CloseBefore(source.Recurrence, fromStart); err != nil {
			return err
		}
		if err := tx.Omit("Recurrence").Create(next).Error; err != nil {
			return err
		}
		_, err := store.Upsert(models.RecurrenceOwnerEvent, next.ID, userID, rec)
		return err
	})
	if err != nil {
		return nil, err
	}
	created, err := s.repo.GetByID(userID, next.ID)
	if err != nil {
		return nil, err
	}
	s.indexEvent(created)
	return created, nil
}

func (s *eventService) indexEvent(event *models.Event) {
	if s.indexer != nil {
		s.indexer.IndexEvent(event)
	}
}
