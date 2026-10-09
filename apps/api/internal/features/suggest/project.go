package suggest

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/features/decide"
	"timely-api/internal/models"
)

// Project insights: Work that looks filed in the wrong project, projects that
// overlap, a brief with no clear outcome or next action, requirements no task
// covers, and how the project is going. Counts and dates are worked out here;
// Jev only reads words and these facts.

const (
	projectBudget    = 8 * time.Second
	maxProjectTasks  = 15
	maxRequirements  = 8
	maxOverlap       = 5
	maxMisfiled      = 3
	maxMoveTargets   = 30
	recentDays       = 14
	projectStaleDays = 21
)

func (s *Service) projectRoutes(g *echo.Group) {
	g.GET("/suggestions/project/:id", s.projectInsights)
	g.GET("/suggestions/project-template", s.projectTemplate)
}

// ProjectFacts are counted in code and shown as they are.
type ProjectFacts struct {
	Open       int `json:"open"`
	Done       int `json:"done"`
	DoneRecent int `json:"doneRecent"` // completed in the last two weeks
	Overdue    int `json:"overdue"`
	Blocked    int `json:"blocked"` // open tasks waiting on an open task
	IdleDays   int `json:"idleDays"`
	// DaysLeft is set when the project has a deadline; negative when past.
	DaysLeft *int `json:"daysLeft,omitempty"`
}

// Misfiled is a task that may belong to another project.
type Misfiled struct {
	TaskID string `json:"taskId"`
	Name   string `json:"name"`
	// MoveTo is a better project when Jev found one; empty means "may not
	// belong here" only.
	MoveTo      string `json:"moveTo,omitempty"`
	MoveToTitle string `json:"moveToTitle,omitempty"`
	// StageID is the task's stage here, so undoing a move can put it back.
	StageID string `json:"stageId,omitempty"`
}

type ProjectRef struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type ProjectInsights struct {
	Available bool         `json:"available"`
	LogID     string       `json:"logId,omitempty"`
	Facts     ProjectFacts `json:"facts"`

	// Health: progressing, stalled or blocked; empty when unsure.
	Health       string       `json:"health,omitempty"`
	NoBrief      bool         `json:"noBrief,omitempty"`
	NoOutcome    bool         `json:"noOutcome,omitempty"`
	NoNextAction bool         `json:"noNextAction,omitempty"`
	Uncovered    []string     `json:"uncovered,omitempty"`
	Misfiled     []Misfiled   `json:"misfiled,omitempty"`
	Overlaps     []ProjectRef `json:"overlaps,omitempty"`
}

func (s *Service) projectInsights(c *echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), projectBudget)
	defer cancel()
	out, err := s.ProjectInsights(ctx, user(c), c.Param("id"), time.Now())
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(404, "Project not found")
	}
	if err != nil {
		return err
	}
	return c.JSON(200, out)
}

func (s *Service) ownProject(ctx context.Context, userID, projectID string) (models.Project, error) {
	var p models.Project
	err := s.db.WithContext(ctx).Table("projects").Select("projects.*").
		Joins("JOIN workspaces ON workspaces.id = projects.workspace_id").
		Where("projects.id = ? AND workspaces.user_id = ?", projectID, userID).First(&p).Error
	return p, err
}

