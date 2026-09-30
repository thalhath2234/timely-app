package recurrence

import (
	"errors"
	"sort"
	"time"
	"timely-api/internal/models"
)

// Occurrence is one expanded instance of a series after exceptions are applied.
type Occurrence struct {
	// OriginalStart identifies the instance inside the series and is the key
	// exceptions are stored under, even when the instance has been moved.
	OriginalStart time.Time
	Start         time.Time
	End           time.Time
	Moved         bool
	CompletedAt   *time.Time
}

// ParseInput validates a client payload and returns the rule plus the parsed
// dtstart in the requested zone.
func ParseInput(input models.RecurrenceInput) (*Rule, time.Time, *time.Location, error) {
	rule, err := Parse(input.RRule)
	if err != nil {
		return nil, time.Time{}, nil, err
	}
	loc := time.UTC
	if input.Timezone != "" {
		parsed, err := time.LoadLocation(input.Timezone)
		if err != nil {
			return nil, time.Time{}, nil, errors.New("unknown timezone")
		}
		loc = parsed
	}
	if input.Dtstart == "" {
		return nil, time.Time{}, nil, errors.New("recurrence requires a start date and time")
	}
	dtstart, err := ParseTimeIn(input.Dtstart, loc)
	if err != nil {
		return nil, time.Time{}, nil, errors.New("invalid recurrence start")
	}
	return rule, dtstart.In(loc), loc, nil
}

var zonedLayouts = []string{
	time.RFC3339Nano,
	time.RFC3339,
	"2006-01-02 15:04:05.999999999-07",
	"2006-01-02 15:04:05.999999999-07:00",
	"2006-01-02 15:04:05-07",
}

var naiveLayouts = []string{
	"2006-01-02T15:04:05",
	"2006-01-02T15:04",
	"2006-01-02",
}

// ParseTime accepts the timestamp formats clients and Postgres produce. Values
// without a zone are read as UTC.
func ParseTime(value string) (time.Time, error) {
	return ParseTimeIn(value, time.UTC)
}

// ParseTimeIn is ParseTime with zone-less values interpreted in loc.
func ParseTimeIn(value string, loc *time.Location) (time.Time, error) {
	for _, layout := range zonedLayouts {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed, nil
		}
	}
	for _, layout := range naiveLayouts {
		if parsed, err := time.ParseInLocation(layout, value, loc); err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, errors.New("invalid timestamp: " + value)
}

// Expand lists the occurrences of a stored rule inside [from, to), applying its
// exceptions. duration sets the end of each instance unless an exception moved
// it with an explicit new end.
func Expand(rule *models.RecurrenceRule, duration time.Duration, from, to time.Time) ([]Occurrence, error) {
	parsed, err := Parse(rule.RRule)
	if err != nil {
		return nil, err
	}
	dtstart := rule.Dtstart.In(rule.Location())

	exceptions := make(map[int64]models.RecurrenceException, len(rule.Exceptions))
	for _, exception := range rule.Exceptions {
		exceptions[exception.OriginalStart.Unix()] = exception
	}

	// Moved instances can land inside the window even when their original
	// slot is outside it, so expand generously and filter on the final start.
	pad := 62 * 24 * time.Hour
	starts := parsed.Between(dtstart, from.Add(-pad), to.Add(pad))

	// Retain explicitly adjusted occurrences even if a future-series edit
	// removes their original weekday from the rule.
	seen := map[int64]bool{}
	for _, start := range starts {
		seen[start.Unix()] = true
	}
	for _, exception := range rule.Exceptions {
		if !seen[exception.OriginalStart.Unix()] {
			starts = append(starts, exception.OriginalStart)
		}
	}
	var out []Occurrence
	for _, start := range starts {
		occurrence := Occurrence{OriginalStart: start, Start: start, End: start.Add(duration)}
		if exception, ok := exceptions[start.Unix()]; ok {
			if exception.IsCancelled {
				continue
			}
			if exception.NewStart != nil {
				occurrence.Start = exception.NewStart.In(rule.Location())
				occurrence.Moved = true
				if exception.NewEnd != nil && exception.NewEnd.After(*exception.NewStart) {
					occurrence.End = exception.NewEnd.In(rule.Location())
				} else {
					occurrence.End = occurrence.Start.Add(duration)
				}
			}
			occurrence.CompletedAt = exception.CompletedAt
		}
		if occurrence.Start.Before(to) && occurrence.End.After(from) {
			out = append(out, occurrence)
		}
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Start.Before(out[j].Start) })
	return out, nil
}

// IsOccurrence reports whether `start` is a real instance of the rule.
func IsOccurrence(rule *models.RecurrenceRule, start time.Time) bool {
	for _, exception := range rule.Exceptions {
		if exception.OriginalStart.Equal(start) {
			return true
		}
	}
	parsed, err := Parse(rule.RRule)
	if err != nil {
		return false
	}
	dtstart := rule.Dtstart.In(rule.Location())
	for _, candidate := range parsed.Between(dtstart, start, start.Add(time.Second)) {
		if candidate.Equal(start) {
			return true
		}
	}
	return false
}
