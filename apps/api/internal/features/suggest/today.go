package suggest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/decide"
	"timely-api/internal/features/focus"
	"timely-api/internal/features/notify"
	"timely-api/internal/features/schedule"
	"timely-api/internal/features/task"
	"timely-api/internal/models"
)

// Today, focus and scheduling: the kind of effort and urgency a task's words
// suggest (stored on the task, so every ranking agrees), Work that shares a
// topic, focus picks for today, the best Work for the next free gap, and
// which of the person's goals the open Work moves forward. Code ranks and
// finds the free time; Jev only reads words.

const (
	todayBudget    = 10 * time.Second
	traitsBudget   = 4 * time.Second
	traitsPauseFor = 2 * time.Minute
	maxTraitTasks  = 12
	maxGapTasks    = 8
	maxFocusPicks  = 3
	minGapMinutes  = 20
)

// SetSchedule connects Auto-schedule: Today reads its rank and free time, and
// every Preview first reads the traits of the Work it is about to rank.
func (s *Service) SetSchedule(sched schedule.Service) {
	s.schedule = sched
	schedule.SetBeforePreview(func(userID string) {
		if until, ok := s.traitsPause.Load(userID); ok && time.Now().Before(until.(time.Time)) {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), traitsBudget)
		defer cancel()
		// A slow or failed call pauses the hook, so a failing provider does
		// not cost every Preview a call (or two, with the fallback).
		if err := s.fillTopTraits(ctx, userID, ""); err != nil || ctx.Err() != nil {
			s.traitsPause.Store(userID, time.Now().Add(traitsPauseFor))
		}
	})
}

func (s *Service) todayRoutes(g *echo.Group) {
	g.GET("/suggestions/today", s.today)
}

// Effort kinds [31]. The engine does not read them; Today and the task panel
// do (a deep-focus task can be steered to the person's best time of day).
var effortKinds = []decide.Option{
	{Name: "deep", Description: "Deep focus: long, hard thinking, such as solving a problem, studying or building something complex"},
	{Name: "admin", Description: "Admin: email, forms, bookings, payments, calls and small errands"},
	{Name: "creative", Description: "Creative: writing, designing, sketching or open-ended making"},
	{Name: "routine", Description: "Routine: familiar chores or repeated steps that need little thought"},
}

// Urgency levels [40], lowest first. Stored 0-4 on the task; Auto-schedule and
// what_next add (level-2)*6 to the rank.
var urgencyLevels = []string{
	"It can wait: nothing bad happens if it slips",
	"Low: a delay costs little",
	"Normal",
	"Pressing: a delay causes real trouble for the person or someone else",
	"Critical: a delay causes serious harm, a loss, a penalty or a broken promise",
}

func traitsHash(t models.Task) string {
	sum := sha256.Sum256([]byte(t.Name + "\x00" + t.Description))
	return hex.EncodeToString(sum[:8])
}

func traitQuestions(questions map[string]decide.Question, key, which string) {
	questions["effort_"+key] = decide.Choice(fmt.Sprintf("What kind of effort does %s take?", which), effortKinds...)
	questions["urgency_"+key] = decide.Score(fmt.Sprintf("Judging only by its own words, how much harm does delaying %s cause?", which), urgencyLevels...)
}

// readTraits stores what Jev was sure of. An unsure answer is stored as
// unknown with the hash, so the same words are not asked about again; a task
// whose questions did not come back at all is left to be asked next time.
func (s *Service) readTraits(ctx context.Context, a decide.Answers, key string, t *models.Task) {
	_, effort := a.Raw("effort_" + key)
	_, urgency := a.Raw("urgency_" + key)
	if !effort && !urgency {
		return
	}
	t.EffortKind, t.Urgency = "", nil
	if kind, ok := a.Choice("effort_"+key, decide.Prefill); ok {
		t.EffortKind = kind
	}
	if level, ok := a.Level("urgency_"+key, decide.Prefill); ok {
		t.Urgency = &level
	}
	t.TraitsHash = traitsHash(*t)
	s.db.WithContext(ctx).Model(&models.Task{}).Where("id = ? AND user_id = ?", t.ID, derefStr(t.UserID)).
		UpdateColumns(map[string]any{"effort_kind": t.EffortKind, "urgency": t.Urgency, "traits_hash": t.TraitsHash})
}

