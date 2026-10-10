package suggest

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/features/decide"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

// Work hints: what a task's own words say about its status, stage, custom
// fields and blocker, what still looks missing, and a review of Work nobody
// has touched in weeks. Every answer is a hint the person applies or ignores;
// nothing here changes a task.

const (
	workBudget     = 6 * time.Second
	staleAfter     = 21 * 24 * time.Hour
	maxStale       = 12
	maxFieldAsks   = 6
	maxMultiOption = 8
	maxBlockers    = 6
	maxComments    = 3
)

func (s *Service) workRoutes(g *echo.Group) {
	g.GET("/suggestions/task/:id", s.taskHints)
	g.GET("/suggestions/stale-work", s.staleWork)
	g.POST("/suggestions/stale-work/:id/keep", s.keepStale)
}

// FieldSuggestion fills one empty select, multi-select or yes/no field.
type FieldSuggestion struct {
	FieldID   string   `json:"fieldId"`
	Type      string   `json:"type"`
	OptionIDs []string `json:"optionIds,omitempty"`
	Value     string   `json:"value,omitempty"` // "true" or "false" for a yes/no field
}

// TaskHints is what the task panel may suggest. Every field is optional.
type TaskHints struct {
	Available bool   `json:"available"`
	LogID     string `json:"logId,omitempty"`

	StatusID  string            `json:"statusId,omitempty"`
	StageID   string            `json:"stageId,omitempty"`
	Fields    []FieldSuggestion `json:"fields,omitempty"`
	BlockedBy *Duplicate        `json:"blockedBy,omitempty"`

	VagueOutcome bool `json:"vagueOutcome,omitempty"`
	ChecklistGap bool `json:"checklistGap,omitempty"`
	// NotDone: the task is complete but its words say something is left.
	NotDone bool `json:"notDone,omitempty"`
	// OpenChecklist counts unchecked items on a completed task (code, not Jev).
	OpenChecklist int `json:"openChecklist,omitempty"`

	// EffortKind is the stored kind of effort [31], read again when the
	// task's words changed.
	EffortKind string `json:"effortKind,omitempty"`
	// OneSitting: a long task that is not marked "one sitting" reads like it
	// needs one unbroken stretch [33].
	OneSitting bool `json:"oneSitting,omitempty"`
	// PreferredTime: deep-focus work with no preferred window, for a person
	// who set a best time for deep work [32]. PreferredWindow is the window
	// to save.
	PreferredTime   string                  `json:"preferredTime,omitempty"`
	PreferredWindow *models.PreferredWindow `json:"preferredWindow,omitempty"`
}

// splitMinutes is the estimate from which a task is asked whether it can be
// split across sessions.
const splitMinutes = 90

func (s *Service) taskHints(c *echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), workBudget)
	defer cancel()
	out, err := s.TaskHints(ctx, user(c), c.Param("id"))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(404, "Task not found")
	}
	if err != nil {
		return err
	}
	return c.JSON(200, out)
}

