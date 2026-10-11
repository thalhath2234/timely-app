package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"strings"
	"timely-api/internal/utils"
)

const (
	KindTask     = "task"
	KindReminder = "reminder"
	KindInbox    = "inbox"
)

func NormalizeKind(raw string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", KindTask:
		return KindTask, nil
	case KindReminder:
		return KindReminder, nil
	case KindInbox:
		return KindInbox, nil
	default:
		return "", errors.New("kind must be task, reminder, or inbox")
	}
}

// ResolveCreateKind decides whether a new row is work, a reminder, or inbox.
// Explicit kind wins. Otherwise duration > 0 is work, a ping time / recurrence
// is a reminder, and a title-only capture lands in the inbox.
func ResolveCreateKind(kind string, duration int, scheduledOn *string, hasRecurrence bool) string {
	if normalized, err := NormalizeKind(kind); err == nil && kind != "" {
		return normalized
	}
	if duration > 0 {
		return KindTask
	}
	hasPing := hasRecurrence || (scheduledOn != nil && strings.TrimSpace(*scheduledOn) != "")
	if hasPing {
		return KindReminder
	}
	return KindInbox
}

type ChecklistItem struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	CompletedAt *string `json:"completedAt"`
	Order       int     `json:"order"`
}

func (item ChecklistItem) IsCompleted() bool {
	return item.CompletedAt != nil && *item.CompletedAt != ""
}

type Checklist []ChecklistItem

func (c Checklist) Value() (driver.Value, error) {
	if c == nil {
		return "[]", nil
	}
	b, err := json.Marshal(c)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

func (c *Checklist) Scan(value any) error {
	if value == nil {
		*c = Checklist{}
		return nil
	}
	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return errors.New("unsupported type for Checklist scan")
	}
	if len(bytes) == 0 {
		*c = Checklist{}
		return nil
	}
	if err := json.Unmarshal(bytes, c); err != nil {
		return err
	}
	if *c == nil {
		*c = Checklist{}
	}
	return nil
}

func (c Checklist) Progress() (done, total int) {
	total = len(c)
	for _, item := range c {
		if item.IsCompleted() {
			done++
		}
	}
	return done, total
}

func (c Checklist) Clone() Checklist {
	if len(c) == 0 {
		return Checklist{}
	}
	out := make(Checklist, len(c))
	for i, item := range c {
		out[i] = item
		out[i].ID = utils.NewChecklistItemID()
		if item.CompletedAt != nil {
			copied := *item.CompletedAt
			out[i].CompletedAt = &copied
		}
	}
	return out
}

// CloneUnchecked copies the list with fresh ids and every item unchecked, for
// work that starts over (a new project started from an earlier one).
func (c Checklist) CloneUnchecked() Checklist {
	out := c.Clone()
	for i := range out {
		out[i].CompletedAt = nil
	}
	return out
}

func NewChecklistItem(title string, order int) ChecklistItem {
	return ChecklistItem{
		ID:    utils.NewChecklistItemID(),
		Title: strings.TrimSpace(title),
		Order: order,
	}
}
