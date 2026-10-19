//go:build ignore

// mcp_60day plays one person using Timely through an MCP client for 60
// consecutive days (45 lived, today, 14 planned ahead) against a running API,
// and checks every server read against its own ledger of what that person did.
//
//	TIMELY_API=http://localhost:8081 go run scripts/mcp_60day.go -out /tmp/mcp60/run
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"hash/fnv"
	"io"
	"math/rand/v2"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	pastDays   = 45
	futureDays = 14
	windowDays = pastDays + 1 + futureDays
	todayIndex = pastDays
)

// ---- Ledger: what the persona did, keyed by server id ----

type ledger struct {
	workspaces map[string]string
	statuses   map[string]string
	labels     map[string]string
	fieldID    string
	project    projectRec

	tasks map[string]*taskRec
	order []string
	inbox []string

	events []*eventRec
	series []*seriesRec
	blocks []blockRec
	engine []blockRec

	plants *reminderSeries

	habits []*habitRec
	goals  []string

	sheets   map[int]string
	expenses map[string][]expense

	notes       map[string]string
	planDoc     string
	linkedNotes []string

	backups  []string
	focusing *focusRec
	focus    []focusRec
	reminder string
	named    []named
}

type projectRec struct {
	id     string
	stages map[string]string
}

type taskRec struct {
	id, name, workspace string
	projectID, stageID  string
	deadline, priority  string
	completedOn         string
	duration            int
	// decided is set once the persona chose, on the day the task came due,
	// whether to finish it or let it slide into overdue.
	decided bool
}

func (t *taskRec) open() bool { return t.completedOn == "" }

type eventRec struct {
	id, title  string
	start, end time.Time
}

// seriesRec is a weekly recurring event: one occurrence on weekday at
// hour:minute from the day `from` until the day before `until` ("" = open).
type seriesRec struct {
	id, title    string
	weekday      time.Weekday
	hour, minute int
	minutes      int
	from, until  string
	skipped      map[string]bool
}

type blockRec struct {
	id, taskID string
	start, end time.Time
}

type reminderSeries struct {
	id        string
	weekday   time.Weekday
	hour      int
	from      string
	completed map[string]bool
	skipped   map[string]bool
}

type habitRec struct {
	id, name string
	p        float64
	done     map[string]bool
}

type expense struct {
	day, item, category string
	qty, unit           int
}

func (e expense) total() int { return e.qty * e.unit }

type focusRec struct {
	taskID  string
	started time.Time
}

type named struct{ kind, id, title string }

func newLedger() *ledger {
	return &ledger{
		workspaces: map[string]string{}, statuses: map[string]string{}, labels: map[string]string{},
		project: projectRec{stages: map[string]string{}},
		tasks:   map[string]*taskRec{}, sheets: map[int]string{}, expenses: map[string][]expense{},
		notes: map[string]string{},
	}
}

func (l *ledger) addTask(t *taskRec) {
	l.tasks[t.id] = t
	l.order = append(l.order, t.id)
	l.named = append(l.named, named{"task", t.id, t.name})
}

func (l *ledger) openTasks() []*taskRec {
	var out []*taskRec
	for _, id := range l.order {
		if t := l.tasks[id]; t != nil && t.open() {
			out = append(out, t)
		}
	}
	return out
}

func (l *ledger) hasBlock(taskID string) bool {
	return slices.ContainsFunc(l.blocks, func(b blockRec) bool { return b.taskID == taskID })
}

// agendaKeys is what get_agenda must list for [from, to): one key per event,
// event occurrence and task block, so duplicates and gaps both show.
func (l *ledger) agendaKeys(from, to time.Time) map[string]int {
	keys := map[string]int{}
	for _, e := range l.events {
		if e.start.Before(to) && e.end.After(from) {
			keys[itemKey("event", e.id, e.start)]++
		}
	}
	for _, s := range l.series {
		for d := from; d.Before(to); d = d.AddDate(0, 0, 1) {
			ymd := d.Format(time.DateOnly)
			if d.Weekday() != s.weekday || ymd < s.from || (s.until != "" && ymd >= s.until) || s.skipped[ymd] {
				continue
			}
			start := time.Date(d.Year(), d.Month(), d.Day(), s.hour, s.minute, 0, 0, d.Location())
			if start.Before(to) && !start.Before(from) {
				keys[itemKey("event", s.id, start)]++
			}
		}
	}
	for _, b := range append(slices.Clone(l.blocks), l.engine...) {
		if b.start.Before(to) && b.end.After(from) {
			keys[itemKey("task", b.taskID, b.start)]++
		}
	}
	return keys
}

func itemKey(kind, id string, start time.Time) string {
	return kind + ":" + id + "@" + start.UTC().Format(time.RFC3339)
}

func (l *ledger) streak(h *habitRec, today time.Time) int {
	cursor := today
	if !h.done[cursor.Format(time.DateOnly)] {
		cursor = cursor.AddDate(0, 0, -1)
	}
	n := 0
	for h.done[cursor.Format(time.DateOnly)] {
		n++
		cursor = cursor.AddDate(0, 0, -1)
	}
	return n
}

// ---- Routine: when each activity runs ----

type cadence int

const (
	daily cadence = iota
	weekdays
	weekly
	monthly
	once
	onToday
	atEnd
)

// span narrows a cadence to the days the persona has lived (up to today) or
// the days still ahead, so "log an expense" never runs on a future day.
type span int

const (
	anyDay span = iota
	lived
	ahead
)

type when struct {
	cadence cadence
	weekday time.Weekday
	index   int
	span    span
}

func everyDay() when                { return when{cadence: daily} }
func everyWeekday() when            { return when{cadence: weekdays} }
func weeklyOn(wd time.Weekday) when { return when{cadence: weekly, weekday: wd} }
func monthStart() when              { return when{cadence: monthly} }
func onceOn(i int) when             { return when{cadence: once, index: i} }
func today() when                   { return when{cadence: onToday} }
func endOfRun() when                { return when{cadence: atEnd} }
func (w when) livedDays() when      { w.span = lived; return w }
func (w when) aheadDays() when      { w.span = ahead; return w }

func (w when) matches(d day) bool {
	if w.cadence == atEnd {
		return false
	}
	if (w.span == lived && d.i > todayIndex) || (w.span == ahead && d.i <= todayIndex) {
		return false
	}
	switch w.cadence {
	case daily:
		return true
	case weekdays:
		return d.date.Weekday() != time.Saturday && d.date.Weekday() != time.Sunday
	case weekly:
		return d.date.Weekday() == w.weekday
	case monthly:
		return d.date.Day() == 1 || d.i == 0
	case once:
		return d.i == w.index
	case onToday:
		return d.i == todayIndex
	}
	return false
}

type activity struct {
	name string
	when when
	run  func(*sim, day) error
}

type day struct {
	i    int
	date time.Time
}

func (d day) ymd() string { return d.date.Format(time.DateOnly) }
func (d day) at(h, m int) time.Time {
	return time.Date(d.date.Year(), d.date.Month(), d.date.Day(), h, m, 0, 0, d.date.Location())
}
func (d day) next() time.Time { return d.date.AddDate(0, 0, 1) }
func (d day) label() string   { return d.date.Format("Jan 2") }
func (d day) isToday() bool   { return d.i == todayIndex }
func (d day) past() bool      { return d.i < todayIndex }

func routine() []activity {
	return []activity{
		{"set up the account", onceOn(0), (*sim).setup},
		{"tidy the setup", onceOn(0), (*sim).tidySetup},
		{"open the month's expenses", monthStart().livedDays(), (*sim).openMonth},
		{"capture inbox items", everyDay().livedDays(), (*sim).captureInbox},
		{"clarify inbox items", everyDay().livedDays(), (*sim).clarifyInbox},
		{"add the day's events", everyDay(), (*sim).addEvents},
		{"plan a deadline ahead", everyDay().aheadDays(), (*sim).planAhead},
		{"schedule a task block", everyDay(), (*sim).scheduleBlock},
		{"check habits", everyDay().livedDays(), (*sim).checkHabits},
		{"write the daily note", everyDay().livedDays(), (*sim).dailyNote},
		{"log expenses", everyDay().livedDays(), (*sim).logExpenses},
		{"complete tasks", everyDay().livedDays(), (*sim).completeTasks},
		{"tick the weekly reminder", weeklyOn(time.Sunday).livedDays(), (*sim).tickPlants},
		{"rework a day's events", onceOn(30), (*sim).reworkEvents},
		{"move the standup", onceOn(todayIndex + 1), (*sim).moveStandup},
		{"agenda matches the ledger", everyDay(), (*sim).assertAgenda},
		{"work on the relaunch", weeklyOn(time.Wednesday).livedDays(), (*sim).relaunchWork},
		{"make a packing list", onceOn(20), (*sim).packingList},
		{"sketch the desk setup", onceOn(10), (*sim).deskDoc},
		{"try a stretch routine", onceOn(25), (*sim).stretchSeries},
		{"review the week", weeklyOn(time.Monday), (*sim).reviewWeek},
		{"push out overdue chores", weeklyOn(time.Monday).livedDays(), (*sim).pushChores},
		{"move relaunch tasks along", weeklyOn(time.Monday).livedDays(), (*sim).advanceStages},
		{"revise the weekly plan", weeklyOn(time.Monday).livedDays(), (*sim).revisePlan},
		{"start the day", today(), (*sim).startDay},
		{"set a reminder", today(), (*sim).setReminder},
		{"auto-schedule the rest", today(), (*sim).autoSchedule},
		{"adjust the planned blocks", onceOn(todayIndex + 4), (*sim).adjustBlocks},
		{"check deadline risk", onceOn(todayIndex + 2), (*sim).deadlineRisk},
		{"back up the account", monthStart().livedDays(), (*sim).backUp},
		{"stop focusing", endOfRun(), (*sim).stopFocus},
		{"housekeeping", endOfRun(), (*sim).housekeeping},
		{"reschedule an overdue task as urgent", endOfRun(), (*sim).urgent},
		{"agenda of every window day still matches", endOfRun(), (*sim).assertWindow},
		{"handle notifications", endOfRun(), (*sim).handleNotifications},
		{"restore the account from its export", endOfRun(), (*sim).restoreRoundTrip},
		{"habit streaks match the ledger", endOfRun(), (*sim).assertStreaks},
		{"task counts match the ledger", endOfRun(), (*sim).assertTaskCounts},
		{"inbox matches the ledger", endOfRun(), (*sim).assertInbox},
		{"expense totals match the ledger", endOfRun(), (*sim).assertAllExpenses},
		{"search finds created titles", endOfRun(), (*sim).assertSearch},
	}
}

// ---- Persona content ----

var (
	workChores = []string{"Draft the Q4 roadmap", "Reply to Anika about the contract", "Review the onboarding flow",
		"Prepare the sprint demo", "Fix the invoice export", "Write the release notes", "Book the design review",
		"Update the pricing page", "Clean up the analytics dashboard", "Plan the offsite agenda"}
	homeChores = []string{"Call the plumber", "Renew the car insurance", "Buy a birthday gift for Amma",
		"Fix the leaking tap", "Sort the bookshelf", "Pay the electricity bill", "Plan the weekend trip",
		"Return the library books", "Clean the balcony", "Order printer ink"}
	eventTitles = []string{"1:1 with Ravi", "Design review", "Client call", "Lunch with Maya", "Dentist", "Gym class", "Parent-teacher meeting"}
	eventSlots  = [][2]int{{8, 0}, {11, 0}, {15, 30}}
	purchases   = []struct {
		item, category string
		lo, hi         int
	}{
		{"Rice", "Groceries", 300, 600}, {"Vegetables", "Groceries", 200, 900}, {"Bus fare", "Transport", 60, 200},
		{"Coffee", "Dining out", 400, 900}, {"Fuel", "Fuel", 3000, 6000}, {"Mobile top-up", "Phone & internet", 500, 1500},
		{"Pharmacy", "Health", 600, 2500}, {"Book", "Education", 1200, 3500},
	}
	habitPlan = []struct {
		name string
		p    float64
	}{{"Read 20 pages", 0.7}, {"Walk 8k steps", 0.55}, {"No sugar", 0.4}}
)

// ---- Sim: the session, the ledger and the report ----

var errMissing = errors.New("tool not listed")

type toolError struct{ name, text string }

func (e *toolError) Error() string { return e.name + ": " + e.text }

type failure struct {
	Day      int    `json:"day"`
	Date     string `json:"date"`
	Activity string `json:"activity"`
	Message  string `json:"message"`
	Expected string `json:"expected,omitempty"`
	Got      string `json:"got,omitempty"`
}

type toolStat struct {
	Calls     int `json:"calls"`
	Errors    int `json:"errors"`
	Expected  int `json:"expectedRejections"`
	latencies []time.Duration
}

type sim struct {
	ctx        context.Context
	session    *mcp.ClientSession
	seed       uint64
	tz         *time.Location
	start      time.Time
	registered time.Time
	days       []day
	l          *ledger

	listed     map[string]bool
	prompts    map[string]bool
	missing    map[string]bool
	stats      map[string]*toolStat
	promptsGot map[string]bool
	failures   []failure
	notes      []string

	cur      day
	activity string
	calls    int
}

func (s *sim) rng(d day, name string) *rand.Rand {
	h := fnv.New64a()
	fmt.Fprintf(h, "%d/%s", d.i, name)
	return rand.New(rand.NewPCG(s.seed, h.Sum64()))
}

func (s *sim) fail(msg string, expected, got any) {
	f := failure{Day: s.cur.i, Date: s.cur.ymd(), Activity: s.activity, Message: msg}
	if expected != nil {
		f.Expected = compact(expected)
	}
	if got != nil {
		f.Got = compact(got)
	}
	s.failures = append(s.failures, f)
	fmt.Printf("  FAIL [%s] %s\n", s.activity, msg)
}

func (s *sim) expect(ok bool, msg string, expected, got any) bool {
	if !ok {
		s.fail(msg, expected, got)
	}
	return ok
}

func (s *sim) stat(name string) *toolStat {
	st := s.stats[name]
	if st == nil {
		st = &toolStat{}
		s.stats[name] = st
	}
	return st
}

