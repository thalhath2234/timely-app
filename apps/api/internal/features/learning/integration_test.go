package learning

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/labstack/echo/v5"
	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"timely-api/internal/agenthost"
	"timely-api/internal/agenthost/agenthosttest"
	_ "timely-api/internal/database" // sets goose's embedded migrations
	"timely-api/internal/models"
	"timely-api/internal/realtime"
)

// migratedDB runs the whole goose chain from zero in a schema of its own.
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
	schema := "learning_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	must(t, root.Exec("CREATE SCHEMA "+schema).Error)
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
	must(t, goose.Up(sqlDB, "."))
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

func count(t *testing.T, db *gorm.DB, table, where string, args ...any) int64 {
	t.Helper()
	var n int64
	must(t, db.Table(table).Where(where, args...).Count(&n).Error)
	return n
}

// recorder is the supervisor the service sees: it notes the account of
// every Ensure, so a test can prove which worker a request reached.
type recorder struct {
	*agenthost.Supervisor
	mu       sync.Mutex
	accounts []string
}

func (r *recorder) Ensure(ctx context.Context, account string) (*agenthost.Worker, error) {
	r.mu.Lock()
	r.accounts = append(r.accounts, account)
	r.mu.Unlock()
	return r.Supervisor.Ensure(ctx, account)
}

func (r *recorder) seen() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return slices.Clone(r.accounts)
}

type published struct {
	uid string
	ev  realtime.Event
}

type rig struct {
	t     *testing.T
	db    *gorm.DB
	kit   *agenthosttest.Kit
	rec   *recorder
	svc   *Service
	pub   chan published
	ready chan string // accounts whose AfterReady finished
}

func newRig(t *testing.T) *rig {
	t.Helper()
	r := &rig{t: t, db: migratedDB(t), kit: agenthosttest.New(t), pub: make(chan published, 64), ready: make(chan string, 64)}
	r.svc = NewService(r.db, nil)
	cfg := r.kit.Config()
	cfg.StaleGrace = 50 * time.Millisecond
	cfg.MaxWorkers = 10
	cfg.Handler = func(w *agenthost.Worker, m agenthost.Message) { r.svc.HandleWorker(w, m) }
	cfg.OnReady = func(w *agenthost.Worker) {
		r.svc.AfterReady(w)
		select {
		case r.ready <- w.Account():
		default:
		}
	}
	r.rec = &recorder{Supervisor: agenthost.New(cfg)}
	r.svc.workers = r.rec
	r.svc.SetPublish(func(uid string, ev realtime.Event) { r.pub <- published{uid, ev} })
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if err := r.rec.Shutdown(ctx); err != nil {
			t.Errorf("shutdown: %v", err)
		}
	})
	return r
}

// call runs one request as uid through the service's routes.
func (r *rig) call(uid, method, path string, body any) (int, map[string]any, []byte) {
	r.t.Helper()
	e := echo.New()
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			c.Set("userID", uid)
			return next(c)
		}
	})
	r.svc.Routes(e.Group(""))
	var reader *bytes.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out, rec.Body.Bytes()
}

// worker starts uid's worker and waits for its AfterReady.
func (r *rig) worker(uid string) *agenthost.Worker {
	r.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	w, err := r.rec.Supervisor.Ensure(ctx, uid)
	if err != nil {
		r.t.Fatalf("Ensure: %v", err)
	}
	r.waitReady(uid)
	return w
}

func (r *rig) waitReady(uid string) {
	r.t.Helper()
	deadline := time.After(10 * time.Second)
	for {
		select {
		case got := <-r.ready:
			if got == uid {
				return
			}
		case <-deadline:
			r.t.Fatalf("AfterReady did not finish for %s", uid)
		}
	}
}

func (r *rig) restart(uid string) *agenthost.Worker {
	r.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	must(r.t, r.rec.Stop(ctx, uid, "test"))
	return r.worker(uid)
}

// requests lists the learning requests uid's workers were sent, by type.
func (r *rig) requests(typ string) []agenthosttest.Received {
	return r.kit.ReceivedOf(typ)
}

func requestsFor(list []agenthosttest.Received, account string) []agenthosttest.Received {
	var out []agenthosttest.Received
	for _, m := range list {
		if m.Account == account {
			out = append(out, m)
		}
	}
	return out
}

func fields(t *testing.T, m agenthosttest.Received) map[string]any {
	t.Helper()
	var out map[string]any
	must(t, m.Decode(&out))
	return out
}

func learningLine(event map[string]any) map[string]any {
	return map[string]any{"type": "learning", "event": event}
}

