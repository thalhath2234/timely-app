package bots

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	_ "timely-api/internal/database" // sets goose's embedded migrations
	"timely-api/internal/features/bots/fetch"
	"timely-api/internal/models"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/labstack/echo/v5"
	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// migratedDB runs the full goose chain in an isolated schema, so the CHECK
// constraints and partial indexes are the real ones.
func migratedDB(t *testing.T) *gorm.DB {
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
	schema := "bots_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	return db
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func addUser(t *testing.T, db *gorm.DB) string {
	t.Helper()
	id := "usr_" + uuid.NewString()
	must(t, db.Create(&models.User{ID: id, Email: id + "@test.local", Password: "x"}).Error)
	return id
}

var botNow = time.Date(2026, 11, 6, 9, 30, 0, 0, time.UTC)

func testService(db *gorm.DB) *Service {
	s := New(db, nil)
	s.now = func() time.Time { return botNow }
	return s
}

func call(t *testing.T, s *Service, userID, method, path string, body any) (int, map[string]any) {
	t.Helper()
	e := echo.New()
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			c.Set("userID", userID)
			return next(c)
		}
	})
	s.Routes(e.Group(""))
	reader := strings.NewReader("")
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = strings.NewReader(string(raw))
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func pageBot(name string) map[string]any {
	return map[string]any{"name": name, "watches": []map[string]any{{"kind": "page", "url": "https://example.com/" + url.PathEscape(name)}}}
}

func watchRow(t *testing.T, db *gorm.DB, id string) Watch {
	t.Helper()
	var w Watch
	must(t, db.Where("id = ?", id).First(&w).Error)
	return w
}

func count(t *testing.T, db *gorm.DB, table, where string, args ...any) int64 {
	t.Helper()
	var n int64
	must(t, db.Table(table).Where(where, args...).Count(&n).Error)
	return n
}

