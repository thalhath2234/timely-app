package suggest

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm/clause"
	"timely-api/internal/features/decide"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

// Personalisation [94–98]. The person may say what they use Timely for
// (onboarding, or Settings → Workspaces); starter labels come from a fixed
// catalog code owns, either preset by those uses (no Jev, so it works on the
// first run before any key is saved) or picked by Jev from what they said
// and the Work they already have. Nothing is created until they click.

const (
	personalBudget  = 6 * time.Second
	maxUseCase      = 300
	maxStarterShown = 8
	maxStarterApply = 20
	maxPresetLabels = 10
	maxDismissed    = 100
)

// PersonalPrefs is what the person told Timely about themselves.
type PersonalPrefs struct {
	UseCase       string   `json:"useCase"`
	DismissedTips []string `json:"dismissedTips"`
}

// StarterUse is one answer to "what do you use Timely for?", with the
// workspace name onboarding offers for it.
type StarterUse struct {
	Key       string `json:"key"`
	Label     string `json:"label"`
	Workspace string `json:"workspace"`
}

// StarterLabel is a label the catalog can offer.
type StarterLabel struct {
	Name  string `json:"name"`
	Color string `json:"color"`
	uses  []string
}

var starterUses = []StarterUse{
	{"work", "Work and projects", "Work"}, {"personal", "Personal life", "Personal"}, {"study", "Study", "Study"},
	{"business", "Running a business", "Business"}, {"team", "Leading a team", "Team"}, {"creative", "Creative work", "Creative"},
	{"health", "Health and fitness", "Health"}, {"home", "Home and family", "Home"},
}

func lbl(name, color string, uses ...string) StarterLabel {
	return StarterLabel{Name: name, Color: color, uses: uses}
}

// starterCatalog is every label Timely can suggest, most general first.
var starterCatalog = []StarterLabel{
	lbl("Urgent", "#E5484D", "work", "personal", "business", "team"),
	lbl("Waiting", "#F5A524", "work", "team", "business"),
	lbl("Quick win", "#30A46C", "work", "personal", "home"),
	lbl("Deep work", "#6E56CF", "work", "study", "creative"),
	lbl("Meeting", "#0091FF", "work", "team"),
	lbl("Follow up", "#F76B15", "work", "business", "team"),
	lbl("Admin", "#8B8D98", "work", "business", "personal"),
	lbl("Errand", "#12A594", "personal", "home"),
	lbl("Bills", "#D6409F", "personal", "home", "business"),
	lbl("Family", "#D6409F", "personal", "home"),
	lbl("Health", "#30A46C", "health", "personal"),
	lbl("Workout", "#46A758", "health"),
	lbl("Reading", "#6E56CF", "study", "personal", "creative"),
	lbl("Exam", "#E5484D", "study"),
	lbl("Assignment", "#0091FF", "study"),
	lbl("Research", "#12A594", "study", "creative", "work"),
	lbl("Clients", "#0091FF", "business"),
	lbl("Invoices", "#F5A524", "business"),
	lbl("Marketing", "#D6409F", "business"),
	lbl("Sales", "#30A46C", "business"),
	lbl("Hiring", "#6E56CF", "team"),
	lbl("1:1", "#0091FF", "team"),
	lbl("Review", "#F76B15", "team", "work", "creative"),
	lbl("Ideas", "#F5A524", "creative", "personal", "business"),
	lbl("Draft", "#8B8D98", "creative", "study"),
	lbl("Home repair", "#F76B15", "home"),
	lbl("Shopping", "#12A594", "home", "personal"),
	lbl("Learning", "#6E56CF", "study", "personal", "work"),
}

func (s *Service) personalRoutes(g *echo.Group) {
	g.GET("/suggestions/prefs", s.getPrefs)
	g.PATCH("/suggestions/prefs", s.patchPrefs)
	g.GET("/suggestions/starter/presets", s.starterPresets)
	g.GET("/suggestions/starter", s.starter)
	g.POST("/suggestions/starter/apply", s.applyStarter)
	g.GET("/suggestions/tip", s.tip)
	g.POST("/suggestions/tips/dismiss", s.dismissTip)
	g.POST("/suggestions/prompts", s.prompts)
	g.POST("/suggestions/estimate", s.estimateForm)
}

// personal reads the person's prefs; a missing row is empty prefs.
func (s *Service) personal(ctx context.Context, userID string) PersonalPrefs {
	var row struct {
		UseCase       string
		DismissedTips string
	}
	out := PersonalPrefs{DismissedTips: []string{}}
	if err := s.db.WithContext(ctx).Raw(`SELECT use_case, dismissed_tips::text AS dismissed_tips FROM suggestion_prefs WHERE user_id = ?`, userID).Scan(&row).Error; err != nil {
		return out
	}
	out.UseCase = row.UseCase
	if row.DismissedTips != "" {
		_ = json.Unmarshal([]byte(row.DismissedTips), &out.DismissedTips)
	}
	return out
}

