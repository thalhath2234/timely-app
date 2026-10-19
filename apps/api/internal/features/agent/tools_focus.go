package agent

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"timely-api/internal/features/focus"
	"timely-api/internal/models"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Habits and goals, the block at the top of Today (features/focus). Checking
// a habit or adding one is a clear single step; removing a goal is reviewed.

func (s *Server) registerFocus(server *mcp.Server) {
	registerTool(s, server, &mcp.Tool{Name: "list_habits", Description: "The person's daily habits with whether each is done today, its current streak in days and the last seven days (oldest first). Today is the account's date unless today (YYYY-MM-DD) is given."}, reads, s.listHabits)
	registerTool(s, server, &mcp.Tool{Name: "check_habit", Description: "Mark a habit done (done=true, the default) or not done for a day. habit is its id or name. day is YYYY-MM-DD and defaults to today in the account's timezone."}, writes, s.checkHabit)
	registerTool(s, server, &mcp.Tool{Name: "add_habit", Description: fmt.Sprintf("Add a daily habit (up to %d, names up to %d characters).", focus.MaxHabits, focus.MaxNameLen)}, writes, s.addHabit)
	registerTool(s, server, &mcp.Tool{Name: "list_goals", Description: "The person's goals (up to five, in their own words and order), shown on Today."}, reads, s.listGoals)
	registerTool(s, server, &mcp.Tool{Name: "set_goal", Description: fmt.Sprintf("Change the person's goals. action=add with title adds one (up to %d); action=rename with goal (id or current title) and title renames it; action=remove with goal removes it.", focus.MaxGoals)}, writes.reviewedWhen(removes).destroys(), s.setGoal)
	registerTool(s, server, &mcp.Tool{Name: "update_habit", Description: "Change a habit. habit is its id or name. action=rename with title renames it; action=remove deletes it and its check history."}, writes.reviewedWhen(removes).destroys(), s.updateHabit)
	registerTool(s, server, &mcp.Tool{Name: "get_goal_progress", Description: "For each goal, the open Work that moves it forward, as on Today. Needs smart suggestions; available=false means they are off."}, reads, s.getGoalProgress)
	registerTool(s, server, &mcp.Tool{Name: "list_focus_sessions", Description: "Focus sessions that ended between from and to (YYYY-MM-DD, both days included, in the account's timezone), oldest first, with task name and minutes. taskId keeps one task's sessions."}, reads, s.listFocusSessions)
}

// Removing a goal or habit removes part of what Today shows, so it is reviewed.
func removes(args map[string]any) bool {
	action, _ := args["action"].(string)
	return strings.EqualFold(strings.TrimSpace(action), "remove")
}

func (s *Server) focusStore() (*focus.Store, error) {
	if s.Focus == nil {
		return nil, errors.New("habits and goals are not available")
	}
	return s.Focus, nil
}

type listHabitsIn struct {
	Today    string `json:"today,omitempty" jsonschema:"YYYY-MM-DD; defaults to the account's today"`
	Timezone string `json:"timezone,omitempty"`
}

func (s *Server) habitsFor(ctx context.Context, store *focus.Store, uid, today, timezone string) (string, []focus.HabitView, error) {
	if today == "" {
		today = store.Today(ctx, uid, zone(ctx, timezone))
	}
	day, err := focus.ParseDay(today)
	if err != nil {
		return "", nil, err
	}
	habits, err := store.Habits(ctx, uid, day)
	return today, habits, err
}

func (s *Server) listHabits(ctx context.Context, req *mcp.CallToolRequest, in listHabitsIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	store, err := s.focusStore()
	if err != nil {
		return fail(err)
	}
	today, habits, err := s.habitsFor(ctx, store, uid, in.Today, in.Timezone)
	if err != nil {
		return fail(err)
	}
	done := 0
	for _, h := range habits {
		if h.DoneToday {
			done++
		}
	}
	return reply(fmt.Sprintf("%d habits, %d done on %s", len(habits), done, today), map[string]any{"today": today, "habits": habits})
}

type checkHabitIn struct {
	Habit    string `json:"habit" jsonschema:"habit id or name"`
	Done     *bool  `json:"done,omitempty" jsonschema:"true marks it done (default), false clears it"`
	Day      string `json:"day,omitempty" jsonschema:"YYYY-MM-DD; defaults to today in the account's timezone"`
	Timezone string `json:"timezone,omitempty"`
}

func (s *Server) checkHabit(ctx context.Context, req *mcp.CallToolRequest, in checkHabitIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	store, err := s.focusStore()
	if err != nil {
		return fail(err)
	}
	h, err := store.FindHabit(ctx, uid, in.Habit)
	if errors.Is(err, focus.ErrNotFound) {
		return fail(fmt.Errorf("no habit named %q; call list_habits for the names", in.Habit))
	}
	if err != nil {
		return fail(err)
	}
	today := store.Today(ctx, uid, zone(ctx, in.Timezone))
	day := strings.TrimSpace(in.Day)
	if day == "" {
		day = today
	}
	done := in.Done == nil || *in.Done
	if err := store.CheckHabit(ctx, uid, h.ID, day, done); err != nil {
		return fail(err)
	}
	_, habits, err := s.habitsFor(ctx, store, uid, today, "")
	if err != nil {
		return fail(err)
	}
	var view focus.HabitView
	for _, v := range habits {
		if v.ID == h.ID {
			view = v
		}
	}
	verb := "done"
	if !done {
		verb = "not done"
	}
	return reply(fmt.Sprintf("%s marked %s on %s; streak %d days", h.Name, verb, day, view.Streak), view)
}

