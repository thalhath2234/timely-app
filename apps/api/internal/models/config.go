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
	SortByCreatedAt SortByField = "createdAt"
	SortByPriority  SortByField = "priority"
	SortByStatus    SortByField = "status"
	SortByProject   SortByField = "project"
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
	MaxTaskViews   = 20
	MaxGroupFields = 3
	MaxViewNameLen = 100
	MaxViewIDLen   = 100
)

// TaskViewConfig represents a single saved view configuration.
type TaskViewConfig struct {
	ID                   string              `json:"id"`
	Name                 string              `json:"name"`
	DataMode             DataMode            `json:"dataMode"`
	RenderMode           RenderMode          `json:"renderMode"`
	GroupFields          []string            `json:"groupFields"`
	GroupSortDirection   SortDirection       `json:"groupSortDirection"`
	GroupValueOrders     map[string][]string `json:"groupValueOrders"`
	SortBy               SortByField         `json:"sortBy"`
	SortDirection        SortDirection       `json:"sortDirection"`
	SelectedWorkspaceIds []string            `json:"selectedWorkspaceIds"`
	SelectedStatusIds    []string            `json:"selectedStatusIds"`
	ColumnOrder          []string            `json:"columnOrder"`
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
		SortByName: true, SortByDeadline: true, SortByStartDate: true,
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
			ColumnOrder:          empty,
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

// ---- Config model ----

type Config struct {
	ID                    string        `gorm:"type:text;primaryKey" json:"id"`
	UserID                string        `gorm:"type:text;not null" json:"userId"`
	IsOnBoardingCompleted bool          `gorm:"default:false" json:"isOnBoardingCompleted"`
	TaskViews             TaskViews     `gorm:"type:jsonb;not null;default:'[]'" json:"taskViews"`
	ActiveTaskViewId      string        `gorm:"type:text;not null;default:''" json:"activeTaskViewId"`
	WorkingHours          WorkingHours  `gorm:"type:jsonb;not null;default:'{}'" json:"workingHours"`
	Version               int           `gorm:"not null;default:0" json:"-"`
	CustomFields          []CustomField `gorm:"-" json:"customFields,omitempty"`
	CreatedAt             string        `json:"createdAt"`
	UpdatedAt             string        `json:"updatedAt"`
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
