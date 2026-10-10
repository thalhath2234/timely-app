// Package suggest turns Jev answers (features/decide) into suggestions the
// person confirms: Clarify pre-fill for Inbox items and effort estimates for
// new Work. With suggestions off every endpoint answers {"available": false}
// and callers keep today's behaviour.
package suggest

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/features/decide"
	"timely-api/internal/features/schedule"
	"timely-api/internal/features/search"
	"timely-api/internal/models"
)

// Budget is how long a screen waits for suggestions before showing without them.
const (
	// The Clarify form stays usable while it waits, so its budget covers a
	// slow OpenRouter round trip: semantic search, then up to two Jev calls.
	screenBudget   = 10 * time.Second
	estimateBudget = 3 * time.Second
	// searchBudget caps semantic search so a slow embedding call costs only
	// its own duplicate hints; titles sharing words are still checked.
	searchBudget = 3 * time.Second
	// labelsMinLeft is the time the labels call needs; with less left the
	// form gets the rest of its suggestions without labels.
	labelsMinLeft = 1500 * time.Millisecond
	maxLabels     = 30
	maxDuplicates = 3
)

type Service struct {
	db       *gorm.DB
	decide   *decide.Service
	search   search.Service
	schedule schedule.Service                                          // nil until SetSchedule
	estimate func(context.Context, string, string, string) (int, bool) // overridable in tests
	// traitsPause holds, per user, when the Preview hook may ask again after
	// it ran out of time, so a slow model does not slow every Preview.
	traitsPause sync.Map
}

func New(db *gorm.DB, d *decide.Service, s search.Service) *Service {
	svc := &Service{db: db, decide: d, search: s}
	svc.estimate = svc.estimateMinutes
	return svc
}

func (s *Service) Routes(g *echo.Group) {
	g.GET("/inbox/:id/suggestions", s.clarify)
	g.GET("/decisions/status", s.status)
	s.sheetRoutes(g)
	s.workRoutes(g)
	s.projectRoutes(g)
	s.taxonomyRoutes(g)
	s.docRoutes(g)
	s.todayRoutes(g)
	s.highlightRoutes(g)
}

func user(c *echo.Context) string { v, _ := c.Get("userID").(string); return v }

func (s *Service) status(c *echo.Context) error {
	ok, provider := s.decide.Status(c.Request().Context(), user(c))
	return c.JSON(200, map[string]any{"available": ok, "provider": provider})
}

// Effort buckets, lowest first. Jev picks a bucket in words (it is weak with
// numbers); code maps it to minutes the person can still edit.
var effortLevels = []string{
	"A few minutes: a quick call, message or errand",
	"Under an hour: a short focused task",
	"About an hour",
	"A couple of hours",
	"Half a day",
	"A full day or more",
}

var effortMinutes = []int{15, 30, 60, 120, 240, 480}

func effortQuestion() decide.Question {
	return decide.Score("How much focused effort does finishing this take?", effortLevels...)
}

// Estimate is the agent's default length for new Work with no estimate. It
// returns false when Jev is off or unsure; the caller then keeps 30 minutes.
func (s *Service) Estimate(ctx context.Context, userID, name, description string) (int, bool) {
	return s.estimate(ctx, userID, name, description)
}

func (s *Service) estimateMinutes(ctx context.Context, userID, name, description string) (int, bool) {
	ctx, cancel := context.WithTimeout(ctx, estimateBudget)
	defer cancel()
	state := map[string]string{"title": clip(name, 300)}
	if d := strings.TrimSpace(description); d != "" {
		state["description"] = clip(d, 2000)
	}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "estimate", State: state,
		Questions: map[string]decide.Question{"effort": effortQuestion()}})
	if err != nil {
		return 0, false
	}
	level, ok := a.Level("effort", decide.Prefill)
	if !ok {
		return 0, false
	}
	return effortMinutes[level], true
}

