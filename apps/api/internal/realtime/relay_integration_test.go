package realtime

import (
	"context"
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
)

// relaySchema opens a new schema holding one table, things, whose trigger
// announces writes on channel the way the chat and bot triggers do.
func relaySchema(t *testing.T, channel string) *gorm.DB {
	t.Helper()
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
	schema := "relay_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err = root.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec("DROP SCHEMA " + schema + " CASCADE"); sqlDB, _ := root.DB(); sqlDB.Close() })
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB, _ := db.DB(); sqlDB.Close() })
	for _, stmt := range []string{
		`CREATE TABLE things (id TEXT PRIMARY KEY, user_id TEXT, note TEXT NOT NULL DEFAULT '')`,
		`CREATE FUNCTION notify_thing() RETURNS trigger AS $$
		BEGIN
			PERFORM pg_notify('` + channel + `', json_build_object('schema', TG_TABLE_SCHEMA, 'user', NEW.user_id, 'id', NEW.id)::text);
			RETURN NULL;
		END; $$ LANGUAGE plpgsql`,
		`CREATE TRIGGER things_notify AFTER INSERT OR UPDATE ON things FOR EACH ROW EXECUTE FUNCTION notify_thing()`,
	} {
		if err := db.Exec(stmt).Error; err != nil {
			t.Fatal(err)
		}
	}
	return db
}

func TestIntegrationRelayPG(t *testing.T) {
	channel := "relay_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	db := relaySchema(t, channel)
	other := relaySchema(t, channel)
	hub := NewHub()
	defer hub.Close()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); RelayPG(ctx, db, hub, channel, "things", "thing") }()
	mine, stopMine := hub.Subscribe("user-a", "things")
	defer stopMine()
	theirs, stopTheirs := hub.Subscribe("user-b", "things")
	defer stopTheirs()
	otherTopic, stopOtherTopic := hub.Subscribe("user-a", "chats")
	defer stopOtherTopic()

	next := func(within time.Duration) (Event, bool) {
		select {
		case ev := <-mine:
			return ev, true
		case <-time.After(within):
			return Event{}, false
		}
	}
	quiet := func() {
		for {
			if _, ok := next(300 * time.Millisecond); !ok {
				return
			}
		}
	}
	// hear touches the row until the relay, listening in the background,
	// passes a change on.
	hear := func(id string) {
		t.Helper()
		for deadline := time.Now().Add(10 * time.Second); ; {
			if ev, ok := next(100 * time.Millisecond); ok {
				if ev != (Event{Type: "changed", Kind: "thing", ID: id}) {
					t.Fatalf("unexpected event %#v", ev)
				}
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("the relay never heard a change")
			}
			if err := db.Exec("UPDATE things SET note = ? WHERE id = ?", uuid.NewString(), id).Error; err != nil {
				t.Fatal(err)
			}
		}
		quiet()
	}

	if err := db.Exec("INSERT INTO things (id, user_id) VALUES ('t1', 'user-a')").Error; err != nil {
		t.Fatal(err)
	}
	hear("t1")

	// A rolled-back transaction announces nothing.
	tx := db.Begin()
	tx.Exec("UPDATE things SET note = 'rehearsed' WHERE id = 't1'")
	tx.Rollback()
	if ev, ok := next(500 * time.Millisecond); ok {
		t.Fatalf("rolled-back change sent %#v", ev)
	}
	// Another schema on the same channel (another DB_SCHEMA) is skipped, and
	// so is a notice that names nobody.
	if err := other.Exec("INSERT INTO things (id, user_id) VALUES ('t1', 'user-a')").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO things (id, user_id) VALUES ('t2', NULL)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("SELECT pg_notify(?, 'not json')", channel).Error; err != nil {
		t.Fatal(err)
	}
	if ev, ok := next(500 * time.Millisecond); ok {
		t.Fatalf("skipped notice sent %#v", ev)
	}

	// The listening connection is lost; the relay listens again and carries on.
	var killed int64
	if err := db.Raw("SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND query ILIKE ?", "LISTEN %"+channel+"%").Scan(&killed).Error; err != nil {
		t.Fatal(err)
	}
	if killed != 1 {
		t.Fatalf("listening connections %d", killed)
	}
	hear("t1")

	select {
	case ev := <-theirs:
		t.Fatalf("another account heard %#v", ev)
	case ev := <-otherTopic:
		t.Fatalf("another topic heard %#v", ev)
	default:
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("RelayPG did not stop with its context")
	}
}