// waitEvent waits until uid has a recorded event from worker id wid.
func (r *rig) waitEvent(uid, wid string) Event {
	r.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		var ev []Event
		must(r.t, r.db.Where("user_id = ? AND worker_event_id = ?", uid, wid).Find(&ev).Error)
		if len(ev) == 1 {
			return ev[0]
		}
		if time.Now().After(deadline) {
			r.t.Fatalf("no event %s recorded for %s", wid, uid)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// seed records an event for uid as its worker would have reported it.
func (r *rig) seed(uid string, event map[string]any) Event {
	r.t.Helper()
	line := learningLine(event)
	line["account"] = uid
	raw, _ := json.Marshal(line)
	ev, err := r.svc.record(context.Background(), uid, agenthost.Message{Type: "learning", Account: uid, Raw: raw})
	if err != nil || ev == nil {
		r.t.Fatalf("seed: %v", err)
	}
	return *ev
}

func TestIntegrationMigrationsRunFromZeroAndCascade(t *testing.T) {
	db := migratedDB(t)
	uid := addUser(t, db)
	must(t, db.Exec(`INSERT INTO agent_learning_events (id, user_id, worker_event_id, kind, status) VALUES ('lev_1', ?, 'w-1', 'skill', 'applied')`, uid).Error)
	if err := db.Exec(`INSERT INTO agent_learning_events (id, user_id, worker_event_id, kind, status) VALUES ('lev_2', ?, 'w-1', 'skill', 'applied')`, uid).Error; err == nil {
		t.Fatal("the same worker event was stored twice")
	}
	if err := db.Exec(`INSERT INTO agent_learning_events (id, user_id, worker_event_id, kind, status) VALUES ('lev_3', ?, 'w-3', 'skill', 'pending')`, uid).Error; err == nil {
		t.Fatal("an unknown status was stored")
	}
	must(t, db.Exec(`INSERT INTO agent_learning_settings (user_id) VALUES (?)`, uid).Error)
	must(t, db.Exec(`INSERT INTO agent_web_keys (user_id, backend, api_key, key_hint) VALUES (?, 'exa', 'sealed', '••••abcd')`, uid).Error)
	var row struct {
		Learning, SearchHistory        bool
		SkillsDisabled, SkillsRestored string
		UseCaseCopiedAt                *time.Time
	}
	must(t, db.Raw(`SELECT learning, search_history, skills_disabled::text AS skills_disabled, skills_restored::text AS skills_restored, use_case_copied_at FROM agent_learning_settings WHERE user_id = ?`, uid).Scan(&row).Error)
	if !row.Learning || !row.SearchHistory || row.SkillsDisabled != "[]" || row.SkillsRestored != "[]" || row.UseCaseCopiedAt != nil {
		t.Fatalf("defaults %+v", row)
	}
	var noLearning []bool
	must(t, db.Raw(`SELECT column_default = 'false' FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'agent_conversations' AND column_name = 'no_learning' AND is_nullable = 'NO'`).Scan(&noLearning).Error)
	if len(noLearning) != 1 || !noLearning[0] {
		t.Fatalf("agent_conversations.no_learning: %v", noLearning)
	}
	must(t, db.Exec(`DELETE FROM users WHERE id = ?`, uid).Error)
	for _, table := range []string{"agent_learning_events", "agent_learning_settings", "agent_web_keys"} {
		if n := count(t, db, table, "user_id = ?", uid); n != 0 {
			t.Fatalf("%s kept %d rows of a deleted account", table, n)
		}
	}

	// The phase 3 migrations go down and up again.
	sqlDB, _ := db.DB()
	must(t, goose.DownTo(sqlDB, ".", 20261111120000))
	must(t, goose.Up(sqlDB, "."))
}

func TestIntegrationRecordsWorkerLearningMessages(t *testing.T) {
	r := newRig(t)
	a, b := addUser(t, r.db), addUser(t, r.db)
	w := r.worker(a)
	r.kit.Emit(
		learningLine(map[string]any{"id": "w-1", "kind": "skill", "action": "created", "subject": "bank-csv-import",
			"after": "steps", "origin": "review", "conversation_id": "chat_1", "run_id": "run_1",
			"status": "applied", "ledger_entry_id": "led-1", "summary": "Learned how you import bank CSVs",
			// Unknown fields are ignored; an account inside the event is not the event's account.
			"user_id": b, "account": b, "future_field": map[string]any{"x": 1}}),
		learningLine(map[string]any{"id": "w-1", "kind": "skill", "status": "applied"}), // a repeat
		learningLine(map[string]any{"id": "w-2", "kind": "memory", "status": "staged"}), // no pending_id
		learningLine(map[string]any{"id": "w-3", "kind": "memory", "status": "undone"}), // not a worker status
		learningLine(map[string]any{"id": "w-4", "kind": "user", "status": "staged", "pending_id": "p-4", "conversation_id": "chat_1",
			"tainted_sources": []any{map[string]any{"kind": "web", "tool": "web_extract", "host": "example.com"}}}),
	)
	ev := r.waitEvent(a, "w-1")
	staged := r.waitEvent(a, "w-4")
	if ev.UserID != a || ev.Kind != KindSkill || ev.Subject != "bank-csv-import" || ev.Origin != "review" || ev.ConversationID != "chat_1" ||
		ev.RunID != "run_1" || ev.LedgerEntryID != "led-1" || ev.Status != StatusApplied || !strings.HasPrefix(ev.ID, "lev_") {
		t.Fatalf("recorded %+v", ev)
	}
	if staged.PendingID != "p-4" || !strings.Contains(string(staged.TaintedSources), "web_extract") {
		t.Fatalf("staged %+v", staged)
	}
	if n := count(t, r.db, "agent_learning_events", "user_id = ?", a); n != 2 {
		t.Fatalf("%d events for a, want 2 (repeat and bad events dropped)", n)
	}
	if n := count(t, r.db, "agent_learning_events", "user_id = ?", b); n != 0 {
		t.Fatalf("an event was recorded for the account named inside it")
	}
	for range 2 {
		select {
		case p := <-r.pub:
			doc, _ := p.ev.Document.(map[string]string)
			if p.uid != a || p.ev.Type != "learning" || p.ev.Kind != "chat" || p.ev.ID != "chat_1" || doc["eventId"] == "" || doc["status"] == "" {
				t.Fatalf("published %+v", p)
			}
		case <-time.After(time.Second):
			t.Fatal("a recorded event was not published")
		}
	}
	select {
	case p := <-r.pub:
		t.Fatalf("published a repeat or a refused event: %+v", p)
	default:
	}

	// A worker writing for another account is stopped by the supervisor;
	// its line never reaches the learning service.
	r.kit.Emit(map[string]any{"type": "learning", "_account": b, "event": map[string]any{"id": "rogue", "kind": "skill", "status": "applied"}})
	select {
	case <-w.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("the worker that wrote for another account kept running")
	}
	if n := count(t, r.db, "agent_learning_events", "worker_event_id = 'rogue'"); n != 0 {
		t.Fatal("a line for another account was recorded")
	}
}

func TestIntegrationOneAccountNeverReachesAnothersLearning(t *testing.T) {
	r := newRig(t)
	a, b := addUser(t, r.db), addUser(t, r.db)
	skill := r.seed(a, map[string]any{"id": "a-1", "kind": "skill", "action": "created", "subject": "a-secret-skill",
		"conversation_id": "chat_a", "status": "applied", "ledger_entry_id": "led-a"})
	staged := r.seed(a, map[string]any{"id": "a-2", "kind": "memory", "action": "added", "after": "A's note",
		"conversation_id": "chat_a", "status": "staged", "pending_id": "pend-a"})
	zipFor := func(who string) string { return base64.StdEncoding.EncodeToString([]byte("zip of " + who)) }
	r.kit.LearningReplyFor(a, "learning.skill", map[string]any{"content": "A's skill"})
	r.kit.LearningReplyFor(a, "learning.export", map[string]any{"zip_b64": zipFor("a"), "files": 1})
	r.kit.LearningReplyFor(b, "learning.export", map[string]any{"zip_b64": zipFor("b"), "files": 1})
	r.kit.LearningReplyFor(a, "learning.list", map[string]any{"pending": []any{map[string]any{"pending_id": "pend-a"}}})
	r.kit.LearningReplyFor(b, "learning.list", map[string]any{"pending": []any{}})
	r.kit.LearningError(b, "learning.skill", "not_found", "no skill named a-secret-skill")
	r.kit.LearningReply("learning.rollback", map[string]any{"ok": true})
	r.kit.LearningReply("learning.pending", map[string]any{"discarded": true})
	r.kit.LearningError("", "learning.memory", "unscripted", "")

	// Events: B's feed never lists A's, even asked for A's chat.
	for _, path := range []string{"/agent/learning/events", "/agent/learning/events?conversationId=chat_a"} {
		code, body, _ := r.call(b, http.MethodGet, path, nil)
		if events, _ := body["events"].([]any); code != http.StatusOK || len(events) != 0 {
			t.Fatalf("B's %s: %d %v", path, code, body)
		}
	}
	// Undo and keep/discard of A's ids are not found for B, and change nothing.
	if code, _, _ := r.call(b, http.MethodPost, "/agent/learning/events/"+skill.ID+"/undo", nil); code != http.StatusNotFound {
		t.Fatalf("B undoing A's event: %d", code)
	}
	for _, choice := range []string{"keep", "discard"} {
		if code, _, _ := r.call(b, http.MethodPost, "/agent/learning/pending/pend-a", map[string]any{"choice": choice}); code != http.StatusNotFound {
			t.Fatalf("B %s on A's pending item: %d", choice, code)
		}
	}
	// Worker-backed reads reach B's own worker only.
	if code, body, _ := r.call(b, http.MethodGet, "/agent/learning/skills/a-secret-skill", nil); code != http.StatusNotFound {
		t.Fatalf("B reading A's skill: %d %v", code, body)
	}
	if code, _, raw := r.call(b, http.MethodGet, "/agent/learning/pending", nil); code != http.StatusOK || strings.TrimSpace(string(raw)) != `{"pending":[]}` {
		t.Fatalf("B's pending list: %d %s", code, raw)
	}
	code, _, raw := r.call(b, http.MethodGet, "/agent/learning/export", nil)
	if code != http.StatusOK || string(raw) != "zip of b" {
		t.Fatalf("B's export: %d %q", code, raw)
	}
	for _, typ := range []string{"learning.skill", "learning.list", "learning.export", "learning.rollback", "learning.pending"} {
		if got := requestsFor(r.requests(typ), a); len(got) != 0 {
			t.Fatalf("A's worker got B's %s: %s", typ, got[0].Raw)
		}
	}
	for _, acct := range r.rec.seen() {
		if acct != b {
			t.Fatalf("a request of B's started or used %s's worker", acct)
		}
	}
	if ev, _ := r.svc.find(context.Background(), a, skill.ID); ev.Status != StatusApplied {
		t.Fatalf("A's event is %s after B's undo", ev.Status)
	}
	if ev, _ := r.svc.find(context.Background(), a, staged.ID); ev.Status != StatusStaged {
		t.Fatalf("A's staged event is %s after B's keep/discard", ev.Status)
	}

	// A's own requests work, on A's worker.
	if code, body, _ := r.call(a, http.MethodPost, "/agent/learning/events/"+skill.ID+"/undo", nil); code != http.StatusOK {
		t.Fatalf("A undoing: %d %v", code, body)
	}
	rollback := requestsFor(r.requests("learning.rollback"), a)
	if len(rollback) != 1 || fields(t, rollback[0])["ledger_entry_id"] != "led-a" {
		t.Fatalf("A's rollback: %v", rollback)
	}
	if code, body, _ := r.call(a, http.MethodPost, "/agent/learning/pending/pend-a", map[string]any{"choice": "discard"}); code != http.StatusOK {
		t.Fatalf("A discarding: %d %v", code, body)
	}
	if ev, _ := r.svc.find(context.Background(), a, staged.ID); ev.Status != StatusDiscarded {
		t.Fatalf("A's staged event is %s, want discarded", ev.Status)
	}
	if code, _, raw := r.call(a, http.MethodGet, "/agent/learning/export", nil); code != http.StatusOK || string(raw) != "zip of a" {
		t.Fatalf("A's export: %d %q", code, raw)
	}
}

func setUseCase(t *testing.T, db *gorm.DB, uid, useCase string) {
	t.Helper()
	must(t, db.Exec(`INSERT INTO suggestion_prefs (user_id, use_case) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET use_case = EXCLUDED.use_case`, uid, useCase).Error)
}

func copiedAt(t *testing.T, db *gorm.DB, uid string) *time.Time {
	t.Helper()
	row, err := loadSettings(context.Background(), db, uid)
	must(t, err)
	return row.UseCaseCopiedAt
}

func userAdds(t *testing.T, r *rig, uid string) []string {
	t.Helper()
	var out []string
	for _, m := range requestsFor(r.requests("learning.memory"), uid) {
		f := fields(t, m)
		if f["target"] == "user" && f["action"] == "add" {
			out = append(out, f["content"].(string))
		}
	}
	return out
}

func TestIntegrationUseCaseIsCopiedIntoAboutYouOnce(t *testing.T) {
	r := newRig(t)
	r.kit.LearningReply("learning.memory", map[string]any{"user": map[string]any{"entries": []string{}}})

	// Learning on (the default): the first ready copies it.
	a := addUser(t, r.db)
	setUseCase(t, r.db, a, "  Work and projects, Study ")
	r.worker(a)
	if got := userAdds(t, r, a); len(got) != 1 || got[0] != "Uses Timely for: Work and projects, Study" {
		t.Fatalf("copies %q", got)
	}
	if copiedAt(t, r.db, a) == nil {
		t.Fatal("use_case_copied_at not set")
	}
	// Not again after another ready, nor after the use case changes.
	r.restart(a)
	setUseCase(t, r.db, a, "Running a business")
	r.restart(a)
	if code, _, _ := r.call(a, http.MethodPatch, "/agent/learning/settings", map[string]any{"learning": true}); code != http.StatusOK {
		t.Fatalf("patch %d", code)
	}
	if got := userAdds(t, r, a); len(got) != 1 {
		t.Fatalf("copied %d times: %q", len(got), got)
	}

	// Learning off: nothing is copied at ready; turning it on copies once.
	c := addUser(t, r.db)
	setUseCase(t, r.db, c, "Health and fitness")
	if code, body, _ := r.call(c, http.MethodPatch, "/agent/learning/settings", map[string]any{"learning": false}); code != http.StatusOK || body["learning"] != false {
		t.Fatalf("turning learning off: %d %v", code, body)
	}
	r.worker(c)
	if got := userAdds(t, r, c); len(got) != 0 || copiedAt(t, r.db, c) != nil {
		t.Fatalf("copied while learning was off: %q", got)
	}
	code, body, _ := r.call(c, http.MethodPatch, "/agent/learning/settings", map[string]any{"learning": true})
	if code != http.StatusOK || body["useCaseCopied"] != true {
		t.Fatalf("turning learning on: %d %v", code, body)
	}
	r.call(c, http.MethodPatch, "/agent/learning/settings", map[string]any{"learning": false})
	r.call(c, http.MethodPatch, "/agent/learning/settings", map[string]any{"learning": true})
	r.restart(c)
	if got := userAdds(t, r, c); len(got) != 1 || got[0] != "Uses Timely for: Health and fitness" {
		t.Fatalf("copies for c: %q", got)
	}

	// An empty use case copies nothing and leaves the copy due.
	d := addUser(t, r.db)
	setUseCase(t, r.db, d, "   ")
	r.worker(d)
	if got := userAdds(t, r, d); len(got) != 0 || copiedAt(t, r.db, d) != nil {
		t.Fatalf("an empty use case: %q", got)
	}

	// A worker that cannot write it gives the copy back for the next ready.
	e := addUser(t, r.db)
	setUseCase(t, r.db, e, "Study")
	r.kit.LearningError(e, "learning.memory", "full", "About you is full")
	r.worker(e)
	if len(userAdds(t, r, e)) != 1 || copiedAt(t, r.db, e) != nil {
		t.Fatal("a failed copy was marked done")
	}
	r.kit.LearningReplyFor(e, "learning.memory", map[string]any{})
	r.restart(e)
	if len(userAdds(t, r, e)) != 2 || copiedAt(t, r.db, e) == nil {
		t.Fatal("the copy was not tried again after a failure")
	}
}

func TestIntegrationUndoOfASkillChangeUndoesTheLaterOnes(t *testing.T) {
	r := newRig(t)
	a := addUser(t, r.db)
	r.kit.LearningReply("learning.rollback", map[string]any{"ok": true})
	created := r.seed(a, map[string]any{"id": "s-1", "kind": "skill", "action": "created", "subject": "aisles", "status": "applied", "ledger_entry_id": "led-1"})
	time.Sleep(5 * time.Millisecond)
	edited := r.seed(a, map[string]any{"id": "s-2", "kind": "skill", "action": "edited", "subject": "aisles", "origin": "user", "status": "applied", "ledger_entry_id": "led-2"})
	other := r.seed(a, map[string]any{"id": "s-3", "kind": "skill", "action": "created", "subject": "meals", "status": "applied", "ledger_entry_id": "led-3"})
	if code, body, _ := r.call(a, http.MethodPost, "/agent/learning/events/"+created.ID+"/undo", nil); code != http.StatusOK {
		t.Fatalf("undo: %d %v", code, body)
	}
	for id, want := range map[string]string{created.ID: StatusUndone, edited.ID: StatusUndone, other.ID: StatusApplied} {
		if ev, _ := r.svc.find(context.Background(), a, id); ev.Status != want {
			t.Fatalf("%s is %s, want %s", id, ev.Status, want)
		}
	}
	if got := requestsFor(r.requests("learning.rollback"), a); len(got) != 1 {
		t.Fatalf("%d rollbacks, want only the one undone", len(got))
	}
}

func TestIntegrationUndoKeepAndDiscard(t *testing.T) {
	r := newRig(t)
	a := addUser(t, r.db)
	r.kit.LearningReply("learning.memory", map[string]any{"memory": map[string]any{"entries": []string{}}})
	r.kit.LearningReply("learning.pending", map[string]any{"ok": true})
	added := r.seed(a, map[string]any{"id": "m-1", "kind": "memory", "action": "added", "after": "Prefers metric units", "status": "applied", "conversation_id": "chat_1"})
	replaced := r.seed(a, map[string]any{"id": "m-2", "kind": "user", "action": "replaced", "before": "Lives in Pune", "after": "Lives in Kochi", "status": "applied"})
	skill := r.seed(a, map[string]any{"id": "s-1", "kind": "skill", "action": "patched", "subject": "x", "status": "applied", "ledger_entry_id": "led-9"})
	keep := r.seed(a, map[string]any{"id": "p-1", "kind": "skill", "action": "created", "status": "staged", "pending_id": "pend-1"})
	discard := r.seed(a, map[string]any{"id": "p-2", "kind": "memory", "action": "added", "status": "staged", "pending_id": "pend-2"})
	blocked := r.seed(a, map[string]any{"id": "b-1", "kind": "skill", "action": "created", "status": "blocked"})
	for len(r.pub) > 0 {
		<-r.pub
	}

	code, body, _ := r.call(a, http.MethodPost, "/agent/learning/events/"+added.ID+"/undo", nil)
	if code != http.StatusOK || body["event"].(map[string]any)["status"] != StatusUndone {
		t.Fatalf("undo added: %d %v", code, body)
	}
	if p := <-r.pub; p.ev.ID != "chat_1" || p.ev.Document.(map[string]string)["status"] != StatusUndone {
		t.Fatalf("published %+v", p)
	}
	if code, body, _ := r.call(a, http.MethodPost, "/agent/learning/events/"+added.ID+"/undo", nil); code != http.StatusConflict {
		t.Fatalf("second undo: %d %v", code, body)
	}
	if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/events/"+replaced.ID+"/undo", nil); code != http.StatusOK {
		t.Fatalf("undo replaced: %d", code)
	}
	mem := requestsFor(r.requests("learning.memory"), a)
	if len(mem) != 2 {
		t.Fatalf("%d memory requests", len(mem))
	}
	if f := fields(t, mem[0]); f["target"] != "memory" || f["action"] != "remove" || f["old"] != "Prefers metric units" {
		t.Fatalf("undo of an add sent %v", f)
	}
	if f := fields(t, mem[1]); f["target"] != "user" || f["action"] != "replace" || f["old"] != "Lives in Kochi" || f["content"] != "Lives in Pune" {
		t.Fatalf("undo of a replace sent %v", f)
	}

	// A rollback the worker refuses leaves the event as it was.
	r.kit.LearningError("", "learning.rollback", "not_found", "no ledger entry with id 'led-9'")
	if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/events/"+skill.ID+"/undo", nil); code != http.StatusNotFound {
		t.Fatalf("refused rollback: %d", code)
	}
	if ev, _ := r.svc.find(context.Background(), a, skill.ID); ev.Status != StatusApplied {
		t.Fatalf("a refused undo left the event %s", ev.Status)
	}
	r.kit.LearningReply("learning.rollback", map[string]any{"ok": true, "message": "rolled back"})
	if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/events/"+skill.ID+"/undo", nil); code != http.StatusOK {
		t.Fatalf("rollback: %d", code)
	}
	for _, ev := range []Event{keep, discard, blocked} {
		if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/events/"+ev.ID+"/undo", nil); code != http.StatusConflict {
			t.Fatalf("undo of a %s event: %d", ev.Status, code)
		}
	}

	// The worker's real keep reply: {pending_id, event, events}, the applied
	// change with its ledger entry.
	r.kit.LearningReply("learning.pending", map[string]any{"pending_id": "pend-1",
		"event":  map[string]any{"id": "w-kept", "kind": "skill", "action": "created", "subject": "x", "status": "applied", "ledger_entry_id": "led-77", "after": "# x", "pending_id": "pend-1"},
		"events": []any{map[string]any{"id": "w-kept", "kind": "skill", "action": "created", "subject": "x", "status": "applied", "ledger_entry_id": "led-77", "after": "# x", "pending_id": "pend-1"}}})
	if code, body, _ := r.call(a, http.MethodPost, "/agent/learning/pending/pend-1", map[string]any{"choice": "keep"}); code != http.StatusOK ||
		body["event"].(map[string]any)["status"] != StatusKept || body["event"].(map[string]any)["ledgerEntryId"] != "led-77" {
		t.Fatalf("keep: %d %v", code, body)
	}
	r.kit.LearningReply("learning.pending", map[string]any{"ok": true})
	if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/pending/pend-1", map[string]any{"choice": "discard"}); code != http.StatusConflict {
		t.Fatalf("deciding twice: %d", code)
	}
	if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/pending/pend-2", map[string]any{"choice": "maybe"}); code != http.StatusBadRequest {
		t.Fatalf("a bad choice: %d", code)
	}
	if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/pending/pend-2", map[string]any{"choice": "discard"}); code != http.StatusOK {
		t.Fatalf("discard: %d", code)
	}
	pend := requestsFor(r.requests("learning.pending"), a)
	if len(pend) != 2 || fields(t, pend[0])["pending_id"] != "pend-1" || fields(t, pend[0])["choice"] != "keep" || fields(t, pend[1])["choice"] != "discard" {
		t.Fatalf("pending requests %v", pend)
	}
	// A kept change can be undone like an applied one: through the ledger
	// entry the keep wrote.
	keptEv, _ := r.svc.find(context.Background(), a, keep.ID)
	if keptEv.Status != StatusKept || keptEv.LedgerEntryID != "led-77" {
		t.Fatalf("kept event is %s, ledger %q", keptEv.Status, keptEv.LedgerEntryID)
	}
	r.kit.LearningReply("learning.rollback", map[string]any{"ok": true})
	if code, body, _ := r.call(a, http.MethodPost, "/agent/learning/events/"+keep.ID+"/undo", nil); code != http.StatusOK {
		t.Fatalf("undo of a kept skill change: %d %v", code, body)
	}
	if rb := requestsFor(r.requests("learning.rollback"), a); len(rb) == 0 || fields(t, rb[len(rb)-1])["ledger_entry_id"] != "led-77" {
		t.Fatalf("rollback requests %v", rb)
	}
	if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/events/"+keep.ID+"/undo", nil); code != http.StatusConflict {
		t.Fatalf("second undo of the kept change: %d", code)
	}

	// The feed filters by status, chat, time and count.
	code, body, _ = r.call(a, http.MethodGet, "/agent/learning/events?status=undone", nil)
	if events := body["events"].([]any); code != http.StatusOK || len(events) != 4 {
		t.Fatalf("undone events: %d %v", code, body)
	}
	code, body, _ = r.call(a, http.MethodGet, "/agent/learning/events?conversationId=chat_1", nil)
	if events := body["events"].([]any); code != http.StatusOK || len(events) != 1 {
		t.Fatalf("chat_1 events: %d %v", code, body)
	}
	_, body, _ = r.call(a, http.MethodGet, "/agent/learning/events?limit=2", nil)
	page := body["events"].([]any)
	if len(page) != 2 {
		t.Fatalf("limit: %v", body)
	}
	last := page[1].(map[string]any)["createdAt"].(string)
	_, body, _ = r.call(a, http.MethodGet, "/agent/learning/events?before="+url.QueryEscape(last), nil)
	if rest := body["events"].([]any); len(rest) != 4 {
		t.Fatalf("before %s: %d events", last, len(rest))
	}
	if code, _, _ := r.call(a, http.MethodGet, "/agent/learning/events?status=nope", nil); code != http.StatusBadRequest {
		t.Fatalf("unknown status: %d", code)
	}
	if code, _, _ := r.call("", http.MethodGet, "/agent/learning/events", nil); code != http.StatusUnauthorized {
		t.Fatalf("signed out: %d", code)
	}
}

