// Package placement is the only face for writing times on the calendar.
// Auto-schedule Preview/Apply/Undo live in the schedule feature and call this
// store; Clarify, drag, pin, and Event times call it directly. Calendar items
// (the grid) are a different list — see ADR 0004 and 0006.
package placement

import (
	"errors"
	"time"
	"timely-api/internal/blocks"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"
)

type HoursLookup func(userID string) (models.WorkingHours, error)

type Service struct {
	blocks *blocks.Store
	hours  HoursLookup
}

func New(store *blocks.Store, hours HoursLookup) *Service {
	return &Service{blocks: store, hours: hours}
}

func (s *Service) Store() *blocks.Store {
	return s.blocks
}

func (s *Service) workingHours(userID string) models.WorkingHours {
	if s == nil || s.hours == nil {
		return models.DefaultWorkingHours("UTC")
	}
	hours, err := s.hours(userID)
	if err != nil || hours.IsEmpty() {
		return models.DefaultWorkingHours("UTC")
	}
	return hours
}

// PlaceWork writes one Manual block of duration minutes starting at start.
func (s *Service) PlaceWork(userID string, task *models.Task, start time.Time, duration int) error {
	if s == nil || s.blocks == nil {
		return nil
	}
	if duration <= 0 {
		return s.PlacePing(userID, task, start)
	}
	return s.blocks.ReplaceForTask(task.ID, userID, "", []models.ScheduledBlock{{
		StartAt: start,
		EndAt:   start.Add(time.Duration(duration) * time.Minute),
		Source:  models.BlockSourceManual,
	}})
}

// PlacePing stores a Reminder time. It does not reserve a Block.
func (s *Service) PlacePing(userID string, task *models.Task, start time.Time) error {
	if s == nil || s.blocks == nil {
		return nil
	}
	if err := s.blocks.DeleteForTask(task.ID, ""); err != nil {
		return err
	}
	return s.blocks.DB().Model(&models.Task{}).
		Where("id = ?", task.ID).
		Update("scheduled_on", start).Error
}

func (s *Service) ClearTask(taskID string) error {
	if s == nil || s.blocks == nil {
		return nil
	}
	return s.blocks.DeleteForTask(taskID, "")
}

func (s *Service) ReplaceWork(taskID, userID string, next []models.ScheduledBlock) error {
	if s == nil || s.blocks == nil {
		return nil
	}
	return s.blocks.ReplaceForTask(taskID, userID, "", next)
}

// PlaceEvent writes Manual blocks for a one-off Event. Repeating Events expand
// on read and do not store a Block per occurrence.
func (s *Service) PlaceEvent(userID string, event *models.Event) error {
	if s == nil || s.blocks == nil || event == nil {
		return nil
	}
	if event.Recurrence != nil && event.Recurrence.RRule != "" {
		return s.blocks.ReplaceForEvent(event.ID, userID, nil)
	}
	hours := s.workingHours(userID)
	loc := hours.Location(event.StartAt.Location())
	if loc == nil {
		loc = time.UTC
	}
	var next []models.ScheduledBlock
	if event.AllDay {
		for _, span := range hours.IntervalsOn(event.StartAt, loc) {
			next = append(next, models.ScheduledBlock{
				StartAt: span[0],
				EndAt:   span[1],
				Source:  models.BlockSourceManual,
			})
		}
	} else {
		duration := event.DurationMinutes()
		start := event.StartAt
		if len(event.Blocks) > 0 {
			for i, block := range event.Blocks {
				st := block.StartAt
				next = append(next, models.ScheduledBlock{
					StartAt:    st,
					EndAt:      st.Add(time.Duration(duration) * time.Minute),
					Source:     models.BlockSourceManual,
					ChunkIndex: i,
				})
			}
		} else {
			next = []models.ScheduledBlock{{
				StartAt: start,
				EndAt:   start.Add(time.Duration(duration) * time.Minute),
				Source:  models.BlockSourceManual,
			}}
		}
	}
	if len(next) == 0 {
		return errors.New("event needs at least one block")
	}
	if !event.AllDay && event.Duration > 0 {
		for i := range next {
			if int(next[i].EndAt.Sub(next[i].StartAt).Minutes()) != event.Duration {
				next[i].EndAt = next[i].StartAt.Add(time.Duration(event.Duration) * time.Minute)
			}
		}
	}
	return s.blocks.ReplaceForEvent(event.ID, userID, next)
}

// RewriteFutureAllDay replaces All-day Blocks on dates after today when Working
// hours change. Past All-day Blocks stay.
func (s *Service) RewriteFutureAllDay(userID string, hours models.WorkingHours) error {
	if s == nil || s.blocks == nil {
		return nil
	}
	loc := hours.Location(time.UTC)
	now := time.Now().In(loc)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	var events []models.Event
	if err := s.blocks.DB().
		Where("user_id = ? AND all_day = ?", userID, true).
		Where("id NOT IN (SELECT owner_id FROM recurrence_rules WHERE owner_type = ?)", models.RecurrenceOwnerEvent).
		Find(&events).Error; err != nil {
		return err
	}
	for i := range events {
		event := &events[i]
		if event.Recurrence != nil && event.Recurrence.RRule != "" {
			continue
		}
		if !event.StartAt.In(loc).After(today) && !sameDay(event.StartAt, today, loc) {
			continue
		}
		if event.StartAt.In(loc).Before(today) {
			continue
		}
		event.AllDay = true
		if err := s.PlaceEvent(userID, event); err != nil {
			return err
		}
	}
	return nil
}

func sameDay(a, today time.Time, loc *time.Location) bool {
	left := a.In(loc)
	return left.Year() == today.Year() && left.Month() == today.Month() && left.Day() == today.Day()
}

// ParseStart is a small helper so callers don't import recurrence just to place.
func ParseStart(raw string) (time.Time, error) {
	return recurrence.ParseTime(raw)
}
