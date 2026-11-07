package bots

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"gorm.io/gorm"
	"timely-api/internal/features/bots/botstest"
	"timely-api/internal/features/bots/fetch"
)

// previewTables are every per-account Bots table; a preview writes none.
var previewTables = []string{"bots", "bot_watches", "bot_checks", "bot_alerts", "bot_findings", "bot_price_days", "bot_lessons", "bot_source_keys"}

func previewNet(t *testing.T) *botstest.Network {
	t.Helper()
	shop, err := os.ReadFile("extract/testdata/shop_struck.html")
	must(t, err)
	return botstest.NewNetwork(map[string]botstest.Response{
		"https://shop.example/p/headphones":               botstest.Page(string(shop)),
		"https://news.example/feed":                       botstest.Feed(rss("1", "2", "3", "4", "5", "6", "7")),
		"https://status.example/":                         botstest.Page(`<html><body><h1>Status</h1><div id="state">  All systems   working </div></body></html>`),
		"https://api.coinbase.com/v2/prices/BTC-USD/spot": botstest.JSON(`{"data":{"amount":"68012.50","base":"BTC","currency":"USD"}}`),
		"https://down.example/":                           {Err: syscall.ECONNRESET},
		"https://odd.example/":                            {Err: errors.New("tls: unknown certificate authority")},
	})
}

func previewService(db *gorm.DB, n *botstest.Network) *Service {
	s := testService(db)
	s.SetFetcher(n.Fetcher())
	return s
}

func previewCall(t *testing.T, s *Service, user string, body any) (int, PreviewResult, string) {
	t.Helper()
	code, out := call(t, s, user, http.MethodPost, "/bots/preview", body)
	var res PreviewResult
	if code == http.StatusOK {
		must(t, jsonRoundTrip(out, &res))
	}
	msg, _ := out["message"].(string)
	return code, res, msg
}

func jsonRoundTrip(in any, out any) error {
	raw, err := json.Marshal(in)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, out)
}

func noBotRows(t *testing.T, db *gorm.DB, user string, except ...string) {
	t.Helper()
	skip := map[string]bool{}
	for _, e := range except {
		skip[e] = true
	}
	for _, table := range previewTables {
		if skip[table] {
			continue
		}
		if n := count(t, db, table, "user_id = ?", user); n != 0 {
			t.Errorf("%s has %d rows for the person; a preview saves nothing", table, n)
		}
	}
}

