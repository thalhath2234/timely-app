package utils

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

// PrefixedUUID generates a UUID with a specific prefix
func PrefixedUUID(prefix string) string {
	return fmt.Sprintf("%s_%s", prefix, uuid.New().String())
}

// NewWorkspaceID generates a workspace ID with ws_ prefix
func NewWorkspaceID() string {
	return PrefixedUUID("ws")
}

// NewProjectID generates a project ID with pr_ prefix
func NewProjectID() string {
	return PrefixedUUID("pr")
}

// NewTaskID generates a task ID with tsk_ prefix
func NewTaskID() string {
	return PrefixedUUID("tsk")
}

// NewUserID generates a user ID with usr_ prefix (optional)
func NewUserID() string {
	return PrefixedUUID("usr")
}

// NewStatusID generates a status ID with tst_ prefix (optional)
func NewStatusID() string {
	return PrefixedUUID("tst")
}

// NewLableID generates a lable ID with lbl_ prefix (optional)
func NewLableID() string {
	return PrefixedUUID("lbl")
}

// NewStageID generates a stage ID with stg_ prefix (optional)
func NewStageID() string {
	return PrefixedUUID("stg")
}

func NewCustomFieldID() string {
	return PrefixedUUID("cf")
}

func NewOptionID() string {
	return PrefixedUUID("cfop")
}

func NewCustomFieldValueID() string {
	return PrefixedUUID("cfv")
}

func NewConfigID() string {
	return PrefixedUUID("cfg")
}

// DefaultTaskViews returns the four built-in task views every new user starts with.
func DefaultTaskViews() []map[string]any {
	empty := []string{}
	emptyOrders := map[string][]string{}
	return []map[string]any{
		{
			"id": "view_task_list", "name": "Task List",
			"dataMode": "task", "renderMode": "list",
			"groupFields":          []string{"workspace", "project", "stage"},
			"groupSortDirection":   "asc",
			"groupValueOrders":     emptyOrders,
			"sortBy":               "deadline",
			"sortDirection":        "asc",
			"selectedWorkspaceIds": empty,
		},
		{
			"id": "view_my_deadlines", "name": "My Deadlines",
			"dataMode": "task", "renderMode": "list",
			"groupFields":          []string{"priority"},
			"groupSortDirection":   "asc",
			"groupValueOrders":     emptyOrders,
			"sortBy":               "deadline",
			"sortDirection":        "asc",
			"selectedWorkspaceIds": empty,
		},
		{
			"id": "view_overview", "name": "Overview",
			"dataMode": "task", "renderMode": "list",
			"groupFields":          []string{"workspace"},
			"groupSortDirection":   "asc",
			"groupValueOrders":     emptyOrders,
			"sortBy":               "createdAt",
			"sortDirection":        "desc",
			"selectedWorkspaceIds": empty,
		},
		{
			"id": "view_project_timelines", "name": "Project Timelines",
			"dataMode": "project", "renderMode": "gantt",
			"groupFields":          []string{"workspace"},
			"groupSortDirection":   "asc",
			"groupValueOrders":     emptyOrders,
			"sortBy":               "startDate",
			"sortDirection":        "asc",
			"selectedWorkspaceIds": empty,
		},
	}
}

// GetCurrentTime returns the current time using simple date function and parse it to string
func GetCurrentTime() string {
	return fmt.Sprintf("%s", time.Now().Format("2006-01-02"))
}