func TestIntegrationSkillsOnOffAndRestored(t *testing.T) {
	r := newRig(t)
	a := addUser(t, r.db)
	// A name Timely cannot store fails the restore rather than stay on.
	if err := r.db.Transaction(func(tx *gorm.DB) error {
		return MarkRestored(tx, a, []string{"csv-import", "../etc"})
	}); err == nil {
		t.Fatal("MarkRestored kept a name it cannot store")
	}
	must(t, r.db.Transaction(func(tx *gorm.DB) error {
		return MarkRestored(tx, a, []string{"csv-import", "csv-import", "notes"})
	}))
	prefs, err := r.svc.Prefs(context.Background(), a)
	if err != nil || !prefs.Learning || !prefs.SearchHistory || !slices.Equal(prefs.SkillsDisabled, []string{"csv-import", "notes"}) {
		t.Fatalf("prefs %+v %v", prefs, err)
	}
	// The worker's real shape: {skills: [...]}.
	r.kit.LearningReply("learning.list", map[string]any{"skills": []any{
		map[string]any{"name": "csv-import", "source": "learned", "enabled": true},
		map[string]any{"name": "notes", "source": "learned", "enabled": true},
		map[string]any{"name": "plain", "source": "learned", "enabled": true},
	}})
	code, body, _ := r.call(a, http.MethodGet, "/agent/learning/skills", nil)
	skills, _ := body["skills"].([]any)
	if code != http.StatusOK || len(skills) != 3 {
		t.Fatalf("skills %d %v", code, body)
	}
	first := skills[0].(map[string]any)
	third := skills[2].(map[string]any)
	if first["enabled"] != false || first["restored"] != true || third["enabled"] != true || third["restored"] != false {
		t.Fatalf("overlay %v", skills)
	}

	// The worker is running: turning a skill on renders its config again.
	r.svc.SetAccountSettings(func(ctx context.Context, uid string) (json.RawMessage, error) {
		p, err := r.svc.Prefs(ctx, uid)
		if err != nil {
			return nil, err
		}
		return json.Marshal(map[string]any{"skills_disabled": p.SkillsDisabled, "skills_enabled": p.SkillsEnabled})
	})
	code, body, _ = r.call(a, http.MethodPost, "/agent/learning/skills/csv-import/state", map[string]any{"state": "enable"})
	if code != http.StatusOK || body["enabled"] != true {
		t.Fatalf("enable %d %v", code, body)
	}
	row, _ := loadSettings(context.Background(), r.db, a)
	if !slices.Equal(row.SkillsDisabled, []string{"notes"}) || !slices.Equal(row.SkillsRestored, []string{"notes"}) ||
		!slices.Equal(row.SkillsEnabled, []string{"csv-import"}) {
		t.Fatalf("after enable %+v", row)
	}
	updates := requestsFor(r.requests(agenthost.TypeSettingsUpdate), a)
	if len(updates) != 1 || !strings.Contains(string(updates[0].Raw), `"skills_disabled":["notes"]`) ||
		!strings.Contains(string(updates[0].Raw), `"skills_enabled":["csv-import"]`) {
		t.Fatalf("settings.update %v", updates)
	}
	// A bundled skill that is off by default (himalaya) is turned on by
	// listing it in skills_enabled; turning it off again drops it there.
	if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/skills/himalaya/state", map[string]any{"state": "enable"}); code != http.StatusOK {
		t.Fatalf("enable a default-off skill %d", code)
	}
	if p, _ := r.svc.Prefs(context.Background(), a); !slices.Equal(p.SkillsEnabled, []string{"csv-import", "himalaya"}) {
		t.Fatalf("after enabling himalaya %+v", p)
	}
	if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/skills/himalaya/state", map[string]any{"state": "disable"}); code != http.StatusOK {
		t.Fatalf("disable himalaya %d", code)
	}
	if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/skills/plain/state", map[string]any{"state": "disable"}); code != http.StatusOK {
		t.Fatalf("disable %d", code)
	}
	if p, _ := r.svc.Prefs(context.Background(), a); !slices.Equal(p.SkillsDisabled, []string{"notes", "himalaya", "plain"}) ||
		!slices.Equal(p.SkillsEnabled, []string{"csv-import"}) {
		t.Fatalf("after disable %+v", p)
	}
	// Lock, archive, restore and delete are the worker's; deleting also
	// drops Timely's own marks.
	r.kit.LearningReply("learning.skill_state", map[string]any{"state": "deleted"})
	if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/skills/notes/state", map[string]any{"state": "delete"}); code != http.StatusOK {
		t.Fatalf("delete %d", code)
	}
	if row, _ := loadSettings(context.Background(), r.db, a); slices.Contains(row.SkillsDisabled, "notes") || len(row.SkillsRestored) != 0 {
		t.Fatalf("after delete %+v", row)
	}
	if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/skills/notes/state", map[string]any{"state": "explode"}); code != http.StatusBadRequest {
		t.Fatalf("unknown state %d", code)
	}
	if code, _, _ := r.call(a, http.MethodGet, "/agent/learning/skills/..%2Fetc", nil); code != http.StatusNotFound {
		t.Fatalf("a path as a skill name: %d", code)
	}

	// Without a settings source, a running worker is restarted once idle.
	r.svc.SetAccountSettings(nil)
	w, _ := r.rec.Worker(a)
	time.Sleep(100 * time.Millisecond)
	if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/skills/plain/state", map[string]any{"state": "enable"}); code != http.StatusOK {
		t.Fatalf("enable %d", code)
	}
	select {
	case <-w.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("the worker was not restarted to pick up the change")
	}

	// Memory and the other worker routes pass straight through.
	r.kit.LearningReply("learning.memory", map[string]any{"user": map[string]any{"entries": []string{"Prefers mornings"}}})
	if code, body, _ := r.call(a, http.MethodPost, "/agent/learning/memory", map[string]any{"target": "user", "action": "add", "content": "Prefers mornings"}); code != http.StatusOK || body["user"] == nil {
		t.Fatalf("memory add %d %v", code, body)
	}
	for _, bad := range []map[string]any{
		{"target": "soul", "action": "add", "content": "x"},
		{"target": "user", "action": "add", "content": " "},
		{"target": "user", "action": "remove"},
		{"target": "user", "action": "rewrite", "content": "x"},
	} {
		if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/memory", bad); code != http.StatusBadRequest {
			t.Fatalf("memory %v: %d", bad, code)
		}
	}
	r.kit.LearningReply("learning.upstream", map[string]any{"mine": "a", "upstream": "b"})
	if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/upstream/csv-import", map[string]any{"choice": "use_new"}); code != http.StatusOK {
		t.Fatalf("upstream %d", code)
	}
	up := requestsFor(r.requests("learning.upstream"), a)
	if f := fields(t, up[len(up)-1]); f["action"] != "use_new" || f["name"] != "csv-import" {
		t.Fatalf("upstream request %v", f)
	}
	if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/upstream/csv-import", map[string]any{"choice": "merge"}); code != http.StatusBadRequest {
		t.Fatalf("bad upstream choice %d", code)
	}
}

