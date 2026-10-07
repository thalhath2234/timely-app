// Package placement is the only writer of Blocks (ADR 0004) and of Reminder
// pings made by placing. Plain task-field edits that also carry scheduled_on
// (Inbox conversion) and account restore stay outside it.
// Auto-schedule Preview and Rank live in the schedule feature, which hands every
// write here (ApplyAutoSchedule, UndoAutoSchedule); Clarify, drag, pin, and
// Event times call Placement directly. The Block store is private to this
// package. Calendar items (the grid) are a different list — see ADR 0004 and 0006.
package placement

import (
	"errors"
	"time"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"

	"gorm.io/gorm"
)

type HoursLookup func(userID string) (models.WorkingHours, error)

type Service struct {
	blocks *blockStore
	hours  HoursLookup
}

func New(db *gorm.DB, hours HoursLookup) *Service {
	return &Service{blocks: newBlockStore(db), hours: hours}
}

// WithTx returns a Service whose writes run in tx, for a caller that must keep
// them atomic with its own rows (task.Split). A nil Service stays nil.
func (s *Service) WithTx(tx *gorm.DB) *Service {
	if s == nil || s.blocks == nil {
		return s
	}
	return &Service{blocks: s.blocks.WithTx(tx), hours: s.hours}
}

// errNotConfigured is what entry points that return a value or a Block report
// on an unwired Service. The older write helpers (PlaceWork, PlacePing,
// ClearTask, ...) keep their silent no-op so callers whose tests pass a nil
// Placement still run; a hand placement or an Auto-schedule Apply that quietly
// did nothing would look like success, so those fail loudly instead.
var errNotConfigured = errors.New("placement is not configured")

func (s *Service) ready() error {
	if s == nil || s.blocks == nil {
		return errNotConfigured
	}
	return nil
}

// workingHours is the only Working-hours fallback Placement uses: no lookup, a
// lookup error, or no saved row all give the empty WorkingHours{}. Empty means
// "the person never saved hours", which placeLocation needs in order to keep
// an Event's own zone. The calendar grid read (calendar.service.workingHours)
// deliberately differs: it substitutes DefaultWorkingHours("UTC") because a read
// has no Event zone to keep and must draw every day in one zone. The windows
// are identical either way (WindowsOn treats empty as Monday–Friday 09:00–17:00).
func (s *Service) workingHours(userID string) models.WorkingHours {
	if s == nil || s.hours == nil {
		return models.WorkingHours{}
	}
	hours, err := s.hours(userID)
	if err != nil || hours.IsEmpty() {
		return models.WorkingHours{}
	}
	return hours
}

// placeLocation uses Working hours when the user has saved them. Otherwise it
// keeps the Event's own zone. A missing hours row must not force UTC: Postgres
// reloads timestamptz without the offset the client sent.
func placeLocation(hours models.WorkingHours, event *models.Event) *time.Location {
	fallback := time.UTC
	if event != nil && event.Recurrence != nil && event.Recurrence.Timezone != "" {
		fallback = event.Recurrence.Location()
	} else if event != nil && event.StartAt.Location() != nil {
		fallback = event.StartAt.Location()
	}
	if hours.IsEmpty() {
		return fallback
	}
	loc := hours.Location(fallback)
	if loc == nil {
		return fallback
	}
	return loc
}

// PlaceWork writes one Manual block of duration minutes starting at start. It
// replaces the task's own Blocks and leaves every other Work Block where it is,
// even when they overlap: this is the Clarify / task create scheduledOn path.
// Whether it should push aside overlapping Work the way PlaceByHand does is an
// open product question; do not change it silently. Setting scheduledOn on an
// existing task (task update, update_task) is placing by hand and uses
// PlaceByHand (ADR 0010).
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

// PlacePing stores a Reminder ping time. It does not reserve a Block, so the
// task's Blocks are dropped and scheduled_on carries the ping.
func (s *Service) PlacePing(userID string, task *models.Task, start time.Time) error {
	if s == nil || s.blocks == nil {
		return nil
	}
	if err := s.blocks.DeleteForTask(task.ID, ""); err != nil {
		return err
	}
	return s.blocks.DB().Model(&models.Task{}).
		Where("id = ? AND user_id = ?", task.ID, userID).
		Update("scheduled_on", start).Error
}

// ClearTask removes the task's Blocks. A Reminder's ping is not a Block; use
// ClearTimes to drop that too.
func (s *Service) ClearTask(taskID string) error {
	if s == nil || s.blocks == nil {
		return nil
	}
	return s.blocks.DeleteForTask(taskID, "")
}

// ClearTimes removes everything that puts the task on the calendar: its Blocks
// and, for a Reminder, its ping.
func (s *Service) ClearTimes(userID string, task *models.Task) error {
	if s == nil || s.blocks == nil {
		return nil
	}
	if err := s.blocks.DeleteForTask(task.ID, ""); err != nil {
		return err
	}
	if !task.IsReminder() {
		return nil
	}
	return s.blocks.DB().Model(&models.Task{}).
		Where("id = ? AND user_id = ?", task.ID, userID).
		Update("scheduled_on", nil).Error
}

// PlaceSeries turns the task into a series: its calendar presence comes from
// expanded occurrences, so any one-off Blocks are dropped and scheduled_on
// mirrors the series start (dtstart) for list sorting. It is not a ping.
func (s *Service) PlaceSeries(userID string, task *models.Task, dtstart time.Time) error {
	if s == nil || s.blocks == nil {
		return nil
	}
	if err := s.blocks.DeleteForTask(task.ID, ""); err != nil {
		return err
	}
	return s.blocks.DB().Model(&models.Task{}).
		Where("id = ? AND user_id = ?", task.ID, userID).
		Update("scheduled_on", dtstart).Error
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
	loc := placeLocation(hours, event)
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
	// Same fallback as task.DayLocation, which this package cannot import:
	// saved Working hours, else the server's zone (ADR 0011).
	loc := hours.Location(time.Local)
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
