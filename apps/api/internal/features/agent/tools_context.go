package agent

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
	"timely-api/internal/features/calendar"
	"timely-api/internal/features/schedule"
	"timely-api/internal/features/search"
	"timely-api/internal/features/task"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type emptyIn struct{}

type searchIn struct {
	Query string `json:"query" jsonschema:"text to search for"`
	Limit int    `json:"limit,omitempty" jsonschema:"max hits, default 20"`
}

type semanticSearchIn struct {
	Query string   `json:"query" jsonschema:"natural language query"`
	Limit int      `json:"limit,omitempty" jsonschema:"max hits, default 20"`
	Kinds []string `json:"kinds,omitempty" jsonschema:"optional filter: task, project, doc, sheet, event"`
}

func (s *Server) search(ctx context.Context, req *mcp.CallToolRequest, in searchIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	hits, err := s.Search.Search(uid, in.Query, in.Limit)
	if err != nil {
		return fail(err)
	}
	if hits == nil {
		hits = []search.Hit{}
	}
	return reply(fmt.Sprintf("%d hits for %q", len(hits), in.Query), map[string]any{"hits": hits})
}

func (s *Server) semanticSearch(ctx context.Context, req *mcp.CallToolRequest, in semanticSearchIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	hits, err := s.Search.SemanticSearch(ctx, uid, in.Query, in.Limit, in.Kinds)
	if err != nil {
		return fail(err)
	}
	if hits == nil {
		hits = []search.Hit{}
	}
	return reply(fmt.Sprintf("%d semantic hits for %q", len(hits), in.Query), map[string]any{"hits": hits})
}

func (s *Server) reindexSearch(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	n, err := s.Search.Reindex(ctx, uid)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("reindexed %d items", n), map[string]any{"indexed": n})
}

func (s *Server) getContext(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	user, onboarding, err := s.Auth.GetProfile(uid)
	if err != nil {
		return fail(err)
	}
	workspaces, err := s.Workspaces.GetAllWorkspaceByUser(uid)
	if err != nil {
		return fail(err)
	}
	projects, err := s.Projects.GetAllProjectByUser(uid)
	if err != nil {
		return fail(err)
	}
	hours, err := s.Schedule.GetWorkingHours(uid, "")
	if err != nil {
		return fail(err)
	}
	config, err := s.Workspaces.GetConfig(uid)
	if err != nil {
		return fail(err)
	}

	type projectSum struct {
		ID             string   `json:"id"`
		Title          string   `json:"title"`
		WorkspaceID    string   `json:"workspaceId"`
		Completed      bool     `json:"completed"`
		DoesHaveStages bool     `json:"doesHaveStages"`
		StatusID       string   `json:"statusId,omitempty"`
		PriorityLevel  string   `json:"priorityLevel,omitempty"`
		Deadline       string   `json:"deadline,omitempty"`
		StartDate      string   `json:"startDate,omitempty"`
		Stages         []string `json:"stages"`
		Open           int      `json:"open"`
		Done           int      `json:"done"`
		Progress       int      `json:"progress"`
	}
	tasks, _ := s.Tasks.List(uid, task.TaskFilter{Limit: 2000})
	sums := make([]projectSum, 0, len(projects))
	for _, p := range projects {
		stats := projectSummary(p, tasks)
		stageNames, _ := stats["stages"].([]string)
		open, _ := stats["open"].(int)
		done, _ := stats["completedCount"].(int)
		progress, _ := stats["progress"].(int)
		sums = append(sums, projectSum{
			ID:             p.ID,
			Title:          p.Title,
			WorkspaceID:    deref(p.WorkspaceID),
			Completed:      p.CompletedAt != nil && *p.CompletedAt != "",
			DoesHaveStages: p.DoesHaveStages,
			StatusID:       deref(p.StatusID),
			PriorityLevel:  deref(p.PriorityLevel),
			Deadline:       deref(p.Deadline),
			StartDate:      deref(p.StartDate),
			Stages:         stageNames,
			Open:           open,
			Done:           done,
			Progress:       progress,
		})
	}

	out := map[string]any{
		"user": map[string]any{
			"id": user.ID, "email": user.Email, "name": user.Name,
			"onboardingCompleted": onboarding,
		},
		"now":          time.Now().Format(time.RFC3339),
		"timezone":     hours.Timezone,
		"workingHours": hours,
		"workspaces":   workspaces,
		"projects":     sums,
		"activeViewId": config.ActiveTaskViewId,
		"taskViews":    config.TaskViews,
	}
	return reply(fmt.Sprintf("%s — %d workspaces, %d projects, zone %s", user.Email, len(workspaces), len(projects), hours.Timezone), out)
}

