package agentmcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/labstack/echo/v5"
	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"timely-api/internal/agenthost"
	_ "timely-api/internal/database" // sets goose's embedded migrations
	"timely-api/internal/features/portability"
	"timely-api/internal/models"
)

// migratedDB runs the whole goose chain in a schema of its own (CHAT_TEST_ENV,
// as make test-chat-integration sets it).
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
	schema := "agentmcp_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

// fakeWorker answers helper requests from a table and records them.
type fakeWorker struct {
	mu       sync.Mutex
	account  string
	answers  map[string]any // request type -> data (or error)
	requests []map[string]any
	types    []string
}

func (w *fakeWorker) Request(_ context.Context, typ string, fields any) (agenthost.Message, error) {
	raw, _ := json.Marshal(fields)
	var f map[string]any
	_ = json.Unmarshal(raw, &f)
	w.mu.Lock()
	w.requests = append(w.requests, f)
	w.types = append(w.types, typ)
	ans := w.answers[typ]
	w.mu.Unlock()
	if err, ok := ans.(error); ok {
		return agenthost.Message{}, err
	}
	body, _ := json.Marshal(map[string]any{"type": "mcp.result", "ok": true, "data": ans})
	return agenthost.Message{Type: "mcp.result", Raw: body}, nil
}

func (w *fakeWorker) last() map[string]any {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.requests[len(w.requests)-1]
}

func (w *fakeWorker) count(typ string) int {
	w.mu.Lock()
	defer w.mu.Unlock()
	n := 0
	for _, t := range w.types {
		if t == typ {
			n++
		}
	}
	return n
}

// workers hands out one fake worker per account and records who was asked.
type workers struct {
	mu    sync.Mutex
	by    map[string]*fakeWorker
	asked []string
	down  map[string]bool // accounts whose worker is not running
}

func newWorkers() *workers { return &workers{by: map[string]*fakeWorker{}, down: map[string]bool{}} }

func (w *workers) of(uid string) *fakeWorker {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.by[uid] == nil {
		w.by[uid] = &fakeWorker{account: uid, answers: map[string]any{}}
	}
	return w.by[uid]
}

func (w *workers) Requester(_ context.Context, account string, start bool) (Requester, error) {
	w.mu.Lock()
	w.asked = append(w.asked, account)
	down := w.down[account]
	w.mu.Unlock()
	if down && !start {
		return nil, nil
	}
	return w.of(account), nil
}

type rig struct {
	t       *testing.T
	db      *gorm.DB
	svc     *Service
	e       *echo.Echo
	dns     *fakeDNS
	workers *workers
	host    map[string]bool
	changes []string
	pending []PendingStdio
	mu      sync.Mutex
}

func newRig(t *testing.T) *rig {
	t.Helper()
	t.Setenv("TIMELY_BACKUP_KEY", "agentmcp-test-secret")
	r := &rig{t: t, db: migratedDB(t), workers: newWorkers(), host: map[string]bool{},
		dns: &fakeDNS{hosts: map[string][]string{"mcp.example.test": {"93.184.216.34"}, "notes.example.test": {"93.184.216.35"}, "mail.example.test": {"93.184.216.36"}}}}
	svc, err := NewService(r.db, Options{
		Workers: r.workers, Resolver: r.dns,
		HostAllowed: func(_ context.Context, uid string) bool { r.mu.Lock(); defer r.mu.Unlock(); return r.host[uid] },
		OnChange:    func(_ context.Context, uid string) { r.mu.Lock(); r.changes = append(r.changes, uid); r.mu.Unlock() },
		OnStdioPending: func(_ context.Context, _ string, p PendingStdio) {
			r.mu.Lock()
			r.pending = append(r.pending, p)
			r.mu.Unlock()
		},
	})
	must(t, err)
	r.svc = svc
	r.e = echo.New()
	g := r.e.Group("", func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			if u := c.Request().Header.Get("X-Test-User"); u != "" {
				c.Set("userID", u)
			}
			return next(c)
		}
	})
	svc.Routes(g)
	svc.PublicRoutes(r.e)
	return r
}

func (r *rig) setHost(uid string, on bool) { r.mu.Lock(); r.host[uid] = on; r.mu.Unlock() }

// do calls the API as uid ("" for no session).
func (r *rig) do(uid, method, path string, body any) (int, map[string]any, string) {
	r.t.Helper()
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, rd)
	req.Header.Set("Content-Type", "application/json")
	if uid != "" {
		req.Header.Set("X-Test-User", uid)
	}
	rec := httptest.NewRecorder()
	r.e.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out, rec.Body.String()
}

func (r *rig) addRemote(uid, name, rawURL string, signIn bool) {
	r.t.Helper()
	code, out, _ := r.do(uid, "POST", "/agent/mcp/servers", AddInput{Name: name, URL: rawURL, SignIn: signIn})
	if code != http.StatusCreated {
		r.t.Fatalf("add %s: %d %v", name, code, out)
	}
}

