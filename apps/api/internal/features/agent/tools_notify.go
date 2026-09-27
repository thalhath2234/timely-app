package agent

import (
	"context"
	"errors"
	"fmt"
	"timely-api/internal/features/notify"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type listNotificationsIn struct {
	Unread bool `json:"unread,omitempty"`
	Limit  int  `json:"limit,omitempty"`
}

func (s *Server) unreadNotificationCount(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if s.Notify == nil {
		return fail(errors.New("notifications are not available"))
	}
	count, err := s.Notify.UnreadCount(uid)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%d unread", count), map[string]any{"count": count})
}

func (s *Server) rescheduleUrgent(ctx context.Context, req *mcp.CallToolRequest, in taskIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if s.Notify == nil {
		return fail(errors.New("notifications are not available"))
	}
	plan, err := s.Notify.PrioritizeOverdue(uid, in.TaskID)
	if err != nil {
		return fail(err)
	}
	return reply("rescheduled overdue task as urgent", plan)
}

func (s *Server) listNotifications(ctx context.Context, req *mcp.CallToolRequest, in listNotificationsIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if s.Notify == nil {
		return fail(errors.New("notifications are not available"))
	}
	rows, err := s.Notify.List(uid, in.Unread, in.Limit)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%d notifications", len(rows)), rows)
}

type markNotificationIn struct {
	ID string `json:"id,omitempty"`
}

func (s *Server) markNotificationRead(ctx context.Context, req *mcp.CallToolRequest, in markNotificationIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if s.Notify == nil {
		return fail(errors.New("notifications are not available"))
	}
	if in.ID == "" {
		if err := s.Notify.MarkAllRead(uid); err != nil {
			return fail(err)
		}
		return reply("all notifications marked read", map[string]any{"ok": true})
	}
	row, err := s.Notify.MarkRead(uid, in.ID)
	if err != nil {
		return fail(err)
	}
	return reply("notification marked read", row)
}

func (s *Server) clearNotifications(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if s.Notify == nil {
		return fail(errors.New("notifications are not available"))
	}
	if err := s.Notify.ClearAll(uid); err != nil {
		return fail(err)
	}
	return reply("notifications cleared", map[string]any{"ok": true})
}

type snoozeIn struct {
	ID      string `json:"id" jsonschema:"notification id"`
	Minutes int    `json:"minutes,omitempty"`
	Until   string `json:"until,omitempty" jsonschema:"RFC3339"`
}

func (s *Server) snoozeReminder(ctx context.Context, req *mcp.CallToolRequest, in snoozeIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if s.Notify == nil {
		return fail(errors.New("notifications are not available"))
	}
	row, err := s.Notify.Snooze(uid, in.ID, notify.SnoozeInput{Minutes: in.Minutes, Until: in.Until})
	if err != nil {
		return fail(err)
	}
	return reply("reminder snoozed", row)
}

func (s *Server) getNotificationSettings(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if s.Notify == nil {
		return fail(errors.New("notifications are not available"))
	}
	settings, err := s.Notify.GetSettings(uid)
	if err != nil {
		return fail(err)
	}
	return reply("notification settings", settings)
}

type notificationSettingsIn struct {
	Reminders       *bool   `json:"reminders,omitempty"`
	DigestMorning   *bool   `json:"digestMorning,omitempty"`
	DigestEvening   *bool   `json:"digestEvening,omitempty"`
	Planning        *bool   `json:"planning,omitempty"`
	QuietHoursStart *string `json:"quietHoursStart,omitempty"`
	QuietHoursEnd   *string `json:"quietHoursEnd,omitempty"`
	Timezone        *string `json:"timezone,omitempty"`
	MorningDigestAt *string `json:"morningDigestAt,omitempty"`
	EveningDigestAt *string `json:"eveningDigestAt,omitempty"`
}

func (s *Server) updateNotificationSettings(ctx context.Context, req *mcp.CallToolRequest, in notificationSettingsIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if s.Notify == nil {
		return fail(errors.New("notifications are not available"))
	}
	current, err := s.Notify.GetSettings(uid)
	if err != nil {
		return fail(err)
	}
	if in.Reminders != nil {
		current.Reminders = *in.Reminders
	}
	if in.DigestMorning != nil {
		current.DigestMorning = *in.DigestMorning
	}
	if in.DigestEvening != nil {
		current.DigestEvening = *in.DigestEvening
	}
	if in.Planning != nil {
		current.Planning = *in.Planning
	}
	if in.QuietHoursStart != nil {
		current.QuietHoursStart = *in.QuietHoursStart
	}
	if in.QuietHoursEnd != nil {
		current.QuietHoursEnd = *in.QuietHoursEnd
	}
	if in.Timezone != nil {
		current.Timezone = *in.Timezone
	}
	if in.MorningDigestAt != nil {
		current.MorningDigestAt = *in.MorningDigestAt
	}
	if in.EveningDigestAt != nil {
		current.EveningDigestAt = *in.EveningDigestAt
	}
	updated, err := s.Notify.UpdateSettings(uid, current)
	if err != nil {
		return fail(err)
	}
	return reply("notification settings saved", updated)
}

type listJobsIn struct {
	Status string `json:"status,omitempty"`
	Limit  int    `json:"limit,omitempty"`
}

func (s *Server) listJobs(ctx context.Context, req *mcp.CallToolRequest, in listJobsIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if s.Jobs == nil {
		return fail(errors.New("jobs are not available"))
	}
	rows, err := s.Jobs.List(uid, in.Status, in.Limit)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%d jobs", len(rows)), rows)
}

type retryJobIn struct {
	ID string `json:"id" jsonschema:"job id"`
}

func (s *Server) retryJob(ctx context.Context, req *mcp.CallToolRequest, in retryJobIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if s.Jobs == nil {
		return fail(errors.New("jobs are not available"))
	}
	job, err := s.Jobs.Retry(uid, in.ID)
	if err != nil {
		return fail(err)
	}
	return reply("job requeued", job)
}

func (s *Server) getJobHealth(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if s.Jobs == nil {
		return fail(errors.New("jobs are not available"))
	}
	health, err := s.Jobs.Health(uid)
	if err != nil {
		return fail(err)
	}
	return reply("job health", health)
}
