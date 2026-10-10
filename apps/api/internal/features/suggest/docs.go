package suggest

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/features/decide"
	"timely-api/internal/models"
	"timely-api/internal/richtext"
)

// Docs [48–52, 54, 57]: where a doc belongs, lines that read like Work, the
// doc's type and properties, a template for a near-empty doc, outdated
// content, mention targets for selected text and block types for a
// plain-text import. Code builds the candidates and counts; Jev only picks.

const (
	docBudget       = 8 * time.Second
	maxDocProjects  = 30
	maxDocParents   = 8
	maxWorkLines    = 20
	maxWorkHints    = 8
	maxPropertyKeys = 5
	maxKeyValues    = 15
	maxDocTemplates = 20
	maxImportLines  = 80
	docTextLimit    = 2500
	// A doc shorter than this is judged by its template question only.
	docMinText = 40
	// Only a doc left alone this long is asked whether it is outdated [57].
	outdatedAfter = 30 * 24 * time.Hour
)

// docTypes are the kinds Jev may name when the person's docs have no "type"
// property of their own yet.
var docTypes = []decide.Option{
	{Name: "meeting notes", Description: "Notes from a meeting or call: who, what was discussed, decisions, follow-ups"},
	{Name: "plan", Description: "A plan or proposal: goals, steps, timeline"},
	{Name: "reference", Description: "Reference material kept to look things up: facts, how-tos, lists, links"},
	{Name: "journal", Description: "A personal journal or diary entry"},
	{Name: "spec", Description: "A specification or design for something to build"},
	{Name: "other", Description: "None of these clearly fits"},
}

func (s *Service) docRoutes(g *echo.Group) {
	g.GET("/suggestions/doc/:id", s.docHints)
	g.POST("/suggestions/mention", s.mention)
	g.POST("/suggestions/import-format", s.importFormat)
	g.GET("/suggestions/doc-template", s.docTemplate)
}

type DocRef struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type PropertyHint struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// DocHints are suggestions for one doc; every field is optional.
type DocHints struct {
	Available bool   `json:"available"`
	LogID     string `json:"logId,omitempty"`
	// Project and Parent are where the doc may belong [48]; each is asked
	// only while the doc has none.
	Project *DocRef `json:"project,omitempty"`
	Parent  *DocRef `json:"parent,omitempty"`
	// Work are lines that read like something to do [50].
	Work []string `json:"work,omitempty"`
	// DocType is a kind of doc for its "type" property [51].
	DocType    string         `json:"docType,omitempty"`
	Properties []PropertyHint `json:"properties,omitempty"` // [52]
	Template   *DocRef        `json:"template,omitempty"`   // [52] for a near-empty doc
	Outdated   bool           `json:"outdated,omitempty"`   // [57]
}

func (s *Service) docHints(c *echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), docBudget)
	defer cancel()
	out, err := s.DocHints(ctx, user(c), c.Param("id"), time.Now())
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(404, "Doc not found")
	}
	if err != nil {
		return err
	}
	return c.JSON(200, out)
}