func TestIntegrationSettingsAndNoRuntime(t *testing.T) {
	db := migratedDB(t)
	a := addUser(t, db)
	kit := agenthosttest.New(t)
	cfg := kit.Config()
	cfg.Runtime = agenthost.Runtime{}
	cfg.RuntimeErr = os.ErrNotExist
	sup := agenthost.New(cfg)
	t.Cleanup(func() { _ = sup.Shutdown(context.Background()) })
	r := &rig{t: t, db: db, kit: kit, svc: NewService(db, sup)}

	code, body, _ := r.call(a, http.MethodGet, "/agent/learning/settings", nil)
	if code != http.StatusOK || body["learning"] != true || body["searchHistory"] != true || body["useCaseCopied"] != false {
		t.Fatalf("defaults %d %v", code, body)
	}
	code, body, _ = r.call(a, http.MethodPatch, "/agent/learning/settings", map[string]any{"searchHistory": false})
	if code != http.StatusOK || body["learning"] != true || body["searchHistory"] != false {
		t.Fatalf("patch %d %v", code, body)
	}
	if p, _ := r.svc.Prefs(context.Background(), a); !p.Learning || p.SearchHistory {
		t.Fatalf("prefs %+v", p)
	}

	// Routes that need the worker say why it cannot run.
	for _, path := range []string{"/agent/learning/skills", "/agent/learning/memory", "/agent/learning/pending", "/agent/learning/export"} {
		code, body, _ := r.call(a, http.MethodGet, path, nil)
		if msg, _ := body["message"].(string); code != http.StatusServiceUnavailable || !strings.Contains(msg, "runtime is not installed") {
			t.Fatalf("%s without a runtime: %d %v", path, code, body)
		}
	}
	none := &rig{t: t, db: db, svc: NewService(db, nil)}
	if code, body, _ := none.call(a, http.MethodGet, "/agent/learning/skills", nil); code != http.StatusServiceUnavailable || body["message"] == "" {
		t.Fatalf("no supervisor: %d %v", code, body)
	}
	// Turning a skill off needs no worker.
	if code, _, _ := none.call(a, http.MethodPost, "/agent/learning/skills/x/state", map[string]any{"state": "disable"}); code != http.StatusOK {
		t.Fatalf("disable without a worker: %d", code)
	}
}

