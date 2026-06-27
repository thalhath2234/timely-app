package task

import (
	"errors"
	"timely-api/internal/features/project"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

type TaskService interface {
	Create(task *models.Task, customFieldValues []*models.CustomFieldValue) (*models.Task, error)
	GetAllTaskByUser(userID string) ([]models.Task, error)
	GetTaskById(taskId string) (*models.Task, error)
}

type taskService struct {
	taskRepo    TaskRepository
	projectRepo project.ProjectRepository
}

func NewTaskService(taskRepo TaskRepository, projectRepo project.ProjectRepository) TaskService {
	return &taskService{taskRepo: taskRepo, projectRepo: projectRepo}
}

func (s *taskService) Create(task *models.Task, customFieldValues []*models.CustomFieldValue) (*models.Task, error) {
	if task.Name == "" {
		return nil, errors.New("task name cannot be empty")
	}

	task.ID = utils.NewTaskID()

	for _, cfv := range customFieldValues {
		cfv.ID = utils.NewCustomFieldValueID()
	}

	if task.WorkspaceID != nil && len(task.LabelIDs) > 0 {
		labelIDsMap := make(map[string]struct{}, len(task.LabelIDs))
		for _, l := range task.LabelIDs {
			if l.Id != "" {
				labelIDsMap[l.Id] = struct{}{}
			}
		}

		if len(labelIDsMap) > 0 {
			labelIDs := make([]string, 0, len(labelIDsMap))
			for id := range labelIDsMap {
				labelIDs = append(labelIDs, id)
			}

			labels, err := s.taskRepo.GetLabelsByIds(*task.WorkspaceID, labelIDs)
			if err != nil {
				return nil, err
			}
			if len(labels) != len(labelIDs) {
				return nil, errors.New("invalid label ids")
			}
			task.Labels = labels
		}
	}

	task, err := s.taskRepo.CreateTask(task, customFieldValues)
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

func (s *taskService) GetTaskById(taskId string) (*models.Task, error) {

	task, err := s.taskRepo.GetTaskById(taskId)
	if err != nil {
		return nil, err
	}

	return task, nil
}