func derefStr(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// FillTraits reads effort and urgency for tasks whose words changed since
// they were last read, and groups the set's tasks that share a topic or tool
// [34]. Nothing is asked when every task is current. It returns the tasks
// with their traits.
func (s *Service) FillTraits(ctx context.Context, userID string, tasks []models.Task) []models.Task {
	out, _ := s.fillTraits(ctx, userID, tasks)
	return out
}

// fillTraits is FillTraits that also returns why the call failed.
func (s *Service) fillTraits(ctx context.Context, userID string, tasks []models.Task) ([]models.Task, error) {
	if len(tasks) > maxTraitTasks {
		tasks = tasks[:maxTraitTasks]
	}
	stale := false
	for _, t := range tasks {
		if t.TraitsHash != traitsHash(t) {
			stale = true
			break
		}
	}
	if !stale {
		return tasks, nil
	}
	list := make([]map[string]any, 0, len(tasks))
	questions := map[string]decide.Question{}
	for i, t := range tasks {
		key := fmt.Sprintf("t%d", i+1)
		item := map[string]any{"task": key, "title": clip(t.Name, 200)}
		if d := strings.TrimSpace(t.Description); d != "" {
			item["description"] = clip(d, 300)
		}
		list = append(list, item)
		if t.TraitsHash != traitsHash(t) {
			traitQuestions(questions, key, "task "+key)
		}
		if len(tasks) > 1 {
			opts := []decide.Option{{Name: "none", Description: "None of the other tasks"}}
			for j, other := range tasks {
				if j != i {
					opts = append(opts, decide.Option{Name: fmt.Sprintf("t%d", j+1), Description: fmt.Sprintf("Task “%s”", clip(other.Name, 120))})
				}
			}
			questions["group_"+key] = decide.Choice(fmt.Sprintf("Which other task shares a topic, place, person or tool with task %s, so doing them back to back saves effort?", key), opts...)
		}
	}
	state := map[string]any{"tasks": list}
	decide.Fit(state, list, "description", "title")
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "traits", State: state, Questions: questions})
	if err != nil {
		return tasks, err
	}
	out := append([]models.Task(nil), tasks...)
	parent := make([]int, len(out))
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(i int) int {
		if parent[i] != i {
			parent[i] = find(parent[i])
		}
		return parent[i]
	}
	for i := range out {
		key := fmt.Sprintf("t%d", i+1)
		if out[i].TraitsHash != traitsHash(out[i]) {
			s.readTraits(ctx, a, key, &out[i])
		}
		if pick, ok := a.Choice("group_"+key, decide.Route); ok && pick != "none" {
			var j int
			if _, err := fmt.Sscanf(pick, "t%d", &j); err == nil && j >= 1 && j <= len(out) && j-1 != i {
				parent[find(i)] = find(j - 1)
			}
		}
	}
	// A group is keyed by its smallest task id, so the key stays the same
	// when the same tasks are grouped again.
	keys := map[int]string{}
	size := map[int]int{}
	for i := range out {
		r := find(i)
		size[r]++
		if k, ok := keys[r]; !ok || out[i].ID < k {
			keys[r] = out[i].ID
		}
	}
	// Work outside this set keeps no key this set used or now uses, so an
	// old group cannot pull an unrelated task in beside a new one.
	ids := make([]string, 0, len(out))
	used := map[string]bool{}
	for i := range out {
		ids = append(ids, out[i].ID)
		if out[i].GroupKey != "" {
			used[out[i].GroupKey] = true
		}
		if r := find(i); size[r] > 1 {
			used[keys[r]] = true
		}
	}
	if len(used) > 0 {
		stale := make([]string, 0, len(used))
		for k := range used {
			stale = append(stale, k)
		}
		s.db.WithContext(ctx).Model(&models.Task{}).Where("user_id = ? AND id NOT IN ? AND group_key IN ?", userID, ids, stale).
			UpdateColumn("group_key", "")
	}
	for i := range out {
		key := ""
		if r := find(i); size[r] > 1 {
			key = keys[r]
		}
		if out[i].GroupKey != key {
			out[i].GroupKey = key
			s.db.WithContext(ctx).Model(&models.Task{}).Where("id = ? AND user_id = ?", out[i].ID, userID).
				UpdateColumn("group_key", key)
		}
	}
	return out, nil
}

