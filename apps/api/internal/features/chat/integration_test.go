package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/agent"
	"timely-api/internal/models"

	"github.com/joho/godotenv"
	"github.com/labstack/echo/v5"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type testItem struct {
	ID    string `gorm:"primaryKey"`
	Value string
}

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
	schema := "chat_test_" + strings.ReplaceAll(id(""), "-", "")
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
	if err = db.AutoMigrate(&Conversation{}, &ImageAttachment{}, &models.Sheet{}, &models.Notification{}, &testItem{}); err != nil {
		t.Fatal(err)
	}
	// Apply the production notification constraint migration, so this test also
	// catches category mismatches between GORM models and the actual database.
	migration, err := os.ReadFile("../../../migrations/20260928120602_agent_notification_category.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Exec(strings.Split(string(migration), "-- +goose Down")[0]).Error; err != nil {
		t.Fatal(err)
	}
	return db
}
func runFixture(t *testing.T, db *gorm.DB, steps []Step) Conversation {
	t.Helper()
	c := Conversation{ID: id("chat_"), UserID: "user-a", Title: "Test", Status: "running", Phase: "apply", Lease: "test-lease", Plan: steps, Context: []ContextChip{}, Messages: []Message{}, Snapshots: []Snapshot{}, Transcript: []WireMessage{}}
	if err := db.Create(&c).Error; err != nil {
		t.Fatal(err)
	}
	return c
}
func TestIntegrationAtomicCheckpointAndRetry(t *testing.T) {
	db := integrationDB(t)
	fail := true
	s := New(db, nil, nil)
	s.factory = func(tx *gorm.DB) agent.Catalog {
		return agent.Catalog{"create_workspace": {Call: func(ctx context.Context, uid string, args json.RawMessage) (any, error) {
			item := testItem{ID: id("item_"), Value: string(args)}
			if err := tx.Create(&item).Error; err != nil {
				return nil, err
			}
			if strings.Contains(string(args), "second") && fail {
				return nil, fmt.Errorf("simulated failure after database write")
			}
			return map[string]string{"id": item.ID}, nil
		}}}
	}
	c := runFixture(t, db, []Step{{Tool: "create_workspace", Summary: "first", Arguments: raw(map[string]string{"name": "first"}), Status: "pending"}, {Tool: "create_workspace", Summary: "second", Arguments: raw(map[string]string{"name": "second"}), Status: "pending"}})
	if err := s.apply(context.Background(), &c); err == nil {
		t.Fatal("expected failure")
	}
	var count int64
	db.Model(&testItem{}).Count(&count)
	if count != 1 {
		t.Fatalf("failed write wasn't rolled back: %d", count)
	}
	db.First(&c, "id = ?", c.ID)
	if c.Plan[0].Status != "done" || c.Plan[1].Status == "done" {
		t.Fatal("checkpoint mismatch")
	}
	fail = false
	if err := s.apply(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	db.Model(&testItem{}).Count(&count)
	if count != 2 {
		t.Fatalf("retry duplicated committed change: %d", count)
	}
	if c.Status != "idle" || !c.Unread {
		t.Fatal("missing completion")
	}
	db.Model(&models.Notification{}).Count(&count)
	if count != 1 {
		t.Fatal("missing notification")
	}
}
func TestIntegrationStaleProposalAndStoppedLease(t *testing.T) {
	db := integrationDB(t)
	s := New(db, nil, nil)
	writes := 0
	s.factory = func(tx *gorm.DB) agent.Catalog {
		return agent.Catalog{
			"get_sheet": {Call: func(context.Context, string, json.RawMessage) (any, error) {
				return map[string]string{"title": "Changed outside chat"}, nil
			}},
			"update_sheet": {Call: func(context.Context, string, json.RawMessage) (any, error) { writes++; return nil, nil }},
		}
	}
	c := runFixture(t, db, []Step{{Tool: "update_sheet", Summary: "Rename", Arguments: raw(map[string]string{"sheetId": "sheet"}), Status: "pending"}})
	c.Snapshots = []Snapshot{{Tool: "get_sheet", Arguments: raw(map[string]string{"sheetId": "sheet"}), Hash: "old"}}
	db.Save(&c)
	if err := s.apply(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	if writes != 0 || !c.ForceReview || c.Phase != "plan" || c.Status != "queued" {
		t.Fatal("stale proposal executed")
	}
	c = runFixture(t, db, []Step{{Tool: "update_sheet", Arguments: raw(map[string]string{}), Status: "pending"}})
	db.Model(&Conversation{}).Where("id = ?", c.ID).Updates(map[string]any{"status": "stopped", "lease": ""})
	if err := s.apply(context.Background(), &c); err == nil {
		t.Fatal("stopped lease accepted")
	}
	if writes != 0 {
		t.Fatal("stopped run wrote")
	}
}
func TestIntegrationAccountIsolationAndApprovalVersion(t *testing.T) {
	db := integrationDB(t)
	s := New(db, nil, nil)
	c := runFixture(t, db, []Step{})
	var other Conversation
	if err := s.find(db, "user-b", c.ID, &other); err == nil {
		t.Fatal("cross-account conversation readable")
	}
	c.Status = "approval"
	c.Revision = 4
	db.Save(&c)
	e := echo.New()
	request := httptest.NewRequest("POST", "/", strings.NewReader(`{"revision":3}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	// Exercise the actual protected route with a verified-user stand-in.
	g := e.Group("")
	g.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error { c.Set("userID", "user-a"); return next(c) }
	})
	s.Routes(g)

	request = httptest.NewRequest("POST", "/chats/"+c.ID+"/approve", strings.NewReader(`{"revision":3}`))
	request.Header.Set("Content-Type", "application/json")
	e.ServeHTTP(recorder, request)
	if recorder.Code != 409 {
		t.Fatalf("stale approval status %d", recorder.Code)
	}
	db.First(&c, "id = ?", c.ID)
	if c.Status != "approval" {
		t.Fatal("stale approval queued changes")
	}

}

func TestIntegrationLeaseRenewalAndStopCancelsProvider(t *testing.T) {
	db := integrationDB(t)
	s := New(db, nil, nil)
	c := runFixture(t, db, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); s.keepLease(ctx, cancel, c.UserID, c.ID, c.Lease, 5*time.Millisecond) }()
	deadline := time.Now().Add(time.Second)
	for {
		var row Conversation
		if err := db.First(&row, "id = ?", c.ID).Error; err != nil {
			t.Fatal(err)
		}
		if row.LeaseUntil != nil && row.LeaseUntil.After(time.Now().Add(2*time.Minute)) {
			if row.Revision != c.Revision {
				t.Fatal("heartbeat changed approval revision")
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("lease wasn't renewed")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if err := db.Model(&Conversation{}).Where("id = ?", c.ID).UpdateColumn("status", "stopped").Error; err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Stop did not cancel provider context")
	}
	if ctx.Err() == nil {
		t.Fatal("request still active")
	}
}