func (s *sim) invoke(name string, args map[string]any) (obj, *toolError, error) {
	if !s.listed[name] {
		s.missing[name] = true
		return nil, nil, errMissing
	}
	if args == nil {
		args = map[string]any{}
	}
	st := s.stat(name)
	st.Calls++
	s.calls++
	began := time.Now()
	res, err := s.session.CallTool(s.ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	st.latencies = append(st.latencies, time.Since(began))
	if err != nil {
		return nil, &toolError{name, err.Error()}, nil
	}
	if res.IsError {
		var parts []string
		for _, c := range res.Content {
			if t, ok := c.(*mcp.TextContent); ok {
				parts = append(parts, t.Text)
			}
		}
		return nil, &toolError{name, strings.Join(parts, " ")}, nil
	}
	out := obj{}
	if res.StructuredContent != nil {
		raw, _ := json.Marshal(res.StructuredContent)
		if err := json.Unmarshal(raw, &out); err != nil {
			return nil, &toolError{name, "structuredContent is not an object: " + string(raw)}, nil
		}
	}
	return out, nil, nil
}

// call runs a tool the persona expects to work. A tool error is a failure
// with its arguments as the repro; the activity stops there.
func (s *sim) call(name string, args map[string]any) (obj, error) {
	out, terr, err := s.invoke(name, args)
	if err != nil {
		return nil, err
	}
	if terr != nil {
		s.stat(name).Errors++
		s.fail(fmt.Sprintf("%s returned an error", name), compact(args), terr.text)
		return nil, terr
	}
	return out, nil
}

// reject runs a call the server must refuse; its error text must contain want.
func (s *sim) reject(name string, args map[string]any, want string) error {
	_, terr, err := s.invoke(name, args)
	if err != nil {
		return err
	}
	if terr == nil {
		s.fail(fmt.Sprintf("%s accepted a call it must refuse", name), "error containing "+strings.TrimSpace(want), compact(args))
		return nil
	}
	if !strings.Contains(terr.text, want) {
		s.stat(name).Errors++
		s.fail(fmt.Sprintf("%s refused with an unexpected error", name), want, terr.text)
		return nil
	}
	s.stat(name).Expected++
	return nil
}

// allow runs a call that may be refused for a reason outside the persona's
// control (no OpenRouter key on this server); the reason is noted.
func (s *sim) allow(name string, args map[string]any, reason string) (obj, error) {
	out, terr, err := s.invoke(name, args)
	if err != nil {
		return nil, err
	}
	if terr != nil {
		if strings.Contains(terr.text, reason) {
			s.stat(name).Expected++
			s.note(name + ": " + terr.text)
			return nil, nil
		}
		s.stat(name).Errors++
		s.fail(fmt.Sprintf("%s returned an error", name), compact(nil), terr.text)
		return nil, terr
	}
	return out, nil
}

func (s *sim) prompt(name string, args map[string]string) (*mcp.GetPromptResult, error) {
	if !s.prompts[name] {
		s.missing["prompt:"+name] = true
		return nil, errMissing
	}
	st := s.stat("prompt:" + name)
	st.Calls++
	s.calls++
	began := time.Now()
	res, err := s.session.GetPrompt(s.ctx, &mcp.GetPromptParams{Name: name, Arguments: args})
	st.latencies = append(st.latencies, time.Since(began))
	s.promptsGot[name] = true
	if err != nil {
		st.Errors++
		s.fail("prompts/get "+name+" returned an error", compact(args), err.Error())
		return nil, err
	}
	return res, nil
}

func (s *sim) note(msg string) {
	if !slices.Contains(s.notes, msg) {
		s.notes = append(s.notes, msg)
	}
}

// ---- Setup ----

func (s *sim) setup(d day) error {
	if _, err := s.call("get_context", nil); err != nil {
		return err
	}
	if _, err := s.call("update_profile", map[string]any{"name": "Nimal Perera"}); err != nil {
		return err
	}
	profile, err := s.call("get_profile", nil)
	if err != nil {
		return err
	}
	s.expect(profile.str("name") == "Nimal Perera" || profile.str("user", "name") == "Nimal Perera", "get_profile shows the name update_profile set", "Nimal Perera", profile)
	if _, err := s.call("update_account_config", map[string]any{"isOnboardingCompleted": true, "theme": "dark"}); err != nil {
		return err
	}
	if _, err := s.call("get_config", nil); err != nil {
		return err
	}
	workday := []map[string]string{{"start": "09:00", "end": "17:00"}}
	if _, err := s.call("update_working_hours", map[string]any{"timezone": s.tz.String(), "days": map[string]any{
		"mon": workday, "tue": workday, "wed": workday, "thu": workday, "fri": workday,
	}}); err != nil {
		return err
	}
	hours, err := s.call("get_working_hours", map[string]any{"timezone": s.tz.String()})
	if err != nil {
		return err
	}
	s.expect(hours.str("timezone") == s.tz.String() || hours.str("workingHours", "timezone") == s.tz.String(), "get_working_hours keeps the saved timezone", s.tz.String(), hours)
	if _, err := s.call("update_notification_settings", map[string]any{"reminders": true, "timezone": s.tz.String()}); err != nil {
		return err
	}
	if _, err := s.call("get_notification_settings", nil); err != nil {
		return err
	}
	if _, err := s.call("update_schedule_settings", map[string]any{"breakMinutes": 10, "freezeHours": 0}); err != nil {
		return err
	}
	if _, err := s.call("get_schedule_settings", nil); err != nil {
		return err
	}

	for _, name := range []string{"Work", "Home"} {
		ws, err := s.call("create_workspace", map[string]any{"name": name})
		if err != nil {
			return err
		}
		s.l.workspaces[name] = ws.str("id")
	}
	work := s.l.workspaces["Work"]
	list, err := s.call("list_workspaces", nil)
	if err != nil {
		return err
	}
	s.expect(list.hasIDs(s.l.workspaces["Work"], s.l.workspaces["Home"]), "list_workspaces lists Work and Home", []string{work, s.l.workspaces["Home"]}, list.idsAnywhere())

	for _, name := range []string{"Waiting", "Doing"} {
		st, err := s.call("create_status", map[string]any{"workspaceId": work, "name": name})
		if err != nil {
			return err
		}
		s.l.statuses[name] = st.str("id")
	}
	for _, name := range []string{"Deep work", "Errand"} {
		lb, err := s.call("create_label", map[string]any{"workspaceId": work, "name": name})
		if err != nil {
			return err
		}
		s.l.labels[name] = lb.str("id")
	}
	field, err := s.call("create_custom_field", map[string]any{"workspaceId": work, "name": "Client", "type": "text"})
	if err != nil {
		return err
	}
	s.l.fieldID = field.str("id")

	project, err := s.call("create_project", map[string]any{
		"title": "Website relaunch", "workspaceId": work, "doesHaveStages": true, "priorityLevel": "High",
		"deadline": s.days[todayIndex+10].ymd(), "description": "Ship the new marketing site.",
	})
	if err != nil {
		return err
	}
	s.l.project.id = project.str("id")
	s.l.named = append(s.l.named, named{"project", s.l.project.id, "Website relaunch"})
	for _, name := range []string{"Backlog", "Building", "Review"} {
		stage, err := s.call("create_stage", map[string]any{"projectId": s.l.project.id, "name": name})
		if err != nil {
			return err
		}
		s.l.project.stages[name] = stage.str("id")
	}

	for _, h := range habitPlan {
		out, err := s.call("add_habit", map[string]any{"name": h.name})
		if err != nil {
			return err
		}
		s.l.habits = append(s.l.habits, &habitRec{id: out.str("id"), name: h.name, p: h.p, done: map[string]bool{}})
	}
	for _, title := range []string{"Ship the website relaunch", "Run a 10k"} {
		out, err := s.call("set_goal", map[string]any{"action": "add", "title": title})
		if err != nil {
			return err
		}
		s.l.goals = append(s.l.goals, out.str("id"))
	}
	goals, err := s.call("list_goals", nil)
	if err != nil {
		return err
	}
	s.expect(goals.hasIDs(s.l.goals...), "list_goals lists both goals", s.l.goals, goals.idsAnywhere())

	sunday := firstOnOrAfter(d.date, time.Sunday)
	plants, err := s.call("create_task", map[string]any{
		"name": "Water the plants", "kind": "reminder", "scheduleAt": at(sunday, 10, 0).Format(time.RFC3339),
		"recurrence": map[string]any{"rrule": "FREQ=WEEKLY;BYDAY=SU", "dtstart": at(sunday, 10, 0).Format(time.RFC3339), "timezone": s.tz.String()},
	})
	if err != nil {
		return err
	}
	s.l.plants = &reminderSeries{id: plants.str("task", "id"), weekday: time.Sunday, hour: 10, from: sunday.Format(time.DateOnly),
		completed: map[string]bool{}, skipped: map[string]bool{}}

	monday := firstOnOrAfter(d.date, time.Monday)
	standupStart := at(monday, 9, 30)
	standup, err := s.call("create_event", map[string]any{
		"title": "Team standup", "start": standupStart.Format(time.RFC3339), "end": standupStart.Add(15 * time.Minute).Format(time.RFC3339),
		"workspaceId": work, "recurrence": map[string]any{"rrule": "FREQ=WEEKLY;BYDAY=MO", "dtstart": standupStart.Format(time.RFC3339), "timezone": s.tz.String()},
	})
	if err != nil {
		return err
	}
	s.l.series = append(s.l.series, &seriesRec{id: standup.str("id"), title: "Team standup", weekday: time.Monday, hour: 9, minute: 30, minutes: 15,
		from: monday.Format(time.DateOnly), skipped: map[string]bool{}})

	view, err := s.call("create_task_view", map[string]any{"name": "Relaunch board", "renderMode": "kanban", "selectedProjectIds": []string{s.l.project.id}})
	if err != nil {
		return err
	}
	if _, err := s.call("set_active_task_view", map[string]any{"viewId": view.str("view", "id")}); err != nil {
		return err
	}
	views, err := s.call("list_task_views", nil)
	if err != nil {
		return err
	}
	s.expect(views.hasIDs(view.str("view", "id")), "list_task_views includes the saved view", view.str("view", "id"), views.idsAnywhere())

	plan, err := s.call("create_doc", map[string]any{"title": "Weekly plan", "workspaceId": work, "markdown": "# Weekly plan\n\nTop three for the week."})
	if err != nil {
		return err
	}
	s.l.planDoc = plan.str("id")
	s.l.named = append(s.l.named, named{"doc", s.l.planDoc, "Weekly plan"})
	return nil
}

// tidySetup is the persona second-guessing the setup: a side workspace,
// a status, a label and a field made and removed, stages reordered.
func (s *sim) tidySetup(d day) error {
	work := s.l.workspaces["Work"]
	ctx, err := s.call("get_context", nil)
	if err != nil {
		return err
	}
	s.expect(ctx.hasIDs(work, s.l.workspaces["Home"]), "get_context lists the workspaces", []string{work, s.l.workspaces["Home"]}, ctx.idsAnywhere())
	side, err := s.call("create_workspace", map[string]any{"name": "Side project"})
	if err != nil {
		return err
	}
	if _, err := s.call("rename_workspace", map[string]any{"workspaceId": side.str("id"), "name": "Side gig", "color": "#30A46C"}); err != nil {
		return err
	}
	got, err := s.call("get_workspace", map[string]any{"workspaceId": side.str("id")})
	if err != nil {
		return err
	}
	s.expect(got.str("name") == "Side gig" || got.str("workspace", "name") == "Side gig", "rename_workspace renames it", "Side gig", got)
	if _, err := s.call("delete_workspace", map[string]any{"workspaceId": side.str("id"), "confirm": true}); err != nil {
		return err
	}
	list, err := s.call("list_workspaces", nil)
	if err != nil {
		return err
	}
	s.expect(!slices.Contains(list.idsAnywhere(), side.str("id")), "delete_workspace removes it from list_workspaces", "absent", side.str("id"))

	blocked, err := s.call("create_status", map[string]any{"workspaceId": work, "name": "Blocked"})
	if err != nil {
		return err
	}
	if _, err := s.call("update_status", map[string]any{"workspaceId": work, "id": blocked.str("id"), "name": "On hold", "color": "#F5A623"}); err != nil {
		return err
	}
	if _, err := s.call("delete_status", map[string]any{"workspaceId": work, "id": blocked.str("id")}); err != nil {
		return err
	}
	if _, err := s.call("update_label", map[string]any{"workspaceId": work, "id": s.l.labels["Errand"], "name": "Errand", "color": "#E5484D"}); err != nil {
		return err
	}
	temp, err := s.call("create_label", map[string]any{"workspaceId": work, "name": "Maybe"})
	if err != nil {
		return err
	}
	if _, err := s.call("delete_label", map[string]any{"workspaceId": work, "id": temp.str("id")}); err != nil {
		return err
	}
	if _, err := s.call("update_custom_field", map[string]any{"workspaceId": work, "id": s.l.fieldID, "name": "Client", "type": "text"}); err != nil {
		return err
	}
	tempField, err := s.call("create_custom_field", map[string]any{"workspaceId": work, "name": "Budget", "type": "number"})
	if err != nil {
		return err
	}
	if _, err := s.call("delete_custom_field", map[string]any{"workspaceId": work, "id": tempField.str("id")}); err != nil {
		return err
	}

	pid := s.l.project.id
	someday, err := s.call("create_stage", map[string]any{"projectId": pid, "name": "Someday"})
	if err != nil {
		return err
	}
	if _, err := s.call("delete_stage", map[string]any{"projectId": pid, "stageId": someday.str("id")}); err != nil {
		return err
	}
	order := []string{s.l.project.stages["Backlog"], s.l.project.stages["Building"], s.l.project.stages["Review"]}
	if _, err := s.call("reorder_stages", map[string]any{"projectId": pid, "ids": order}); err != nil {
		return err
	}
	if _, err := s.call("update_stage", map[string]any{"projectId": pid, "stageId": s.l.project.stages["Review"], "color": "#8E4EC6"}); err != nil {
		return err
	}
	if _, err := s.call("update_project", map[string]any{"projectId": pid, "description": "Ship the new marketing site before the conference."}); err != nil {
		return err
	}
	project, err := s.call("get_project", map[string]any{"projectId": pid})
	if err != nil {
		return err
	}
	s.expect(project.hasIDs(order...), "get_project lists the three stages", order, project.idsAnywhere())
	if _, err := s.call("set_project_task_view", map[string]any{"projectId": pid, "name": "Relaunch board", "renderMode": "kanban"}); err != nil {
		return err
	}
	projects, err := s.call("list_projects", map[string]any{"workspaceId": work})
	if err != nil {
		return err
	}
	s.expect(projects.hasIDs(pid), "list_projects lists the relaunch", pid, projects.idsAnywhere())

	view, err := s.call("create_task_view", map[string]any{"name": "Overdue", "onlyOverdue": true})
	if err != nil {
		return err
	}
	if _, err := s.call("update_task_view", map[string]any{"viewId": view.str("view", "id"), "name": "Overdue work"}); err != nil {
		return err
	}
	if _, err := s.call("delete_task_view", map[string]any{"viewId": view.str("view", "id")}); err != nil {
		return err
	}
	if _, err := s.call("update_backup_settings", map[string]any{"enabled": true, "intervalDays": 7, "retentionCount": 4}); err != nil {
		return err
	}
	settings, err := s.call("get_backup_settings", nil)
	if err != nil {
		return err
	}
	s.expect(settings.num("retentionCount") == 4 || settings.num("settings", "retentionCount") == 4, "get_backup_settings keeps retentionCount", 4, settings)
	return nil
}

// relaunchWork is a Wednesday on the relaunch: a checklist worked through,
// a comment, a label, the client field, a status and a dependency.
func (s *sim) relaunchWork(d day) error {
	var work []*taskRec
	for _, t := range s.l.openTasks() {
		if t.projectID != "" {
			work = append(work, t)
		}
	}
	if len(work) == 0 {
		return nil
	}
	t := work[0]
	first, err := s.call("add_checklist_item", map[string]any{"taskId": t.id, "title": "Outline"})
	if err != nil {
		return err
	}
	items := first.objs("task", "checklist")
	if !s.expect(len(items) > 0, "add_checklist_item returns the checklist", "> 0 items", first.raw("task", "checklist")) {
		return nil
	}
	itemID := items[len(items)-1].str("id")
	if _, err := s.call("update_checklist_item", map[string]any{"taskId": t.id, "itemId": itemID, "title": "Outline the copy"}); err != nil {
		return err
	}
	if _, err := s.call("toggle_checklist_item", map[string]any{"taskId": t.id, "itemId": itemID, "completed": true}); err != nil {
		return err
	}
	replaced, err := s.call("replace_checklist", map[string]any{"taskId": t.id, "items": []map[string]any{
		{"id": itemID, "title": "Outline the copy", "completed": true}, {"title": "Draft"}, {"title": "Proofread"},
	}})
	if err != nil {
		return err
	}
	all := replaced.objs("task", "checklist")
	if len(all) == 3 {
		if _, err := s.call("delete_checklist_item", map[string]any{"taskId": t.id, "itemId": all[2].str("id")}); err != nil {
			return err
		}
	}
	got, err := s.call("get_task", map[string]any{"taskId": t.id})
	if err != nil {
		return err
	}
	var titles []string
	for _, item := range got.objs("task", "checklist") {
		titles = append(titles, fmt.Sprintf("%s done=%v", item.str("title"), item.str("completedAt") != ""))
	}
	want := []string{"Outline the copy done=true", "Draft done=false"}
	s.expect(compact(titles) == compact(want), "the checklist ends as the persona left it", want, titles)

	if _, err := s.call("add_task_comment", map[string]any{"taskId": t.id, "comment": "Copy is with Maya for review."}); err != nil {
		return err
	}
	if _, err := s.call("set_task_labels", map[string]any{"taskId": t.id, "labelIds": []string{s.l.labels["Deep work"]}}); err != nil {
		return err
	}
	if _, err := s.call("set_task_custom_field", map[string]any{"taskId": t.id, "customFieldId": s.l.fieldID, "stringValue": "Acme"}); err != nil {
		return err
	}
	if _, err := s.call("move_task_to_status", map[string]any{"taskId": t.id, "statusId": s.l.statuses["Doing"]}); err != nil {
		return err
	}
	if len(work) > 1 {
		if _, err := s.call("set_task_dependency", map[string]any{"taskId": work[1].id, "blockedById": t.id}); err != nil {
			return err
		}
	}
	activity, err := s.call("list_task_activity", map[string]any{"taskId": t.id})
	if err != nil {
		return err
	}
	s.expect(len(activity.firstList()) > 0, "list_task_activity records the day's edits", "> 0 entries", activity)
	if _, err := s.call("list_project_activity", map[string]any{"projectId": s.l.project.id}); err != nil {
		return err
	}
	return nil
}

// packingList builds a trip packing sheet and works most sheet tools on it;
// the Qty total is checked against what was entered.
func (s *sim) packingList(d day) error {
	sheet, err := s.call("create_sheet", map[string]any{"title": "Trip packing", "workspaceId": s.l.workspaces["Home"]})
	if err != nil {
		return err
	}
	id := sheet.str("sheet", "id")
	s.l.named = append(s.l.named, named{"sheet", id, "Trip packing"})
	withItem, err := s.call("add_sheet_column", map[string]any{"sheetId": id, "name": "Item", "type": "text"})
	if err != nil {
		return err
	}
	itemCol := withItem.objs("tab", "columns")
	withQty, err := s.call("add_sheet_column", map[string]any{"sheetId": id, "name": "Count", "type": "number"})
	if err != nil {
		return err
	}
	cols := withQty.objs("tab", "columns")
	if !s.expect(len(cols) > 0 && len(itemCol) > 0, "add_sheet_column returns the tab's columns", "columns", withQty.raw("tab")) {
		return nil
	}
	qty := cols[len(cols)-1].str("id")
	if _, err := s.call("update_sheet_column", map[string]any{"sheetId": id, "columnId": qty, "name": "Qty", "type": "number"}); err != nil {
		return err
	}
	packed := map[string]int{"Shirts": 4, "Socks": 5, "Chargers": 2}
	total := 0
	for _, item := range []string{"Shirts", "Socks", "Chargers"} {
		if _, err := s.call("add_sheet_row", map[string]any{"sheetId": id, "cells": map[string]string{"Item": item, "Qty": fmt.Sprint(packed[item])}}); err != nil {
			return err
		}
		total += packed[item]
	}
	grid, err := s.call("get_sheet", map[string]any{"sheetId": id})
	if err != nil {
		return err
	}
	rows := grid.objs("tab", "rows")
	if s.expect(len(rows) > 0, "get_sheet returns rows", "> 0", len(rows)) {
		if _, err := s.call("update_sheet_cells", map[string]any{"sheetId": id, "rowId": rows[0].str("id"), "cells": map[string]string{qty: "6"}}); err != nil {
			return err
		}
		total += 6 - packed["Shirts"]
	}
	if _, err := s.call("add_sheet_rows", map[string]any{"sheetId": id, "count": 2}); err != nil {
		return err
	}
	letter := string(rune('A' + len(cols) - 1))
	values, err := s.call("get_sheet_values", map[string]any{"sheetId": id, "formula": fmt.Sprintf("=SUM(%s:%s)", letter, letter)})
	if err != nil {
		return err
	}
	s.expect(int(values.num("value")) == total, "the packing list's Qty sums to what was entered", total, values.raw("value"))
	if _, err := s.call("update_sheet_tab", map[string]any{"sheetId": id, "frozenRows": 1, "color": "#4F8BFF"}); err != nil {
		return err
	}
	tab, err := s.call("add_sheet_tab", map[string]any{"sheetId": id, "name": "Day 2"})
	if err != nil {
		return err
	}
	if _, err := s.call("rename_sheet_tab", map[string]any{"sheetId": id, "tabId": tab.str("tab", "id"), "name": "Day two"}); err != nil {
		return err
	}
	if _, err := s.call("delete_sheet_tab", map[string]any{"sheetId": id, "tabId": tab.str("tab", "id")}); err != nil {
		return err
	}
	grown, err := s.call("get_sheet", map[string]any{"sheetId": id})
	if err != nil {
		return err
	}
	all := grown.objs("tab", "rows")
	if _, err := s.call("delete_sheet_rows", map[string]any{"sheetId": id, "rowIds": []string{all[len(all)-1].str("id")}}); err != nil {
		return err
	}
	drop, err := s.call("add_sheet_column", map[string]any{"sheetId": id, "name": "Drop", "type": "text"})
	if err != nil {
		return err
	}
	dropCols := drop.objs("tab", "columns")
	if _, err := s.call("delete_sheet_column", map[string]any{"sheetId": id, "columnId": dropCols[len(dropCols)-1].str("id")}); err != nil {
		return err
	}
	if _, err := s.call("update_sheet", map[string]any{"sheetId": id, "title": "Trip packing", "isFavorite": true}); err != nil {
		return err
	}
	copied, err := s.call("duplicate_sheet", map[string]any{"sheetId": id})
	if err != nil {
		return err
	}
	if _, err := s.call("delete_sheet", map[string]any{"sheetId": copied.str("sheet", "id")}); err != nil {
		return err
	}
	tmpl, err := s.call("create_sheet_template", map[string]any{"sheetId": id, "name": "Packing list"})
	if err != nil {
		return err
	}
	tmplID := tmpl.str("id")
	if _, err := s.call("list_sheet_templates", nil); err != nil {
		return err
	}
	if _, err := s.call("get_sheet_template", map[string]any{"templateId": tmplID}); err != nil {
		return err
	}
	if _, err := s.call("update_sheet_template", map[string]any{"templateId": tmplID, "name": "Weekend packing"}); err != nil {
		return err
	}
	if _, err := s.call("materialize_sheet_template_tab", map[string]any{"templateId": tmplID}); err != nil {
		return err
	}
	next, err := s.call("create_sheet", map[string]any{"title": "Next trip", "workspaceId": s.l.workspaces["Home"], "templateId": tmplID})
	if err != nil {
		return err
	}
	nextID := next.str("sheet", "id")
	if _, err := s.call("archive_sheet", map[string]any{"sheetId": nextID, "archived": true}); err != nil {
		return err
	}
	archived, err := s.call("list_sheets", map[string]any{"archived": true})
	if err != nil {
		return err
	}
	s.expect(archived.hasIDs(nextID), "list_sheets archived=true lists the archived sheet", nextID, archived.idsAnywhere())
	if _, err := s.call("archive_sheet", map[string]any{"sheetId": nextID, "archived": false}); err != nil {
		return err
	}
	if _, err := s.call("delete_sheet", map[string]any{"sheetId": nextID}); err != nil {
		return err
	}
	if _, err := s.call("delete_sheet_template", map[string]any{"templateId": tmplID}); err != nil {
		return err
	}
	sheets, err := s.call("list_sheets", map[string]any{"workspaceId": s.l.workspaces["Home"]})
	if err != nil {
		return err
	}
	s.expect(sheets.hasIDs(id) && !slices.Contains(sheets.idsAnywhere(), nextID), "list_sheets keeps the packing list and drops the deleted copy", id, sheets.idsAnywhere())
	return nil
}

func (s *sim) deskDoc(d day) error {
	doc, err := s.call("create_doc", map[string]any{"title": "Desk setup", "workspaceId": s.l.workspaces["Home"], "markdown": "# Desk setup\n\nStanding desk by the window."})
	if err != nil {
		return err
	}
	id := doc.str("id")
	s.l.named = append(s.l.named, named{"doc", id, "Desk setup"})
	if _, err := s.call("add_3d_model", map[string]any{"docId": id, "name": "desk", "parts": []map[string]any{
		{"name": "top", "shape": "box", "center": []float64{0, 0, 72}, "size": []float64{140, 70, 3}, "color": "#8B5A2B"},
		{"name": "leg", "shape": "cylinder", "center": []float64{0, 0, 36}, "size": []float64{4, 4, 72}, "color": "#333333"},
	}}); err != nil {
		return err
	}
	got, err := s.call("get_doc", map[string]any{"docId": id, "full": true})
	if err != nil {
		return err
	}
	s.expect(strings.Contains(compact(got), "stl"), "add_3d_model writes an stl block into the doc", "an stl fence", clip(compact(got), 300))
	if _, err := s.call("update_doc", map[string]any{"docId": id, "isFavorite": true}); err != nil {
		return err
	}
	md, err := s.call("export_doc", map[string]any{"docId": id, "format": "markdown"})
	if err != nil {
		return err
	}
	s.expect(strings.Contains(compact(md), "Standing desk by the window"), "export_doc markdown carries the body", "Standing desk by the window", clip(compact(md), 300))
	if _, err := s.call("export_doc", map[string]any{"docId": id, "format": "pdf"}); err != nil {
		return err
	}
	if _, err := s.call("archive_doc", map[string]any{"docId": id, "archived": true}); err != nil {
		return err
	}
	archived, err := s.call("list_docs", map[string]any{"archived": true})
	if err != nil {
		return err
	}
	s.expect(archived.hasIDs(id), "list_docs archived=true lists the archived doc", id, archived.idsAnywhere())
	if _, err := s.call("archive_doc", map[string]any{"docId": id, "archived": false}); err != nil {
		return err
	}
	draft, err := s.call("create_doc", map[string]any{"title": "Desk shopping draft", "workspaceId": s.l.workspaces["Home"], "markdown": "monitor arm?"})
	if err != nil {
		return err
	}
	if _, err := s.call("delete_doc", map[string]any{"docId": draft.str("id"), "confirm": true}); err != nil {
		return err
	}
	docs, err := s.call("list_docs", map[string]any{"workspaceId": s.l.workspaces["Home"]})
	if err != nil {
		return err
	}
	s.expect(docs.hasIDs(id) && !slices.Contains(docs.idsAnywhere(), draft.str("id")), "list_docs keeps the desk doc and drops the deleted draft", id, docs.idsAnywhere())
	return nil
}

// reworkEvents moves the day's first event an hour later and cancels the
// second; the day's agenda check then sees the result.
func (s *sim) reworkEvents(d day) error {
	var today []*eventRec
	for _, e := range s.l.events {
		if !e.start.Before(d.date) && e.start.Before(d.next()) {
			today = append(today, e)
		}
	}
	for len(today) < 2 {
		start := d.at(17, len(today)*30)
		out, err := s.call("create_event", map[string]any{"title": fmt.Sprintf("Errand run %d (%s)", len(today)+1, d.label()),
			"start": start.Format(time.RFC3339), "end": start.Add(30 * time.Minute).Format(time.RFC3339), "workspaceId": s.l.workspaces["Home"]})
		if err != nil {
			return err
		}
		e := &eventRec{id: out.str("id"), title: out.str("title"), start: start, end: start.Add(30 * time.Minute)}
		s.l.events = append(s.l.events, e)
		today = append(today, e)
	}
	moved := today[0]
	start, end := moved.start.Add(time.Hour), moved.end.Add(time.Hour)
	if _, err := s.call("update_event", map[string]any{"eventId": moved.id, "start": start.Format(time.RFC3339), "end": end.Format(time.RFC3339)}); err != nil {
		return err
	}
	moved.start, moved.end = start, end
	got, err := s.call("get_event", map[string]any{"eventId": moved.id})
	if err != nil {
		return err
	}
	gotStart, _ := time.Parse(time.RFC3339, got.str("start"))
	s.expect(gotStart.Equal(start), "update_event moves the event", start.Format(time.RFC3339), got.str("start"))
	if _, err := s.call("delete_event", map[string]any{"eventId": today[1].id}); err != nil {
		return err
	}
	s.l.events = slices.DeleteFunc(s.l.events, func(e *eventRec) bool { return e.id == today[1].id })
	list, err := s.call("list_events", nil)
	if err != nil {
		return err
	}
	s.expect(!slices.Contains(list.idsAnywhere(), today[1].id), "delete_event removes it from list_events", "absent", today[1].id)
	return nil
}

// moveStandup skips one future standup, skips and restores another, and
// moves the series to 10:00 from the last Monday of the window.
func (s *sim) moveStandup(d day) error {
	if len(s.l.series) == 0 {
		return nil
	}
	st := s.l.series[0]
	mondays := []time.Time{}
	for t := firstOnOrAfter(d.date, time.Monday); t.Before(s.days[windowDays-1].next()); t = t.AddDate(0, 0, 7) {
		mondays = append(mondays, t)
	}
	if len(mondays) < 2 {
		return nil
	}
	first := at(mondays[0], st.hour, st.minute).Format(time.RFC3339)
	if _, err := s.call("edit_event_occurrence", map[string]any{"eventId": st.id, "originalStart": first, "action": "skip"}); err != nil {
		return err
	}
	if _, err := s.call("edit_event_occurrence", map[string]any{"eventId": st.id, "originalStart": first, "action": "restore"}); err != nil {
		return err
	}
	if _, err := s.call("edit_event_occurrence", map[string]any{"eventId": st.id, "originalStart": first, "action": "skip"}); err != nil {
		return err
	}
	st.skipped[mondays[0].Format(time.DateOnly)] = true
	last := mondays[len(mondays)-1]
	newStart := at(last, 10, 0)
	out, err := s.call("split_event_series", map[string]any{"eventId": st.id, "fromStart": at(last, st.hour, st.minute).Format(time.RFC3339),
		"rrule": "FREQ=WEEKLY;BYDAY=MO", "timezone": s.tz.String(), "start": newStart.Format(time.RFC3339), "end": newStart.Add(15 * time.Minute).Format(time.RFC3339)})
	if err != nil {
		return err
	}
	newID := out.str("id")
	if newID == "" {
		newID = out.str("event", "id")
	}
	if !s.expect(newID != "" && newID != st.id, "split_event_series returns the new series", "a new event id", out) {
		return nil
	}
	st.until = last.Format(time.DateOnly)
	s.l.series = append(s.l.series, &seriesRec{id: newID, title: st.title, weekday: time.Monday, hour: 10, minutes: 15, from: last.Format(time.DateOnly), skipped: map[string]bool{}})
	return nil
}

// stretchSeries tries a daily stretch reminder, changes its rule, splits it,
// then gives up on it and deletes both halves.
func (s *sim) stretchSeries(d day) error {
	first := s.days[todayIndex+1].at(16, 0)
	out, err := s.call("create_task", map[string]any{"name": "Stretch break", "kind": "reminder", "scheduleAt": first.Format(time.RFC3339),
		"recurrence": map[string]any{"rrule": "FREQ=DAILY;COUNT=5", "dtstart": first.Format(time.RFC3339), "timezone": s.tz.String()}})
	if err != nil {
		return err
	}
	id := out.str("task", "id")
	if _, err := s.call("set_task_recurrence", map[string]any{"taskId": id, "rrule": "FREQ=DAILY;COUNT=4", "dtstart": first.Format(time.RFC3339), "timezone": s.tz.String()}); err != nil {
		return err
	}
	from := first.AddDate(0, 0, 2)
	split, err := s.call("split_task_series", map[string]any{"taskId": id, "fromStart": from.Format(time.RFC3339), "rrule": "FREQ=DAILY;COUNT=2",
		"dtstart": from.Add(time.Hour).Format(time.RFC3339), "timezone": s.tz.String(), "name": "Stretch break (later)"})
	if err != nil {
		return err
	}
	if _, err := s.call("clear_task_recurrence", map[string]any{"taskId": id}); err != nil {
		return err
	}
	for _, t := range []string{id, split.str("task", "id")} {
		if t == "" {
			continue
		}
		if _, err := s.call("delete_task", map[string]any{"taskId": t}); err != nil {
			return err
		}
	}
	return nil
}

// ---- Daily rows ----

func (s *sim) captureInbox(d day) error {
	r := s.rng(d, "capture")
	n := 1 + r.IntN(3)
	pool := append(slices.Clone(workChores), homeChores...)
	r.Shuffle(len(pool), func(i, j int) { pool[i], pool[j] = pool[j], pool[i] })
	for _, phrase := range pool[:n] {
		name := fmt.Sprintf("%s (%s)", phrase, d.label())
		out, err := s.call("capture_inbox_item", map[string]any{"name": name})
		if err != nil {
			return err
		}
		id := out.str("task", "id")
		s.expect(out.str("task", "kind") == "inbox", "capture_inbox_item files the item as kind=inbox", "inbox", out.str("task", "kind"))
		s.l.inbox = append(s.l.inbox, id)
		s.l.tasks[id] = &taskRec{id: id, name: name, workspace: workspaceFor(phrase)}
	}
	return nil
}

func (s *sim) clarifyInbox(d day) error {
	r := s.rng(d, "clarify")
	var kept []string
	for _, id := range s.l.inbox {
		item := s.l.tasks[id]
		if r.Float64() > 0.6 {
			kept = append(kept, id)
			continue
		}
		duration := []int{15, 30, 45, 60, 90}[r.IntN(5)]
		priority := []string{"Low", "Medium", "High"}[r.IntN(3)]
		args := map[string]any{"taskId": id, "kind": "task", "workspaceId": s.l.workspaces[item.workspace], "duration": duration, "priorityLevel": priority}
		stage := ""
		if item.workspace == "Work" && r.IntN(3) == 0 {
			stage = []string{"Backlog", "Building", "Review"}[r.IntN(3)]
			args["projectId"] = s.l.project.id
		}
		out, err := s.call("clarify_inbox_item", args)
		if err != nil {
			kept = append(kept, id)
			continue
		}
		delete(s.l.tasks, id)
		t := &taskRec{id: out.str("task", "id"), name: item.name, workspace: item.workspace, duration: duration, priority: priority}
		s.expect(out.str("task", "kind") == "task" && int(out.num("task", "duration")) == duration,
			"clarify_inbox_item returns a work task with the asked duration", map[string]any{"kind": "task", "duration": duration}, map[string]any{"kind": out.str("task", "kind"), "duration": out.num("task", "duration")})
		if args["projectId"] != nil {
			t.projectID = s.l.project.id
		}
		t.deadline = d.date.AddDate(0, 0, r.IntN(6)).Format(time.DateOnly)
		update := map[string]any{"taskId": t.id, "deadline": t.deadline}
		if stage != "" {
			t.stageID = s.l.project.stages[stage]
			update["stageId"] = t.stageID
		}
		if _, err := s.call("update_task", update); err != nil {
			return err
		}
		s.l.addTask(t)
	}
	s.l.inbox = kept
	return nil
}

func (s *sim) addEvents(d day) error {
	r := s.rng(d, "events")
	n := r.IntN(3)
	slots := slices.Clone(eventSlots)
	r.Shuffle(len(slots), func(i, j int) { slots[i], slots[j] = slots[j], slots[i] })
	for k := 0; k < n; k++ {
		title := fmt.Sprintf("%s (%s)", eventTitles[r.IntN(len(eventTitles))], d.label())
		start := d.at(slots[k][0], slots[k][1])
		end := start.Add(time.Duration([]int{30, 60}[r.IntN(2)]) * time.Minute)
		ws := "Work"
		if r.IntN(3) == 0 {
			ws = "Home"
		}
		out, err := s.call("create_event", map[string]any{"title": title, "start": start.Format(time.RFC3339), "end": end.Format(time.RFC3339), "workspaceId": s.l.workspaces[ws]})
		if err != nil {
			return err
		}
		s.l.events = append(s.l.events, &eventRec{id: out.str("id"), title: title, start: start, end: end})
		s.l.named = append(s.l.named, named{"event", out.str("id"), title})
	}
	return nil
}

func (s *sim) planAhead(d day) error {
	r := s.rng(d, "plan ahead")
	phrase := workChores[r.IntN(len(workChores))]
	name := fmt.Sprintf("%s (%s)", phrase, d.label())
	duration := []int{30, 45, 60}[r.IntN(3)]
	out, err := s.call("create_task", map[string]any{"name": name, "workspaceId": s.l.workspaces["Work"], "duration": duration, "deadline": d.ymd()})
	if err != nil {
		return err
	}
	s.expect(out.str("task", "deadline") == d.ymd(), "create_task keeps the deadline", d.ymd(), out.str("task", "deadline"))
	s.l.addTask(&taskRec{id: out.str("task", "id"), name: name, workspace: "Work", deadline: d.ymd(), duration: duration})
	return nil
}

// scheduleBlock pins the oldest open task without a block at 13:00 that day.
// The server refuses blocks in the past, so on lived days the persona only
// tries once, on the first day, and expects the refusal.
func (s *sim) scheduleBlock(d day) error {
	var pick *taskRec
	for _, t := range s.l.openTasks() {
		if t.duration > 0 && t.duration <= 90 && !s.l.hasBlock(t.id) {
			pick = t
			break
		}
	}
	if pick == nil {
		return nil
	}
	start := d.at(13, 0)
	if d.past() {
		if d.i == 0 {
			return s.reject("schedule_task", map[string]any{"taskId": pick.id, "start": start.Format(time.RFC3339), "durationMinutes": pick.duration}, "already passed")
		}
		return nil
	}
	if d.isToday() {
		earliest := time.Now().In(s.tz).Add(20 * time.Minute).Truncate(15 * time.Minute).Add(15 * time.Minute)
		if earliest.After(start) {
			start = earliest
		}
		if !start.Add(time.Duration(pick.duration) * time.Minute).Before(d.next()) {
			s.note("today's block skipped: too late in the day to fit " + pick.name)
			return nil
		}
	}
	out, err := s.call("schedule_task", map[string]any{"taskId": pick.id, "start": start.Format(time.RFC3339), "durationMinutes": pick.duration})
	if err != nil {
		return err
	}
	blocks := out.list("blocks")
	if !s.expect(len(blocks) == 1, "schedule_task places exactly one block", 1, len(blocks)) {
		return nil
	}
	end := start.Add(time.Duration(pick.duration) * time.Minute)
	s.l.blocks = append(s.l.blocks, blockRec{id: out.objs("blocks")[0].str("id"), taskID: pick.id, start: start, end: end})
	return nil
}

func (s *sim) checkHabits(d day) error {
	r := s.rng(d, "habits")
	for k, h := range s.l.habits {
		done := r.Float64() < h.p
		if k == 0 && d.i >= todayIndex-6 && d.i < todayIndex {
			done = true
		}
		if !done {
			continue
		}
		out, err := s.call("check_habit", map[string]any{"habit": h.name, "day": d.ymd(), "timezone": s.tz.String()})
		if err != nil {
			return err
		}
		h.done[d.ymd()] = true
		s.expect(out.str("id") == h.id, "check_habit by name finds the habit", h.id, out.str("id"))
	}
	return nil
}

func (s *sim) dailyNote(d day) error {
	line := fmt.Sprintf("\n\n- %s: %d tasks open, %d in the inbox.", d.label(), len(s.l.openTasks()), len(s.l.inbox))
	if d.date.Weekday() == time.Monday {
		line += " Planned the week in [[Weekly plan]]."
	}
	id := s.l.notes[d.ymd()]
	if id == "" {
		if s.listed["open_daily_note"] {
			out, err := s.call("open_daily_note", map[string]any{"date": d.ymd()})
			if err != nil {
				return err
			}
			id = out.str("id")
			if id == "" {
				id = out.str("doc", "id")
			}
			s.expect(id != "", "open_daily_note returns the doc", "a doc id", out)
		} else {
			s.missing["open_daily_note"] = true
			out, err := s.call("create_doc", map[string]any{"title": d.ymd(), "workspaceId": s.l.workspaces["Home"], "markdown": "# " + d.date.Format("Monday, January 2")})
			if err != nil {
				return err
			}
			id = out.str("id")
		}
		s.l.notes[d.ymd()] = id
		s.l.named = append(s.l.named, named{"doc", id, d.ymd()})
	}
	if _, err := s.call("append_to_doc", map[string]any{"docId": id, "markdown": line}); err != nil {
		return err
	}
	if strings.Contains(line, "[[Weekly plan]]") {
		s.l.linkedNotes = append(s.l.linkedNotes, id)
	}
	return nil
}

func (s *sim) logExpenses(d day) error {
	sheet := s.l.sheets[d.date.Year()]
	if sheet == "" {
		return nil
	}
	r := s.rng(d, "expenses")
	n := r.IntN(3)
	month := d.date.Month().String()
	for k := 0; k < n; k++ {
		p := purchases[r.IntN(len(purchases))]
		e := expense{day: d.ymd(), item: p.item, category: p.category, qty: 1 + r.IntN(3), unit: p.lo + r.IntN(p.hi-p.lo)}
		out, err := s.call("add_sheet_row", map[string]any{"sheetId": sheet, "tabId": month, "cells": map[string]string{
			"Date": e.day, "Item": e.item, "Category": e.category, "Qty": fmt.Sprint(e.qty), "Unit price": fmt.Sprint(e.unit), "Paid with": "Card",
		}})
		if err != nil {
			return err
		}
		s.l.expenses[monthKey(d.date)] = append(s.l.expenses[monthKey(d.date)], e)
		s.expect(out.num("row") > 1, "add_sheet_row lands below the totals row", "> 1", out.num("row"))
	}
	return nil
}

// completeTasks decides once for each task that comes due by tomorrow:
// finish it that day, or let it slide, so lived days build up real overdue
// work. Past days are backdated with completedAt; today uses complete_task.
func (s *sim) completeTasks(d day) error {
	r := s.rng(d, "complete")
	horizon := d.date.AddDate(0, 0, 1).Format(time.DateOnly)
	for _, t := range s.l.openTasks() {
		if t.decided || t.deadline == "" || t.deadline > horizon {
			continue
		}
		t.decided = true
		if r.Float64() > 0.6 {
			continue
		}
		if d.isToday() {
			out, err := s.call("complete_task", map[string]any{"taskId": t.id})
			if err != nil {
				return err
			}
			s.expect(out.str("task", "completedAt") != "", "complete_task sets completedAt", "non-empty", out.str("task", "completedAt"))
		} else {
			doneAt := d.at(18, 0).Format(time.RFC3339)
			if _, err := s.call("update_task", map[string]any{"taskId": t.id, "completedAt": doneAt}); err != nil {
				return err
			}
		}
		t.completedOn = d.ymd()
	}
	return nil
}

func (s *sim) tickPlants(d day) error {
	p := s.l.plants
	if p == nil || d.ymd() < p.from {
		return nil
	}
	original := d.at(p.hour, 0)
	if s.rng(d, "plants").IntN(4) == 0 {
		if _, err := s.call("edit_task_occurrence", map[string]any{"taskId": p.id, "originalStart": original.Format(time.RFC3339), "action": "skip"}); err != nil {
			return err
		}
		p.skipped[d.ymd()] = true
		return nil
	}
	if _, err := s.call("edit_task_occurrence", map[string]any{"taskId": p.id, "originalStart": original.Format(time.RFC3339), "action": "complete"}); err != nil {
		return err
	}
	p.completed[d.ymd()] = true
	return nil
}

// openMonth makes sure the year's expenses workbook exists and closes the
// previous month by checking its totals against the ledger.
func (s *sim) openMonth(d day) error {
	year := d.date.Year()
	if s.l.sheets[year] == "" {
		out, err := s.call("create_sheet", map[string]any{"title": fmt.Sprintf("Expenses %d", year), "workspaceId": s.l.workspaces["Home"],
			"templateId": "builtin:yearly-expenses", "year": year, "currency": "LKR"})
		if err != nil {
			return err
		}
		s.l.sheets[year] = out.str("sheet", "id")
		s.l.named = append(s.l.named, named{"sheet", s.l.sheets[year], fmt.Sprintf("Expenses %d", year)})
	}
	tab, err := s.call("get_sheet", map[string]any{"sheetId": s.l.sheets[year], "tabId": d.date.Month().String()})
	if err != nil {
		return err
	}
	s.expect(tab.str("tab", "name") == d.date.Month().String(), "the expenses workbook has a tab for the month", d.date.Month().String(), tab.str("tab", "name"))
	if d.i > 0 {
		return s.assertMonth(d.date.AddDate(0, 0, -1))
	}
	return nil
}

func (s *sim) assertAllExpenses(d day) error {
	for m := s.days[0].date; !m.After(d.date); m = m.AddDate(0, 1, 0) {
		if err := s.assertMonth(m); err != nil {
			return err
		}
	}
	return nil
}

// assertMonth checks the month's SUM and per-category SUMIF in the sheet
// against the expenses the ledger logged for it.
func (s *sim) assertMonth(t time.Time) error {
	sheet := s.l.sheets[t.Year()]
	if sheet == "" {
		return nil
	}
	month := t.Month().String()
	rows := s.l.expenses[monthKey(t)]
	total, byCategory := 0, map[string]int{}
	for _, e := range rows {
		total += e.total()
		byCategory[e.category] += e.total()
	}
	out, err := s.call("get_sheet_values", map[string]any{"sheetId": sheet, "formula": fmt.Sprintf("=SUM(%s!H2:H)", month)})
	if err != nil {
		return err
	}
	s.expect(int(out.num("value")) == total, fmt.Sprintf("SUM(%s!H2:H) equals the ledger's %d expenses", month, len(rows)), total, out.raw("value"))
	for _, category := range sortedKeys(byCategory) {
		out, err := s.call("get_sheet_values", map[string]any{"sheetId": sheet, "formula": fmt.Sprintf("=SUMIF(%s!C2:C,\"%s\",%s!H2:H)", month, category, month)})
		if err != nil {
			return err
		}
		s.expect(int(out.num("value")) == byCategory[category], fmt.Sprintf("SUMIF %s %q equals the ledger's", month, category), byCategory[category], out.raw("value"))
	}
	return nil
}

// ---- Weekly rows ----

func (s *sim) reviewWeek(d day) error {
	if err := s.agendaMatches(d.date, d.date.AddDate(0, 0, 7), fmt.Sprintf("get_agenda for the week of %s lists exactly the ledger's events and blocks", d.ymd())); err != nil {
		return err
	}
	if err := s.plantsMatch(d.date.AddDate(0, 0, -7), d.date); err != nil {
		return err
	}
	if res, err := s.prompt("weekly_review", map[string]string{"weekStart": d.ymd()}); err == nil {
		s.promptNamesListedTools("weekly_review", res, d.ymd())
	} else if !errors.Is(err, errMissing) {
		return err
	}
	if err := s.focusSessionsMatch(d.date.AddDate(0, 0, -7), d.date); err != nil && !errors.Is(err, errMissing) {
		return err
	}
	if progress, err := s.call("get_goal_progress", nil); err == nil {
		s.expect(progress.at("goals") != nil, "get_goal_progress reports per-goal progress", "goals", progress)
	} else if !errors.Is(err, errMissing) {
		return err
	}
	if _, err := s.call("list_stale_work", nil); err != nil && !errors.Is(err, errMissing) {
		return err
	}
	return nil
}

// plantsMatch checks the weekly reminder on get_calendar: one occurrence on
// each Sunday of [from, to) unless skipped, completed where the ledger says.
func (s *sim) plantsMatch(from, to time.Time) error {
	p := s.l.plants
	if p == nil {
		return nil
	}
	out, err := s.call("get_calendar", map[string]any{"from": from.Format(time.RFC3339), "to": to.Format(time.RFC3339), "timezone": s.tz.String()})
	if err != nil {
		return err
	}
	want, got := map[string]int{}, map[string]int{}
	for t := from; t.Before(to); t = t.AddDate(0, 0, 1) {
		ymd := t.Format(time.DateOnly)
		if t.Weekday() == p.weekday && ymd >= p.from && !p.skipped[ymd] {
			want[fmt.Sprintf("%s done=%v", at(t, p.hour, 0).UTC().Format(time.RFC3339), p.completed[ymd])]++
		}
	}
	for _, item := range out.objs("items") {
		if item.str("taskId") != p.id {
			continue
		}
		start, _ := time.Parse(time.RFC3339, item.str("start"))
		got[fmt.Sprintf("%s done=%v", start.UTC().Format(time.RFC3339), item.str("completedAt") != "")]++
	}
	if diff := diffCounts(want, got); diff != "" {
		s.fail(fmt.Sprintf("get_calendar %s..%s shows the weekly reminder on its Sundays with the ledger's completions: %s", from.Format(time.DateOnly), to.Format(time.DateOnly), diff), sortedKeys(want), sortedKeys(got))
	}
	return nil
}

func (s *sim) focusSessionsMatch(from, to time.Time) error {
	out, err := s.call("list_focus_sessions", map[string]any{"from": from.Format(time.DateOnly), "to": to.AddDate(0, 0, -1).Format(time.DateOnly)})
	if err != nil {
		return err
	}
	var want, got []string
	for _, f := range s.l.focus {
		if !f.started.Before(from) && f.started.Before(to) {
			want = append(want, f.taskID)
		}
	}
	for _, item := range out.objs("sessions") {
		got = append(got, item.str("taskId"))
	}
	if diff := diffSets(want, got); diff != "" {
		s.fail(fmt.Sprintf("list_focus_sessions %s..%s equals the ledger's sessions: %s", from.Format(time.DateOnly), to.Format(time.DateOnly), diff), want, out)
	}
	return nil
}

// pushChores moves every overdue Home chore's deadline to next Monday in one
// bulk edit, the way a person clears the week's guilt pile.
func (s *sim) pushChores(d day) error {
	var picked []string
	for _, t := range s.l.openTasks() {
		if t.workspace == "Home" && t.deadline != "" && t.deadline < d.ymd() {
			picked = append(picked, t.id)
		}
	}
	if _, err := s.call("pick_tasks", map[string]any{"description": "overdue home chores"}); err != nil {
		return err
	}
	if len(picked) == 0 {
		return nil
	}
	deadline := d.date.AddDate(0, 0, 7).Format(time.DateOnly)
	if _, err := s.call("bulk_update_tasks", map[string]any{"ids": picked, "update": map[string]any{"deadline": deadline}}); err != nil {
		return err
	}
	for _, id := range picked {
		s.l.tasks[id].deadline = deadline
	}
	check, err := s.call("get_task", map[string]any{"taskId": picked[0]})
	if err != nil {
		return err
	}
	s.expect(check.str("task", "deadline") == deadline, "bulk_update_tasks moved the chore's deadline", deadline, check.str("task", "deadline"))
	return nil
}

var stageFlow = []string{"Backlog", "Building", "Review"}

func (s *sim) advanceStages(d day) error {
	for _, t := range s.l.openTasks() {
		if t.projectID == "" || t.stageID == "" {
			continue
		}
		k := slices.IndexFunc(stageFlow, func(name string) bool { return s.l.project.stages[name] == t.stageID })
		if k < 0 || k == len(stageFlow)-1 {
			continue
		}
		next := s.l.project.stages[stageFlow[k+1]]
		if _, err := s.call("move_task_to_stage", map[string]any{"taskId": t.id, "stageId": next}); err != nil {
			return err
		}
		t.stageID = next
	}
	for _, name := range stageFlow {
		stage := s.l.project.stages[name]
		var want []string
		for _, t := range s.l.openTasks() {
			if t.stageID == stage {
				want = append(want, t.id)
			}
		}
		out, err := s.call("list_tasks", map[string]any{"projectId": s.l.project.id, "stageId": stage, "completed": false, "limit": 500})
		if err != nil {
			return err
		}
		var got []string
		for _, t := range out.objs("tasks") {
			got = append(got, t.str("id"))
		}
		if diff := diffSets(want, got); diff != "" {
			s.fail(fmt.Sprintf("list_tasks in stage %s equals the ledger's: %s", name, diff), want, got)
		}
	}
	return nil
}

// revisePlan rewrites the weekly plan doc, then reads its history, restores
// the oldest version, and checks the daily notes that link to it.
func (s *sim) revisePlan(d day) error {
	body := fmt.Sprintf("# Weekly plan\n\nWeek of %s: ship one relaunch stage, three workouts, inbox zero.", d.label())
	if _, err := s.call("update_doc", map[string]any{"docId": s.l.planDoc, "markdown": body}); err != nil {
		return err
	}
	versions, err := s.call("list_doc_versions", map[string]any{"docId": s.l.planDoc})
	if err != nil {
		return err
	}
	list := versions.objs("versions")
	if !s.expect(len(list) > 0, "list_doc_versions has the edited doc's history", "at least one version", versions) {
		return nil
	}
	current := slices.ContainsFunc(list, func(v obj) bool { return v.bool("current") })
	s.expect(current, "list_doc_versions marks the version that holds the doc as it is now", "a version with current=true", list)
	oldest := list[len(list)-1]
	if _, err := s.call("restore_doc_version", map[string]any{"docId": s.l.planDoc, "versionId": oldest.str("id")}); err != nil {
		return err
	}
	doc, err := s.call("get_doc", map[string]any{"docId": s.l.planDoc})
	if err != nil {
		return err
	}
	title := doc.str("title")
	if title == "" {
		title = doc.str("doc", "title")
	}
	s.expect(title == oldest.str("title"), "restore_doc_version puts the version's title back", oldest.str("title"), title)
	links, err := s.call("get_doc_backlinks", map[string]any{"docId": s.l.planDoc})
	if err != nil {
		return err
	}
	var got []string
	for _, b := range links.objs("backlinks") {
		got = append(got, b.str("id"))
	}
	if diff := diffSets(s.l.linkedNotes, got); diff != "" {
		s.fail("get_doc_backlinks lists exactly the daily notes that link [[Weekly plan]]: "+diff, s.l.linkedNotes, got)
	}
	return nil
}

// ---- Today rows ----

func (s *sim) overdueIDs(today string) []string {
	var ids []string
	for _, t := range s.l.openTasks() {
		if t.deadline != "" && t.deadline < today {
			ids = append(ids, t.id)
		}
	}
	return ids
}

func (s *sim) startDay(d day) error {
	if res, err := s.prompt("plan_my_day", map[string]string{"date": d.ymd()}); err == nil {
		s.promptNamesListedTools("plan_my_day", res, d.ymd())
	} else if !errors.Is(err, errMissing) {
		return err
	}
	bare, err := s.call("get_agenda", map[string]any{"from": d.ymd()})
	if err != nil {
		return err
	}
	s.expect(bare.str("from") != "" && sameInstant(bare.str("from"), d.date), "get_agenda from=YYYY-MM-DD (as plan_my_day passes it) starts at midnight in the account's timezone",
		d.date.Format(time.RFC3339), bare.str("from"))
	freeBare, err := s.call("get_free_time", map[string]any{"from": d.ymd()})
	if err != nil {
		return err
	}
	for _, slot := range freeBare.objs("slots") {
		start, _ := time.Parse(time.RFC3339, slot.str("start"))
		s.expect(!start.Before(d.date) && start.Before(d.next()), "get_free_time from=YYYY-MM-DD returns slots on that day in the account's timezone", d.ymd(), slot.str("start"))
	}
	view, err := s.call("get_today", map[string]any{"date": d.ymd(), "timezone": s.tz.String()})
	if err != nil {
		return err
	}
	var overdue []string
	for _, t := range view.objs("overdue") {
		overdue = append(overdue, t.str("id"))
	}
	if diff := diffSets(s.overdueIDs(d.ymd()), overdue); diff != "" {
		s.fail("get_today overdue equals the ledger's overdue work: "+diff, len(s.overdueIDs(d.ymd())), len(overdue))
	}
	s.expect(int(view.num("inboxCount")) == len(s.l.inbox), "get_today inboxCount equals the ledger's inbox", len(s.l.inbox), view.num("inboxCount"))

	next, err := s.call("what_next", map[string]any{"timezone": s.tz.String()})
	if err != nil {
		return err
	}
	var focus []string
	for _, t := range next.objs("tasks") {
		id := t.str("ID")
		rec := s.l.tasks[id]
		if !s.expect(rec != nil && rec.open(), "what_next only ranks the ledger's open work", "an open ledger task", t) {
			continue
		}
		if len(focus) < 3 {
			focus = append(focus, id)
		}
	}
	if !s.expect(len(focus) > 0, "what_next ranks something with this much open work", "> 0 tasks", next) {
		return nil
	}
	for _, id := range focus {
		if _, err := s.call("set_today_focus", map[string]any{"taskId": id, "date": d.ymd()}); err != nil {
			return err
		}
	}
	if _, err := s.call("start_focus", map[string]any{"taskId": focus[0]}); err != nil {
		return err
	}
	s.l.focusing = &focusRec{taskID: focus[0], started: time.Now()}
	view, err = s.call("get_today", map[string]any{"date": d.ymd(), "timezone": s.tz.String()})
	if err != nil {
		return err
	}
	var gotFocus []string
	for _, t := range view.objs("todayFocus") {
		gotFocus = append(gotFocus, t.str("id"))
	}
	if diff := diffSets(focus, gotFocus); diff != "" {
		s.fail("get_today todayFocus equals the tasks set_today_focus added: "+diff, focus, gotFocus)
	}
	s.expect(view.str("focusing", "id") == focus[0], "get_today shows the task start_focus started", focus[0], view.str("focusing", "id"))

	free, err := s.call("get_free_time", map[string]any{"from": d.date.Format(time.RFC3339), "to": d.next().Format(time.RFC3339), "timezone": s.tz.String()})
	if err != nil {
		return err
	}
	busy := s.l.agendaKeys(d.date, d.next())
	for _, slot := range free.objs("slots") {
		from, _ := time.Parse(time.RFC3339, slot.str("start"))
		to, _ := time.Parse(time.RFC3339, slot.str("end"))
		if overlap := s.l.agendaKeys(from, to); len(overlap) > 0 {
			s.fail("get_free_time returns a slot that overlaps the ledger's busy time", sortedKeys(busy), slot)
		}
	}
	if _, err := s.call("get_capacity", map[string]any{"from": d.date.Format(time.RFC3339), "to": d.date.AddDate(0, 0, 7).Format(time.RFC3339), "timezone": s.tz.String()}); err != nil {
		return err
	}
	if _, err := s.call("get_today_suggestions", nil); err != nil && !errors.Is(err, errMissing) {
		return err
	}
	return nil
}

func (s *sim) setReminder(d day) error {
	ping := time.Now().In(s.tz).Add(20 * time.Second).Truncate(time.Second)
	out, err := s.call("create_task", map[string]any{"name": "Stretch and drink water", "kind": "reminder", "scheduleAt": ping.Format(time.RFC3339)})
	if err != nil {
		return err
	}
	s.l.reminder = out.str("task", "id")
	s.expect(out.str("task", "kind") == "reminder", "create_task kind=reminder makes a reminder", "reminder", out.str("task", "kind"))
	return nil
}

// autoSchedule previews, applies and undoes the engine. Apply must place what
// the preview proposed, the agenda must then show those blocks next to the
// manual ones, and undo must leave the agenda as it was.
func (s *sim) autoSchedule(d day) error {
	horizon := d.date.AddDate(0, 0, futureDays+1)
	args := map[string]any{"timezone": s.tz.String()}
	preview, err := s.call("auto_schedule_preview", args)
	if err != nil {
		return err
	}
	applied, err := s.call("auto_schedule_apply", args)
	if err != nil {
		return err
	}
	if diff := diffSets(proposedTasks(preview), proposedTasks(applied)); diff != "" {
		s.fail("auto_schedule_apply places the tasks auto_schedule_preview proposed: "+diff, proposedTasks(preview), proposedTasks(applied))
	}
	s.l.engine = nil
	for _, p := range applied.objs("proposals") {
		for _, b := range p.objs("blocks") {
			start, _ := time.Parse(time.RFC3339, b.str("start"))
			end, _ := time.Parse(time.RFC3339, b.str("end"))
			s.l.engine = append(s.l.engine, blockRec{taskID: p.str("taskId"), start: start, end: end})
		}
	}
	s.expect(len(s.l.engine) > 0, "auto_schedule_apply places some of the open work", "> 0 blocks", applied.raw("skipped"))
	if err := s.agendaMatches(d.date, horizon, "after auto_schedule_apply, get_agenda shows the manual blocks plus the applied plan"); err != nil {
		return err
	}
	undo, err := s.call("undo_schedule_preview", nil)
	if err != nil {
		return err
	}
	s.expect(undo.bool("canUndo"), "undo_schedule_preview can undo the apply", true, undo.raw("canUndo"))
	s.expect(len(undo.list("remove")) == len(s.l.engine), "undo_schedule_preview removes every applied block", len(s.l.engine), len(undo.list("remove")))
	if _, err := s.call("undo_schedule", nil); err != nil {
		return err
	}
	s.l.engine = nil
	return s.agendaMatches(d.date, horizon, "after undo_schedule, get_agenda shows only the manual blocks again")
}

var toolWord = regexp.MustCompile(`\b[a-z]+(?:_[a-z]+)+\b`)

// promptNamesListedTools checks a prompt's text names the day it was asked
// for and only tools the server lists.
func (s *sim) promptNamesListedTools(name string, res *mcp.GetPromptResult, date string) {
	var text string
	for _, m := range res.Messages {
		if t, ok := m.Content.(*mcp.TextContent); ok {
			text += t.Text
		}
	}
	s.expect(strings.Contains(text, date), "prompts/get "+name+" names the asked date", date, clip(text, 300))
	for _, word := range toolWord.FindAllString(text, -1) {
		s.expect(s.listed[word], "prompts/get "+name+" names only listed tools", "a listed tool", word)
	}
}

func sameInstant(raw string, want time.Time) bool {
	got, err := time.Parse(time.RFC3339, raw)
	return err == nil && got.Equal(want)
}

func proposedTasks(plan obj) []string {
	var ids []string
	for _, p := range plan.objs("proposals") {
		ids = append(ids, p.str("taskId"))
	}
	return ids
}

// adjustBlocks reworks the planned blocks: one moved an hour and locked,
// one deleted, one task's blocks cleared, one task pinned.
func (s *sim) adjustBlocks(d day) error {
	var ahead []int
	for k, b := range s.l.blocks {
		if b.start.After(time.Now().Add(2 * time.Hour)) {
			ahead = append(ahead, k)
		}
	}
	if !s.expect(len(ahead) >= 3, "the plan has blocks ahead to adjust", ">= 3", len(ahead)) {
		return nil
	}
	moved := &s.l.blocks[ahead[0]]
	start, end := moved.start.Add(time.Hour), moved.end.Add(time.Hour)
	if _, err := s.call("move_block", map[string]any{"blockId": moved.id, "start": start.Format(time.RFC3339), "end": end.Format(time.RFC3339)}); err != nil {
		return err
	}
	moved.start, moved.end = start, end
	if _, err := s.call("pin_block", map[string]any{"blockId": moved.id, "locked": true}); err != nil {
		return err
	}
	if _, err := s.call("pin_task", map[string]any{"taskId": s.l.blocks[ahead[1]].taskID, "locked": true}); err != nil {
		return err
	}
	dropped := s.l.blocks[ahead[1]].id
	if _, err := s.call("delete_block", map[string]any{"id": dropped}); err != nil {
		return err
	}
	cleared := s.l.blocks[ahead[2]].taskID
	if _, err := s.call("clear_task_blocks", map[string]any{"taskId": cleared}); err != nil {
		return err
	}
	s.l.blocks = slices.DeleteFunc(s.l.blocks, func(b blockRec) bool { return b.id == dropped || b.taskID == cleared })
	return s.agendaMatches(s.days[todayIndex].date, s.days[windowDays-1].next(), "after move_block, delete_block and clear_task_blocks, get_agenda shows the adjusted plan")
}

// deadlineRisk adds a report that cannot fit before its deadline; the
// preview must flag it rather than quietly place it.
func (s *sim) deadlineRisk(d day) error {
	name := fmt.Sprintf("Write the launch report (%s)", d.label())
	deadline := d.date.AddDate(0, 0, 1).Format(time.DateOnly)
	out, err := s.call("create_task", map[string]any{"name": name, "workspaceId": s.l.workspaces["Work"], "duration": 1500, "deadline": deadline, "priorityLevel": "High"})
	if err != nil {
		return err
	}
	id := out.str("task", "id")
	s.l.addTask(&taskRec{id: id, name: name, workspace: "Work", deadline: deadline, duration: 1500})
	preview, err := s.call("auto_schedule_preview", map[string]any{"timezone": s.tz.String()})
	if err != nil {
		return err
	}
	flagged := false
	for _, r := range preview.objs("risks") {
		flagged = flagged || strings.Contains(compact(r), id)
	}
	for _, sk := range preview.objs("skipped") {
		flagged = flagged || sk.str("taskId") == id
	}
	for _, p := range preview.objs("proposals") {
		if p.str("taskId") == id && (p.bool("pastDeadline") || p.bool("partial") || p.num("shortfallMinutes") > 0) {
			flagged = true
		}
	}
	s.expect(flagged, "auto_schedule_preview flags a 25-hour task due tomorrow as a deadline risk", id, map[string]any{"risks": preview.raw("risks"), "skipped": preview.raw("skipped")})
	return nil
}

func (s *sim) backUp(d day) error {
	export, err := s.call("export_account", nil)
	if err != nil {
		return err
	}
	s.expect(export.at("backup") != nil, "export_account returns the backup object", "backup", clip(compact(export), 200))
	backup, err := s.call("create_backup", nil)
	if err != nil {
		return err
	}
	s.l.backups = append(s.l.backups, backup.str("id"))
	list, err := s.call("list_backups", nil)
	if err != nil {
		return err
	}
	s.expect(list.hasIDs(s.l.backups...), "list_backups lists every backup made", s.l.backups, list.idsAnywhere())
	return nil
}

// ---- End-of-run rows ----

// housekeeping is the end-of-window tidy: exports, jobs, a duplicate task
// and project tried and thrown away, a task reopened, one abandoned, the
// habit list trimmed, and the oldest backup removed.
func (s *sim) housekeeping(d day) error {
	if res, err := s.prompt("triage_inbox", nil); err == nil {
		s.promptNamesListedTools("triage_inbox", res, "")
	} else if !errors.Is(err, errMissing) {
		return err
	}
	open := s.l.openTasks()
	csv, err := s.call("export_tasks_csv", nil)
	if err != nil {
		return err
	}
	s.expect(strings.Contains(compact(csv), open[0].name), "export_tasks_csv includes open work", open[0].name, clip(compact(csv), 200))
	cal, err := s.call("export_calendar", nil)
	if err != nil {
		return err
	}
	s.expect(strings.Contains(compact(cal), "Team standup"), "export_calendar includes the standup series", "Team standup", clip(compact(cal), 200))
	if _, err := s.call("get_context", nil); err != nil {
		return err
	}
	if _, err := s.call("get_job_health", nil); err != nil {
		return err
	}
	jobs, err := s.call("list_jobs", map[string]any{"status": "succeeded", "limit": 5})
	if err != nil {
		return err
	}
	if items := jobs.objs("items"); s.expect(len(items) > 0, "list_jobs shows the account's finished jobs", "> 0", len(items)) {
		if err := s.reject("retry_job", map[string]any{"id": items[0].str("id")}, "only failed or cancelled"); err != nil {
			return err
		}
	}
	if _, err := s.allow("semantic_search", map[string]any{"query": "website relaunch copy", "limit": 5}, "not configured"); err != nil {
		return err
	}
	if _, err := s.allow("reindex_search", nil, "not configured"); err != nil {
		return err
	}

	dup, err := s.call("duplicate_task", map[string]any{"taskId": open[0].id})
	if err != nil {
		return err
	}
	copyID := dup.str("task", "id")
	if _, err := s.call("complete_task", map[string]any{"taskId": copyID}); err != nil {
		return err
	}
	reopened, err := s.call("reopen_task", map[string]any{"taskId": copyID})
	if err != nil {
		return err
	}
	s.expect(reopened.str("task", "completedAt") == "", "reopen_task clears completedAt", "", reopened.str("task", "completedAt"))
	if _, err := s.call("delete_task", map[string]any{"taskId": copyID}); err != nil {
		return err
	}
	for _, id := range s.l.order {
		if t := s.l.tasks[id]; t != nil && !t.open() && t.completedOn < d.ymd() {
			if _, err := s.call("reopen_task", map[string]any{"taskId": id}); err != nil {
				return err
			}
			t.completedOn = ""
			break
		}
	}
	abandoned := open[len(open)-1]
	if _, err := s.call("delete_task", map[string]any{"taskId": abandoned.id}); err != nil {
		return err
	}
	delete(s.l.tasks, abandoned.id)
	s.l.blocks = slices.DeleteFunc(s.l.blocks, func(b blockRec) bool { return b.taskID == abandoned.id })

	copied, err := s.call("duplicate_project", map[string]any{"projectId": s.l.project.id})
	if err != nil {
		return err
	}
	projectCopy := copied.str("project", "id")
	if _, err := s.call("complete_project", map[string]any{"projectId": projectCopy}); err != nil {
		return err
	}
	if _, err := s.call("reopen_project", map[string]any{"projectId": projectCopy}); err != nil {
		return err
	}
	if _, err := s.call("delete_project", map[string]any{"projectId": projectCopy, "confirm": true}); err != nil {
		return err
	}
	projects, err := s.call("list_projects", nil)
	if err != nil {
		return err
	}
	s.expect(projects.hasIDs(s.l.project.id) && !slices.Contains(projects.idsAnywhere(), projectCopy), "list_projects keeps the relaunch and drops the deleted copy", s.l.project.id, projects.idsAnywhere())

	if len(s.l.habits) == 3 {
		walk, sugar := s.l.habits[1], s.l.habits[2]
		if _, err := s.call("update_habit", map[string]any{"habit": walk.name, "action": "rename", "title": "Walk 10k steps"}); err == nil {
			walk.name = "Walk 10k steps"
		} else if !errors.Is(err, errMissing) {
			return err
		}
		if _, err := s.call("update_habit", map[string]any{"habit": sugar.id, "action": "remove"}); err == nil {
			s.l.habits = s.l.habits[:2]
		} else if !errors.Is(err, errMissing) {
			return err
		}
	}

	if len(s.l.backups) > 0 {
		oldest := s.l.backups[0]
		if _, err := s.call("download_backup", map[string]any{"backupId": oldest}); err != nil {
			return err
		}
		if _, err := s.call("delete_backup", map[string]any{"backupId": oldest, "confirm": true}); err != nil {
			return err
		}
		s.l.backups = s.l.backups[1:]
		list, err := s.call("list_backups", nil)
		if err != nil {
			return err
		}
		s.expect(!slices.Contains(list.idsAnywhere(), oldest), "delete_backup removes it from list_backups", "absent", oldest)
	}
	return nil
}

// urgent makes one overdue task urgent; the server applies the schedule, so
// the plan it returns becomes the ledger's engine blocks.
func (s *sim) urgent(d day) error {
	overdue := s.overdueIDs(d.ymd())
	if !s.expect(len(overdue) > 0, "the persona has overdue work to rescue", "> 0", 0) {
		return nil
	}
	plan, err := s.call("reschedule_urgent", map[string]any{"taskId": overdue[0]})
	if err != nil {
		return err
	}
	placed := false
	s.l.engine = nil
	for _, p := range plan.objs("proposals") {
		placed = placed || p.str("taskId") == overdue[0]
		for _, b := range p.objs("blocks") {
			start, _ := time.Parse(time.RFC3339, b.str("start"))
			end, _ := time.Parse(time.RFC3339, b.str("end"))
			s.l.engine = append(s.l.engine, blockRec{taskID: p.str("taskId"), start: start, end: end})
		}
	}
	s.expect(placed, "reschedule_urgent places the urgent task", overdue[0], proposedTasks(plan))
	got, err := s.call("get_task", map[string]any{"taskId": overdue[0]})
	if err != nil {
		return err
	}
	s.expect(got.str("task", "priorityLevel") == "Urgent", "reschedule_urgent marks the task Urgent", "Urgent", got.str("task", "priorityLevel"))
	s.l.tasks[overdue[0]].priority = "Urgent"
	return nil
}

func (s *sim) assertWindow(d day) error {
	for _, w := range s.days {
		if err := s.agendaMatches(w.date, w.next(), fmt.Sprintf("at the end of the run, get_agenda %s still lists exactly the ledger's events and blocks", w.ymd())); err != nil {
			return err
		}
	}
	return nil
}

// restoreRoundTrip restores the account from its own export; every count
// and streak must read the same afterwards.
func (s *sim) restoreRoundTrip(d day) error {
	export, err := s.call("export_account", nil)
	if err != nil {
		return err
	}
	if _, err := s.call("restore_account", map[string]any{"confirm": true, "backup": export.at("backup")}); err != nil {
		return err
	}
	failures := len(s.failures)
	for _, check := range []func(day) error{s.assertTaskCounts, s.assertStreaks, s.assertInbox} {
		if err := check(d); err != nil {
			return err
		}
	}
	s.expect(len(s.failures) == failures, "restore_account from the account's own export changes nothing the ledger can see", "no new failures", len(s.failures)-failures)
	return nil
}

func (s *sim) stopFocus(d day) error {
	f := s.l.focusing
	if f == nil {
		return nil
	}
	if wait := 20*time.Second - time.Since(f.started); wait > 0 {
		time.Sleep(wait)
	}
	paused, err := s.call("pause_focus", map[string]any{"taskId": f.taskID})
	if err != nil {
		return err
	}
	s.expect(paused.num("task", "actualMinutes") >= 1, "pause_focus adds the elapsed minutes to actualMinutes", ">= 1", paused.num("task", "actualMinutes"))
	s.l.focus, s.l.focusing = append(s.l.focus, *f), nil
	if _, err := s.call("stop_focus", map[string]any{"taskId": f.taskID}); err != nil {
		return err
	}
	if err := s.focusSessionsMatch(d.date, d.next()); err != nil && !errors.Is(err, errMissing) {
		return err
	}
	done, err := s.call("complete_task", map[string]any{"taskId": f.taskID})
	if err != nil {
		return err
	}
	s.l.tasks[f.taskID].completedOn = d.ymd()
	s.expect(done.str("task", "completedAt") != "", "complete_task sets completedAt", "non-empty", done.str("task", "completedAt"))
	view, err := s.call("get_today", map[string]any{"date": d.ymd(), "timezone": s.tz.String()})
	if err != nil {
		return err
	}
	var finished []string
	for _, t := range view.objs("completedToday") {
		finished = append(finished, t.str("id"))
	}
	s.expect(slices.Contains(finished, f.taskID), "get_today completedToday lists the task just completed", f.taskID, finished)
	return nil
}

// handleNotifications waits for today's reminder to fire, snoozes it, then
// works the overdue notifications: one triaged, one deleted, the rest cleared.
func (s *sim) handleNotifications(d day) error {
	var ping obj
	deadline := time.Now().Add(60 * time.Second)
	for ping == nil && time.Now().Before(deadline) {
		out, err := s.call("list_notifications", map[string]any{"limit": 100})
		if err != nil {
			return err
		}
		for _, n := range out.objs("items") {
			if n.str("category") == "reminder" && n.str("entityId") == s.l.reminder {
				ping = n
			}
		}
		if ping == nil {
			time.Sleep(3 * time.Second)
		}
	}
	if !s.expect(ping != nil, "today's reminder fires as a notification within a minute", s.l.reminder, nil) {
		return nil
	}
	before := time.Now()
	if _, err := s.call("snooze_reminder", map[string]any{"id": ping.str("id"), "minutes": 15}); err != nil {
		return err
	}
	task, err := s.call("get_task", map[string]any{"taskId": s.l.reminder})
	if err != nil {
		return err
	}
	moved, _ := time.Parse(time.RFC3339, task.str("task", "scheduledOn"))
	s.expect(moved.After(before.Add(14*time.Minute)) && moved.Before(time.Now().Add(16*time.Minute)),
		"snooze_reminder moves the reminder 15 minutes out", before.Add(15*time.Minute).Format(time.RFC3339), task.str("task", "scheduledOn"))
	if _, err := s.call("mark_notification_read", map[string]any{"id": ping.str("id")}); err != nil {
		return err
	}

	if s.listed["triage_notification"] || s.listed["delete_notification"] {
		if err := s.workOverdue(d); err != nil {
			return err
		}
	} else {
		s.missing["triage_notification"], s.missing["delete_notification"] = true, true
	}
	unread, err := s.call("list_notifications", map[string]any{"unread": true, "limit": 100})
	if err != nil {
		return err
	}
	count, err := s.call("unread_notification_count", nil)
	if err != nil {
		return err
	}
	s.expect(int(count.num("count")) == len(unread.list("items")), "unread_notification_count equals the unread list", len(unread.list("items")), count.num("count"))
	if _, err := s.call("clear_notifications", nil); err != nil {
		return err
	}
	count, err = s.call("unread_notification_count", nil)
	if err != nil {
		return err
	}
	s.expect(count.num("count") == 0, "clear_notifications leaves nothing unread", 0, count.num("count"))
	return nil
}

// workOverdue triages one overdue notification and deletes another. The
// server sweeps a user's overdue work at most every 5 minutes, so an
// overdue task can wait up to that long (plus a 10s job tick) for its
// notification; the harness polls until 7 minutes after registration.
func (s *sim) workOverdue(d day) error {
	overdue := s.overdueIDs(d.ymd())
	var found []obj
	for until := s.registered.Add(7 * time.Minute); len(found) < 2 && time.Now().Before(until); {
		out, err := s.call("list_notifications", map[string]any{"unread": true, "limit": 100})
		if err != nil {
			return err
		}
		found = nil
		for _, n := range out.objs("items") {
			if n.str("category") == "overdue" && slices.Contains(overdue, n.str("entityId")) {
				found = append(found, n)
			}
		}
		if len(found) < 2 {
			time.Sleep(5 * time.Second)
		}
	}
	if len(found) < 2 {
		out, err := s.call("list_notifications", map[string]any{"limit": 200})
		if err != nil {
			return err
		}
		seen := map[string]int{}
		for _, n := range out.objs("items") {
			key := n.str("category")
			if n.str("readAt") != "" {
				key += " read"
			}
			if key == "overdue" && !slices.Contains(overdue, n.str("entityId")) {
				key += " (not overdue in the ledger)"
			}
			seen[key]++
		}
		s.fail(fmt.Sprintf("overdue work raises overdue notifications within the 5-minute sweep (%d overdue in the ledger)", len(overdue)), ">= 2 unread overdue", seen)
		return nil
	}
	slices.SortStableFunc(found, func(a, b obj) int {
		return priorityRank(s.l.tasks[b.str("entityId")].priority) - priorityRank(s.l.tasks[a.str("entityId")].priority)
	})
	if err := s.triageOverdue(found[0]); err != nil && !errors.Is(err, errMissing) {
		return err
	}
	if err := s.deleteNotification(found[1]); err != nil && !errors.Is(err, errMissing) {
		return err
	}
	return nil
}

func (s *sim) triageOverdue(n obj) error {
	taskID := n.str("entityId")
	before, err := s.call("get_task", map[string]any{"taskId": taskID})
	if err != nil {
		return err
	}
	if _, err := s.call("triage_notification", map[string]any{"notificationId": n.str("id"), "action": "lower"}); err != nil {
		return err
	}
	after, err := s.call("get_task", map[string]any{"taskId": taskID})
	if err != nil {
		return err
	}
	want := lowered[before.str("task", "priorityLevel")]
	if want == "" {
		want = "Low"
	}
	s.expect(after.str("task", "priorityLevel") == want, "triage_notification lower moves the task's priority down one step", want, after.str("task", "priorityLevel"))
	return nil
}

var lowered = map[string]string{"Urgent": "High", "High": "Medium", "Medium": "Low"}

func priorityRank(p string) int { return slices.Index([]string{"Low", "Medium", "High", "Urgent"}, p) }

func (s *sim) deleteNotification(n obj) error {
	if _, err := s.call("delete_notification", map[string]any{"notificationId": n.str("id")}); err != nil {
		return err
	}
	out, err := s.call("list_notifications", map[string]any{"limit": 200})
	if err != nil {
		return err
	}
	s.expect(!slices.Contains(out.idsAnywhere(), n.str("id")), "delete_notification removes it from list_notifications", "absent", n.str("id"))
	return nil
}

// ---- Assertions ----

func (s *sim) assertAgenda(d day) error {
	return s.agendaMatches(d.date, d.next(), fmt.Sprintf("get_agenda %s lists exactly the ledger's events and blocks", d.ymd()))
}

func (s *sim) agendaMatches(from, to time.Time, what string) error {
	out, err := s.call("get_agenda", map[string]any{"from": from.Format(time.RFC3339), "to": to.Format(time.RFC3339), "timezone": s.tz.String()})
	if err != nil {
		return err
	}
	got := map[string]int{}
	for _, item := range out.objs("items") {
		start, _ := time.Parse(time.RFC3339, item.str("start"))
		switch {
		case item.str("eventId") != "":
			got[itemKey("event", item.str("eventId"), start)]++
		case item.str("taskId") != "":
			got[itemKey("task", item.str("taskId"), start)]++
		default:
			got["unknown:"+item.str("id")]++
		}
	}
	want := s.l.agendaKeys(from, to)
	if diff := diffCounts(want, got); diff != "" {
		s.fail(what+": "+diff, sortedKeys(want), sortedKeys(got))
	}
	return nil
}

func (s *sim) assertStreaks(d day) error {
	out, err := s.call("list_habits", map[string]any{"today": d.ymd(), "timezone": s.tz.String()})
	if err != nil {
		return err
	}
	byID := map[string]obj{}
	for _, h := range out.objs("habits") {
		byID[h.str("id")] = h
	}
	for _, h := range s.l.habits {
		got, ok := byID[h.id]
		if !s.expect(ok, "list_habits lists "+h.name, h.id, out.idsAnywhere()) {
			continue
		}
		want := s.l.streak(h, d.date)
		s.expect(int(got.num("streak")) == want, fmt.Sprintf("list_habits streak for %q equals the ledger's", h.name), want, got.num("streak"))
		s.expect(got.bool("doneToday") == h.done[d.ymd()], fmt.Sprintf("list_habits doneToday for %q equals the ledger's", h.name), h.done[d.ymd()], got.bool("doneToday"))
		var last7 []bool
		for k := 6; k >= 0; k-- {
			last7 = append(last7, h.done[d.date.AddDate(0, 0, -k).Format(time.DateOnly)])
		}
		s.expect(compact(last7) == compact(got.raw("last7")), fmt.Sprintf("list_habits last7 for %q equals the ledger's", h.name), last7, got.raw("last7"))
	}
	return nil
}

func (s *sim) assertTaskCounts(d day) error {
	today := s.days[todayIndex].ymd()
	var open, done, overdue []string
	for _, id := range s.l.order {
		t := s.l.tasks[id]
		if t == nil {
			continue
		}
		if t.open() {
			open = append(open, id)
			if t.deadline != "" && t.deadline < today {
				overdue = append(overdue, id)
			}
		} else {
			done = append(done, id)
		}
	}
	for _, c := range []struct {
		what string
		args map[string]any
		want []string
	}{
		{"open work", map[string]any{"completed": false, "limit": 1000}, open},
		{"completed work", map[string]any{"completed": true, "limit": 1000}, done},
		{"overdue work", map[string]any{"overdue": true, "limit": 1000}, overdue},
	} {
		out, err := s.call("list_tasks", c.args)
		if err != nil {
			return err
		}
		var got []string
		for _, t := range out.objs("tasks") {
			got = append(got, t.str("id"))
		}
		if diff := diffSets(c.want, got); diff != "" {
			s.fail(fmt.Sprintf("list_tasks %s equals the ledger's (%d vs %d): %s", c.what, len(c.want), len(got), diff), len(c.want), len(got))
		}
	}
	return nil
}

func (s *sim) assertInbox(d day) error {
	out, err := s.call("list_inbox", nil)
	if err != nil {
		return err
	}
	var got []string
	for _, t := range out.objs("tasks") {
		got = append(got, t.str("id"))
	}
	if diff := diffSets(s.l.inbox, got); diff != "" {
		s.fail("list_inbox equals the ledger's open inbox items: "+diff, len(s.l.inbox), len(got))
	}
	return nil
}

func (s *sim) assertSearch(d day) error {
	r := s.rng(d, "search")
	sample := slices.Clone(s.l.named)
	r.Shuffle(len(sample), func(i, j int) { sample[i], sample[j] = sample[j], sample[i] })
	for _, n := range sample[:min(8, len(sample))] {
		if n.kind == "task" && s.l.tasks[n.id] == nil {
			continue
		}
		out, err := s.call("search", map[string]any{"query": n.title, "limit": 10})
		if err != nil {
			return err
		}
		var ids []string
		for _, h := range out.objs("hits") {
			ids = append(ids, h.str("id"))
		}
		s.expect(slices.Contains(ids, n.id), fmt.Sprintf("search %q finds the %s", n.title, n.kind), n.id, ids)
	}
	return nil
}

// ---- Main loop and report ----

func main() {
	seed := flag.Uint64("seed", 60, "RNG seed; the same seed replays the same 60 days")
	outDir := flag.String("out", "/tmp/mcp60/run", "directory for report.json and report.md")
	tzName := flag.String("tz", "UTC", "the persona's timezone (saved as Working hours)")
	flag.Parse()

	base := getenv("TIMELY_API", "http://localhost:8081")
	if err := refuseUserAPI(base); err != nil {
		fatal(err)
	}
	tz, err := time.LoadLocation(*tzName)
	if err != nil {
		fatal(err)
	}
	began := time.Now()
	ctx := context.Background()
	session, email := connect(ctx, base)
	defer session.Close()

	now := time.Now().In(tz)
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, tz)
	s := &sim{ctx: ctx, session: session, seed: *seed, tz: tz, l: newLedger(),
		listed: map[string]bool{}, prompts: map[string]bool{}, missing: map[string]bool{}, promptsGot: map[string]bool{},
		stats: map[string]*toolStat{}}
	for i := 0; i < windowDays; i++ {
		s.days = append(s.days, day{i: i, date: midnight.AddDate(0, 0, i-pastDays)})
	}
	s.start, s.registered = s.days[0].date, began
	s.discover()
	fmt.Printf("account %s, %d tools, %d prompts, window %s .. %s (today %s, %s)\n", email, len(s.listed), len(s.prompts),
		s.days[0].ymd(), s.days[windowDays-1].ymd(), s.days[todayIndex].ymd(), tz)

	rows := routine()
	for _, d := range s.days {
		s.cur = d
		before, failsBefore := s.calls, len(s.failures)
		var ran []string
		for _, a := range rows {
			if !a.when.matches(d) {
				continue
			}
			s.runActivity(a, d)
			ran = append(ran, a.name)
		}
		mark := "ok"
		if len(s.failures) > failsBefore {
			mark = fmt.Sprintf("%d FAIL", len(s.failures)-failsBefore)
		}
		fmt.Printf("day %2d %s %s  %3d calls  %d activities  %s\n", d.i, d.ymd(), d.date.Weekday().String()[:3], s.calls-before, len(ran), mark)
	}
	s.cur = s.days[todayIndex]
	for _, a := range rows {
		if a.when.cadence == atEnd {
			s.runActivity(a, s.cur)
		}
	}
	s.report(*outDir, email, time.Since(began))
}