func (r *rig) account(uid string) (servers map[string]json.RawMessage, modes map[string]string, approved []string, tokens map[string]json.RawMessage, warnings []string) {
	r.t.Helper()
	servers, modes, approved, tokens, warnings, err := r.svc.AccountMCP(context.Background(), uid)
	must(r.t, err)
	return
}

func dump(t *testing.T, db *gorm.DB, table string) string {
	t.Helper()
	var rows []map[string]any
	must(t, db.Raw("SELECT to_jsonb(x) AS j FROM "+table+" x").Scan(&rows).Error)
	b, _ := json.Marshal(rows)
	return string(b)
}

func TestIntegrationCRUDIsAccountScoped(t *testing.T) {
	r := newRig(t)
	a, b := addUser(t, r.db), addUser(t, r.db)
	r.addRemote(a, "notes", "https://notes.example.test/mcp", false)

	code, out, _ := r.do(a, "GET", "/agent/mcp/servers", nil)
	servers := out["servers"].([]any)
	if code != 200 || len(servers) != 1 || servers[0].(map[string]any)["mode"] != "ask" || servers[0].(map[string]any)["status"] != "ready" {
		t.Fatalf("list: %d %v", code, out)
	}
	if out["canAddCommand"] != false {
		t.Fatalf("a non-host account is told it can add a command server: %v", out)
	}
	if code, out, _ := r.do(b, "GET", "/agent/mcp/servers", nil); code != 200 || len(out["servers"].([]any)) != 0 {
		t.Fatalf("another account sees the server: %v", out)
	}
	for _, c := range []struct{ method, path string }{
		{"PUT", "/agent/mcp/servers/notes"}, {"DELETE", "/agent/mcp/servers/notes"}, {"GET", "/agent/mcp/servers/notes/tools"}, {"POST", "/agent/mcp/servers/notes/sign-in"},
	} {
		if code, _, _ := r.do(b, c.method, c.path, map[string]any{"mode": "use"}); code != http.StatusNotFound {
			t.Errorf("%s %s as another account = %d, want 404", c.method, c.path, code)
		}
	}
	if code, _, _ := r.do("", "GET", "/agent/mcp/servers", nil); code != http.StatusUnauthorized {
		t.Errorf("signed out = %d", code)
	}
	// another account may use the same name
	r.addRemote(b, "notes", "https://mcp.example.test/mcp", false)

	if code, out, _ := r.do(a, "PUT", "/agent/mcp/servers/notes", map[string]any{"mode": "use"}); code != 200 || out["server"].(map[string]any)["mode"] != "use" {
		t.Fatalf("mode: %d %v", code, out)
	}
	if code, _, _ := r.do(a, "PUT", "/agent/mcp/servers/notes", map[string]any{"mode": "sometimes"}); code != 400 {
		t.Errorf("a made-up mode = %d", code)
	}
	if code, _, _ := r.do(a, "POST", "/agent/mcp/servers", AddInput{Name: "notes", URL: "https://mcp.example.test/mcp"}); code != http.StatusConflict {
		t.Errorf("duplicate name = %d", code)
	}
	if code, _, _ := r.do(a, "POST", "/agent/mcp/servers", AddInput{Name: "bad name!", URL: "https://mcp.example.test/mcp"}); code != 400 {
		t.Errorf("bad name = %d", code)
	}
	if got := r.svc.Mode(context.Background(), a, "notes"); got != "use" {
		t.Errorf("Mode = %s", got)
	}
	if got := r.svc.Mode(context.Background(), b, "notes"); got != "ask" {
		t.Errorf("Mode of the other account's own server = %s", got)
	}
	if got := r.svc.Mode(context.Background(), a, "nothing"); got != "off" {
		t.Errorf("Mode of a server the account does not have = %s", got)
	}
	if code, _, _ := r.do(a, "DELETE", "/agent/mcp/servers/notes", nil); code != http.StatusNoContent {
		t.Errorf("delete = %d", code)
	}
	if code, out, _ := r.do(b, "GET", "/agent/mcp/servers", nil); len(out["servers"].([]any)) != 1 || code != 200 {
		t.Errorf("deleting one account's server removed the other's: %v", out)
	}
	if len(r.changes) < 3 {
		t.Errorf("the worker was told of %d changes", len(r.changes))
	}
}

func TestIntegrationAServerStartsAsAskMeFirstAndOffIsNotRendered(t *testing.T) {
	r := newRig(t)
	a := addUser(t, r.db)
	r.addRemote(a, "notes", "https://notes.example.test/mcp", false)
	r.addRemote(a, "mail", "https://mail.example.test/mcp", false)
	servers, modes, _, _, _ := r.account(a)
	if modes["notes"] != "ask" || modes["mail"] != "ask" || len(servers) != 2 {
		t.Fatalf("modes %v servers %d", modes, len(servers))
	}
	r.do(a, "PUT", "/agent/mcp/servers/mail", map[string]any{"mode": "off"})
	servers, modes, _, _, _ = r.account(a)
	if _, there := servers["mail"]; there || modes["mail"] != "off" || modes["notes"] != "ask" {
		t.Fatalf("an Off server is rendered: modes %v servers %v", modes, sortedNames(servers))
	}
}