func TestIntegrationPreviewWatches(t *testing.T) {
	db := migratedDB(t)
	user := addUser(t, db)
	n := previewNet(t)
	s := previewService(db, n)

	code, res, msg := previewCall(t, s, user, map[string]any{"watches": []map[string]any{
		{"kind": "page", "url": "https://shop.example/p/headphones", "read": "product_price"},
		{"kind": "page", "url": "https://gone.example/item"},
		{"kind": "feed", "url": "https://news.example/feed"},
		{"kind": "page", "url": "https://status.example/", "read": "selector", "selector": "#state", "id": "bwt_not_saved"},
		{"kind": "price", "source": "crypto", "symbol": "BTC"},
	}})
	if code != http.StatusOK {
		t.Fatalf("preview: %d %s", code, msg)
	}
	if len(res.Watches) != 5 {
		t.Fatalf("got %d watches, want 5", len(res.Watches))
	}
	for i, w := range res.Watches {
		if w.Index != i || w.WatchID != "" {
			t.Errorf("watch %d: index %d watchId %q; a draft's watches carry no id", i, w.Index, w.WatchID)
		}
	}

	shop := res.Watches[0]
	if !shop.OK || shop.Kind != "page" || shop.Read != "product_price" || shop.Site != "shop.example" || shop.Health != nil {
		t.Errorf("shop: %+v", shop)
	}
	if shop.Value == nil || *shop.Value != 19999 || shop.Currency != "INR" || shop.Summary != "₹19,999" {
		t.Errorf("shop reads %v %q %q, want 19999 INR ₹19,999", shop.Value, shop.Currency, shop.Summary)
	}
	var labels []string
	for _, c := range shop.Candidates {
		labels = append(labels, fmt.Sprintf("%s %g %v", c.Label, c.Amount, c.Struck))
	}
	if len(shop.Candidates) < 2 || labels[0] != "Deal Price 19999 false" || labels[1] != "M.R.P. 24990 true" {
		t.Errorf("candidates %q", labels)
	}
	for _, c := range shop.Candidates {
		if c.From == "text" && c.Selector == "" {
			t.Errorf("a price from the text needs a selector to follow it: %+v", c)
		}
	}
	if shop.Excerpt == nil {
		t.Fatal("a shop price comes with the text around it")
	}
	ex := []rune(shop.Excerpt.Text)
	if m := shop.Excerpt.Mark; m[1] <= m[0] || m[1] > len(ex) || !strings.Contains(string(ex[m[0]:m[1]]), "19,999") {
		t.Errorf("mark %v in %q", m, shop.Excerpt.Text)
	}
	if len(shop.Excerpt.Struck) == 0 || !strings.Contains(string(ex[shop.Excerpt.Struck[0][0]:shop.Excerpt.Struck[0][1]]), "24,990") {
		t.Errorf("struck %v in %q", shop.Excerpt.Struck, shop.Excerpt.Text)
	}

	// One watch failing does not stop the others.
	gone := res.Watches[1]
	if gone.OK || gone.Health == nil || gone.Health.Code != "not_found" || gone.Health.Line != "The page is gone" {
		t.Errorf("gone: %+v %+v", gone, gone.Health)
	}
	if len(gone.Candidates) != 0 || len(gone.Items) != 0 || gone.Excerpt != nil || gone.Value != nil {
		t.Errorf("a failed watch shows no reading: %+v", gone)
	}

	feed := res.Watches[2]
	if !feed.OK || feed.Summary != "7 items" || len(feed.Items) != PreviewItems || feed.Items[0].Title != "Story 1" ||
		feed.Items[0].URL != "https://news.example.com/1" || len(feed.Candidates) != 0 {
		t.Errorf("feed: %+v", feed)
	}

	part := res.Watches[3]
	if !part.OK || part.Text != "All systems working" || part.Read != "selector" || part.Excerpt != nil {
		t.Errorf("selector read: %+v", part)
	}

	coin := res.Watches[4]
	if !coin.OK || coin.Kind != "price" || coin.Value == nil || *coin.Value != 68012.5 || coin.Currency != "USD" || coin.Site != "" {
		t.Errorf("coin: %+v", coin)
	}

	noBotRows(t, db, user)
	if n := count(t, db, "jobs", "user_id = ?", user); n != 0 {
		t.Errorf("a preview queues no jobs; %d queued", n)
	}
}

// A page price read that finds no price still lists the prices the page
// shows, which the person (or the chat) picks the right one from.
func TestIntegrationPreviewFailedPriceCandidates(t *testing.T) {
	db := migratedDB(t)
	user := addUser(t, db)
	s := previewService(db, previewNet(t))
	code, res, msg := previewCall(t, s, user, map[string]any{"watches": []map[string]any{
		{"kind": "page", "url": "https://shop.example/p/headphones", "read": "selector_price", "selector": "#no-such-part"},
	}})
	if code != http.StatusOK {
		t.Fatalf("preview: %d %s", code, msg)
	}
	w := res.Watches[0]
	if w.OK || w.Health == nil || w.Health.Code != "cant_find" {
		t.Fatalf("a selector that matches nothing: %+v %+v", w, w.Health)
	}
	if len(w.Candidates) < 2 || w.Candidates[0].Amount != 19999 {
		t.Errorf("candidates on a failed read: %+v", w.Candidates)
	}
	if w.Value != nil || w.Excerpt != nil {
		t.Errorf("a failed read shows no reading: %+v", w)
	}
}

