package agent

import (
	"context"
	"fmt"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func (s *Server) getScheduleSettings(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	settings, err := s.Schedule.GetSettings(uid)
	if err != nil {
		return fail(err)
	}
	return reply("schedule settings", settings)
}

type settingsIn struct {
	BreakMinutes         *int     `json:"breakMinutes,omitempty"`
	FreezeHours          *int     `json:"freezeHours,omitempty"`
	ExcludedWorkspaceIds []string `json:"excludedWorkspaceIds,omitempty"`
}

func (s *Server) updateScheduleSettings(ctx context.Context, req *mcp.CallToolRequest, in settingsIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	current, err := s.Schedule.GetSettings(uid)
	if err != nil {
		return fail(err)
	}
	if in.BreakMinutes != nil {
		current.BreakMinutes = *in.BreakMinutes
	}
	if in.FreezeHours != nil {
		current.FreezeHours = *in.FreezeHours
	}
	if in.ExcludedWorkspaceIds != nil {
		current.ExcludedWorkspaceIds = in.ExcludedWorkspaceIds
	}
	updated, err := s.Schedule.UpdateSettings(uid, current)
	if err != nil {
		return fail(err)
	}
	return reply("schedule settings saved", updated)
}

type capacityIn struct {
	From     string `json:"from,omitempty"`
	To       string `json:"to,omitempty"`
	Timezone string `json:"timezone,omitempty"`
}

func (s *Server) getCapacity(ctx context.Context, req *mcp.CallToolRequest, in capacityIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	now := time.Now()
	from, to := now, now.AddDate(0, 0, 7)
	if in.From != "" {
		parsed, err := time.Parse(time.RFC3339, in.From)
		if err != nil {
			return fail(err)
		}
		from = parsed
	}
	if in.To != "" {
		parsed, err := time.Parse(time.RFC3339, in.To)
		if err != nil {
			return fail(err)
		}
		to = parsed
	}
	days, err := s.Schedule.Capacity(uid, from, to, zone(ctx, in.Timezone))
	if err != nil {
		return fail(err)
	}
	return reply("capacity", map[string]any{"days": days})
}

func (s *Server) undoSchedule(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	plan, err := s.Schedule.Undo(uid)
	if err != nil {
		return fail(err)
	}
	return reply("undid last schedule apply", plan)
}

func (s *Server) undoSchedulePreview(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	preview, err := s.Schedule.PreviewUndo(uid)
	if err != nil {
		return fail(err)
	}
	if !preview.CanUndo {
		return reply("no auto-schedule to undo", preview)
	}
	return reply(fmt.Sprintf("undo removes %d blocks and restores %d", len(preview.Remove), len(preview.Restore)), preview)
}

type pinIn struct {
	TaskID string `json:"taskId,omitempty"`
	Locked bool   `json:"locked"`
}

func (s *Server) pinTask(ctx context.Context, req *mcp.CallToolRequest, in pinIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	t, err := s.Schedule.PinTask(uid, in.TaskID, in.Locked)
	if err != nil {
		return fail(err)
	}
	return reply("task pin updated", taskPayload(t))
}

type pinBlockIn struct {
	BlockID string `json:"blockId"`
	Locked  bool   `json:"locked"`
}

func (s *Server) pinBlock(ctx context.Context, req *mcp.CallToolRequest, in pinBlockIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	block, err := s.Schedule.PinBlock(uid, in.BlockID, in.Locked)
	if err != nil {
		return fail(err)
	}
	return reply("block pin updated", block)
}