func TestIntegrationBotsREST(t *testing.T) {
	db := migratedDB(t)
	me, other := addUser(t, db), addUser(t, db)
	s := testService(db)

	code, body := call(t, s, me, http.MethodPost, "/bots", map[string]any{
		"name": "  Phone   price ", "description": "The phone I want", "intervalMinutes": 360,
		"watches": []map[string]any{
			{"kind": "page", "url": "https://www.example.in/dp/B0C", "read": "product_price", "rules": []map[string]any{{"kind": "below", "threshold": 25000}}},
			{"kind": "price", "source": "crypto", "symbol": "btc", "currency": "inr"},
		},
	})
	if code != http.StatusCreated {
		t.Fatalf("create %d %v", code, body)
	}
	id, _ := body["id"].(string)
	watches, _ := body["watches"].([]any)
	if !strings.HasPrefix(id, "bot_") || body["name"] != "Phone price" || body["status"] != "active" || body["origin"] != "app" ||
		body["intervalMinutes"] != float64(360) || body["desktop"] != true || body["phone"] != true || body["urgent"] != false ||
		body["pauseReason"] != nil || len(watches) != 2 {
		t.Fatalf("create body %v", body)
	}
	if next, _ := time.Parse(time.RFC3339, fmt.Sprint(body["nextCheckAt"])); !next.Equal(botNow) {
		t.Fatalf("next check %v", body["nextCheckAt"])
	}
	w0 := watches[0].(map[string]any)
	rules := w0["rules"].([]any)
	rule := rules[0].(map[string]any)
	if !strings.HasPrefix(fmt.Sprint(rule["id"]), "brl_") || rule["stepPercent"] != float64(5) || w0["health"].(map[string]any)["line"] != "Not checked yet" {
		t.Fatalf("watch %v", w0)
	}
	w1 := watches[1].(map[string]any)
	if w1["source"] != "coinbase" || w1["symbol"] != "BTC" || w1["currency"] != "INR" {
		t.Fatalf("price watch %v", w1)
	}
	priceID := fmt.Sprint(w1["id"])
	if w := watchRow(t, db, priceID); !w.BaselinePending || w.ConfigVersion != 1 || len(w.RuleState) != 0 || w.UserID != me {
		t.Fatalf("stored watch %+v", w)
	}

	for _, c := range []struct {
		body any
		want string
	}{
		{map[string]any{"name": " ", "watches": []map[string]any{{"kind": "page", "url": "https://e.com"}}}, "Give the bot a name"},
		{map[string]any{"name": "x", "watches": []map[string]any{}}, "Give the bot something to watch"},
		{map[string]any{"name": "x", "watches": []map[string]any{{"kind": "page", "url": "http://10.0.0.1/"}}}, "Timely only reads public web addresses"},
		{map[string]any{"name": "x", "intervalMinutes": 10, "watches": []map[string]any{{"kind": "feed", "url": "https://e.com/rss"}}}, "Pages and feeds are checked every 15 minutes at most"},
		{map[string]any{"name": "x", "intervalMinutes": 60, "watches": []map[string]any{{"kind": "page", "url": "https://e.com", "read": "product_price"}}}, "Shop prices are checked every 6 hours at most"},
		{map[string]any{"name": "x", "judgeMode": "ai", "watches": []map[string]any{{"kind": "page", "url": "https://e.com"}}}, "AI judging arrives in a later version"},
		{map[string]any{"name": "PHONE PRICE", "watches": []map[string]any{{"kind": "page", "url": "https://e.com"}}}, `You already have a bot called "Phone price"`},
	} {
		if code, body := call(t, s, me, http.MethodPost, "/bots", c.body); code != http.StatusBadRequest || !strings.Contains(fmt.Sprint(body["message"]), c.want) {
			t.Errorf("%v: %d %v", c.body, code, body)
		}
	}
	if code, _ := call(t, s, me, http.MethodPost, "/bots", "not an object"); code != http.StatusBadRequest {
		t.Fatalf("bad json %d", code)
	}
	// Another account may use the same name.
	if code, body := call(t, s, other, http.MethodPost, "/bots", pageBot("Phone price")); code != http.StatusCreated {
		t.Fatalf("other account %d %v", code, body)
	}

	code, body = call(t, s, me, http.MethodGet, "/bots", nil)
	if list, _ := body["bots"].([]any); code != 200 || len(list) != 1 {
		t.Fatalf("list %d %v", code, body)
	}
	code, body = call(t, s, me, http.MethodGet, "/bots/"+id, nil)
	if code != 200 || body["id"] != id || body["checks"] == nil || len(body["checks"].([]any)) != 0 || len(body["lessons"].([]any)) != 0 || len(body["prices"].([]any)) != 0 {
		t.Fatalf("detail %d %v", code, body)
	}
	if code, body := call(t, s, me, http.MethodGet, "/bots/"+url.PathEscape("phone PRICE"), nil); code != 200 || body["id"] != id {
		t.Fatalf("by name %d %v", code, body)
	}
	if code, body := call(t, s, other, http.MethodGet, "/bots/"+id, nil); code != 404 || body["message"] != "Bot not found" {
		t.Fatalf("other account reads %d %v", code, body)
	}

	// The findings route is not read as a Bot id.
	day := botNow.Format(dayLayout)
	must(t, db.Create(&Finding{ID: "bfd_1", BotID: id, UserID: me, Kind: "price", Title: "Below 25,000", Urgency: "normal", OutsideData: true, CreatedAt: botNow}).Error)
	must(t, db.Create(&Finding{ID: "bfd_2", BotID: id, UserID: me, Kind: "price", Title: "Older", Urgency: "normal", OutsideData: true, CreatedAt: botNow.Add(-48 * time.Hour)}).Error)
	code, body = call(t, s, me, http.MethodGet, "/bots/findings", nil)
	if items, _ := body["items"].([]any); code != 200 || len(items) != 2 || items[0].(map[string]any)["id"] != "bfd_1" {
		t.Fatalf("findings %d %v", code, body)
	}
	code, body = call(t, s, me, http.MethodGet, "/bots/findings?botId="+id+"&since="+url.QueryEscape(botNow.Add(-time.Hour).Format(time.RFC3339))+"&limit=500", nil)
	if items, _ := body["items"].([]any); code != 200 || len(items) != 1 {
		t.Fatalf("findings since %d %v", code, body)
	}
	if code, _ := call(t, s, me, http.MethodGet, "/bots/findings?botId=bot_missing", nil); code != 404 {
		t.Fatalf("findings for a missing bot %d", code)
	}
	if code, body := call(t, s, other, http.MethodGet, "/bots/findings", nil); code != 200 || len(body["items"].([]any)) != 0 {
		t.Fatalf("other account findings %d %v", code, body)
	}

	// A name-only edit keeps every watch as it is.
	must(t, db.Model(&Watch{}).Where("id = ?", priceID).Updates(map[string]any{
		"baseline_pending": false, "rule_state": `{"x":{"armed":true}}`, "etag": `"v1"`, "validators_url": "x",
		"last_reading": `{"kind":"price","price":5800000,"currency":"INR","at":"2026-11-06T09:00:00Z"}`,
	}).Error)
	must(t, db.Create(&PriceDay{WatchID: priceID, Day: botNow.Truncate(24 * time.Hour), BotID: id, UserID: me, Currency: "INR", Points: jsonList[[2]float64]{{1, 2}}}).Error)
	if code, body := call(t, s, me, http.MethodPatch, "/bots/"+id, map[string]any{"name": "Phone and BTC", "urgent": true}); code != 200 || body["name"] != "Phone and BTC" || body["urgent"] != true {
		t.Fatalf("rename %d %v", code, body)
	}
	if w := watchRow(t, db, priceID); w.BaselinePending || w.ConfigVersion != 1 || w.ETag == "" || w.LastReading == nil {
		t.Fatalf("rename touched the watch %+v", w)
	}
	code, body = call(t, s, me, http.MethodGet, "/bots/"+id, nil)
	if prices, _ := body["prices"].([]any); code != 200 || len(prices) != 1 || prices[0].(map[string]any)["day"] != day {
		t.Fatalf("detail prices %d %v", code, body)
	}

	// The same watches sent back unchanged (rules left out) change nothing.
	keep := []map[string]any{{"id": w0["id"], "kind": "page", "url": "https://www.example.in/dp/B0C", "read": "product_price"}, {"id": priceID, "kind": "price", "source": "coinbase", "symbol": "BTC", "currency": "INR"}}
	if code, body := call(t, s, me, http.MethodPatch, "/bots/"+id, map[string]any{"watches": keep}); code != 200 {
		t.Fatalf("same watches %d %v", code, body)
	}
	if w := watchRow(t, db, priceID); w.BaselinePending || w.ConfigVersion != 1 {
		t.Fatalf("unchanged watch was reset %+v", w)
	}

	// A symbol change records a quiet baseline and drops the old series.
	keep[1]["symbol"] = "eth"
	code, body = call(t, s, me, http.MethodPatch, "/bots/"+id, map[string]any{"watches": keep})
	if code != 200 {
		t.Fatalf("edit %d %v", code, body)
	}
	w := watchRow(t, db, priceID)
	if !w.BaselinePending || w.ConfigVersion != 2 || len(w.RuleState) != 0 || w.ETag != "" || w.ValidatorsURL != "" || w.LastReading != nil || w.Symbol != "ETH" {
		t.Fatalf("edited watch %+v", w)
	}
	if n := count(t, db, "bot_price_days", "watch_id = ?", priceID); n != 0 {
		t.Fatalf("price days kept: %d", n)
	}

	// A rule-only change keeps the reading but starts the rules over.
	must(t, db.Model(&Watch{}).Where("id = ?", priceID).Updates(map[string]any{"baseline_pending": false,
		"last_reading": `{"kind":"price","price":3000,"currency":"INR","at":"2026-11-06T09:00:00Z"}`}).Error)
	keep[1]["rules"] = []map[string]any{{"kind": "above", "threshold": 400000}}
	if code, body := call(t, s, me, http.MethodPatch, "/bots/"+id, map[string]any{"watches": keep}); code != 200 {
		t.Fatalf("rules %d %v", code, body)
	}
	if w := watchRow(t, db, priceID); !w.BaselinePending || w.ConfigVersion != 3 || w.LastReading == nil || len(w.Rules) != 1 || w.Rules[0].Kind != RuleAbove {
		t.Fatalf("rule edit %+v", w)
	}

	// Add one watch and drop another; the interval rises to the new floor.
	code, body = call(t, s, me, http.MethodPatch, "/bots/"+id, map[string]any{"intervalMinutes": 30, "watches": []map[string]any{keep[1], {"kind": "feed", "url": "https://example.com/rss"}}})
	if ws, _ := body["watches"].([]any); code != 200 || len(ws) != 2 || ws[0].(map[string]any)["id"] != priceID || body["intervalMinutes"] != float64(30) {
		t.Fatalf("add and drop %d %v", code, body)
	}
	if n := count(t, db, "bot_watches", "id = ?", w0["id"]); n != 0 {
		t.Fatal("dropped watch kept")
	}
	if code, body := call(t, s, me, http.MethodPatch, "/bots/"+id, map[string]any{"watches": []map[string]any{{"id": "bw_missing", "kind": "feed", "url": "https://e.com/rss"}}}); code != 400 {
		t.Fatalf("unknown watch id %d %v", code, body)
	}
	if code, _ := call(t, s, other, http.MethodPatch, "/bots/"+id, map[string]any{"name": "mine"}); code != 404 {
		t.Fatalf("other account edits %d", code)
	}

	// Pause, resume and snooze.
	code, body = call(t, s, me, http.MethodPost, "/bots/"+id+"/pause", nil)
	if code != 200 || body["status"] != "paused" || body["pauseReason"] != "person" || body["nextCheckAt"] != nil {
		t.Fatalf("pause %d %v", code, body)
	}
	must(t, db.Model(&Bot{}).Where("id = ?", id).Updates(map[string]any{"strikes": 3}).Error)
	must(t, db.Model(&Watch{}).Where("bot_id = ?", id).Update("baseline_pending", false).Error)
	code, body = call(t, s, me, http.MethodPost, "/bots/"+id+"/resume", nil)
	if code != 200 || body["status"] != "active" || body["pauseReason"] != nil || body["strikes"] != float64(0) || body["nextCheckAt"] == nil {
		t.Fatalf("resume %d %v", code, body)
	}
	if n := count(t, db, "bot_watches", "bot_id = ? AND NOT baseline_pending", id); n != 0 {
		t.Fatalf("%d watches skip the baseline after resume", n)
	}
	code, body = call(t, s, me, http.MethodPost, "/bots/"+id+"/snooze", map[string]any{"for": "day"})
	if until, _ := time.Parse(time.RFC3339, fmt.Sprint(body["snoozedUntil"])); code != 200 || !until.Equal(botNow.Add(24*time.Hour)) {
		t.Fatalf("snooze %d %v", code, body)
	}
	if code, body := call(t, s, me, http.MethodPost, "/bots/"+id+"/snooze", map[string]any{"until": nil}); code != 200 || body["snoozedUntil"] != nil {
		t.Fatalf("unsnooze %d %v", code, body)
	}
	if code, _ := call(t, s, me, http.MethodPost, "/bots/"+id+"/snooze", map[string]any{"until": "2026-01-01T00:00:00Z"}); code != 400 {
		t.Fatalf("snooze into the past %d", code)
	}

	// Alerts sent today count; held ones do not.
	local := botNow.In(time.Local).Format(dayLayout)
	for i, held := range []string{"", "", "cap"} {
		must(t, db.Exec(`INSERT INTO bot_alerts (id, bot_id, user_id, kind, held, local_day, title) VALUES (?, ?, ?, 'alert', ?, ?, 'x')`, fmt.Sprintf("bal_%d", i), id, me, held, local).Error)
	}
	if code, body := call(t, s, me, http.MethodGet, "/bots/"+id, nil); code != 200 || body["alertsToday"] != float64(2) || len(body["alerts"].([]any)) != 3 {
		t.Fatalf("alerts today %d %v", code, body)
	}

	// Delete cascades to every child table.
	var checkID = "bchk_1"
	must(t, db.Create(&Check{ID: checkID, BotID: id, UserID: me, Trigger: "schedule", StartedAt: botNow, FinishedAt: botNow, Outcome: "baseline"}).Error)
	must(t, db.Create(&Lesson{ID: "bls_1", BotID: id, UserID: me, Text: "Only below 20,000", CreatedAt: botNow}).Error)
	must(t, db.Create(&PriceDay{WatchID: priceID, Day: botNow.Truncate(24 * time.Hour), BotID: id, UserID: me}).Error)
	if code, _ := call(t, s, other, http.MethodDelete, "/bots/"+id, nil); code != 404 {
		t.Fatalf("other account deletes %d", code)
	}
	if code, _ := call(t, s, me, http.MethodDelete, "/bots/"+id, nil); code != http.StatusNoContent {
		t.Fatalf("delete %d", code)
	}
	for _, table := range []string{"bots", "bot_watches", "bot_checks", "bot_alerts", "bot_findings", "bot_price_days", "bot_lessons"} {
		if n := count(t, db, table, "user_id = ?", me); n != 0 {
			t.Errorf("%s keeps %d rows", table, n)
		}
	}
	if code, _ := call(t, s, me, http.MethodDelete, "/bots/"+id, nil); code != 404 {
		t.Fatalf("delete twice %d", code)
	}
}

