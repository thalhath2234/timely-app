package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"strings"
)

// PreferredWindow is an optional daily clock range the engine should prefer.
// Empty Days means every day.
type PreferredWindow struct {
	Days  []string `json:"days,omitempty"`
	Start string   `json:"start"`
	End   string   `json:"end"`
}

type PreferredWindows []PreferredWindow

func (w PreferredWindows) Value() (driver.Value, error) {
	if w == nil {
		return "[]", nil
	}
	b, err := json.Marshal(w)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

func (w *PreferredWindows) Scan(value any) error {
	if value == nil {
		*w = PreferredWindows{}
		return nil
	}
	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return errors.New("unsupported type for PreferredWindows scan")
	}
	if len(bytes) == 0 {
		*w = PreferredWindows{}
		return nil
	}
	if err := json.Unmarshal(bytes, w); err != nil {
		return err
	}
	if *w == nil {
		*w = PreferredWindows{}
	}
	return nil
}

// ScheduleSettings are user-level engine controls stored on configs.
type ScheduleSettings struct {
	BreakMinutes         int      `json:"breakMinutes"`
	FreezeHours          int      `json:"freezeHours"`
	ExcludedWorkspaceIds []string `json:"excludedWorkspaceIds"`
}

func (s ScheduleSettings) Value() (driver.Value, error) {
	b, err := json.Marshal(s.Normalized())
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

func (s *ScheduleSettings) Scan(src any) error {
	if src == nil {
		*s = ScheduleSettings{}
		return nil
	}
	var b []byte
	switch v := src.(type) {
	case string:
		b = []byte(v)
	case []byte:
		b = v
	default:
		return errors.New("unsupported type for ScheduleSettings scan")
	}
	if len(b) == 0 {
		*s = ScheduleSettings{}
		return nil
	}
	if err := json.Unmarshal(b, s); err != nil {
		return err
	}
	*s = s.Normalized()
	return nil
}

func (s ScheduleSettings) Normalized() ScheduleSettings {
	out := s
	if out.BreakMinutes <= 0 {
		out.BreakMinutes = 5
	}
	if out.BreakMinutes > 60 {
		out.BreakMinutes = 60
	}
	if out.FreezeHours < 0 {
		out.FreezeHours = 0
	}
	if out.FreezeHours > 168 {
		out.FreezeHours = 168
	}
	if out.ExcludedWorkspaceIds == nil {
		out.ExcludedWorkspaceIds = []string{}
	}
	return out
}

func (s ScheduleSettings) ExcludesWorkspace(id string) bool {
	id = strings.TrimSpace(id)
	if id == "" {
		return false
	}
	for _, excluded := range s.ExcludedWorkspaceIds {
		if excluded == id {
			return true
		}
	}
	return false
}

type ScheduleRevision struct {
	ID          string          `gorm:"type:text;primaryKey" json:"id"`
	UserID      string          `gorm:"type:text;not null" json:"userId"`
	CreatedAt   string          `json:"createdAt"`
	HorizonFrom string          `gorm:"type:timestamptz;not null" json:"horizonFrom"`
	HorizonTo   string          `gorm:"type:timestamptz;not null" json:"horizonTo"`
	Snapshot    json.RawMessage `gorm:"type:jsonb;not null" json:"snapshot"`
}
