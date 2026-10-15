package search

import (
	"context"
	"fmt"
	"strings"

	"gorm.io/gorm"
	"timely-api/internal/models"
)

// Saved views in smart search [97]: when a search reads as a request to see
// a list of work ("what needs attention", "my overdue stuff"), Jev may pick
// one of the person's saved task views. Code describes each view's filters
// in words; Jev only matches the request to a description.

// SavedView is a saved task view as smart search offers it.
type SavedView struct {
	ID          string
	Name        string
	Description string
}

// ViewPick is the saved view a search seems to ask for.
type ViewPick struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Clients whose saved views a search offers: the phone app keeps its own
// views (config.mobileTaskViews); anything else is the web and desktop app.
const (
	ClientPhone = "phone"
	ClientWeb   = "web"
)

// ViewSource lists a person's saved views for one client.
type ViewSource func(ctx context.Context, userID, client string) []SavedView

// SetViews connects the person's saved views.
func (s *Smart) SetViews(fn ViewSource) { s.views = fn }

const maxViewChoices = 20

// ViewsFromDB reads the client's saved task views from the person's config
// (the phone's own views for client "phone") and names their statuses,
// projects and labels.
func ViewsFromDB(db *gorm.DB) ViewSource {
	return func(ctx context.Context, userID, client string) []SavedView {
		column := "task_views"
		if client == ClientPhone {
			column = "mobile_task_views"
		}
		var cfg models.Config
		if err := db.WithContext(ctx).Select(column).Where("user_id = ?", userID).First(&cfg).Error; err != nil {
			return nil
		}
		saved := cfg.TaskViews
		if client == ClientPhone {
			saved = cfg.MobileTaskViews
		}
		var views []models.TaskViewConfig
		var statusIDs, projectIDs, labelIDs []string
		for _, v := range saved {
			if len(views) == maxViewChoices {
				break
			}
			if strings.TrimSpace(v.Name) == "" {
				continue
			}
			views = append(views, v)
			statusIDs = append(statusIDs, v.SelectedStatusIds...)
			projectIDs = append(projectIDs, v.SelectedProjectIds...)
			labelIDs = append(labelIDs, v.SelectedLabelIds...)
		}
		// One query per table, only names in the person's own workspaces.
		names := func(table, column string, ids []string) map[string]string {
			out := map[string]string{}
			if len(ids) == 0 {
				return out
			}
			var rows []struct{ ID, Name string }
			db.WithContext(ctx).Table(table+" t").Select("t.id, t."+column+" AS name").
				Joins("JOIN workspaces w ON w.id = t.workspace_id").
				Where("t.id IN ? AND w.user_id = ?", ids, userID).Scan(&rows)
			for _, r := range rows {
				out[r.ID] = r.Name
			}
			return out
		}
		statuses, projects, labels := names("statuses", "name", statusIDs), names("projects", "title", projectIDs), names("lables", "name", labelIDs)
		pick := func(ids []string, from map[string]string) []string {
			var out []string
			for _, id := range ids {
				if n, ok := from[id]; ok && len(out) < 6 {
					out = append(out, n)
				}
			}
			return out
		}
		out := make([]SavedView, 0, len(views))
		for _, v := range views {
			out = append(out, SavedView{ID: v.ID, Name: v.Name, Description: describeView(v,
				pick(v.SelectedStatusIds, statuses), pick(v.SelectedProjectIds, projects), pick(v.SelectedLabelIds, labels))})
		}
		return out
	}
}

