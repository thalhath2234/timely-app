package doc

import (
	"timely-api/internal/models"

	"gorm.io/gorm"
)

type DocumentRepository interface {
	CreateDocument(document *models.Document) (*models.Document, error)
	GetAllDocumentsByUser(userID string) ([]models.Document, error)
	ListDocuments(userID string, filter DocumentFilter) ([]models.Document, error)
	GetDocumentByID(userID string, documentID string) (*models.Document, error)
	UpdateDocument(userID string, documentID string, updates map[string]any) (*models.Document, error)
	DeleteDocument(userID string, documentID string) error
	WorkspaceBelongsToUser(userID string, workspaceID string) (bool, error)
	ProjectBelongsToUser(userID string, projectID string) (bool, error)
	DefaultWorkspaceID(userID string) (string, error)
}

type documentRepository struct {
	db *gorm.DB
}

func NewDocumentRepository(db *gorm.DB) DocumentRepository {
	return &documentRepository{db: db}
}

func (r *documentRepository) CreateDocument(document *models.Document) (*models.Document, error) {
	if err := r.db.Create(document).Error; err != nil {
		return nil, err
	}

	return r.GetDocumentByID(document.UserID, document.ID)
}

func (r *documentRepository) GetAllDocumentsByUser(userID string) ([]models.Document, error) {
	var documents []models.Document

	err := r.db.
		Where("user_id = ?", userID).
		Order("updated_at DESC").
		Find(&documents).Error
	if err != nil {
		return nil, err
	}

	return documents, nil
}

func (r *documentRepository) ListDocuments(userID string, filter DocumentFilter) ([]models.Document, error) {
	query := r.db.Where("user_id = ?", userID)
	if filter.WorkspaceID != "" {
		query = query.Where("workspace_id = ?", filter.WorkspaceID)
	}
	if filter.ProjectID != "" {
		query = query.Where("project_id = ?", filter.ProjectID)
	}
	if filter.ParentID != nil {
		if *filter.ParentID == "" {
			query = query.Where("parent_id IS NULL")
		} else {
			query = query.Where("parent_id = ?", *filter.ParentID)
		}
	}
	if filter.Archived != nil {
		if *filter.Archived {
			query = query.Where("archived_at IS NOT NULL")
		} else {
			query = query.Where("archived_at IS NULL")
		}
	}
	if filter.Favorite != nil {
		query = query.Where("is_favorite = ?", *filter.Favorite)
	}
	if filter.Text != "" {
		like := "%" + filter.Text + "%"
		query = query.Where("title ILIKE ? OR plain_text ILIKE ?", like, like)
	}

	var documents []models.Document
	err := query.Order("updated_at DESC").Find(&documents).Error
	if err != nil {
		return nil, err
	}
	if documents == nil {
		documents = []models.Document{}
	}
	return documents, nil
}

func (r *documentRepository) GetDocumentByID(userID string, documentID string) (*models.Document, error) {
	var document models.Document

	err := r.db.
		Where("id = ?", documentID).
		Where("user_id = ?", userID).
		First(&document).Error
	if err != nil {
		return nil, err
	}

	return &document, nil
}

func (r *documentRepository) UpdateDocument(userID string, documentID string, updates map[string]any) (*models.Document, error) {
	document, err := r.GetDocumentByID(userID, documentID)
	if err != nil {
		return nil, err
	}

	jsonCols := takeJSONB(updates, "content")

	if len(updates) > 0 {
		if err := r.db.Model(document).Updates(updates).Error; err != nil {
			return nil, err
		}
	}

	if err := models.WriteJSONB(r.db, "documents", jsonCols, "id = ? AND user_id = ?", documentID, userID); err != nil {
		return nil, err
	}

	return r.GetDocumentByID(userID, documentID)
}

func takeJSONB(updates map[string]any, columns ...string) map[string]any {
	out := map[string]any{}
	for _, column := range columns {
		if value, ok := updates[column]; ok {
			delete(updates, column)
			out[column] = value
		}
	}
	return out
}

func (r *documentRepository) DeleteDocument(userID string, documentID string) error {
	return r.db.
		Where("id = ?", documentID).
		Where("user_id = ?", userID).
		Delete(&models.Document{}).Error
}

func (r *documentRepository) WorkspaceBelongsToUser(userID string, workspaceID string) (bool, error) {
	var count int64

	err := r.db.
		Model(&models.Workspace{}).
		Where("id = ?", workspaceID).
		Where("user_id = ?", userID).
		Count(&count).Error
	if err != nil {
		return false, err
	}

	return count > 0, nil
}

// Projects have no user column, so ownership goes through their workspace.
func (r *documentRepository) ProjectBelongsToUser(userID string, projectID string) (bool, error) {
	var count int64

	err := r.db.
		Model(&models.Project{}).
		Joins("JOIN workspaces ON workspaces.id = projects.workspace_id").
		Where("projects.id = ?", projectID).
		Where("workspaces.user_id = ?", userID).
		Count(&count).Error
	if err != nil {
		return false, err
	}

	return count > 0, nil
}

func (r *documentRepository) DefaultWorkspaceID(userID string) (string, error) {
	var workspace models.Workspace

	err := r.db.
		Where("user_id = ?", userID).
		Order("created_at ASC").
		First(&workspace).Error
	if err != nil {
		return "", err
	}

	return workspace.ID, nil
}
