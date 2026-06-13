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

// GetCurrentTime returns the current time using simple date function and parse it to string
func GetCurrentTime() string {
	return fmt.Sprintf("%s", time.Now().Format("2006-01-02"))
}