type addHabitIn struct {
	Name string `json:"name"`
}

func (s *Server) addHabit(ctx context.Context, req *mcp.CallToolRequest, in addHabitIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	store, err := s.focusStore()
	if err != nil {
		return fail(err)
	}
	h, err := store.AddHabit(ctx, uid, in.Name)
	if err != nil {
		return fail(err)
	}
	return reply("added habit "+h.Name, h)
}

func (s *Server) listGoals(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	store, err := s.focusStore()
	if err != nil {
		return fail(err)
	}
	goals, err := store.Goals(ctx, uid)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%d goals", len(goals)), goals)
}

type setGoalIn struct {
	Action string `json:"action" jsonschema:"add, rename or remove"`
	Goal   string `json:"goal,omitempty" jsonschema:"the goal's id or current title, for rename and remove"`
	Title  string `json:"title,omitempty" jsonschema:"the new title, for add and rename"`
}

func (s *Server) setGoal(ctx context.Context, req *mcp.CallToolRequest, in setGoalIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	store, err := s.focusStore()
	if err != nil {
		return fail(err)
	}
	action := strings.ToLower(strings.TrimSpace(in.Action))
	if action == "add" {
		g, err := store.AddGoal(ctx, uid, in.Title)
		if err != nil {
			return fail(err)
		}
		return reply("added goal "+g.Title, g)
	}
	if action != "rename" && action != "remove" {
		return fail(errors.New("action must be add, rename or remove"))
	}
	g, err := store.FindGoal(ctx, uid, in.Goal)
	if errors.Is(err, focus.ErrNotFound) {
		return fail(fmt.Errorf("no goal %q; call list_goals for the titles", in.Goal))
	}
	if err != nil {
		return fail(err)
	}
	if action == "remove" {
		if err := store.DeleteGoal(ctx, uid, g.ID); err != nil {
			return fail(err)
		}
		return reply("removed goal "+g.Title, g)
	}
	renamed, err := store.RenameGoal(ctx, uid, g.ID, in.Title)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("renamed goal %s to %s", g.Title, renamed.Title), renamed)
}

type updateHabitIn struct {
	Habit  string `json:"habit" jsonschema:"habit id or name"`
	Action string `json:"action" jsonschema:"rename or remove"`
	Title  string `json:"title,omitempty" jsonschema:"the new name, for rename"`
}

func (s *Server) updateHabit(ctx context.Context, req *mcp.CallToolRequest, in updateHabitIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	store, err := s.focusStore()
	if err != nil {
		return fail(err)
	}
	action := strings.ToLower(strings.TrimSpace(in.Action))
	if action != "rename" && action != "remove" {
		return fail(errors.New("action must be rename or remove"))
	}
	h, err := store.FindHabit(ctx, uid, in.Habit)
	if errors.Is(err, focus.ErrNotFound) {
		return fail(fmt.Errorf("no habit named %q; call list_habits for the names", in.Habit))
	}
	if err != nil {
		return fail(err)
	}
	if action == "remove" {
		if err := store.DeleteHabit(ctx, uid, h.ID); err != nil {
			return fail(err)
		}
		return reply("removed habit "+h.Name, h)
	}
	renamed, err := store.RenameHabit(ctx, uid, h.ID, in.Title)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("renamed habit %s to %s", h.Name, renamed.Name), renamed)
}

func (s *Server) getGoalProgress(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	store, err := s.focusStore()
	if err != nil {
		return fail(err)
	}
	progress, err := store.Progress(ctx, s.Decisions, uid)
	if err != nil {
		return fail(err)
	}
	if !progress.Available {
		return reply("goal progress needs smart suggestions, which are off", progress)
	}
	items := 0
	for _, g := range progress.Goals {
		items += len(g.Items)
	}
	return reply(fmt.Sprintf("%d goals, %d open tasks moving them forward", len(progress.Goals), items), progress)
}

type listFocusSessionsIn struct {
	From     string `json:"from" jsonschema:"first day, YYYY-MM-DD"`
	To       string `json:"to" jsonschema:"last day, YYYY-MM-DD (included)"`
	TaskID   string `json:"taskId,omitempty"`
	Timezone string `json:"timezone,omitempty"`
}

func (s *Server) listFocusSessions(ctx context.Context, req *mcp.CallToolRequest, in listFocusSessionsIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	today, err := s.today(ctx, uid, in.Timezone)
	if err != nil {
		return fail(err)
	}
	from, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(in.From), today.Location())
	if err != nil {
		return fail(errors.New("from must be YYYY-MM-DD"))
	}
	last, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(in.To), today.Location())
	if err != nil {
		return fail(errors.New("to must be YYYY-MM-DD"))
	}
	sessions, err := s.Tasks.ListFocusSessions(uid, from, last.AddDate(0, 0, 1))
	if err != nil {
		return fail(err)
	}
	kept := make([]models.FocusSession, 0, len(sessions))
	minutes := 0
	for _, session := range sessions {
		if in.TaskID != "" && (session.TaskID == nil || *session.TaskID != in.TaskID) {
			continue
		}
		kept = append(kept, session)
		minutes += session.Minutes
	}
	return reply(fmt.Sprintf("%d focus sessions, %d minutes, %s to %s", len(kept), minutes, in.From, in.To),
		map[string]any{"sessions": kept, "minutes": minutes})
}