type rangeIn struct {
	From     string `json:"from,omitempty" jsonschema:"RFC3339 start, defaults to start of today"`
	To       string `json:"to,omitempty" jsonschema:"RFC3339 end, defaults to from+1 day"`
	Timezone string `json:"timezone,omitempty"`
}

func (s *Server) parseRange(in rangeIn, days int) (time.Time, time.Time, *time.Location, error) {
	loc := time.Local
	if in.Timezone != "" {
		if parsed, err := time.LoadLocation(in.Timezone); err == nil {
			loc = parsed
		}
	}
	now := time.Now().In(loc)
	from := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	if in.From != "" {
		parsed, err := recurrence.ParseTimeIn(in.From, loc)
		if err != nil {
			return time.Time{}, time.Time{}, loc, fmt.Errorf("invalid from")
		}
		from = parsed
	}
	to := from.AddDate(0, 0, days)
	if in.To != "" {
		parsed, err := recurrence.ParseTimeIn(in.To, loc)
		if err != nil {
			return time.Time{}, time.Time{}, loc, fmt.Errorf("invalid to")
		}
		to = parsed
	}
	return from, to, loc, nil
}

func (s *Server) getAgenda(ctx context.Context, req *mcp.CallToolRequest, in rangeIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	from, to, loc, err := s.parseRange(in, 1)
	if err != nil {
		return fail(err)
	}
	cal, err := s.Calendar.Range(uid, from, to)
	if err != nil {
		return fail(err)
	}
	tasks, err := s.Tasks.List(uid, task.TaskFilter{Limit: 500})
	if err != nil {
		return fail(err)
	}
	now := time.Now().In(loc)
	overdue := make([]map[string]string, 0)
	unscheduled := make([]map[string]string, 0)
	for _, t := range tasks {
		if t.IsCompleted() || t.IsReminder() {
			continue
		}
		if task.IsOverdue(t, now) && !task.HasRemainingSchedule(t, now) {
			entry := map[string]string{"id": t.ID, "name": t.Name}
			if t.Deadline != nil && *t.Deadline != "" {
				entry["deadline"] = *t.Deadline
			}
			if t.ScheduledOn != nil && *t.ScheduledOn != "" {
				entry["scheduledOn"] = *t.ScheduledOn
			}
			overdue = append(overdue, entry)
		}
		if !t.IsRecurring() && len(t.Blocks) == 0 {
			unscheduled = append(unscheduled, map[string]string{"id": t.ID, "name": t.Name})
		}
	}
	agendaItems := []calendar.Item{}
	for _, item := range cal.Items {
		if item.Reminder {
			continue
		}
		agendaItems = append(agendaItems, item)
	}
	lines := []string{fmt.Sprintf("Agenda %s → %s (%s)", from.In(loc).Format("Mon Jan 2 15:04"), to.In(loc).Format("Mon Jan 2 15:04"), loc)}
	for _, item := range agendaItems {
		stamp := item.Start.In(loc).Format("15:04")
		if item.AllDay {
			stamp = "all-day"
		}
		lines = append(lines, fmt.Sprintf("- %s %s [%s]", stamp, item.Title, item.Kind))
	}
	if len(overdue) > 0 {
		lines = append(lines, fmt.Sprintf("%d overdue", len(overdue)))
		for _, item := range overdue {
			stamp := item["scheduledOn"]
			if stamp == "" {
				stamp = item["deadline"]
			}
			if stamp == "" {
				lines = append(lines, fmt.Sprintf("- %s", item["name"]))
				continue
			}
			lines = append(lines, fmt.Sprintf("- %s (%s)", item["name"], stamp))
		}
	}
	out := map[string]any{"from": from, "to": to, "items": agendaItems, "overdue": overdue, "unscheduled": unscheduled, "text": strings.Join(lines, "\n")}
	return reply(strings.Join(lines, "\n"), out)
}

