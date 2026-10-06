package workspace

import (
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"

	"timely-api/internal/models"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func integrationDB(t *testing.T) *gorm.DB {
	t.Helper()
	file := os.Getenv("CHAT_TEST_ENV")
	if file == "" {
		t.Skip("set CHAT_TEST_ENV via make test-chat-integration for isolated PostgreSQL tests")
	}
	env, err := godotenv.Read(file)
	if err != nil {
		t.Fatal(err)
	}
	u := &url.URL{Scheme: "postgres", Host: env["DB_HOST"] + ":" + env["DB_PORT"], Path: env["DB_NAME"], User: url.UserPassword(env["DB_USER"], env["DB_PASSWORD"])}
	q := url.Values{"sslmode": []string{env["DB_SSLMODE"]}}
	u.RawQuery = q.Encode()
	root, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal("test database unavailable")
	}
	schema := "workspace_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err = root.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec("DROP SCHEMA " + schema + " CASCADE"); db, _ := root.DB(); db.Close() })
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB, _ := db.DB(); sqlDB.Close() })
	if err = db.AutoMigrate(&models.User{}, &models.Workspace{}, &models.Project{}, &models.Task{}, &models.Status{}, &models.Lable{}, &models.CustomField{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func count(t *testing.T, db *gorm.DB, model any, query string, args ...any) int64 {
	t.Helper()
	var n int64
	must(t, db.Model(model).Where(query, args...).Count(&n).Error)
	return n
}

type fixture struct {
	db      *gorm.DB
	svc     WorkspaceService
	owner   string
	other   string
	ws      string
	status  string
	label   string
	field   string
	otherWs string
}

// newFixture creates two accounts, one workspace each, and one status, label
// and custom field inside the owner's workspace.
func newFixture(t *testing.T) fixture {
	t.Helper()
	db := integrationDB(t)
	f := fixture{db: db, svc: NewWorkspaceService(NewWorkspaceRepository(db)), owner: "user-" + uuid.NewString(), other: "user-" + uuid.NewString()}
	for _, id := range []string{f.owner, f.other} {
		must(t, db.Create(&models.User{ID: id, Email: id + "@test.local"}).Error)
	}
	ws, err := f.svc.Create(&models.Workspace{Name: "Owner", UserID: &f.owner})
	must(t, err)
	f.ws = ws.ID
	otherWs, err := f.svc.Create(&models.Workspace{Name: "Other", UserID: &f.other})
	must(t, err)
	f.otherWs = otherWs.ID

	status, err := f.svc.CreateStatuses(f.owner, &models.Status{Name: "Review", Color: "#111111", WorkspaceID: f.ws})
	must(t, err)
	f.status = status.ID
	label, err := f.svc.CreateLabels(f.owner, &models.Lable{Name: "Bug", Color: "#222222", WorkspaceID: f.ws})
	must(t, err)
	f.label = label.ID
	field, err := f.svc.CreateCustomFields(f.owner, &models.CustomField{Name: "Estimate", Type: models.CustomFieldTypeNumber, WorkspaceID: f.ws})
	must(t, err)
	f.field = field.ID
	return f
}

func TestIntegrationWorkspaceCrossAccountIsNotFoundAndWritesNothing(t *testing.T) {
	f := newFixture(t)
	statuses := count(t, f.db, &models.Status{}, "workspace_id = ?", f.ws)
	labels := count(t, f.db, &models.Lable{}, "workspace_id = ?", f.ws)
	fields := count(t, f.db, &models.CustomField{}, "workspace_id = ?", f.ws)

	notFound := func(name string, err error) {
		t.Helper()
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("%s: want record not found, got %v", name, err)
		}
	}

	_, err := f.svc.GetWorkspaceById(f.other, f.ws)
	notFound("GetWorkspaceById", err)
	_, err = f.svc.UpdateWorkspace(f.other, f.ws, "Hijacked", nil)
	notFound("UpdateWorkspace", err)
	notFound("Delete", f.svc.Delete(f.other, f.ws))

	_, err = f.svc.CreateStatuses(f.other, &models.Status{Name: "Injected", WorkspaceID: f.ws})
	notFound("CreateStatuses", err)
	_, err = f.svc.UpdateStatuses(f.other, &models.Status{ID: f.status, Name: "Hijacked", WorkspaceID: f.ws})
	notFound("UpdateStatuses", err)
	notFound("DeleteStatuses", f.svc.DeleteStatuses(f.other, f.status, f.ws))

	_, err = f.svc.CreateLabels(f.other, &models.Lable{Name: "Injected", WorkspaceID: f.ws})
	notFound("CreateLabels", err)
	_, err = f.svc.UpdateLabels(f.other, &models.Lable{ID: f.label, Name: "Hijacked", WorkspaceID: f.ws})
	notFound("UpdateLabels", err)
	notFound("DeleteLabels", f.svc.DeleteLabels(f.other, f.label, f.ws))

	_, err = f.svc.CreateCustomFields(f.other, &models.CustomField{Name: "Injected", Type: models.CustomFieldTypeText, WorkspaceID: f.ws})
	notFound("CreateCustomFields", err)
	_, err = f.svc.UpdateCustomFields(f.other, &models.CustomField{ID: f.field, Name: "Hijacked", Type: models.CustomFieldTypeText, WorkspaceID: f.ws})
	notFound("UpdateCustomFields", err)
	notFound("DeleteCustomFields", f.svc.DeleteCustomFields(f.other, f.field, f.ws))

	// Nothing the other account attempted changed the owner's data.
	ws, err := f.svc.GetWorkspaceById(f.owner, f.ws)
	must(t, err)
	if ws.Name != "Owner" {
		t.Fatalf("workspace renamed across accounts: %q", ws.Name)
	}
	if got := count(t, f.db, &models.Status{}, "workspace_id = ?", f.ws); got != statuses {
		t.Fatalf("statuses changed: %d -> %d", statuses, got)
	}
	if got := count(t, f.db, &models.Lable{}, "workspace_id = ?", f.ws); got != labels {
		t.Fatalf("labels changed: %d -> %d", labels, got)
	}
	if got := count(t, f.db, &models.CustomField{}, "workspace_id = ?", f.ws); got != fields {
		t.Fatalf("custom fields changed: %d -> %d", fields, got)
	}
	if count(t, f.db, &models.Status{}, "id = ? AND name = ?", f.status, "Review") != 1 ||
		count(t, f.db, &models.Lable{}, "id = ? AND name = ?", f.label, "Bug") != 1 ||
		count(t, f.db, &models.CustomField{}, "id = ? AND name = ?", f.field, "Estimate") != 1 {
		t.Fatal("child rows were modified across accounts")
	}
}

func TestIntegrationWorkspaceCannotReachOwnChildThroughForeignWorkspace(t *testing.T) {
	f := newFixture(t)
	// The caller owns otherWs, but names the owner's child ids under it.
	// The call succeeds against the caller's own workspace and must not touch
	// rows that live in the owner's workspace.
	must(t, f.svc.DeleteStatuses(f.other, f.status, f.otherWs))
	must(t, f.svc.DeleteLabels(f.other, f.label, f.otherWs))
	must(t, f.svc.DeleteCustomFields(f.other, f.field, f.otherWs))
	// Updates match on id and workspace_id too. They don't report a missing
	// row, so only assert that nothing was written.
	_, err := f.svc.UpdateStatuses(f.other, &models.Status{ID: f.status, Name: "Hijacked", Color: "#999999", WorkspaceID: f.otherWs})
	must(t, err)
	_, err = f.svc.UpdateLabels(f.other, &models.Lable{ID: f.label, Name: "Hijacked", Color: "#999999", WorkspaceID: f.otherWs})
	must(t, err)
	_, err = f.svc.UpdateCustomFields(f.other, &models.CustomField{ID: f.field, Name: "Hijacked", Type: models.CustomFieldTypeText, WorkspaceID: f.otherWs})
	must(t, err)
	if count(t, f.db, &models.Status{}, "id = ? AND name = ? AND color = ?", f.status, "Review", "#111111") != 1 ||
		count(t, f.db, &models.Lable{}, "id = ? AND name = ? AND color = ?", f.label, "Bug", "#222222") != 1 ||
		count(t, f.db, &models.CustomField{}, "id = ? AND name = ? AND type = ?", f.field, "Estimate", models.CustomFieldTypeNumber) != 1 {
		t.Fatal("child rows modified or deleted through another workspace")
	}
}

func TestIntegrationWorkspaceSameAccountCallsWork(t *testing.T) {
	f := newFixture(t)

	ws, err := f.svc.UpdateWorkspace(f.owner, f.ws, "Renamed", nil)
	must(t, err)
	if ws.Name != "Renamed" {
		t.Fatalf("name = %q", ws.Name)
	}

	status, err := f.svc.UpdateStatuses(f.owner, &models.Status{ID: f.status, Name: "QA", Color: "#333333", WorkspaceID: f.ws})
	must(t, err)
	if status.Name != "QA" || count(t, f.db, &models.Status{}, "id = ? AND name = ?", f.status, "QA") != 1 {
		t.Fatal("status not updated")
	}
	label, err := f.svc.UpdateLabels(f.owner, &models.Lable{ID: f.label, Name: "Defect", Color: "#444444", WorkspaceID: f.ws})
	must(t, err)
	if label.Name != "Defect" || count(t, f.db, &models.Lable{}, "id = ? AND name = ?", f.label, "Defect") != 1 {
		t.Fatal("label not updated")
	}
	field, err := f.svc.UpdateCustomFields(f.owner, &models.CustomField{ID: f.field, Name: "Points", Type: models.CustomFieldTypeNumber, WorkspaceID: f.ws})
	must(t, err)
	if field.Name != "Points" || count(t, f.db, &models.CustomField{}, "id = ? AND name = ?", f.field, "Points") != 1 {
		t.Fatal("custom field not updated")
	}

	must(t, f.svc.DeleteStatuses(f.owner, f.status, f.ws))
	must(t, f.svc.DeleteLabels(f.owner, f.label, f.ws))
	must(t, f.svc.DeleteCustomFields(f.owner, f.field, f.ws))
	if count(t, f.db, &models.Status{}, "id = ?", f.status) != 0 ||
		count(t, f.db, &models.Lable{}, "id = ?", f.label) != 0 ||
		count(t, f.db, &models.CustomField{}, "id = ?", f.field) != 0 {
		t.Fatal("children not deleted")
	}

	// The last workspace cannot be deleted, so add a second one first.
	_, err = f.svc.Create(&models.Workspace{Name: "Second", UserID: &f.owner})
	must(t, err)
	// AutoMigrate omits the production ON DELETE CASCADE, so clear the default
	// statuses that would otherwise block the workspace delete.
	must(t, f.db.Where("workspace_id = ?", f.ws).Delete(&models.Status{}).Error)
	must(t, f.svc.Delete(f.owner, f.ws))
	if _, err := f.svc.GetWorkspaceById(f.owner, f.ws); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("workspace should be gone, got %v", err)
	}
}
