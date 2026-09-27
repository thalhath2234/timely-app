package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"
)

// WorkingWindow is one availability span inside a day, "HH:MM" local time.
type WorkingWindow struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

// WorkingHours is the weekly availability template the scheduling engine
// places work into. Days are keyed "sun".."sat"; a missing or empty day is a
// day off.
type WorkingHours struct {
	Timezone string                     `json:"timezone"`
	Days     map[string][]WorkingWindow `json:"days"`
}

var weekdayKeys = []string{"sun", "mon", "tue", "wed", "thu", "fri", "sat"}

// WeekdayKey maps time.Weekday to the JSON key used in Days.
func WeekdayKey(day time.Weekday) string {
	return weekdayKeys[int(day)]
}

// DefaultWorkingHours is Monday to Friday, 09:00 to 17:00.
func DefaultWorkingHours(timezone string) WorkingHours {
	if timezone == "" {
		timezone = "UTC"
	}
	days := map[string][]WorkingWindow{}
	for _, key := range []string{"mon", "tue", "wed", "thu", "fri"} {
		days[key] = []WorkingWindow{{Start: "09:00", End: "17:00"}}
	}
	days["sun"] = []WorkingWindow{}
	days["sat"] = []WorkingWindow{}
	return WorkingHours{Timezone: timezone, Days: days}
}

// IsEmpty reports whether the user has never saved working hours.
func (w WorkingHours) IsEmpty() bool {
	return w.Timezone == "" && len(w.Days) == 0
}

// WindowsOn is the availability on a calendar date. A day with no windows
// uses 09:00–17:00 so All-day Events still have hours to fill.
func (w WorkingHours) WindowsOn(day time.Time) []WorkingWindow {
	hours := w
	if hours.IsEmpty() {
		hours = DefaultWorkingHours("UTC")
	}
	windows := hours.Days[WeekdayKey(day.Weekday())]
	if len(windows) == 0 {
		return []WorkingWindow{{Start: "09:00", End: "17:00"}}
	}
	return windows
}

// IntervalsOn turns WindowsOn into instants in loc for that date.
func (w WorkingHours) IntervalsOn(day time.Time, loc *time.Location) [][2]time.Time {
	if loc == nil {
		loc = time.UTC
	}
	local := time.Date(day.In(loc).Year(), day.In(loc).Month(), day.In(loc).Day(), 0, 0, 0, 0, loc)
	var out [][2]time.Time
	for _, window := range w.WindowsOn(local) {
		startMin, err := ParseClock(window.Start)
		if err != nil {
			continue
		}
		endMin, err := ParseClock(window.End)
		if err != nil || endMin <= startMin {
			continue
		}
		out = append(out, [2]time.Time{
			local.Add(time.Duration(startMin) * time.Minute),
			local.Add(time.Duration(endMin) * time.Minute),
		})
	}
	return out
}

// Location resolves the configured zone, falling back to the given default.
func (w WorkingHours) Location(fallback *time.Location) *time.Location {
	if w.Timezone == "" {
		return fallback
	}
	loc, err := time.LoadLocation(w.Timezone)
	if err != nil {
		return fallback
	}
	return loc
}

// Validate checks the windows are well formed and non-overlapping per day.
func (w WorkingHours) Validate() error {
	if w.Timezone != "" {
		if _, err := time.LoadLocation(w.Timezone); err != nil {
			return fmt.Errorf("unknown timezone %q", w.Timezone)
		}
	}
	valid := map[string]bool{}
	for _, key := range weekdayKeys {
		valid[key] = true
	}
	for key, windows := range w.Days {
		if !valid[key] {
			return fmt.Errorf("unknown day %q", key)
		}
		sorted := append([]WorkingWindow(nil), windows...)
		sort.Slice(sorted, func(i, j int) bool { return sorted[i].Start < sorted[j].Start })
		lastEnd := -1
		for _, window := range sorted {
			start, err := ParseClock(window.Start)
			if err != nil {
				return fmt.Errorf("%s: %w", key, err)
			}
			end, err := ParseClock(window.End)
			if err != nil {
				return fmt.Errorf("%s: %w", key, err)
			}
			if end <= start {
				return fmt.Errorf("%s: window end must be after start", key)
			}
			if start < lastEnd {
				return fmt.Errorf("%s: windows overlap", key)
			}
			lastEnd = end
		}
	}
	return nil
}

// ParseClock turns "HH:MM" into minutes since midnight.
func ParseClock(value string) (int, error) {
	var hours, minutes int
	if _, err := fmt.Sscanf(value, "%d:%d", &hours, &minutes); err != nil {
		return 0, fmt.Errorf("invalid time %q, expected HH:MM", value)
	}
	if hours < 0 || hours > 24 || minutes < 0 || minutes > 59 || (hours == 24 && minutes != 0) {
		return 0, fmt.Errorf("invalid time %q", value)
	}
	return hours*60 + minutes, nil
}

func (w WorkingHours) Value() (driver.Value, error) {
	b, err := json.Marshal(w)
	return string(b), err
}

func (w *WorkingHours) Scan(src any) error {
	if src == nil {
		*w = WorkingHours{}
		return nil
	}
	var b []byte
	switch v := src.(type) {
	case string:
		b = []byte(v)
	case []byte:
		b = v
	default:
		return errors.New("unsupported type for WorkingHours scan")
	}
	if len(b) == 0 {
		*w = WorkingHours{}
		return nil
	}
	return json.Unmarshal(b, w)
}
