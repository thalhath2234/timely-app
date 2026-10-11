package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"strings"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

// ---- TaskViewConfig types ----

type DataMode string
type RenderMode string
type SortDirection string
type SortByField string

const (
	DataModeTask    DataMode = "task"
	DataModeProject DataMode = "project"
)

const (
	RenderModeList   RenderMode = "list"
	RenderModeKanban RenderMode = "kanban"
	RenderModeGantt  RenderMode = "gantt"
)

const (
	SortDirectionAsc  SortDirection = "asc"
	SortDirectionDesc SortDirection = "desc"
)

const (
	SortByName      SortByField = "name"
	SortByDeadline  SortByField = "deadline"
	SortByStartDate SortByField = "startDate"
	// SortByScheduledOn orders by when the work is scheduled. Both clients sort
	// the list themselves; the server only stores and validates the choice.
	SortByScheduledOn SortByField = "scheduledOn"
	SortByCreatedAt   SortByField = "createdAt"
	SortByPriority    SortByField = "priority"
	SortByStatus      SortByField = "status"
	SortByProject     SortByField = "project"
)

// StaticGroupFields are the non-custom-field group keys.
var StaticGroupFields = map[string]bool{
	"workspace": true,
	"project":   true,
	"stage":     true,
	"status":    true,
	"priority":  true,
}

const (
	MaxTaskViews         = 20
	MaxProjectTaskViews  = 100
	MaxGroupFields       = 3
	MaxViewNameLen       = 100
	MaxViewIDLen         = 100
	MaxProjectViewKeyLen = 100
)

// TaskViewConfig represents a single saved view configuration.
type TaskViewConfig struct {
	ID                     string              `json:"id"`
	Name                   string              `json:"name"`
	DataMode               DataMode            `json:"dataMode"`
	RenderMode             RenderMode          `json:"renderMode"`
	GroupFields            []string            `json:"groupFields"`
	GroupSortDirection     SortDirection       `json:"groupSortDirection"`
	GroupValueOrders       map[string][]string `json:"groupValueOrders"`
	SortBy                 SortByField         `json:"sortBy"`
	SortDirection          SortDirection       `json:"sortDirection"`
	SelectedWorkspaceIds   []string            `json:"selectedWorkspaceIds"`
	SelectedStatusIds      []string            `json:"selectedStatusIds"`
	SelectedProjectIds     []string            `json:"selectedProjectIds,omitempty"`
	SelectedPriorityLevels []string            `json:"selectedPriorityLevels,omitempty"`
	SelectedLabelIds       []string            `json:"selectedLabelIds,omitempty"`
	SelectedStageIds       []string            `json:"selectedStageIds,omitempty"`
	// ShowCompleted is tri-state: nil means show completed (the UI default).
	ShowCompleted *bool `json:"showCompleted,omitempty"`
	OnlyOverdue   bool  `json:"onlyOverdue,omitempty"`
	OnlyScheduled bool  `json:"onlyScheduled,omitempty"`
	OnlyRecurring bool  `json:"onlyRecurring,omitempty"`
	// OnlyDated keeps tasks that carry a deadline or reserved calendar time.
	// Tri-state so a saved "false" survives a round trip; nil lets the client
	// apply its default (true for the built-in My Deadlines view).
	OnlyDated     *bool    `json:"onlyDated,omitempty"`
	ShowReminders bool     `json:"showReminders,omitempty"`
	ColumnOrder   []string `json:"columnOrder"`
	// OptionsVisible is the project-hub filter chrome; nil means shown.
	OptionsVisible *bool `json:"optionsVisible,omitempty"`
}

