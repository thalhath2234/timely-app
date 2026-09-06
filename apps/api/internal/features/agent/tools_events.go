package agent

import (
	"context"
	"fmt"
	"time"
	"timely-api/internal/features/event"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func parseEventTime(raw string) (time.Time, error) {
	if raw == "" {
		return time.Time{}, fmt.Errorf("time is required")
	}
	parsed, err := recurrence.ParseTimeIn(raw, time.Local)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid time %q", raw)
	}
	return parsed, nil
}

func (s *Server) listEvents(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	events, err := s.Events.ListByUser(uid)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%d events", len(events)), map[string]any{"events": events})
}

type eventIDIn struct {
	EventID string `json:"eventId"`
}

func (s *Server) getEvent(ctx context.Context, req *mcp.CallToolRequest, in eventIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	ev, err := s.Events.GetByID(uid, in.EventID)
	if err != nil {
		return fail(err)
	}
	return reply(ev.Title, ev)
}

type createEventIn struct {
	Title       string `json:"title"`
	Start       string `json:"start"`
	End         string `json:"end"`
	Description string `json:"description,omitempty"`
	AllDay      bool   `json:"allDay,omitempty"`
	Color       string `json:"color,omitempty"`
	WorkspaceID string `json:"workspaceId,omitempty"`
	ProjectID   string `json:"projectId,omitempty"`
	TaskID      string `json:"taskId,omitempty"`
	Recurrence  *recIn `json:"recurrence,omitempty"`
}

func (s *Server) createEvent(ctx context.Context, req *mcp.CallToolRequest, in createEventIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	start, err := parseEventTime(in.Start)
	if err != nil {
		return fail(err)
	}
	end, err := parseEventTime(in.End)
	if err != nil {
		return fail(err)
	}
	ev := &models.Event{
		Title:       in.Title,
		Description: in.Description,
		StartAt:     start,
		EndAt:       end,
		AllDay:      in.AllDay,
		Color:       strPtr(in.Color),
		WorkspaceID: strPtr(in.WorkspaceID),
		ProjectID:   strPtr(in.ProjectID),
		TaskID:      strPtr(in.TaskID),
	}
	var rec *models.RecurrenceInput
	if in.Recurrence != nil {
		rec = in.Recurrence.model()
	}
	created, err := s.Events.Create(uid, ev, rec)
	if err != nil {
		return fail(err)
	}
	return reply("created "+created.Title, created)
}

type updateEventIn struct {
	EventID         string  `json:"eventId"`
	Title           *string `json:"title,omitempty"`
	Description     *string `json:"description,omitempty"`
	Start           *string `json:"start,omitempty"`
	End             *string `json:"end,omitempty"`
	AllDay          *bool   `json:"allDay,omitempty"`
	Color           *string `json:"color,omitempty"`
	WorkspaceID     *string `json:"workspaceId,omitempty"`
	ProjectID       *string `json:"projectId,omitempty"`
	TaskID          *string `json:"taskId,omitempty"`
	Recurrence      *recIn  `json:"recurrence,omitempty"`
	ClearRecurrence bool    `json:"clearRecurrence,omitempty"`
}

func (s *Server) updateEvent(ctx context.Context, req *mcp.CallToolRequest, in updateEventIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	update := event.EventUpdate{
		Title:       in.Title,
		Description: in.Description,
		Start:       in.Start,
		End:         in.End,
		AllDay:      in.AllDay,
		Color:       in.Color,
		WorkspaceID: in.WorkspaceID,
		ProjectID:   in.ProjectID,
		TaskID:      in.TaskID,
	}
	if in.ClearRecurrence {
		update.RecurrenceSet = true
	} else if in.Recurrence != nil {
		update.RecurrenceSet = true
		update.Recurrence = in.Recurrence.model()
	}
	ev, err := s.Events.Update(uid, in.EventID, update)
	if err != nil {
		return fail(err)
	}
	return reply("updated "+ev.Title, ev)
}

func (s *Server) deleteEvent(ctx context.Context, req *mcp.CallToolRequest, in eventIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if err := s.Events.Delete(uid, in.EventID); err != nil {
		return fail(err)
	}
	return reply("event deleted", map[string]string{"id": in.EventID})
}

type editEventOccIn struct {
	EventID       string `json:"eventId"`
	OriginalStart string `json:"originalStart"`
	Action        string `json:"action" jsonschema:"skip, restore, or move"`
	NewStart      string `json:"newStart,omitempty"`
	NewEnd        string `json:"newEnd,omitempty"`
}

func (s *Server) editEventOccurrence(ctx context.Context, req *mcp.CallToolRequest, in editEventOccIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	ev, err := s.Events.EditOccurrence(uid, in.EventID, event.OccurrenceAction{
		OriginalStart: in.OriginalStart,
		Action:        in.Action,
		NewStart:      strPtr(in.NewStart),
		NewEnd:        strPtr(in.NewEnd),
	})
	if err != nil {
		return fail(err)
	}
	return reply(in.Action+" occurrence of "+ev.Title, ev)
}

type splitEventIn struct {
	EventID   string `json:"eventId"`
	FromStart string `json:"fromStart"`
	RRule     string `json:"rrule"`
	Dtstart   string `json:"dtstart,omitempty"`
	Timezone  string `json:"timezone,omitempty"`
	Title     string `json:"title,omitempty"`
	Start     string `json:"start,omitempty"`
	End       string `json:"end,omitempty"`
}

func (s *Server) splitEventSeries(ctx context.Context, req *mcp.CallToolRequest, in splitEventIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	input := event.SplitInput{
		FromStart: in.FromStart,
		Recurrence: models.RecurrenceInput{
			RRule:    in.RRule,
			Dtstart:  in.Dtstart,
			Timezone: in.Timezone,
		},
	}
	if in.Title != "" {
		input.Title = &in.Title
	}
	if in.Start != "" {
		input.Start = &in.Start
	}
	if in.End != "" {
		input.End = &in.End
	}
	ev, err := s.Events.Split(uid, in.EventID, input)
	if err != nil {
		return fail(err)
	}
	return reply("split series; new event "+ev.Title, ev)
}