func TestIntegrationAPrivateOrSharedAddressIsRefusedOnSave(t *testing.T) {
	r := newRig(t)
	a := addUser(t, r.db)
	r.dns.hosts["lan.example.test"] = []string{"192.168.1.20"}
	r.dns.hosts["tail.example.test"] = []string{"100.100.100.100"}
	for _, raw := range []string{"https://lan.example.test/mcp", "https://tail.example.test/mcp", "http://100.64.0.1/mcp", "https://127.0.0.1:8000/mcp",
		"https://169.254.169.254/latest", "https://localhost/mcp", "https://nas/mcp", "https://unknown.example.test/mcp"} {
		code, out, _ := r.do(a, "POST", "/agent/mcp/servers", AddInput{Name: "x", URL: raw})
		if code != 400 {
			t.Errorf("%s accepted: %d %v", raw, code, out)
		}
	}
	if n := len(r.mustList(a)); n != 0 {
		t.Fatalf("%d servers saved", n)
	}
}

func (r *rig) mustList(uid string) []View {
	list, err := r.svc.List(context.Background(), uid)
	must(r.t, err)
	return list
}

func TestIntegrationAnAddressThatTurnsPrivateIsDroppedBeforeTheNextSpawn(t *testing.T) {
	r := newRig(t)
	a := addUser(t, r.db)
	r.addRemote(a, "notes", "https://notes.example.test/mcp", false)
	r.addRemote(a, "mail", "https://mail.example.test/mcp", false)
	servers, _, _, _, warnings := r.account(a)
	if len(servers) != 2 || len(warnings) != 0 {
		t.Fatalf("servers %v warnings %v", sortedNames(servers), warnings)
	}
	// DNS changes after the save: one name now points inside, one at Tailscale
	r.dns.hosts["notes.example.test"] = []string{"10.1.2.3"}
	r.dns.hosts["mail.example.test"] = []string{"93.184.216.36", "100.64.1.1"}
	servers, modes, _, _, warnings := r.account(a)
	if len(servers) != 0 || len(modes) != 0 || len(warnings) != 2 {
		t.Fatalf("servers %v modes %v warnings %v", sortedNames(servers), modes, warnings)
	}
	for _, w := range warnings {
		if !strings.Contains(w, "private network") {
			t.Errorf("warning %q does not say why", w)
		}
	}
	// the Settings row says so too, and the gate treats the server as there but the worker never gets it
	var v View
	for _, x := range r.mustList(a) {
		if x.Name == "notes" {
			v = x
		}
	}
	if v.Status != "unavailable" || !strings.Contains(v.Warning, "private network") {
		t.Fatalf("view %+v", v)
	}
	// and a probe does not reach the worker
	if _, err := r.svc.Tools(context.Background(), a, "notes"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("probe of a now-private address: %v", err)
	}
	if r.workers.of(a).count("mcp.probe") != 0 || r.workers.of(a).count("mcp.oauth.begin") != 0 {
		t.Fatal("a worker was asked to reach a private address")
	}
	// it comes back when DNS does
	r.dns.hosts["notes.example.test"] = []string{"93.184.216.35"}
	if servers, _, _, _, _ := r.account(a); len(servers) != 1 {
		t.Fatalf("servers %v", sortedNames(servers))
	}
}

