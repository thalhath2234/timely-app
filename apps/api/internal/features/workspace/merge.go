package workspace

import (
	"errors"
	"net/http"
	"slices"
	"strings"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

// Merger folds one label, status or custom-field option into another in the
// same workspace: every task, project and saved view that used the first now
// uses the second, and the first is deleted. One transaction, so a failure
// leaves both as they were.
type Merger struct {
	db *gorm.DB
}

func NewMerger(db *gorm.DB) *Merger { return &Merger{db: db} }

// MergeResult counts what moved.
type MergeResult struct {
	Tasks    int `json:"tasks"`
	Projects int `json:"projects"`
	Views    int `json:"views"`
}

var (
	errMergeSelf = errors.New("choose two different items to merge")
	// Completing Work sets the status named Done or Completed, so merging that
	// status away into another name would break the link.
	errMergeDone = errors.New("keep the done status: merge the other status into it instead")
)

func (m *Merger) Routes(g *echo.Group) {
	g.POST("/workspaces/:workspaceId/lable/:lableId/merge", m.mergeLabel)
	g.POST("/workspaces/:workspaceId/status/:statusId/merge", m.mergeStatus)
	g.POST("/workspaces/:workspaceId/custom-field/:customFieldId/options/merge", m.mergeOption)
}

type mergeRequest struct {
	From string `json:"from"` // option merges only
	Into string `json:"into"`
}

func (m *Merger) handle(c *echo.Context, run func(userID string, req mergeRequest) (MergeResult, error)) error {
	userID, err := requestScope(c, c.Param("workspaceId"))
	if err != nil {
		return err
	}
	var req mergeRequest
	if err := c.Bind(&req); err != nil || req.Into == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "into is required")
	}
	out, err := run(userID, req)
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return echo.NewHTTPError(http.StatusNotFound, "not found in this workspace")
	case errors.Is(err, errMergeSelf), errors.Is(err, errMergeDone):
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	case err != nil:
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	return c.JSON(http.StatusOK, out)
}

func (m *Merger) mergeLabel(c *echo.Context) error {
	return m.handle(c, func(uid string, req mergeRequest) (MergeResult, error) {
		return m.MergeLabels(uid, c.Param("workspaceId"), c.Param("lableId"), req.Into)
	})
}

func (m *Merger) mergeStatus(c *echo.Context) error {
	return m.handle(c, func(uid string, req mergeRequest) (MergeResult, error) {
		return m.MergeStatuses(uid, c.Param("workspaceId"), c.Param("statusId"), req.Into)
	})
}

func (m *Merger) mergeOption(c *echo.Context) error {
	return m.handle(c, func(uid string, req mergeRequest) (MergeResult, error) {
		if req.From == "" {
			return MergeResult{}, errMergeSelf
		}
		return m.MergeOptions(uid, c.Param("workspaceId"), c.Param("customFieldId"), req.From, req.Into)
	})
}

