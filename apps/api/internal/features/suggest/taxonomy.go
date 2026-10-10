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
)

// Cleanup suggestions [26]: labels, statuses or custom-field options in one
// workspace that mean the same thing. Code picks the pairs worth asking about
// and which side to keep (see keepSide); Jev only says whether the two names
// mean the same.

const (
	cleanupBudget = 6 * time.Second
	askAllBelow   = 8  // a small list is checked pair by pair
	maxPairs      = 40 // questions in one call
	maxCleanups   = 10
)

func (s *Service) taxonomyRoutes(g *echo.Group) {
	g.GET("/suggestions/workspace/:id/cleanup", s.cleanup)
}

type CleanupItem struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Uses int    `json:"uses"`
	// A status that finishes Work or that new Work starts in must survive a
	// merge; see keepSide.
	completes, isDefault bool
}

// Cleanup is one suggested merge: From goes into Into.
type Cleanup struct {
	Kind      string      `json:"kind"` // label, status or option
	FieldID   string      `json:"fieldId,omitempty"`
	FieldName string      `json:"fieldName,omitempty"`
	From      CleanupItem `json:"from"`
	Into      CleanupItem `json:"into"`
}

type CleanupSuggestions struct {
	Available bool      `json:"available"`
	LogID     string    `json:"logId,omitempty"`
	Merges    []Cleanup `json:"merges"`
}

func (s *Service) cleanup(c *echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), cleanupBudget)
	defer cancel()
	out, err := s.CleanupSuggestions(ctx, user(c), c.Param("id"))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(404, "Workspace not found")
	}
	if err != nil {
		return err
	}
	return c.JSON(200, out)
}

type taxonomyGroup struct {
	kind      string
	fieldID   string
	fieldName string
	noun      string // how a question names the items
	items     []CleanupItem
}

func (s *Service) CleanupSuggestions(ctx context.Context, userID, workspaceID string) (CleanupSuggestions, error) {
	var n int64
	if err := s.db.WithContext(ctx).Model(&models.Workspace{}).Where("id = ? AND user_id = ?", workspaceID, userID).Count(&n).Error; err != nil {
		return CleanupSuggestions{}, err
	}
	if n == 0 {
		return CleanupSuggestions{}, gorm.ErrRecordNotFound
	}
	on, _ := s.decide.Status(ctx, userID)
	out := CleanupSuggestions{Available: on, Merges: []Cleanup{}}
	if !on {
		return out, nil
	}
	groups := s.taxonomy(ctx, userID, workspaceID)

	type pair struct {
		group int
		a, b  CleanupItem
	}
	var close, rest []pair
	for gi, g := range groups {
		for i := 0; i < len(g.items); i++ {
			for j := i + 1; j < len(g.items); j++ {
				p := pair{gi, g.items[i], g.items[j]}
				if similarNames(p.a.Name, p.b.Name) {
					close = append(close, p)
				} else if len(g.items) <= askAllBelow {
					rest = append(rest, p)
				}
			}
		}
	}
	pairs := append(close, rest...)
	if len(pairs) > maxPairs {
		pairs = pairs[:maxPairs]
	}
	if len(pairs) == 0 {
		return out, nil
	}
	list := []map[string]any{}
	questions := map[string]decide.Question{}
	for i, p := range pairs {
		g := groups[p.group]
		key := fmt.Sprintf("pair%d", i+1)
		item := map[string]any{"pair": key, "kind": g.noun, "first": clip(p.a.Name, 80), "second": clip(p.b.Name, 80)}
		if g.fieldName != "" {
			item["field"] = clip(g.fieldName, 80)
		}
		list = append(list, item)
		questions[key] = decide.YesNo(
			fmt.Sprintf("Do the two %ss in %s mean the same thing, so the person could keep just one of them?", g.noun, key),
			"Yes, they mean the same thing (a synonym, plural, typo or translation).",
			"No, they mean different things, even if related.")
	}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "taxonomy_cleanup", State: map[string]any{"pairs": list}, Questions: questions})
	if err != nil {
		return out, nil
	}
	out.LogID = a.LogID
	merged := map[string]bool{}
	for i, p := range pairs {
		// The person confirms every merge, so a likely yes is enough to ask.
		if yes, ok := a.Yes(fmt.Sprintf("pair%d", i+1), decide.Prefill); !ok || !yes {
			continue
		}
		// One merge per item at a time; after it, the next fetch pairs again.
		if merged[p.a.ID] || merged[p.b.ID] {
			continue
		}
		into, from, ok := keepSide(p.a, p.b)
		if !ok {
			continue
		}
		g := groups[p.group]
		out.Merges = append(out.Merges, Cleanup{Kind: g.kind, FieldID: g.fieldID, FieldName: g.fieldName, From: from, Into: into})
		merged[p.a.ID], merged[p.b.ID] = true, true
		if len(out.Merges) == maxCleanups {
			break
		}
	}
	return out, nil
}

