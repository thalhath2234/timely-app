package services

import (
	"errors"
	"timely-api/internal/models"
	"timely-api/internal/repositories"
	"timely-api/internal/utils"
)

type TaskService interface {
	Create(task *models.Task) (*models.Task, error)
	GetAllTaskByUser(userID string) ([]models.Task, error)
	GetTaskById(userID string, taskId string) (*models.Task, error)
}

type taskService struct {
	taskRepo    repositories.TaskRepository
	projectRepo repositories.ProjectRepository
}

func NewTaskService(taskRepo repositories.TaskRepository, projectRepo repositories.ProjectRepository) TaskService {
	return &taskService{taskRepo: taskRepo, projectRepo: projectRepo}
}

func (s *taskService) Create(task *models.Task) (*models.Task, error) {
	if task.Name == "" {
		return nil, errors.New("task name cannot be empty")
	}

	// Generate prefixed ID
	task.ID = utils.NewTaskID()

	if task.ProjectID != nil {
		project, err := s.projectRepo.GetProjectById(*task.WorkspaceID, *task.ProjectID)
		if err != nil {
			return nil, errors.New("invalid project id")
		}

		if project.WorkspaceID != task.WorkspaceID {
			return nil, errors.New("project does not belong to the same workspace")
		}
	}

	// set createdAt and updatedAt to current time and parse it to string
	task.CreatedAt = utils.GetCurrentTime()
	task.UpdatedAt = utils.GetCurrentTime()

	task, err := s.taskRepo.CreateTask(task)
	if err != nil {
		return nil, err
	}

	return task, nil
}

func (s *taskService) GetAllTaskByUser(userID string) ([]models.Task, error) {
	if userID == "" {
		return nil, errors.New("invalid user id")
	}

	tasks, err := s.taskRepo.GetAllTaskByUser(userID)
	if err != nil {
		return nil, err
	}

	return tasks, nil
}

func (s *taskService) GetTaskById(userID string, taskId string) (*models.Task, error) {
	if userID == "" {
		return nil, errors.New("invalid user id")
	}

	task, err := s.taskRepo.GetTaskById(userID, taskId)
	if err != nil {
		return nil, err
	}

	return task, nil
}