// saveUseCase writes only the use case, so a tip dismissed at the same time
// is kept.
func (s *Service) saveUseCase(ctx context.Context, userID, useCase string) error {
	return s.db.WithContext(ctx).Exec(`INSERT INTO suggestion_prefs (user_id, use_case, updated_at) VALUES (?, ?, now())
		ON CONFLICT (user_id) DO UPDATE SET use_case = EXCLUDED.use_case, updated_at = now()`, userID, useCase).Error
}

// dismiss adds a tip to the dismissed list in one statement (no read
// first), at most maxDismissed keys.
func (s *Service) dismiss(ctx context.Context, userID, key string) error {
	return s.db.WithContext(ctx).Exec(`INSERT INTO suggestion_prefs (user_id, dismissed_tips, updated_at) VALUES (?, jsonb_build_array(?::text), now())
		ON CONFLICT (user_id) DO UPDATE SET dismissed_tips = CASE
			WHEN suggestion_prefs.dismissed_tips @> jsonb_build_array(?::text) OR jsonb_array_length(suggestion_prefs.dismissed_tips) >= ?
			THEN suggestion_prefs.dismissed_tips
			ELSE suggestion_prefs.dismissed_tips || jsonb_build_array(?::text) END,
			updated_at = now()`, userID, key, key, maxDismissed, key).Error
}

func (s *Service) getPrefs(c *echo.Context) error {
	return c.JSON(200, map[string]any{"prefs": s.personal(c.Request().Context(), user(c)), "uses": starterUses})
}

func (s *Service) patchPrefs(c *echo.Context) error {
	var in struct {
		UseCase *string `json:"useCase"`
	}
	if err := c.Bind(&in); err != nil || in.UseCase == nil {
		return echo.NewHTTPError(400, "Invalid request")
	}
	ctx := c.Request().Context()
	if err := s.saveUseCase(ctx, user(c), clip(strings.TrimSpace(*in.UseCase), maxUseCase)); err != nil {
		return err
	}
	return c.JSON(200, map[string]any{"prefs": s.personal(ctx, user(c))})
}

// Presets are the catalog's labels for the uses the person picked, taken
// in turn from each use (in catalog order) so every use is represented.
// Code only: this runs during onboarding, before any key.
func Presets(uses []string, taken map[string]bool) []StarterLabel {
	var lists [][]StarterLabel
	for _, u := range starterUses {
		if !slices.Contains(uses, u.Key) {
			continue
		}
		var list []StarterLabel
		for _, l := range starterCatalog {
			if slices.Contains(l.uses, u.Key) {
				list = append(list, l)
			}
		}
		lists = append(lists, list)
	}
	out := []StarterLabel{}
	seen := map[string]bool{}
	for i := 0; len(out) < maxPresetLabels; i++ {
		added := false
		for _, list := range lists {
			if i < len(list) && len(out) < maxPresetLabels {
				added = true
				if !seen[list[i].Name] && !taken[labelKey(list[i].Name)] {
					seen[list[i].Name] = true
					out = append(out, list[i])
				}
			}
		}
		if !added {
			break
		}
	}
	return out
}

func (s *Service) starterPresets(c *echo.Context) error {
	// Presets go into a new workspace, so no name is taken yet.
	return c.JSON(200, map[string]any{"labels": Presets(strings.Split(c.QueryParam("uses"), ","), nil), "uses": starterUses})
}

// takenStarter is the catalog names a label in the workspace already uses
// (label names are unique within a workspace). Only catalog names, with or
// without a plural "s", are read.
func (s *Service) takenStarter(ctx context.Context, workspaceID string) map[string]bool {
	var variants []string
	for _, l := range starterCatalog {
		k := strings.ToLower(l.Name)
		variants = append(variants, k, k+"s", strings.TrimSuffix(k, "s"))
	}
	var names []string
	s.db.WithContext(ctx).Table("lables").Where("workspace_id = ? AND lower(name) IN ?", workspaceID, variants).Pluck("name", &names)
	out := map[string]bool{}
	for _, n := range names {
		out[labelKey(n)] = true
	}
	return out
}

// StarterSuggestions are catalog labels Jev thinks fit a workspace [94].
type StarterSuggestions struct {
	Available bool           `json:"available"`
	LogID     string         `json:"logId,omitempty"`
	Labels    []StarterLabel `json:"labels"`
}

func (s *Service) starter(c *echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), personalBudget)
	defer cancel()
	out, err := s.Starter(ctx, user(c), c.QueryParam("workspaceId"))
	if err != nil {
		return err
	}
	return c.JSON(200, out)
}

