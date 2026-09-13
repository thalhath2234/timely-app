// Package calendar turns tasks, events and their recurrence rules into a flat
// list of calendar items for a date range. The frontend renders these without
// knowing where each one came from, and the scheduling engine reads them as
// busy time.
package calendar

import (
	"fmt"
	"sort"
	"time"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"
)

const (
	KindTask            = "task"
	KindEvent           = "event"
	KindTaskOccurrence  = "taskOccurrence"
	KindEventOccurrence = "eventOccurrence"
)

// Item is one thing drawn on the calendar.
type Item struct {
	ID     string    `json:"id"`
	Kind   string    `json:"kind"`
	Title  string    `json:"title"`
	Start  time.Time `json:"start"`
	End    time.Time `json:"end"`
	AllDay bool      `json:"allDay"`
	Color  *string   `json:"color"`

	// Task blocks
	BlockID    string `json:"blockId,omitempty"`
	Source     string `json:"source,omitempty"`
	ChunkIndex int    `json:"chunkIndex"`
	ChunkCount int    `json:"chunkCount"`

	TaskID  string `json:"taskId,omitempty"`
	EventID string `json:"eventId,omitempty"`

	// Occurrences
	SeriesID      string     `json:"seriesId,omitempty"`
	OriginalStart *time.Time `json:"originalStart,omitempty"`
	Moved         bool       `json:"moved,omitempty"`
	CompletedAt   *time.Time `json:"completedAt,omitempty"`

	Task  *models.Task  `json:"task,omitempty"`
	Event *models.Event `json:"event,omitempty"`

	// Reminder is a timed ping with no work estimate. It is drawn on the
	// calendar but does not occupy auto-schedule busy time.
	Reminder bool `json:"reminder,omitempty"`
}

// Collect expands everything that overlaps [from, to). Tasks must have their
// Blocks and Recurrence preloaded; events their Recurrence.
func Collect(tasks []models.Task, events []models.Event, from, to time.Time) ([]Item, error) {
	var items []Item

	for i := range tasks {
		task := &tasks[i]
		if task.IsRecurring() {
			if task.IsSchedulableWork() {
				chunkCount := len(task.Blocks)
				for _, block := range task.Blocks {
					if !block.StartAt.Before(to) || !block.EndAt.After(from) {
						continue
					}
					item := taskBlockItem(task, block, chunkCount)
					if block.OccurrenceStart != nil {
						original := *block.OccurrenceStart
						item.OriginalStart = &original
						item.SeriesID = task.Recurrence.ID
						item.Kind = KindTaskOccurrence
					}
					items = append(items, item)
				}
				continue
			}
			occurrences, err := recurrence.Expand(task.Recurrence, taskDuration(task), from, to)
			if err != nil {
				return nil, fmt.Errorf("task %s: %w", task.ID, err)
			}
			for _, occurrence := range occurrences {
				items = append(items, taskOccurrenceItem(task, occurrence))
			}
			continue
		}

		if task.IsReminder() {
			if item, ok := oneOffReminderItem(task, from, to); ok {
				items = append(items, item)
			}
			continue
		}

		chunkCount := len(task.Blocks)
		for _, block := range task.Blocks {
			if !block.StartAt.Before(to) || !block.EndAt.After(from) {
				continue
			}
			items = append(items, taskBlockItem(task, block, chunkCount))
		}
	}

	for i := range events {
		event := &events[i]
		if event.Recurrence != nil && event.Recurrence.RRule != "" {
			duration := event.EndAt.Sub(event.StartAt)
			occurrences, err := recurrence.Expand(event.Recurrence, duration, from, to)
			if err != nil {
				return nil, fmt.Errorf("event %s: %w", event.ID, err)
			}
			for _, occurrence := range occurrences {
				items = append(items, eventOccurrenceItem(event, occurrence))
			}
			continue
		}
		if !event.StartAt.Before(to) || !event.EndAt.After(from) {
			continue
		}
		items = append(items, eventItem(event))
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].Start.Equal(items[j].Start) {
			return items[i].ID < items[j].ID
		}
		return items[i].Start.Before(items[j].Start)
	})
	return items, nil
}

func taskDuration(task *models.Task) time.Duration {
	if task.IsReminder() {
		return 0
	}
	return time.Duration(task.Duration) * time.Minute
}

func oneOffReminderItem(task *models.Task, from, to time.Time) (Item, bool) {
	if task.ScheduledOn == nil || *task.ScheduledOn == "" {
		return Item{}, false
	}
	start, err := recurrence.ParseTime(*task.ScheduledOn)
	if err != nil {
		return Item{}, false
	}
	if !start.Before(to) || !start.Add(time.Second).After(from) {
		return Item{}, false
	}
	return reminderItem(task, start), true
}

func reminderItem(task *models.Task, start time.Time) Item {
	return Item{
		ID:       task.ID + "@reminder",
		Kind:     KindTask,
		Title:    task.Name,
		Start:    start,
		End:      start,
		Color:    taskColor(task),
		TaskID:   task.ID,
		Task:     task,
		Reminder: true,
	}
}

func taskColor(task *models.Task) *string {
	if task.Status != nil && task.Status.Color != "" {
		color := task.Status.Color
		return &color
	}
	return nil
}

func taskBlockItem(task *models.Task, block models.ScheduledBlock, chunkCount int) Item {
	return Item{
		ID:         block.ID,
		Kind:       KindTask,
		Title:      task.Name,
		Start:      block.StartAt,
		End:        block.EndAt,
		Color:      taskColor(task),
		BlockID:    block.ID,
		Source:     block.Source,
		ChunkIndex: block.ChunkIndex,
		ChunkCount: chunkCount,
		TaskID:     task.ID,
		Task:       task,
	}
}

func taskOccurrenceItem(task *models.Task, occurrence recurrence.Occurrence) Item {
	original := occurrence.OriginalStart
	end := occurrence.End
	if task.IsReminder() {
		end = occurrence.Start
	}
	return Item{
		ID:            task.ID + "@" + original.UTC().Format(time.RFC3339),
		Kind:          KindTaskOccurrence,
		Title:         task.Name,
		Start:         occurrence.Start,
		End:           end,
		Color:         taskColor(task),
		TaskID:        task.ID,
		SeriesID:      task.Recurrence.ID,
		OriginalStart: &original,
		Moved:         occurrence.Moved,
		CompletedAt:   occurrence.CompletedAt,
		Task:          task,
		Reminder:      task.IsReminder(),
	}
}

func eventItem(event *models.Event) Item {
	return Item{
		ID:      event.ID,
		Kind:    KindEvent,
		Title:   event.Title,
		Start:   event.StartAt,
		End:     event.EndAt,
		AllDay:  event.AllDay,
		Color:   event.Color,
		EventID: event.ID,
		Event:   event,
	}
}

func eventOccurrenceItem(event *models.Event, occurrence recurrence.Occurrence) Item {
	original := occurrence.OriginalStart
	return Item{
		ID:            event.ID + "@" + original.UTC().Format(time.RFC3339),
		Kind:          KindEventOccurrence,
		Title:         event.Title,
		Start:         occurrence.Start,
		End:           occurrence.End,
		AllDay:        event.AllDay,
		Color:         event.Color,
		EventID:       event.ID,
		SeriesID:      event.Recurrence.ID,
		OriginalStart: &original,
		Moved:         occurrence.Moved,
		Event:         event,
	}
}