func (tv TaskViewConfig) Validate(customFieldIDs map[string]bool) error {
	if tv.ID == "" {
		return errors.New("view id cannot be empty")
	}
	if len(tv.ID) > MaxViewIDLen {
		return errors.New("view id too long")
	}
	if tv.Name == "" {
		return errors.New("view name cannot be empty")
	}
	if len(tv.Name) > MaxViewNameLen {
		return errors.New("view name too long")
	}
	if tv.DataMode != DataModeTask && tv.DataMode != DataModeProject {
		return errors.New("invalid dataMode: must be 'task' or 'project'")
	}
	if tv.RenderMode != RenderModeList && tv.RenderMode != RenderModeKanban && tv.RenderMode != RenderModeGantt {
		return errors.New("invalid renderMode: must be 'list', 'kanban', or 'gantt'")
	}
	if tv.GroupSortDirection != SortDirectionAsc && tv.GroupSortDirection != SortDirectionDesc {
		return errors.New("invalid groupSortDirection: must be 'asc' or 'desc'")
	}
	if tv.SortDirection != SortDirectionAsc && tv.SortDirection != SortDirectionDesc {
		return errors.New("invalid sortDirection: must be 'asc' or 'desc'")
	}
	validSortBy := map[SortByField]bool{
		SortByName: true, SortByDeadline: true, SortByStartDate: true, SortByScheduledOn: true,
		SortByCreatedAt: true, SortByPriority: true, SortByStatus: true, SortByProject: true,
	}
	if !validSortBy[tv.SortBy] {
		return errors.New("invalid sortBy value")
	}
	if len(tv.GroupFields) > MaxGroupFields {
		return errors.New("groupFields exceeds max of 3")
	}
	for _, gf := range tv.GroupFields {
		if StaticGroupFields[gf] {
			continue
		}
		if strings.HasPrefix(gf, "cf:") {
			cfID := strings.TrimPrefix(gf, "cf:")
			if cfID == "" {
				return errors.New("custom field group key missing id")
			}
			if customFieldIDs != nil && !customFieldIDs[cfID] {
				return errors.New("unknown custom field id in groupFields: " + cfID)
			}
			continue
		}
		return errors.New("invalid groupField value: " + gf)
	}
	return nil
}

// TaskViews is a slice that implements JSONB scanning/valuing.
type TaskViews []TaskViewConfig

func (tv TaskViews) Value() (driver.Value, error) {
	if tv == nil {
		return "[]", nil
	}
	b, err := json.Marshal(tv)
	return string(b), err
}

func (tv *TaskViews) Scan(src any) error {
	var b []byte
	switch v := src.(type) {
	case string:
		b = []byte(v)
	case []byte:
		b = v
	default:
		return errors.New("unsupported type for TaskViews scan")
	}
	return json.Unmarshal(b, tv)
}

// ProjectTaskViews is one saved layout per project id.
type ProjectTaskViews map[string]TaskViewConfig

func (tv ProjectTaskViews) Value() (driver.Value, error) {
	if tv == nil {
		return "{}", nil
	}
	b, err := json.Marshal(tv)
	return string(b), err
}

func (tv *ProjectTaskViews) Scan(src any) error {
	if src == nil {
		*tv = ProjectTaskViews{}
		return nil
	}
	var b []byte
	switch v := src.(type) {
	case string:
		b = []byte(v)
	case []byte:
		b = v
	default:
		return errors.New("unsupported type for ProjectTaskViews scan")
	}
	if len(b) == 0 || string(b) == "null" {
		*tv = ProjectTaskViews{}
		return nil
	}
	return json.Unmarshal(b, tv)
}

func (tv ProjectTaskViews) Validate() error {
	if len(tv) > MaxProjectTaskViews {
		return errors.New("too many project task views (max 100)")
	}
	for projectID, view := range tv {
		if projectID == "" {
			return errors.New("project task view key cannot be empty")
		}
		if len(projectID) > MaxProjectViewKeyLen {
			return errors.New("project task view key too long")
		}
		if err := view.Validate(nil); err != nil {
			return err
		}
	}
	return nil
}

func boolPtr(v bool) *bool { return &v }

