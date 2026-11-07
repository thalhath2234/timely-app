package bots

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
)

const (
	finnhubQuote = "https://finnhub.io/api/v1/quote"
	goodKey      = "d4k3yGood1234"
)

// finnhub serves Finnhub's quote API: a quote for goodKey, a 401 for any
// other key, and a dial error while offline is set. tokens records the key
// each request carried.
type fakeFinnhub struct {
	mu      sync.Mutex
	offline bool
	tokens  []string
}

func (e *engine) finnhub() *fakeFinnhub {
	f := &fakeFinnhub{}
	e.net.set(finnhubQuote, func(req *http.Request) (*http.Response, error) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.tokens = append(f.tokens, req.Header.Get("X-Finnhub-Token"))
		switch {
		case f.offline:
			return nil, errors.New("dial tcp: connection refused")
		case req.Header.Get("X-Finnhub-Token") != goodKey:
			return reply(req, http.StatusUnauthorized, "application/json", `{"error":"Invalid API key."}`), nil
		}
		return reply(req, 200, "application/json", `{"c":182.41,"d":1.2,"dp":0.66,"t":1762372800}`), nil
	})
	return f
}

func (f *fakeFinnhub) calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.tokens)
}

func (f *fakeFinnhub) setOffline(v bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.offline = v
}

// keyedEngine is an engine whose Service keeps price source keys.
func keyedEngine(t *testing.T) *engine {
	t.Setenv("TIMELY_BACKUP_KEY", "bots-key-test-secret")
	e := newEngine(t)
	k, err := NewKeyStore(e.db)
	must(t, err)
	e.s.SetKeys(k)
	return e
}

func stockBot(name string) Input {
	return Input{Name: name, Watches: []WatchInput{{Kind: WatchPrice, Source: "stock", Symbol: "nvda"}}}
}

func (e *engine) keyState() string {
	e.t.Helper()
	var states []string
	must(e.t, e.db.Model(&SourceKey{}).Where("user_id = ? AND source = 'finnhub'", e.user).Pluck("state", &states).Error)
	if len(states) == 0 {
		return ""
	}
	return states[0]
}

func TestIntegrationBotSourceKeysREST(t *testing.T) {
	e := keyedEngine(t)
	fh := e.finnhub()

	code, body := call(t, e.s, e.user, http.MethodGet, "/bots/keys", nil)
	keys, _ := body["keys"].([]any)
	if code != http.StatusOK || len(keys) != 1 {
		t.Fatalf("GET with no key: %d %v", code, body)
	}
	if row := keys[0].(map[string]any); row["source"] != "finnhub" || row["label"] != "Finnhub" || row["keySet"] != false ||
		row["keyHint"] != "" || row["state"] != "" || row["checkedAt"] != nil {
		t.Fatalf("empty row %v", row)
	}

	for _, c := range []struct {
		path, key string
		code      int
		msg       string
	}{
		{"/bots/keys/finnhub", "short", http.StatusBadRequest, "That doesn't look like a Finnhub key"},
		{"/bots/keys/finnhub", "has spaces in it", http.StatusBadRequest, "That doesn't look like a Finnhub key"},
		{"/bots/keys/finnhub", strings.Repeat("a", 65), http.StatusBadRequest, "That doesn't look like a Finnhub key"},
		{"/bots/keys/finnhub", "d4k3yWrong999", http.StatusBadRequest, "Finnhub did not accept this key"},
		{"/bots/keys/coinbase", goodKey, http.StatusNotFound, "Unknown price source"},
		{"/bots/keys/nasdaq", goodKey, http.StatusNotFound, "Unknown price source"},
	} {
		code, body := call(t, e.s, e.user, http.MethodPost, c.path, map[string]string{"key": c.key})
		if code != c.code || body["message"] != c.msg {
			t.Errorf("POST %s %q: %d %v", c.path, c.key, code, body)
		}
	}
	if fh.calls() != 1 || fh.tokens[0] != "d4k3yWrong999" {
		t.Fatalf("only the well-shaped key is tried: %v", fh.tokens)
	}
	fh.setOffline(true)
	code, body = call(t, e.s, e.user, http.MethodPost, "/bots/keys/finnhub", map[string]string{"key": goodKey})
	if code != http.StatusServiceUnavailable || body["message"] != "Could not reach Finnhub. Try again in a minute." {
		t.Fatalf("offline: %d %v", code, body)
	}
	if n := e.count("bot_source_keys", "user_id = ?", e.user); n != 0 {
		t.Fatalf("a key that was not accepted was saved: %d", n)
	}
	fh.setOffline(false)

	code, body = call(t, e.s, e.user, http.MethodPost, "/bots/keys/Finnhub", map[string]string{"key": " " + goodKey + " "})
	if code != http.StatusOK || body["keySet"] != true || body["keyHint"] != "…1234" || body["state"] != "ok" || body["checkedAt"] == nil {
		t.Fatalf("save: %d %v", code, body)
	}
	var row SourceKey
	must(t, e.db.Where("user_id = ?", e.user).First(&row).Error)
	if row.Source != "finnhub" || row.APIKey == "" || strings.Contains(row.APIKey, goodKey) {
		t.Fatalf("stored row %+v", row)
	}
	if got, err := e.s.keys.SourceKey(context.Background(), e.user, "finnhub"); err != nil || got != goodKey {
		t.Fatalf("SourceKey = %q, %v", got, err)
	}

	_, raw := callRaw(t, e.s, e.user, http.MethodGet, "/bots/keys")
	if strings.Contains(raw, goodKey) || strings.Contains(raw, row.APIKey) {
		t.Fatalf("GET shows the key: %s", raw)
	}
	other := addUser(t, e.db)
	_, body = call(t, e.s, other, http.MethodGet, "/bots/keys", nil)
	if k := body["keys"].([]any)[0].(map[string]any); k["keySet"] != false {
		t.Fatalf("another account sees the key: %v", k)
	}

	// Saving again replaces the key in place.
	must(t, e.db.Model(&SourceKey{}).Where("user_id = ?", e.user).Update("state", KeyRefused).Error)
	if code, body := call(t, e.s, e.user, http.MethodPost, "/bots/keys/finnhub", map[string]string{"key": goodKey}); code != http.StatusOK || body["state"] != "ok" {
		t.Fatalf("save again: %d %v", code, body)
	}
	if n := e.count("bot_source_keys", "user_id = ?", e.user); n != 1 {
		t.Fatalf("%d rows after a second save", n)
	}

	if code, _ := call(t, e.s, e.user, http.MethodDelete, "/bots/keys/nasdaq", nil); code != http.StatusNotFound {
		t.Fatalf("DELETE unknown: %d", code)
	}
	for range 2 {
		if code, _ := call(t, e.s, e.user, http.MethodDelete, "/bots/keys/finnhub", nil); code != http.StatusNoContent {
			t.Fatalf("DELETE: %d", code)
		}
	}
	_, body = call(t, e.s, e.user, http.MethodGet, "/bots/keys", nil)
	if k := body["keys"].([]any)[0].(map[string]any); k["keySet"] != false {
		t.Fatalf("after DELETE: %v", k)
	}
}

