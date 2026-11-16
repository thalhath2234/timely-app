package chat

import (
	"errors"

	"gorm.io/gorm"
)

// What a person can do about a failed run, stored as Conversation.ErrorAction.
const (
	// ActionRetry (empty) offers Try again.
	ActionRetry = ""
	// ActionSettings sends the person to Settings → Agent: the provider's key,
	// credit or connection needs fixing first, so Try again alone cannot help.
	ActionSettings = "settings"
	// ActionNone offers neither: the same request would fail the same way, so
	// the person changes the request or the photos instead.
	ActionNone = "none"
)

// Failure is a run error worded for the person, with what they can do next.
type Failure struct {
	Text   string
	Action string
}

func (f *Failure) Error() string { return f.Text }

// NeedsSettings is an error fixed in Settings → Agent, not by trying again.
func NeedsSettings(text string) error { return &Failure{Text: text, Action: ActionSettings} }

// Final is an error trying the same request again would repeat.
func Final(text string) error { return &Failure{Text: text, Action: ActionNone} }

// failureAction is the action an error carries; plain errors offer Try again.
func failureAction(err error) string {
	var f *Failure
	if errors.As(err, &f) {
		return f.Action
	}
	return ActionRetry
}

// BeforeSave drops the action with the error it belongs to, so an error set
// later by other code never inherits an earlier failure's action.
func (c *Conversation) BeforeSave(*gorm.DB) error {
	if c.Error == "" {
		c.ErrorAction = ""
	}
	return nil
}
