package project

import (
	"timely-api/internal/models"

	"gorm.io/gorm"
)

type ProjectRepository interface {
	CreateProject(project *models.Project, customFieldValues []*models.CustomFieldValue) (*models.Project, error)
	GetAllProjectByUser(userID string) ([]models.Project, error)
	GetProjectById(projectId string) (*models.Project, error)
	GetProjectByIdForUser(userID string, projectID string) (*models.Project, error)
	UpdateProject(userID string, projectID string, updates map[string]any) (*models.Project, error)
	DeleteProject(userID string, projectID string) error
	GetStageById(projectID string, stageID string) (*models.Stage, error)
	CreateStage(stage *models.Stage) (*models.Stage, error)
	UpdateStage(stage *models.Stage) (*models.Stage, error)
	DeleteStage(projectID, stageID string) error
	ReorderStages(projectID string, ids []string) error
	NextStageOrder(projectID string) (int, error)
}

type projectRepository struct {
	db *gorm.DB
}

func NewProjectRepository(db *gorm.DB) ProjectRepository {
	return &projectRepository{db: db}
}

func (r *projectRepository) CreateProject(project *models.Project, customFieldValues []*models.CustomFieldValue) (*models.Project, error) {
	if project.StatusID == nil {
		var status models.Status

		err := r.db.
			Where("workspace_id = ?", *project.WorkspaceID).
			Where("is_default = ?", true).
			First(&status).Error
		if err != nil {
			return nil, err
		}

		project.StatusID = &status.ID
	}

	if project.PriorityLevel == nil || *project.PriorityLevel == "" {
		priorityLevel := "Low"
		project.PriorityLevel = &priorityLevel
	}

	tx := r.db.Begin()

	if err := tx.Create(project).Error; err != nil {
		tx.Rollback()
		return nil, err
	}

	for _, cfv := range customFieldValues {
		cfv.ProjectID = project.ID
		if err := tx.Omit("TaskID").Create(cfv).Error; err != nil {
			tx.Rollback()
			return nil, err
		}
	}

	if err := tx.Commit().Error; err != nil {
		return nil, err
	}

	createdProject, err := r.GetProjectById(project.ID)
	if err != nil {
		return nil, err
	}

	return createdProject, nil

}

func (r *projectRepository) GetAllProjectByUser(userID string) ([]models.Project, error) {
	var projects []models.Project

	err := r.db.
		Joins("JOIN workspaces ON workspaces.id = projects.workspace_id").
		Where("workspaces.user_id = ?", userID).
		Preload("Stages").
		Preload("Tasks").
		Preload("Workspace").
		Preload("CustomFieldValues.CustomField").
		Find(&projects).Error

	if err != nil {
		return nil, err
	}

	r.enrichCustomFieldValuesForProjects(projects)

	return projects, nil
}

func (r *projectRepository) GetProjectById(projectId string) (*models.Project, error) {
	var project models.Project

	err := r.db.
		Where("id = ?", projectId).
		Preload("Stages").
		Preload("Stages.Tasks").
		Preload("Tasks", "stage_id IS NULL").
		Preload("Workspace").
		Preload("CustomFieldValues.CustomField").
		First(&project).Error
	if err != nil {
		return nil, err
	}

	r.enrichCustomFieldValuesForProject(&project)

	return &project, nil
}

// Projects have no user column of their own, so ownership is proven through
// the workspace they belong to.
func (r *projectRepository) GetProjectByIdForUser(userID string, projectID string) (*models.Project, error) {
	var project models.Project

	err := r.db.
		Joins("JOIN workspaces ON workspaces.id = projects.workspace_id").
		Where("projects.id = ?", projectID).
		Where("workspaces.user_id = ?", userID).
		Preload("Stages").
		Preload("Workspace").
		Preload("CustomFieldValues.CustomField").
		First(&project).Error
	if err != nil {
		return nil, err
	}

	r.enrichCustomFieldValuesForProject(&project)

	return &project, nil
}