// Starter asks which catalog labels the workspace is missing, given what the
// person uses Timely for and the Work already in it.
func (s *Service) Starter(ctx context.Context, userID, workspaceID string) (StarterSuggestions, error) {
	out := StarterSuggestions{Labels: []StarterLabel{}}
	if ok, _ := s.decide.Status(ctx, userID); !ok {
		return out, nil
	}
	out.Available = true
	var ws models.Workspace
	if err := s.db.WithContext(ctx).Where("id = ? AND user_id = ?", workspaceID, userID).First(&ws).Error; err != nil {
		return out, echo.NewHTTPError(404, "Workspace not found")
	}
	// A catalog name the workspace already uses is left out.
	have := s.takenStarter(ctx, ws.ID)
	var own []string
	s.db.WithContext(ctx).Table("lables").Where("workspace_id = ?", ws.ID).Order("name").Limit(30).Pluck("name", &own)
	var work []string
	s.db.WithContext(ctx).Model(&models.Task{}).Where("workspace_id = ? AND user_id = ? AND completed_at IS NULL AND kind = ?", ws.ID, userID, models.KindTask).
		Order("updated_at DESC").Limit(25).Pluck("name", &work)
	use := s.personal(ctx, userID).UseCase
	if strings.TrimSpace(use) == "" && len(work) < 3 {
		return out, nil // nothing to go on yet
	}
	var cands []StarterLabel
	for _, l := range starterCatalog {
		if !have[labelKey(l.Name)] {
			cands = append(cands, l)
		}
	}
	if len(cands) == 0 {
		return out, nil
	}
	questions := map[string]decide.Question{}
	for i, l := range cands {
		questions[fmt.Sprintf("l%d", i+1)] = decide.YesNo(fmt.Sprintf("Would a label named %q help this person sort the work in this workspace?", l.Name),
			"Yes: it fits what they use Timely for or the work they already have", "No: it does not fit them, or an existing label covers it")
	}
	for i := range work {
		work[i] = clip(work[i], 120)
	}
	state := map[string]any{"workspace": clip(ws.Name, 100), "existingLabels": own, "openWork": work}
	if use != "" {
		state["usesTimelyFor"] = use
	}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "starter_labels", State: state, Questions: questions})
	if err != nil {
		return out, nil
	}
	out.LogID = a.LogID
	type picked struct {
		i int
		p float64
	}
	var picks []picked
	for i := range cands {
		id := fmt.Sprintf("l%d", i+1)
		if yes, ok := a.Yes(id, decide.Flag); ok && yes {
			raw, _ := a.Raw(id)
			picks = append(picks, picked{i, raw.Yes})
		}
	}
	sort.SliceStable(picks, func(x, y int) bool { return picks[x].p > picks[y].p })
	for _, p := range picks {
		if len(out.Labels) < maxStarterShown {
			out.Labels = append(out.Labels, cands[p.i])
		}
	}
	return out, nil
}

// labelKey folds case and a plural "s", so "Bugs" counts as "bug".
func labelKey(name string) string {
	k := strings.ToLower(strings.TrimSpace(name))
	if len(k) > 3 && strings.HasSuffix(k, "s") {
		k = strings.TrimSuffix(k, "s")
	}
	return k
}

// applyStarter creates the labels the person ticked. A name the workspace
// already uses is skipped and reported, since label names are unique there.
func (s *Service) applyStarter(c *echo.Context) error {
	var in struct {
		WorkspaceID string `json:"workspaceId"`
		Labels      []struct {
			Name  string `json:"name"`
			Color string `json:"color"`
		} `json:"labels"`
	}
	if err := c.Bind(&in); err != nil || len(in.Labels) == 0 || len(in.Labels) > maxStarterApply {
		return echo.NewHTTPError(400, "Invalid request")
	}
	ctx := c.Request().Context()
	var ws models.Workspace
	if err := s.db.WithContext(ctx).Where("id = ? AND user_id = ?", in.WorkspaceID, user(c)).First(&ws).Error; err != nil {
		return echo.NewHTTPError(404, "Workspace not found")
	}
	created, skipped := []models.Lable{}, []string{}
	for _, l := range in.Labels {
		name := clip(strings.TrimSpace(l.Name), 60)
		color := l.Color
		if !validColor(color) {
			color = "#6E56CF"
		}
		if name == "" {
			continue
		}
		row := models.Lable{ID: utils.NewLableID(), Name: name, Color: color, WorkspaceID: ws.ID}
		res := s.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			skipped = append(skipped, name)
			continue
		}
		created = append(created, row)
	}
	return c.JSON(200, map[string]any{"created": created, "skipped": skipped})
}

func validColor(c string) bool {
	if len(c) != 7 || c[0] != '#' {
		return false
	}
	for _, r := range c[1:] {
		if !strings.ContainsRune("0123456789abcdefABCDEF", r) {
			return false
		}
	}
	return true
}
