package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/chat"
	"timely-api/internal/models"
)

// Views from plain words with AI: "what can I finish before lunch that is
// not blocked" becomes a saved-view draft. The clients read common phrases
// themselves (packages/contract/src/viewLanguage.ts, no key needed) and ask
// here when words are left over. Like Help me write it runs on the account's
// generative provider; the model answers in names, which are resolved to ids
// here, and every rule is checked before it goes back.

const (
	viewQueryMaxText  = 500
	viewQueryMaxNames = 60
	viewQueryBudget   = 90 * time.Second
)

type viewQueryRequest struct {
	Query string `json:"query"`
	// Today is the date in the Working hours timezone (YYYY-MM-DD); relative
	// words are kept relative, but weekday and month names need it.
	Today string `json:"today"`
	// Client "phone" has no timeline layout.
	Client string `json:"client"`
}

// viewQueryDraft is what the model answers and the client gets back.
type viewQueryDraft struct {
	Name              string            `json:"name"`
	DataMode          string            `json:"dataMode"`
	RenderMode        string            `json:"renderMode"`
	ShowReminders     bool              `json:"showReminders"`
	ShowCompleted     *bool             `json:"showCompleted"`
	GroupFields       []string          `json:"groupFields"`
	SortBy            string            `json:"sortBy"`
	SortDirection     string            `json:"sortDirection"`
	ThenSortBy        string            `json:"thenSortBy,omitempty"`
	ThenSortDirection string            `json:"thenSortDirection,omitempty"`
	Limit             int               `json:"limit,omitempty"`
	RuleMatch         string            `json:"ruleMatch,omitempty"`
	Rules             []models.ViewRule `json:"rules"`
}

type viewQueryResponse struct {
	View     viewQueryDraft `json:"view"`
	Dropped  []string       `json:"dropped,omitempty"`
	Provider string         `json:"provider"`
	Model    string         `json:"model"`
}

type vocabRow struct {
	ID, Name, Kind, Type string
	Options              models.Options `gorm:"type:jsonb"`
}

// viewVocab is the person's names a view can filter on.
type viewVocab struct {
	workspaces, projects, statuses, stages, labels []vocabRow
	fields                                         []vocabRow
}

func (s *Service) loadViewVocab(ctx context.Context, userID string) (viewVocab, error) {
	var v viewVocab
	db := s.db.WithContext(ctx)
	read := func(dest *[]vocabRow, query string) error {
		return db.Raw(query, userID).Scan(dest).Error
	}
	if err := read(&v.workspaces, `SELECT id, name FROM workspaces WHERE user_id = ? ORDER BY name`); err != nil {
		return v, err
	}
	queries := []struct {
		dest  *[]vocabRow
		query string
	}{
		{&v.projects, `SELECT p.id, p.title AS name FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE w.user_id = ? ORDER BY p.title`},
		{&v.statuses, `SELECT s.id, s.name FROM statuses s JOIN workspaces w ON w.id = s.workspace_id WHERE w.user_id = ? ORDER BY s.name`},
		{&v.labels, `SELECT l.id, l.name FROM lables l JOIN workspaces w ON w.id = l.workspace_id WHERE w.user_id = ? ORDER BY l.name`},
		{&v.stages, `SELECT st.id, st.name FROM stages st JOIN projects p ON p.id = st.project_id JOIN workspaces w ON w.id = p.workspace_id WHERE w.user_id = ? ORDER BY st.name`},
		{&v.fields, `SELECT f.id, f.name, f.type, f.options FROM custom_fields f JOIN workspaces w ON w.id = f.workspace_id WHERE w.user_id = ? ORDER BY f.name`},
	}
	for _, q := range queries {
		if err := read(q.dest, q.query); err != nil {
			return v, err
		}
	}
	return v, nil
}

func uniqueNames(rows []vocabRow) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, row := range rows {
		key := strings.ToLower(strings.TrimSpace(row.Name))
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, strings.TrimSpace(row.Name))
		if len(out) == viewQueryMaxNames {
			break
		}
	}
	return out
}

