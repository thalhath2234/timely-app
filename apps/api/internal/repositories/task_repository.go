package repositories

import (
	"timely-api/internal/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type TaskRepository interface {
	CreateTask(task *models.Task) error
	GetAllTaskByUser(user_id uuid.UUID) ([]models.Task, error)
	GetTaskById(userID uuid.UUID, taskId uuid.UUID) (*models.Task, error)
}

type taskRepository struct {
	db *gorm.DB
}

func NewTaskRepository(db *gorm.DB) TaskRepository {
	return &taskRepository{db: db}
}

func (r *taskRepository) CreateTask(task *models.Task) error {

	if task.StatusID == nil {
		var status models.Status

		err := r.db.
			Where("name = ?", "Todo").
			First(&status).Error
		if err != nil {
			return err
		}

		task.StatusID = &status.ID
	}

	if task.PriorityID == nil {
		var priority models.Priority

		err := r.db.
			Where("name = ?", "Low").
			First(&priority).Error
		if err != nil {
			return err
		}

		task.PriorityID = &priority.ID
	}

	return r.db.Create(task).Error
}

func (r *taskRepository) GetAllTaskByUser(userID uuid.UUID) ([]models.Task, error) {
	var tasks []models.Task

	err := r.db.
		Where("user_id = ?", userID).
		Preload("Labels").
		Preload("Project").
		Preload("Status").
		Preload("Priority").
		Preload("Workspace").
		Preload("Schedule").
		Preload("Stage").
		Find(&tasks).Error

	if err != nil {
		return nil, err
	}

	return tasks, nil
}

func (r *taskRepository) GetTaskById(userID uuid.UUID, taskId uuid.UUID) (*models.Task, error) {
	var task models.Task

	err := r.db.
		Where("user_id = ?", userID).
		Where("id = ?", taskId).
		Preload("Labels").
		Preload("Project").
		Preload("Status").
		Preload("Priority").
		Preload("Workspace").
		Preload("Schedule").
		Preload("Stage").
		First(&task).Error
	if err != nil {
		return nil, err
	}

	return &task, nil
}