func TestIntegrationPreviewRefusals(t *testing.T) {
	db := migratedDB(t)
	user := addUser(t, db)
	s := previewService(db, previewNet(t))
	cases := []struct {
		name string
		body any
		code int
		msg  string
	}{
		{"nothing", map[string]any{}, 400, "Give the bot something to watch: a page, a feed or a price"},
		{"too many", map[string]any{"watches": []map[string]any{
			{"kind": "feed", "url": "https://a.example/1"}, {"kind": "feed", "url": "https://a.example/2"}, {"kind": "feed", "url": "https://a.example/3"},
			{"kind": "feed", "url": "https://a.example/4"}, {"kind": "feed", "url": "https://a.example/5"}, {"kind": "feed", "url": "https://a.example/6"},
		}}, 400, "A bot can watch up to 5 things"},
		{"private", map[string]any{"watches": []map[string]any{{"kind": "page", "url": "http://127.0.0.1/admin"}}}, 400, "Timely only reads public web addresses"},
		{"stock without a key", map[string]any{"watches": []map[string]any{{"kind": "price", "source": "stock", "symbol": "NVDA"}}}, 400,
			"Stock prices need your free Finnhub key. Add it in Settings › Agent"},
		{"both", map[string]any{"botId": "bot_x", "watches": []map[string]any{{"kind": "feed", "url": "https://news.example/feed"}}}, 400,
			"Preview either watches or a bot, not both"},
		{"unknown bot", map[string]any{"botId": "bot_missing"}, 404, "Bot not found"},
	}
	for _, c := range cases {
		code, _, msg := previewCall(t, s, user, c.body)
		if code != c.code || msg != c.msg {
			t.Errorf("%s: %d %q, want %d %q", c.name, code, msg, c.code, c.msg)
		}
	}
	if code, _ := call(t, s, user, http.MethodPost, "/bots/preview", "not an object"); code != http.StatusBadRequest {
		t.Errorf("a body that is not an object: %d", code)
	}
}

func TestIntegrationPreviewBot(t *testing.T) {
	db := migratedDB(t)
	user := addUser(t, db)
	n := previewNet(t)
	s := previewService(db, n)
	ctx := context.Background()
	v, err := s.Create(ctx, user, Input{Name: "Headphones", Watches: []WatchInput{
		{Kind: WatchPage, URL: "https://shop.example/p/headphones", Read: ReadProductPrice},
		{Kind: WatchFeed, URL: "https://news.example/feed"},
	}}, OriginApp)
	must(t, err)
	_, err = s.Pause(ctx, user, v.ID, PausePerson)
	must(t, err)
	before := map[string]Watch{}
	for _, w := range v.Watches {
		before[w.ID] = watchRow(t, db, w.ID)
	}
	var botBefore Bot
	must(t, db.Where("id = ?", v.ID).First(&botBefore).Error)

	// "Look it over" and the editor's Test read a saved Bot, paused or not.
	code, res, msg := previewCall(t, s, user, map[string]any{"botId": v.ID})
	if code != http.StatusOK {
		t.Fatalf("preview a saved bot: %d %s", code, msg)
	}
	if len(res.Watches) != 2 || res.Watches[0].WatchID != v.Watches[0].ID || res.Watches[1].WatchID != v.Watches[1].ID {
		t.Fatalf("watches %+v, want the saved ids in order", res.Watches)
	}
	if !res.Watches[0].OK || res.Watches[0].Value == nil || *res.Watches[0].Value != 19999 || len(res.Watches[0].Candidates) == 0 {
		t.Errorf("shop: %+v", res.Watches[0])
	}
	if !res.Watches[1].OK || len(res.Watches[1].Items) != PreviewItems {
		t.Errorf("feed: %+v", res.Watches[1])
	}

	// Nothing about the Bot changed: no reading, health or check was saved.
	for id, w := range before {
		after := watchRow(t, db, id)
		if after.LastReading != nil || after.LastReadingAt != nil || after.Health != w.Health || !after.UpdatedAt.Equal(w.UpdatedAt) || after.ETag != "" {
			t.Errorf("watch %s changed: %+v", id, after)
		}
	}
	var botAfter Bot
	must(t, db.Where("id = ?", v.ID).First(&botAfter).Error)
	if !botAfter.UpdatedAt.Equal(botBefore.UpdatedAt) || botAfter.LastCheckAt != nil || botAfter.Health != botBefore.Health || botAfter.Status != StatusPaused {
		t.Errorf("bot changed: %+v", botAfter)
	}
	noBotRows(t, db, user, "bots", "bot_watches")

	// Another person cannot preview it.
	if code, _, _ := previewCall(t, s, addUser(t, db), map[string]any{"botId": v.ID}); code != http.StatusNotFound {
		t.Errorf("someone else's bot: %d, want 404", code)
	}
}