func (r *projectRepository) UpdateProject(userID string, projectID string, updates map[string]any) (*models.Project, error) {
	if _, err := r.GetProjectByIdForUser(userID, projectID); err != nil {
		return nil, err
	}

	jsonCols := takeJSONB(updates, "description_rich")

	if len(updates) > 0 {
		err := r.db.
			Model(&models.Project{}).
			Where("id = ?", projectID).
			Updates(updates).Error
		if err != nil {
			return nil, err
		}
	}

	if err := models.WriteJSONB(r.db, "projects", jsonCols, "id = ?", projectID); err != nil {
		return nil, err
	}

	return r.GetProjectById(projectID)
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

func (r *projectRepository) DeleteProject(userID string, projectID string) error {
	if _, err := r.GetProjectByIdForUser(userID, projectID); err != nil {
		return err
	}
	return r.db.Where("id = ?", projectID).Delete(&models.Project{}).Error
}

func (r *projectRepository) CreateStage(stage *models.Stage) (*models.Stage, error) {
	if err := r.db.Create(stage).Error; err != nil {
		return nil, err
	}
	return stage, nil
}

func (r *projectRepository) UpdateStage(stage *models.Stage) (*models.Stage, error) {
	if err := r.db.Model(&models.Stage{}).
		Where("id = ? AND project_id = ?", stage.ID, stage.ProjectID).
		Updates(map[string]any{
			"name":       stage.Name,
			"order":      stage.Order,
			"updated_at": stage.UpdatedAt,
		}).Error; err != nil {
		return nil, err
	}
	return r.GetStageById(*stage.ProjectID, stage.ID)
}

func (r *projectRepository) DeleteStage(projectID, stageID string) error {
	return r.db.Where("id = ? AND project_id = ?", stageID, projectID).Delete(&models.Stage{}).Error
}

func (r *projectRepository) ReorderStages(projectID string, ids []string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		for i, id := range ids {
			if err := tx.Model(&models.Stage{}).
				Where("id = ? AND project_id = ?", id, projectID).
				Update("order", i).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *projectRepository) NextStageOrder(projectID string) (int, error) {
	var max *int
	err := r.db.Model(&models.Stage{}).
		Where("project_id = ?", projectID).
		Select("MAX(\"order\")").
		Scan(&max).Error
	if err != nil {
		return 0, err
	}
	if max == nil {
		return 0, nil
	}
	return *max + 1, nil
}

func (r *projectRepository) GetStageById(projectID string, stageID string) (*models.Stage, error) {
	var stage models.Stage

	err := r.db.
		Where("project_id = ?", projectID).
		Where("id = ?", stageID).
		First(&stage).Error
	if err != nil {
		return nil, err
	}
	return &stage, nil
}

func (r *projectRepository) enrichCustomFieldValuesForProjects(projects []models.Project) {
	for i := range projects {
		r.enrichCustomFieldValuesForProject(&projects[i])
	}
}

func (r *projectRepository) enrichCustomFieldValuesForProject(project *models.Project) {
	if project == nil || len(project.CustomFieldValues) == 0 {
		return
	}

	for _, cfv := range project.CustomFieldValues {
		if cfv.CustomField != nil {
			cfv.Name = cfv.CustomField.Name

			if len(cfv.OptionsValue) > 0 && len(cfv.CustomField.Options.Options) > 0 {
				optMap := make(map[string]models.Option, len(cfv.CustomField.Options.Options))
				for _, o := range cfv.CustomField.Options.Options {
					optMap[o.ID] = o
				}

				cfv.OptionValue = make([]models.Option, 0, len(cfv.OptionsValue))
				for _, v := range cfv.OptionsValue {
					if opt, ok := optMap[v.Id]; ok {
						cfv.OptionValue = append(cfv.OptionValue, opt)
					}
				}
			}
		}
	}
}
