package portability

import (
	"encoding/json"
	"testing"

	"timely-api/internal/models"

	"gorm.io/gorm"
)

// seedAccountBasics gives an account what registration and onboarding do:
// its settings row (when withConfig), a workspace and a status.
func seedAccountBasics(t *testing.T, db *gorm.DB, uid string, withConfig bool) {
	t.Helper()
	rows := []any{
		&models.Workspace{ID: "ws_" + uid, Name: "Home", UserID: &uid},
		&models.Status{ID: "tst_" + uid, Name: "Todo", WorkspaceID: "ws_" + uid},
	}
	if withConfig {
		rows = append([]any{&models.Config{ID: "cfg_" + uid, UserID: uid, TaskViews: models.DefaultTaskViews(), ActiveTaskViewId: "view_task_list"}}, rows...)
	}
	for _, row := range rows {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
}

// GB1: an empty or hand-built backup used to be restored, deleting the
// account's settings and workspaces; GET and PUT /config then failed and the
// app sent the person back to onboarding. It is refused now, and the account
// keeps its data.
func TestIntegrationRestoreRefusesABackupWithoutTheAccountBasics(t *testing.T) {
	db := migratedDB(t)
	const uid = "usr_portability_basics"
	if err := db.Create(&models.User{ID: uid, Email: "basics@example.invalid", Password: "not-a-real-hash"}).Error; err != nil {
		t.Fatal(err)
	}
	seedAccountBasics(t, db, uid, true)
	service := NewService(db, nil)

	reindexed := 0
	service.SetAfterRestore(func(string) { reindexed++ })
	for name, rows := range map[string]map[string][]json.RawMessage{
		"empty":      {},
		"tasks only": {"tasks": {json.RawMessage(`{"id":"tsk_x","name":"x","user_id":"` + uid + `"}`)}},
	} {
		if _, err := service.Restore(uid, &Backup{Format: backupFormat, SchemaVersion: schemaVersion, Rows: rows}); err == nil {
			t.Fatalf("%s backup restored", name)
		}
	}
	// A settings row without an owner passes the first check but would leave
	// the account without settings: the whole restore is rolled back.
	backup, err := service.Export(uid)
	if err != nil {
		t.Fatal(err)
	}
	var cfg map[string]any
	_ = json.Unmarshal(backup.Rows["configs"][0], &cfg)
	delete(cfg, "user_id")
	backup.Rows["configs"][0], _ = json.Marshal(cfg)
	if _, err := service.Restore(uid, backup); err == nil {
		t.Fatal("restore left the account without settings")
	}

	var configs, workspaces, statuses int64
	db.Model(&models.Config{}).Where("user_id = ?", uid).Count(&configs)
	db.Model(&models.Workspace{}).Where("user_id = ?", uid).Count(&workspaces)
	db.Model(&models.Status{}).Where("workspace_id = ?", "ws_"+uid).Count(&statuses)
	if configs != 1 || workspaces != 1 || statuses != 1 {
		t.Fatalf("a refused restore changed the account: configs %d workspaces %d statuses %d", configs, workspaces, statuses)
	}
	if reindexed != 0 {
		t.Fatal("a refused restore ran the after-restore step")
	}
}