// owned checks the workspace and that both ids are rows of model in it.
func owned(tx *gorm.DB, userID, workspaceID string, model any, ids ...string) error {
	if err := NewWorkspaceRepository(tx).EnsureWorkspaceOwned(userID, workspaceID); err != nil {
		return err
	}
	var n int64
	if err := tx.Model(model).Where("id IN ? AND workspace_id = ?", ids, workspaceID).Count(&n).Error; err != nil {
		return err
	}
	if int(n) != len(ids) {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// MergeLabels moves every task from label `from` to `into` and deletes `from`.
func (m *Merger) MergeLabels(userID, workspaceID, from, into string) (MergeResult, error) {
	if from == into {
		return MergeResult{}, errMergeSelf
	}
	out := MergeResult{}
	err := m.db.Transaction(func(tx *gorm.DB) error {
		if err := owned(tx, userID, workspaceID, &models.Lable{}, from, into); err != nil {
			return err
		}
		var tasks []models.Task
		if err := tx.Select("id", "label_ids").
			Where("user_id = ? AND label_ids @> ?::jsonb", userID, `[{"id":"`+from+`"}]`).Find(&tasks).Error; err != nil {
			return err
		}
		now := utils.GetCurrentTime()
		for _, t := range tasks {
			labels := models.LabelInputs{}
			seen := map[string]bool{}
			for _, l := range t.LabelIDs {
				id := l.Id
				if id == from {
					id = into
				}
				if !seen[id] {
					seen[id] = true
					labels = append(labels, models.LabelInput{Id: id})
				}
			}
			if err := tx.Model(&models.Task{}).Where("id = ?", t.ID).
				UpdateColumns(map[string]any{"label_ids": labels, "updated_at": now}).Error; err != nil {
				return err
			}
		}
		out.Tasks = len(tasks)
		views, err := rewriteViews(tx, userID, func(v *models.TaskViewConfig) bool {
			return replaceID(&v.SelectedLabelIds, from, into)
		})
		if err != nil {
			return err
		}
		out.Views = views
		return tx.Where("id = ? AND workspace_id = ?", from, workspaceID).Delete(&models.Lable{}).Error
	})
	return out, err
}

// MergeStatuses moves tasks and projects from status `from` to `into` and
// deletes `from`. When `from` was the workspace default, `into` takes over.
func (m *Merger) MergeStatuses(userID, workspaceID, from, into string) (MergeResult, error) {
	if from == into {
		return MergeResult{}, errMergeSelf
	}
	out := MergeResult{}
	err := m.db.Transaction(func(tx *gorm.DB) error {
		if err := owned(tx, userID, workspaceID, &models.Status{}, from, into); err != nil {
			return err
		}
		var pair []models.Status
		if err := tx.Where("id IN ?", []string{from, into}).Find(&pair).Error; err != nil {
			return err
		}
		names := map[string]string{}
		for _, st := range pair {
			names[st.ID] = st.Name
		}
		if completionName(names[from]) && !completionName(names[into]) {
			return errMergeDone
		}
		now := utils.GetCurrentTime()
		res := tx.Model(&models.Task{}).Where("status_id = ? AND user_id = ?", from, userID).
			UpdateColumns(map[string]any{"status_id": into, "updated_at": now})
		if res.Error != nil {
			return res.Error
		}
		out.Tasks = int(res.RowsAffected)
		res = tx.Model(&models.Project{}).Where("status_id = ? AND workspace_id = ?", from, workspaceID).
			UpdateColumns(map[string]any{"status_id": into, "updated_at": now})
		if res.Error != nil {
			return res.Error
		}
		out.Projects = int(res.RowsAffected)
		var source models.Status
		if err := tx.Select("is_default").Where("id = ?", from).First(&source).Error; err != nil {
			return err
		}
		if source.IsDefault {
			if err := tx.Model(&models.Status{}).Where("id = ?", into).UpdateColumn("is_default", true).Error; err != nil {
				return err
			}
		}
		views, err := rewriteViews(tx, userID, func(v *models.TaskViewConfig) bool {
			changed := replaceID(&v.SelectedStatusIds, from, into)
			if order, ok := v.GroupValueOrders["status"]; ok && replaceID(&order, from, into) {
				v.GroupValueOrders["status"] = order
				changed = true
			}
			return changed
		})
		if err != nil {
			return err
		}
		out.Views = views
		return tx.Where("id = ? AND workspace_id = ?", from, workspaceID).Delete(&models.Status{}).Error
	})
	return out, err
}

// MergeOptions folds option `from` of a select or multi-select field into
// option `into` and removes `from` from the field.
func (m *Merger) MergeOptions(userID, workspaceID, fieldID, from, into string) (MergeResult, error) {
	if from == into {
		return MergeResult{}, errMergeSelf
	}
	out := MergeResult{}
	err := m.db.Transaction(func(tx *gorm.DB) error {
		if err := owned(tx, userID, workspaceID, &models.CustomField{}, fieldID); err != nil {
			return err
		}
		var field models.CustomField
		if err := tx.Where("id = ?", fieldID).First(&field).Error; err != nil {
			return err
		}
		if field.Type != models.CustomFieldTypeSelect && field.Type != models.CustomFieldTypeMultiSelect {
			return gorm.ErrRecordNotFound
		}
		kept := []models.Option{}
		found := 0
		for _, o := range field.Options.Options {
			if o.ID == from || o.ID == into {
				found++
			}
			if o.ID != from {
				kept = append(kept, o)
			}
		}
		if found != 2 {
			return gorm.ErrRecordNotFound
		}
		var values []models.CustomFieldValue
		if err := tx.Select("id", "options_value", "task_id", "project_id").
			Where("custom_field_id = ? AND options_value @> ?::jsonb", fieldID, `[{"id":"`+from+`"}]`).Find(&values).Error; err != nil {
			return err
		}
		for _, v := range values {
			next := models.CustomFieldValueInputs{}
			seen := map[string]bool{}
			for _, o := range v.OptionsValue {
				id := o.Id
				if id == from {
					id = into
				}
				if !seen[id] {
					seen[id] = true
					next = append(next, models.CustomFieldValueInput{Id: id})
				}
			}
			if err := tx.Model(&models.CustomFieldValue{}).Where("id = ?", v.ID).
				UpdateColumns(map[string]any{"options_value": next, "updated_at": utils.GetCurrentTime()}).Error; err != nil {
				return err
			}
			if v.TaskID != "" {
				out.Tasks++
			} else if v.ProjectID != "" {
				out.Projects++
			}
		}
		views, err := rewriteViews(tx, userID, func(v *models.TaskViewConfig) bool {
			changed := false
			for key, order := range v.GroupValueOrders {
				if key == "cf:"+fieldID && replaceID(&order, from, into) {
					v.GroupValueOrders[key] = order
					changed = true
				}
			}
			return changed
		})
		if err != nil {
			return err
		}
		out.Views = views
		field.Options.Options = kept
		return tx.Model(&models.CustomField{}).Where("id = ?", fieldID).
			UpdateColumns(map[string]any{"options": field.Options, "updated_at": utils.GetCurrentTime()}).Error
	})
	return out, err
}

// rewriteViews applies fix to every saved view of the user and writes back
// the ones it changed.
func rewriteViews(tx *gorm.DB, userID string, fix func(*models.TaskViewConfig) bool) (int, error) {
	var config models.Config
	err := tx.Select("id", "task_views", "project_task_views", "mobile_task_views").Where("user_id = ?", userID).First(&config).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	n := 0
	for i := range config.TaskViews {
		if fix(&config.TaskViews[i]) {
			n++
		}
	}
	mobileChanged := false
	for i := range config.MobileTaskViews {
		if fix(&config.MobileTaskViews[i]) {
			mobileChanged = true
			n++
		}
	}
	projectChanged := false
	for key, v := range config.ProjectTaskViews {
		if fix(&v) {
			config.ProjectTaskViews[key] = v
			projectChanged = true
			n++
		}
	}
	if n == 0 {
		return 0, nil
	}
	cols := map[string]any{"task_views": config.TaskViews}
	if projectChanged {
		cols["project_task_views"] = config.ProjectTaskViews
	}
	if mobileChanged {
		cols["mobile_task_views"] = config.MobileTaskViews
	}
	return n, models.WriteJSONB(tx, "configs", cols, "user_id = ?", userID)
}

// replaceID swaps from for into in ids, keeping the first of any duplicates.
func replaceID(ids *[]string, from, into string) bool {
	if !slices.Contains(*ids, from) {
		return false
	}
	out := make([]string, 0, len(*ids))
	for _, id := range *ids {
		if id == from {
			id = into
		}
		if !slices.Contains(out, id) {
			out = append(out, id)
		}
	}
	*ids = out
	return true
}

// completionName matches the status names completing Work sets (see
// task.isCompletedStatusName).
func completionName(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "completed", "complete", "done":
		return true
	}
	return false
}