const viewQuerySystem = `You turn a person's request into a saved task view for Timely, a planner. Reply with one JSON object and nothing else.

Shape:
{"name": short view name from their words (2-5 words),
 "dataMode": "task" (default) or "project" (lists projects),
 "renderMode": "list" (default), "kanban" (board) or "gantt" (timeline),
 "showReminders": true only when they ask for reminders,
 "showCompleted": false hides done work (default false unless they ask for done, completed or everything),
 "groupFields": up to 3 of workspace, project, stage, status, priority, label, deadline, planned, startDate, createdAt, updatedAt, completedAt, effort, done, recurring, or "cf:<custom field name>",
 "sortBy": one of name, deadline, startDate, scheduledOn, createdAt, updatedAt, completedAt, priority, status, project, workspace, stage, duration, tracked, urgency, progress, effort, or "cf:<custom field name>",
 "sortDirection": "asc" or "desc" (priority desc = highest first; createdAt desc = newest first),
 "thenSortBy", "thenSortDirection": optional second sort,
 "limit": optional number of rows ("top 5"),
 "ruleMatch": "all" (default) or "any",
 "rules": [conditions]}

A condition is {"field": F, "op": O, "value": V, "to": V2} or a group {"match": "any" or "all", "rules": [conditions]} (one level only).
Fields and ops:
- workspace, project, status, stage, label: ops anyOf, noneOf, isEmpty, isNotEmpty (label also allOf). Value: a list of the person's names, exactly as listed below.
- priority: anyOf/noneOf with ["Low","Medium","High","Urgent"], gte/lte with one level ("High" or above), isEmpty.
- effort: anyOf/noneOf with ["deep","admin","creative","routine"].
- name, description, text (name + description + checklist): contains, notContains, startsWith, is, isEmpty, isNotEmpty. Value: a string.
- deadline, startDate, planned (the day of its calendar time), createdAt, updatedAt, completedAt: in, notIn, before, onOrBefore, after, onOrAfter, between (with "to"), isEmpty, isNotEmpty.
  Date values: "today", "tomorrow", "yesterday", "thisWeek", "nextWeek", "lastWeek", "thisWeekend", "thisMonth", "nextMonth", "lastMonth", "thisYear", "next:N" (today and the next N days), "last:N" (the last N days and today), "+N"/"-N" (one day N days from today), or "YYYY-MM-DD". Prefer relative words so the view stays current.
- duration (estimate, minutes), tracked (minutes of tracked time), urgency (0-4), progress (checklist percent 0-100): eq, neq, gt, gte, lt, lte, between, isEmpty, isNotEmpty. Value: a number.
- done, overdue, recurring, scheduled (has calendar time), blocked (waits on open work), blocking (other work waits on it), hasChecklist, inFocus, todayFocus, locked, overEstimate: op "is" with true or false.
- "cf:<custom field name>": by its type (listed below); select options by name.

Rules:
- Only use names from the lists below. Never invent ids.
- "Show tasks with deadlines" means deadline isNotEmpty sorted by deadline asc. "Due this week" means deadline in thisWeek.
- A date with no field ("tasks for tomorrow") means {"match":"any","rules":[deadline in X, planned in X]}.
- "Not updated in 30 days" means updatedAt before "-30". "Quick" means duration lte 30.
- Words that name no field become a text contains condition.
- Default sort when they give none: deadline asc.`

func viewQueryMessages(req viewQueryRequest, v viewVocab) []chat.WireMessage {
	var b strings.Builder
	weekday := ""
	if day, err := time.Parse("2006-01-02", req.Today); err == nil {
		weekday = day.Weekday().String()
	}
	fmt.Fprintf(&b, "Today is %s %s.\n\nThe person's names:\n", weekday, req.Today)
	list := func(title string, rows []vocabRow) {
		if names := uniqueNames(rows); len(names) > 0 {
			fmt.Fprintf(&b, "- %s: %s\n", title, strings.Join(names, ", "))
		}
	}
	list("Workspaces", v.workspaces)
	list("Projects", v.projects)
	list("Statuses", v.statuses)
	list("Stages", v.stages)
	list("Labels", v.labels)
	for i, field := range v.fields {
		if i == 20 {
			break
		}
		options := []string{}
		for _, option := range field.Options.Options {
			options = append(options, option.Value)
		}
		line := fmt.Sprintf("- Custom field %q (%s)", field.Name, field.Type)
		if len(options) > 0 {
			line += ": " + strings.Join(options, ", ")
		}
		b.WriteString(line + "\n")
	}
	if req.Client == "phone" {
		b.WriteString("\nThis is the phone app: renderMode list or kanban only.\n")
	}
	fmt.Fprintf(&b, "\n<request>\n%s\n</request>\n", req.Query)
	return []chat.WireMessage{{Role: "system", Content: viewQuerySystem}, {Role: "user", Content: b.String()}}
}

