package services

import (
	"errors"
	"timely-api/internal/models"
	"timely-api/internal/repositories"

	"github.com/google/uuid"
)

type TaskService interface {
	Create(task *models.Task) (*models.Task, error)
	GetAllTaskByUser(userID uuid.UUID) ([]models.Task, error)
	GetTaskById(userID uuid.UUID, taskId uuid.UUID) (*models.Task, error)
}

type taskService struct {
	repo repositories.TaskRepository
}

func NewTaskService(repo repositories.TaskRepository) TaskService {
	return &taskService{repo: repo}
}

func (s *taskService) Create(task *models.Task) (*models.Task, error) {
	if task.Name == "" {
		return nil, errors.New("task name cannot be empty")
	}

	if task.UserId == nil {
		return nil, errors.New("user id is required")
	}

	err := s.repo.CreateTask(task)
	if err != nil {
		return nil, err
	}

	return task, nil
}

func (s *taskService) GetAllTaskByUser(userID uuid.UUID) ([]models.Task, error) {
	if userID == uuid.Nil {
		return nil, errors.New("invalid user id")
	}

	tasks, err := s.repo.GetAllTaskByUser(userID)
	if err != nil {
		return nil, err
	}

	return tasks, nil
}

func (s *taskService) GetTaskById(userID uuid.UUID, taskId uuid.UUID) (*models.Task, error) {
	if userID == uuid.Nil {
		return nil, errors.New("invalid user id")
	}

	task, err := s.repo.GetTaskById(userID, taskId)
	if err != nil {
		return nil, err
	}

	return task, nil
}
