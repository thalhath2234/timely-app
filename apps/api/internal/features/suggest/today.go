package suggest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/decide"
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
	maxGoals       = 5
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
		s.fillTopTraits(ctx, userID, "")
		if ctx.Err() != nil {
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
// unknown with the hash, so the same words are not asked about again.
func (s *Service) readTraits(ctx context.Context, a decide.Answers, key string, t *models.Task) {
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
		return tasks
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
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "traits", State: map[string]any{"tasks": list}, Questions: questions})
	if err != nil {
		return tasks
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
	return out
}

// fillTopTraits fills the traits of the Work Auto-schedule ranks highest.
func (s *Service) fillTopTraits(ctx context.Context, userID, timezone string) {
	if s.schedule == nil {
		return
	}
	if ok, _ := s.decide.Status(ctx, userID); !ok {
		return
	}
	ranked, err := s.schedule.Rank(userID, timezone)
	if err != nil {
		return
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
	s.FillTraits(ctx, userID, tasks)
}

// Prefs is what the person told suggestions to weigh (Settings > Smart
// suggestions).
type Prefs struct {
	Goals        []string
	DeepWorkTime string // "", morning, afternoon or evening
}

func (s *Service) prefs(ctx context.Context, userID string) Prefs {
	var row struct {
		DecisionGoals string
		DeepWorkTime  string
	}
	var out Prefs
	if s.db.WithContext(ctx).Table("agent_provider_settings").Select("decision_goals::text AS decision_goals, deep_work_time").
		Where("user_id = ?", userID).Take(&row).Error != nil {
		return out
	}
	_ = json.Unmarshal([]byte(row.DecisionGoals), &out.Goals)
	if len(out.Goals) > maxGoals {
		out.Goals = out.Goals[:maxGoals]
	}
	out.DeepWorkTime = row.DeepWorkTime
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
	ctx, cancel := context.WithTimeout(c.Request().Context(), todayBudget)
	defer cancel()
	out, err := s.Today(ctx, user(c), c.QueryParam("timezone"), time.Now())
	if err != nil {
		return err
	}
	return c.JSON(200, out)
}

// Today suggests focus picks and the best Work for the next free gap.
func (s *Service) Today(ctx context.Context, userID, timezone string, now time.Time) (TodaySuggestions, error) {
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
	var goalOpts []decide.Option
	if len(prefs.Goals) > 0 {
		goalOpts = []decide.Option{{Name: "none", Description: "None of the person's goals"}}
		for i, g := range prefs.Goals {
			goalOpts = append(goalOpts, decide.Option{Name: fmt.Sprintf("g%d", i+1), Description: clip(g, 120)})
		}
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
		list = append(list, item)
		questions["focus_"+key] = decide.Score(fmt.Sprintf("How much does working on task %s today matter, given its deadline, how urgent its words make it and the person's goals?", key),
			"Not for today", "It could wait", "Good to do today", "It should be done today")
		if goalOpts != nil {
			questions["goal_"+key] = decide.Choice(fmt.Sprintf("Which of the person's goals does task %s clearly move forward, if any?", key), goalOpts...)
		}
		if gap != nil && len(gapCands) < maxGapTasks && fitsGap(t, gap.Minutes) {
			gapCands = append(gapCands, i)
		}
	}
	state := map[string]any{"today": day.Now().Format("Monday 2 January, 15:04"), "tasks": list}
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
		state["freeGap"] = map[string]any{"starts": gap.Start.In(loc).Format("15:04"), "minutes": gap.Minutes, "partOfDay": partOfDay(gap.Start.In(loc))}
		questions["gap"] = decide.Choice("The person has the free gap in freeGap. Which task is the best use of it, given its length, the kind of effort each task takes and the time of day?", opts...)
	}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "today", State: state, Questions: questions})
	if err != nil {
		out.Error = failure(ctx, err)
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
	for i, t := range cands {
		key := fmt.Sprintf("t%d", i+1)
		if g, ok := a.Choice("goal_"+key, decide.Prefill); ok && g != "none" {
			var n int
			if _, err := fmt.Sscanf(g, "g%d", &n); err == nil && n >= 1 && n <= len(prefs.Goals) {
				goals[t.ID] = prefs.Goals[n-1]
				counts[n-1]++
			}
		}
		// Score confidence runs low; the level only orders Work code already
		// ranked highest, so any answer counts.
		if level, ok := a.Level("focus_"+key, 0); ok && level >= 2 {
			picks = append(picks, scored{i, level})
		}
	}
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

// Triage picks the next step for Work whose block ended unfinished (kind
// "missed") or that is past its deadline ("overdue", overdueDays from code).
// It returns "" when suggestions are off or Jev is unsure.
func (s *Service) Triage(ctx context.Context, userID string, t *models.Task, kind string, overdueDays int) string {
	if t == nil {
		return ""
	}
	ctx, cancel := context.WithTimeout(ctx, triageBudget)
	defer cancel()
	state := map[string]any{"title": clip(t.Name, 300), "priority": models.NormalizePriority(derefStr(t.PriorityLevel))}
	if d := strings.TrimSpace(t.Description); d != "" {
		state["description"] = clip(d, 1000)
	}
	if t.Duration > 0 {
		state["estimateMinutes"] = t.Duration
	}
	if t.ActualMinutes > 0 {
		state["minutesWorked"] = t.ActualMinutes
	}
	if t.Urgency != nil && *t.Urgency >= 0 && *t.Urgency < len(urgencyLevels) {
		state["urgency"] = urgencyLevels[*t.Urgency]
	}
	var q decide.Question
	switch kind {
	case "overdue":
		state["daysPastDeadline"] = overdueDays
		q = decide.Choice("This task is past its deadline. Judging by what happens if it is late, which next step fits best?",
			decide.Option{Name: TriageReschedule, Description: "Treat it as urgent and do it as soon as possible: lateness has real consequences"},
			decide.Option{Name: TriageExtend, Description: "Move the deadline a week later: finishing a bit later is fine"},
			decide.Option{Name: TriageLower, Description: "Lower its priority: it matters less than it looked"})
	case "missed":
		q = decide.Choice("A time block for this task ended and the task is still open. Which next step fits best?",
			decide.Option{Name: TriageAddTime, Description: "Give it more time: the work is bigger than its estimate"},
			decide.Option{Name: TriageMove, Description: "Move the rest to the next free time: the estimate is fine, the block was just missed"},
			decide.Option{Name: TriageLower, Description: "Lower its priority: other work matters more right now"})
	default:
		return ""
	}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "triage_" + kind, State: state, Questions: map[string]decide.Question{"next": q}})
	if err != nil {
		return ""
	}
	pick, _ := a.Choice("next", decide.Prefill)
	return pick
}