// ProjectInsights reads one project. Facts come back even with Jev off.
func (s *Service) ProjectInsights(ctx context.Context, userID, projectID string, now time.Time) (ProjectInsights, error) {
	project, err := s.ownProject(ctx, userID, projectID)
	if err != nil {
		return ProjectInsights{}, err
	}
	var tasks []models.Task
	if err := s.db.WithContext(ctx).Select("id", "name", "description", "completed_at", "deadline", "blocked_by_id", "stage_id", "created_at", "updated_at").
		Where("project_id = ? AND user_id = ? AND kind = ?", project.ID, userID, models.KindTask).
		Order("created_at").Find(&tasks).Error; err != nil {
		return ProjectInsights{}, err
	}
	on, _ := s.decide.Status(ctx, userID)
	out := ProjectInsights{Available: on, Facts: s.projectFacts(ctx, project, tasks, now)}
	brief := strings.TrimSpace(project.Description)
	out.NoBrief = brief == ""
	out.NoNextAction = out.Facts.Open == 0 && project.CompletedAt == nil
	if !on || project.CompletedAt != nil {
		return out, nil
	}

	open := []models.Task{}
	done := []models.Task{}
	for _, t := range tasks {
		if t.CompletedAt != nil && *t.CompletedAt != "" {
			done = append(done, t)
		} else {
			open = append(open, t)
		}
	}
	// The newest open tasks and a few recent done ones are what Jev reads.
	shown := open
	if len(shown) > maxProjectTasks {
		shown = shown[len(shown)-maxProjectTasks:]
	}
	state := map[string]any{"project": clip(project.Title, 200), "facts": out.Facts}
	if brief != "" {
		state["brief"] = clip(brief, 2000)
	}
	list := []map[string]any{}
	for i, t := range shown {
		item := map[string]any{"task": fmt.Sprintf("t%d", i+1), "title": clip(t.Name, 160)}
		if d := strings.TrimSpace(t.Description); d != "" {
			item["description"] = clip(d, 200)
		}
		list = append(list, item)
	}
	state["openTasks"] = list
	doneTitles := []string{}
	for i := len(done) - 1; i >= 0 && len(doneTitles) < 10; i-- {
		doneTitles = append(doneTitles, clip(done[i].Name, 120))
	}
	if len(doneTitles) > 0 {
		state["doneTasks"] = doneTitles
	}

	questions := map[string]decide.Question{}
	// Health [25].
	if len(tasks) > 0 {
		questions["health"] = decide.Choice("From the facts and the tasks, how is this project going?",
			decide.Option{Name: "progressing", Description: "Work is getting done and nothing big stands in the way"},
			decide.Option{Name: "stalled", Description: "Little or nothing has moved for a while"},
			decide.Option{Name: "blocked", Description: "It is held up by tasks waiting on others, overdue work, or a missed deadline"})
	}
	// Outcome and next action [23].
	if brief != "" {
		questions["outcome"] = decide.YesNo("Do the project's title and brief say what result means the project is finished?",
			"Yes, the finished result is clear.", "No, it is vague what done looks like.")
	}
	if len(shown) > 0 {
		questions["next"] = decide.YesNo("Is at least one of the open tasks a concrete next step someone could start right now?",
			"Yes, there is a clear next step.", "No, the open tasks are vague or all waiting.")
	}
	// Coverage [24]: requirements are the brief's list items.
	reqs := requirements(project)
	if len(reqs) > 0 {
		state["requirements"] = reqs
		for i := range reqs {
			questions[fmt.Sprintf("req%d", i+1)] = decide.YesNo(
				fmt.Sprintf("Is requirement number %d covered by one of the open or done tasks?", i+1),
				"Yes, a task covers it.", "No, no task covers it.")
		}
	}
	// Misfiled [21].
	for i := range shown {
		questions[fmt.Sprintf("fit%d", i+1)] = decide.YesNo(
			fmt.Sprintf("Does task t%d belong in this project?", i+1),
			"Yes, it is part of this project.", "No, it is about something else.")
	}
	// Overlaps [22].
	overlaps := s.overlapCandidates(ctx, userID, project)
	if len(overlaps) > 0 {
		others := []map[string]any{}
		for i, p := range overlaps {
			others = append(others, map[string]any{"project": fmt.Sprintf("p%d", i+1), "title": clip(p.Title, 160)})
			questions[fmt.Sprintf("overlap%d", i+1)] = decide.YesNo(
				fmt.Sprintf("Is project p%d about the same goal as this project, so the two overlap?", i+1),
				"Yes, they overlap.", "No, they are separate.")
		}
		state["otherProjects"] = others
	}
	if len(questions) == 0 {
		return out, nil
	}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "project_insights", State: state, Questions: questions})
	if err != nil {
		return out, nil
	}
	out.LogID = a.LogID
	if v, ok := a.Choice("health", decide.Prefill); ok {
		out.Health = v
	}
	if yes, ok := a.Yes("outcome", decide.Flag); ok && !yes {
		out.NoOutcome = true
	}
	if yes, ok := a.Yes("next", decide.Flag); ok && !yes {
		out.NoNextAction = true
	}
	for i, r := range reqs {
		if yes, ok := a.Yes(fmt.Sprintf("req%d", i+1), decide.Flag); ok && !yes {
			out.Uncovered = append(out.Uncovered, r)
		}
	}
	for i, t := range shown {
		if len(out.Misfiled) == maxMisfiled {
			break
		}
		if yes, ok := a.Yes(fmt.Sprintf("fit%d", i+1), decide.Route); ok && !yes {
			m := Misfiled{TaskID: t.ID, Name: t.Name}
			if t.StageID != nil {
				m.StageID = *t.StageID
			}
			out.Misfiled = append(out.Misfiled, m)
		}
	}
	for i, p := range overlaps {
		if yes, ok := a.Yes(fmt.Sprintf("overlap%d", i+1), decide.Prefill); ok && yes {
			out.Overlaps = append(out.Overlaps, ProjectRef{ID: p.ID, Title: p.Title})
		}
	}
	if len(out.Misfiled) > 0 {
		s.moveTargets(ctx, userID, project, out.Misfiled, shown)
	}
	return out, nil
}