// DefaultTaskViews returns the four built-in views every new user starts with.
func DefaultTaskViews() TaskViews {
	empty := []string{}
	emptyOrders := map[string][]string{}
	return TaskViews{
		{
			ID: "view_task_list", Name: "Task List",
			DataMode: DataModeTask, RenderMode: RenderModeList,
			GroupFields:        []string{"workspace", "project", "stage"},
			GroupSortDirection: SortDirectionAsc, GroupValueOrders: emptyOrders,
			SortBy: SortByDeadline, SortDirection: SortDirectionAsc,
			SelectedWorkspaceIds: empty,
			SelectedStatusIds:    empty,
			ColumnOrder:          empty,
		},
		{
			ID: "view_my_deadlines", Name: "My Deadlines",
			DataMode: DataModeTask, RenderMode: RenderModeList,
			GroupFields:        []string{"priority"},
			GroupSortDirection: SortDirectionAsc, GroupValueOrders: emptyOrders,
			SortBy: SortByDeadline, SortDirection: SortDirectionAsc,
			SelectedWorkspaceIds: empty,
			SelectedStatusIds:    empty,
			// The name promises a date filter: open work with a deadline or a
			// reserved block, not the whole board in a different sort.
			ShowCompleted: boolPtr(false),
			OnlyDated:     boolPtr(true),
			ColumnOrder:   empty,
		},
		{
			ID: "view_overview", Name: "Overview",
			DataMode: DataModeTask, RenderMode: RenderModeList,
			GroupFields:        []string{"workspace"},
			GroupSortDirection: SortDirectionAsc, GroupValueOrders: emptyOrders,
			SortBy: SortByCreatedAt, SortDirection: SortDirectionDesc,
			SelectedWorkspaceIds: empty,
			SelectedStatusIds:    empty,
			ColumnOrder:          empty,
		},
		{
			ID: "view_project_timelines", Name: "Project Timelines",
			DataMode: DataModeProject, RenderMode: RenderModeGantt,
			GroupFields:        []string{"workspace"},
			GroupSortDirection: SortDirectionAsc, GroupValueOrders: emptyOrders,
			SortBy: SortByStartDate, SortDirection: SortDirectionAsc,
			SelectedWorkspaceIds: empty,
			SelectedStatusIds:    empty,
			ColumnOrder:          empty,
		},
	}
}

// DefaultMobileTaskViews are the phone's built-in views (the same ids and
// layouts as defaultNativeTaskViews in apps/mobile/lib/nativeTaskViews.ts).
// The phone shows list and board only.
func DefaultMobileTaskViews() TaskViews {
	view := func(id, name string) TaskViewConfig {
		return TaskViewConfig{
			ID: id, Name: name, DataMode: DataModeTask, RenderMode: RenderModeList,
			GroupFields: []string{"workspace", "project", "stage"}, GroupSortDirection: SortDirectionAsc,
			GroupValueOrders: map[string][]string{}, SortBy: SortByDeadline, SortDirection: SortDirectionAsc,
			SelectedWorkspaceIds: []string{}, SelectedStatusIds: []string{}, SelectedProjectIds: []string{},
			SelectedPriorityLevels: []string{}, SelectedLabelIds: []string{}, SelectedStageIds: []string{},
			ShowCompleted: boolPtr(true), OnlyDated: boolPtr(false), ColumnOrder: []string{},
		}
	}
	list := view("native_view_task_list", "Task List")
	deadlines := view("native_view_my_deadlines", "My Deadlines")
	deadlines.GroupFields, deadlines.ShowCompleted, deadlines.OnlyDated = []string{"priority"}, boolPtr(false), boolPtr(true)
	overview := view("native_view_overview", "Overview")
	overview.GroupFields, overview.SortBy, overview.SortDirection = []string{"workspace"}, SortByCreatedAt, SortDirectionDesc
	board := view("native_view_board", "Board")
	board.RenderMode, board.GroupFields = RenderModeKanban, []string{"status"}
	return TaskViews{list, deadlines, overview, board}
}

// ---- Appearance (account-wide theme) ----

const (
	ThemeSystem   = "system"
	ThemeLight    = "light"
	ThemeDark     = "dark"
	AccentDefault = "default"
)

// Appearance is the signed-in look for the account, shared across clients.
type Appearance struct {
	Theme  string `json:"theme"`
	Accent string `json:"accent"`
}

func DefaultAppearance() Appearance {
	return Appearance{Theme: ThemeSystem, Accent: AccentDefault}
}

func (a Appearance) Value() (driver.Value, error) {
	normalized, err := a.Normalize()
	if err != nil {
		return nil, err
	}
	b, err := json.Marshal(normalized)
	return string(b), err
}