var jsonObject = regexp.MustCompile(`(?s)\{.*\}`)

// parseViewDraft reads the model's JSON, allowing a code fence or a sentence around it.
func parseViewDraft(text string) (viewQueryDraft, error) {
	var draft viewQueryDraft
	body := jsonObject.FindString(cleanWritten(text))
	if body == "" {
		return draft, errors.New("no JSON in the answer")
	}
	if err := json.Unmarshal([]byte(body), &draft); err != nil {
		return draft, err
	}
	return draft, nil
}

func matchNames(rows []vocabRow, refs []string) (ids []string, missing []string) {
	for _, ref := range refs {
		ref = strings.TrimSpace(ref)
		found := false
		for _, row := range rows {
			if row.ID == ref || strings.EqualFold(strings.TrimSpace(row.Name), ref) {
				ids = append(ids, row.ID)
				found = true
			}
		}
		if !found && ref != "" {
			missing = append(missing, ref)
		}
	}
	return ids, missing
}

func stringList(raw json.RawMessage) []string {
	var list []string
	if json.Unmarshal(raw, &list) == nil {
		return list
	}
	var one string
	if json.Unmarshal(raw, &one) == nil && one != "" {
		return []string{one}
	}
	return nil
}

func (v viewVocab) field(ref string) (vocabRow, bool) {
	ref = strings.TrimSpace(strings.TrimPrefix(ref, "cf:"))
	for _, field := range v.fields {
		if field.ID == ref || strings.EqualFold(strings.TrimSpace(field.Name), ref) {
			return field, true
		}
	}
	return vocabRow{}, false
}

// resolveRule turns names in one condition into ids; ok is false when nothing
// it names exists, and the condition is dropped.
func (v viewVocab) resolveRule(rule models.ViewRule) (models.ViewRule, string, bool) {
	if len(rule.Rules) > 0 {
		out := rule
		out.Rules = nil
		var dropped []string
		for _, inner := range rule.Rules {
			resolved, why, ok := v.resolveRule(inner)
			if !ok {
				dropped = append(dropped, why)
				continue
			}
			resolved.Rules = nil
			out.Rules = append(out.Rules, resolved)
		}
		if len(out.Rules) == 0 {
			return out, strings.Join(dropped, "; "), false
		}
		return out, strings.Join(dropped, "; "), true
	}
	pools := map[string][]vocabRow{"workspace": v.workspaces, "project": v.projects, "status": v.statuses, "stage": v.stages, "label": v.labels}
	needsValue := rule.Op == "anyOf" || rule.Op == "noneOf" || rule.Op == "allOf"
	if pool, ok := pools[rule.Field]; ok && needsValue {
		ids, missing := matchNames(pool, stringList(rule.Value))
		if len(ids) == 0 {
			return rule, fmt.Sprintf("no %s named %s", rule.Field, strings.Join(missing, ", ")), false
		}
		rule.Value, _ = json.Marshal(ids)
		return rule, "", true
	}
	if rule.Field == "priority" && needsValue {
		levels := []string{}
		for _, p := range stringList(rule.Value) {
			if level := models.NormalizePriority(p); models.ValidatePriority(level) {
				levels = append(levels, level)
			}
		}
		if len(levels) == 0 {
			return rule, "unknown priority", false
		}
		rule.Value, _ = json.Marshal(levels)
		return rule, "", true
	}
	if strings.HasPrefix(rule.Field, "cf:") {
		field, ok := v.field(rule.Field)
		if !ok {
			return rule, "no custom field " + strings.TrimPrefix(rule.Field, "cf:"), false
		}
		rule.Field = "cf:" + field.ID
		if needsValue {
			ids := []string{}
			for _, ref := range stringList(rule.Value) {
				for _, option := range field.Options.Options {
					if option.ID == ref || strings.EqualFold(strings.TrimSpace(option.Value), strings.TrimSpace(ref)) {
						ids = append(ids, option.ID)
					}
				}
			}
			if len(ids) == 0 {
				return rule, "no " + field.Name + " option " + strings.Join(stringList(rule.Value), ", "), false
			}
			rule.Value, _ = json.Marshal(ids)
		}
	}
	return rule, "", true
}