// The cap holds when many creates race: the account lock lets exactly 25 in.
func TestIntegrationBotCap(t *testing.T) {
	db := migratedDB(t)
	me := addUser(t, db)
	s := testService(db)
	var wg sync.WaitGroup
	var mu sync.Mutex
	codes := map[int]int{}
	for i := range 30 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.Create(context.Background(), me, Input{Name: fmt.Sprintf("Bot %d", i), Watches: []WatchInput{{Kind: "feed", URL: "https://example.com/rss"}}}, OriginApp)
			mu.Lock()
			defer mu.Unlock()
			var in *InputError
			switch {
			case err == nil:
				codes[201]++
			case errors.As(err, &in) && in.Message == "You can keep up to 25 bots":
				codes[400]++
			default:
				t.Errorf("create %d: %v", i, err)
			}
		}()
	}
	wg.Wait()
	if codes[201] != MaxBots || codes[400] != 30-MaxBots {
		t.Fatalf("results %v", codes)
	}
	if code, body := call(t, s, me, http.MethodPost, "/bots", pageBot("one more")); code != 400 || body["message"] != "You can keep up to 25 bots" {
		t.Fatalf("26th %d %v", code, body)
	}
	if n := count(t, db, "bots", "user_id = ?", me); n != MaxBots {
		t.Fatalf("%d bots", n)
	}
}