// projectFacts counts what Jev and the page both read.
func (s *Service) projectFacts(ctx context.Context, project models.Project, tasks []models.Task, now time.Time) ProjectFacts {
	f := ProjectFacts{}
	today := now.UTC().Format("2006-01-02")
	openIDs := map[string]bool{}
	for _, t := range tasks {
		if t.CompletedAt == nil || *t.CompletedAt == "" {
			openIDs[t.ID] = true
		}
	}
	latest := parseWhen(project.UpdatedAt)
	if c := parseWhen(project.CreatedAt); c.After(latest) {
		latest = c
	}
	ids := make([]string, 0, len(tasks))
	for _, t := range tasks {
		ids = append(ids, t.ID)
		for _, v := range []string{t.UpdatedAt, t.CreatedAt} {
			if w := parseWhen(v); w.After(latest) {
				latest = w
			}
		}
		if !openIDs[t.ID] {
			f.Done++
			if w := parseWhen(*t.CompletedAt); !w.IsZero() && now.Sub(w) <= recentDays*24*time.Hour {
				f.DoneRecent++
			}
			if w := parseWhen(*t.CompletedAt); w.After(latest) {
				latest = w
			}
			continue
		}
		f.Open++
		if t.Deadline != nil && *t.Deadline != "" && dateOnly(*t.Deadline) < today {
			f.Overdue++
		}
		if t.BlockedByID != nil && openIDs[*t.BlockedByID] {
			f.Blocked++
		} else if t.BlockedByID != nil && *t.BlockedByID != "" {
			// A blocker in another project counts while it is open.
			var n int64
			s.db.WithContext(ctx).Model(&models.Task{}).Where("id = ? AND completed_at IS NULL", *t.BlockedByID).Count(&n)
			if n > 0 {
				f.Blocked++
			}
		}
	}
	if len(ids) > 0 {
		var at string
		s.db.WithContext(ctx).Table("task_activities").Select("MAX(created_at)").Where("task_id IN ?", ids).Scan(&at)
		if w := parseWhen(at); w.After(latest) {
			latest = w
		}
	}
	if !latest.IsZero() {
		f.IdleDays = max(0, int(now.Sub(latest).Hours()/24))
	}
	if project.Deadline != nil && *project.Deadline != "" {
		if d, err := time.Parse("2006-01-02", dateOnly(*project.Deadline)); err == nil {
			left := int(d.Sub(time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)).Hours() / 24)
			f.DaysLeft = &left
		}
	}
	return f
}

