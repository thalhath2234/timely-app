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
	// options are each select field's options by field id.
	options map[string][]namedRef
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
				if c.options == nil {
					c.options = map[string][]namedRef{}
				}
				for _, option := range f.Options.Options {
					c.options[f.ID] = append(c.options[f.ID], namedRef{ID: option.ID, Name: option.Value, Parent: f.ID})
				}
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
		len(in.SelectedLabelIds)+len(in.SelectedStageIds)+len(in.Rules) > 0
	for _, g := range in.GroupFields {
		if staticGroupKey(g) == "" {
			needsCatalog = true
		}
	}
	for _, by := range []string{in.SortBy, in.ThenSortBy} {
		if by != "" && sortAliases[strings.ToLower(strings.Join(strings.Fields(by), " "))] == "" {
			needsCatalog = true
		}
	}
	var c viewCatalog
	if needsCatalog {
		var err error
		if c, err = s.viewCatalog(uid, len(in.SelectedStageIds) > 0 || rulesName(in.Rules, "stage")); err != nil {
			return in, err
		}
	}
	return resolveViewInput(c, in)
}

// rulesName reports whether any rule reads the field.
func rulesName(rules []agentRule, field string) bool {
	for _, rule := range rules {
		if rule.Field == field {
			return true
		}
		for _, leaf := range rule.Rules {
			if leaf.Field == field {
				return true
			}
		}
	}
	return false
}

// staticGroupKey is the stored group key for a built-in group name in any case.
func staticGroupKey(g string) string {
	key := strings.ToLower(strings.TrimSpace(g))
	for field := range models.StaticGroupFields {
		if strings.ToLower(field) == key {
			return field
		}
	}
	return ""
}

func ruleStrings(value any) []string {
	switch v := value.(type) {
	case string:
		return []string{v}
	case []any:
		out := []string{}
		for _, item := range v {
			if text, ok := item.(string); ok {
				out = append(out, text)
			}
		}
		return out
	case []string:
		return v
	}
	return nil
}

// resolveField maps "cf:Type" or "cf:<id>" to the stored "cf:<id>".
func resolveField(c viewCatalog, field string) (string, error) {
	if !strings.HasPrefix(field, "cf:") {
		return field, nil
	}
	ids, err := resolveRefs("custom field", "custom fields", []string{strings.TrimPrefix(field, "cf:")}, c.fields, nil)
	if err != nil {
		return "", err
	}
	return "cf:" + ids[0], nil
}

func resolveLeaf(c viewCatalog, leaf agentRuleLeaf) (agentRuleLeaf, error) {
	field, err := resolveField(c, strings.TrimSpace(leaf.Field))
	if err != nil {
		return leaf, err
	}
	leaf.Field = field
	if leaf.Op != "anyOf" && leaf.Op != "noneOf" && leaf.Op != "allOf" {
		if leaf.Field == "priority" && (leaf.Op == "gte" || leaf.Op == "lte") {
			if text, ok := leaf.Value.(string); ok {
				leaf.Value = models.NormalizePriority(text)
			}
		}
		return leaf, nil
	}
	refs := ruleStrings(leaf.Value)
	var ids []string
	switch {
	case leaf.Field == "workspace":
		ids, err = resolveRefs("workspace", "workspaces", refs, c.workspaces, nil)
	case leaf.Field == "project":
		ids, err = resolveRefs("project", "projects", refs, c.projects, nil)
	case leaf.Field == "status":
		ids, err = resolveRefs("status", "statuses", refs, c.statuses, nil)
	case leaf.Field == "label":
		ids, err = resolveRefs("label", "labels", refs, c.labels, nil)
	case leaf.Field == "stage":
		ids, err = resolveRefs("stage", "stages", refs, c.stages, nil)
	case leaf.Field == "priority":
		for _, p := range refs {
			level := models.NormalizePriority(p)
			if !models.ValidatePriority(level) {
				return leaf, fmt.Errorf("unknown priority %q: use Low, Medium, High or Urgent", p)
			}
			ids = append(ids, level)
		}
	case strings.HasPrefix(leaf.Field, "cf:"):
		ids, err = resolveRefs("option", "options of that field", refs, c.options[strings.TrimPrefix(leaf.Field, "cf:")], nil)
	default:
		ids = refs
	}
	if err != nil {
		return leaf, err
	}
	leaf.Value = ids
	return leaf, nil
}

