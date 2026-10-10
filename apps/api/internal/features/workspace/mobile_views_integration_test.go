package workspace

import (
	"fmt"
	"strings"
	"testing"

	"timely-api/internal/models"
)

// The phone's saved views round-trip through the config apart from the web
// and desktop views, and are validated the same way.
func TestIntegrationConfigMobileTaskViewsRoundTrip(t *testing.T) {
	f := newFixture(t)
	must(t, f.db.AutoMigrate(&models.Config{}))
	must(t, f.db.Create(&models.Config{ID: "cfg_1", UserID: f.owner, TaskViews: models.DefaultTaskViews(), ActiveTaskViewId: "view_task_list"}).Error)

	cfg, err := f.svc.GetConfig(f.owner)
	must(t, err)
	if len(cfg.MobileTaskViews) != 0 || cfg.MobileActiveTaskViewId != "" {
		t.Fatalf("new account has phone views: %+v", cfg.MobileTaskViews)
	}

	phone := models.DefaultMobileTaskViews()
	cfg.MobileTaskViews = phone
	cfg.MobileActiveTaskViewId = "native_view_board"
	cfg.UserID = f.owner
	_, err = f.svc.UpdateConfig(cfg)
	must(t, err)

	got, err := f.svc.GetConfig(f.owner)
	must(t, err)
	if len(got.MobileTaskViews) != len(phone) || got.MobileActiveTaskViewId != "native_view_board" {
		t.Fatalf("phone views = %d active %q", len(got.MobileTaskViews), got.MobileActiveTaskViewId)
	}
	if got.MobileTaskViews[3].RenderMode != models.RenderModeKanban {
		t.Fatalf("board view = %+v", got.MobileTaskViews[3])
	}
	if len(got.TaskViews) != 4 || got.ActiveTaskViewId != "view_task_list" {
		t.Fatalf("web views changed: %d active %q", len(got.TaskViews), got.ActiveTaskViewId)
	}

	// An active id that names no phone view, and more than 20 views, fail.
	got.MobileActiveTaskViewId = "view_task_list"
	if _, err := f.svc.UpdateConfig(got); err == nil || !strings.Contains(err.Error(), "phone views") {
		t.Fatalf("foreign active id: %v", err)
	}
	got.MobileActiveTaskViewId = ""
	many := models.TaskViews{}
	for i := 0; i <= models.MaxTaskViews; i++ {
		v := phone[0]
		v.ID = fmt.Sprintf("native_view_%d", i)
		many = append(many, v)
	}
	got.MobileTaskViews = many
	if _, err := f.svc.UpdateConfig(got); err == nil {
		t.Fatal("more than the maximum phone views were saved")
	}
}
