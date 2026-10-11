package agent

import (
	"fmt"
	"slices"
	"sort"
	"strings"
	"timely-api/internal/models"
)

// Saved views from plain words: create_task_view and update_task_view take
// workspace, status, project, label and stage names as well as ids. Names are
// matched case-insensitively among the person's own workspaces only; an
// unknown name fails with the closest names the model can retry with.

type namedRef struct{ ID, Name, Parent string }

type viewCatalog struct {
	workspaces, statuses, labels, projects, stages, fields []namedRef
}

// viewCatalog lists what a view filter can name. Stages need the projects
// service and are loaded only when the call names some.
func (s *Server) viewCatalog(uid string, withStages bool) (viewCatalog, error) {
	var c viewCatalog
	workspaces, err := s.Workspaces.GetAllWorkspaceByUser(uid)
	if err != nil {
		return c, err
	}
	for _, w := range workspaces {
		c.workspaces = append(c.workspaces, namedRef{ID: w.ID, Name: w.Name})
		for _, st := range w.Status {
			if st != nil {
				c.statuses = append(c.statuses, namedRef{ID: st.ID, Name: st.Name, Parent: w.ID})
			}
		}
		for _, l := range w.Lables {
			if l != nil {
				c.labels = append(c.labels, namedRef{ID: l.ID, Name: l.Name, Parent: w.ID})
			}
		}
		for _, p := range w.Projects {
			if p != nil {
				c.projects = append(c.projects, namedRef{ID: p.ID, Name: p.Title, Parent: w.ID})
			}
		}
		for _, f := range w.CustomFields {
			if f != nil {
				c.fields = append(c.fields, namedRef{ID: f.ID, Name: f.Name, Parent: w.ID})
			}
		}
	}
	if withStages && s.Projects != nil {
		projects, err := s.Projects.GetAllProjectByUser(uid)
		if err != nil {
			return c, err
		}
		for _, p := range projects {
			for _, st := range p.Stages {
				if st != nil {
					c.stages = append(c.stages, namedRef{ID: st.ID, Name: st.Name, Parent: p.ID})
				}
			}
		}
	}
	return c, nil
}

// resolveViewNames turns names in a view input into the ids the view stores.
// Statuses, labels and projects are looked up in the chosen workspaces first,
// stages in the chosen projects; every item with a matching name is kept, so
// "Done" means each workspace's Done.
func (s *Server) resolveViewNames(uid string, in createViewIn) (createViewIn, error) {
	needsCatalog := len(in.SelectedWorkspaceIds)+len(in.SelectedStatusIds)+len(in.SelectedProjectIds)+
		len(in.SelectedLabelIds)+len(in.SelectedStageIds) > 0
	for _, g := range in.GroupFields {
		if !models.StaticGroupFields[strings.ToLower(strings.TrimSpace(g))] {
			needsCatalog = true
		}
	}
	var c viewCatalog
	if needsCatalog {
		var err error
		if c, err = s.viewCatalog(uid, len(in.SelectedStageIds) > 0); err != nil {
			return in, err
		}
	}
	return resolveViewInput(c, in)
}

func resolveViewInput(c viewCatalog, in createViewIn) (createViewIn, error) {
	var err error
	if in.SelectedWorkspaceIds, err = resolveRefs("workspace", "workspaces", in.SelectedWorkspaceIds, c.workspaces, nil); err != nil {
		return in, err
	}
	inWorkspaces := setOf(in.SelectedWorkspaceIds)
	if in.SelectedStatusIds, err = resolveRefs("status", "statuses", in.SelectedStatusIds, c.statuses, inWorkspaces); err != nil {
		return in, err
	}
	if in.SelectedLabelIds, err = resolveRefs("label", "labels", in.SelectedLabelIds, c.labels, inWorkspaces); err != nil {
		return in, err
	}
	if in.SelectedProjectIds, err = resolveRefs("project", "projects", in.SelectedProjectIds, c.projects, inWorkspaces); err != nil {
		return in, err
	}
	if in.SelectedStageIds, err = resolveRefs("stage", "stages", in.SelectedStageIds, c.stages, setOf(in.SelectedProjectIds)); err != nil {
		return in, err
	}
	if in.SelectedPriorityLevels != nil {
		levels := []string{}
		for _, p := range in.SelectedPriorityLevels {
			level := models.NormalizePriority(p)
			if level == "" {
				continue
			}
			if !models.ValidatePriority(level) {
				return in, fmt.Errorf("unknown priority %q: use Low, Medium, High or Urgent", p)
			}
			if !slices.Contains(levels, level) {
				levels = append(levels, level)
			}
		}
		in.SelectedPriorityLevels = levels
	}
	if in.GroupFields != nil {
		groups := []string{}
		for _, g := range in.GroupFields {
			key := strings.ToLower(strings.TrimSpace(g))
			switch {
			case key == "":
				continue
			case models.StaticGroupFields[key]:
				groups = append(groups, key)
			case strings.HasPrefix(g, "cf:"):
				groups = append(groups, g)
			default:
				ids, err := resolveRefs("group field", "custom fields", []string{g}, c.fields, inWorkspaces)
				if err != nil {
					return in, fmt.Errorf("%w (or group by workspace, project, stage, status or priority)", err)
				}
				groups = append(groups, "cf:"+ids[0])
			}
		}
		in.GroupFields = groups
	}
	if in.RenderMode != "" {
		in.RenderMode = renderAliases[strings.ToLower(strings.TrimSpace(in.RenderMode))]
		if in.RenderMode == "" {
			return in, fmt.Errorf("unknown renderMode: use list, kanban (board) or gantt (timeline)")
		}
	}
	if in.SortBy != "" {
		in.SortBy = sortAliases[strings.ToLower(strings.Join(strings.Fields(in.SortBy), " "))]
		if in.SortBy == "" {
			return in, fmt.Errorf("unknown sortBy: use name, deadline, startDate, scheduledOn, createdAt, priority, status or project")
		}
	}
	return in, nil
}