// TaskHints asks one batched Jev call about a task's own words.
func (s *Service) TaskHints(ctx context.Context, userID, taskID string) (TaskHints, error) {
	var task models.Task
	if err := s.db.WithContext(ctx).Preload("CustomFieldValues").
		Where("id = ? AND user_id = ?", taskID, userID).First(&task).Error; err != nil {
		return TaskHints{}, err
	}
	on, _ := s.decide.Status(ctx, userID)
	out := TaskHints{Available: on}
	if task.Kind != models.KindTask || task.WorkspaceID == nil {
		return TaskHints{}, nil
	}
	done := task.CompletedAt != nil && *task.CompletedAt != ""
	if done {
		for _, item := range task.Checklist {
			if !item.IsCompleted() {
				out.OpenChecklist++
			}
		}
	}
	if !on {
		return out, nil
	}

	state := map[string]any{"title": clip(task.Name, 300)}
	description := strings.TrimSpace(task.Description)
	if description != "" {
		state["description"] = clip(description, 2000)
	}
	comments := s.latestComments(ctx, task.ID)
	if len(comments) > 0 {
		state["latestComments"] = comments
	}
	state["completed"] = done
	words := description != "" || len(comments) > 0
	questions := map[string]decide.Question{}

	// Status [12]: only when there is more to read than the title.
	var statuses []models.Status
	statusByName := map[string]string{}
	if words {
		s.db.WithContext(ctx).Where("workspace_id = ?", *task.WorkspaceID).Order("created_at").Find(&statuses)
	}
	if len(statuses) > 1 {
		opts := make([]decide.Option, 0, len(statuses))
		for _, st := range statuses {
			name := uniqueName(st.Name, statusByName)
			statusByName[name] = st.ID
			opts = append(opts, decide.Option{Name: name, Description: fmt.Sprintf("The status “%s”", clip(st.Name, 60))})
		}
		questions["status"] = decide.Choice("Which of the person's statuses matches what the task's description and latest comments say about where it stands now (for example waiting on someone, being worked on, finished)?", opts...).Twice()
	}

	// Stage [14]: an unstaged task in a project with stages.
	var stages []models.Stage
	stageByName := map[string]string{}
	if !done && task.ProjectID != nil && (task.StageID == nil || *task.StageID == "") {
		s.db.WithContext(ctx).Where("project_id = ?", *task.ProjectID).Order(`"order"`).Find(&stages)
	}
	if len(stages) > 0 {
		opts := []decide.Option{{Name: "none", Description: "None of these stages fits, or it is unclear"}}
		for _, st := range stages {
			name := uniqueName(st.Name, stageByName)
			stageByName[name] = st.ID
			opts = append(opts, decide.Option{Name: name, Description: fmt.Sprintf("The project stage “%s”", clip(st.Name, 60))})
		}
		questions["stage"] = decide.Choice("Which stage of the project is this task part of?", opts...)
	}

	// Custom fields [15]: empty select, multi-select and yes/no fields, read
	// from the description only.
	type fieldAsk struct {
		field models.CustomField
		names map[string]string // option name -> id
		keys  []string          // per-option question ids for a multi-select
	}
	asks := map[string]*fieldAsk{}
	if description != "" {
		var fields []models.CustomField
		s.db.WithContext(ctx).Where("workspace_id = ? AND type IN ?", *task.WorkspaceID,
			[]string{string(models.CustomFieldTypeSelect), string(models.CustomFieldTypeMultiSelect), string(models.CustomFieldTypeBoolean)}).
			Order("created_at").Find(&fields)
		filled := map[string]bool{}
		for _, v := range task.CustomFieldValues {
			if v != nil && (len(v.OptionsValue) > 0 || (v.StringValue != nil && *v.StringValue != "")) {
				filled[v.CustomFieldID] = true
			}
		}
		n := 0
		for _, f := range fields {
			if filled[f.ID] || n == maxFieldAsks {
				continue
			}
			key := fmt.Sprintf("field%d", n+1)
			ask := &fieldAsk{field: f, names: map[string]string{}}
			label := clip(f.Name, 60)
			switch f.Type {
			case models.CustomFieldTypeBoolean:
				questions[key] = decide.Choice(fmt.Sprintf("What does the description say for the yes/no field “%s”?", label),
					decide.Option{Name: "yes", Description: "It clearly says yes"},
					decide.Option{Name: "no", Description: "It clearly says no"},
					decide.Option{Name: "unknown", Description: "It does not say"})
			case models.CustomFieldTypeSelect:
				if len(f.Options.Options) == 0 {
					continue
				}
				opts := []decide.Option{{Name: "unknown", Description: "The description does not say"}}
				for _, o := range f.Options.Options {
					name := uniqueName(o.Value, ask.names)
					ask.names[name] = o.ID
					opts = append(opts, decide.Option{Name: name})
				}
				questions[key] = decide.Choice(fmt.Sprintf("Which value of the field “%s” does the description say?", label), opts...)
			case models.CustomFieldTypeMultiSelect:
				if len(f.Options.Options) == 0 || len(f.Options.Options) > maxMultiOption {
					continue
				}
				for j, o := range f.Options.Options {
					k := fmt.Sprintf("%s_%d", key, j+1)
					ask.names[k] = o.ID
					ask.keys = append(ask.keys, k)
					questions[k] = decide.YesNo(fmt.Sprintf("Does the description say the field “%s” includes “%s”?", label, clip(o.Value, 60)),
						"It clearly does.", "It does not, or it does not say.")
				}
			default:
				continue
			}
			asks[key] = ask
			n++
		}
	}

	// Blocker [13]: a task whose words say it waits on other Work, with no
	// blocker set; candidates are nearby open tasks in the same workspace.
	blockers := []Duplicate{}
	if words && !done && (task.BlockedByID == nil || *task.BlockedByID == "") {
		blockers = s.blockerCandidates(ctx, userID, task)
	}
	if len(blockers) > 0 {
		opts := []decide.Option{{Name: "none", Description: "It does not wait on any of these tasks"}}
		list := []map[string]any{}
		for i, b := range blockers {
			name := fmt.Sprintf("t%d", i+1)
			opts = append(opts, decide.Option{Name: name, Description: fmt.Sprintf("Task “%s”", clip(b.Name, 120))})
			list = append(list, map[string]any{"task": name, "title": clip(b.Name, 120)})
		}
		state["otherTasks"] = list
		questions["blocker"] = decide.Choice("Does the description or a comment say this task cannot continue until one of the other tasks is finished? If so, which one?", opts...).Twice()
	}

	staleTraits := !done && task.TraitsHash != traitsHash(task)
	if staleTraits {
		traitQuestions(questions, "task", "this task")
	}
	if !done && task.Duration >= splitMinutes && !task.Contiguous {
		questions["stretch"] = decide.YesNo("Does this work need one unbroken stretch of time, rather than being split across several shorter sessions?",
			"Yes, it needs one sitting (for example an exam, a trip, a long call or a performance).", "No, it can be done over several sessions.")
	}

	if !done {
		// Outcome [16].
		questions["outcome"] = decide.YesNo("Is it clear from the title and description what result counts as this task being done?",
			"Yes, the result is clear.", "No, it is vague what done looks like.")
		// Checklist gap [17].
		if description != "" && len(task.Checklist) > 0 {
			questions["gap"] = decide.YesNo("Does the description ask for something that none of the checklist items covers?",
				"Yes, something the description asks for is missing from the checklist.", "No, the checklist covers it.")
		}
	} else if words {
		// Done but not [18].
		questions["left"] = decide.YesNo("The task is marked complete. Do its description or latest comments say something is still left to do or still waiting?",
			"Yes, something still looks unfinished.", "No, nothing says work is left.")
	}

	// Only the gap and done-but-not questions read the checklist.
	_, gap := questions["gap"]
	_, left := questions["left"]
	if len(task.Checklist) > 0 && (gap || left) {
		list := []map[string]any{}
		for _, item := range task.Checklist {
			if len(list) == 20 {
				break
			}
			list = append(list, map[string]any{"item": clip(item.Title, 120), "done": item.IsCompleted()})
		}
		state["checklist"] = list
	}

	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "task_hints", State: state, Questions: questions})
	if err != nil {
		return out, nil
	}
	out.LogID = a.LogID
	if name, ok := a.Choice("status", decide.Route); ok {
		if id := statusByName[name]; id != "" && (task.StatusID == nil || *task.StatusID != id) {
			out.StatusID = id
		}
	}
	if name, ok := a.Choice("stage", decide.Prefill); ok && name != "none" {
		out.StageID = stageByName[name]
	}
	keys := make([]string, 0, len(asks))
	for k := range asks {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, key := range keys {
		ask := asks[key]
		f := ask.field
		switch f.Type {
		case models.CustomFieldTypeBoolean:
			if v, ok := a.Choice(key, decide.Prefill); ok && v != "unknown" {
				value := "false"
				if v == "yes" {
					value = "true"
				}
				out.Fields = append(out.Fields, FieldSuggestion{FieldID: f.ID, Type: string(f.Type), Value: value})
			}
		case models.CustomFieldTypeSelect:
			if v, ok := a.Choice(key, decide.Prefill); ok && v != "unknown" && ask.names[v] != "" {
				out.Fields = append(out.Fields, FieldSuggestion{FieldID: f.ID, Type: string(f.Type), OptionIDs: []string{ask.names[v]}})
			}
		case models.CustomFieldTypeMultiSelect:
			var ids []string
			for _, k := range ask.keys {
				if yes, ok := a.Yes(k, decide.Route); ok && yes {
					ids = append(ids, ask.names[k])
				}
			}
			if len(ids) > 0 {
				out.Fields = append(out.Fields, FieldSuggestion{FieldID: f.ID, Type: string(f.Type), OptionIDs: ids})
			}
		}
	}
	if name, ok := a.Choice("blocker", decide.Route); ok && name != "none" {
		var n int
		if _, err := fmt.Sscanf(name, "t%d", &n); err == nil && n >= 1 && n <= len(blockers) {
			b := blockers[n-1]
			out.BlockedBy = &b
		}
	}
	if yes, ok := a.Yes("outcome", decide.Flag); ok && !yes {
		out.VagueOutcome = true
	}
	if yes, ok := a.Yes("gap", decide.Flag); ok && yes {
		out.ChecklistGap = true
	}
	if yes, ok := a.Yes("left", decide.Route); ok && yes {
		out.NotDone = true
	}
	if staleTraits {
		s.readTraits(ctx, a, "task", &task)
	}
	if !done {
		out.EffortKind = task.EffortKind
	}
	if yes, ok := a.Yes("stretch", decide.Route); ok && yes {
		out.OneSitting = true
	}
	if out.EffortKind == "deep" && len(task.PreferredWindows) == 0 {
		if when := s.prefs(ctx, userID).DeepWorkTime; when != "" {
			if w, ok := s.deepWindow(userID, when); ok {
				out.PreferredTime, out.PreferredWindow = when, &w
			}
		}
	}
	return out, nil
}