// The chat chip undoes a turn's changes newest first (learningChip): a
// skill created and then patched in one turn comes back 200 twice, with no
// "Already undone" in between. Oldest first, the create's rollback takes the
// patch back too, so its own Undo answers 409 Already undone (which the apps
// read as done).
func TestIntegrationChipUndoOfCreateThenPatch(t *testing.T) {
	r := newRig(t)
	a := addUser(t, r.db)
	r.kit.LearningReply("learning.rollback", map[string]any{"ok": true})
	seedTurn := func(run string) (Event, Event) {
		created := r.seed(a, map[string]any{"id": run + "-c", "kind": "skill", "action": "created", "subject": "aisles-" + run, "status": "applied", "ledger_entry_id": run + "-l1", "run_id": run})
		time.Sleep(5 * time.Millisecond)
		patched := r.seed(a, map[string]any{"id": run + "-p", "kind": "skill", "action": "patched", "subject": "aisles-" + run, "status": "applied", "ledger_entry_id": run + "-l2", "run_id": run})
		return created, patched
	}
	created, patched := seedTurn("run-1")
	for _, ev := range []Event{patched, created} {
		if code, body, _ := r.call(a, http.MethodPost, "/agent/learning/events/"+ev.ID+"/undo", nil); code != http.StatusOK {
			t.Fatalf("undo %s newest first: %d %v", ev.Action, code, body)
		}
	}
	created, patched = seedTurn("run-2")
	if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/events/"+created.ID+"/undo", nil); code != http.StatusOK {
		t.Fatalf("undo created: %d", code)
	}
	code, body, _ := r.call(a, http.MethodPost, "/agent/learning/events/"+patched.ID+"/undo", nil)
	if code != http.StatusConflict || body["message"] != "Already undone" {
		t.Fatalf("undo of a change the earlier rollback took back: %d %v", code, body)
	}
}

