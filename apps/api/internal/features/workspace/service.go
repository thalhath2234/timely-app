package workspace

import (
	"errors"
	"strings"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

// WorkspaceService owns the account boundary for workspaces and everything
// inside them (statuses, labels, custom fields). Every method that reads or
// writes a workspace or one of its children takes the owning userID and
// returns gorm.ErrRecordNotFound when the workspace is not in that account,
// without writing anything.
type WorkspaceService interface {
	Create(workspace *models.Workspace) (*models.Workspace, error)
	GetAllWorkspaceByUser(userID string) ([]models.Workspace, error)
	GetWorkspaceById(userID string, workspaceID string) (*models.Workspace, error)
	UpdateWorkspace(userID string, workspaceID string, name string, color *string) (*models.Workspace, error)
	CreateLabels(userID string, lable *models.Lable) (*models.Lable, error)
	CreateStatuses(userID string, status *models.Status) (*models.Status, error)
	CreateCustomFields(userID string, customField *models.CustomField) (*models.CustomField, error)
	UpdateLabels(userID string, lable *models.Lable) (*models.Lable, error)
	DeleteLabels(userID string, lableID string, workspaceID string) error
	UpdateStatuses(userID string, status *models.Status) (*models.Status, error)
	DeleteStatuses(userID string, statusID string, workspaceID string) error
	UpdateCustomFields(userID string, customField *models.CustomField) (*models.CustomField, error)
	DeleteCustomFields(userID string, customFieldID string, workspaceID string) error
	GetConfig(userID string) (*models.Config, error)
	UpdateConfig(config *models.Config) (*models.Config, error)
	Delete(userID, workspaceID string) error
}

type workspaceService struct {
	repo WorkspaceRepository
}

func NewWorkspaceService(repo WorkspaceRepository) WorkspaceService {
	return &workspaceService{repo: repo}
}

// requireOwned returns gorm.ErrRecordNotFound unless workspaceID belongs to userID.
func (s *workspaceService) requireOwned(userID string, workspaceID string) error {
	if userID == "" {
		return errors.New("invalid user id")
	}
	if workspaceID == "" {
		return errors.New("invalid workspace id")
	}
	return s.repo.EnsureWorkspaceOwned(userID, workspaceID)
}

func (s *workspaceService) Create(workspace *models.Workspace) (*models.Workspace, error) {
	if workspace.Name == "" {
		return nil, errors.New("workspace name cannot be empty")
	}

	if workspace.UserID == nil {
		return nil, errors.New("user id is required")
	}

	workspace.ID = utils.NewWorkspaceID()
	if strings.TrimSpace(workspace.Color) == "" {
		index := 0
		if count, err := s.repo.CountByUser(*workspace.UserID); err == nil {
			index = int(count)
		}
		workspace.Color = utils.ColorForIndex(index)
	} else {
		workspace.Color = utils.NormalizeHexColor(workspace.Color, utils.ColorForIndex(0))
	}
	defaultStatuses := []models.Status{
		{
			ID:          utils.NewStatusID(),
			Name:        "Backlog",
			Color:       "#889096",
			WorkspaceID: workspace.ID,
			IsDefault:   false,
		},
		{
			ID:          utils.NewStatusID(),
			Name:        "Todo",
			Color:       "#889096",
			WorkspaceID: workspace.ID,
			IsDefault:   true,
		},
		{
			ID:          utils.NewStatusID(),
			Name:        "In Progress",
			Color:       "#FFB224",
			WorkspaceID: workspace.ID,
			IsDefault:   false,
		},
		{
			ID:          utils.NewStatusID(),
			Name:        "Blocked",
			Color:       "#E5484D",
			WorkspaceID: workspace.ID,
			IsDefault:   false,
		},
		{
			ID:          utils.NewStatusID(),
			Name:        "Completed",
			Color:       "#30A66D",
			WorkspaceID: workspace.ID,
			IsDefault:   false,
		},
		{
			ID:          utils.NewStatusID(),
			Name:        "Canceled",
			Color:       "#E5484D",
			WorkspaceID: workspace.ID,
			IsDefault:   false,
		},
	}

	err := s.repo.CreateWorkspace(workspace, defaultStatuses)
	if err != nil {
		return nil, err
	}

	return workspace, nil
}

func (s *workspaceService) GetAllWorkspaceByUser(userID string) ([]models.Workspace, error) {
	if userID == "" {
		return nil, errors.New("invalid user id")
	}

	workspaces, err := s.repo.GetAllWorkspaceByUser(userID)
	if err != nil {
		return nil, err
	}

	return workspaces, nil
}

func (s *workspaceService) GetWorkspaceById(userID string, workspaceID string) (*models.Workspace, error) {
	if userID == "" {
		return nil, errors.New("invalid user id")
	}

	workspace, err := s.repo.GetWorkspaceById(userID, workspaceID)
	if err != nil {
		return nil, err
	}

	return workspace, nil
}

func (s *workspaceService) UpdateWorkspace(userID string, workspaceID string, name string, color *string) (*models.Workspace, error) {
	if userID == "" {
		return nil, errors.New("invalid user id")
	}
	if workspaceID == "" {
		return nil, errors.New("invalid workspace id")
	}

	workspace, err := s.repo.GetWorkspaceById(userID, workspaceID)
	if err != nil {
		return nil, err
	}

	nextName := strings.TrimSpace(name)
	if nextName == "" {
		nextName = workspace.Name
	}
	if nextName == "" {
		return nil, errors.New("workspace name cannot be empty")
	}

	workspace.Name = nextName
	if color != nil {
		workspace.Color = utils.NormalizeHexColor(*color, workspace.Color)
	}
	workspace.UpdatedAt = utils.GetCurrentTime()
	if err := s.repo.UpdateWorkspace(userID, workspace); err != nil {
		return nil, err
	}

	return s.repo.GetWorkspaceById(userID, workspaceID)
}

func (s *workspaceService) CreateLabels(userID string, lable *models.Lable) (*models.Lable, error) {
	if lable == nil {
		return nil, errors.New("invalid lable data")
	}
	if err := s.requireOwned(userID, lable.WorkspaceID); err != nil {
		return nil, err
	}

	lable.ID = utils.NewLableID()

	createdLable, err := s.repo.CreateLabels(lable)
	if err != nil {
		return nil, err
	}

	return createdLable, nil
}

func (s *workspaceService) CreateStatuses(userID string, status *models.Status) (*models.Status, error) {
	if status == nil {
		return nil, errors.New("invalid status data")
	}
	if err := s.requireOwned(userID, status.WorkspaceID); err != nil {
		return nil, err
	}

	status.ID = utils.NewStatusID()

	createdStatus, err := s.repo.CreateStatuses(status)
	if err != nil {
		return nil, err
	}

	return createdStatus, nil
}

func (s *workspaceService) CreateCustomFields(userID string, customField *models.CustomField) (*models.CustomField, error) {
	if customField == nil {
		return nil, errors.New("invalid custom field data")
	}
	if err := s.requireOwned(userID, customField.WorkspaceID); err != nil {
		return nil, err
	}
	customField.ID = utils.NewCustomFieldID()

	createdCustomField, err := s.repo.CreateCustomFields(customField)
	if err != nil {
		return nil, err
	}

	return createdCustomField, nil
}

func (s *workspaceService) UpdateLabels(userID string, lable *models.Lable) (*models.Lable, error) {
	if lable == nil || lable.ID == "" {
		return nil, errors.New("invalid lable data")
	}
	if err := s.requireOwned(userID, lable.WorkspaceID); err != nil {
		return nil, err
	}

	updatedLable, err := s.repo.UpdateLabels(lable)
	if err != nil {
		return nil, err
	}

	return updatedLable, nil
}

func (s *workspaceService) DeleteLabels(userID string, lableID string, workspaceID string) error {
	if lableID == "" || workspaceID == "" {
		return errors.New("invalid lable id or workspace id")
	}
	if err := s.requireOwned(userID, workspaceID); err != nil {
		return err
	}

	return s.repo.DeleteLabels(lableID, workspaceID)
}

func (s *workspaceService) UpdateStatuses(userID string, status *models.Status) (*models.Status, error) {
	if status == nil || status.ID == "" {
		return nil, errors.New("invalid status data")
	}
	if err := s.requireOwned(userID, status.WorkspaceID); err != nil {
		return nil, err
	}

	updatedStatus, err := s.repo.UpdateStatuses(status)
	if err != nil {
		return nil, err
	}

	return updatedStatus, nil
}

func (s *workspaceService) DeleteStatuses(userID string, statusID string, workspaceID string) error {
	if statusID == "" || workspaceID == "" {
		return errors.New("invalid status id or workspace id")
	}
	if err := s.requireOwned(userID, workspaceID); err != nil {
		return err
	}

	return s.repo.DeleteStatuses(statusID, workspaceID)
}

func (s *workspaceService) UpdateCustomFields(userID string, customField *models.CustomField) (*models.CustomField, error) {
	if customField == nil || customField.ID == "" {
		return nil, errors.New("invalid custom field data")
	}
	if err := s.requireOwned(userID, customField.WorkspaceID); err != nil {
		return nil, err
	}
	if !customField.Type.IsValid() {
		return nil, errors.New("invalid custom field type")
	}

	updatedCustomField, err := s.repo.UpdateCustomFields(customField)
	if err != nil {
		return nil, err
	}

	return updatedCustomField, nil
}

func (s *workspaceService) DeleteCustomFields(userID string, customFieldID string, workspaceID string) error {
	if customFieldID == "" || workspaceID == "" {
		return errors.New("invalid custom field id or workspace id")
	}
	if err := s.requireOwned(userID, workspaceID); err != nil {
		return err
	}

	return s.repo.DeleteCustomFields(customFieldID, workspaceID)
}

func (s *workspaceService) GetConfig(userID string) (*models.Config, error) {
	if userID == "" {
		return nil, errors.New("invalid user id")
	}

	config, err := s.repo.GetConfig(userID)
	if err != nil {
		return nil, err
	}

	// Backfill for users who pre-date the task views feature.
	if len(config.TaskViews) == 0 {
		config.TaskViews = models.DefaultTaskViews()
		config.ActiveTaskViewId = "view_task_list"
	}
	if config.ProjectTaskViews == nil {
		config.ProjectTaskViews = models.ProjectTaskViews{}
	}
	if config.Appearance.Theme == "" {
		config.Appearance = models.DefaultAppearance()
	}

	customFields, err := s.repo.GetAllCustomFields(userID)
	if err != nil {
		return nil, err
	}

	config.CustomFields = customFields

	return config, nil
}

// UpdateConfig validates and persists a config update.
func (s *workspaceService) UpdateConfig(config *models.Config) (*models.Config, error) {
	if config == nil || config.UserID == "" {
		return nil, errors.New("invalid config data")
	}

	if err := validateTaskViews(config.TaskViews, config.ActiveTaskViewId); err != nil {
		return nil, err
	}
	if config.ProjectTaskViews != nil {
		if err := config.ProjectTaskViews.Validate(); err != nil {
			return nil, err
		}
	}
	appearance, err := config.Appearance.Normalize()
	if err != nil {
		return nil, err
	}
	config.Appearance = appearance
	if err := config.ReportDashboard.Validate(); err != nil {
		return nil, err
	}

	updatedConfig, err := s.repo.UpdateConfig(config)
	if err != nil {
		return nil, err
	}

	// Re-attach custom fields so the response is complete.
	customFields, err := s.repo.GetAllCustomFields(config.UserID)
	if err != nil {
		return nil, err
	}
	updatedConfig.CustomFields = customFields

	return updatedConfig, nil
}

// validateTaskViews checks structural constraints on a set of task views.
// customFieldIDs is nil here (we do not re-validate cf: IDs on every write to
// keep things fast; the DB is the source-of-truth for custom field existence).
func validateTaskViews(views models.TaskViews, activeID string) error {
	if len(views) > models.MaxTaskViews {
		return errors.New("too many task views (max 20)")
	}

	ids := make(map[string]bool, len(views))
	for _, v := range views {
		if err := v.Validate(nil); err != nil {
			return err
		}
		if ids[v.ID] {
			return errors.New("duplicate view id: " + v.ID)
		}
		ids[v.ID] = true
	}

	if activeID != "" && !ids[activeID] {
		return errors.New("activeTaskViewId does not match any view id")
	}

	return nil
}

func (s *workspaceService) Delete(userID, workspaceID string) error {
	if userID == "" || workspaceID == "" {
		return errors.New("invalid request")
	}
	if _, err := s.repo.GetWorkspaceById(userID, workspaceID); err != nil {
		return err
	}
	count, err := s.repo.CountByUser(userID)
	if err != nil {
		return err
	}
	if count <= 1 {
		return errors.New("cannot delete the last workspace")
	}
	return s.repo.DeleteWorkspace(userID, workspaceID)
}