// latestComments returns the task's newest comments, oldest first.
func (s *Service) latestComments(ctx context.Context, taskID string) []string {
	var rows []models.TaskActivity
	if s.db.WithContext(ctx).Where("task_id = ? AND action = ?", taskID, "commented").
		Order("created_at DESC").Limit(maxComments).Find(&rows).Error != nil {
		return nil
	}
	out := make([]string, 0, len(rows))
	for i := len(rows) - 1; i >= 0; i-- {
		if m := strings.TrimSpace(rows[i].Message); m != "" {
			out = append(out, clip(m, 500))
		}
	}
	return out
}

// blockerCandidates are open tasks in the same workspace near this one,
// leaving out any that already wait on it (directly or down the chain), so a
// suggestion can never close a loop.
func (s *Service) blockerCandidates(ctx context.Context, userID string, task models.Task) []Duplicate {
	if s.search == nil {
		return nil
	}
	sctx, cancel := context.WithTimeout(ctx, searchBudget)
	query := task.Name
	if d := strings.TrimSpace(task.Description); d != "" {
		query += "\n" + clip(d, 300)
	}
	hits, _ := s.search.SemanticSearch(sctx, userID, query, maxBlockers+4, []string{"task"})
	cancel()
	ids := []string{}
	for _, h := range hits {
		if h.ID != task.ID {
			ids = append(ids, h.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	var rows []models.Task
	if s.db.WithContext(ctx).Select("id", "name", "blocked_by_id").
		Where("id IN ? AND user_id = ? AND workspace_id = ? AND kind = ? AND completed_at IS NULL", ids, userID, *task.WorkspaceID, models.KindTask).
		Find(&rows).Error != nil {
		return nil
	}
	byID := map[string]models.Task{}
	for _, r := range rows {
		byID[r.ID] = r
	}
	out := []Duplicate{}
	for _, id := range ids {
		r, ok := byID[id]
		if !ok || s.waitsOn(ctx, userID, r, task.ID) {
			continue
		}
		out = append(out, Duplicate{ID: r.ID, Name: r.Name})
		if len(out) == maxBlockers {
			break
		}
	}
	return out
}

// waitsOn reports whether t already waits on target through its blocker chain.
func (s *Service) waitsOn(ctx context.Context, userID string, t models.Task, target string) bool {
	seen := map[string]bool{t.ID: true}
	next := t.BlockedByID
	for i := 0; next != nil && *next != "" && i < 50; i++ {
		if *next == target {
			return true
		}
		if seen[*next] {
			return false
		}
		seen[*next] = true
		var row models.Task
		if s.db.WithContext(ctx).Select("id", "blocked_by_id").Where("id = ? AND user_id = ?", *next, userID).First(&row).Error != nil {
			return false
		}
		next = row.BlockedByID
	}
	return false
}

// StaleTask is Work with no activity for weeks and what Jev thinks it needs.
type StaleTask struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	IdleDays int    `json:"idleDays"`
	// Verdict: actionable, clarify, blocked or obsolete; empty when unsure.
	Verdict string `json:"verdict,omitempty"`
}

type StaleWork struct {
	Available bool        `json:"available"`
	LogID     string      `json:"logId,omitempty"`
	Tasks     []StaleTask `json:"tasks"`
}

func (s *Service) staleWork(c *echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), workBudget)
	defer cancel()
	out, err := s.StaleWork(ctx, user(c), time.Now())
	if err != nil {
		return err
	}
	return c.JSON(200, out)
}

