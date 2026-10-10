package agent

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"timely-api/internal/features/focus"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Habits and goals, the block at the top of Today (features/focus). Checking
// a habit or adding one is a clear single step; removing a goal is reviewed.

func (s *Server) registerFocus(server *mcp.Server) {
	registerTool(s, server, &mcp.Tool{Name: "list_habits", Description: "The person's daily habits with whether each is done today, its current streak in days and the last seven days (oldest first). Today is the account's date unless today (YYYY-MM-DD) is given."}, reads, s.listHabits)
	registerTool(s, server, &mcp.Tool{Name: "check_habit", Description: "Mark a habit done (done=true, the default) or not done for a day. habit is its id or name. day is YYYY-MM-DD and defaults to today in the account's timezone."}, writes, s.checkHabit)
	registerTool(s, server, &mcp.Tool{Name: "add_habit", Description: fmt.Sprintf("Add a daily habit (up to %d, names up to %d characters).", focus.MaxHabits, focus.MaxNameLen)}, writes, s.addHabit)
	registerTool(s, server, &mcp.Tool{Name: "list_goals", Description: "The person's goals (up to five, in their own words and order), shown on Today."}, reads, s.listGoals)
	registerTool(s, server, &mcp.Tool{Name: "set_goal", Description: fmt.Sprintf("Change the person's goals. action=add with title adds one (up to %d); action=rename with goal (id or current title) and title renames it; action=remove with goal removes it.", focus.MaxGoals)}, writes.reviewedWhen(removesGoal), s.setGoal)
}

// Removing a goal removes part of what Today shows, so it is reviewed.
func removesGoal(args map[string]any) bool {
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