// failure turns a failed Ask into a short line for the form, or "" when
// suggestions were simply off.
func failure(ctx context.Context, err error) string {
	switch {
	case err == decide.ErrOff: // plain ErrOff: off, no key or busy
		return ""
	case ctx.Err() != nil || errors.Is(err, context.DeadlineExceeded):
		return "Smart suggestions took too long to answer."
	}
	msg := err.Error()
	if i := strings.LastIndex(msg, "\n"); i >= 0 {
		msg = msg[i+1:] // errors.Join: the last provider tried
	}
	return "Smart suggestions could not run: " + msg
}

func clip(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

// ClarifySuggestions is what the Clarify form may pre-fill. Every field is
// optional: a missing field means Jev was off or not confident enough.
type ClarifySuggestions struct {
	Available bool   `json:"available"`
	LogID     string `json:"logId,omitempty"`
	// Error says why suggestions are on but could not run (a refused key,
	// a timeout), so the form can say so instead of looking unchanged.
	Error string `json:"error,omitempty"`

	Kind           string   `json:"kind,omitempty"` // task or reminder
	LooksLikeEvent bool     `json:"looksLikeEvent,omitempty"`
	WorkspaceID    string   `json:"workspaceId,omitempty"`
	ProjectID      string   `json:"projectId,omitempty"`
	Priority       string   `json:"priority,omitempty"`
	LabelIDs       []string `json:"labelIds,omitempty"`
	Duration       int      `json:"duration,omitempty"`

	// DateRole says what a date or time in the title is for, so the form can
	// point at the right field; Timely never reads the date itself here.
	DateRole       string      `json:"dateRole,omitempty"` // deadline, start, reminder
	SeveralActions bool        `json:"severalActions,omitempty"`
	NotReady       bool        `json:"notReady,omitempty"`
	Missing        string      `json:"missing,omitempty"` // duration, place, date, scope
	Duplicates     []Duplicate `json:"duplicates,omitempty"`
}

type Duplicate struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (s *Service) clarify(c *echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), screenBudget)
	defer cancel()
	out, err := s.Clarify(ctx, user(c), c.Param("id"))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(404, "Inbox item not found")
	}
	if err != nil {
		return err
	}
	return c.JSON(200, out)
}

type namedProject struct {
	ID          string
	Title       string
	WorkspaceID string
	Workspace   string
}