func (a *Appearance) Scan(src any) error {
	if src == nil {
		*a = DefaultAppearance()
		return nil
	}
	var b []byte
	switch v := src.(type) {
	case string:
		b = []byte(v)
	case []byte:
		b = v
	default:
		return errors.New("unsupported type for Appearance scan")
	}
	if len(b) == 0 {
		*a = DefaultAppearance()
		return nil
	}
	if err := json.Unmarshal(b, a); err != nil {
		return err
	}
	normalized, err := a.Normalize()
	if err != nil {
		*a = DefaultAppearance()
		return nil
	}
	*a = normalized
	return nil
}

func normalizeAccentHex(value string) (string, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", false
	}
	if !strings.HasPrefix(trimmed, "#") {
		trimmed = "#" + trimmed
	}
	upper := strings.ToUpper(trimmed)
	if len(upper) == 4 {
		return "#" + strings.Repeat(string(upper[1]), 2) + strings.Repeat(string(upper[2]), 2) + strings.Repeat(string(upper[3]), 2), hexRune(upper[1]) && hexRune(upper[2]) && hexRune(upper[3])
	}
	if len(upper) != 7 {
		return "", false
	}
	for i := 1; i < 7; i++ {
		if !hexRune(upper[i]) {
			return "", false
		}
	}
	return upper, true
}

func hexRune(r byte) bool {
	return (r >= '0' && r <= '9') || (r >= 'A' && r <= 'F')
}

func (a Appearance) Normalize() (Appearance, error) {
	theme := strings.ToLower(strings.TrimSpace(a.Theme))
	if theme == "" {
		theme = ThemeSystem
	}
	if theme != ThemeSystem && theme != ThemeLight && theme != ThemeDark {
		return Appearance{}, errors.New("invalid theme: must be system, light, or dark")
	}
	accent := strings.TrimSpace(a.Accent)
	if accent == "" || strings.EqualFold(accent, AccentDefault) {
		return Appearance{Theme: theme, Accent: AccentDefault}, nil
	}
	hex, ok := normalizeAccentHex(accent)
	if !ok {
		return Appearance{}, errors.New("invalid accent: use default or #RRGGBB")
	}
	return Appearance{Theme: theme, Accent: hex}, nil
}

// ---- Config model ----

type Config struct {
	ID                    string               `gorm:"type:text;primaryKey" json:"id"`
	UserID                string               `gorm:"type:text;not null" json:"userId"`
	IsOnBoardingCompleted bool                 `gorm:"default:false" json:"isOnBoardingCompleted"`
	TaskViews             TaskViews            `gorm:"type:jsonb;not null;default:'[]'" json:"taskViews"`
	ActiveTaskViewId      string               `gorm:"type:text;not null;default:''" json:"activeTaskViewId"`
	ProjectTaskViews      ProjectTaskViews     `gorm:"type:jsonb;not null;default:'{}'" json:"projectTaskViews"`
	Appearance            Appearance           `gorm:"type:jsonb;not null;default:'{\"theme\":\"system\",\"accent\":\"default\"}'" json:"appearance"`
	WorkingHours          WorkingHours         `gorm:"type:jsonb;not null;default:'{}'" json:"workingHours"`
	ScheduleSettings      ScheduleSettings     `gorm:"type:jsonb;not null;default:'{}'" json:"scheduleSettings"`
	NotificationSettings  NotificationSettings `gorm:"type:jsonb;not null;default:'{}'" json:"notificationSettings"`
	ReportDashboard       ReportDashboard      `gorm:"type:jsonb" json:"reportDashboard"`
	Version               int                  `gorm:"not null;default:0" json:"-"`
	CustomFields          []CustomField        `gorm:"-" json:"customFields,omitempty"`
	CreatedAt             string               `json:"createdAt"`
	UpdatedAt             string               `json:"updatedAt"`

	// MobileTaskViews are the phone app's saved views, apart from the web and
	// desktop ones. Empty until the phone uploads its device views once.
	MobileTaskViews        TaskViews `gorm:"type:jsonb;not null;default:'[]'" json:"mobileTaskViews"`
	MobileActiveTaskViewId string    `gorm:"type:text;not null;default:''" json:"mobileActiveTaskViewId"`
}

func (c *Config) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTime()
	if c.CreatedAt == "" {
		c.CreatedAt = now
	}
	c.UpdatedAt = now
	return nil
}

func (c *Config) BeforeUpdate(tx *gorm.DB) error {
	c.UpdatedAt = utils.GetCurrentTime()
	return nil
}