// resolveRules turns names in rules into ids and checks their shape.
func resolveRules(c viewCatalog, rules []agentRule) ([]agentRule, error) {
	out := make([]agentRule, 0, len(rules))
	for _, rule := range rules {
		if len(rule.Rules) > 0 || rule.Match != "" && rule.Field == "" {
			group := agentRule{Match: rule.Match}
			for _, leaf := range rule.Rules {
				resolved, err := resolveLeaf(c, leaf)
				if err != nil {
					return nil, err
				}
				group.Rules = append(group.Rules, resolved)
			}
			out = append(out, group)
			continue
		}
		leaf, err := resolveLeaf(c, agentRuleLeaf{Field: rule.Field, Op: rule.Op, Value: rule.Value, To: rule.To})
		if err != nil {
			return nil, err
		}
		out = append(out, agentRule{Field: leaf.Field, Op: leaf.Op, Value: leaf.Value, To: leaf.To})
	}
	if err := models.ValidateRules(toViewRules(out), ""); err != nil {
		return nil, err
	}
	return out, nil
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
			case staticGroupKey(key) != "":
				groups = append(groups, staticGroupKey(key))
			case strings.HasPrefix(g, "cf:"):
				groups = append(groups, g)
			default:
				ids, err := resolveRefs("group field", "custom fields", []string{g}, c.fields, inWorkspaces)
				if err != nil {
					return in, fmt.Errorf("%w (or group by workspace, project, stage, status, priority, label, deadline, planned, createdAt, completedAt, effort or done)", err)
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
	resolveSort := func(by string) (string, error) {
		if by == "" {
			return "", nil
		}
		if key := sortAliases[strings.ToLower(strings.Join(strings.Fields(by), " "))]; key != "" {
			return key, nil
		}
		ref := strings.TrimPrefix(by, "cf:")
		if ids, err := resolveRefs("custom field", "custom fields", []string{ref}, c.fields, inWorkspaces); err == nil {
			return "cf:" + ids[0], nil
		}
		return "", fmt.Errorf("unknown sortBy %q: use name, deadline, startDate, scheduledOn, createdAt, updatedAt, completedAt, priority, status, project, workspace, stage, duration, tracked, urgency, progress, effort or a custom field name", by)
	}
	if in.SortBy, err = resolveSort(in.SortBy); err != nil {
		return in, err
	}
	if in.ThenSortBy, err = resolveSort(in.ThenSortBy); err != nil {
		return in, err
	}
	if in.Rules != nil {
		if in.Rules, err = resolveRules(c, in.Rules); err != nil {
			return in, err
		}
	}
	if in.RuleMatch != "" && in.RuleMatch != "all" && in.RuleMatch != "any" {
		return in, fmt.Errorf("unknown ruleMatch %q: use all or any", in.RuleMatch)
	}
	if in.Limit != nil && (*in.Limit < 0 || *in.Limit > models.MaxViewLimit) {
		return in, fmt.Errorf("limit must be 0 to %d", models.MaxViewLimit)
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
	"updatedat": "updatedAt", "updated": "updatedAt", "last updated": "updatedAt",
	"completedat": "completedAt", "completed": "completedAt", "workspace": "workspace", "stage": "stage",
	"duration": "duration", "estimate": "duration", "tracked": "tracked", "time tracked": "tracked",
	"urgency": "urgency", "progress": "progress", "effort": "effort",
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