// Clarify asks Jev about one Inbox item.
func (s *Service) Clarify(ctx context.Context, userID, inboxID string) (ClarifySuggestions, error) {
	var item models.Task
	if err := s.db.WithContext(ctx).Where("id = ? AND user_id = ? AND kind = ?", inboxID, userID, models.KindInbox).First(&item).Error; err != nil {
		return ClarifySuggestions{}, err
	}
	if ok, _ := s.decide.Status(ctx, userID); !ok {
		return ClarifySuggestions{}, nil
	}
	var workspaces []models.Workspace
	if err := s.db.WithContext(ctx).Where("user_id = ?", userID).Order("created_at").Find(&workspaces).Error; err != nil {
		return ClarifySuggestions{}, err
	}
	var projects []namedProject
	if err := s.db.WithContext(ctx).Table("projects p").Select("p.id, p.title, p.workspace_id, w.name AS workspace").
		Joins("JOIN workspaces w ON w.id = p.workspace_id").Where("w.user_id = ? AND p.completed_at IS NULL", userID).
		Order("p.updated_at DESC").Limit(200).Scan(&projects).Error; err != nil {
		return ClarifySuggestions{}, err
	}

	state := map[string]any{"thought": clip(item.Name, 500)}
	if d := strings.TrimSpace(item.Description); d != "" {
		state["details"] = clip(d, 2000)
	}
	questions := map[string]decide.Question{
		"kind": decide.Choice("What kind of item is this captured thought?",
			decide.Option{Name: "work", Description: "Something the person has to spend effort doing, such as writing, fixing, buying or preparing something."},
			decide.Option{Name: "reminder", Description: "Only a timed nudge to remember something at a moment, with no real effort to plan for."},
			decide.Option{Name: "event", Description: "A meeting, appointment or other commitment at a set time with other people or a place."}).Twice(),
		"effort":   effortQuestion(),
		"priority": decide.Score("How urgent and important does this sound?", "Low: whenever there is time", "Medium: should happen soon", "High: important and time-sensitive", "Urgent: needs attention right away"),
		"dateRole": decide.Choice("Does the thought mention a date or time, and if so what is it for?",
			decide.Option{Name: "none", Description: "No date or time is mentioned."},
			decide.Option{Name: "deadline", Description: "The date by which it must be finished."},
			decide.Option{Name: "start", Description: "The date work can or should start."},
			decide.Option{Name: "reminder", Description: "The moment the person wants to be reminded."}),
		"several": decide.YesNo("Does the thought describe two or more separate actions that would each be done on their own?",
			"It contains two or more separate actions, for example 'buy supplies and book the venue'.", "It is one action."),
		"ready": decide.YesNo("Is the thought clear enough to act on now?",
			"It says clearly what has to be done.", "It is too vague to act on and needs more thinking first."),
		"missing": decide.Choice("Which detail is most clearly missing before this can be planned?",
			decide.Option{Name: "nothing", Description: "Nothing important is missing."},
			decide.Option{Name: "duration", Description: "How long it will take is unclear."},
			decide.Option{Name: "place", Description: "Where it happens, or where something should go, is unclear."},
			decide.Option{Name: "date", Description: "When it is needed or due is unclear."},
			decide.Option{Name: "scope", Description: "What exactly has to be done, or when it counts as done, is unclear."}),
	}

	wsByName := map[string]string{}
	if len(workspaces) > 1 {
		opts := make([]decide.Option, 0, len(workspaces))
		for _, w := range workspaces {
			name := uniqueName(w.Name, wsByName)
			wsByName[name] = w.ID
			opts = append(opts, decide.Option{Name: name})
		}
		questions["workspace"] = decide.Choice("Which of the person's workspaces does this belong in?", opts...).Twice()
	}
	projByName := map[string]namedProject{}
	if len(projects) > 0 {
		opts := []decide.Option{{Name: "none", Description: "It does not belong to any of these projects."}}
		for _, p := range projects {
			label := p.Title
			if len(workspaces) > 1 {
				label = fmt.Sprintf("%s (%s)", p.Title, p.Workspace)
			}
			label = uniqueName(label, nil)
			if _, taken := projByName[label]; taken {
				continue
			}
			projByName[label] = p
			opts = append(opts, decide.Option{Name: label})
		}
		questions["project"] = decide.Choice("Which existing project does this thought belong to, if any?", opts...).Twice()
	}

	dups := s.candidates(ctx, userID, item)
	if len(dups) > 0 {
		existing := make([]map[string]string, len(dups))
		for i, d := range dups {
			existing[i] = map[string]string{"number": fmt.Sprint(i + 1), "name": clip(d.Name, 300)}
			questions[fmt.Sprintf("dup%d", i+1)] = decide.YesNo(fmt.Sprintf("Is the thought the same piece of work as existing item number %d?", i+1),
				"They describe the same piece of work, so doing one would finish the other.", "They are different pieces of work, even if related.")
		}
		state["existingItems"] = existing
	}

	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "clarify", State: state, Questions: questions})
	if err != nil {
		// Off or busy: no suggestions. A failed call: no suggestions, and why.
		return ClarifySuggestions{Error: failure(ctx, err)}, nil
	}
	out := ClarifySuggestions{Available: true, LogID: a.LogID}
	// Work is the form's default, so only a sure answer on a clear thought
	// switches it: a vague one like "test" reads as "no effort" to Jev.
	if yes, ok := a.Yes("ready", decide.Flag); ok && !yes {
		out.NotReady = true
	}
	if k, ok := a.Choice("kind", decide.Route); ok && !out.NotReady {
		switch k {
		case "work":
			out.Kind = models.KindTask
		case "reminder":
			out.Kind = models.KindReminder
		case "event":
			out.LooksLikeEvent = true
		}
	}
	if out.Kind == models.KindTask {
		if level, ok := a.Level("effort", decide.Prefill); ok {
			out.Duration = effortMinutes[level]
		}
	}
	if level, ok := a.Level("priority", decide.Prefill); ok {
		out.Priority = []string{models.PriorityLow, models.PriorityMedium, models.PriorityHigh, models.PriorityUrgent}[level]
	}
	if len(workspaces) == 1 {
		out.WorkspaceID = workspaces[0].ID
	} else if name, ok := a.Choice("workspace", decide.Prefill); ok {
		out.WorkspaceID = wsByName[name]
	}
	// A project named in the title is a plain fact, so it wins over Jev,
	// which can be unsure between "none" and a project it was never told about.
	if p, ok := namedIn(item.Name, projects); ok {
		out.ProjectID = p.ID
		out.WorkspaceID = p.WorkspaceID
	} else if name, ok := a.Choice("project", decide.Prefill); ok && name != "none" {
		if p, found := projByName[name]; found {
			out.ProjectID = p.ID
			out.WorkspaceID = p.WorkspaceID // a project decides its workspace
		}
	}
	if role, ok := a.Choice("dateRole", decide.Prefill); ok && role != "none" {
		out.DateRole = role
	}
	if yes, ok := a.Yes("several", decide.Flag); ok && yes {
		out.SeveralActions = true
	}
	// A date already in the name rules out "it may need a date".
	if m, ok := a.Choice("missing", decide.Prefill); ok && m != "nothing" && !(m == "date" && out.DateRole != "") {
		out.Missing = m
	}
	for i, d := range dups {
		if yes, ok := a.Yes(fmt.Sprintf("dup%d", i+1), decide.Route); ok && yes {
			out.Duplicates = append(out.Duplicates, d)
		}
	}
	if out.WorkspaceID != "" {
		if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) > labelsMinLeft {
			out.LabelIDs = s.labels(ctx, userID, out.WorkspaceID, state)
		}
	}
	return out, nil
}