func TestIntegrationACommandServerIsForHostAllowedAccountsAndWaitsForTheCard(t *testing.T) {
	r := newRig(t)
	plain, host := addUser(t, r.db), addUser(t, r.db)
	r.setHost(host, true)
	in := AddInput{Name: "echo", Command: "/usr/bin/env", Args: []string{"python3", "srv.py"}, Env: map[string]string{"API_KEY": "hunter2"}}

	code, out, _ := r.do(plain, "POST", "/agent/mcp/servers", in)
	if code != http.StatusForbidden || !strings.Contains(out["message"].(string), "can use this computer") {
		t.Fatalf("non-host account: %d %v", code, out)
	}
	if len(r.mustList(plain)) != 0 {
		t.Fatal("a refused command server was saved")
	}

	code, out, _ = r.do(host, "POST", "/agent/mcp/servers", in)
	if code != http.StatusAccepted {
		t.Fatalf("host account: %d %v", code, out)
	}
	view := out["server"].(map[string]any)
	if view["status"] != "waiting_for_ok" || view["transport"] != "command" || view["mode"] != "ask" {
		t.Fatalf("view %v", view)
	}
	if strings.Contains(dump(t, r.db, "agent_mcp_servers"), "hunter2") {
		t.Fatal("an env value is in the servers table")
	}
	if len(r.pending) != 1 || r.pending[0].Command != "/usr/bin/env" || !slices.Equal(r.pending[0].EnvNames, []string{"API_KEY"}) || r.pending[0].Hash == "" {
		t.Fatalf("host card request %+v", r.pending)
	}
	card := r.pending[0]

	// waiting: never handed to the worker, and its tools are off for the gate
	servers, _, approved, _, warnings := r.account(host)
	if len(servers) != 0 || len(approved) != 0 || len(warnings) != 1 || !strings.Contains(warnings[0], "Waiting") {
		t.Fatalf("pending command server rendered: %v %v %v", sortedNames(servers), approved, warnings)
	}
	if got := r.svc.Mode(context.Background(), host, "echo"); got != "off" {
		t.Fatalf("Mode of an unapproved command server = %s", got)
	}
	if _, err := r.svc.Tools(context.Background(), host, "echo"); err == nil || r.workers.of(host).count("mcp.probe") != 0 {
		t.Fatalf("an unapproved command server was probed (%v)", err)
	}

	// approving the hash the card showed renders it, with the env value filled in
	must(t, r.svc.ApproveStdio(context.Background(), host, "echo", card.Hash))
	servers, modes, approved, _, _ := r.account(host)
	if len(servers) != 1 || modes["echo"] != "ask" || !slices.Equal(approved, []string{card.Hash}) {
		t.Fatalf("approved server: %v %v %v", sortedNames(servers), modes, approved)
	}
	var rendered map[string]any
	must(t, json.Unmarshal(servers["echo"], &rendered))
	if rendered["env"].(map[string]any)["API_KEY"] != "hunter2" {
		t.Fatalf("rendered %v", rendered)
	}
	if entryHash(decode(t, string(servers["echo"]))) != card.Hash {
		t.Fatal("the worker's hash of the rendered entry is not the approved one")
	}
	if got := r.svc.Mode(context.Background(), host, "echo"); got != "ask" {
		t.Fatalf("Mode = %s", got)
	}
	if err := r.svc.ApproveStdio(context.Background(), plain, "echo", card.Hash); !errors.Is(err, ErrNotFound) {
		t.Fatalf("another account approved it: %v", err)
	}

	// any edit needs the card again, and the old card cannot approve the new entry
	code, out, _ = r.do(host, "PUT", "/agent/mcp/servers/echo", map[string]any{"args": []string{"python3", "srv.py", "--extra"}, "env": map[string]string{"API_KEY": "${API_KEY}"}})
	if code != http.StatusAccepted || out["server"].(map[string]any)["status"] != "waiting_for_ok" {
		t.Fatalf("edit: %d %v", code, out)
	}
	if servers, _, approved, _, _ := r.account(host); len(servers) != 0 || len(approved) != 0 {
		t.Fatalf("an edited command server kept its approval: %v %v", sortedNames(servers), approved)
	}
	if len(r.pending) != 2 || r.pending[1].Hash == card.Hash {
		t.Fatalf("no new card for the edit: %+v", r.pending)
	}
	if err := r.svc.ApproveStdio(context.Background(), host, "echo", card.Hash); !errors.Is(err, ErrConflict) {
		t.Fatalf("the old card approved a changed entry: %v", err)
	}
	must(t, r.svc.ApproveStdio(context.Background(), host, "echo", r.pending[1].Hash))
	// the kept env value survived the edit; a changed one needs a new card again
	if servers, _, _, _, _ := r.account(host); len(servers) != 1 || !strings.Contains(string(servers["echo"]), "hunter2") {
		t.Fatalf("kept value lost: %v", servers)
	}
	r.do(host, "PUT", "/agent/mcp/servers/echo", map[string]any{"env": map[string]string{"API_KEY": "rotated"}})
	if servers, _, _, _, _ := r.account(host); len(servers) != 0 {
		t.Fatal("a changed env value kept the approval")
	}
	if strings.Contains(dump(t, r.db, "agent_secrets"), "rotated") {
		t.Fatal("an env value is in agent_secrets as plain text")
	}

	// turning the account's host access off drops the command server again
	must(t, r.svc.ApproveStdio(context.Background(), host, "echo", r.pending[len(r.pending)-1].Hash))
	r.setHost(host, false)
	if servers, _, approved, _, warnings := r.account(host); len(servers) != 0 || len(approved) != 0 || len(warnings) != 1 {
		t.Fatalf("a command server for an account that lost host access: %v %v %v", sortedNames(servers), approved, warnings)
	}
}

