package suggest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/features/decide"
	"timely-api/internal/models"
)

// A doc's unchecked checklist items are offered as tasks only while smart
// suggestions are on, and only the ones Jev reads as something to get done
// (an errand, a call), not a thing kept in the doc to tick off there (milk,
// an ingredient). The clients read the items from the open editor; this
// says which are already tasks, which to offer, and which project new ones
// go to.

const (
	maxChecklistNames = 200
	// Most items Jev reads at once. Items already tasks or dismissed do not
	// count, but ones Jev said no to do: its "no" is not kept, so a later
	// read meets them first again.
	maxChecklistAsk = 50
)

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
	// Available: smart suggestions are on, so items can be offered at all.
	Available bool `json:"available"`
	// Off: the person turned task offers off for this doc.
	Off bool `json:"off,omitempty"`
	// Offer are the names, as sent, to offer as tasks: Jev reads them as
	// things to get done, and they are not tasks yet or dismissed.
	Offer []string `json:"offer"`
	LogID string   `json:"logId,omitempty"`
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
	if err := s.db.WithContext(ctx).Select("id", "title", "content", "project_id", "workspace_id", "created_at").
		Where("id = ? AND user_id = ?", docID, userID).First(&doc).Error; err != nil {
		return DocChecklist{}, err
	}
	out := DocChecklist{Existing: []ChecklistTask{}, Offer: []string{}}
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
		if len(order) == maxChecklistNames {
			break
		}
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
	// A task named with AI has a cleaner name than the item, so it is found
	// by its description instead: it links this doc and quotes the item
	// (`From <doc>: “<item>”`, checklistTaskDescription in the contract).
	if len(found) < len(order) {
		var named []struct {
			ID          string
			Description string
		}
		s.db.WithContext(ctx).Model(&models.Task{}).Select("id", "description").
			Where("user_id = ? AND description_rich::text LIKE ?", userID, "%"+likeEscape(docID)+"%").
			Where("completed_at IS NULL OR created_at >= ?", since).
			Order("completed_at IS NOT NULL, created_at DESC").
			Limit(500).
			Scan(&named)
		for _, l := range order {
			if _, ok := found[l]; ok {
				continue
			}
			for _, r := range named {
				if quotesItem(r.Description, l) {
					found[l] = r.ID
					break
				}
			}
		}
	}
	// An item edited since it became a task (a typo fixed, a word added)
	// is still that task. Make task links the doc in every task it makes,
	// so only those count.
	if len(found) < len(order) {
		made := s.madeSinceDoc(ctx, userID, doc, false)
		for _, l := range order {
			if _, ok := found[l]; ok {
				continue
			}
			for _, m := range made {
				if m.matches(l) {
					found[l] = m.id
					break
				}
			}
		}
	}
	for _, l := range order {
		if id, ok := found[l]; ok {
			out.Existing = append(out.Existing, ChecklistTask{Name: byLower[l], TaskID: id})
		}
	}

	out.Available, _ = s.decide.Status(ctx, userID)
	dismissed := s.docDismissed(ctx, userID, doc.ID)
	out.Off = dismissed[docHintKey("todos", "")]
	if !out.Available || out.Off {
		return out, nil
	}
	var ask []string
	for _, l := range order {
		if _, ok := found[l]; ok || dismissed[docHintKey("todo", l)] {
			continue
		}
		ask = append(ask, byLower[l])
		if len(ask) == maxChecklistAsk {
			break
		}
	}
	if len(ask) > 0 {
		out.Offer, out.LogID = s.checklistOffers(ctx, userID, doc, ask)
	}
	return out, nil
}

// checklistOffers are the items Jev reads as things to get done, each worth
// its own task, rather than things kept in the doc to tick off there. An
// offer is unprompted, so only a confident yes counts; no answer offers none.
func (s *Service) checklistOffers(ctx context.Context, userID string, doc models.Document, names []string) ([]string, string) {
	ctx, cancel := context.WithTimeout(ctx, docBudget)
	defer cancel()
	items := make([]map[string]string, len(names))
	questions := map[string]decide.Question{}
	for i, name := range names {
		key := fmt.Sprintf("i%d", i+1)
		items[i] = map[string]string{"item": key, "text": clip(name, 120)}
		questions[key] = decide.YesNo(fmt.Sprintf("Is checklist item %s something the person has to get done, worth tracking as its own task (an action, errand, call or follow-up), rather than something kept in the doc to tick off there, such as a thing to buy or pack, an ingredient, or something to read or watch?", key),
			"Yes, it is a task to get done.", "No, it is kept in the doc.")
	}
	state := map[string]any{"title": clip(doc.Title, 200), "items": items}
	// The lists the items sit in, with their headings, say what kind of list
	// it is ("Groceries", "Before the trip").
	if lists := checklists(doc.Content); len(lists) > 0 {
		described := make([]map[string]any, len(lists))
		for i, l := range lists {
			shown := l.items
			if len(shown) > maxListItems {
				shown = shown[:maxListItems]
			}
			clipped := make([]string, len(shown))
			for j, it := range shown {
				clipped[j] = clip(it, 120)
			}
			described[i] = map[string]any{"heading": clip(l.heading, 120), "items": clipped}
		}
		state["checklists"] = described
		// Long lists in a script of wide characters can outgrow what Jev
		// takes; the items alone still say enough.
		if raw, err := json.Marshal(state); err != nil || len(raw) > decide.MaxStateBytes {
			delete(state, "checklists")
		}
	}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "doc_checklist", State: state, Questions: questions})
	if err != nil {
		return []string{}, ""
	}
	offer := []string{}
	for i, name := range names {
		if yes, ok := a.Yes(fmt.Sprintf("i%d", i+1), decide.Route); ok && yes {
			offer = append(offer, name)
		}
	}
	return offer, a.LogID
}

// quotesItem reports whether a task description quotes the checklist item
// whose (lower-cased) name is given, as `From <doc>: “<item text>”` does. The
// item's text starts with its name; a name cut short ends in an ellipsis.
func quotesItem(description, name string) bool {
	name = strings.TrimSuffix(name, "…")
	if name == "" {
		return false
	}
	text := strings.ToLower(strings.Join(strings.Fields(description), " "))
	return strings.Contains(text, ": “"+name)
}

func likeEscape(s string) string {
	return strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(s)
}
