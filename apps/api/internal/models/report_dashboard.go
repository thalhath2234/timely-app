package models

import (
	"bytes"
	"database/sql/driver"
	"encoding/json"
	"errors"
)

const (
	// MaxReportDashboardBytes caps the saved Report dashboard. Notes cards keep
	// their text inside the layout, so leave room for those.
	MaxReportDashboardBytes = 256 * 1024
	MaxReportDashboardCards = 60
	MaxReportCardIDLen      = 100
)

// ReportDashboard is the account's Report page layout: the cards, their
// order and size, and each card's own settings. The clients own the card
// schema (`packages/contract/src/dashboard.ts`); the server only checks the
// outline and stores the JSON as sent. Empty means "not customised yet", and
// the clients show their default layout.
type ReportDashboard json.RawMessage

func (d ReportDashboard) MarshalJSON() ([]byte, error) {
	if len(d) == 0 {
		return []byte("null"), nil
	}
	return []byte(d), nil
}

func (d *ReportDashboard) UnmarshalJSON(b []byte) error {
	trimmed := bytes.TrimSpace(b)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		*d = nil
		return nil
	}
	*d = append((*d)[:0], trimmed...)
	return nil
}

func (d ReportDashboard) Value() (driver.Value, error) {
	if len(d) == 0 {
		return nil, nil
	}
	return string(d), nil
}

func (d *ReportDashboard) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*d = nil
	case string:
		*d = ReportDashboard(v)
	case []byte:
		*d = append(ReportDashboard(nil), v...)
	default:
		return errors.New("unsupported type for ReportDashboard scan")
	}
	if bytes.Equal(bytes.TrimSpace(*d), []byte("null")) {
		*d = nil
	}
	return nil
}

// Validate checks the outline every client relies on: an object with a
// `cards` list of objects that each carry a short string id.
func (d ReportDashboard) Validate() error {
	if len(d) == 0 {
		return nil
	}
	if len(d) > MaxReportDashboardBytes {
		return errors.New("report dashboard too large (max 256 KB)")
	}
	var outline struct {
		Cards []map[string]json.RawMessage `json:"cards"`
	}
	if err := json.Unmarshal(d, &outline); err != nil {
		return errors.New("invalid report dashboard: " + err.Error())
	}
	if outline.Cards == nil {
		return errors.New("invalid report dashboard: missing cards")
	}
	if len(outline.Cards) > MaxReportDashboardCards {
		return errors.New("too many report cards (max 60)")
	}
	seen := make(map[string]bool, len(outline.Cards))
	for _, card := range outline.Cards {
		var id string
		if err := json.Unmarshal(card["id"], &id); err != nil || id == "" {
			return errors.New("invalid report dashboard: every card needs an id")
		}
		if len(id) > MaxReportCardIDLen {
			return errors.New("report card id too long")
		}
		if seen[id] {
			return errors.New("invalid report dashboard: duplicate card id " + id)
		}
		seen[id] = true
	}
	return nil
}