// fillTopTraits fills the traits of the Work Auto-schedule ranks highest,
// and returns the error when the call failed.
func (s *Service) fillTopTraits(ctx context.Context, userID, timezone string) error {
	if s.schedule == nil {
		return nil
	}
	if ok, _ := s.decide.Status(ctx, userID); !ok {
		return nil
	}
	ranked, err := s.schedule.Rank(userID, timezone)
	if err != nil {
		return nil
	}
	tasks := make([]models.Task, 0, maxTraitTasks)
	for _, r := range ranked {
		if len(tasks) == maxTraitTasks {
			break
		}
		if !r.Task.IsRecurring() {
			tasks = append(tasks, r.Task)
		}
	}
	_, err = s.fillTraits(ctx, userID, tasks)
	if err == decide.ErrOff {
		return nil
	}
	return err
}

// Prefs is what the person told suggestions to weigh: their goals (on Today,
// up to five) and their best time for deep work (Settings > Agent).
type Prefs struct {
	Goals        []string
	DeepWorkTime string // "", morning, afternoon or evening
	goals        []focus.Goal
}

func (s *Service) prefs(ctx context.Context, userID string) Prefs {
	var out Prefs
	if goals, err := focus.NewStore(s.db).Goals(ctx, userID); err == nil {
		out.goals = goals
		for _, g := range goals {
			out.Goals = append(out.Goals, g.Title)
		}
	}
	var row struct{ DeepWorkTime string }
	if s.db.WithContext(ctx).Table("agent_provider_settings").Select("deep_work_time").
		Where("user_id = ?", userID).Take(&row).Error == nil {
		out.DeepWorkTime = row.DeepWorkTime
	}
	return out
}

// deepWindows are the preferred windows a deep-focus task gets for the
// person's best time of day; Auto-schedule still keeps to working hours.
var deepWindows = map[string]models.PreferredWindow{
	"morning":   {Start: "06:00", End: "12:00"},
	"afternoon": {Start: "12:00", End: "17:00"},
	"evening":   {Start: "17:00", End: "22:00"},
}

// minDeepWindow is the shortest stretch of working hours worth steering
// deep-focus work into.
const minDeepWindow = 60

// deepWindow is the person's best time for deep work clipped to their working
// hours, since Auto-schedule only places Work inside a preferred window. It is
// false when too little of the window falls inside working hours.
func (s *Service) deepWindow(userID, when string) (models.PreferredWindow, bool) {
	w, ok := deepWindows[when]
	if !ok {
		return w, false
	}
	if s.schedule == nil {
		return w, true
	}
	hours, err := s.schedule.GetWorkingHours(userID, "")
	if err != nil {
		return w, true
	}
	start, _ := models.ParseClock(w.Start)
	end, _ := models.ParseClock(w.End)
	first, last := -1, -1
	for _, windows := range hours.WorkingHours.Days {
		for _, ww := range windows {
			a, errA := models.ParseClock(ww.Start)
			b, errB := models.ParseClock(ww.End)
			if errA != nil || errB != nil || b <= a {
				continue
			}
			if first < 0 || a < first {
				first = a
			}
			if b > last {
				last = b
			}
		}
	}
	if first < 0 {
		return w, false
	}
	start, end = max(start, first), min(end, last)
	if end-start < minDeepWindow {
		return w, false
	}
	return models.PreferredWindow{Start: fmt.Sprintf("%02d:%02d", start/60, start%60), End: fmt.Sprintf("%02d:%02d", end/60, end%60)}, true
}