func TestIntegrationTokensAreSealedAndNeverInABackup(t *testing.T) {
	r := newRig(t)
	a, b := addUser(t, r.db), addUser(t, r.db)
	r.addRemote(a, "linear", "https://mcp.example.test/mcp", true)
	r.addRemote(b, "linear", "https://mcp.example.test/mcp", true)
	const secret = "at-SUPERSECRETACCESS-0123"
	tok := json.RawMessage(`{"tokens":{"access_token":"` + secret + `","refresh_token":"rt-SUPERSECRETREFRESH"},"client_info":{"client_id":"c1","client_secret":"cs-SUPERSECRETCLIENT"}}`)
	must(t, r.svc.SaveTokens(context.Background(), a, map[string]json.RawMessage{"linear": tok, "not-a-server": tok}))

	var rows []Secret
	must(t, r.db.Find(&rows).Error)
	if len(rows) != 1 || rows[0].UserID != a || rows[0].Kind != "mcp-token" || rows[0].Name != "linear" {
		t.Fatalf("secret rows %+v", rows)
	}
	for _, plain := range []string{secret, "SUPERSECRETREFRESH", "SUPERSECRETCLIENT", "access_token"} {
		if bytes.Contains(rows[0].Ciphertext, []byte(plain)) {
			t.Fatalf("the ciphertext column holds %q", plain)
		}
		if strings.Contains(dump(t, r.db, "agent_secrets"), plain) || strings.Contains(dump(t, r.db, "agent_mcp_servers"), plain) {
			t.Fatalf("%q is in a table as plain text", plain)
		}
	}

	_, _, _, tokens, _ := r.account(a)
	if string(tokens["linear"]) != string(tok) {
		t.Fatalf("tokens for the spawn: %v", tokens)
	}
	if _, _, _, tokens, _ := r.account(b); len(tokens) != 0 {
		t.Fatalf("another account's token reached this one: %v", tokens)
	}
	if v := r.mustList(a)[0]; !v.SignedIn || v.Status != "ready" {
		t.Fatalf("view %+v", v)
	}
	if v := r.mustList(b)[0]; v.SignedIn || v.Status != "needs_sign_in" {
		t.Fatalf("a server with no token: %+v", v)
	}

	// the account backup (what the person exports, and the scheduled backup) holds neither
	svc := portability.NewService(r.db, nil)
	backup, err := svc.ExportAccount(context.Background(), a)
	must(t, err)
	blob, _ := json.Marshal(backup)
	for _, leak := range []string{secret, "SUPERSECRETREFRESH", "SUPERSECRETCLIENT", "agent_secrets", "agent_mcp_servers", string(rows[0].Ciphertext), "mcp-token"} {
		if strings.Contains(string(blob), leak) {
			t.Fatalf("the backup holds %q", leak)
		}
	}

	// Hermes signed out (deleted the files): the stored token goes, and "Sign in again" shows
	must(t, r.svc.SaveTokens(context.Background(), a, map[string]json.RawMessage{"linear": json.RawMessage(`{}`)}))
	if v := r.mustList(a)[0]; v.SignedIn || v.Status != "needs_sign_in" {
		t.Fatalf("after Hermes cleared it: %+v", v)
	}

	// a changed address drops the token that belonged to the old server
	must(t, r.svc.SaveTokens(context.Background(), a, map[string]json.RawMessage{"linear": tok}))
	r.dns.hosts["other.example.test"] = []string{"93.184.216.40"}
	if code, out, _ := r.do(a, "PUT", "/agent/mcp/servers/linear", map[string]any{"url": "https://other.example.test/mcp"}); code != 200 {
		t.Fatalf("edit: %d %v", code, out)
	}
	if v := r.mustList(a)[0]; v.SignedIn {
		t.Fatalf("a token followed the server to a new address: %+v", v)
	}
	// removing the server removes what it kept
	must(t, r.svc.SaveTokens(context.Background(), a, map[string]json.RawMessage{"linear": tok}))
	r.do(a, "DELETE", "/agent/mcp/servers/linear", nil)
	var n int64
	r.db.Model(&Secret{}).Where("user_id = ?", a).Count(&n)
	if n != 0 {
		t.Fatalf("%d secrets left after removing the server", n)
	}
}

func TestIntegrationASecretFromAnotherServerKeyDoesNotOpen(t *testing.T) {
	r := newRig(t)
	a := addUser(t, r.db)
	r.addRemote(a, "linear", "https://mcp.example.test/mcp", true)
	must(t, r.svc.SaveTokens(context.Background(), a, map[string]json.RawMessage{"linear": json.RawMessage(`{"tokens":{"access_token":"x"}}`)}))
	t.Setenv("TIMELY_BACKUP_KEY", "a-different-server-secret")
	other, err := NewService(r.db, Options{Workers: r.workers, Resolver: r.dns})
	must(t, err)
	_, _, _, tokens, warnings, err := other.AccountMCP(context.Background(), a)
	must(t, err)
	if len(tokens) != 0 || len(warnings) != 1 || !strings.Contains(warnings[0], "Sign in again") {
		t.Fatalf("tokens %v warnings %v", tokens, warnings)
	}
}

