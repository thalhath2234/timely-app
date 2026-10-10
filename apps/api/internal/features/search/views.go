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

// ViewSource lists a person's saved views.
type ViewSource func(ctx context.Context, userID string) []SavedView

// SetViews connects the person's saved views.
func (s *Smart) SetViews(fn ViewSource) { s.views = fn }

const maxViewChoices = 20

// ViewsFromDB reads the saved task views from the person's config and
// names their statuses, projects and labels.
func ViewsFromDB(db *gorm.DB) ViewSource {
	return func(ctx context.Context, userID string) []SavedView {
		var cfg models.Config
		if err := db.WithContext(ctx).Select("task_views").Where("user_id = ?", userID).First(&cfg).Error; err != nil {
			return nil
		}
		var views []models.TaskViewConfig
		var statusIDs, projectIDs, labelIDs []string
		for _, v := range cfg.TaskViews {
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
	if w := sortWords[v.SortBy]; w != "" {
		parts = append(parts, fmt.Sprintf("sorted by %s", w))
	}
	return strings.Join(parts, "; ")
}

var sortWords = map[models.SortByField]string{
	models.SortByName: "name", models.SortByDeadline: "deadline", models.SortByStartDate: "start date",
	models.SortByScheduledOn: "planned day", models.SortByCreatedAt: "date added", models.SortByPriority: "priority",
	models.SortByStatus: "status", models.SortByProject: "project",
}