func (s *sim) runActivity(a activity, d day) {
	s.activity = a.name
	err := a.run(s, d)
	var terr *toolError
	switch {
	case err == nil, errors.Is(err, errMissing), errors.As(err, &terr):
	default:
		s.fail("harness error: "+err.Error(), nil, nil)
	}
}

func (s *sim) discover() {
	tools, err := s.session.ListTools(s.ctx, nil)
	if err != nil {
		fatal(fmt.Errorf("tools/list: %w", err))
	}
	for _, t := range tools.Tools {
		s.listed[t.Name] = true
	}
	prompts, err := s.session.ListPrompts(s.ctx, nil)
	if err != nil {
		s.note("prompts/list: " + err.Error())
		return
	}
	for _, p := range prompts.Prompts {
		s.prompts[p.Name] = true
	}
}

type toolReport struct {
	Name string `json:"name"`
	toolStat
	P50ms float64 `json:"p50ms"`
	P95ms float64 `json:"p95ms"`
}

type report struct {
	Account       string       `json:"account"`
	Seed          uint64       `json:"seed"`
	Timezone      string       `json:"timezone"`
	Window        [2]string    `json:"window"`
	Today         string       `json:"today"`
	DaysRun       int          `json:"daysRun"`
	ToolCalls     int          `json:"toolCalls"`
	ToolsListed   int          `json:"toolsListed"`
	ToolsCalled   int          `json:"toolsCalled"`
	PromptsListed int          `json:"promptsListed"`
	PromptsCalled int          `json:"promptsCalled"`
	WallSeconds   float64      `json:"wallSeconds"`
	Failures      []failure    `json:"failures"`
	Uncalled      []string     `json:"uncalled"`
	Missing       []string     `json:"missing"`
	Notes         []string     `json:"notes"`
	Tools         []toolReport `json:"tools"`
}