// Turning learning off (or on) reaches a running worker at once: its
// config renders curator.enabled from the switch, and the curator would
// otherwise keep marking learned skills stale until the worker restarts.
func TestIntegrationLearningSwitchReachesTheWorker(t *testing.T) {
	r := newRig(t)
	a := addUser(t, r.db)
	r.svc.SetAccountSettings(func(ctx context.Context, uid string) (json.RawMessage, error) {
		p, err := r.svc.Prefs(ctx, uid)
		if err != nil {
			return nil, err
		}
		return json.Marshal(map[string]any{"learning": p.Learning})
	})
	r.worker(a)
	if code, _, _ := r.call(a, http.MethodPatch, "/agent/learning/settings", map[string]any{"learning": false}); code != http.StatusOK {
		t.Fatalf("patch %d", code)
	}
	updates := requestsFor(r.requests(agenthost.TypeSettingsUpdate), a)
	if len(updates) != 1 || !strings.Contains(string(updates[0].Raw), `"learning":false`) {
		t.Fatalf("settings.update %v", updates)
	}
	if code, _, _ := r.call(a, http.MethodPatch, "/agent/learning/settings", map[string]any{"searchHistory": false}); code != http.StatusOK {
		t.Fatalf("patch %d", code)
	}
	if n := len(requestsFor(r.requests(agenthost.TypeSettingsUpdate), a)); n != 1 {
		t.Fatalf("the search switch alone sent %d settings.update", n)
	}
}

