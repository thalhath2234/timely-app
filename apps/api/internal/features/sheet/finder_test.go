package sheet

import (
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"timely-api/internal/models"
)

// integrationDB opens an isolated temporary PostgreSQL schema holding the
// sheet tables, like the chat integration tests.
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
	schema := "sheet_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err = db.AutoMigrate(&models.Sheet{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestIntegrationRowFinderSearchesOnlyTheAccountsActiveSheets(t *testing.T) {
	db := integrationDB(t)
	if err := db.Create(&models.Workspace{ID: "workspace", Name: "Personal"}).Error; err != nil {
		t.Fatal(err)
	}
	columns := models.SheetColumns{{ID: "merchant", Name: "Merchant", Type: "text"}}
	row := func(id, merchant string) models.SheetRow {
		return models.SheetRow{ID: id, Cells: map[string]string{"merchant": merchant}}
	}
	archived := time.Now().UTC().Format(time.RFC3339)
	for _, sh := range []models.Sheet{
		{ID: "workbook", UserID: "user-a", WorkspaceID: "workspace", Title: "Workbook", Tabs: models.SheetTabs{
			{ID: "t1", Name: "Expenses", Columns: columns, Rows: models.SheetRows{row("r1", "Corner Shop"), row("r2", "Other")}},
			{ID: "t2", Name: "Notes", Columns: columns, Rows: models.SheetRows{row("r3", "Corner Shop")}},
		}},
		{ID: "legacy", UserID: "user-a", WorkspaceID: "workspace", Title: "Legacy", Columns: columns, Rows: models.SheetRows{row("r4", "Corner Shop")}},
		{ID: "old", UserID: "user-a", WorkspaceID: "workspace", Title: "Old", ArchivedAt: &archived, Columns: columns, Rows: models.SheetRows{row("r5", "Corner Shop")}},
		{ID: "foreign", UserID: "user-b", WorkspaceID: "workspace", Title: "Foreign", Columns: columns, Rows: models.SheetRows{row("r6", "Corner Shop")}},
	} {
		if err := db.Create(&sh).Error; err != nil {
			t.Fatal(err)
		}
	}
	finder := NewRowFinder(NewSheetRepository(db))
	match := func(_ models.Sheet, tab models.SheetTab) []models.SheetRow {
		var rows []models.SheetRow
		for _, r := range tab.Rows {
			if r.Cells["merchant"] == "Corner Shop" {
				rows = append(rows, r)
			}
		}
		return rows
	}
	found, err := finder.FindRows("user-a", match)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, m := range found {
		got[m.Row.ID] = m.Sheet.ID + "/" + m.Tab.ID
	}
	want := map[string]string{"r1": "workbook/t1", "r3": "workbook/t2", "r4": "legacy/primary"}
	if len(got) != len(want) || len(found) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for id, place := range want {
		if got[id] != place {
			t.Fatalf("row %s found in %q, want %q (all: %v)", id, got[id], place, got)
		}
	}
	if none, err := finder.FindRows("nobody", match); err != nil || len(none) != 0 {
		t.Fatalf("unknown account saw %v %v", none, err)
	}
}