func (s *sim) report(dir, email string, wall time.Duration) {
	rep := report{Account: email, Seed: s.seed, Timezone: s.tz.String(), Window: [2]string{s.days[0].ymd(), s.days[windowDays-1].ymd()},
		Today: s.days[todayIndex].ymd(), DaysRun: len(s.days), ToolCalls: s.calls, ToolsListed: len(s.listed), PromptsListed: len(s.prompts),
		WallSeconds: wall.Seconds(), Failures: s.failures, Notes: s.notes}
	for name := range s.listed {
		if st := s.stats[name]; st == nil || st.Calls == 0 {
			rep.Uncalled = append(rep.Uncalled, name)
		} else {
			rep.ToolsCalled++
		}
	}
	for name := range s.prompts {
		if s.promptsGot[name] {
			rep.PromptsCalled++
		} else {
			rep.Uncalled = append(rep.Uncalled, "prompt:"+name)
		}
	}
	for name := range s.missing {
		rep.Missing = append(rep.Missing, name)
	}
	for name, st := range s.stats {
		rep.Tools = append(rep.Tools, toolReport{Name: name, toolStat: *st, P50ms: percentile(st.latencies, 0.5), P95ms: percentile(st.latencies, 0.95)})
	}
	sort.Strings(rep.Uncalled)
	sort.Strings(rep.Missing)
	sort.Slice(rep.Tools, func(i, j int) bool { return rep.Tools[i].Name < rep.Tools[j].Name })
	if rep.Failures == nil {
		rep.Failures = []failure{}
	}

	if err := os.MkdirAll(dir, 0o755); err != nil {
		fatal(err)
	}
	raw, _ := json.MarshalIndent(rep, "", "  ")
	if err := os.WriteFile(filepath.Join(dir, "report.json"), raw, 0o644); err != nil {
		fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "report.md"), []byte(markdown(rep)), 0o644); err != nil {
		fatal(err)
	}
	fmt.Printf("\n%d days, %d tool calls, %d/%d tools called, %d/%d prompts, %d failures, %d uncalled, missing %v, %.1fs\nreport: %s\n",
		rep.DaysRun, rep.ToolCalls, rep.ToolsCalled, rep.ToolsListed, rep.PromptsCalled, rep.PromptsListed, len(rep.Failures), len(rep.Uncalled),
		rep.Missing, rep.WallSeconds, filepath.Join(dir, "report.md"))
	if len(rep.Failures) > 0 || len(rep.Uncalled) > 0 {
		os.Exit(1)
	}
}