func partOfDay(t time.Time) string {
	switch h := t.Hour(); {
	case h < 12:
		return "morning"
	case h < 17:
		return "afternoon"
	default:
		return "evening"
	}
}

// gapState is the free gap as Today's state names it: "now" for a gap that
// starts within ten minutes, and its length rounded down to the quarter
// hour. A gap that starts now moves with the clock (it starts at the next
// five-minute mark), so its exact time would make every reload a new call;
// the tasks offered for it were already checked to fit, in code.
func gapState(gap *FreeGap, now time.Time, loc *time.Location) map[string]any {
	starts := gap.Start.In(loc).Format("15:04")
	if gap.Start.Sub(now) <= 10*time.Minute {
		starts = "now"
	}
	return map[string]any{"starts": starts, "minutes": max(minGapMinutes, gap.Minutes/15*15), "partOfDay": partOfDay(gap.Start.In(loc))}
}

// FocusPick is open Work suggested for today's focus list [29].
type FocusPick struct {
	TaskID string `json:"taskId"`
	Name   string `json:"name"`
	// Reasons are the rank's own reasons (overdue, due today, high priority).
	Reasons    []string `json:"reasons"`
	Goal       string   `json:"goal,omitempty"` // the person's goal it moves forward [28]
	EffortKind string   `json:"effortKind,omitempty"`
}

// GapTask is the Work suggested for a free gap [30].
type GapTask struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Minutes    int    `json:"minutes"` // what fits: the rest of the estimate, at most the gap
	EffortKind string `json:"effortKind,omitempty"`
}

// FreeGap is the next free stretch today, found by code.
type FreeGap struct {
	Start   time.Time `json:"start"`
	End     time.Time `json:"end"`
	Minutes int       `json:"minutes"`
	Task    *GapTask  `json:"task,omitempty"`
}

// GoalCount is how many of the top open tasks move one goal forward [28].
type GoalCount struct {
	Goal  string `json:"goal"`
	Count int    `json:"count"`
}

type TodaySuggestions struct {
	Available bool        `json:"available"`
	LogID     string      `json:"logId,omitempty"`
	Error     string      `json:"error,omitempty"`
	Focus     []FocusPick `json:"focus,omitempty"`
	Gap       *FreeGap    `json:"gap,omitempty"`
	Goals     []GoalCount `json:"goals,omitempty"`
}

func (s *Service) today(c *echo.Context) error {
	out, err := s.Today(c.Request().Context(), user(c), c.QueryParam("timezone"), time.Now())
	if err != nil {
		return err
	}
	return c.JSON(200, out)
}

