package doc

import (
	"errors"
	"time"
	"timely-api/internal/models"
)

// DailyNotesTitle is the page daily notes are filed under, made on first use.
const DailyNotesTitle = "Daily notes"

// DailyRequest asks for the daily note of Date (YYYY-MM-DD, the user's own
// day). Title, Content and PlainText are only used when it is created.
type DailyRequest struct {
	Date        string          `json:"date"`
	Title       string          `json:"title"`
	Content     *models.JSONMap `json:"content"`
	PlainText   string          `json:"plainText"`
	WorkspaceID string          `json:"workspaceId"`
}

func (s *documentService) Daily(userID string, request DailyRequest) (*models.Document, bool, error) {
	if _, err := time.Parse("2006-01-02", request.Date); err != nil {
		return nil, false, errors.New("date must look like 2026-10-08")
	}
	if existing, err := s.repo.FindDaily(userID, request.Date); err == nil {
		return existing, false, nil
	}
	workspaceID := request.WorkspaceID
	if workspaceID == "" {
		id, err := s.repo.DefaultWorkspaceID(userID)
		if err != nil {
			return nil, false, errors.New("no workspace available for this user")
		}
		workspaceID = id
	}
	parent, err := s.repo.FindTopLevelByTitle(userID, workspaceID, DailyNotesTitle)
	if err != nil {
		icon := "📅"
		parent, err = s.Create(&models.Document{Title: DailyNotesTitle, Icon: &icon, UserID: userID, WorkspaceID: workspaceID})
		if err != nil {
			return nil, false, err
		}
	}
	title := request.Title
	if title == "" {
		title = request.Date
	}
	date := request.Date
	document := &models.Document{
		Title: title, PlainText: request.PlainText, UserID: userID, WorkspaceID: workspaceID,
		ParentID: &parent.ID, DailyDate: &date,
	}
	if request.Content != nil {
		document.Content = *request.Content
	}
	created, err := s.Create(document)
	if err != nil {
		// Two devices opening today's note at once: the other one won.
		if existing, findErr := s.repo.FindDaily(userID, request.Date); findErr == nil {
			return existing, false, nil
		}
		return nil, false, err
	}
	return created, true, nil
}
