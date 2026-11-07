package bots

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/models"
	"timely-api/internal/realtime"
)

// liveBots relays db's bot notices to a new Hub until the test ends.
func liveBots(t *testing.T, db *gorm.DB) (*Service, *realtime.Hub) {
	t.Helper()
	hub := realtime.NewHub()
	s := testService(db)
	s.SetLive(hub)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); s.Relay(ctx) }()
	t.Cleanup(func() { cancel(); <-done; hub.Close() })
	return s, hub
}

// nextEvent waits up to within for an event on ch.
func nextEvent(ch <-chan realtime.Event, within time.Duration) (realtime.Event, bool) {
	select {
	case ev, ok := <-ch:
		return ev, ok
	case <-time.After(within):
		return realtime.Event{}, false
	}
}

// drain throws away what ch still holds, until it is quiet for a moment.
func drain(ch <-chan realtime.Event) {
	for {
		if _, ok := nextEvent(ch, 300*time.Millisecond); !ok {
			return
		}
	}
}

// heard touches the Bot until the relay, which starts listening in the
// background, passes a change on; then it drains the rest.
func heard(t *testing.T, db *gorm.DB, ch <-chan realtime.Event, botID string) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); ; {
		if ev, ok := nextEvent(ch, 100*time.Millisecond); ok {
			if ev.Type != "changed" || ev.Kind != "bot" || ev.ID != botID {
				t.Fatalf("unexpected event %#v", ev)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the relay never heard a bot change")
		}
		must(t, db.Exec("UPDATE bots SET health_detail = ? WHERE id = ?", uuid.NewString(), botID).Error)
	}
	drain(ch)
}

// once expects exactly one event for botID after write.
func once(t *testing.T, ch <-chan realtime.Event, botID, write string) {
	t.Helper()
	ev, ok := nextEvent(ch, 2*time.Second)
	if !ok || ev.Type != "changed" || ev.Kind != "bot" || ev.ID != botID {
		t.Fatalf("%s: got %#v, %v", write, ev, ok)
	}
	if ev, ok := nextEvent(ch, 300*time.Millisecond); ok {
		t.Fatalf("%s: a second event %#v", write, ev)
	}
}

func insertPausedBot(t *testing.T, db *gorm.DB, userID string) string {
	t.Helper()
	id := "bot_" + uuid.NewString()
	must(t, db.Exec(`INSERT INTO bots (id, user_id, name, status, pause_reason, interval_seconds)
		VALUES (?, ?, ?, 'paused', 'person', 3600)`, id, userID, "Live "+id[4:12]).Error)
	return id
}

func TestIntegrationBotChangesNotify(t *testing.T) {
	db := migratedDB(t)
	me, other := addUser(t, db), addUser(t, db)
	_, hub := liveBots(t, db)
	mine, stopMine := hub.Subscribe(me, liveTopic)
	defer stopMine()
	theirs, stopTheirs := hub.Subscribe(other, liveTopic)
	defer stopTheirs()
	chats, stopChats := hub.Subscribe(me, "chats")
	defer stopChats()

	botID := insertPausedBot(t, db, me)
	heard(t, db, mine, botID)

	// Each write to each of the four tables announces the Bot once.
	writes := []struct{ name, sql string }{
		{"bots update", `UPDATE bots SET description = 'Changed' WHERE id = @bot`},
		{"watch insert", `INSERT INTO bot_watches (id, bot_id, user_id, kind, url) VALUES ('bwt_live', @bot, @user, 'feed', 'https://example.com/rss')`},
		{"watch update", `UPDATE bot_watches SET health = 'ok' WHERE id = 'bwt_live'`},
		{"watch delete", `DELETE FROM bot_watches WHERE id = 'bwt_live'`},
		{"alert insert", `INSERT INTO bot_alerts (id, bot_id, user_id, kind, local_day, title) VALUES ('bal_live', @bot, @user, 'alert', '2026-11-07', 'Dropped')`},
		{"alert update", `UPDATE bot_alerts SET feedback = 'useful', feedback_at = now() WHERE id = 'bal_live'`},
		{"lesson insert", `INSERT INTO bot_lessons (id, bot_id, user_id, alert_id, text) VALUES ('bls_live', @bot, @user, 'bal_live', 'Small moves do not matter')`},
		{"lesson update", `UPDATE bot_lessons SET text = 'Only big moves' WHERE id = 'bls_live'`},
		{"lesson delete", `DELETE FROM bot_lessons WHERE id = 'bls_live'`},
		{"alert delete", `DELETE FROM bot_alerts WHERE id = 'bal_live'`},
	}
	for _, w := range writes {
		sql := strings.NewReplacer("@bot", "'"+botID+"'", "@user", "'"+me+"'").Replace(w.sql)
		must(t, db.Exec(sql).Error)
		once(t, mine, botID, w.name)
	}
	second := insertPausedBot(t, db, me)
	once(t, mine, second, "bots insert")
	must(t, db.Exec("DELETE FROM bots WHERE id = ?", second).Error)
	once(t, mine, second, "bots delete")

	// A rolled-back transaction (a chat rehearsal) announces nothing.
	tx := db.Begin()
	must(t, tx.Exec("UPDATE bots SET description = 'Rehearsed' WHERE id = ?", botID).Error)
	must(t, tx.Exec(`INSERT INTO bot_watches (id, bot_id, user_id, kind, url) VALUES ('bwt_gone', ?, ?, 'feed', 'https://example.com/rss')`, botID, me).Error)
	must(t, tx.Rollback().Error)
	if ev, ok := nextEvent(mine, 500*time.Millisecond); ok {
		t.Fatalf("rolled-back change sent %#v", ev)
	}

	// An API with another DB_SCHEMA on the same database is not heard, even
	// for the same person id.
	elsewhere := migratedDB(t)
	must(t, elsewhere.Create(&models.User{ID: me, Email: me + "@test.local", Password: "x"}).Error)
	insertPausedBot(t, elsewhere, me)
	if ev, ok := nextEvent(mine, 500*time.Millisecond); ok {
		t.Fatalf("another schema's change sent %#v", ev)
	}

	// A chat stream, on its own topic, never sees a bot event, and nor does
	// another account.
	select {
	case ev := <-chats:
		t.Fatalf("a chat stream heard %#v", ev)
	case ev := <-theirs:
		t.Fatalf("another account heard %#v", ev)
	default:
	}
}

