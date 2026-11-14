package instance

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/labstack/echo/v5"
	"github.com/pressly/goose/v3"

	_ "github.com/jackc/pgx/v5/stdlib"
	"timely-api/internal/database"
)

// schemaDB makes a scratch PostgreSQL schema (CHAT_TEST_ENV, as
// make test-chat-integration sets it) and returns a connection whose
// search_path is that schema. The schema is dropped with the test.
func schemaDB(t *testing.T) *sql.DB {
	t.Helper()
	file := os.Getenv("CHAT_TEST_ENV")
	if file == "" {
		t.Skip("set CHAT_TEST_ENV via make test-chat-integration for isolated PostgreSQL tests")
	}
	env, err := godotenv.Read(file)
	if err != nil {
		t.Fatal(err)
	}
	dsn := func(schema string) string {
		u := &url.URL{Scheme: "postgres", Host: env["DB_HOST"] + ":" + env["DB_PORT"], Path: env["DB_NAME"], User: url.UserPassword(env["DB_USER"], env["DB_PASSWORD"])}
		q := url.Values{"sslmode": []string{env["DB_SSLMODE"]}}
		if schema != "" {
			q.Set("search_path", schema+",public")
		}
		u.RawQuery = q.Encode()
		return u.String()
	}
	root, err := sql.Open("pgx", dsn(""))
	if err != nil {
		t.Fatal(err)
	}
	schema := "instance_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := root.Exec("CREATE SCHEMA " + schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = root.Exec("DROP SCHEMA " + schema + " CASCADE"); root.Close() })
	db, err := sql.Open("pgx", dsn(schema))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func exec(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
}

func tableExists(t *testing.T, db *sql.DB, name string) bool {
	t.Helper()
	var ok bool
	if err := db.QueryRow(`SELECT to_regclass($1) IS NOT NULL`, name).Scan(&ok); err != nil {
		t.Fatal(err)
	}
	return ok
}

func columnExists(t *testing.T, db *sql.DB, table, column string) bool {
	t.Helper()
	var ok bool
	if err := db.QueryRow(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2)`, table, column).Scan(&ok); err != nil {
		t.Fatal(err)
	}
	return ok
}

const (
	beforePhase5 = 20261113000900 // the last migration phase 4 added
	firstPhase5  = 20261113215338
)

var phase5Tables = []string{"instance_settings", "agent_host_events", "agent_mcp_servers", "agent_secrets"}

// migrate runs the embedded migrations up to version (0: all) in this
// schema, keeping goose's version table inside it.
func migrate(t *testing.T, db *sql.DB, schema string, version int64) {
	t.Helper()
	goose.SetTableName(schema + ".goose_db_version")
	t.Cleanup(func() { goose.SetTableName("goose_db_version") })
	if version == 0 {
		if err := database.RunMigrations(db); err != nil {
			t.Fatal(err)
		}
		return
	}
	if err := goose.UpTo(db, ".", version); err != nil {
		t.Fatal(err)
	}
}

func currentSchema(t *testing.T, db *sql.DB) string {
	t.Helper()
	var schema string
	if err := db.QueryRow(`SELECT current_schema()`).Scan(&schema); err != nil {
		t.Fatal(err)
	}
	return schema
}

func addUser(t *testing.T, db *sql.DB, email string) string {
	t.Helper()
	id := "usr_" + uuid.NewString()
	exec(t, db, `INSERT INTO users (id, email, name, password, created_at, updated_at) VALUES ($1, $2, 'Test', 'x', now(), now())`, id, email)
	return id
}

// The six phase 5 migrations run up on a fresh schema, turn every stored
// 'full' permission into 'auto', run down one by one, and run up again.
func TestIntegrationPhase5MigrationsUpAndDown(t *testing.T) {
	db := schemaDB(t)
	schema := currentSchema(t, db)
	migrate(t, db, schema, beforePhase5)
	for _, name := range phase5Tables {
		if tableExists(t, db, name) {
			t.Fatalf("%s exists before its migration", name)
		}
	}

	// What phase 2 to 4 left behind: a chat and defaults on Full Access.
	uid := addUser(t, db, "full@example.test")
	exec(t, db, `INSERT INTO agent_conversations (id, user_id, title, permission) VALUES ('chat_full', $1, 'Full chat', 'full'), ('chat_sup', $1, 'Supervised chat', 'supervised')`, uid)
	exec(t, db, `INSERT INTO agent_chat_settings (user_id, chat_permission, bot_permission) VALUES ($1, 'full', 'full')`, uid)

	if err := goose.UpTo(db, ".", firstPhase5-1); err != nil {
		t.Fatal(err)
	}
	if err := goose.Up(db, "."); err != nil {
		t.Fatal(err)
	}
	for _, name := range phase5Tables {
		if !tableExists(t, db, name) {
			t.Errorf("%s missing after up", name)
		}
	}
	for _, col := range []string{"host_request", "host_grants", "continuation", "full_access"} {
		if !columnExists(t, db, "agent_conversations", col) {
			t.Errorf("agent_conversations.%s missing", col)
		}
	}
	for _, col := range []string{"host_approval_rule", "host_approval_timeout_minutes", "full_access_default"} {
		if !columnExists(t, db, "agent_chat_settings", col) {
			t.Errorf("agent_chat_settings.%s missing", col)
		}
	}
	perm := func(id string) (p string) {
		if err := db.QueryRow(`SELECT permission FROM agent_conversations WHERE id = $1`, id).Scan(&p); err != nil {
			t.Fatal(err)
		}
		return
	}
	if perm("chat_full") != "auto" || perm("chat_sup") != "supervised" {
		t.Errorf("permissions after up: full chat %q, supervised chat %q", perm("chat_full"), perm("chat_sup"))
	}
	var chatP, botP, rule string
	var timeout int
	if err := db.QueryRow(`SELECT chat_permission, bot_permission, host_approval_rule, host_approval_timeout_minutes FROM agent_chat_settings WHERE user_id = $1`, uid).Scan(&chatP, &botP, &rule, &timeout); err != nil {
		t.Fatal(err)
	}
	if chatP != "auto" || botP != "auto" || rule != "devices" || timeout != 60 {
		t.Errorf("settings after up: %s %s %s %d", chatP, botP, rule, timeout)
	}

	// Constraints the packages rely on.
	if _, err := db.Exec(`UPDATE agent_chat_settings SET host_approval_timeout_minutes = 5 WHERE user_id = $1`, uid); err == nil {
		t.Error("a 5 minute approval timeout was accepted (10 to 60)")
	}
	if _, err := db.Exec(`UPDATE agent_chat_settings SET host_approval_rule = 'anyone' WHERE user_id = $1`, uid); err == nil {
		t.Error("an unknown host approval rule was accepted")
	}
	exec(t, db, `INSERT INTO agent_mcp_servers (user_id, name, mode) VALUES ($1, 'echo', 'ask')`, uid)
	if _, err := db.Exec(`INSERT INTO agent_mcp_servers (user_id, name) VALUES ($1, 'echo')`, uid); err == nil {
		t.Error("a duplicate server name was accepted")
	}
	if _, err := db.Exec(`INSERT INTO agent_mcp_servers (user_id, name, mode) VALUES ($1, 'other', 'sometimes')`, uid); err == nil {
		t.Error("an unknown MCP mode was accepted")
	}
	exec(t, db, `INSERT INTO agent_secrets (user_id, kind, name, ciphertext) VALUES ($1, 'mcp_oauth', 'echo', '\x00'::bytea)`, uid)
	exec(t, db, `INSERT INTO agent_host_events (user_id, conversation_id, kind, tool) VALUES ($1, 'chat_full', 'requested', 'terminal')`, uid)
	if _, err := db.Exec(`INSERT INTO agent_host_events (user_id, conversation_id, kind) VALUES ($1, 'chat_full', 'guessed')`, uid); err == nil {
		t.Error("an unknown host event kind was accepted")
	}
	// Deleted with the chat and with the account.
	exec(t, db, `DELETE FROM agent_conversations WHERE id = 'chat_full'`)
	var events int
	_ = db.QueryRow(`SELECT count(*) FROM agent_host_events`).Scan(&events)
	if events != 0 {
		t.Errorf("host events survived their chat: %d", events)
	}
	exec(t, db, `DELETE FROM users WHERE id = $1`, uid)
	var servers, secrets int
	_ = db.QueryRow(`SELECT count(*) FROM agent_mcp_servers`).Scan(&servers)
	_ = db.QueryRow(`SELECT count(*) FROM agent_secrets`).Scan(&secrets)
	if servers != 0 || secrets != 0 {
		t.Errorf("MCP servers %d and secrets %d survived their account", servers, secrets)
	}

	// Down, one migration at a time, back to where phase 4 ended.
	for i := 0; i < 6; i++ {
		if err := goose.Down(db, "."); err != nil {
			t.Fatalf("down %d: %v", i+1, err)
		}
	}
	for _, name := range phase5Tables {
		if tableExists(t, db, name) {
			t.Errorf("%s survived the down steps", name)
		}
	}
	if columnExists(t, db, "agent_conversations", "host_request") || columnExists(t, db, "agent_chat_settings", "host_approval_rule") {
		t.Error("a phase 5 column survived the down steps")
	}
	if v, err := goose.GetDBVersion(db); err != nil || v != beforePhase5 {
		t.Errorf("version after down = %d (%v), want %d", v, err, int64(beforePhase5))
	}
	// And up again.
	if err := goose.Up(db, "."); err != nil {
		t.Fatalf("up again: %v", err)
	}
	if !tableExists(t, db, "agent_host_events") || !columnExists(t, db, "agent_conversations", "continuation") {
		t.Error("up again did not restore the phase 5 schema")
	}
}

// test server pieces ---------------------------------------------------------

func testRouter(t *testing.T, store *Store, db *sql.DB) *echo.Echo {
	t.Helper()
	h := NewHandler(Config{}, db)
	h.SetStore(store)
	e := echo.New()
	// Stands in for the JWT middleware: the test names the signed-in account.
	auth := func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			uid := c.Request().Header.Get("X-Test-User")
			if uid == "" {
				return echo.NewHTTPError(http.StatusUnauthorized, "Missing session")
			}
			c.Set("userID", uid)
			return next(c)
		}
	}
	h.Routes(e, auth)
	return e
}

func call(t *testing.T, base, method, path, user, token, body string) (int, map[string]any) {
	t.Helper()
	r, err := http.NewRequest(method, base+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	r.Header.Set("Content-Type", "application/json")
	if user != "" {
		r.Header.Set("X-Test-User", user)
	}
	if token != "" {
		r.Header.Set(ShellTokenHeader, token)
	}
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func nonLoopbackIP(t *testing.T) net.IP {
	t.Helper()
	ifaces, err := net.Interfaces()
	if err != nil {
		t.Skipf("no interfaces: %v", err)
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, a := range addrs {
			if n, ok := a.(*net.IPNet); ok && n.IP.To4() != nil && n.IP.IsGlobalUnicast() {
				return n.IP.To4()
			}
		}
	}
	t.Skip("this host has no non-loopback IPv4 address to listen on")
	return nil
}

func hostIDs(settings map[string]any) []string {
	var ids []string
	for _, a := range settings["hostAccounts"].([]any) {
		ids = append(ids, a.(map[string]any)["uid"].(string))
	}
	return ids
}

func TestIntegrationHostAccountsRoutes(t *testing.T) {
	db := schemaDB(t)
	schema := currentSchema(t, db)
	migrate(t, db, schema, 0)
	SetShellToken(testToken)
	t.Cleanup(func() { SetShellToken("") })

	alice := addUser(t, db, "alice@example.test")
	bob := addUser(t, db, "bob@example.test")
	carol := addUser(t, db, "carol@example.test")
	server := addUser(t, db, "server@example.test")
	store := NewStore(db, []string{server}, AgentLimits{MaxWorkers: 3, IdleMinutes: 15})
	router := testRouter(t, store, db)

	loopback := httptest.NewServer(router)
	t.Cleanup(loopback.Close)

	// A listener on a non-loopback address: the peer is not loopback, so the
	// right token still gets 404.
	ip := nonLoopbackIP(t)
	ln, err := net.Listen("tcp", net.JoinHostPort(ip.String(), "0"))
	if err != nil {
		t.Skipf("cannot listen on %s: %v", ip, err)
	}
	lan := &http.Server{Handler: router, ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = lan.Serve(ln) }()
	t.Cleanup(func() { _ = lan.Close() })
	lanURL := "http://" + ln.Addr().String()

	on := fmt.Sprintf(`{"uid":%q,"on":true}`, alice)

	// No token, a wrong token and the right token from a non-loopback
	// address each get 404, before sign-in is even asked.
	for name, tc := range map[string]struct{ base, user, token string }{
		"no token":                    {loopback.URL, alice, ""},
		"no token and no session":     {loopback.URL, "", ""},
		"wrong token":                 {loopback.URL, alice, testToken + "x"},
		"right token, LAN listener":   {lanURL, alice, testToken},
		"right token, no session LAN": {lanURL, "", testToken},
	} {
		if code, _ := call(t, tc.base, http.MethodPut, "/instance/host-accounts", tc.user, tc.token, on); code != http.StatusNotFound {
			t.Errorf("PUT /instance/host-accounts, %s: %d, want 404", name, code)
		}
		if code, _ := call(t, tc.base, http.MethodPut, "/instance/agent-limits", tc.user, tc.token, `{"maxWorkers":2,"idleMinutes":5}`); code != http.StatusNotFound {
			t.Errorf("PUT /instance/agent-limits, %s: %d, want 404", name, code)
		}
	}
	if store.IsHostAllowed(context.Background(), alice) {
		t.Fatal("an account was allowed by a refused request")
	}
	// The right token from loopback but no session still stops at sign-in.
	if code, _ := call(t, loopback.URL, http.MethodPut, "/instance/host-accounts", "", testToken, on); code != http.StatusUnauthorized {
		t.Errorf("right token without a session: %d, want 401", code)
	}
	// The account named must be the signed-in one.
	if code, _ := call(t, loopback.URL, http.MethodPut, "/instance/host-accounts", bob, testToken, on); code != http.StatusForbidden {
		t.Errorf("turning on another account: %d, want 403", code)
	}
	if store.IsHostAllowed(context.Background(), alice) {
		t.Fatal("another account's uid was turned on")
	}

	// Two accounts, each turned on separately, are both host-allowed; a third
	// is not.
	code, out := call(t, loopback.URL, http.MethodPut, "/instance/host-accounts", alice, testToken, on)
	if code != http.StatusOK {
		t.Fatalf("alice on: %d %v", code, out)
	}
	if out["thisAccountHostAllowed"] != true || out["shell"] != true {
		t.Errorf("alice's response: %v", out)
	}
	if code, out = call(t, loopback.URL, http.MethodPut, "/instance/host-accounts", bob, testToken, fmt.Sprintf(`{"uid":%q,"on":true}`, bob)); code != http.StatusOK {
		t.Fatalf("bob on: %d %v", code, out)
	}
	ctx := context.Background()
	for uid, want := range map[string]bool{alice: true, bob: true, carol: false, server: true, "": false, "nobody": false} {
		if got := store.IsHostAllowed(ctx, uid); got != want {
			t.Errorf("IsHostAllowed(%q) = %v, want %v", uid, got, want)
		}
	}

	// GET /instance/settings: signed in, shows the union with its source, and
	// says whether this request is the desktop window.
	code, out = call(t, loopback.URL, http.MethodGet, "/instance/settings", carol, "", "")
	if code != http.StatusOK {
		t.Fatalf("settings: %d %v", code, out)
	}
	if out["thisAccountHostAllowed"] != false || out["shell"] != false || out["maxWorkers"] != float64(3) || out["idleMinutes"] != float64(15) {
		t.Errorf("carol's settings: %v", out)
	}
	// Review finding: a signed-in account that is not host-allowed, in a plain
	// browser (no shell token), reads no other account's id, email or folder:
	// only how many others there are.
	if got := hostIDs(out); len(got) != 0 || out["otherHostAccounts"] != float64(3) {
		t.Errorf("carol (not host-allowed, no token) sees accounts %v, others %v", got, out["otherHostAccounts"])
	}
	if raw, _ := json.Marshal(out); strings.Contains(string(raw), "bob@example.test") || strings.Contains(string(raw), alice) || strings.Contains(string(raw), "server@example.test") {
		t.Errorf("carol's settings name another account: %s", raw)
	}
	// A host-allowed account in a plain browser sees its own row and a count.
	if _, own := call(t, loopback.URL, http.MethodGet, "/instance/settings", bob, "", ""); strings.Join(hostIDs(own), ",") != bob ||
		own["otherHostAccounts"] != float64(2) || own["thisAccountHostAllowed"] != true || own["shell"] != false {
		t.Errorf("bob's own settings in a browser: %v", own)
	}
	// The desktop window sees every account with its email and source.
	_, full := call(t, loopback.URL, http.MethodGet, "/instance/settings", carol, testToken, "")
	if got := strings.Join(hostIDs(full), ","); got != alice+","+bob+","+server {
		t.Errorf("the desktop window's host accounts = %s", got)
	}
	sources := map[string]string{}
	emails := map[string]string{}
	for _, a := range full["hostAccounts"].([]any) {
		m := a.(map[string]any)
		sources[m["uid"].(string)], emails[m["uid"].(string)] = m["source"].(string), m["email"].(string)
	}
	if sources[alice] != "desktop" || sources[server] != "server" || emails[bob] != "bob@example.test" {
		t.Errorf("sources %v emails %v", sources, emails)
	}
	if code, _ = call(t, loopback.URL, http.MethodGet, "/instance/settings", "", "", ""); code != http.StatusUnauthorized {
		t.Errorf("settings without a session: %d", code)
	}
	if _, out = call(t, loopback.URL, http.MethodGet, "/instance/settings", alice, testToken, ""); out["shell"] != true || out["thisAccountHostAllowed"] != true {
		t.Errorf("the desktop window's own settings: %v", out)
	}

	// Turning an account off; a server-named account cannot be turned off here.
	if code, out = call(t, loopback.URL, http.MethodPut, "/instance/host-accounts", bob, testToken, fmt.Sprintf(`{"uid":%q,"on":false}`, bob)); code != http.StatusOK {
		t.Fatalf("bob off: %d %v", code, out)
	}
	if store.IsHostAllowed(ctx, bob) || !store.IsHostAllowed(ctx, alice) {
		t.Error("turning bob off changed the wrong accounts")
	}
	if code, _ = call(t, loopback.URL, http.MethodPut, "/instance/host-accounts", server, testToken, fmt.Sprintf(`{"uid":%q,"on":false}`, server)); code != http.StatusBadRequest {
		t.Errorf("turning off a server-named account: %d, want 400", code)
	}
	if !store.IsHostAllowed(ctx, server) {
		t.Error("the server-named account was turned off")
	}

	// Working folder: an existing absolute folder only, and only for an account
	// that is on.
	dir := filepath.Join(os.Getenv("HOME"), ".cache", "p5-sandbox", "work-instance-test")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	if code, out = call(t, loopback.URL, http.MethodPut, "/instance/host-accounts", alice, testToken, fmt.Sprintf(`{"uid":%q,"workingDir":%q}`, alice, dir)); code != http.StatusOK || out["thisAccountWorkingDir"] != dir {
		t.Errorf("set folder: %d %v", code, out)
	}
	if got := store.WorkingDir(ctx, alice); got != dir {
		t.Errorf("WorkingDir(alice) = %q", got)
	}
	file := filepath.Join(dir, "a-file")
	if err := os.WriteFile(file, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	for name, folder := range map[string]string{"relative": "work", "missing": filepath.Join(dir, "nope"), "a file": file} {
		if code, _ = call(t, loopback.URL, http.MethodPut, "/instance/host-accounts", alice, testToken, fmt.Sprintf(`{"uid":%q,"workingDir":%q}`, alice, folder)); code != http.StatusBadRequest {
			t.Errorf("%s folder: %d, want 400", name, code)
		}
	}
	if code, _ = call(t, loopback.URL, http.MethodPut, "/instance/host-accounts", carol, testToken, fmt.Sprintf(`{"uid":%q,"workingDir":%q}`, carol, dir)); code != http.StatusBadRequest {
		t.Errorf("folder for an account that is off: %d, want 400", code)
	}
	if got := store.WorkingDir(ctx, carol); got != "" {
		t.Errorf("WorkingDir(carol) = %q", got)
	}
	if code, _ = call(t, loopback.URL, http.MethodPut, "/instance/host-accounts", alice, testToken, fmt.Sprintf(`{"uid":%q,"workingDir":""}`, alice)); code != http.StatusOK || store.WorkingDir(ctx, alice) != "" {
		t.Errorf("clearing the folder: %d, %q", code, store.WorkingDir(ctx, alice))
	}
	if code, _ = call(t, loopback.URL, http.MethodPut, "/instance/host-accounts", alice, testToken, `{"uid":"`+alice+`","extra":1}`); code != http.StatusBadRequest {
		t.Errorf("unknown field: %d", code)
	}

	// Worker limits.
	var applied []AgentLimits
	store.OnLimits(func(l AgentLimits) { applied = append(applied, l) })
	if len(applied) != 1 || applied[0] != (AgentLimits{3, 15}) {
		t.Errorf("OnLimits did not apply the effective limits first: %v", applied)
	}
	if code, out = call(t, loopback.URL, http.MethodPut, "/instance/agent-limits", alice, testToken, `{"maxWorkers":5,"idleMinutes":30}`); code != http.StatusOK || out["maxWorkers"] != float64(5) || out["idleMinutes"] != float64(30) {
		t.Errorf("limits: %d %v", code, out)
	}
	if len(applied) != 2 || applied[1] != (AgentLimits{5, 30}) {
		t.Errorf("the supervisor was not told: %v", applied)
	}
	for _, body := range []string{`{"maxWorkers":0,"idleMinutes":30}`, `{"maxWorkers":17,"idleMinutes":30}`, `{"maxWorkers":3,"idleMinutes":0}`, `{"maxWorkers":3,"idleMinutes":241}`} {
		if code, _ = call(t, loopback.URL, http.MethodPut, "/instance/agent-limits", alice, testToken, body); code != http.StatusBadRequest {
			t.Errorf("limits %s: %d, want 400", body, code)
		}
	}
	if l, _ := store.AgentLimits(ctx); l != (AgentLimits{5, 30}) {
		t.Errorf("limits after refused saves: %v", l)
	}
}

// The store caches for a few seconds; a write through another Store (another
// process) is seen after the TTL, and a write through this one at once.
func TestIntegrationStoreSeesChangesAndFailsClosed(t *testing.T) {
	db := schemaDB(t)
	migrate(t, db, currentSchema(t, db), 0)
	uid := addUser(t, db, "cache@example.test")
	ctx := context.Background()
	store := NewStore(db, nil, AgentLimits{MaxWorkers: 3, IdleMinutes: 15})
	clock := time.Now()
	store.now = func() time.Time { return clock }
	if store.IsHostAllowed(ctx, uid) {
		t.Fatal("allowed before anything was stored")
	}
	on := true
	if err := store.SetHostAccount(ctx, uid, &on, nil); err != nil {
		t.Fatal(err)
	}
	if !store.IsHostAllowed(ctx, uid) {
		t.Fatal("not allowed right after SetHostAccount (cache not invalidated)")
	}
	other := NewStore(db, nil, AgentLimits{})
	off := false
	if err := other.SetHostAccount(ctx, uid, &off, nil); err != nil {
		t.Fatal(err)
	}
	if !store.IsHostAllowed(ctx, uid) {
		t.Error("the cache dropped before its TTL")
	}
	clock = clock.Add(hostCacheTTL + time.Second)
	if store.IsHostAllowed(ctx, uid) {
		t.Error("another process's change was not seen after the TTL")
	}
	// Unreadable store: only the environment counts.
	broken := NewStore(db, []string{"from-env"}, AgentLimits{})
	db.Close()
	if broken.IsHostAllowed(ctx, uid) || !broken.IsHostAllowed(ctx, "from-env") {
		t.Error("a store that cannot be read must allow only the environment's accounts")
	}
}