func TestIntegrationPreviewMemo(t *testing.T) {
	db := migratedDB(t)
	user := addUser(t, db)
	n := previewNet(t)
	s := previewService(db, n)
	body := map[string]any{"watches": []map[string]any{
		{"kind": "page", "url": "https://shop.example/p/headphones", "read": "product_price"},
		{"kind": "page", "url": "https://down.example/"},
		{"kind": "page", "url": "https://gone.example/item"},
		{"kind": "page", "url": "https://odd.example/"},
	}}
	const shopURL = "https://shop.example/p/headphones"
	code, first, _ := previewCall(t, s, user, body)
	if code != http.StatusOK || !first.Watches[0].OK || first.Watches[1].OK || first.Watches[1].Health.Line != "Waiting for the network" {
		t.Fatalf("first: %d %+v", code, first)
	}
	// A failure a check would retry is this watch's line, not the request's.
	if odd := first.Watches[3]; odd.OK || odd.Health == nil || odd.Health.Code != "offline" || odd.Health.Line != "Could not read odd.example just now. Try again in a minute" {
		t.Errorf("odd: %+v %+v", odd, odd.Health)
	}
	if n.Hits(shopURL) != 1 || n.Hits("https://down.example/") != 1 || n.Hits("https://gone.example/item") != 1 {
		t.Fatalf("hits %d %d %d", n.Hits(shopURL), n.Hits("https://down.example/"), n.Hits("https://gone.example/item"))
	}

	// The same watches again within 10 minutes reuse the readings, rules
	// or not. A network that was down is tried again; a page that is gone
	// is not.
	s.now = func() time.Time { return botNow.Add(9 * time.Minute) }
	body["watches"].([]map[string]any)[0]["rules"] = []map[string]any{{"kind": "below", "threshold": 18000}}
	code, second, _ := previewCall(t, s, user, body)
	if code != http.StatusOK || second.Watches[0].Summary != "₹19,999" || second.Watches[2].Health.Line != "The page is gone" {
		t.Fatalf("second: %d %+v", code, second)
	}
	if n.Hits(shopURL) != 1 || n.Hits("https://gone.example/item") != 1 {
		t.Errorf("a remembered reading was fetched again: shop %d, gone %d", n.Hits(shopURL), n.Hits("https://gone.example/item"))
	}
	if n.Hits("https://down.example/") != 2 || n.Hits("https://odd.example/") != 2 {
		t.Errorf("failed reads were not tried again: down %d, odd %d, want 2", n.Hits("https://down.example/"), n.Hits("https://odd.example/"))
	}

	// Every Service in the process shares the memo (the chat catalog's copy
	// bound to a transaction among them): one on a dead network still
	// answers from it.
	dead := botstest.NewNetwork(nil)
	other := New(db, nil)
	other.now = s.now
	other.SetFetcher(dead.Fetcher())
	got, err := other.Preview(context.Background(), user, PreviewInput{Watches: []WatchInput{{Kind: WatchPage, URL: shopURL, Read: ReadProductPrice}}})
	must(t, err)
	if !got.Watches[0].OK || got.Watches[0].Summary != "₹19,999" || dead.Hits(shopURL) != 0 {
		t.Errorf("another service: %+v, %d hits", got.Watches[0], dead.Hits(shopURL))
	}
	// Another person's preview of the same page is their own read.
	if _, err := other.Preview(context.Background(), addUser(t, db), PreviewInput{Watches: []WatchInput{{Kind: WatchPage, URL: shopURL, Read: ReadProductPrice}}}); err != nil {
		t.Fatal(err)
	}
	if dead.Hits(shopURL) != 1 {
		t.Errorf("another person reused this person's reading")
	}

	// After 10 minutes it is read again.
	s.now = func() time.Time { return botNow.Add(10 * time.Minute) }
	if code, _, _ := previewCall(t, s, user, body); code != http.StatusOK || n.Hits(shopURL) != 2 {
		t.Errorf("after the TTL: %d, %d hits, want a fresh read", code, n.Hits(shopURL))
	}
}