// resolveDraft maps names to ids, fixes what it can and checks the rest.
func (v viewVocab) resolveDraft(draft viewQueryDraft, phone bool) (viewQueryDraft, []string, error) {
	var dropped []string
	rules := []models.ViewRule{}
	for _, rule := range draft.Rules {
		if err := models.ValidateRules([]models.ViewRule{rule}, ""); err != nil {
			dropped = append(dropped, err.Error())
			continue
		}
		resolved, why, ok := v.resolveRule(rule)
		if why != "" {
			dropped = append(dropped, why)
		}
		if ok {
			rules = append(rules, resolved)
		}
	}
	draft.Rules = rules
	groups := []string{}
	for _, g := range draft.GroupFields {
		switch {
		case models.StaticGroupFields[g]:
			groups = append(groups, g)
		case strings.HasPrefix(g, "cf:"):
			if field, ok := v.field(g); ok {
				groups = append(groups, "cf:"+field.ID)
			}
		}
		if len(groups) == models.MaxGroupFields {
			break
		}
	}
	draft.GroupFields = groups
	sortBy := func(by string) string {
		if strings.HasPrefix(by, "cf:") {
			if field, ok := v.field(by); ok {
				return "cf:" + field.ID
			}
			return ""
		}
		if models.ValidSortBy[models.SortByField(by)] {
			return by
		}
		return ""
	}
	if draft.SortBy = sortBy(draft.SortBy); draft.SortBy == "" {
		draft.SortBy = string(models.SortByDeadline)
	}
	draft.ThenSortBy = sortBy(draft.ThenSortBy)
	direction := func(d string, fallback string) string {
		if d == "asc" || d == "desc" {
			return d
		}
		return fallback
	}
	draft.SortDirection = direction(draft.SortDirection, "asc")
	if draft.ThenSortBy == "" {
		draft.ThenSortDirection = ""
	} else {
		draft.ThenSortDirection = direction(draft.ThenSortDirection, "asc")
	}
	if draft.DataMode != "project" {
		draft.DataMode = "task"
	}
	if draft.RenderMode != "kanban" && draft.RenderMode != "gantt" {
		draft.RenderMode = "list"
	}
	if phone && (draft.RenderMode == "gantt" || draft.RenderMode == "kanban" && draft.DataMode == "project") {
		draft.RenderMode = "list"
	}
	if draft.RuleMatch != "any" {
		draft.RuleMatch = ""
	}
	if draft.Limit < 0 || draft.Limit > models.MaxViewLimit {
		draft.Limit = 0
	}
	draft.Name = strings.TrimSpace(draft.Name)
	if len(draft.Name) > models.MaxViewNameLen {
		draft.Name = strings.ToValidUTF8(draft.Name[:models.MaxViewNameLen], "")
	}
	if err := models.ValidateRules(draft.Rules, draft.RuleMatch); err != nil {
		return draft, dropped, err
	}
	return draft, dropped, nil
}

func (s *Service) viewQuery(c *echo.Context) error {
	var req viewQueryRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(400, "Invalid request")
	}
	req.Query = clipHead(strings.TrimSpace(req.Query), viewQueryMaxText)
	if req.Query == "" {
		return echo.NewHTTPError(400, "Say what the view should show")
	}
	if _, err := time.Parse("2006-01-02", req.Today); err != nil {
		req.Today = time.Now().Format("2006-01-02")
	}
	ctx := c.Request().Context()
	row, err := s.load(s.db, user(c))
	if err != nil {
		return err
	}
	provider := writeProvider(s.view(ctx, row, time.Minute))
	if provider == "" {
		return echo.NewHTTPError(409, "Reading views with AI needs an AI provider. Add a key in Settings → Agent keys")
	}
	completer, err := s.Completer(ctx, user(c), provider, "")
	if err != nil {
		return echo.NewHTTPError(409, err.Error())
	}
	vocab, err := s.loadViewVocab(ctx, user(c))
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, viewQueryBudget)
	defer cancel()
	reply, err := completer.Complete(ctx, viewQueryMessages(req, vocab), nil, false)
	if err != nil {
		return echo.NewHTTPError(502, err.Error())
	}
	draft, err := parseViewDraft(reply.Content)
	if err != nil {
		return echo.NewHTTPError(502, "The AI's answer was not a view. Try again")
	}
	draft, dropped, err := vocab.resolveDraft(draft, req.Client == "phone")
	if err != nil {
		return echo.NewHTTPError(502, "The AI's view was not valid: "+err.Error())
	}
	_, model, _ := s.resolveModel(ctx, user(c), provider)
	return c.JSON(200, viewQueryResponse{View: draft, Dropped: dropped, Provider: provider, Model: model})
}
