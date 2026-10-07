package doc

import (
	"errors"
	"strings"
	"timely-api/internal/features/embed"
	"timely-api/internal/models"
	"timely-api/internal/realtime"
	"timely-api/internal/utils"
)

const (
	maxTitleLength     = 200
	maxPlainTextLength = 500000
)

// DocumentUpdate carries only the fields a client is allowed to change. Nil
// means "leave untouched", which lets autosave send partial payloads.
type DocumentUpdate struct {
	Title      *string
	Icon       *string
	Content    *models.JSONMap
	PlainText  *string
	ParentID   *string
	ProjectID  *string
	IsFavorite *bool
	Archived   *bool
	Order      *int
}

type DocumentFilter struct {
	WorkspaceID string
	ProjectID   string
	ParentID    *string
	Archived    *bool
	Favorite    *bool
	Text        string
}

type DocumentService interface {
	Create(document *models.Document) (*models.Document, error)
	GetAllByUser(userID string) ([]models.Document, error)
	List(userID string, filter DocumentFilter) ([]models.Document, error)
	GetByID(userID string, documentID string) (*models.Document, error)
	Update(userID string, documentID string, update DocumentUpdate) (*models.Document, error)
	Delete(userID string, documentID string) error
}

type documentService struct {
	repo    DocumentRepository
	indexer embed.Indexer
	live    *realtime.Hub
}

func NewDocumentService(repo DocumentRepository, indexer embed.Indexer, live *realtime.Hub) DocumentService {
	return &documentService{repo: repo, indexer: indexer, live: live}
}

func (s *documentService) Create(document *models.Document) (*models.Document, error) {
	if document.UserID == "" {
		return nil, errors.New("user not authenticated")
	}

	document.Title = normalizeTitle(document.Title)

	if document.WorkspaceID == "" {
		workspaceID, err := s.repo.DefaultWorkspaceID(document.UserID)
		if err != nil {
			return nil, errors.New("no workspace available for this user")
		}
		document.WorkspaceID = workspaceID
	} else {
		owned, err := s.repo.WorkspaceBelongsToUser(document.UserID, document.WorkspaceID)
		if err != nil {
			return nil, err
		}
		if !owned {
			return nil, errors.New("workspace not found")
		}
	}
	if document.ProjectID != nil && *document.ProjectID != "" {
		if err := s.assertProject(document.UserID, *document.ProjectID); err != nil {
			return nil, err
		}
	}

	if document.ParentID != nil {
		if _, err := s.repo.GetDocumentByID(document.UserID, *document.ParentID); err != nil {
			return nil, errors.New("parent document not found")
		}
	}

	if len(document.Content) == 0 {
		document.Content = models.EmptyDocumentContent()
	} else {
		document.Content = models.NormalizeDocumentContent(document.Content)
	}

	document.ID = utils.NewDocumentID()

	created, err := s.repo.CreateDocument(document)
	if err != nil {
		return nil, err
	}
	s.indexDoc(created)
	return created, nil
}

func (s *documentService) GetAllByUser(userID string) ([]models.Document, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}

	return s.repo.GetAllDocumentsByUser(userID)
}

func (s *documentService) List(userID string, filter DocumentFilter) ([]models.Document, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	return s.repo.ListDocuments(userID, filter)
}

func (s *documentService) GetByID(userID string, documentID string) (*models.Document, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	if documentID == "" {
		return nil, errors.New("invalid document id")
	}

	return s.repo.GetDocumentByID(userID, documentID)
}