// candidates finds existing open Work and Reminders that read like the item.
// Titles that share words come first: they need no embedding call, so they
// are found even when semantic search is slow, off, or has not indexed a new
// task yet. Semantic hits fill the rest.
func (s *Service) candidates(ctx context.Context, userID string, item models.Task) []Duplicate {
	ids := s.sharedWords(ctx, userID, item)
	if s.search != nil {
		sctx, cancel := context.WithTimeout(ctx, searchBudget)
		hits, _ := s.search.SemanticSearch(sctx, userID, item.Name, 8, []string{"task"})
		cancel()
		for _, h := range hits {
			ids = append(ids, h.ID)
		}
	}
	seen := map[string]bool{item.ID: true}
	unique := ids[:0]
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	ids = unique
	if len(ids) == 0 {
		return nil
	}
	var open []models.Task
	if s.db.WithContext(ctx).Select("id", "name").Where("id IN ? AND user_id = ? AND kind <> ? AND completed_at IS NULL", ids, userID, models.KindInbox).
		Find(&open).Error != nil {
		return nil
	}
	byID := map[string]string{}
	for _, t := range open {
		byID[t.ID] = t.Name
	}
	out := []Duplicate{}
	for _, id := range ids { // keep search order
		if name, ok := byID[id]; ok {
			out = append(out, Duplicate{ID: id, Name: name})
			if len(out) == maxDuplicates {
				break
			}
		}
	}
	return out
}

