package workspace

import (
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"

	_ "timely-api/internal/database" // sets goose's embedded migrations

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const positionsMigration = 20261014090000

// The migration that adds position numbers existing statuses in the order a
// new workspace creates its defaults, even after an edit moved one in the
// heap, then by creation day; labels and fields keep their creation day order.
func TestIntegrationPositionsMigrationBackfillsCreationOrder(t *testing.T) {
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
	schema := "workspace_mig_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err = root.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec("DROP SCHEMA " + schema + " CASCADE"); sqlDB, _ := root.DB(); sqlDB.Close() })
	q.Set("search_path", schema+",public")
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { sqlDB.Close() })
	goose.SetTableName(schema + ".goose_db_version")
	t.Cleanup(func() { goose.SetTableName("goose_db_version") })
	if err = goose.UpTo(sqlDB, ".", positionsMigration-1); err != nil {
		t.Fatal(err)
	}

	exec := func(sql string, args ...any) {
		t.Helper()
		if err := db.Exec(sql, args...).Error; err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO users (id, email, password) VALUES ('usr_mig', 'mig@example.invalid', 'x')`)
	exec(`INSERT INTO workspaces (id, name, user_id, created_at, updated_at) VALUES ('ws_mig', 'Home', 'usr_mig', '2026-09-01', '2026-09-01')`)
	// Defaults inserted in a shuffled order, as random ids would sort them.
	for _, name := range []string{"Canceled", "Todo", "Blocked", "Backlog", "Completed", "In Progress"} {
		exec(`INSERT INTO statuses (id, name, color, workspace_id, created_at, updated_at) VALUES (?, ?, '#888888', 'ws_mig', '2026-09-01', '2026-09-01')`, "tst_"+uuid.NewString(), name)
	}
	exec(`INSERT INTO statuses (id, name, color, workspace_id, created_at, updated_at) VALUES ('tst_review', 'Review', '#888888', 'ws_mig', '2026-09-03', '2026-09-03')`)
	exec(`INSERT INTO statuses (id, name, color, workspace_id, created_at, updated_at) VALUES ('tst_waiting', 'Waiting', '#888888', 'ws_mig', '2026-09-02', '2026-09-02')`)
	exec(`UPDATE statuses SET updated_at = '2026-09-04' WHERE name = 'Todo'`)
	exec(`INSERT INTO lables (id, name, color, workspace_id, created_at, updated_at) VALUES ('lbl_b', 'Later', '#888888', 'ws_mig', '2026-09-05', '2026-09-05')`)
	exec(`INSERT INTO lables (id, name, color, workspace_id, created_at, updated_at) VALUES ('lbl_a', 'Bug', '#888888', 'ws_mig', '2026-09-02', '2026-09-02')`)
	exec(`INSERT INTO custom_fields (id, name, workspace_id, created_at, updated_at, type) VALUES ('cf_b', 'Cost', 'ws_mig', '2026-09-06', '2026-09-06', 'text')`)
	exec(`INSERT INTO custom_fields (id, name, workspace_id, created_at, updated_at, type) VALUES ('cf_a', 'Owner', 'ws_mig', '2026-09-02', '2026-09-02', 'text')`)

	if err = goose.UpTo(sqlDB, ".", positionsMigration); err != nil {
		t.Fatal(err)
	}
	names := func(table string) []string {
		t.Helper()
		var out []string
		if err := db.Table(table).Where("workspace_id = ?", "ws_mig").Order("position").Pluck("name", &out).Error; err != nil {
			t.Fatal(err)
		}
		return out
	}
	if got, want := names("statuses"), []string{"Backlog", "Todo", "In Progress", "Blocked", "Completed", "Canceled", "Waiting", "Review"}; !reflect.DeepEqual(got, want) {
		t.Errorf("statuses = %v, want %v", got, want)
	}
	if got, want := names("lables"), []string{"Bug", "Later"}; !reflect.DeepEqual(got, want) {
		t.Errorf("labels = %v, want %v", got, want)
	}
	if got, want := names("custom_fields"), []string{"Owner", "Cost"}; !reflect.DeepEqual(got, want) {
		t.Errorf("custom fields = %v, want %v", got, want)
	}
}