func TestIntegrationSignInGoesThroughTheWorkerAndTheCallbackIsOneUse(t *testing.T) {
	r := newRig(t)
	a, b := addUser(t, r.db), addUser(t, r.db)
	r.addRemote(a, "linear", "https://mcp.example.test/mcp", true)
	wa := r.workers.of(a)
	wa.answers["mcp.oauth.begin"] = map[string]any{"authorize_url": "https://mcp.example.test/authorize?state=st-1&client_id=c", "state": "st-1"}
	token := map[string]any{"tokens": map[string]any{"access_token": "at-OAUTHRESULT", "refresh_token": "rt-1"}, "client_info": map[string]any{"client_id": "c"}}
	wa.answers["mcp.oauth.finish"] = map[string]any{"token": token, "tools": []any{}}

	// another account cannot start it; the fake worker of b is never asked about a's server
	if code, _, _ := r.do(b, "POST", "/agent/mcp/servers/linear/sign-in", map[string]any{"redirectBase": "https://timely.example.test/api-proxy"}); code != 404 {
		t.Fatalf("another account's sign-in = %d", code)
	}
	if code, _, _ := r.do(a, "POST", "/agent/mcp/servers/linear/sign-in", map[string]any{"redirectBase": "javascript:alert(1)"}); code != 400 {
		t.Fatalf("a bad redirect base = %d", code)
	}
	code, out, _ := r.do(a, "POST", "/agent/mcp/servers/linear/sign-in", map[string]any{"redirectBase": "https://timely.example.test/api-proxy"})
	if code != 200 || out["authorizeUrl"] != "https://mcp.example.test/authorize?state=st-1&client_id=c" {
		t.Fatalf("sign-in: %d %v", code, out)
	}
	begin := wa.last()
	if begin["redirect_uri"] != "https://timely.example.test/api-proxy/agent/mcp/oauth/callback" || begin["name"] != "linear" {
		t.Fatalf("worker was asked %v", begin)
	}
	if entry := begin["entry"].(map[string]any); entry["url"] != "https://mcp.example.test/mcp" || entry["auth"] != "oauth" {
		t.Fatalf("entry %v", entry)
	}

	// the callback is public: no session, the state is the proof
	code, _, page := r.do("", "GET", "/agent/mcp/oauth/callback?state=st-1&code=the-code", nil)
	if code != 200 || !strings.Contains(page, "Signed in") || !strings.Contains(page, "close this window") {
		t.Fatalf("callback: %d %s", code, page)
	}
	fin := wa.last()
	if fin["state"] != "st-1" || fin["code"] != "the-code" || fin["name"] != "linear" {
		t.Fatalf("finish was asked %v", fin)
	}
	if r.workers.of(b).count("mcp.oauth.finish") != 0 {
		t.Fatal("another account's worker was asked to finish the sign-in")
	}
	var rows []Secret
	must(t, r.db.Find(&rows).Error)
	if len(rows) != 1 || rows[0].UserID != a || bytes.Contains(rows[0].Ciphertext, []byte("OAUTHRESULT")) {
		t.Fatalf("stored %+v", rows)
	}
	if _, _, _, tokens, _ := r.account(a); !strings.Contains(string(tokens["linear"]), "at-OAUTHRESULT") {
		t.Fatalf("token for the next spawn: %s", tokens["linear"])
	}
	if v := r.mustList(a)[0]; !v.SignedIn || v.Status != "ready" {
		t.Fatalf("view %+v", v)
	}

	// the state is spent: the same callback again, and a state nobody issued, do nothing
	finishes := wa.count("mcp.oauth.finish")
	for _, path := range []string{"/agent/mcp/oauth/callback?state=st-1&code=the-code", "/agent/mcp/oauth/callback?state=made-up&code=x", "/agent/mcp/oauth/callback?code=x", "/agent/mcp/oauth/callback"} {
		if code, _, page := r.do("", "GET", path, nil); code != 400 || !strings.Contains(page, "not waiting") {
			t.Errorf("%s = %d %s", path, code, page)
		}
	}
	if wa.count("mcp.oauth.finish") != finishes {
		t.Fatal("a spent or made-up state reached the worker")
	}
}

func TestIntegrationADeniedSignInSpendsTheStateAndSavesNothing(t *testing.T) {
	r := newRig(t)
	a := addUser(t, r.db)
	r.addRemote(a, "linear", "https://mcp.example.test/mcp", true)
	wa := r.workers.of(a)
	wa.answers["mcp.oauth.begin"] = map[string]any{"authorize_url": "https://mcp.example.test/authorize?state=st-2", "state": "st-2"}
	wa.answers["mcp.oauth.finish"] = &agenthost.ReplyError{Type: "mcp.oauth.finish", Code: "bad_message", Message: "OAuth authorization failed: access_denied"}
	if code, _, _ := r.do(a, "POST", "/agent/mcp/servers/linear/sign-in", map[string]any{"redirectBase": "https://timely.example.test"}); code != 200 {
		t.Fatal("sign-in did not start")
	}
	code, _, page := r.do("", "GET", "/agent/mcp/oauth/callback?state=st-2&error=access_denied", nil)
	if code != 400 || !strings.Contains(page, "access_denied") {
		t.Fatalf("denied callback: %d %s", code, page)
	}
	if fin := wa.last(); fin["error"] != "access_denied" || fin["code"] != nil {
		t.Fatalf("finish was asked %v", fin)
	}
	var n int64
	r.db.Model(&Secret{}).Count(&n)
	if n != 0 {
		t.Fatal("a denied sign-in saved a token")
	}
	if v := r.mustList(a)[0]; v.SignedIn || !strings.Contains(v.LastError, "access_denied") {
		t.Fatalf("view %+v", v)
	}
	if code, _, _ := r.do("", "GET", "/agent/mcp/oauth/callback?state=st-2&code=late", nil); code != 400 {
		t.Fatal("the state of a denied sign-in worked again")
	}
}

