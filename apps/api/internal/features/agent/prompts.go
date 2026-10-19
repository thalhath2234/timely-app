package agent

import (
	"context"
	"fmt"
	"strings"
	"time"

	"timely-api/internal/features/task"
	"timely-api/internal/models"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Prompts are routines an MCP client offers the person by name. They only
// tell the model which tools to call, so chat, which plans its own steps,
// does not get them.

type promptDef struct {
	prompt *mcp.Prompt
	// text builds the message from the arguments; today is the account's date.
	text func(today time.Time, args map[string]string) (string, error)
}

var prompts = []promptDef{
	{
		prompt: &mcp.Prompt{Name: "plan_my_day", Description: "Look at a day's calendar, habits and open Work, then propose a plan and schedule it once you agree.",
			Arguments: []*mcp.PromptArgument{{Name: "date", Description: "YYYY-MM-DD; defaults to today"}}},
		text: func(today time.Time, args map[string]string) (string, error) {
			day, err := dayArg(args, "date", today)
			if err != nil {
				return "", err
			}
			d := day.Format("2006-01-02")
			return fmt.Sprintf(`Plan my day for %s (%s).
1. Call get_context, then get_agenda with from=%s, list_habits with today=%s, what_next, and get_free_time with from=%s.
2. Propose a plan: which tasks fit which free gaps, in order, and the habits still to do. Keep it short.
3. Change nothing until I agree. Then place each agreed task with schedule_task.`, d, day.Format("Monday"), d, d, d), nil
		},
	},
	{
		prompt: &mcp.Prompt{Name: "weekly_review", Description: "Review a week: what shipped, focused time, what slipped, and what comes next.",
			Arguments: []*mcp.PromptArgument{{Name: "weekStart", Description: "YYYY-MM-DD, the Monday of the week; defaults to this Monday"}}},
		text: func(today time.Time, args map[string]string) (string, error) {
			monday := today.AddDate(0, 0, -(int(today.Weekday())+6)%7)
			start, err := dayArg(args, "weekStart", monday)
			if err != nil {
				return "", err
			}
			from, last, next := start.Format("2006-01-02"), start.AddDate(0, 0, 6).Format("2006-01-02"), start.AddDate(0, 0, 7).Format("2006-01-02")
			return fmt.Sprintf(`Review my week from %s to %s.
1. Call list_focus_sessions with from=%s and to=%s, list_tasks with completed=true (keep the tasks completed that week), get_agenda with from=%s and to=%s, get_goal_progress, and list_stale_work.
2. Write a short review in four parts: shipped, focused time, slipped, next week.`, from, last, from, last, from, next), nil
		},
	},
	{
		prompt: &mcp.Prompt{Name: "triage_inbox", Description: "Walk through the Inbox one item at a time and turn each into Work or a reminder."},
		text: func(time.Time, map[string]string) (string, error) {
			return `Help me empty my Inbox.
1. Call list_inbox.
2. Take the items one at a time. For each, say what it seems to be and suggest a workspace and duration for Work, or a time for a reminder.
3. After I answer, turn it into Work or a reminder with clarify_inbox_item, then move to the next item. Ask which workspace when I have not said.`, nil
		},
	},
}

func (s *Server) registerPrompts(server *mcp.Server) {
	for _, def := range prompts {
		server.AddPrompt(def.prompt, func(ctx context.Context, req *mcp.GetPromptRequest) (*mcp.GetPromptResult, error) {
			text, err := def.text(s.promptToday(ctx, req), req.Params.Arguments)
			if err != nil {
				return nil, err
			}
			return &mcp.GetPromptResult{Description: def.prompt.Description,
				Messages: []*mcp.PromptMessage{{Role: "user", Content: &mcp.TextContent{Text: text}}}}, nil
		})
	}
}

// promptToday is midnight of the account's today, or the server's when the
// request carries no account.
func (s *Server) promptToday(ctx context.Context, req *mcp.GetPromptRequest) time.Time {
	today := task.TodayFor(models.WorkingHours{}, "", time.Now())
	if req.Extra != nil && req.Extra.TokenInfo != nil && req.Extra.TokenInfo.UserID != "" {
		if account, err := s.today(ctx, req.Extra.TokenInfo.UserID, ""); err == nil {
			today = account
		}
	}
	day, _ := time.Parse("2006-01-02", today.Date())
	return day
}

func dayArg(args map[string]string, name string, fallback time.Time) (time.Time, error) {
	raw := strings.TrimSpace(args[name])
	if raw == "" {
		return fallback, nil
	}
	day, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return time.Time{}, fmt.Errorf("%s must be YYYY-MM-DD", name)
	}
	return day, nil
}