// A staged change the worker no longer holds (a restore whose agent home
// did not come back): Discard closes it, Keep says it is gone and leaves it
// waiting, so it is never stuck in Waiting for you.
func TestIntegrationDiscardOfAChangeTheWorkerLost(t *testing.T) {
	r := newRig(t)
	a := addUser(t, r.db)
	r.kit.LearningError("", "learning.pending", "not_found", "no pending change 'pend-gone'")
	r.seed(a, map[string]any{"id": "p-gone", "kind": "skill", "action": "created", "status": "staged", "pending_id": "pend-gone"})
	if code, _, _ := r.call(a, http.MethodPost, "/agent/learning/pending/pend-gone", map[string]any{"choice": "keep"}); code != http.StatusNotFound {
		t.Fatalf("keep of a lost change: %d", code)
	}
	var status string
	must(t, r.db.Raw(`SELECT status FROM agent_learning_events WHERE pending_id = 'pend-gone'`).Scan(&status).Error)
	if status != StatusStaged {
		t.Fatalf("after a failed keep: %s", status)
	}
	code, body, _ := r.call(a, http.MethodPost, "/agent/learning/pending/pend-gone", map[string]any{"choice": "discard"})
	if code != http.StatusOK || body["event"].(map[string]any)["status"] != StatusDiscarded {
		t.Fatalf("discard of a lost change: %d %v", code, body)
	}
}
