package workspace

import (
	"encoding/json"
	"slices"
	"testing"

	"timely-api/internal/models"
)

func TestIntegrationMergeLabelsStatusesAndOptions(t *testing.T) {
	f := newFixture(t)
	must(t, f.db.AutoMigrate(&models.CustomFieldValue{}, &models.Config{}))
	m := NewMerger(f.db)

	bugs, err := f.svc.CreateLabels(f.owner, &models.Lable{Name: "Bugs", Color: "#333333", WorkspaceID: f.ws})
	must(t, err)
	both := models.Task{ID: "tsk_both", Name: "both", UserID: &f.owner, WorkspaceID: &f.ws, Kind: models.KindTask,
		LabelIDs: models.LabelInputs{{Id: f.label}, {Id: bugs.ID}}, StatusID: &f.status}
	one := models.Task{ID: "tsk_one", Name: "one", UserID: &f.owner, WorkspaceID: &f.ws, Kind: models.KindTask,
		LabelIDs: models.LabelInputs{{Id: f.label}}}
	must(t, f.db.Create(&both).Error)
	must(t, f.db.Create(&one).Error)
	view := models.TaskViewConfig{ID: "v1", Name: "Bugs", SelectedLabelIds: []string{f.label, bugs.ID}, SelectedStatusIds: []string{f.status},
		GroupValueOrders: map[string][]string{"status": {f.status}}}
	phoneView := models.TaskViewConfig{ID: "native_view_bugs", Name: "Bugs", SelectedLabelIds: []string{f.label}}
	must(t, f.db.Create(&models.Config{ID: "cfg_1", UserID: f.owner, TaskViews: models.TaskViews{view}, ProjectTaskViews: models.ProjectTaskViews{},
		MobileTaskViews: models.TaskViews{phoneView}}).Error)

	// Labels: every task keeps one copy of the kept label; views follow,
	// the phone's views too.
	out, err := m.MergeLabels(f.owner, f.ws, f.label, bugs.ID)
	must(t, err)
	if out.Tasks != 2 || out.Views != 2 {
		t.Fatalf("%+v", out)
	}
	var tasks []models.Task
	must(t, f.db.Order("id").Find(&tasks).Error)
	for _, task := range tasks {
		if len(task.LabelIDs) != 1 || task.LabelIDs[0].Id != bugs.ID {
			t.Fatalf("%s labels %+v", task.ID, task.LabelIDs)
		}
	}
	if count(t, f.db, &models.Lable{}, "id = ?", f.label) != 0 {
		t.Fatal("merged label still there")
	}
	var cfg models.Config
	must(t, f.db.Where("user_id = ?", f.owner).First(&cfg).Error)
	if !slices.Equal(cfg.TaskViews[0].SelectedLabelIds, []string{bugs.ID}) {
		t.Fatalf("view labels %v", cfg.TaskViews[0].SelectedLabelIds)
	}
	if !slices.Equal(cfg.MobileTaskViews[0].SelectedLabelIds, []string{bugs.ID}) {
		t.Fatalf("phone view labels %v", cfg.MobileTaskViews[0].SelectedLabelIds)
	}

	// Statuses: tasks and projects move; the default passes to the kept one.
	done, err := f.svc.CreateStatuses(f.owner, &models.Status{Name: "Done", Color: "#444444", WorkspaceID: f.ws})
	must(t, err)
	must(t, f.db.Model(&models.Status{}).Where("id = ?", f.status).Update("is_default", true).Error)
	project := models.Project{ID: "pr_1", Title: "P", WorkspaceID: &f.ws, StatusID: &f.status}
	must(t, f.db.Create(&project).Error)
	out, err = m.MergeStatuses(f.owner, f.ws, f.status, done.ID)
	must(t, err)
	if out.Tasks != 1 || out.Projects != 1 || out.Views != 1 {
		t.Fatalf("%+v", out)
	}
	if count(t, f.db, &models.Status{}, "id = ? AND is_default", done.ID) != 1 || count(t, f.db, &models.Status{}, "id = ?", f.status) != 0 {
		t.Fatal("status not merged")
	}
	must(t, f.db.Where("user_id = ?", f.owner).First(&cfg).Error)
	if !slices.Equal(cfg.TaskViews[0].SelectedStatusIds, []string{done.ID}) || !slices.Equal(cfg.TaskViews[0].GroupValueOrders["status"], []string{done.ID}) {
		t.Fatalf("view statuses %+v", cfg.TaskViews[0])
	}

	// Options: values keep one copy, the field loses the merged option.
	field, err := f.svc.CreateCustomFields(f.owner, &models.CustomField{Name: "Area", Type: models.CustomFieldTypeMultiSelect, WorkspaceID: f.ws,
		Options: models.Options{Options: []models.Option{{ID: "o_web", Value: "Web"}, {ID: "o_site", Value: "Website"}, {ID: "o_app", Value: "App"}}}})
	must(t, err)
	must(t, f.db.Omit("ProjectID", "Project", "Task", "CustomField").Create(&models.CustomFieldValue{ID: "cfv_1", CustomFieldID: field.ID, TaskID: both.ID, Type: "multi_select",
		OptionsValue: models.CustomFieldValueInputs{{Id: "o_web"}, {Id: "o_site"}, {Id: "o_app"}}}).Error)
	out, err = m.MergeOptions(f.owner, f.ws, field.ID, "o_web", "o_site")
	must(t, err)
	if out.Tasks != 1 {
		t.Fatalf("%+v", out)
	}
	var value models.CustomFieldValue
	must(t, f.db.Where("id = ?", "cfv_1").First(&value).Error)
	got, _ := json.Marshal(value.OptionsValue)
	if string(got) != `[{"id":"o_site"},{"id":"o_app"}]` {
		t.Fatalf("value %s", got)
	}
	var saved models.CustomField
	must(t, f.db.Where("id = ?", field.ID).First(&saved).Error)
	if len(saved.Options.Options) != 2 || saved.Options.Options[0].ID != "o_site" {
		t.Fatalf("options %+v", saved.Options)
	}

	// Another account, the same item twice, or an unknown id change nothing.
	if _, err := m.MergeLabels(f.other, f.ws, bugs.ID, bugs.ID); err == nil {
		t.Fatal("merged an item into itself")
	}
	if _, err := m.MergeStatuses(f.other, f.ws, done.ID, "tst_missing"); err == nil {
		t.Fatal("merged in another account")
	}
	if _, err := m.MergeOptions(f.owner, f.ws, field.ID, "o_app", "o_missing"); err == nil {
		t.Fatal("merged into a missing option")
	}
	if count(t, f.db, &models.Status{}, "id = ?", done.ID) != 1 {
		t.Fatal("failed merge deleted the status")
	}
}
