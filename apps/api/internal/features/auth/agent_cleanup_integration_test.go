package auth

import (
	"net/url"
	"os"
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

// Deleting an account removes its pending agent session deletes: the table
// has no foreign key to users, and the account's agent home goes with it,
// so no worker would ever take them (review round 5).
func TestIntegrationDeleteUserRemovesAgentSessionForgets(t *testing.T) {
	file := os.Getenv("CHAT_TEST_ENV")
	if file == "" {
		t.Skip("run make test-chat-integration")
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
	schema := "auth_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err = goose.Up(sqlDB, "."); err != nil {
		t.Fatal(err)
	}
	for _, uid := range []string{"usr_gone", "usr_kept"} {
		for _, q := range []string{
			`INSERT INTO users (id, email, name, password, created_at, updated_at) VALUES (?, ? || '@example.invalid', 'x', 'x', now(), now())`,
			`INSERT INTO agent_session_forgets (user_id, conversation_id) VALUES (?, 'chat_' || ?)`,
		} {
			args := []any{uid, uid}
			if err := db.Exec(q, args...).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := NewUserRepository(db).DeleteUser("usr_gone"); err != nil {
		t.Fatal(err)
	}
	var gone, kept int64
	db.Raw(`SELECT count(*) FROM agent_session_forgets WHERE user_id = 'usr_gone'`).Scan(&gone)
	db.Raw(`SELECT count(*) FROM agent_session_forgets WHERE user_id = 'usr_kept'`).Scan(&kept)
	if gone != 0 || kept != 1 {
		t.Fatalf("agent_session_forgets after delete: deleted account %d, other account %d", gone, kept)
	}
}