// A check runs on a worker lane, maybe in another API process: the stream
// follows the database, not the process that made the change.
func TestIntegrationBotCheckReachesAnotherProcess(t *testing.T) {
	e := newEngine(t)
	listener := e.service()
	hub := realtime.NewHub()
	listener.SetLive(hub)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); listener.Relay(ctx) }()
	defer func() { cancel(); <-done }()
	events, stop := hub.Subscribe(e.user, liveTopic)
	defer stop()

	v := e.create(pageInput("Page live", "https://example.com/live"))
	heard(t, e.db, events, v.ID)
	e.net.serve("https://example.com/live", 200, "text/html", "<html><body><p>Hello there</p></body></html>")
	must(t, e.run(v.ID))
	ev, ok := nextEvent(events, 2*time.Second)
	if !ok || ev.Kind != "bot" || ev.ID != v.ID {
		t.Fatalf("check: got %#v, %v", ev, ok)
	}
	if b := e.bot(v.ID); b.LastCheckAt == nil {
		t.Fatal("the check did not save")
	}
}

func TestIntegrationBotWatchStream(t *testing.T) {
	db := migratedDB(t)
	me := addUser(t, db)

	// Signed out, and without a hub.
	if code, body := call(t, testService(db), "", http.MethodGet, "/bots/watch", nil); code != http.StatusUnauthorized {
		t.Fatalf("empty uid: %d %v", code, body)
	}
	if code, body := call(t, testService(db), me, http.MethodGet, "/bots/watch", nil); code != http.StatusServiceUnavailable {
		t.Fatalf("no hub: %d %v", code, body)
	}

	s, _ := liveBots(t, db)
	e := echo.New()
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			c.Set("userID", me)
			return next(c)
		}
	})
	s.Routes(e.Group(""))
	srv := httptest.NewServer(e)
	defer srv.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/bots/watch", nil)
	res, err := http.DefaultClient.Do(req)
	must(t, err)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("stream %d %q", res.StatusCode, res.Header.Get("Content-Type"))
	}
	lines := make(chan string, 64)
	go func() {
		sc := bufio.NewScanner(res.Body)
		for sc.Scan() {
			if l := sc.Text(); strings.HasPrefix(l, "data:") {
				lines <- l
			}
		}
		close(lines)
	}()
	first := <-lines
	if !strings.Contains(first, `"type":"hello"`) || !strings.Contains(first, `"kind":"bot"`) {
		t.Fatalf("hello %q", first)
	}
	botID := insertPausedBot(t, db, me)
	for deadline := time.Now().Add(5 * time.Second); ; {
		select {
		case l := <-lines:
			if !strings.Contains(l, `"type":"changed"`) || !strings.Contains(l, `"kind":"bot"`) || !strings.Contains(l, `"id":"`+botID+`"`) {
				t.Fatalf("changed %q", l)
			}
			return
		case <-time.After(100 * time.Millisecond):
		}
		if time.Now().After(deadline) {
			t.Fatal("no changed event on the stream")
		}
		must(t, db.Exec("UPDATE bots SET health_detail = ? WHERE id = ?", uuid.NewString(), botID).Error)
	}
}
