package workspace

import (
	"testing"

	"timely-api/internal/models"
)

// Deleting a workspace took its tasks and projects (ON DELETE CASCADE) but
// left their search index rows, with their text, behind for good.
func TestIntegrationDeletingAWorkspaceDropsItsItemsIndexRows(t *testing.T) {
	f := newFixture(t)
	second, err := f.svc.Create(&models.Workspace{Name: "Second", UserID: &f.owner})
	must(t, err)
	kept := models.Task{ID: "task-kept", UserID: &f.owner, Name: "Kept", WorkspaceID: &second.ID}
	must(t, f.db.Create(&kept).Error)

	row := func(id, user, kind, entity string) models.Embedding {
		return models.Embedding{ID: id, UserID: user, EntityKind: kind, EntityID: entity, Content: "Falcon orphan secret plan", ContentHash: id, Model: "m"}
	}
	// The cascade already removed these items (AutoMigrate has no cascade,
	// so the test starts from that point): only their rows are left.
	for _, e := range []models.Embedding{
		row("e-task", f.owner, "task", "task-gone"),
		row("e-project", f.owner, "project", "project-gone"),
		row("e-doc", f.owner, "doc", "doc-gone"),
		row("e-kept", f.owner, "task", kept.ID),
		row("e-other", f.other, "task", "task-gone-elsewhere"),
	} {
		must(t, f.db.Create(&e).Error)
	}

	// AutoMigrate omits the production ON DELETE CASCADE: clear what would
	// block the workspace delete.
	for _, child := range []any{&models.Status{}, &models.Lable{}, &models.CustomField{}} {
		must(t, f.db.Where("workspace_id = ?", f.ws).Delete(child).Error)
	}
	must(t, f.svc.Delete(f.owner, f.ws))

	if n := count(t, f.db, &models.Embedding{}, "user_id = ? AND entity_id IN ?", f.owner, []string{"task-gone", "project-gone", "doc-gone"}); n != 0 {
		t.Fatalf("%d index rows of deleted items are left", n)
	}
	if count(t, f.db, &models.Embedding{}, "id = ?", "e-kept") != 1 {
		t.Fatal("the index row of a task in another workspace was deleted")
	}
	if count(t, f.db, &models.Embedding{}, "id = ?", "e-other") != 1 {
		t.Fatal("another account's index rows were touched")
	}
}