func TestIntegrationPreviewLimit(t *testing.T) {
	db := migratedDB(t)
	user := addUser(t, db)
	n := botstest.NewNetwork(nil)
	for i := range 14 {
		n.Set(fmt.Sprintf("https://s%d.example/p", i), botstest.Page(fmt.Sprintf("<html><body><p>Page %d</p></body></html>", i)))
	}
	s := previewService(db, n)
	one := func(i int) map[string]any {
		return map[string]any{"watches": []map[string]any{{"kind": "page", "url": fmt.Sprintf("https://s%d.example/p", i)}}}
	}
	for i := range PreviewReadsPerMinute {
		if code, _, msg := previewCall(t, s, user, one(i)); code != http.StatusOK {
			t.Fatalf("read %d: %d %s", i+1, code, msg)
		}
	}
	code, _, msg := previewCall(t, s, user, one(12))
	if code != http.StatusTooManyRequests || msg != "Too many previews right now. Try again in a minute." {
		t.Fatalf("the 13th read: %d %q", code, msg)
	}
	if n.Hits("https://s12.example/p") != 0 {
		t.Error("a refused preview must not fetch")
	}
	// A remembered reading costs nothing.
	if code, _, _ := previewCall(t, s, user, one(3)); code != http.StatusOK {
		t.Errorf("a remembered reading over the limit: %d", code)
	}
	// Someone else has their own limit.
	if code, _, _ := previewCall(t, s, addUser(t, db), one(13)); code != http.StatusOK {
		t.Errorf("another person: %d", code)
	}
	// The same watch twice in one preview is one read.
	n.Set("https://twice.example/p", botstest.Page("<html><body><p>Twice</p></body></html>"))
	twice := map[string]any{"watches": []map[string]any{{"kind": "page", "url": "https://twice.example/p"}, {"kind": "page", "url": "https://twice.example/p"}}}
	if code, res, msg := previewCall(t, s, addUser(t, db), twice); code != http.StatusOK || len(res.Watches) != 2 || !res.Watches[1].OK ||
		res.Watches[1].Index != 1 || n.Hits("https://twice.example/p") != 1 {
		t.Errorf("twice: %d %s %+v, %d hits", code, msg, res.Watches, n.Hits("https://twice.example/p"))
	}
	// A minute on, it reads again.
	s.now = func() time.Time { return botNow.Add(time.Minute + time.Second) }
	if code, _, msg := previewCall(t, s, user, one(12)); code != http.StatusOK {
		t.Errorf("a minute later: %d %s", code, msg)
	}
}