func (s *Service) DocHints(ctx context.Context, userID, docID string, now time.Time) (DocHints, error) {
	var doc models.Document
	if err := s.db.WithContext(ctx).Where("id = ? AND user_id = ?", docID, userID).First(&doc).Error; err != nil {
		return DocHints{}, err
	}
	on, _ := s.decide.Status(ctx, userID)
	out := DocHints{Available: on}
	if !on || doc.ArchivedAt != nil || doc.IsTemplate {
		return out, nil
	}
	text := strings.TrimSpace(doc.PlainText)
	props := richtext.ParseProperties(richtext.Frontmatter(doc.Content))
	has := map[string]bool{}
	for _, p := range props {
		has[strings.ToLower(p.Key)] = true
	}
	daily := doc.DailyDate != nil && *doc.DailyDate != ""

	state := map[string]any{"title": clip(doc.Title, 200)}
	questions := map[string]decide.Question{}
	var projects []models.Project
	var parents []models.Document
	var lines []string
	var keys []usedKey
	var templates []models.Document
	byType := false

	if len([]rune(text)) < docMinText {
		// A near-empty doc: only which template it could start from.
		// A new doc is titled "Untitled" until the person names it.
		if t := strings.TrimSpace(doc.Title); t != "" && !strings.EqualFold(t, "untitled") && !daily {
			templates = s.docTemplates(ctx, userID, doc.ID)
			if len(templates) > 0 {
				opts := []decide.Option{{Name: "none", Description: "Start blank; no template fits"}}
				for i, t := range templates {
					desc := fmt.Sprintf("Doc template “%s”", clip(t.Title, 80))
					if p := strings.TrimSpace(t.PlainText); p != "" {
						desc += ": " + clip(p, 160)
					}
					opts = append(opts, decide.Option{Name: fmt.Sprintf("t%d", i+1), Description: desc})
				}
				questions["template"] = decide.Choice("The person just started an empty doc with this title. Which of their doc templates is made for this kind of doc, if any?", opts...)
			}
		}
	} else {
		state["text"] = clip(text, docTextLimit)
		if len(props) > 0 {
			state["properties"] = richtext.DescribeProperties(props)
		}
		if !daily {
			if doc.ProjectID == nil || *doc.ProjectID == "" {
				projects = s.docProjects(ctx, userID, doc.WorkspaceID)
				if len(projects) > 0 {
					opts := []decide.Option{{Name: "none", Description: "The doc is not part of any of these projects"}}
					for i, p := range projects {
						desc := fmt.Sprintf("The project “%s”", clip(p.Title, 80))
						if d := strings.TrimSpace(p.Description); d != "" {
							desc += ": " + clip(d, 160)
						}
						opts = append(opts, decide.Option{Name: fmt.Sprintf("p%d", i+1), Description: desc})
					}
					questions["project"] = decide.Choice("Is this doc written for one of the person's projects? If so, which one?", opts...)
				}
			}
			if doc.ParentID == nil || *doc.ParentID == "" {
				parents = s.docParents(ctx, userID, doc)
				if len(parents) > 0 {
					opts := []decide.Option{{Name: "none", Description: "None: the doc stands on its own"}}
					for i, p := range parents {
						desc := fmt.Sprintf("The page “%s”", clip(p.Title, 80))
						if t := strings.TrimSpace(p.PlainText); t != "" {
							desc += ": " + clip(t, 160)
						}
						opts = append(opts, decide.Option{Name: fmt.Sprintf("d%d", i+1), Description: desc})
					}
					questions["parent"] = decide.Choice("Does this doc belong under one of these pages, as a part, a detail or a section of what that page covers? If so, which one?", opts...)
				}
			}
			keys = s.usedKeys(ctx, userID, doc.ID, has)
			for _, k := range keys {
				if strings.EqualFold(k.key, "type") {
					byType = true
				}
			}
			if !has["type"] && !byType {
				questions["type"] = decide.Choice("What kind of doc is this?", docTypes...)
			}
			for i, k := range keys {
				opts := []decide.Option{{Name: "none", Description: "None of these values fits this doc"}}
				for j, v := range k.values {
					opts = append(opts, decide.Option{Name: fmt.Sprintf("v%d", j+1), Description: clip(v, 80)})
				}
				questions[fmt.Sprintf("prop%d", i+1)] = decide.Choice(
					fmt.Sprintf("The person's other docs have a “%s” property. Which value of it fits this doc?", clip(k.key, 40)), opts...)
			}
			// A doc edited this month is current by definition.
			if edited := parseWhen(doc.UpdatedAt); !edited.IsZero() && now.Sub(edited) >= outdatedAfter {
				state["lastEdited"] = idleLabel(edited, now)
				state["today"] = now.Format("Monday 2 January 2006")
				questions["outdated"] = decide.YesNo("Does this doc look outdated or superseded: it plans for dates or events that have already passed, or it says something newer replaced it?",
					"Yes, it looks outdated or superseded.", "No, it still looks current.")
			}
		}
		lines = s.workLines(ctx, userID, doc.Content)
		if len(lines) > 0 {
			list := make([]map[string]string, len(lines))
			for i, l := range lines {
				key := fmt.Sprintf("w%d", i+1)
				list[i] = map[string]string{"line": key, "text": l}
				questions[key] = decide.YesNo(fmt.Sprintf("Is line %s something the person still has to do themselves (an action, a to-do or a reminder), not information, a note or something already done?", key),
					"Yes, it is something to do.", "No, it is information, a note or already done.")
			}
			state["lines"] = list
		}
	}
	if len(questions) == 0 {
		return out, nil
	}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "doc_hints", State: state, Questions: questions})
	if err != nil {
		return out, nil
	}
	out.LogID = a.LogID
	pick := func(id, prefix string, n int, min float64) int {
		v, ok := a.Choice(id, min)
		var i int
		if !ok || v == "none" {
			return -1
		}
		if _, err := fmt.Sscanf(v, prefix+"%d", &i); err != nil || i < 1 || i > n {
			return -1
		}
		return i - 1
	}
	// Moving a doc is unprompted, so it waits for a confident answer.
	if i := pick("project", "p", len(projects), decide.Route); i >= 0 {
		out.Project = &DocRef{ID: projects[i].ID, Title: projects[i].Title}
	}
	if i := pick("parent", "d", len(parents), decide.Route); i >= 0 {
		out.Parent = &DocRef{ID: parents[i].ID, Title: parents[i].Title}
	}
	if i := pick("template", "t", len(templates), decide.Prefill); i >= 0 {
		out.Template = &DocRef{ID: templates[i].ID, Title: templates[i].Title}
	}
	if v, ok := a.Choice("type", decide.Prefill); ok && v != "other" {
		out.DocType = v
	}
	for i, k := range keys {
		if j := pick(fmt.Sprintf("prop%d", i+1), "v", len(k.values), decide.Prefill); j >= 0 {
			out.Properties = append(out.Properties, PropertyHint{Key: k.key, Value: k.values[j]})
		}
	}
	if yes, ok := a.Yes("outdated", decide.Route); ok && yes {
		out.Outdated = true
	}
	for i, l := range lines {
		if yes, ok := a.Yes(fmt.Sprintf("w%d", i+1), decide.Route); ok && yes {
			out.Work = append(out.Work, l)
			if len(out.Work) == maxWorkHints {
				break
			}
		}
	}
	return out, nil
}