func TestIntegrationASignInEndsWhenItsServerIsRemovedOrChanged(t *testing.T) {
	r := newRig(t)
	a := addUser(t, r.db)
	r.addRemote(a, "linear", "https://mcp.example.test/mcp", true)
	wa := r.workers.of(a)
	wa.answers["mcp.oauth.begin"] = map[string]any{"authorize_url": "https://mcp.example.test/authorize?state=st-3", "state": "st-3"}
	wa.answers["mcp.oauth.finish"] = map[string]any{"token": map[string]any{"tokens": map[string]any{"access_token": "x"}}}
	r.do(a, "POST", "/agent/mcp/servers/linear/sign-in", map[string]any{"redirectBase": "https://timely.example.test"})
	r.do(a, "DELETE", "/agent/mcp/servers/linear", nil)
	r.addRemote(a, "linear", "https://mcp.example.test/mcp", true)
	if code, _, _ := r.do("", "GET", "/agent/mcp/oauth/callback?state=st-3&code=c", nil); code != 400 {
		t.Fatalf("a sign-in begun for a removed server finished: %d", code)
	}
	if wa.count("mcp.oauth.finish") != 0 {
		t.Fatal("the worker was asked to finish it")
	}
}

func TestIntegrationTheCatalogIsAddableWithItsValuesAndMessagingServersToo(t *testing.T) {
	r := newRig(t)
	a := addUser(t, r.db)
	wa := r.workers.of(a)
	wa.answers["mcp.catalog"] = map[string]any{"servers": []any{
		map[string]any{"id": "asana", "name": "asana", "url": "https://mcp.asana.example.test/v2/mcp", "category": "projects", "flag": "", "auth": "oauth", "description": "Tasks.",
			"entry":  map[string]any{"url": "https://mcp.asana.example.test/v2/mcp", "auth": "oauth", "oauth": map[string]any{"client_id": "${ASANA_CLIENT_ID}", "client_secret": "${ASANA_CLIENT_SECRET}", "redirect_port": 27890}},
			"fields": []any{map[string]any{"name": "ASANA_CLIENT_ID", "prompt": "Client ID", "secret": false, "required": true}, map[string]any{"name": "ASANA_CLIENT_SECRET", "prompt": "Client secret", "secret": true, "required": true}}},
		map[string]any{"id": "intercom", "name": "intercom", "url": "https://mail.example.test/mcp", "category": "messaging", "flag": "Sends messages to other people", "auth": "none", "description": "Conversations.",
			"entry": map[string]any{"url": "https://mail.example.test/mcp"}, "fields": []any{}},
	}}
	r.dns.hosts["mcp.asana.example.test"] = []string{"93.184.216.50"}

	code, out, _ := r.do(a, "GET", "/agent/mcp/catalog", nil)
	if code != 200 || len(out["servers"].([]any)) != 2 {
		t.Fatalf("catalog %d %v", code, out)
	}
	if wa.count("mcp.catalog") != 1 {
		t.Fatal("no catalog request")
	}
	if code, out, _ := r.do(a, "POST", "/agent/mcp/servers", AddInput{CatalogID: "asana", Values: map[string]string{"ASANA_CLIENT_ID": "cid"}}); code != 400 || !strings.Contains(out["message"].(string), "Client secret") {
		t.Fatalf("a missing value: %d %v", code, out)
	}
	if code, _, _ := r.do(a, "POST", "/agent/mcp/servers", AddInput{CatalogID: "asana", Values: map[string]string{"ASANA_CLIENT_ID": "cid", "ASANA_CLIENT_SECRET": "sss", "EXTRA": "x"}}); code != 400 {
		t.Fatalf("a value the server does not take: %d", code)
	}
	code, out, _ = r.do(a, "POST", "/agent/mcp/servers", AddInput{CatalogID: "asana", Values: map[string]string{"ASANA_CLIENT_ID": "cid", "ASANA_CLIENT_SECRET": "sss-SECRETVALUE"}})
	if code != http.StatusCreated || out["server"].(map[string]any)["mode"] != "ask" || out["server"].(map[string]any)["catalogId"] != "asana" {
		t.Fatalf("add: %d %v", code, out)
	}
	if tables := dump(t, r.db, "agent_mcp_servers") + dump(t, r.db, "agent_secrets"); strings.Contains(tables, "sss-SECRETVALUE") {
		t.Fatal("a secret value is stored as plain text")
	}
	if entry := dump(t, r.db, "agent_mcp_servers"); !strings.Contains(entry, "${ASANA_CLIENT_SECRET}") || !strings.Contains(entry, `\"client_id\": \"cid\"`) && !strings.Contains(entry, `"client_id": "cid"`) {
		t.Fatalf("stored entry %s", entry)
	}
	servers, _, _, _, _ := r.account(a)
	var rendered map[string]any
	must(t, json.Unmarshal(servers["asana"], &rendered))
	if o := rendered["oauth"].(map[string]any); o["client_secret"] != "sss-SECRETVALUE" || o["client_id"] != "cid" {
		t.Fatalf("rendered %v", rendered)
	}
	// Q-5.6: a messaging-category server is addable like any other, and starts as Ask me first
	code, out, _ = r.do(a, "POST", "/agent/mcp/servers", AddInput{CatalogID: "intercom"})
	if code != http.StatusCreated || out["server"].(map[string]any)["mode"] != "ask" || out["server"].(map[string]any)["flag"] != "Sends messages to other people" {
		t.Fatalf("messaging server: %d %v", code, out)
	}
	if code, _, _ := r.do(a, "POST", "/agent/mcp/servers", AddInput{CatalogID: "nope"}); code != 404 {
		t.Fatalf("an unknown catalog id: %d", code)
	}
	code, out, _ = r.do(a, "GET", "/agent/mcp/catalog", nil)
	added := 0
	for _, s := range out["servers"].([]any) {
		if s.(map[string]any)["added"] == true {
			added++
		}
	}
	if added != 2 {
		t.Fatalf("catalog says %d added", added)
	}
	// an entry edit is not offered for a catalog server
	if code, _, _ := r.do(a, "PUT", "/agent/mcp/servers/asana", map[string]any{"url": "https://mail.example.test/other"}); code != 400 {
		t.Fatalf("catalog server address edit: %d", code)
	}
	r.do(a, "DELETE", "/agent/mcp/servers/asana", nil)
	var n int64
	r.db.Model(&Secret{}).Count(&n)
	if n != 0 {
		t.Fatalf("%d secrets left after removing", n)
	}
}