// Today suggests focus picks and the best Work for the next free gap.
func (s *Service) Today(ctx context.Context, userID, timezone string, now time.Time) (TodaySuggestions, error) {
	ctx, cancel := context.WithTimeout(ctx, todayBudget)
	defer cancel()
	if ok, _ := s.decide.Status(ctx, userID); !ok || s.schedule == nil {
		return TodaySuggestions{}, nil
	}
	out := TodaySuggestions{Available: true}
	hours, err := schedule.NewRepository(s.db.WithContext(ctx)).GetWorkingHours(userID)
	if err != nil {
		hours = models.WorkingHours{}
	}
	day := task.TodayFor(hours, timezone, now)
	date := day.Date()
	ranked, err := s.schedule.Rank(userID, timezone)
	if err != nil {
		return out, err
	}
	reasons := map[string][]string{}
	var cands []models.Task
	for _, r := range ranked {
		if len(cands) == maxTraitTasks {
			break
		}
		t := r.Task
		if t.IsRecurring() || (t.BlockedByID != nil && *t.BlockedByID != "") ||
			models.NormalizeDate(derefStr(t.TodayFocusOn)) == date {
			continue
		}
		cands = append(cands, t)
		reasons[t.ID] = r.Reasons
	}
	if len(cands) == 0 {
		return out, nil
	}
	fillCtx, cancel := context.WithTimeout(ctx, traitsBudget)
	cands = s.FillTraits(fillCtx, userID, cands)
	cancel()
	prefs := s.prefs(ctx, userID)

	// The next free gap today, from code.
	loc := day.Location()
	from := day.Now().Truncate(5 * time.Minute).Add(5 * time.Minute)
	y, m, d := day.Now().Date()
	end := time.Date(y, m, d+1, 0, 0, 0, 0, loc)
	var gap *FreeGap
	if from.Before(end) {
		if free, err := s.schedule.FreeTime(userID, from, end, timezone); err == nil {
			for _, iv := range free {
				if iv.Minutes() >= minGapMinutes {
					gap = &FreeGap{Start: iv.Start, End: iv.End, Minutes: iv.Minutes()}
					break
				}
			}
		}
	}

	list := make([]map[string]any, 0, len(cands))
	questions := map[string]decide.Question{}
	// The same question goal progress asks (focus.GoalQuestion), so its
	// answers are remembered for the Focus block on Today.
	goalOpts := focus.GoalOptions(prefs.Goals)
	var projects map[string]string
	if goalOpts != nil {
		projects = focus.ProjectTitles(ctx, s.db, userID, cands)
	}
	var gapCands []int
	for i, t := range cands {
		key := fmt.Sprintf("t%d", i+1)
		item := map[string]any{"task": key, "title": clip(t.Name, 200), "rankedBecause": reasons[t.ID]}
		if desc := strings.TrimSpace(t.Description); desc != "" {
			item["description"] = clip(desc, 300)
		}
		if t.Deadline != nil && *t.Deadline != "" {
			item["deadline"] = models.NormalizeDate(*t.Deadline)
		}
		if left := t.Duration - t.ActualMinutes; t.Duration > 0 && left > 0 {
			item["minutesLeft"] = left
		}
		if t.EffortKind != "" {
			item["effort"] = t.EffortKind
		}
		if p := projects[t.ID]; p != "" {
			item["project"] = clip(p, 120)
		}
		list = append(list, item)
		questions["focus_"+key] = decide.Score(fmt.Sprintf("How much does working on task %s today matter, given its deadline, how urgent its words make it and the person's goals?", key),
			"Not for today", "It could wait", "Good to do today", "It should be done today")
		if goalOpts != nil {
			questions["goal_"+key] = focus.GoalQuestion("task "+key, goalOpts)
		}
		if gap != nil && len(gapCands) < maxGapTasks && fitsGap(t, gap.Minutes) && !plannedAhead(t, now) {
			gapCands = append(gapCands, i)
		}
	}
	// The day and part of day, not the minute: the same tasks read the same
	// way all morning, so a reload within ten minutes uses the cached answer.
	state := map[string]any{"today": day.Now().Format("Monday 2 January") + ", " + partOfDay(day.Now()), "tasks": list}
	if len(prefs.Goals) > 0 {
		state["goals"] = prefs.Goals
	}
	if prefs.DeepWorkTime != "" {
		state["bestTimeForDeepWork"] = prefs.DeepWorkTime
	}
	if len(gapCands) > 0 {
		opts := []decide.Option{{Name: "none", Description: "None of these suits the gap"}}
		for _, i := range gapCands {
			desc := fmt.Sprintf("Task “%s”, %d minutes left", clip(cands[i].Name, 120), cands[i].Duration-cands[i].ActualMinutes)
			if cands[i].EffortKind != "" {
				desc += ", " + cands[i].EffortKind + " work"
			}
			opts = append(opts, decide.Option{Name: fmt.Sprintf("t%d", i+1), Description: desc})
		}
		state["freeGap"] = gapState(gap, day.Now(), loc)
		questions["gap"] = decide.Choice("The person has the free gap in freeGap. Which task is the best use of it, given its length, the kind of effort each task takes and the time of day?", opts...)
	}
	// Titles and descriptions full of "&" or "<" take six bytes a character
	// as JSON; they are cut until the state fits rather than dropping the call.
	decide.Fit(state, list, "description", "title", "project")
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "today", State: state, Questions: questions})
	if err != nil {
		out.Error = failure(err)
		return out, nil
	}
	out.LogID = a.LogID

	type scored struct {
		i     int
		level int
	}
	var picks []scored
	counts := make([]int, len(prefs.Goals))
	goals := map[string]string{}
	tags := map[string]int{}
	for i, t := range cands {
		key := fmt.Sprintf("t%d", i+1)
		if _, answered := a.Raw("goal_" + key); goalOpts != nil && answered {
			// A question left out of the answer is not stored as "no goal":
			// goal progress asks it again.
			n := focus.ReadGoal(a, "goal_"+key, len(prefs.Goals))
			tags[t.ID] = n
			if n >= 0 {
				goals[t.ID] = prefs.Goals[n]
				counts[n]++
			}
		}
		// Score confidence runs low; the level only orders Work code already
		// ranked highest, so any answer counts.
		if level, ok := a.Level("focus_"+key, 0); ok && level >= 2 {
			picks = append(picks, scored{i, level})
		}
	}
	focus.NewStore(s.db).Remember(ctx, userID, prefs.goals, cands, tags)
	sort.SliceStable(picks, func(x, y int) bool { return picks[x].level > picks[y].level })
	for _, p := range picks {
		if len(out.Focus) == maxFocusPicks {
			break
		}
		t := cands[p.i]
		out.Focus = append(out.Focus, FocusPick{TaskID: t.ID, Name: t.Name, Reasons: reasons[t.ID], Goal: goals[t.ID], EffortKind: t.EffortKind})
	}
	for i, g := range prefs.Goals {
		out.Goals = append(out.Goals, GoalCount{Goal: g, Count: counts[i]})
	}
	if gap != nil {
		out.Gap = gap
		// A pick the person schedules with one click, among tasks code
		// already found to fit: Flag is enough.
		if pick, ok := a.Choice("gap", decide.Flag); ok && pick != "none" {
			var n int
			if _, err := fmt.Sscanf(pick, "t%d", &n); err == nil && n >= 1 && n <= len(cands) {
				t := cands[n-1]
				minutes := t.Duration - t.ActualMinutes
				if minutes <= 0 || minutes > gap.Minutes {
					minutes = gap.Minutes
				}
				gap.Task = &GapTask{ID: t.ID, Name: t.Name, Minutes: minutes, EffortKind: t.EffortKind}
			}
		}
	}
	return out, nil
}

