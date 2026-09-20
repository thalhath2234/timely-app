package task

import (
	"encoding/json"
	"errors"
	"strings"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

type TaskRepository interface {
	CreateTask(task *models.Task, customFieldValues []*models.CustomFieldValue) (*models.Task, error)
	GetLabelsByIds(workspaceID string, labelIDs []string) ([]*models.Lable, error)
	GetAllTaskByUser(userID string) ([]models.Task, error)
	GetTaskById(taskId string) (*models.Task, error)
	GetTaskByIdForUser(userID string, taskID string) (*models.Task, error)
	UpdateTask(userID string, taskID string, updates map[string]any) (*models.Task, error)
	GetCustomFieldsByIDs(workspaceID string, fieldIDs []string) ([]models.CustomField, error)
	GetWorkspaceStatuses(workspaceID string) ([]models.Status, error)
	ReplaceCustomFieldValues(taskID string, values []*models.CustomFieldValue) error
	CreateActivities(entries []models.TaskActivity) error
	ListActivities(userID string, taskID string) ([]models.TaskActivity, error)
	ActorName(userID string) string
	DeleteTask(userID, taskID string) error
	DB() *gorm.DB
}

type taskRepository struct {
	db *gorm.DB
}

func NewTaskRepository(db *gorm.DB) TaskRepository {
	return &taskRepository{db: db}
}

func (r *taskRepository) DB() *gorm.DB {
	return r.db
}

func (r *taskRepository) CreateTask(task *models.Task, customFieldValues []*models.CustomFieldValue) (*models.Task, error) {
	if task.Kind == "" {
		task.Kind = models.KindTask
	}
	if task.Checklist == nil {
		task.Checklist = models.Checklist{}
	}
	if task.StatusID == nil && task.WorkspaceID != nil {
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
		priorityLevel := models.PriorityLow
		task.PriorityLevel = &priorityLevel
	} else {
		normalized := models.NormalizePriority(*task.PriorityLevel)
		task.PriorityLevel = &normalized
	}

	tx := r.db.Begin()

	if err := tx.Omit("Recurrence", "Blocks").Create(task).Error; err != nil {
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
			cfv.EnrichDerived()

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

	err := r.withTaskRelations().
		Where("user_id = ?", userId).
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

func (r *taskRepository) withTaskRelations() *gorm.DB {
	return r.db.
		Preload("Project").
		Preload("Status").
		Preload("Workspace").
		Preload("Schedule").
		Preload("Stage").
		Preload("BlockedBy", func(db *gorm.DB) *gorm.DB {
			return db.Select("id, name")
		}).
		Preload("CustomFieldValues.CustomField").
		Preload("Recurrence.Exceptions").
		Preload("Blocks", func(db *gorm.DB) *gorm.DB {
			return db.Order("scheduled_blocks.start_at ASC")
		})
}

func (r *taskRepository) findTask(query *gorm.DB) (*models.Task, error) {
	var task models.Task

	if err := query.First(&task).Error; err != nil {
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

func (r *taskRepository) GetTaskById(taskId string) (*models.Task, error) {
	return r.findTask(r.withTaskRelations().Where("id = ?", taskId))
}

func (r *taskRepository) GetTaskByIdForUser(userID string, taskID string) (*models.Task, error) {
	return r.findTask(
		r.withTaskRelations().Where("id = ?", taskID).Where("user_id = ?", userID),
	)
}

func (r *taskRepository) UpdateTask(userID string, taskID string, updates map[string]any) (*models.Task, error) {
	if _, err := r.GetTaskByIdForUser(userID, taskID); err != nil {
		return nil, err
	}

	labelRaw, hasLabels := updates["label_ids"]
	if hasLabels {
		delete(updates, "label_ids")
	}
	jsonCols := takeJSONB(updates, "description_rich")

	if len(updates) > 0 {
		err := r.db.
			Model(&models.Task{}).
			Where("id = ?", taskID).
			Where("user_id = ?", userID).
			Updates(updates).Error
		if err != nil {
			return nil, err
		}
	}

	if hasLabels {
		labelInputs, ok := labelRaw.(models.LabelInputs)
		if !ok {
			return nil, errors.New("invalid label_ids payload")
		}
		if labelInputs == nil {
			labelInputs = models.LabelInputs{}
		}
		jsonCols["label_ids"] = labelInputs
	}

	if err := models.WriteJSONB(r.db, "tasks", jsonCols, "id = ? AND user_id = ?", taskID, userID); err != nil {
		return nil, err
	}

	return r.GetTaskByIdForUser(userID, taskID)
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

func (r *taskRepository) GetCustomFieldsByIDs(workspaceID string, fieldIDs []string) ([]models.CustomField, error) {
	if len(fieldIDs) == 0 {
		return nil, nil
	}

	var fields []models.CustomField
	if err := r.db.
		Where("workspace_id = ? AND id IN ?", workspaceID, fieldIDs).
		Find(&fields).Error; err != nil {
		return nil, err
	}

	return fields, nil
}

func (r *taskRepository) GetWorkspaceStatuses(workspaceID string) ([]models.Status, error) {
	var statuses []models.Status
	if err := r.db.Where("workspace_id = ?", workspaceID).Find(&statuses).Error; err != nil {
		return nil, err
	}
	return statuses, nil
}

func customFieldValueIsBlank(value *models.CustomFieldValue) bool {
	if len(value.OptionsValue) > 0 {
		return false
	}
	return value.StringValue == nil || strings.TrimSpace(*value.StringValue) == ""
}

// ReplaceCustomFieldValues upserts the value of every field passed and drops the
// row of the ones that arrive blank, so a cleared field reads back as unset.
func (r *taskRepository) ReplaceCustomFieldValues(taskID string, values []*models.CustomFieldValue) error {
	if len(values) == 0 {
		return nil
	}

	return r.db.Transaction(func(tx *gorm.DB) error {
		var existing []models.CustomFieldValue
		if err := tx.Where("task_id = ?", taskID).Find(&existing).Error; err != nil {
			return err
		}

		rowIDs := make(map[string]string, len(existing))
		for _, row := range existing {
			rowIDs[row.CustomFieldID] = row.ID
		}

		now := utils.GetCurrentTime()

		for _, value := range values {
			rowID, found := rowIDs[value.CustomFieldID]

			if customFieldValueIsBlank(value) {
				if !found {
					continue
				}
				if err := tx.Exec(
					`DELETE FROM custom_field_values WHERE id = ?`,
					rowID,
				).Error; err != nil {
					return err
				}
				continue
			}

			options := value.OptionsValue
			if options == nil {
				options = models.CustomFieldValueInputs{}
			}
			encoded, err := json.Marshal(options)
			if err != nil {
				return err
			}

			// Written as raw SQL because GORM has been unreliable with JSONB.
			if found {
				err = tx.Exec(
					`UPDATE custom_field_values
					 SET string_value = ?, options_value = ?::jsonb, type = ?, updated_at = ?
					 WHERE id = ?`,
					value.StringValue,
					string(encoded),
					value.Type,
					now,
					rowID,
				).Error
			} else {
				err = tx.Exec(
					`INSERT INTO custom_field_values
					 (id, custom_field_id, task_id, options_value, type, string_value, created_at, updated_at)
					 VALUES (?, ?, ?, ?::jsonb, ?, ?, ?, ?)`,
					utils.NewCustomFieldValueID(),
					value.CustomFieldID,
					taskID,
					string(encoded),
					value.Type,
					value.StringValue,
					now,
					now,
				).Error
			}
			if err != nil {
				return err
			}
		}

		return nil
	})
}

func (r *taskRepository) CreateActivities(entries []models.TaskActivity) error {
	if len(entries) == 0 {
		return nil
	}
	return r.db.Create(&entries).Error
}

func (r *taskRepository) ListActivities(userID string, taskID string) ([]models.TaskActivity, error) {
	if _, err := r.GetTaskByIdForUser(userID, taskID); err != nil {
		return nil, err
	}

	var entries []models.TaskActivity
	err := r.db.
		Where("task_id = ?", taskID).
		Order("created_at DESC").
		Limit(200).
		Find(&entries).Error
	if err != nil {
		return nil, err
	}

	return entries, nil
}

func (r *taskRepository) ActorName(userID string) string {
	var user models.User
	if err := r.db.Select("name", "email").Where("id = ?", userID).First(&user).Error; err != nil {
		return "Someone"
	}

	if trimmed := strings.TrimSpace(user.Name); trimmed != "" {
		return trimmed
	}

	email := strings.TrimSpace(user.Email)
	if at := strings.Index(email, "@"); at > 0 {
		return email[:at]
	}
	if email != "" {
		return email
	}

	return "Someone"
}

func (r *taskRepository) DeleteTask(userID, taskID string) error {
	result := r.db.
		Where("id = ? AND user_id = ?", taskID, userID).
		Delete(&models.Task{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
