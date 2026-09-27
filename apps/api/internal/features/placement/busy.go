package placement

import (
	"time"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"
)

// Occupancy is one busy interval for Auto-schedule. Reminder pings are omitted.
// All-day Events contribute their Working-hour Blocks (or synthesized windows).
type Occupancy struct {
	Start           time.Time
	End             time.Time
	TaskID          string
	EventID         string
	Source          string
	OccurrenceStart *time.Time
	Completed       bool
	SchedulableWork bool
}

// Busy is Auto-schedule's occupancy list. It is not Calendar items (ADR 0006).
func Busy(tasks []models.Task, events []models.Event, from, to time.Time, hours models.WorkingHours) []Occupancy {
	loc := hours.Location(from.Location())
	if loc == nil {
		loc = time.UTC
	}
	var out []Occupancy
	for i := range tasks {
		t := &tasks[i]
		if t.IsCompleted() || t.IsInbox() || t.IsReminder() {
			continue
		}
		for _, block := range t.Blocks {
			if !block.StartAt.Before(to) || !block.EndAt.After(from) {
				continue
			}
			item := Occupancy{
				Start:           block.StartAt,
				End:             block.EndAt,
				TaskID:          t.ID,
				Source:          block.Source,
				OccurrenceStart: block.OccurrenceStart,
				SchedulableWork: t.IsSchedulableWork(),
			}
			out = append(out, item)
		}
	}
	for i := range events {
		e := &events[i]
		out = append(out, eventBusy(e, from, to, hours, loc)...)
	}
	return out
}

func eventBusy(event *models.Event, from, to time.Time, hours models.WorkingHours, loc *time.Location) []Occupancy {
	if event.Recurrence != nil && event.Recurrence.RRule != "" {
		duration := time.Duration(event.DurationMinutes()) * time.Minute
		if event.AllDay {
			duration = time.Hour // expand dates; windows applied below
		}
		occurrences, err := recurrence.Expand(event.Recurrence, duration, from, to)
		if err != nil {
			return nil
		}
		var out []Occupancy
		for _, occ := range occurrences {
			if event.AllDay {
				for _, span := range hours.IntervalsOn(occ.Start, loc) {
					if !span[0].Before(to) || !span[1].After(from) {
						continue
					}
					out = append(out, Occupancy{
						Start: span[0], End: span[1], EventID: event.ID, Source: models.BlockSourceManual,
					})
				}
				continue
			}
			if !occ.Start.Before(to) || !occ.End.After(from) {
				continue
			}
			out = append(out, Occupancy{
				Start: occ.Start, End: occ.End, EventID: event.ID, Source: models.BlockSourceManual,
			})
		}
		return out
	}

	if len(event.Blocks) > 0 {
		var out []Occupancy
		for _, block := range event.Blocks {
			if !block.StartAt.Before(to) || !block.EndAt.After(from) {
				continue
			}
			out = append(out, Occupancy{
				Start: block.StartAt, End: block.EndAt, EventID: event.ID, Source: models.BlockSourceManual,
			})
		}
		return out
	}

	if event.AllDay {
		var out []Occupancy
		for _, span := range hours.IntervalsOn(event.StartAt, loc) {
			if !span[0].Before(to) || !span[1].After(from) {
				continue
			}
			out = append(out, Occupancy{
				Start: span[0], End: span[1], EventID: event.ID, Source: models.BlockSourceManual,
			})
		}
		return out
	}
	if !event.StartAt.Before(to) || !event.EndAt.After(from) {
		return nil
	}
	return []Occupancy{{
		Start: event.StartAt, End: event.EndAt, EventID: event.ID, Source: models.BlockSourceManual,
	}}
}