func TestIntegrationBotsMCP(t *testing.T) {
	db := migratedDB(t)
	me := addUser(t, db)
	s := testService(db)
	ctx := context.Background()

	v, err := s.Create(ctx, me, Input{Name: "From outside", Watches: []WatchInput{{Kind: "feed", URL: "https://example.com/rss"}},
		OriginClient: " Claude\u200b Code\n"}, OriginMCP)
	if err != nil {
		t.Fatal(err)
	}
	if v.Status != StatusPaused || v.PauseReason == nil || *v.PauseReason != PauseMCP || v.NextCheckAt != nil || v.Origin != OriginMCP || v.Health.Line != mcpPausedNew {
		t.Fatalf("mcp create %+v", v)
	}
	if v.OriginClient != "Claude Code" || count(t, db, "bots", "id = ? AND origin_client = 'Claude Code'", v.ID) != 1 {
		t.Fatalf("origin client %q", v.OriginClient)
	}
	// Only an MCP-made Bot names an app.
	if app, err := s.Create(ctx, me, Input{Name: "Mine", Watches: []WatchInput{{Kind: "feed", URL: "https://example.com/rss"}}, OriginClient: "Faked"}, OriginApp); err != nil || app.OriginClient != "" {
		t.Fatal(app, err)
	}
	if _, err := s.Resume(ctx, me, v.ID, OriginMCP); inputMsg(t, err) != "Turn bots on in Timely" {
		t.Fatal(err)
	}
	yes := true
	if _, err := s.Create(ctx, me, Input{Name: "Urgent one", Urgent: &yes, Watches: []WatchInput{{Kind: "feed", URL: "https://example.com/rss"}}}, OriginMCP); err == nil {
		t.Fatal("urgent over MCP")
	}
	if _, err := s.Update(ctx, me, v.ID, Patch{Phone: &yes}, OriginMCP); err == nil {
		t.Fatal("phone over MCP")
	}

	// The person turns it on in the app. An MCP rename keeps it on, but an
	// MCP watch edit pauses it again.
	if v, err = s.Resume(ctx, me, v.ID, OriginApp); err != nil || v.Status != StatusActive {
		t.Fatal(v, err)
	}
	name := "Renamed outside"
	if v, err = s.Update(ctx, me, "from OUTSIDE", Patch{Name: &name}, OriginMCP); err != nil || v.Status != StatusActive || v.Name != name {
		t.Fatal(v, err)
	}
	ws := []WatchInput{{ID: v.Watches[0].ID, Kind: "feed", URL: "https://example.com/rss", Rules: []Rule{{Kind: RuleNewItem, Words: []string{"release"}}}}}
	if v, err = s.Update(ctx, me, v.ID, Patch{Watches: &ws}, OriginMCP); err != nil {
		t.Fatal(err)
	}
	if v.Status != StatusPaused || *v.PauseReason != PauseMCP || v.NextCheckAt != nil || v.Health.Line != mcpPausedNow {
		t.Fatalf("mcp edit %+v", v)
	}
	if v, err = s.Pause(ctx, me, v.ID, PauseMCP); err != nil || *v.PauseReason != PauseMCP {
		t.Fatal(v, err)
	}
	if _, err := s.Pause(ctx, me, v.ID, PauseStrikes); err == nil {
		t.Fatal("strikes is not a pause reason callers give")
	}
}