// taxonomy loads the workspace's labels, statuses and select options with how
// much Work uses each, oldest first, so ties keep the older one.
func (s *Service) taxonomy(ctx context.Context, userID, workspaceID string) []taxonomyGroup {
	db := s.db.WithContext(ctx)
	type use struct {
		ID string
		N  int
	}
	count := func(sql string, args ...any) map[string]int {
		var rows []use
		db.Raw(sql, args...).Scan(&rows)
		out := map[string]int{}
		for _, r := range rows {
			out[r.ID] += r.N
		}
		return out
	}
	groups := []taxonomyGroup{}

	var labels []models.Lable
	db.Where("workspace_id = ?", workspaceID).Order("created_at").Find(&labels)
	if len(labels) > 1 {
		uses := count(`SELECT e->>'id' AS id, count(*) AS n FROM tasks, jsonb_array_elements(tasks.label_ids) e
			WHERE tasks.user_id = ? AND jsonb_typeof(tasks.label_ids) = 'array' GROUP BY 1`, userID)
		g := taxonomyGroup{kind: "label", noun: "label"}
		for _, l := range labels {
			g.items = append(g.items, CleanupItem{ID: l.ID, Name: l.Name, Uses: uses[l.ID]})
		}
		groups = append(groups, g)
	}

	var statuses []models.Status
	db.Where("workspace_id = ?", workspaceID).Order("created_at").Find(&statuses)
	if len(statuses) > 1 {
		uses := count(`SELECT status_id AS id, count(*) AS n FROM tasks WHERE user_id = ? AND status_id IS NOT NULL GROUP BY 1
			UNION ALL SELECT status_id AS id, count(*) AS n FROM projects WHERE workspace_id = ? AND status_id IS NOT NULL GROUP BY 1`, userID, workspaceID)
		g := taxonomyGroup{kind: "status", noun: "status"}
		for _, st := range statuses {
			g.items = append(g.items, CleanupItem{ID: st.ID, Name: st.Name, Uses: uses[st.ID],
				completes: isCompletedStatusName(st.Name), isDefault: st.IsDefault})
		}
		groups = append(groups, g)
	}

	var fields []models.CustomField
	db.Where("workspace_id = ? AND type IN ?", workspaceID,
		[]string{string(models.CustomFieldTypeSelect), string(models.CustomFieldTypeMultiSelect)}).Order("created_at").Find(&fields)
	for _, f := range fields {
		if len(f.Options.Options) < 2 {
			continue
		}
		uses := count(`SELECT e->>'id' AS id, count(*) AS n FROM custom_field_values v, jsonb_array_elements(v.options_value) e
			WHERE v.custom_field_id = ? AND jsonb_typeof(v.options_value) = 'array' GROUP BY 1`, f.ID)
		g := taxonomyGroup{kind: "option", fieldID: f.ID, fieldName: f.Name, noun: "option"}
		for _, o := range f.Options.Options {
			g.items = append(g.items, CleanupItem{ID: o.ID, Name: o.Value, Uses: uses[o.ID]})
		}
		groups = append(groups, g)
	}
	return groups
}

// keepSide picks which of two items a merge keeps: a completion status (so the
// workspace never loses its Done), then the default status, then the one more
// Work uses. A completion status paired with the default one is never merged,
// since either way the workspace would lose one of them.
func keepSide(a, b CleanupItem) (into, from CleanupItem, ok bool) {
	if (a.completes && b.isDefault && !b.completes) || (b.completes && a.isDefault && !a.completes) {
		return a, b, false
	}
	into, from = a, b
	switch {
	case from.completes != into.completes:
		if from.completes {
			into, from = from, into
		}
	case from.isDefault != into.isDefault:
		if from.isDefault {
			into, from = from, into
		}
	case from.Uses > into.Uses:
		into, from = from, into
	}
	return into, from, true
}

// isCompletedStatusName matches the names the task service treats as the
// workspace's completion status.
func isCompletedStatusName(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "completed", "complete", "done":
		return true
	default:
		return false
	}
}

// similarNames is the cheap first pass: a shared word, one name inside the
// other, the same word with an s, or a near typo.
func similarNames(a, b string) bool {
	a, b = strings.ToLower(strings.TrimSpace(a)), strings.ToLower(strings.TrimSpace(b))
	if a == "" || b == "" {
		return false
	}
	if a == b || strings.Contains(a, b) || strings.Contains(b, a) {
		return true
	}
	if editDistance(a, b) <= max(1, min(len(a), len(b))/3) {
		return true
	}
	words := func(s string) []string {
		f := strings.FieldsFunc(s, func(r rune) bool { return !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r > 127) })
		for i, w := range f {
			f[i] = strings.TrimSuffix(strings.TrimSuffix(w, "es"), "s")
		}
		sort.Strings(f)
		return f
	}
	wa, wb := words(a), words(b)
	for _, x := range wa {
		if len(x) < 3 {
			continue
		}
		for _, y := range wb {
			if x == y {
				return true
			}
		}
	}
	return false
}

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