func TestIntegrationProbeKeepsToolHintsForTheGateAndNamesASignInProblem(t *testing.T) {
	r := newRig(t)
	a := addUser(t, r.db)
	r.addRemote(a, "notes", "https://notes.example.test/mcp", true)
	wa := r.workers.of(a)
	wa.answers["mcp.probe"] = map[string]any{"needs_sign_in": true, "error": "401 Unauthorized", "tools": []any{}}
	code, out, _ := r.do(a, "GET", "/agent/mcp/servers/notes/tools", nil)
	if code != 200 || out["needsSignIn"] != true {
		t.Fatalf("probe: %d %v", code, out)
	}
	if v := r.mustList(a)[0]; v.LastError == "" {
		t.Fatal("the failure is not on the row")
	}
	wa.answers["mcp.probe"] = map[string]any{"tools": []any{
		map[string]any{"name": "search_notes", "description": "Search", "annotations": map[string]any{"readOnlyHint": true}},
		map[string]any{"name": "send_message", "description": "Send", "annotations": map[string]any{}},
		map[string]any{"name": "delete_note", "description": "Delete", "annotations": map[string]any{"destructiveHint": true}},
	}}
	code, out, _ = r.do(a, "GET", "/agent/mcp/servers/notes/tools", nil)
	tools := out["tools"].([]any)
	if code != 200 || len(tools) != 3 || tools[1].(map[string]any)["class"] != "send" || tools[0].(map[string]any)["class"] != "read" || tools[2].(map[string]any)["class"] != "write" {
		t.Fatalf("tools %d %v", code, out)
	}
	if v := r.mustList(a)[0]; v.LastError != "" || len(v.Tools) != 3 {
		t.Fatalf("view after a good probe %+v", v)
	}
	if probe := wa.last(); probe["name"] != "notes" || probe["entry"].(map[string]any)["url"] != "https://notes.example.test/mcp" {
		t.Fatalf("worker asked %v", probe)
	}
	// the gate's question uses what the probe saw
	if got := r.svc.Classify(context.Background(), a, "notes", "search_notes").Kind; got != "fetch" {
		t.Errorf("Classify(search_notes) = %s", got)
	}
	if got := r.svc.Classify(context.Background(), a, "notes", "send_message").Kind; got != "send" {
		t.Errorf("Classify(send_message) = %s", got)
	}
}

func TestIntegrationWithoutAnAgentTheRoutesAnswer503(t *testing.T) {
	r := newRig(t)
	a := addUser(t, r.db)
	r.svc.o.Workers = nil
	if code, _, _ := r.do(a, "GET", "/agent/mcp/catalog", nil); code != http.StatusServiceUnavailable {
		t.Fatalf("catalog without an agent = %d", code)
	}
	r.addRemote(a, "notes", "https://notes.example.test/mcp", false) // adding a remote server needs no worker
	if code, _, _ := r.do(a, "GET", "/agent/mcp/servers/notes/tools", nil); code != http.StatusServiceUnavailable {
		t.Fatalf("probe without an agent = %d", code)
	}
}

func TestIntegrationAccountsCapServersAndNeverShareNames(t *testing.T) {
	r := newRig(t)
	a := addUser(t, r.db)
	for i := 0; i < maxServers; i++ {
		r.addRemote(a, "s"+strings.Repeat("x", i%5)+string(rune('a'+i/5))+string(rune('a'+i%26)), "https://notes.example.test/mcp", false)
	}
	if code, _, _ := r.do(a, "POST", "/agent/mcp/servers", AddInput{Name: "one-more", URL: "https://notes.example.test/mcp"}); code != 400 {
		t.Fatalf("no cap: %d", code)
	}
}
