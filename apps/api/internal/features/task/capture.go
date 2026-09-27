package task

import (
	"errors"
	"timely-api/internal/models"
)

var (
	errNotInbox           = errors.New("not an inbox item")
	errClarifyTitleOnly   = errors.New("title-only is capture, not clarify")
	errClarifyUnknownKind = errors.New("clarify kind must be task or reminder")
)

// Capture records a title-only Inbox item. Extra fields are not part of Capture.
func (s *taskService) Capture(userID, name string) (*models.Task, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	t := &models.Task{
		Name:     name,
		UserID:   &userID,
		Kind:     models.KindInbox,
		Duration: 0,
	}
	return s.Create(t, nil, nil)
}

// ClarifyInput is the create-form payload for turning an Inbox item into Work or a Reminder.
type ClarifyInput struct {
	Name              string
	Kind              string
	Duration          int
	Description       string
	DescriptionRich   models.JSONMap
	Deadline          *string
	StartDate         *string
	ScheduledOn       *string
	WorkspaceID       *string
	ProjectID         *string
	StatusID          *string
	StageID           *string
	PriorityLevel     *string
	LabelIDs          models.LabelInputs
	CustomFieldValues []*models.CustomFieldValue
	Recurrence        *models.RecurrenceInput
}

// Clarify replaces an Inbox item with new Work or a new Reminder. The Inbox item is then gone.
func (s *taskService) Clarify(userID, inboxID string, in ClarifyInput) (*models.Task, error) {
	inbox, err := s.GetForUser(userID, inboxID)
	if err != nil {
		return nil, err
	}
	if !inbox.IsInbox() {
		return nil, errNotInbox
	}

	kind, err := models.NormalizeKind(in.Kind)
	if err != nil || (kind != models.KindTask && kind != models.KindReminder) {
		return nil, errClarifyUnknownKind
	}
	if kind == models.KindTask && in.Duration <= 0 {
		return nil, errClarifyTitleOnly
	}

	name := in.Name
	if name == "" {
		name = inbox.Name
	}
	created, err := s.Create(&models.Task{
		Name:            name,
		Description:     in.Description,
		DescriptionRich: in.DescriptionRich,
		Duration:        in.Duration,
		Deadline:        in.Deadline,
		StartDate:       in.StartDate,
		ScheduledOn:     in.ScheduledOn,
		UserID:          &userID,
		WorkspaceID:     in.WorkspaceID,
		ProjectID:       in.ProjectID,
		StatusID:        in.StatusID,
		StageID:         in.StageID,
		PriorityLevel:   in.PriorityLevel,
		Kind:            kind,
		LabelIDs:        in.LabelIDs,
	}, in.CustomFieldValues, in.Recurrence)
	if err != nil {
		return nil, err
	}
	if err := s.Delete(userID, inbox.ID); err != nil {
		_ = s.Delete(userID, created.ID)
		return nil, err
	}
	return created, nil
}