// sharedWords returns open tasks whose titles share at least two of the
// item's words (or its only word), most shared first.
func (s *Service) sharedWords(ctx context.Context, userID string, item models.Task) []string {
	words := titleWords(item.Name)
	if len(words) == 0 {
		return nil
	}
	need := min(2, len(words))
	conds := make([]string, len(words))
	args := []any{userID, models.KindInbox, item.ID}
	for i, w := range words {
		conds[i] = "name ILIKE ?"
		args = append(args, "%"+w+"%")
	}
	var rows []models.Task
	if s.db.WithContext(ctx).Select("id", "name").
		Where("user_id = ? AND kind <> ? AND completed_at IS NULL AND id <> ?", args[:3]...).
		Where("("+strings.Join(conds, " OR ")+")", args[3:]...).
		Order("updated_at DESC").Limit(50).Find(&rows).Error != nil {
		return nil
	}
	type scored struct {
		id     string
		shared int
	}
	var matches []scored
	for _, r := range rows {
		have := map[string]bool{}
		for _, w := range titleWords(r.Name) {
			have[w] = true
		}
		n := 0
		for _, w := range words {
			if have[w] {
				n++
			}
		}
		if n >= need {
			matches = append(matches, scored{r.ID, n})
		}
	}
	sort.SliceStable(matches, func(i, j int) bool { return matches[i].shared > matches[j].shared })
	ids := make([]string, 0, maxDuplicates)
	for _, m := range matches {
		if len(ids) == maxDuplicates {
			break
		}
		ids = append(ids, m.id)
	}
	return ids
}

// namedIn finds the one project whose whole title appears in the item's
// title as words ("audit Timely" names "Timely", "Timelyish" does not). When
// several do, the longest title wins; a tie names none.
func namedIn(title string, projects []namedProject) (namedProject, bool) {
	words := " " + strings.Join(splitWords(title), " ") + " "
	var best namedProject
	bestLen, tie := 0, false
	for _, p := range projects {
		name := strings.Join(splitWords(p.Title), " ")
		if name == "" || !strings.Contains(words, " "+name+" ") {
			continue
		}
		switch n := len(name); {
		case n > bestLen:
			best, bestLen, tie = p, n, false
		case n == bestLen && p.ID != best.ID:
			tie = true
		}
	}
	return best, bestLen > 0 && !tie
}

func splitWords(s string) []string {
	return strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
}

// titleWords is the lower-cased words of a title that say something: three
// or more letters, minus the most common filler words.
func titleWords(title string) []string {
	var out []string
	seen := map[string]bool{}
	for _, w := range splitWords(title) {
		if len([]rune(w)) < 3 || fillerWords[w] || seen[w] {
			continue
		}
		seen[w] = true
		out = append(out, w)
	}
	return out
}

var fillerWords = map[string]bool{
	"the": true, "and": true, "for": true, "with": true, "from": true, "into": true, "about": true,
	"this": true, "that": true, "you": true, "your": true, "our": true, "are": true, "was": true,
	"has": true, "have": true, "will": true, "can": true, "not": true, "all": true, "any": true,
	"get": true, "out": true, "off": true, "new": true,
}

// labels asks one yes/no per label of the chosen workspace. Jev has no
// multi-select, so this is a second, small call.
func (s *Service) labels(ctx context.Context, userID, workspaceID string, state map[string]any) []string {
	var labels []models.Lable
	if s.db.WithContext(ctx).Where("workspace_id = ?", workspaceID).Order("name").Limit(maxLabels+1).Find(&labels).Error != nil ||
		len(labels) == 0 || len(labels) > maxLabels {
		return nil
	}
	questions := map[string]decide.Question{}
	for i, l := range labels {
		questions[fmt.Sprintf("label%d", i)] = decide.YesNo(fmt.Sprintf("Does the label %q fit this thought?", l.Name),
			"The label clearly applies.", "The label does not apply, or it is unclear.")
	}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "clarify.labels", State: state, Questions: questions})
	if err != nil {
		return nil
	}
	var out []string
	for i, l := range labels {
		if yes, ok := a.Yes(fmt.Sprintf("label%d", i), decide.Route); ok && yes {
			out = append(out, l.ID)
		}
	}
	return out
}

// uniqueName returns name, or name with a number when it is already taken.
func uniqueName(name string, taken map[string]string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Untitled"
	}
	if taken == nil {
		return name
	}
	base := name
	for n := 2; ; n++ {
		if _, ok := taken[name]; !ok {
			return name
		}
		name = fmt.Sprintf("%s %d", base, n)
	}
}