// fitsGap: the rest of the estimate fits, or the task may be split and its
// smallest session fits.
func fitsGap(t models.Task, minutes int) bool {
	left := t.Duration - t.ActualMinutes
	if t.Duration <= 0 || left <= 0 {
		return false
	}
	return left <= minutes || (!t.Contiguous && t.MinChunk() <= minutes)
}

// plannedAhead is true when the task already has a block that is not over:
// its time is booked, so suggesting it for the gap would book it twice.
func plannedAhead(t models.Task, now time.Time) bool {
	for _, b := range t.Blocks {
		if b.EndAt.After(now) {
			return true
		}
	}
	return false
}

// Triage actions for a missed block or overdue Work [35][36]. Code applies
// them (notify.Triage); Jev only says which fits.
const (
	TriageReschedule = "reschedule" // overdue: make it urgent and place it first
	TriageExtend     = "extend"     // overdue: move the deadline a week later
	TriageAddTime    = "addtime"    // missed: raise the estimate, then re-place
	TriageMove       = "move"       // missed: place the rest in the next free time
	TriageLower      = "lower"      // either: lower its priority one step
)

const triageBudget = 8 * time.Second

// Triage picks the next step for each piece of Work whose block ended
// unfinished (kind "missed") or that is past its deadline ("overdue",
// OverdueDays from code), in the order given: "" where suggestions are off
// or Jev is unsure. A sweep's notifications come as one batch, so they cost
// one call per kind rather than one each.
func (s *Service) Triage(ctx context.Context, userID string, items []notify.TriageItem) []string {
	out := make([]string, len(items))
	ctx, cancel := context.WithTimeout(ctx, triageBudget)
	defer cancel()
	// Each kind keeps its own call, so what the person kept of one kind
	// never sets how sure the other must be (see decide's learned raise).
	byKind := map[string][]int{}
	for i, it := range items {
		if it.Task != nil && (it.Kind == "overdue" || it.Kind == "missed") {
			byKind[it.Kind] = append(byKind[it.Kind], i)
		}
	}
	var wg sync.WaitGroup
	for kind, idx := range byKind {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.triageKind(ctx, userID, kind, items, idx, out)
		}()
	}
	wg.Wait()
	return out
}

