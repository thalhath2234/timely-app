package task

import (
	"timely-api/internal/models"

	"gorm.io/gorm"
)

type TaskRepository interface {
	CreateTask(task *models.Task, customFieldValues []*models.CustomFieldValue) (*models.Task, error)
	GetLabelsByIds(workspaceID string, labelIDs []string) ([]*models.Lable, error)
	GetAllTaskByUser(userID string) ([]models.Task, error)
	GetTaskById(taskId string) (*models.Task, error)
}

type taskRepository struct {
	db *gorm.DB
}

func NewTaskRepository(db *gorm.DB) TaskRepository {
	return &taskRepository{db: db}
}

func (r *taskRepository) CreateTask(task *models.Task, customFieldValues []*models.CustomFieldValue) (*models.Task, error) {
	if task.StatusID == nil {
		var status models.Status

		err := r.db.
			Where("workspace_id = ?", *task.WorkspaceID).
			Where("is_default = ?", true).
			First(&status).Error
		if err != nil {
			return nil, err
		}

		task.StatusID = &status.ID
	}

	if task.PriorityLevel == nil || *task.PriorityLevel == "" {
		priorityLevel := "Low"
		task.PriorityLevel = &priorityLevel
	}

	tx := r.db.Begin()

	if err := tx.Create(task).Error; err != nil {
		tx.Rollback()
		return nil, err
	}

	for _, cfv := range customFieldValues {
		cfv.TaskID = task.ID
		if err := tx.Omit("ProjectID").Create(cfv).Error; err != nil {
			tx.Rollback()
			return nil, err
		}
	}

	if err := tx.Commit().Error; err != nil {
		return nil, err
	}

	createdTask, err := r.GetTaskById(task.ID)
	if err != nil {
		return nil, err
	}

	return createdTask, nil
}

func (r *taskRepository) GetLabelsByIds(workspaceID string, labelIDs []string) ([]*models.Lable, error) {
	if len(labelIDs) == 0 {
		return nil, nil
	}

	var labels []*models.Lable
	if err := r.db.
		Where("workspace_id = ? AND id IN ?", workspaceID, labelIDs).
		Find(&labels).Error; err != nil {
		return nil, err
	}

	return labels, nil
}

func (r *taskRepository) loadLabelsForTasks(workspaceID string, tasks []models.Task) error {
	if len(tasks) == 0 {
		return nil
	}

	labelIDsSet := make(map[string]struct{})
	for _, task := range tasks {
		for _, label := range task.LabelIDs {
			if label.Id != "" {
				labelIDsSet[label.Id] = struct{}{}
			}
		}
	}

	if len(labelIDsSet) == 0 {
		return nil
	}

	labelIDs := make([]string, 0, len(labelIDsSet))
	for id := range labelIDsSet {
		labelIDs = append(labelIDs, id)
	}

	labels, err := r.GetLabelsByIds(workspaceID, labelIDs)
	if err != nil {
		return err
	}

	labelMap := make(map[string]*models.Lable, len(labels))
	for _, label := range labels {
		labelMap[label.ID] = label
	}

	for index := range tasks {
		for _, label := range tasks[index].LabelIDs {
			if l, ok := labelMap[label.Id]; ok {
				tasks[index].Labels = append(tasks[index].Labels, l)
			}
		}
	}

	return nil
}

func (r *taskRepository) loadLabelsForTask(workspaceID *string, task *models.Task) error {
	if task == nil || workspaceID == nil || len(task.LabelIDs) == 0 {
		return nil
	}

	labelIDs := make([]string, 0, len(task.LabelIDs))
	for _, label := range task.LabelIDs {
		if label.Id != "" {
			labelIDs = append(labelIDs, label.Id)
		}
	}

	if len(labelIDs) == 0 {
		return nil
	}

	labels, err := r.GetLabelsByIds(*workspaceID, labelIDs)
	if err != nil {
		return err
	}

	labelMap := make(map[string]*models.Lable, len(labels))
	for _, label := range labels {
		labelMap[label.ID] = label
	}

	for _, label := range task.LabelIDs {
		if l, ok := labelMap[label.Id]; ok {
			task.Labels = append(task.Labels, l)
		}
	}

	return nil
}

func (r *taskRepository) enrichCustomFieldValuesForTasks(tasks []models.Task) {
	for i := range tasks {
		r.enrichCustomFieldValuesForTask(&tasks[i])
	}
}

func (r *taskRepository) enrichCustomFieldValuesForTask(task *models.Task) {
	if task == nil || len(task.CustomFieldValues) == 0 {
		return
	}

	for _, cfv := range task.CustomFieldValues {
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

func (r *taskRepository) GetAllTaskByUser(userId string) ([]models.Task, error) {
	var tasks []models.Task

	err := r.db.
		Where("user_id = ?", userId).
		Preload("Project").
		Preload("Status").
		Preload("Workspace").
		Preload("Schedule").
		Preload("Stage").
		Preload("BlockedBy", func(db *gorm.DB) *gorm.DB {
			return db.Select("id, name")
		}).
		Preload("CustomFieldValues.CustomField").
		Find(&tasks).Error

	if err != nil {
		return nil, err
	}

	for index := range tasks {
		if tasks[index].WorkspaceID != nil {
			if err := r.loadLabelsForTask(tasks[index].WorkspaceID, &tasks[index]); err != nil {
				return nil, err
			}
		}
	}

	r.enrichCustomFieldValuesForTasks(tasks)

	return tasks, nil
}

func (r *taskRepository) GetTaskById(taskId string) (*models.Task, error) {
	var task models.Task

	err := r.db.
		Where("id = ?", taskId).
		Preload("Project").
		Preload("Status").
		Preload("Workspace").
		Preload("Schedule").
		Preload("Stage").
		Preload("BlockedBy", func(db *gorm.DB) *gorm.DB {
			return db.Select("id, name")
		}).
		Preload("CustomFieldValues.CustomField").
		First(&task).Error
	if err != nil {
		return nil, err
	}

	if task.WorkspaceID != nil {
		if err := r.loadLabelsForTask(task.WorkspaceID, &task); err != nil {
			return nil, err
		}
	}

	r.enrichCustomFieldValuesForTask(&task)

	return &task, nil
}