// StaleWork lists open Work with no edits, comments or upcoming Blocks for
// three weeks, oldest first, and asks Jev what each one needs. The idle
// days are counted in code.
func (s *Service) StaleWork(ctx context.Context, userID string, now time.Time) (StaleWork, error) {
	on, _ := s.decide.Status(ctx, userID)
	out := StaleWork{Available: on, Tasks: []StaleTask{}}
	if !on {
		return out, nil
	}
	stale, err := s.staleTasks(ctx, userID, now)
	if err != nil || len(stale) == 0 {
		return out, err
	}
	list := []map[string]any{}
	questions := map[string]decide.Question{}
	for i, st := range stale {
		key := fmt.Sprintf("task%d", i+1)
		item := map[string]any{"task": key, "title": clip(st.task.Name, 200), "daysWithoutActivity": st.days}
		if d := strings.TrimSpace(st.task.Description); d != "" {
			item["description"] = clip(d, 400)
		}
		list = append(list, item)
		questions[key] = decide.Choice(fmt.Sprintf("Task %s has had no activity for weeks. What does it most likely need?", key),
			decide.Option{Name: "actionable", Description: "It is still worth doing as written; it just needs time"},
			decide.Option{Name: "clarify", Description: "It is vague or unclear and needs rethinking before anyone can act"},
			decide.Option{Name: "blocked", Description: "It is waiting on someone or something else"},
			decide.Option{Name: "obsolete", Description: "It was tied to a date or event that has already passed, or is likely no longer needed"})
	}
	// Today's date lets Jev tell a task tied to a past date or event.
	state := map[string]any{"today": now.Format("Monday 2 January 2006"), "tasks": list}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "stale_work", State: state, Questions: questions})
	for i, st := range stale {
		item := StaleTask{ID: st.task.ID, Name: st.task.Name, IdleDays: st.days}
		if err == nil {
			// A verdict is a review chip, not a pre-fill: the hint threshold.
			if v, ok := a.Choice(fmt.Sprintf("task%d", i+1), decide.Flag); ok {
				item.Verdict = v
			}
		}
		out.Tasks = append(out.Tasks, item)
	}
	if err == nil {
		out.LogID = a.LogID
	}
	return out, nil
}