// triageKind asks one call for the items at idx, all of one kind, and
// writes each pick into out.
func (s *Service) triageKind(ctx context.Context, userID, kind string, items []notify.TriageItem, idx []int, out []string) {
	list := make([]map[string]any, 0, len(idx))
	questions := map[string]decide.Question{}
	for n, i := range idx {
		t := items[i].Task
		key := fmt.Sprintf("t%d", n+1)
		item := map[string]any{"task": key, "title": clip(t.Name, 200), "priority": models.NormalizePriority(derefStr(t.PriorityLevel))}
		if d := strings.TrimSpace(t.Description); d != "" {
			item["description"] = clip(d, 400)
		}
		if t.Duration > 0 {
			item["estimateMinutes"] = t.Duration
		}
		if t.ActualMinutes > 0 {
			item["minutesWorked"] = t.ActualMinutes
		}
		if t.Urgency != nil && *t.Urgency >= 0 && *t.Urgency < len(urgencyLevels) {
			item["urgency"] = urgencyLevels[*t.Urgency]
		}
		if kind == "overdue" {
			item["daysPastDeadline"] = items[i].OverdueDays
		}
		list = append(list, item)
		questions[fmt.Sprintf("next%d", n+1)] = triageQuestion(kind, key, t)
	}
	state := map[string]any{"tasks": list}
	// Ten titles and descriptions in a script of wide characters can outgrow
	// what Jev takes; the titles and facts still say enough.
	if raw, err := json.Marshal(state); err != nil || len(raw) > decide.MaxStateBytes {
		for _, item := range list {
			delete(item, "description")
		}
	}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "triage_" + kind, State: state, Questions: questions})
	if err != nil {
		return
	}
	for n, i := range idx {
		if pick, _ := a.Choice(fmt.Sprintf("next%d", n+1), decide.Prefill); pick != "keep" {
			out[i] = pick
		}
	}
}

// triageQuestion is the step question for task key.
func triageQuestion(kind, key string, t *models.Task) decide.Question {
	if kind == "overdue" {
		return decide.Choice(fmt.Sprintf("Task %s is past its deadline. Judging by what happens if it is late, which next step fits it best?", key),
			decide.Option{Name: TriageReschedule, Description: "Treat it as urgent and do it as soon as possible: lateness has real consequences"},
			decide.Option{Name: TriageExtend, Description: "Move the deadline a week later: finishing a bit later is fine"},
			decide.Option{Name: TriageLower, Description: "Lower its priority: it matters less than it looked"})
	}
	if t.IsRecurring() {
		// Adding time or moving would change every occurrence, so a
		// repeating task only weighs a lower priority.
		return decide.Choice(fmt.Sprintf("A time block for the repeating task %s ended and the task is still open. Which next step fits it best?", key),
			decide.Option{Name: "keep", Description: "Leave it as it is: the next occurrence is soon enough"},
			decide.Option{Name: TriageLower, Description: "Lower its priority: other work matters more right now"})
	}
	return decide.Choice(fmt.Sprintf("A time block for task %s ended and the task is still open. Which next step fits it best?", key),
		decide.Option{Name: TriageAddTime, Description: "Give it more time: the work is bigger than its estimate"},
		decide.Option{Name: TriageMove, Description: "Move the rest to the next free time: the estimate is fine, the block was just missed"},
		decide.Option{Name: TriageLower, Description: "Lower its priority: other work matters more right now"})
}