func markdown(rep report) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# MCP 60-day run\n\n")
	fmt.Fprintf(&b, "- Account: %s\n- Seed: %d, timezone %s\n- Window: %s .. %s, today %s\n", rep.Account, rep.Seed, rep.Timezone, rep.Window[0], rep.Window[1], rep.Today)
	fmt.Fprintf(&b, "- Days run: %d\n- Tool calls: %d\n- Tools called: %d of %d listed\n- Prompts called: %d of %d listed\n- Wall time: %.1fs\n\n",
		rep.DaysRun, rep.ToolCalls, rep.ToolsCalled, rep.ToolsListed, rep.PromptsCalled, rep.PromptsListed, rep.WallSeconds)
	fmt.Fprintf(&b, "## Failures (%d)\n\n", len(rep.Failures))
	for _, f := range rep.Failures {
		fmt.Fprintf(&b, "- day %d (%s), %s: %s\n", f.Day, f.Date, f.Activity, f.Message)
		if f.Expected != "" {
			fmt.Fprintf(&b, "  - expected: `%s`\n", clip(f.Expected, 600))
		}
		if f.Got != "" {
			fmt.Fprintf(&b, "  - got: `%s`\n", clip(f.Got, 600))
		}
	}
	fmt.Fprintf(&b, "\n## Uncalled (%d)\n\n%s\n\n## Missing (%d)\n\nTools and prompts the harness exercises that the server does not list yet.\n\n%s\n\n",
		len(rep.Uncalled), bullet(rep.Uncalled), len(rep.Missing), bullet(rep.Missing))
	fmt.Fprintf(&b, "## Notes\n\n%s\n\n## Tools\n\n| tool | calls | errors | expected rejections | p50 ms | p95 ms |\n| --- | --- | --- | --- | --- | --- |\n", bullet(rep.Notes))
	for _, t := range rep.Tools {
		fmt.Fprintf(&b, "| %s | %d | %d | %d | %.0f | %.0f |\n", t.Name, t.Calls, t.Errors, t.Expected, t.P50ms, t.P95ms)
	}
	return b.String()
}