// A stock watch is saved on Finnhub with the person's key, refused without
// one, and its checks follow the key: deleting it makes the next check a
// needs_key strike, a key Finnhub turns down is marked refused, and one that
// no longer opens is refused too, without a request or a job retry.
func TestIntegrationBotStockUsesKey(t *testing.T) {
	e := keyedEngine(t)
	fh := e.finnhub()
	ctx := context.Background()

	_, err := e.s.Create(ctx, e.user, stockBot("NVDA"), OriginApp)
	if msg := inputMsg(t, err); msg != "Stock prices need your free Finnhub key. Add it in Settings › Agent" {
		t.Fatalf("no key: %q", msg)
	}
	if code, body := call(t, e.s, e.user, http.MethodPost, "/bots/keys/finnhub", map[string]string{"key": goodKey}); code != http.StatusOK {
		t.Fatalf("save key: %d %v", code, body)
	}
	v := e.create(stockBot("NVDA"))
	if w := v.Watches[0]; w.Source != "finnhub" || w.Symbol != "NVDA" || w.Currency != "USD" {
		t.Fatalf("watch %+v", w)
	}
	must(t, e.run(v.ID))
	if c := e.lastCheck(v.ID); c.Outcome == outStrike || c.ErrorKind != "" {
		t.Fatalf("check with a key %+v", c)
	}
	if fh.tokens[len(fh.tokens)-1] != goodKey {
		t.Fatalf("the check sent %q", fh.tokens[len(fh.tokens)-1])
	}

	// Deleting the key leaves the watch on Finnhub; its next check strikes.
	call(t, e.s, e.user, http.MethodDelete, "/bots/keys/finnhub", nil)
	before := fh.calls()
	e.again(v.ID)
	if c := e.lastCheck(v.ID); c.Outcome != outStrike || c.ErrorKind != "needs_key" {
		t.Fatalf("check without a key %+v", c)
	}
	if b := e.bot(v.ID); b.Health != "needs_key" || b.HealthDetail != "Finnhub needs a free API key before Timely can read its prices" || b.Strikes != 1 {
		t.Fatalf("bot without a key %+v", b)
	}
	if fh.calls() != before || watchRow(t, e.db, v.Watches[0].ID).Source != "finnhub" {
		t.Fatal("a check without a key read Finnhub, or the watch moved")
	}
	// An edit that keeps the stock watch is refused while there is no key.
	ws := []WatchInput{{ID: v.Watches[0].ID, Kind: WatchPrice, Source: "finnhub", Symbol: "NVDA"}}
	if _, err := e.s.Update(ctx, e.user, v.ID, Patch{Watches: &ws}, OriginApp); !strings.Contains(inputMsg(t, err), "need your free Finnhub key") {
		t.Fatalf("edit without a key: %v", err)
	}

	// A key Finnhub turns down at a check is marked refused.
	call(t, e.s, e.user, http.MethodPost, "/bots/keys/finnhub", map[string]string{"key": goodKey})
	must(t, e.db.Exec(`UPDATE bot_source_keys SET api_key = ? WHERE user_id = ?`, sealed(t, e, "d4k3yRevoked1"), e.user).Error)
	e.again(v.ID)
	if c := e.lastCheck(v.ID); c.Outcome != outStrike || c.ErrorKind != "needs_key" {
		t.Fatalf("check with a revoked key %+v", c)
	}
	if e.keyState() != KeyRefused {
		t.Fatalf("revoked key state %q", e.keyState())
	}
	if b := e.bot(v.ID); b.HealthDetail != "Finnhub did not accept the saved API key" {
		t.Fatalf("health %q", b.HealthDetail)
	}
	// A refused key is not sent again, and a new stock watch is refused.
	before = fh.calls()
	e.again(v.ID)
	if c := e.lastCheck(v.ID); c.ErrorKind != "needs_key" || fh.calls() != before {
		t.Fatalf("a refused key was sent again: %+v, %d calls", c, fh.calls()-before)
	}
	if _, err := e.s.Create(ctx, e.user, stockBot("AAPL"), OriginApp); err == nil {
		t.Fatal("a stock bot was saved with a refused key")
	}

	// A key that no longer opens (the server's secret changed) is refused
	// at the check: a strike, never a job error that retries every minute.
	call(t, e.s, e.user, http.MethodPost, "/bots/keys/finnhub", map[string]string{"key": goodKey})
	must(t, e.db.Exec(`UPDATE bot_source_keys SET api_key = 'bm90IGEgc2VhbGVkIGtleSBhdCBhbGw=' WHERE user_id = ?`, e.user).Error)
	before = fh.calls()
	e.due(v.ID)
	if err := e.run(v.ID); err != nil {
		t.Fatalf("an unreadable key failed the job: %v", err)
	}
	if c := e.lastCheck(v.ID); c.Outcome != outStrike || c.ErrorKind != "needs_key" || fh.calls() != before {
		t.Fatalf("check with an unreadable key %+v, %d calls", c, fh.calls()-before)
	}
	if e.keyState() != KeyRefused {
		t.Fatalf("unreadable key state %q", e.keyState())
	}
}

