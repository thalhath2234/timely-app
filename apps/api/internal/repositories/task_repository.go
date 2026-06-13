package repositories

import (
	"timely-api/internal/models"

	"gorm.io/gorm"
)

type TaskRepository interface {
	CreateTask(task *models.Task, customFieldValues []*models.CustomFieldValue) (*models.Task, error)
	GetAllTaskByUser(user_id string) ([]models.Task, error)
	GetTaskById(userID string, taskId string) (*models.Task, error)
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
			Where("name = ?", "Todo").
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
		if err := tx.Create(cfv).Error; err != nil {
			tx.Rollback()
			return nil, err
		}
	}

	if err := tx.Commit().Error; err != nil {
		return nil, err
	}

	var createdTask models.Task

	err := r.db.
		// Preload("Labels").
		Preload("Project").
		Preload("Status").
		Preload("Workspace").
		Preload("Schedule").
		Preload("Stage").
		Preload("CustomFieldValues").
		Where("id = ?", task.ID).
		First(&createdTask).Error

	if err != nil {
		return nil, err
	}

	return &createdTask, nil
}

func (r *taskRepository) GetAllTaskByUser(userID string) ([]models.Task, error) {
	var tasks []models.Task

	err := r.db.
		Where("user_id = ?", userID).
		// Preload("Labels").
		Preload("Project").
		Preload("Status").
		Preload("Workspace").
		Preload("Schedule").
		Preload("Stage").
		Preload("BlockedBy", func(db *gorm.DB) *gorm.DB {
			return db.Select("id, name")
		}).
		Preload("CustomFieldValues").
		Find(&tasks).Error

	if err != nil {
		return nil, err
	}

	return tasks, nil
}

func (r *taskRepository) GetTaskById(userID string, taskId string) (*models.Task, error) {
	var task models.Task

	err := r.db.
		Where("id = ?", taskId).
		// Preload("Labels").
		Preload("Project").
		Preload("Status").
		Preload("Workspace").
		Preload("Schedule").
		Preload("Stage").
		Preload("BlockedBy", func(db *gorm.DB) *gorm.DB {
			return db.Select("id, name")
		}).
		Preload("CustomFieldValues").
		First(&task).Error
	if err != nil {
		return nil, err
	}

	return &task, nil
}