func bullet(items []string) string {
	if len(items) == 0 {
		return "None."
	}
	return "- " + strings.Join(items, "\n- ")
}

func percentile(xs []time.Duration, p float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	sorted := slices.Clone(xs)
	slices.Sort(sorted)
	return float64(sorted[int(float64(len(sorted)-1)*p)].Microseconds()) / 1000
}

// ---- Connection ----

type bearer struct{ token string }

func (b bearer) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.Header.Set("Authorization", "Bearer "+b.token)
	return http.DefaultTransport.RoundTrip(req)
}

func connect(ctx context.Context, base string) (*mcp.ClientSession, string) {
	email := fmt.Sprintf("mcp-60day-%d@example.com", time.Now().UnixNano())
	jar, _ := cookiejar.New(nil)
	httpClient := &http.Client{Jar: jar, Timeout: 30 * time.Second}
	post := func(path string, body any) []byte {
		raw, _ := json.Marshal(body)
		resp, err := httpClient.Post(base+path, "application/json", bytes.NewReader(raw))
		if err != nil {
			fatal(err)
		}
		defer resp.Body.Close()
		out, _ := io.ReadAll(resp.Body)
		if resp.StatusCode >= 300 {
			fatal(fmt.Errorf("POST %s %d: %s", path, resp.StatusCode, out))
		}
		return out
	}
	post("/register", map[string]string{"name": "MCP 60-day", "email": email, "password": "sixty-days-1"})
	var key struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal(post("/api-keys", map[string]string{"name": "mcp-60day"}), &key); err != nil || key.Key == "" {
		fatal(fmt.Errorf("no API key in response"))
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "timely-60day", Version: "1.0.0"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint:             base + "/mcp",
		HTTPClient:           &http.Client{Timeout: 90 * time.Second, Transport: bearer{key.Key}},
		DisableStandaloneSSE: true,
	}, nil)
	if err != nil {
		fatal(err)
	}
	return session, email
}