func (s *Server) getFreeTime(ctx context.Context, req *mcp.CallToolRequest, in rangeIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	from, to, loc, err := s.parseRange(in, 1)
	if err != nil {
		return fail(err)
	}
	free, err := s.Schedule.FreeTime(uid, from, to, loc.String())
	if err != nil {
		return fail(err)
	}
	minutes := 0
	for _, slot := range free {
		minutes += slot.Minutes()
	}
	return reply(fmt.Sprintf("%d free minutes in %d slots", minutes, len(free)), map[string]any{"slots": free, "freeMinutes": minutes})
}

func (s *Server) whatNext(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	tasks, err := s.Tasks.List(uid, task.TaskFilter{Completed: boolPtr(false), Limit: 500})
	if err != nil {
		return fail(err)
	}
	now := time.Now()
	today := now.Format("2006-01-02")
	type ranked struct {
		ID, Name, Reason string
		Reasons          []string
		Score            int
	}
	var list []ranked
	for _, t := range tasks {
		if t.IsInbox() || t.IsReminder() {
			continue
		}
		deadline := (*time.Time)(nil)
		if t.Deadline != nil && *t.Deadline != "" {
			if parsed, err := time.Parse("2006-01-02", models.NormalizeDate(*t.Deadline)); err == nil {
				deadline = &parsed
			}
		}
		rank := schedule.ScoreTask(schedule.ScoreInput{
			Priority:      deref(t.PriorityLevel),
			Deadline:      deadline,
			Now:           now,
			Blocked:       t.BlockedByID != nil && *t.BlockedByID != "",
			Unscheduled:   len(t.Blocks) == 0 && !t.IsRecurring(),
			TodayFocus:    models.NormalizeDate(deref(t.TodayFocusOn)) == today,
			ActualMinutes: t.ActualMinutes,
			Duration:      t.Duration,
		})
		list = append(list, ranked{
			ID: t.ID, Name: t.Name, Reason: strings.Join(rank.Reasons, ", "), Reasons: rank.Reasons, Score: rank.Score,
		})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Score > list[j].Score })
	if len(list) > 15 {
		list = list[:15]
	}
	summary := "Nothing waiting."
	if len(list) > 0 {
		summary = fmt.Sprintf("Next: %s (%s)", list[0].Name, list[0].Reason)
	}
	return reply(summary, map[string]any{"tasks": list})
}

func deref(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func (s *Server) getCalendar(ctx context.Context, req *mcp.CallToolRequest, in rangeIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	from, to, _, err := s.parseRange(in, 7)
	if err != nil {
		return fail(err)
	}
	cal, err := s.Calendar.Range(uid, from, to)
	if err != nil {
		return fail(err)
	}
	if cal.Items == nil {
		cal.Items = []calendar.Item{}
	}
	return reply(fmt.Sprintf("%d calendar items", len(cal.Items)), cal)
}

type hoursQueryIn struct {
	Timezone string `json:"timezone,omitempty" jsonschema:"IANA timezone fallback, same as HTTP ?tz="`
}

func (s *Server) getWorkingHours(ctx context.Context, req *mcp.CallToolRequest, in hoursQueryIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	hours, err := s.Schedule.GetWorkingHours(uid, in.Timezone)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("working hours in %s", hours.Timezone), hours)
}