// A key saved while a check was reading is not the key the check sent, so a
// refusal that check got leaves it alone.
func TestIntegrationBotRefusalSparesANewerKey(t *testing.T) {
	e := keyedEngine(t)
	e.finnhub()
	call(t, e.s, e.user, http.MethodPost, "/bots/keys/finnhub", map[string]string{"key": goodKey})
	start := e.now
	e.now = e.now.Add(time.Minute)
	call(t, e.s, e.user, http.MethodPost, "/bots/keys/finnhub", map[string]string{"key": goodKey})
	must(t, e.db.Transaction(func(tx *gorm.DB) error { return markKeyRefused(tx, e.user, "finnhub", start, e.now) }))
	if e.keyState() != KeyOK {
		t.Fatalf("a newer key was marked %q", e.keyState())
	}
	must(t, e.db.Transaction(func(tx *gorm.DB) error { return markKeyRefused(tx, e.user, "finnhub", e.now, e.now) }))
	if e.keyState() != KeyRefused {
		t.Fatalf("the key the check sent is %q", e.keyState())
	}
}

func sealed(t *testing.T, e *engine, key string) string {
	t.Helper()
	s, err := e.s.keyStore.box.Seal(key)
	must(t, err)
	return s
}

func callRaw(t *testing.T, s *Service, userID, method, path string) (int, string) {
	t.Helper()
	e := echo.New()
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			c.Set("userID", userID)
			return next(c)
		}
	})
	s.Routes(e.Group(""))
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec.Code, rec.Body.String()
}

// Each key save reads the source live, from slots every account's checks
// share, so one person's saves are capped.
func TestIntegrationBotKeySavesAreCapped(t *testing.T) {
	e := keyedEngine(t)
	fh := e.finnhub()
	for i := 0; i < KeyTestsPerHour; i++ {
		if code, body := call(t, e.s, e.user, http.MethodPost, "/bots/keys/finnhub", map[string]string{"key": goodKey}); code != http.StatusOK {
			t.Fatalf("save %d: %d %v", i+1, code, body)
		}
	}
	before := fh.calls()
	code, body := call(t, e.s, e.user, http.MethodPost, "/bots/keys/finnhub", map[string]string{"key": goodKey})
	if code != http.StatusTooManyRequests || body["message"] != ErrKeyLimit.Error() || fh.calls() != before {
		t.Fatalf("one save too many: %d %v, %d reads", code, body, fh.calls()-before)
	}
}