// ---- Reading replies ----

type obj map[string]any

func (o obj) at(path ...string) any {
	var cur any = map[string]any(o)
	for _, key := range path {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur = m[key]
	}
	return cur
}

func (o obj) raw(path ...string) any { return o.at(path...) }

func (o obj) str(path ...string) string {
	v, _ := o.at(path...).(string)
	return v
}

func (o obj) num(path ...string) float64 {
	v, _ := o.at(path...).(float64)
	return v
}

func (o obj) bool(path ...string) bool {
	v, _ := o.at(path...).(bool)
	return v
}

func (o obj) list(path ...string) []any {
	v, _ := o.at(path...).([]any)
	return v
}

func (o obj) objs(path ...string) []obj {
	var out []obj
	for _, item := range o.list(path...) {
		if m, ok := item.(map[string]any); ok {
			out = append(out, obj(m))
		}
	}
	return out
}

// firstList is the reply's list of objects whatever its key is (items,
// versions, sessions), for tools whose reply key is not fixed yet.
func (o obj) firstList() []obj {
	keys := make([]string, 0, len(o))
	for k := range o {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if items := o.objs(k); len(items) > 0 {
			return items
		}
	}
	return nil
}

// idsAnywhere collects every "id" in the reply, for list replies whose key
// varies (items, tasks, views).
func (o obj) idsAnywhere() []string {
	var ids []string
	var walk func(v any)
	walk = func(v any) {
		switch t := v.(type) {
		case map[string]any:
			if id, ok := t["id"].(string); ok {
				ids = append(ids, id)
			}
			for _, child := range t {
				walk(child)
			}
		case []any:
			for _, child := range t {
				walk(child)
			}
		}
	}
	walk(map[string]any(o))
	return ids
}