// idle is open Work with no activity for a while.
type idle struct {
	task models.Task
	days int
}

// staleTasks is open Work with no edits, comments or upcoming Blocks for
// three weeks, oldest first; the idle days are counted in code.
func (s *Service) staleTasks(ctx context.Context, userID string, now time.Time) ([]idle, error) {
	var tasks []models.Task
	if err := s.db.WithContext(ctx).Select("id", "name", "description", "project_id", "created_at", "updated_at").
		Where("user_id = ? AND kind = ? AND completed_at IS NULL", userID, models.KindTask).
		Where("NOT EXISTS (SELECT 1 FROM recurrence_rules r WHERE r.owner_id = tasks.id AND r.owner_type = 'task')").
		Where("NOT EXISTS (SELECT 1 FROM scheduled_blocks b WHERE b.task_id = tasks.id AND b.end_at > ?)", now).
		Find(&tasks).Error; err != nil {
		return nil, err
	}
	if len(tasks) == 0 {
		return nil, nil
	}
	ids := make([]string, len(tasks))
	for i, t := range tasks {
		ids[i] = t.ID
	}
	type last struct {
		TaskID string
		At     string
	}
	var activity []last
	if err := s.db.WithContext(ctx).Table("task_activities").Select("task_id, MAX(created_at) AS at").
		Where("task_id IN ?", ids).Group("task_id").Scan(&activity).Error; err != nil {
		return nil, err
	}
	lastAt := map[string]time.Time{}
	for _, a := range activity {
		lastAt[a.TaskID] = parseWhen(a.At)
	}
	var stale []idle
	for _, t := range tasks {
		latest := parseWhen(t.UpdatedAt)
		if c := parseWhen(t.CreatedAt); c.After(latest) {
			latest = c
		}
		if a := lastAt[t.ID]; a.After(latest) {
			latest = a
		}
		if latest.IsZero() || now.Sub(latest) < staleAfter {
			continue
		}
		stale = append(stale, idle{t, int(now.Sub(latest).Hours() / 24)})
	}
	sort.SliceStable(stale, func(i, j int) bool { return stale[i].days > stale[j].days })
	if len(stale) > maxStale {
		stale = stale[:maxStale]
	}
	return stale, nil
}

// keepStale records that the person reviewed a stale task and kept it, which
// also restarts its idle count on every device.
func (s *Service) keepStale(c *echo.Context) error {
	uid := user(c)
	var task models.Task
	if err := s.db.WithContext(c.Request().Context()).Select("id").Where("id = ? AND user_id = ?", c.Param("id"), uid).First(&task).Error; err != nil {
		return echo.NewHTTPError(404, "Task not found")
	}
	entry := models.TaskActivity{ID: utils.NewActivityID(), TaskID: task.ID, UserID: uid, Action: "reviewed",
		Message: "Kept after a stale work review", CreatedAt: utils.GetCurrentTimestamp()}
	if err := s.db.WithContext(c.Request().Context()).Create(&entry).Error; err != nil {
		return err
	}
	return c.NoContent(204)
}

// parseWhen reads the timestamps tasks and activities store: RFC3339,
// Postgres' own text form, or a bare date for older rows.
func parseWhen(v string) time.Time {
	for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05.999999999-07", "2006-01-02 15:04:05.999999999-07:00", "2006-01-02"} {
		if t, err := time.Parse(layout, v); err == nil {
			return t
		}
	}
	return time.Time{}
}
