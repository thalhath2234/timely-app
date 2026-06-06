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
	taskRepo    repositories.TaskRepository
	projectRepo repositories.ProjectRepository
}

func NewTaskService(taskRepo repositories.TaskRepository, projectRepo repositories.ProjectRepository) TaskService {
	return &taskService{taskRepo: taskRepo, projectRepo: projectRepo}
}

func (s *taskService) validateHierarchy(task *models.Task) error {

	// project/workspace validation
	if task.ProjectID != nil && task.WorkspaceID != nil {

		project, err := s.projectRepo.GetProjectById(*task.UserId, *task.ProjectID)
		if err != nil {
			return err
		}

		if project.WorkspaceID != nil &&
			*project.WorkspaceID != *task.WorkspaceID {

			return errors.New(
				"project does not belong to workspace",
			)
		}
	}

	// stage/project validation
	if task.StageID != nil && task.ProjectID != nil {

		stage, err := s.projectRepo.GetStageById(*task.ProjectID, *task.StageID)
		if err != nil {
			return err
		}

		if stage.ProjectID != nil &&
			*stage.ProjectID != *task.ProjectID {

			return errors.New(
				"stage does not belong to project",
			)
		}
	}

	return nil
}

func (s *taskService) Create(task *models.Task) (*models.Task, error) {
	if task.Name == "" {
		return nil, errors.New("task name cannot be empty")
	}

	if task.UserId == nil {
		return nil, errors.New("user id is required")
	}
	validate := s.validateHierarchy(task)
	if validate != nil {
		return nil, validate
	}

	task, err := s.taskRepo.CreateTask(task)
	if err != nil {
		return nil, err
	}

	return task, nil
}

func (s *taskService) GetAllTaskByUser(userID uuid.UUID) ([]models.Task, error) {
	if userID == uuid.Nil {
		return nil, errors.New("invalid user id")
	}

	tasks, err := s.taskRepo.GetAllTaskByUser(userID)
	if err != nil {
		return nil, err
	}

	return tasks, nil
}

func (s *taskService) GetTaskById(userID uuid.UUID, taskId uuid.UUID) (*models.Task, error) {
	if userID == uuid.Nil {
		return nil, errors.New("invalid user id")
	}

	task, err := s.taskRepo.GetTaskById(userID, taskId)
	if err != nil {
		return nil, err
	}

	return task, nil
}