func (o obj) hasIDs(ids ...string) bool {
	all := o.idsAnywhere()
	for _, id := range ids {
		if !slices.Contains(all, id) {
			return false
		}
	}
	return true
}

// ---- Small helpers ----

func workspaceFor(phrase string) string {
	if slices.Contains(homeChores, phrase) {
		return "Home"
	}
	return "Work"
}

func firstOnOrAfter(t time.Time, wd time.Weekday) time.Time {
	for t.Weekday() != wd {
		t = t.AddDate(0, 0, 1)
	}
	return t
}

func at(t time.Time, h, m int) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), h, m, 0, 0, t.Location())
}

func monthKey(t time.Time) string { return t.Format("2006-01") }

func diffCounts(want, got map[string]int) string {
	var missing, extra []string
	for k, n := range want {
		if got[k] < n {
			missing = append(missing, k)
		}
	}
	for k, n := range got {
		if n > want[k] {
			extra = append(extra, fmt.Sprintf("%s x%d", k, n))
		}
	}
	sort.Strings(missing)
	sort.Strings(extra)
	if len(missing) == 0 && len(extra) == 0 {
		return ""
	}
	return fmt.Sprintf("missing %v, unexpected %v", missing, extra)
}

func diffSets(want, got []string) string {
	w, g := map[string]int{}, map[string]int{}
	for _, id := range want {
		w[id]++
	}
	for _, id := range got {
		g[id]++
	}
	return diffCounts(w, g)
}

func sortedKeys(m map[string]int) []string {
	var keys []string
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func compact(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprint(v)
	}
	return string(raw)
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// refuseUserAPI rejects a TIMELY_API that is not http(s)://host[:port] or
// whose port, however it is spelled, is 8080: the person's own API.
func refuseUserAPI(base string) error {
	u, err := url.Parse(base)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" {
		return fmt.Errorf("refusing TIMELY_API %q: want http(s)://host[:port]", base)
	}
	port := u.Port()
	if port == "" {
		port = map[string]string{"http": "80", "https": "443"}[u.Scheme]
	}
	if n, err := strconv.Atoi(port); err != nil || n == 8080 {
		return fmt.Errorf("refusing TIMELY_API %q: the 60-day harness never runs against :8080", base)
	}
	return nil
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