// idleLabel says how long ago something happened in words, so Jev never
// compares dates itself.
func idleLabel(at, now time.Time) string {
	if at.IsZero() {
		return "unknown"
	}
	days := int(now.Sub(at).Hours() / 24)
	switch {
	case days <= 0:
		return "today"
	case days == 1:
		return "yesterday"
	case days < 14:
		return fmt.Sprintf("%d days ago", days)
	case days < 60:
		return fmt.Sprintf("%d weeks ago", days/7)
	case days < 730:
		return fmt.Sprintf("%d months ago", days/30)
	default:
		return fmt.Sprintf("%d years ago", days/365)
	}
}

func (s *Service) docProjects(ctx context.Context, userID, workspaceID string) []models.Project {
	var projects []models.Project
	s.db.WithContext(ctx).Table("projects").Select("projects.id", "projects.title", "projects.description").
		Joins("JOIN workspaces ON workspaces.id = projects.workspace_id").
		Where("projects.workspace_id = ? AND workspaces.user_id = ? AND projects.completed_at IS NULL", workspaceID, userID).
		Order("projects.updated_at DESC").Limit(maxDocProjects).Find(&projects)
	return projects
}

// docParents are pages in the doc's workspace that read close to it, never
// the doc itself or one of its own sub-pages.
func (s *Service) docParents(ctx context.Context, userID string, doc models.Document) []models.Document {
	if s.search == nil {
		return nil
	}
	query := doc.Title + "\n" + clip(strings.TrimSpace(doc.PlainText), 300)
	sctx, cancel := context.WithTimeout(ctx, searchBudget)
	hits, _ := s.search.SemanticSearch(sctx, userID, query, maxDocParents+4, []string{"doc"})
	cancel()
	ids := []string{}
	for _, h := range hits {
		if h.ID != doc.ID {
			ids = append(ids, h.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	type node struct {
		ID       string
		ParentID *string
	}
	var tree []node
	s.db.WithContext(ctx).Model(&models.Document{}).Select("id", "parent_id").Where("user_id = ?", userID).Find(&tree)
	children := map[string][]string{}
	for _, n := range tree {
		if n.ParentID != nil {
			children[*n.ParentID] = append(children[*n.ParentID], n.ID)
		}
	}
	below := map[string]bool{doc.ID: true}
	for queue := []string{doc.ID}; len(queue) > 0; queue = queue[1:] {
		for _, c := range children[queue[0]] {
			if !below[c] {
				below[c] = true
				queue = append(queue, c)
			}
		}
	}
	var rows []models.Document
	s.db.WithContext(ctx).Select("id", "title", "plain_text").
		Where("id IN ? AND user_id = ? AND workspace_id = ? AND archived_at IS NULL AND NOT is_template AND daily_date IS NULL", ids, userID, doc.WorkspaceID).
		Find(&rows)
	byID := map[string]models.Document{}
	for _, r := range rows {
		byID[r.ID] = r
	}
	out := []models.Document{}
	for _, id := range ids {
		if r, ok := byID[id]; ok && !below[id] {
			out = append(out, r)
			if len(out) == maxDocParents {
				break
			}
		}
	}
	return out
}

func (s *Service) docTemplates(ctx context.Context, userID, docID string) []models.Document {
	var docs []models.Document
	s.db.WithContext(ctx).Select("id", "title", "plain_text").
		Where("user_id = ? AND is_template AND archived_at IS NULL AND id <> ?", userID, docID).
		Order("updated_at DESC").Limit(maxDocTemplates).Find(&docs)
	return docs
}

type usedKey struct {
	key    string
	values []string
}

// usedKeys are the property keys the person's other docs use, with their
// values most used first, for keys this doc does not have yet. A key worth
// asking about is on at least two docs and has a short list of values.
func (s *Service) usedKeys(ctx context.Context, userID, docID string, has map[string]bool) []usedKey {
	var texts []string
	s.db.WithContext(ctx).Model(&models.Document{}).
		Where("user_id = ? AND id <> ? AND archived_at IS NULL AND NOT is_template", userID, docID).
		Where("content->'content'->0->>'type' = 'frontmatter'").
		Order("updated_at DESC").Limit(300).
		Pluck("content->'content'->0->'content'->0->>'text'", &texts)
	type tally struct {
		key    string
		docs   int
		counts map[string]int
		names  map[string]string
	}
	byKey := map[string]*tally{}
	for _, t := range texts {
		seen := map[string]bool{}
		for _, p := range richtext.ParseProperties(t) {
			k := strings.ToLower(p.Key)
			if has[k] || k == "title" || k == "aliases" || k == "alias" || k == "cssclasses" {
				continue
			}
			e := byKey[k]
			if e == nil {
				e = &tally{key: p.Key, counts: map[string]int{}, names: map[string]string{}}
				byKey[k] = e
			}
			if !seen[k] {
				seen[k] = true
				e.docs++
			}
			for _, v := range p.Values {
				lv := strings.ToLower(v)
				if len([]rune(v)) > 40 {
					continue
				}
				e.counts[lv]++
				if _, ok := e.names[lv]; !ok {
					e.names[lv] = v
				}
			}
		}
	}
	list := []*tally{}
	for _, e := range byKey {
		if e.docs >= 2 && len(e.counts) >= 1 && len(e.counts) <= maxKeyValues {
			list = append(list, e)
		}
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].docs != list[j].docs {
			return list[i].docs > list[j].docs
		}
		return list[i].key < list[j].key
	})
	if len(list) > maxPropertyKeys {
		list = list[:maxPropertyKeys]
	}
	out := make([]usedKey, 0, len(list))
	for _, e := range list {
		values := make([]string, 0, len(e.counts))
		for lv := range e.counts {
			values = append(values, lv)
		}
		sort.Slice(values, func(i, j int) bool {
			if e.counts[values[i]] != e.counts[values[j]] {
				return e.counts[values[i]] > e.counts[values[j]]
			}
			return values[i] < values[j]
		})
		k := usedKey{key: e.key}
		for _, lv := range values {
			k.values = append(k.values, e.names[lv])
		}
		out = append(out, k)
	}
	return out
}

// workLines are the doc's paragraphs and list items short enough to be one
// piece of Work, leaving out headings, code, checked items and lines that
// are already the name of open Work.
func (s *Service) workLines(ctx context.Context, userID string, content map[string]any) []string {
	var lines []string
	seen := map[string]bool{}
	var walk func(node map[string]any)
	walk = func(node map[string]any) {
		if len(lines) >= maxWorkLines*2 {
			return
		}
		switch node["type"] {
		case "frontmatter", "codeBlock", "heading", "table", "mermaid", "details":
			return
		case "taskItem":
			if attrs, _ := node["attrs"].(map[string]any); attrs != nil && attrs["checked"] == true {
				return
			}
		case "paragraph":
			t := strings.Join(strings.Fields(nodeText(node)), " ")
			n := len([]rune(t))
			// One piece of Work is one short sentence; a paragraph of several
			// is notes, even when it names actions.
			if n >= 6 && n <= 160 && sentences(t) == 1 && !seen[strings.ToLower(t)] {
				seen[strings.ToLower(t)] = true
				lines = append(lines, t)
			}
			return
		}
		children, _ := node["content"].([]any)
		for _, c := range children {
			if m, ok := c.(map[string]any); ok {
				walk(m)
			}
		}
	}
	walk(content)
	if len(lines) == 0 {
		return nil
	}
	lower := make([]string, len(lines))
	for i, l := range lines {
		lower[i] = strings.ToLower(l)
	}
	var existing []string
	s.db.WithContext(ctx).Model(&models.Task{}).
		Where("user_id = ? AND completed_at IS NULL AND lower(name) IN ?", userID, lower).Pluck("lower(name)", &existing)
	taken := map[string]bool{}
	for _, e := range existing {
		taken[e] = true
	}
	out := []string{}
	for _, l := range lines {
		if !taken[strings.ToLower(l)] {
			out = append(out, l)
			if len(out) == maxWorkLines {
				break
			}
		}
	}
	return out
}

// sentences counts sentence ends inside the text, plus the last sentence.
func sentences(t string) int {
	n := 1
	r := []rune(t)
	for i := 0; i+2 < len(r); i++ {
		if (r[i] == '.' || r[i] == '!' || r[i] == '?') && r[i+1] == ' ' && unicode.IsUpper(r[i+2]) {
			n++
		}
	}
	return n
}

// MentionMatch is what a selected phrase in a doc may refer to [49]: the
// match Jev is sure of, and the closest items to pick from by hand.
type MentionMatch struct {
	Available bool          `json:"available"`
	LogID     string        `json:"logId,omitempty"`
	Match     *MentionItem  `json:"match,omitempty"`
	Options   []MentionItem `json:"options"`
}

type MentionItem struct {
	Kind  string `json:"kind"` // task, project, doc or sheet
	ID    string `json:"id"`
	Title string `json:"title"`
}

func (s *Service) mention(c *echo.Context) error {
	var in struct {
		Text  string `json:"text"`
		DocID string `json:"docId"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "invalid request payload")
	}
	ctx, cancel := context.WithTimeout(c.Request().Context(), screenBudget)
	defer cancel()
	out, err := s.Mention(ctx, user(c), in.Text, in.DocID)
	if err != nil {
		return err
	}
	return c.JSON(200, out)
}

func (s *Service) Mention(ctx context.Context, userID, text, docID string) (MentionMatch, error) {
	on, _ := s.decide.Status(ctx, userID)
	out := MentionMatch{Available: on, Options: []MentionItem{}}
	text = strings.Join(strings.Fields(text), " ")
	if !on || s.search == nil || len([]rune(text)) < 2 || len([]rune(text)) > 200 {
		return out, nil
	}
	sctx, cancel := context.WithTimeout(ctx, searchBudget)
	hits, _ := s.search.SemanticSearch(sctx, userID, text, 10, []string{"task", "project", "doc", "sheet"})
	cancel()
	seen := map[string]bool{}
	for _, h := range hits {
		// Same-named items of one kind read as one option; the first (best
		// ranked) stands for them.
		key := h.Kind + ":" + strings.ToLower(strings.TrimSpace(h.Title))
		if h.ID == docID || seen[key] || strings.TrimSpace(h.Title) == "" {
			continue
		}
		seen[key] = true
		out.Options = append(out.Options, MentionItem{Kind: h.Kind, ID: h.ID, Title: h.Title})
		if len(out.Options) == 6 {
			break
		}
	}
	if len(out.Options) == 0 {
		return out, nil
	}
	nouns := map[string]string{"task": "Task", "project": "Project", "doc": "Doc", "sheet": "Sheet"}
	opts := []decide.Option{{Name: "none", Description: "None: the phrase means something else"}}
	for i, o := range out.Options {
		opts = append(opts, decide.Option{Name: fmt.Sprintf("i%d", i+1), Description: fmt.Sprintf("%s “%s”", nouns[o.Kind], clip(o.Title, 100))})
	}
	a, err := s.decide.Ask(ctx, userID, decide.Request{
		Feature:   "doc_mention",
		State:     map[string]string{"phrase": clip(text, 200)},
		Questions: map[string]decide.Question{"target": decide.Choice("The person selected this phrase in a doc to link it to one of their items. Which item does the phrase refer to?", opts...).Twice()},
	})
	if err != nil {
		return out, nil
	}
	out.LogID = a.LogID
	if v, ok := a.Choice("target", decide.Route); ok && v != "none" {
		var i int
		if _, err := fmt.Sscanf(v, "i%d", &i); err == nil && i >= 1 && i <= len(out.Options) {
			m := out.Options[i-1]
			out.Match = &m
		}
	}
	return out, nil
}

// lineKinds are the block types a plain-text import line can become [54].
var lineKinds = []decide.Option{
	{Name: "heading", Description: "A heading or section title"},
	{Name: "bullet", Description: "An item of a bulleted list"},
	{Name: "numbered", Description: "An item of a numbered list or a step"},
	{Name: "quote", Description: "A quotation"},
	{Name: "paragraph", Description: "Ordinary text"},
}

type ImportFormat struct {
	Available bool `json:"available"`
	// Kinds has one entry per line sent: heading, bullet, numbered, quote,
	// or paragraph when unsure.
	Kinds []string `json:"kinds"`
}

func (s *Service) importFormat(c *echo.Context) error {
	var in struct {
		Lines []string `json:"lines"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "invalid request payload")
	}
	if len(in.Lines) > maxImportLines {
		return echo.NewHTTPError(400, fmt.Sprintf("Send at most %d lines", maxImportLines))
	}
	ctx, cancel := context.WithTimeout(c.Request().Context(), screenBudget)
	defer cancel()
	return c.JSON(200, s.ImportFormat(ctx, user(c), in.Lines))
}

// ImportFormat asks what each line of a plain-text import is. Layout stays in
// code: the client only turns the kinds into Markdown markers.
func (s *Service) ImportFormat(ctx context.Context, userID string, lines []string) ImportFormat {
	on, _ := s.decide.Status(ctx, userID)
	out := ImportFormat{Available: on, Kinds: make([]string, len(lines))}
	for i := range out.Kinds {
		out.Kinds[i] = "paragraph"
	}
	if !on || len(lines) < 2 {
		return out
	}
	list := []map[string]string{}
	questions := map[string]decide.Question{}
	for i, l := range lines {
		l = strings.TrimSpace(l)
		if l == "" {
			continue
		}
		key := fmt.Sprintf("l%d", i+1)
		list = append(list, map[string]string{"line": key, "text": clip(l, 200)})
		questions[key] = decide.Choice(fmt.Sprintf("What is line %s in this imported note?", key), lineKinds...)
	}
	if len(questions) == 0 {
		return out
	}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "import_format", State: map[string]any{"lines": list}, Questions: questions})
	if err != nil {
		return out
	}
	for i := range lines {
		if v, ok := a.Choice(fmt.Sprintf("l%d", i+1), decide.Prefill); ok {
			out.Kinds[i] = v
		}
	}
	return out
}