// Watches on one site share its slots: each waits behind the one before
// instead of taking that read's spacing for a busy site.
func TestIntegrationPreviewOneSite(t *testing.T) {
	db := migratedDB(t)
	user := addUser(t, db)
	site := fmt.Sprintf("twins%d.example", time.Now().UnixNano()) // bot_sites and bot_robots are shared
	n := botstest.NewNetwork(map[string]botstest.Response{
		"https://" + site + "/p/1":   botstest.Page(`<html><body><div id="price">₹1,299</div></body></html>`),
		"https://" + site + "/p/2":   botstest.Page(`<html><body><div id="price">₹2,499</div></body></html>`),
		"https://www." + site + "/f": botstest.Feed(rss("1", "2")),
	})
	s := testService(db)
	var mu sync.Mutex
	clock := time.Now().UTC().Truncate(time.Second) // as Postgres stores it
	now := func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		return clock
	}
	start := now()
	s.SetFetcher(fetch.New(fetch.Config{
		Client: &http.Client{Transport: n, Timeout: 5 * time.Second}, Spacer: s.Store(), Robots: s.Store(), Now: now,
		Sleep: func(_ context.Context, d time.Duration) error {
			mu.Lock()
			defer mu.Unlock()
			clock = clock.Add(d)
			return nil
		},
	}))

	code, res, msg := previewCall(t, s, user, map[string]any{"watches": []map[string]any{
		{"kind": "page", "url": "https://" + site + "/p/1", "read": "selector", "selector": "#price"},
		{"kind": "page", "url": "https://" + site + "/p/2", "read": "selector", "selector": "#price"},
		{"kind": "feed", "url": "https://www." + site + "/f"},
	}})
	if code != http.StatusOK {
		t.Fatalf("preview: %d %s", code, msg)
	}
	for i, w := range res.Watches {
		if !w.OK {
			t.Errorf("watch %d on one site: %+v", i, w.Health)
		}
	}
	// The site's spacing still held: robots.txt for each origin, then each
	// read, one gap apart.
	if waited := now().Sub(start); waited < 40*time.Second {
		t.Errorf("the reads waited %v in all, want the site's spacing kept", waited)
	}

	// The person's next preview a moment later (the chat reading the page
	// again) waits out their own spacing; someone else's takes it for a
	// busy site.
	again := map[string]any{"watches": []map[string]any{{"kind": "page", "url": "https://" + site + "/p/1", "read": "selector", "selector": "#none"}}}
	if code, res, msg := previewCall(t, s, user, again); code != http.StatusOK || res.Watches[0].Health == nil || res.Watches[0].Health.Code != "cant_find" {
		t.Errorf("the same person's next preview: %d %s %+v", code, msg, res.Watches)
	}
	other := addUser(t, db)
	if code, res, msg := previewCall(t, s, other, again); code != http.StatusOK || res.Watches[0].Health == nil || res.Watches[0].Health.Code != "waiting" {
		t.Errorf("another person's preview on the busy site: %d %s %+v", code, msg, res.Watches)
	}
	noBotRows(t, db, user)
}

// A key that no longer opens fails a preview's stock read as needs_key, and
// the preview leaves the key as it is: the next check marks it refused.
func TestIntegrationPreviewLeavesKeys(t *testing.T) {
	e := keyedEngine(t)
	fh := e.finnhub()
	if code, body := call(t, e.s, e.user, http.MethodPost, "/bots/keys/finnhub", map[string]string{"key": goodKey}); code != http.StatusOK {
		t.Fatalf("save key: %d %v", code, body)
	}
	v := e.create(stockBot("NVDA"))
	must(t, e.db.Exec(`UPDATE bot_source_keys SET api_key = 'bm90IGEgc2VhbGVkIGtleSBhdCBhbGw=' WHERE user_id = ?`, e.user).Error)
	before := fh.calls()
	code, res, msg := previewCall(t, e.s, e.user, map[string]any{"botId": v.ID})
	if code != http.StatusOK {
		t.Fatalf("preview: %d %s", code, msg)
	}
	if w := res.Watches[0]; w.OK || w.Health == nil || w.Health.Code != "needs_key" || fh.calls() != before {
		t.Fatalf("an unreadable key: %+v %+v, %d calls", w, w.Health, fh.calls()-before)
	}
	if e.keyState() != KeyOK {
		t.Errorf("a preview changed the key to %q", e.keyState())
	}
}