func (s *documentService) Update(userID string, documentID string, update DocumentUpdate) (*models.Document, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	if documentID == "" {
		return nil, errors.New("invalid document id")
	}

	updates := map[string]any{}

	if update.Title != nil {
		updates["title"] = normalizeTitle(*update.Title)
	}
	if update.Icon != nil {
		updates["icon"] = *update.Icon
	}
	if update.Content != nil {
		content := models.NormalizeDocumentContent(*update.Content)
		if update.PlainText != nil && strings.TrimSpace(*update.PlainText) != "" && models.IsDocumentContentEmpty(content) {
			content = models.DocumentFromPlainText(*update.PlainText)
		}
		encoded, err := models.MarshalJSONMap(content)
		if err != nil {
			return nil, err
		}
		// Store pre-marshaled bytes. GORM Updates(map) can drop a raw JSONMap
		// on jsonb columns, which made web "Saved" a no-op for the body.
		updates["content"] = encoded
	}
	if update.PlainText != nil {
		text := *update.PlainText
		if len(text) > maxPlainTextLength {
			text = text[:maxPlainTextLength]
		}
		updates["plain_text"] = text
	}
	if update.ProjectID != nil {
		if *update.ProjectID == "" {
			updates["project_id"] = nil
		} else {
			if err := s.assertProject(userID, *update.ProjectID); err != nil {
				return nil, err
			}
			updates["project_id"] = *update.ProjectID
		}
	}
	if update.IsFavorite != nil {
		updates["is_favorite"] = *update.IsFavorite
	}
	if update.Order != nil {
		updates["order"] = *update.Order
	}
	if update.Archived != nil {
		if *update.Archived {
			updates["archived_at"] = utils.GetCurrentTimestamp()
		} else {
			updates["archived_at"] = nil
		}
	}

	if update.ParentID != nil {
		parentID := *update.ParentID
		switch {
		case parentID == "":
			updates["parent_id"] = nil
		case parentID == documentID:
			return nil, errors.New("a document cannot be its own parent")
		default:
			if err := s.assertNoCycle(userID, documentID, parentID); err != nil {
				return nil, err
			}
			updates["parent_id"] = parentID
		}
	}

	if len(updates) > 0 {
		updates["updated_at"] = utils.GetCurrentTimestamp()
	}

	doc, err := s.repo.UpdateDocument(userID, documentID, updates)
	if err != nil {
		return nil, err
	}
	s.indexDoc(doc)
	s.publish(doc.UserID, doc.ID, realtime.Event{
		Type:      "updated",
		Kind:      "doc",
		ID:        doc.ID,
		UpdatedAt: doc.UpdatedAt,
		Document:  doc,
	})
	return doc, nil
}

func (s *documentService) Delete(userID string, documentID string) error {
	if userID == "" {
		return errors.New("user not authenticated")
	}
	if documentID == "" {
		return errors.New("invalid document id")
	}

	if _, err := s.repo.GetDocumentByID(userID, documentID); err != nil {
		return err
	}

	if err := s.repo.DeleteDocument(userID, documentID); err != nil {
		return err
	}
	if s.indexer != nil {
		s.indexer.Delete(userID, embed.KindDoc, documentID)
	}
	s.publish(userID, documentID, realtime.Event{
		Type: "deleted",
		Kind: "doc",
		ID:   documentID,
	})
	return nil
}

func (s *documentService) publish(userID, documentID string, event realtime.Event) {
	if s.live != nil {
		s.live.Publish(userID, documentID, event)
	}
}

// assertNoCycle walks up from the proposed parent to make sure the document
// being moved is not already an ancestor of it.
func (s *documentService) assertNoCycle(userID string, documentID string, parentID string) error {
	currentID := parentID

	for depth := 0; currentID != "" && depth < 100; depth++ {
		if currentID == documentID {
			return errors.New("cannot move a document inside one of its own children")
		}

		parent, err := s.repo.GetDocumentByID(userID, currentID)
		if err != nil {
			return errors.New("parent document not found")
		}

		if parent.ParentID == nil {
			return nil
		}
		currentID = *parent.ParentID
	}

	return nil
}

func (s *documentService) indexDoc(doc *models.Document) {
	if s.indexer != nil {
		s.indexer.IndexDoc(doc)
	}
}

func normalizeTitle(title string) string {
	trimmed := strings.TrimSpace(title)
	if trimmed == "" {
		return "Untitled"
	}
	if len(trimmed) > maxTitleLength {
		return trimmed[:maxTitleLength]
	}
	return trimmed
}

// assertProject rejects a project the user does not own, so a document cannot be
// linked to (and preload) another account's project.
func (s *documentService) assertProject(userID, projectID string) error {
	owned, err := s.repo.ProjectBelongsToUser(userID, projectID)
	if err != nil {
		return err
	}
	if !owned {
		return errors.New("project not found")
	}
	return nil
}
