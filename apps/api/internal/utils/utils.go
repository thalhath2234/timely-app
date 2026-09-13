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

// NewDocumentID generates a document ID with doc_ prefix
func NewDocumentID() string {
	return PrefixedUUID("doc")
}

// NewSheetID generates a sheet ID with sht_ prefix
func NewSheetID() string {
	return PrefixedUUID("sht")
}

// NewActivityID generates a task activity ID with act_ prefix
func NewActivityID() string {
	return PrefixedUUID("act")
}

// NewEventID generates a calendar event ID with evt_ prefix
func NewEventID() string {
	return PrefixedUUID("evt")
}

// NewRecurrenceRuleID generates a recurrence rule ID with rr_ prefix
func NewRecurrenceRuleID() string {
	return PrefixedUUID("rr")
}

// NewRecurrenceExceptionID generates a recurrence exception ID with rx_ prefix
func NewRecurrenceExceptionID() string {
	return PrefixedUUID("rx")
}

// NewBlockID generates a scheduled block ID with blk_ prefix
func NewBlockID() string {
	return PrefixedUUID("blk")
}

func NewChecklistItemID() string {
	return PrefixedUUID("chk")
}

// NewApiKeyID generates an API key row ID with key_ prefix
func NewApiKeyID() string {
	return PrefixedUUID("key")
}

// NewEmbeddingID generates an embedding row ID with emb_ prefix
func NewEmbeddingID() string {
	return PrefixedUUID("emb")
}

func NewSessionID() string {
	return PrefixedUUID("ses")
}

func NewScheduleRevisionID() string {
	return PrefixedUUID("srv")
}

func NewJobID() string {
	return PrefixedUUID("job")
}

func NewNotificationID() string {
	return PrefixedUUID("ntf")
}

func NewPushDeviceID() string {
	return PrefixedUUID("dev")
}

func NewBackupID() string {
	return PrefixedUUID("bkp")
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
			"selectedStatusIds":    empty,
			"columnOrder":          empty,
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
			"selectedStatusIds":    empty,
			"columnOrder":          empty,
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
			"selectedStatusIds":    empty,
			"columnOrder":          empty,
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
			"selectedStatusIds":    empty,
			"columnOrder":          empty,
		},
	}
}

// GetCurrentTime returns the current time using simple date function and parse it to string
func GetCurrentTime() string {
	return fmt.Sprintf("%s", time.Now().Format("2006-01-02"))
}

// GetCurrentTimestamp returns an RFC3339 timestamp. Autosaved records such as
// documents and sheets are ordered by edit recency, so date-only precision is
// not enough for them.
func GetCurrentTimestamp() string {
	return time.Now().UTC().Format(time.RFC3339)
}