// describeView says what a saved view shows, in words.
func describeView(v models.TaskViewConfig, statuses, projects, labels []string) string {
	var parts []string
	switch v.DataMode {
	case models.DataModeProject:
		parts = append(parts, "lists projects")
	default:
		parts = append(parts, "lists work items")
	}
	switch v.RenderMode {
	case models.RenderModeKanban:
		parts = append(parts, "shown as a board")
	case models.RenderModeGantt:
		parts = append(parts, "shown as a timeline")
	}
	if len(v.GroupFields) > 0 {
		parts = append(parts, "grouped by "+strings.Join(v.GroupFields, ", "))
	}
	if v.OnlyOverdue {
		parts = append(parts, "only overdue ones")
	}
	if v.OnlyScheduled {
		parts = append(parts, "only ones with time on the calendar")
	}
	if v.OnlyRecurring {
		parts = append(parts, "only repeating ones")
	}
	if v.OnlyDated != nil && *v.OnlyDated {
		parts = append(parts, "only ones with a deadline or planned time")
	}
	if v.ShowCompleted != nil && !*v.ShowCompleted {
		parts = append(parts, "hides finished ones")
	}
	if len(v.SelectedPriorityLevels) > 0 {
		parts = append(parts, "priority "+strings.Join(v.SelectedPriorityLevels, " or "))
	}
	if len(statuses) > 0 {
		parts = append(parts, "status "+strings.Join(statuses, " or "))
	}
	if len(projects) > 0 {
		parts = append(parts, "in "+strings.Join(projects, ", "))
	}
	if len(labels) > 0 {
		parts = append(parts, "labelled "+strings.Join(labels, ", "))
	}
	if len(v.Rules) > 0 {
		join := " and "
		if v.RuleMatch == "any" {
			join = " or "
		}
		var rules []string
		for _, rule := range v.Rules {
			rules = append(rules, ruleWords(rule))
		}
		parts = append(parts, "where "+strings.Join(rules, join))
	}
	if w := sortName(v.SortBy); w != "" {
		sorted := "sorted by " + w
		if then := sortName(v.ThenSortBy); then != "" {
			sorted += " then " + then
		}
		parts = append(parts, sorted)
	}
	if v.Limit > 0 {
		parts = append(parts, fmt.Sprintf("first %d only", v.Limit))
	}
	return strings.Join(parts, "; ")
}

// ruleWords describes one view rule [natural-language views]. Choice values
// are ids the reader can't use, so they are left out; dates and numbers stay
// as written ("thisWeek", "next:3", "-30" days ago).
func ruleWords(rule models.ViewRule) string {
	if len(rule.Rules) > 0 {
		join := " or "
		if rule.Match == "all" {
			join = " and "
		}
		var inner []string
		for _, r := range rule.Rules {
			inner = append(inner, ruleWords(r))
		}
		return "(" + strings.Join(inner, join) + ")"
	}
	field := rule.Field
	if strings.HasPrefix(field, "cf:") {
		field = "a custom field"
	}
	switch rule.Op {
	case "isEmpty":
		return field + " is empty"
	case "isNotEmpty":
		return field + " is set"
	case "anyOf", "noneOf", "allOf":
		if field == "priority" || field == "effort" {
			return field + " " + rule.Op + " " + string(rule.Value)
		}
		return field + " " + rule.Op + " chosen values"
	}
	words := field + " " + rule.Op
	if len(rule.Value) > 0 {
		words += " " + strings.Trim(string(rule.Value), `"`)
	}
	if len(rule.To) > 0 {
		words += " to " + strings.Trim(string(rule.To), `"`)
	}
	return words
}

func sortName(sortBy models.SortByField) string {
	if w := sortWords[sortBy]; w != "" {
		return w
	}
	if strings.HasPrefix(string(sortBy), "cf:") {
		return "a custom field"
	}
	return string(sortBy)
}

var sortWords = map[models.SortByField]string{
	models.SortByName: "name", models.SortByDeadline: "deadline", models.SortByStartDate: "start date",
	models.SortByScheduledOn: "planned day", models.SortByCreatedAt: "date added", models.SortByPriority: "priority",
	models.SortByStatus: "status", models.SortByProject: "project", models.SortByUpdatedAt: "last update",
	models.SortByCompletedAt: "date finished", models.SortByWorkspace: "workspace", models.SortByStage: "stage",
	models.SortByDuration: "length", models.SortByTracked: "time tracked", models.SortByUrgency: "urgency",
	models.SortByProgress: "progress", models.SortByEffort: "effort",
}
