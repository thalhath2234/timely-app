package project

import (
	"timely-api/internal/models"

	"gorm.io/gorm"
)

type ProjectRepository interface {
	CreateProject(project *models.Project, customFieldValues []*models.CustomFieldValue) (*models.Project, error)
	GetAllProjectByUser(workspaceID string) ([]models.Project, error)
	GetProjectById(projectId string) (*models.Project, error)
	GetStageById(projectID string, stageID string) (*models.Stage, error)
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

func (r *projectRepository) GetAllProjectByUser(workspaceID string) ([]models.Project, error) {
	var projects []models.Project

	err := r.db.
		Where("workspace_id = ?", workspaceID).
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