var renderAliases = map[string]string{
	"list": "list", "table": "list", "kanban": "kanban", "board": "kanban", "gantt": "gantt", "timeline": "gantt",
}

var sortAliases = map[string]string{
	"name": "name", "title": "name", "deadline": "deadline", "due": "deadline", "due date": "deadline",
	"startdate": "startDate", "start date": "startDate", "start": "startDate",
	"scheduledon": "scheduledOn", "scheduled": "scheduledOn", "planned day": "scheduledOn",
	"createdat": "createdAt", "created": "createdAt", "date added": "createdAt",
	"priority": "priority", "status": "status", "project": "project",
}

// resolveRefs maps each id or name to ids. scope narrows a name to items
// under those parents when any of them match there.
func resolveRefs(noun, plural string, refs []string, pool []namedRef, scope map[string]bool) ([]string, error) {
	if refs == nil {
		return nil, nil
	}
	out := []string{}
	add := func(id string) {
		if !slices.Contains(out, id) {
			out = append(out, id)
		}
	}
	for _, ref := range refs {
		ref = strings.TrimSpace(ref)
		if ref == "" {
			continue
		}
		if item, ok := byID(pool, ref); ok {
			add(item.ID)
			continue
		}
		var all, scoped []string
		for _, item := range pool {
			if strings.EqualFold(strings.TrimSpace(item.Name), ref) {
				all = append(all, item.ID)
				if scope[item.Parent] {
					scoped = append(scoped, item.ID)
				}
			}
		}
		if len(scoped) > 0 {
			all = scoped
		}
		if len(all) == 0 {
			return nil, unknownRef(noun, plural, ref, pool)
		}
		for _, id := range all {
			add(id)
		}
	}
	return out, nil
}

// unknownRef names the closest options, or what exists when nothing is close.
func unknownRef(noun, plural, ref string, pool []namedRef) error {
	if len(pool) == 0 {
		return fmt.Errorf("unknown %s %q: there are no %s in your workspaces", noun, ref, plural)
	}
	type scored struct {
		name string
		d    int
	}
	seen := map[string]bool{}
	var close, all []scored
	want := strings.ToLower(ref)
	for _, item := range pool {
		name := strings.TrimSpace(item.Name)
		key := strings.ToLower(name)
		if name == "" || seen[key] {
			continue
		}
		seen[key] = true
		d := editDistance(want, key)
		all = append(all, scored{name, d})
		if strings.Contains(key, want) || strings.Contains(want, key) || d <= max(2, len([]rune(want))/3) {
			close = append(close, scored{name, d})
		}
	}
	list, lead := close, "Close matches"
	if len(list) == 0 {
		list, lead = all, "Your "+plural+" include"
	}
	sort.SliceStable(list, func(i, j int) bool { return list[i].d < list[j].d })
	names := []string{}
	for i, s := range list {
		if i == 8 {
			break
		}
		names = append(names, s.name)
	}
	return fmt.Errorf("unknown %s %q. %s: %s. Use one of these names or ask the person", noun, ref, lead, strings.Join(names, ", "))
}

func byID(pool []namedRef, id string) (namedRef, bool) {
	for _, item := range pool {
		if item.ID == id {
			return item, true
		}
	}
	return namedRef{}, false
}

func setOf(ids []string) map[string]bool {
	out := map[string]bool{}
	for _, id := range ids {
		out[id] = true
	}
	return out
}

// editDistance is the Levenshtein distance between two strings.
func editDistance(a, b string) int {
	ra, rb := []rune(a), []rune(b)
	prev := make([]int, len(rb)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ra); i++ {
		cur := make([]int, len(rb)+1)
		cur[0] = i
		for j := 1; j <= len(rb); j++ {
			cost := 1
			if ra[i-1] == rb[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
		}
		prev = cur
	}
	return prev[len(rb)]
}