// overlapCandidates are the user's other open projects nearest this one.
func (s *Service) overlapCandidates(ctx context.Context, userID string, project models.Project) []ProjectRef {
	if s.search == nil {
		return nil
	}
	query := project.Title
	if d := strings.TrimSpace(project.Description); d != "" {
		query += "\n" + clip(d, 300)
	}
	sctx, cancel := context.WithTimeout(ctx, searchBudget)
	hits, _ := s.search.SemanticSearch(sctx, userID, query, maxOverlap+3, []string{"project"})
	cancel()
	ids := []string{}
	for _, h := range hits {
		if h.ID != project.ID {
			ids = append(ids, h.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	var rows []models.Project
	s.db.WithContext(ctx).Table("projects").Select("projects.id", "projects.title").
		Joins("JOIN workspaces ON workspaces.id = projects.workspace_id").
		Where("projects.id IN ? AND workspaces.user_id = ? AND projects.completed_at IS NULL", ids, userID).Find(&rows)
	byID := map[string]string{}
	for _, r := range rows {
		byID[r.ID] = r.Title
	}
	out := []ProjectRef{}
	for _, id := range ids {
		if title, ok := byID[id]; ok {
			out = append(out, ProjectRef{ID: id, Title: title})
			if len(out) == maxOverlap {
				break
			}
		}
	}
	return out
}

// moveTargets asks, for each misfiled task, which of the person's other open
// projects in the same workspace it belongs to.
func (s *Service) moveTargets(ctx context.Context, userID string, project models.Project, misfiled []Misfiled, shown []models.Task) {
	var projects []models.Project
	s.db.WithContext(ctx).Select("id", "title", "description").
		Where("workspace_id = ? AND id <> ? AND completed_at IS NULL", project.WorkspaceID, project.ID).
		Order("updated_at DESC").Limit(maxMoveTargets).Find(&projects)
	if len(projects) == 0 {
		return
	}
	byName := map[string]string{}
	titles := map[string]string{}
	opts := []decide.Option{{Name: "none", Description: "None of these projects fits"}}
	for _, p := range projects {
		name := uniqueName(p.Title, byName)
		byName[name] = p.ID
		titles[p.ID] = p.Title
		desc := fmt.Sprintf("The project “%s”", clip(p.Title, 80))
		if d := strings.TrimSpace(p.Description); d != "" {
			desc += ": " + clip(d, 160)
		}
		opts = append(opts, decide.Option{Name: name, Description: desc})
	}
	descs := map[string]string{}
	for _, t := range shown {
		descs[t.ID] = strings.TrimSpace(t.Description)
	}
	list := []map[string]any{}
	questions := map[string]decide.Question{}
	for i, m := range misfiled {
		item := map[string]any{"task": fmt.Sprintf("t%d", i+1), "title": clip(m.Name, 160)}
		if d := descs[m.TaskID]; d != "" {
			item["description"] = clip(d, 300)
		}
		list = append(list, item)
		questions[fmt.Sprintf("move%d", i+1)] = decide.Choice(fmt.Sprintf("Which project does task t%d belong in?", i+1), opts...)
	}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "project_move", State: map[string]any{"tasks": list}, Questions: questions})
	if err != nil {
		return
	}
	for i := range misfiled {
		if name, ok := a.Choice(fmt.Sprintf("move%d", i+1), decide.Prefill); ok && name != "none" && byName[name] != "" {
			misfiled[i].MoveTo = byName[name]
			misfiled[i].MoveToTitle = titles[byName[name]]
		}
	}
}

var listLine = regexp.MustCompile(`^\s*(?:[-*•+]|\d+[.)]|\[[ xX]\])\s+(?:\[[ xX]\]\s+)?(.+)$`)

// requirements are the brief's list items: from the editor document when
// there is one, else Markdown-style lines in the plain text. The overview's
// plain text box edits only the plain text, so an editor item counts only
// while the plain text still has it.
func requirements(p models.Project) []string {
	out := []string{}
	plain := strings.Join(strings.Fields(p.Description), " ")
	add := func(text string) {
		text = strings.Join(strings.Fields(text), " ")
		if len([]rune(text)) >= 3 && len(out) < maxRequirements {
			out = append(out, clip(text, 160))
		}
	}
	addRich := func(text string) {
		if t := strings.Join(strings.Fields(text), " "); t != "" && strings.Contains(plain, t) {
			add(t)
		}
	}
	if len(p.DescriptionRich) > 0 {
		var walk func(node map[string]any)
		walk = func(node map[string]any) {
			kind, _ := node["type"].(string)
			children, _ := node["content"].([]any)
			if kind == "listItem" || kind == "taskItem" {
				// Only the item's own paragraphs; nested lists are their own items.
				var b strings.Builder
				for _, c := range children {
					if m, ok := c.(map[string]any); ok && m["type"] == "paragraph" {
						b.WriteString(nodeText(m))
						b.WriteString(" ")
					}
				}
				addRich(b.String())
			}
			for _, c := range children {
				if m, ok := c.(map[string]any); ok {
					walk(m)
				}
			}
		}
		walk(p.DescriptionRich)
		if len(out) > 0 {
			return out
		}
	}
	for _, line := range strings.Split(p.Description, "\n") {
		if m := listLine.FindStringSubmatch(line); m != nil {
			add(m[1])
		}
	}
	return out
}

func nodeText(node map[string]any) string {
	if t, ok := node["text"].(string); ok {
		return t
	}
	var b strings.Builder
	children, _ := node["content"].([]any)
	for _, c := range children {
		if m, ok := c.(map[string]any); ok {
			b.WriteString(nodeText(m))
		}
	}
	return b.String()
}

func dateOnly(v string) string {
	if len(v) >= 10 {
		return v[:10]
	}
	return v
}

// ProjectStart is what a new project could start from [27]: a copy of an
// earlier project's stages and tasks, a doc template, a sheet template.
type ProjectStart struct {
	Available       bool   `json:"available"`
	LogID           string `json:"logId,omitempty"`
	CopyProjectID   string `json:"copyProjectId,omitempty"`
	CopyTitle       string `json:"copyTitle,omitempty"`
	DocTemplateID   string `json:"docTemplateId,omitempty"`
	DocTitle        string `json:"docTitle,omitempty"`
	SheetTemplateID string `json:"sheetTemplateId,omitempty"`
	SheetTitle      string `json:"sheetTitle,omitempty"`
}

const maxStartOptions = 25

func (s *Service) projectTemplate(c *echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), sheetBudget)
	defer cancel()
	out, err := s.ProjectStart(ctx, user(c), c.QueryParam("title"), c.QueryParam("workspaceId"))
	if err != nil {
		return err
	}
	return c.JSON(200, out)
}