func TestIntegrationSiteSpacing(t *testing.T) {
	db := migratedDB(t)
	a, b := NewStore(db), NewStore(db)
	ctx := context.Background()
	gap, wait := 10*time.Second, 20*time.Second

	var mu sync.Mutex
	var slots []time.Time
	var wg sync.WaitGroup
	for i := range 3 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			st := a
			if i%2 == 1 {
				st = b
			}
			slot, err := st.Reserve(ctx, "example.com", gap, wait, botNow)
			if err != nil {
				t.Error(err)
				return
			}
			mu.Lock()
			slots = append(slots, slot)
			mu.Unlock()
		}()
	}
	wg.Wait()
	sort.Slice(slots, func(i, j int) bool { return slots[i].Before(slots[j]) })
	if len(slots) != 3 || !slots[0].Equal(botNow) || !slots[1].Equal(botNow.Add(gap)) || !slots[2].Equal(botNow.Add(2*gap)) {
		t.Fatalf("slots %v", slots)
	}
	if slot, err := b.Reserve(ctx, "other.org", gap, wait, botNow); err != nil || !slot.Equal(botNow) {
		t.Fatalf("other site %v %v", slot, err)
	}
	// The next slot is 30 s out, past the 20 s wait.
	_, err := a.Reserve(ctx, "example.com", gap, wait, botNow)
	var busy *fetch.SiteBusyError
	if !errors.As(err, &busy) || !busy.Until.Equal(botNow.Add(3*gap)) {
		t.Fatalf("busy %v", err)
	}
	// Later on, the site is free again from now.
	later := botNow.Add(time.Hour)
	if slot, err := a.Reserve(ctx, "example.com", gap, wait, later); err != nil || !slot.Equal(later) {
		t.Fatalf("later %v %v", slot, err)
	}
}