type hoursIn struct {
	Timezone string                            `json:"timezone"`
	Days     map[string][]models.WorkingWindow `json:"days"`
}

func (s *Server) updateWorkingHours(ctx context.Context, req *mcp.CallToolRequest, in hoursIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	hours, err := s.Schedule.UpdateWorkingHours(uid, models.WorkingHours{Timezone: in.Timezone, Days: in.Days})
	if err != nil {
		return fail(err)
	}
	return reply("working hours saved", hours)
}

type planIn struct {
	TaskIDs       []string `json:"taskIds,omitempty"`
	From          string   `json:"from,omitempty"`
	To            string   `json:"to,omitempty"`
	Timezone      string   `json:"timezone,omitempty"`
	IncludeManual bool     `json:"includeManual,omitempty"`
}

func (s *Server) planReq(in planIn) schedule.PlanRequest {
	req := schedule.PlanRequest{TaskIDs: in.TaskIDs, Timezone: in.Timezone, IncludeManual: in.IncludeManual}
	if in.From != "" {
		req.From = &in.From
	}
	if in.To != "" {
		req.To = &in.To
	}
	return req
}

func (s *Server) autoSchedulePreview(ctx context.Context, req *mcp.CallToolRequest, in planIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	plan, err := s.Schedule.Preview(uid, s.planReq(in))
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("preview: %d placed, %d skipped", len(plan.Proposals), len(plan.Skipped)), plan)
}

func (s *Server) autoScheduleApply(ctx context.Context, req *mcp.CallToolRequest, in planIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	plan, err := s.Schedule.Apply(uid, s.planReq(in))
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("applied: %d placed, %d skipped", len(plan.Proposals), len(plan.Skipped)), plan)
}

type scheduleTaskIn struct {
	TaskID          string `json:"taskId"`
	Start           string `json:"start" jsonschema:"RFC3339 start"`
	End             string `json:"end,omitempty"`
	DurationMinutes int    `json:"durationMinutes,omitempty"`
	Replace         bool   `json:"replace,omitempty"`
}

func (s *Server) scheduleTask(ctx context.Context, req *mcp.CallToolRequest, in scheduleTaskIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	input := schedule.BlockInput{Start: in.Start, Replace: in.Replace}
	if in.End != "" {
		input.End = &in.End
	}
	if in.DurationMinutes > 0 {
		input.DurationMinutes = &in.DurationMinutes
	}
	t, err := s.Schedule.AddBlock(uid, in.TaskID, input)
	if err != nil {
		return fail(err)
	}
	return reply("scheduled "+t.Name, t)
}

type moveBlockIn struct {
	BlockID string `json:"blockId"`
	Start   string `json:"start"`
	End     string `json:"end,omitempty"`
}

func (s *Server) moveBlock(ctx context.Context, req *mcp.CallToolRequest, in moveBlockIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	var end *string
	if in.End != "" {
		end = &in.End
	}
	block, err := s.Schedule.MoveBlock(uid, in.BlockID, in.Start, end)
	if err != nil {
		return fail(err)
	}
	return reply("moved block", block)
}

type idIn struct {
	ID string `json:"id"`
}

func (s *Server) deleteBlock(ctx context.Context, req *mcp.CallToolRequest, in idIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	if err := s.Schedule.DeleteBlock(uid, in.ID); err != nil {
		return fail(err)
	}
	return reply("block deleted", map[string]string{"id": in.ID})
}

type taskIDIn struct {
	TaskID string `json:"taskId"`
}

func (s *Server) clearTaskBlocks(ctx context.Context, req *mcp.CallToolRequest, in taskIDIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	t, err := s.Schedule.ClearBlocks(uid, in.TaskID)
	if err != nil {
		return fail(err)
	}
	return reply("cleared blocks on "+t.Name, t)
}