// ProjectStart asks which earlier project, doc template and sheet template a
// new project with this title would reuse, each one or none.
func (s *Service) ProjectStart(ctx context.Context, userID, title, workspaceID string) (ProjectStart, error) {
	on, _ := s.decide.Status(ctx, userID)
	out := ProjectStart{Available: on}
	title = strings.TrimSpace(title)
	if !on || len([]rune(title)) < 3 || workspaceID == "" {
		return out, nil
	}
	db := s.db.WithContext(ctx)
	// Earlier projects worth copying: in this workspace, with stages or tasks.
	var projects []models.Project
	if err := db.Table("projects").Select("projects.id", "projects.title", "projects.description").
		Joins("JOIN workspaces ON workspaces.id = projects.workspace_id").
		Where("projects.workspace_id = ? AND workspaces.user_id = ?", workspaceID, userID).
		Where("(EXISTS (SELECT 1 FROM stages WHERE stages.project_id = projects.id) OR (SELECT count(*) FROM tasks WHERE tasks.project_id = projects.id) >= 2)").
		Order("projects.updated_at DESC").Limit(maxStartOptions).Find(&projects).Error; err != nil {
		return out, err
	}
	var docs []models.Document
	db.Select("id", "title", "plain_text").Where("user_id = ? AND is_template AND archived_at IS NULL", userID).
		Order("updated_at DESC").Limit(maxStartOptions).Find(&docs)
	var sheets []models.SheetTemplate
	db.Where("user_id = ?", userID).Order("updated_at DESC").Limit(maxStartOptions).Find(&sheets)

	questions := map[string]decide.Question{}
	if len(projects) > 0 {
		opts := []decide.Option{{Name: "none", Description: "Start empty; none of these earlier projects is the same kind of project"}}
		for i, p := range projects {
			desc := fmt.Sprintf("Copy the stages and tasks of the earlier project “%s”", clip(p.Title, 80))
			if d := strings.TrimSpace(p.Description); d != "" {
				desc += ": " + clip(d, 160)
			}
			opts = append(opts, decide.Option{Name: fmt.Sprintf("p%d", i+1), Description: desc})
		}
		questions["copy"] = decide.Choice("The person is creating a new project with this title. Is it the same kind of project as one they did before, so it should start as a copy of it?", opts...)
	}
	if len(docs) > 0 {
		opts := []decide.Option{{Name: "none", Description: "No doc template fits this project"}}
		for i, d := range docs {
			desc := fmt.Sprintf("Doc template “%s”", clip(d.Title, 80))
			if t := strings.TrimSpace(d.PlainText); t != "" {
				desc += ": " + clip(t, 160)
			}
			opts = append(opts, decide.Option{Name: fmt.Sprintf("d%d", i+1), Description: desc})
		}
		questions["doc"] = decide.Choice("Which of the person's doc templates, if any, would this new project clearly need?", opts...)
	}
	if len(sheets) > 0 {
		opts := []decide.Option{{Name: "none", Description: "No sheet template fits this project"}}
		for i, t := range sheets {
			opts = append(opts, decide.Option{Name: fmt.Sprintf("s%d", i+1), Description: templateText(t)})
		}
		questions["sheet"] = decide.Choice("Which of the person's sheet templates, if any, would this new project clearly need?", opts...)
	}
	if len(questions) == 0 {
		return out, nil
	}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "project_template", State: map[string]string{"newProjectTitle": clip(title, 200)}, Questions: questions})
	if err != nil {
		return out, nil
	}
	out.LogID = a.LogID
	pick := func(id, prefix string, n int) int {
		v, ok := a.Choice(id, decide.Prefill)
		var i int
		if !ok || v == "none" {
			return -1
		}
		if _, err := fmt.Sscanf(v, prefix+"%d", &i); err != nil || i < 1 || i > n {
			return -1
		}
		return i - 1
	}
	if i := pick("copy", "p", len(projects)); i >= 0 {
		out.CopyProjectID, out.CopyTitle = projects[i].ID, projects[i].Title
	}
	if i := pick("doc", "d", len(docs)); i >= 0 {
		out.DocTemplateID, out.DocTitle = docs[i].ID, docs[i].Title
	}
	if i := pick("sheet", "s", len(sheets)); i >= 0 {
		out.SheetTemplateID, out.SheetTitle = sheets[i].ID, sheets[i].Name
	}
	return out, nil
}