func TestIntegrationRobotsCache(t *testing.T) {
	db := migratedDB(t)
	s := NewStore(db)
	ctx := context.Background()
	origin := "https://example.com:443"
	if _, _, ok, err := s.RobotsGet(ctx, origin, botNow); ok || err != nil {
		t.Fatal(ok, err)
	}
	must(t, s.RobotsPut(ctx, origin, 200, "User-agent: *\nDisallow: /private\x00\xff", botNow, 24*time.Hour))
	status, body, ok, err := s.RobotsGet(ctx, origin, botNow.Add(time.Hour))
	if err != nil || !ok || status != 200 || body != "User-agent: *\nDisallow: /private" {
		t.Fatalf("%d %q %v %v", status, body, ok, err)
	}
	must(t, s.RobotsPut(ctx, origin, 503, "", botNow, time.Hour))
	if status, _, ok, _ := s.RobotsGet(ctx, origin, botNow.Add(30*time.Minute)); !ok || status != 503 {
		t.Fatalf("replaced %d %v", status, ok)
	}
	if _, _, ok, _ := s.RobotsGet(ctx, origin, botNow.Add(2*time.Hour)); ok {
		t.Fatal("expired answer served")
	}
}

// The board: one List gives each card its strip, newest alert, items told
// of today and price series, and the header its counts. A shop page keeps a
// price series, and a watch's last change moves only when its reading does.
func TestIntegrationBotBoard(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	const shopURL, feedURL = "https://www.shop.example.in/p/1", "https://news.example.com/feed.xml"
	shopPrice, feedBody, btc := "27499", rss("1"), "27499.00"
	e.net.set(shopURL, func(req *http.Request) (*http.Response, error) {
		return reply(req, 200, "text/html; charset=utf-8", `<html><head><title>Shop | Headphones</title><script type="application/ld+json">`+
			`{"@type":"Product","name":"Sony WH-1000XM6 Wireless","offers":{"price":"`+shopPrice+`","priceCurrency":"INR"}}</script></head><body>Buy</body></html>`), nil
	})
	e.net.set(feedURL, func(req *http.Request) (*http.Response, error) {
		return reply(req, 200, "application/rss+xml", feedBody), nil
	})
	e.coinbase(&btc)
	shop := e.create(Input{Name: "Headphones", Watches: []WatchInput{{Kind: WatchPage, URL: shopURL, Read: ReadProductPrice,
		Rules: []Rule{{Kind: RuleBelow, Threshold: f64(25000)}}}}})
	feed := e.create(Input{Name: "News", Watches: []WatchInput{{Kind: WatchFeed, URL: feedURL}}})
	coin := e.create(btcBot("BTC dip", Rule{Kind: RuleBelow, Threshold: f64(25000)}))
	shopW := shop.Watches[0].ID
	changedAt := func() time.Time {
		t.Helper()
		w := watchRow(t, e.db, shopW)
		if w.LastChangedAt == nil {
			t.Fatal("no last_changed_at")
		}
		return w.LastChangedAt.UTC()
	}

	// Baselines, all at 09:30.
	t0 := e.now
	for _, id := range []string{shop.ID, feed.ID, coin.ID} {
		must(t, e.run(id))
	}
	if got := changedAt(); !got.Equal(t0) {
		t.Fatalf("baseline last_changed_at %v, want %v", got, t0)
	}
	if w := watchRow(t, e.db, shopW); w.LastReading.Title != "Sony WH-1000XM6 Wireless" {
		t.Fatalf("page title %q", w.LastReading.Title)
	}
	// The same price later: unchanged, so the last change stays.
	e.again(shop.ID)
	if c := e.lastCheck(shop.ID); c.Outcome != outUnchanged {
		t.Fatalf("second shop check %s", c.Outcome)
	}
	if got := changedAt(); !got.Equal(t0) {
		t.Fatalf("an unchanged check moved last_changed_at to %v", got)
	}
	// Two new posts, and BTC dips while snoozed: that alert is held.
	feedBody, btc = rss("1", "2", "3"), "24000.00"
	until := e.now.Add(7 * 24 * time.Hour)
	_, err := e.s.Snooze(ctx, e.user, coin.ID, &until)
	must(t, err)
	must(t, e.run(feed.ID))
	must(t, e.run(coin.ID))
	if e.lastCheck(feed.ID).Outcome != outFired || e.lastCheck(coin.ID).Outcome != outFired {
		t.Fatal("feed and BTC did not fire")
	}
	// The shop price drops under the line.
	shopPrice = "24000"
	e.again(shop.ID)
	t2 := e.now
	if c := e.lastCheck(shop.ID); c.Outcome != outFired {
		t.Fatalf("third shop check %s", c.Outcome)
	}
	if got := changedAt(); !got.Equal(t2) {
		t.Fatalf("last_changed_at %v, want %v", got, t2)
	}
	if t2.Format(dayLayout) != t0.Format(dayLayout) {
		t.Fatalf("the test left the day: %v", t2)
	}
	var day PriceDay
	must(t, e.db.Where("watch_id = ?", shopW).First(&day).Error)
	if n := e.count("bot_price_days", "watch_id = ?", shopW); n != 1 || len(day.Points) != 3 || *day.Open != 27499 || *day.Close != 24000 {
		t.Fatalf("shop price days %d, %+v", n, day)
	}

	list, err := e.s.List(ctx, e.user)
	must(t, err)
	byID := map[string]View{}
	for _, v := range list.Bots {
		byID[v.ID] = v
	}
	s, f, c := byID[shop.ID], byID[feed.ID], byID[coin.ID]
	if s.Strip != "nnf" || f.Strip != "nf" || c.Strip != "nf" {
		t.Fatalf("strips %q %q %q", s.Strip, f.Strip, c.Strip)
	}
	if s.LatestAlert == nil || s.LatestAlert.Title != "Headphones: below 25,000" || s.LatestAlert.Body != "Now ₹24,000 (was ₹27,499)" || s.LatestAlert.URL != shopURL {
		t.Fatalf("shop latest alert %+v", s.LatestAlert)
	}
	if c.LatestAlert != nil || c.AlertsToday != 0 {
		t.Fatalf("a snoozed alert shows on the card: %+v", c.LatestAlert)
	}
	if f.ItemsToday != 2 || f.AlertsToday != 1 || s.ItemsToday != 0 || f.LatestAlert == nil || f.LatestAlert.Held != "" {
		t.Fatalf("feed today: items %d, alerts %d, latest %+v", f.ItemsToday, f.AlertsToday, f.LatestAlert)
	}
	sw := s.Watches[0]
	wantPct := math.Round((24000.0-27499)/27499*100*100) / 100
	if sw.Site != "example.in" || sw.Title != "Sony WH-1000XM6 Wireless" || sw.Value == nil || *sw.Value != 24000 ||
		len(sw.Spark) != 1 || sw.Spark[0][1] != 24000 || sw.DayChangePct == nil || *sw.DayChangePct != wantPct {
		t.Fatalf("shop watch %+v", sw)
	}
	if fw := f.Watches[0]; fw.LatestItem == nil || fw.LatestItem.Title != "Story 1" || fw.Excerpt != "Story 1" || fw.Items != nil || fw.Value != nil {
		t.Fatalf("feed watch %+v", fw)
	}
	if cw := c.Watches[0]; cw.Site != "" || len(cw.Spark) != 1 || cw.Title != "" {
		t.Fatalf("coin watch %+v", cw)
	}
	if list.Summary.ChecksToday != 7 || list.Summary.AlertsToday != 2 || list.Summary.NextCheckAt == nil {
		t.Fatalf("summary %+v", list.Summary)
	}
	next := *list.Summary.NextCheckAt
	for _, v := range list.Bots {
		if v.NextCheckAt != nil && v.NextCheckAt.Before(next) {
			t.Fatalf("summary next %v is after %s's %v", next, v.Name, v.NextCheckAt)
		}
	}
	if s.Checking || s.FloorLine != "Shop prices are checked every 6 hours at most" || s.RunNowAt == nil || !s.RunNowAt.Equal(t2.Add(MinProductEvery-FenceSlack)) {
		t.Fatalf("shop run now %+v %v", s.RunNowAt, s.FloorLine)
	}

	// A paused Bot drops out of the next check.
	_, err = e.s.Pause(ctx, e.user, feed.ID, PausePerson)
	must(t, err)
	list, err = e.s.List(ctx, e.user)
	must(t, err)
	for _, v := range list.Bots {
		if v.ID != feed.ID && v.NextCheckAt != nil && v.NextCheckAt.Before(*list.Summary.NextCheckAt) {
			t.Fatal("summary next is not the earliest active Bot")
		}
	}

	// Over REST, and the Detail.
	code, out := call(t, e.s, e.user, "GET", "/bots", nil)
	if sum, _ := out["summary"].(map[string]any); code != 200 || sum["checksToday"] != float64(7) || len(out["bots"].([]any)) != 3 {
		t.Fatalf("GET /bots %d %v", code, out["summary"])
	}
	d, err := e.s.Get(ctx, e.user, feed.ID)
	must(t, err)
	if d.Week.Checks != 2 || d.Week.Alerts != 1 || d.AlertsMonth != 1 || len(d.Watches[0].Items) != 3 || d.Watches[0].Items[0].URL != "https://news.example.com/1" {
		t.Fatalf("feed detail week %+v month %d items %+v", d.Week, d.AlertsMonth, d.Watches[0].Items)
	}
	d, err = e.s.Get(ctx, e.user, shop.ID)
	must(t, err)
	a := d.Alerts[0]
	if a.CheckID == nil || *a.CheckID != e.lastCheck(shop.ID).ID || a.Figures["rule"] != RuleBelow || a.Figures["threshold"] != float64(25000) ||
		a.Figures["price"] != float64(24000) || a.Figures["watchId"] != nil {
		t.Fatalf("alert view %+v", a)
	}
	if d.Watches[0].Items != nil {
		t.Fatal("a page watch lists items")
	}

	// Turning the Bot back on, or a rules edit, asks for a fresh baseline.
	// The same price then is no change.
	_, err = e.s.Pause(ctx, e.user, shop.ID, PausePerson)
	must(t, err)
	_, err = e.s.Resume(ctx, e.user, shop.ID, OriginApp)
	must(t, err)
	e.again(shop.ID)
	if c := e.lastCheck(shop.ID); c.Outcome != outBaseline || !e.now.After(t2) {
		t.Fatalf("check after Turn on %s", c.Outcome)
	}
	if got := changedAt(); !got.Equal(t2) {
		t.Fatalf("a baseline after Turn on moved last_changed_at to %v", got)
	}
	ws := []WatchInput{{ID: shopW, Kind: WatchPage, URL: shopURL, Read: ReadProductPrice, Rules: []Rule{{Kind: RuleBelow, Threshold: f64(20000)}}}}
	_, err = e.s.Update(ctx, e.user, shop.ID, Patch{Watches: &ws}, OriginApp)
	must(t, err)
	e.again(shop.ID)
	if c := e.lastCheck(shop.ID); c.Outcome != outBaseline {
		t.Fatalf("check after a rules edit %s", c.Outcome)
	}
	if got := changedAt(); !got.Equal(t2) {
		t.Fatalf("a baseline after a rules edit moved last_changed_at to %v", got)
	}
	// A new price at a baseline is a change.
	shopPrice = "23000"
	_, err = e.s.Pause(ctx, e.user, shop.ID, PausePerson)
	must(t, err)
	_, err = e.s.Resume(ctx, e.user, shop.ID, OriginApp)
	must(t, err)
	e.again(shop.ID)
	if got := changedAt(); !got.Equal(e.now) {
		t.Fatalf("a moved baseline left last_changed_at at %v, want %v", got, e.now)
	}
	// Pointing the watch somewhere else clears it until the new first reading.
	ws = []WatchInput{{ID: shopW, Kind: WatchPage, URL: shopURL + "?v=2", Read: ReadProductPrice}}
	_, err = e.s.Update(ctx, e.user, shop.ID, Patch{Watches: &ws}, OriginApp)
	must(t, err)
	if w := watchRow(t, e.db, shopW); w.LastChangedAt != nil || w.LastReading != nil {
		t.Fatalf("a new target kept %v %v", w.LastChangedAt, w.LastReading)
	}
}
