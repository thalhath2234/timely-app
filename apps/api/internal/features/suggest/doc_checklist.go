package suggest

import (
	"context"
	"errors"
	"strings"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/models"
)

// A doc's unchecked checklist items are to-dos by their own say-so, so the
// clients offer each one as a task without asking Jev, and with no keys at
// all. The clients read the items from the open editor; this says which are
// already tasks and which project new ones go to.

const maxChecklistNames = 50

type ChecklistTask struct {
	Name   string `json:"name"`
	TaskID string `json:"taskId"`
}

type ChecklistProject struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	WorkspaceID string `json:"workspaceId"`
}

type DocChecklist struct {
	// Existing are the names that are already a task, in the order sent.
	Existing []ChecklistTask `json:"existing"`
	// Project is where new tasks go: the doc's own project, else the one the
	// client proposed (a suggested or related project). Nil: the doc's
	// workspace, with no project.
	Project *ChecklistProject `json:"project,omitempty"`
}

func (s *Service) docChecklist(c *echo.Context) error {
	var in struct {
		Names     []string `json:"names"`
		ProjectID string   `json:"projectId"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "invalid request payload")
	}
	if len(in.Names) > maxChecklistNames {
		in.Names = in.Names[:maxChecklistNames]
	}
	out, err := s.DocChecklist(c.Request().Context(), user(c), c.Param("id"), in.Names, in.ProjectID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return echo.NewHTTPError(404, "Doc not found")
	}
	if err != nil {
		return err
	}
	return c.JSON(200, out)
}

func (s *Service) DocChecklist(ctx context.Context, userID, docID string, names []string, projectID string) (DocChecklist, error) {
	var doc models.Document
	if err := s.db.WithContext(ctx).Select("id", "project_id", "created_at").
		Where("id = ? AND user_id = ?", docID, userID).First(&doc).Error; err != nil {
		return DocChecklist{}, err
	}
	out := DocChecklist{Existing: []ChecklistTask{}}
	candidates := []string{}
	if doc.ProjectID != nil && *doc.ProjectID != "" {
		candidates = append(candidates, *doc.ProjectID)
	}
	if projectID = strings.TrimSpace(projectID); projectID != "" {
		candidates = append(candidates, projectID)
	}
	for _, id := range candidates {
		var p ChecklistProject
		err := s.db.WithContext(ctx).Table("projects").
			Select("projects.id", "projects.title", "projects.workspace_id").
			Joins("JOIN workspaces ON workspaces.id = projects.workspace_id").
			Where("projects.id = ? AND workspaces.user_id = ? AND projects.completed_at IS NULL", id, userID).
			Take(&p).Error
		if err == nil {
			out.Project = &p
			break
		}
	}

	order := []string{}
	byLower := map[string]string{}
	for _, n := range names {
		n = strings.Join(strings.Fields(n), " ")
		l := strings.ToLower(n)
		if n == "" || byLower[l] != "" {
			continue
		}
		byLower[l] = n
		order = append(order, l)
	}
	if len(order) == 0 {
		return out, nil
	}
	// An open task with the name counts; a done one only if it was made
	// after the doc, so it may have come from this very item. Older done
	// work does not stop a fresh to-do with the same words.
	// Both columns are text; tasks keep a date, docs a full timestamp.
	since := doc.CreatedAt
	if len(since) > 10 {
		since = since[:10]
	}
	var rows []struct {
		ID   string
		Name string
	}
	s.db.WithContext(ctx).Model(&models.Task{}).Select("id", "lower(name) AS name").
		Where("user_id = ? AND lower(name) IN ?", userID, order).
		Where("completed_at IS NULL OR created_at >= ?", since).
		Order("completed_at IS NOT NULL, created_at DESC").
		Scan(&rows)
	found := map[string]string{}
	for _, r := range rows {
		if _, ok := found[r.Name]; !ok {
			found[r.Name] = r.ID
		}
	}
	for _, l := range order {
		if id, ok := found[l]; ok {
			out.Existing = append(out.Existing, ChecklistTask{Name: byLower[l], TaskID: id})
		}
	}
	return out, nil
}
