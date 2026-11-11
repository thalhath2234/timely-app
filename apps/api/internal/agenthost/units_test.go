package agenthost

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
)

func TestBuildEnvRefusesDangerousToolKeys(t *testing.T) {
	layout := Layout{Root: filepath.Join("data", "agent")}
	for _, name := range []string{
		"JWT_SECRET", "DB_PASSWORD", "TIMELY_BACKUP_KEY", "API_PORT", "HERMES_YOLO", "HERMES_SAFE_MODE",
		"HERMES_EXEC_ASK", "HERMES_CRON_SESSION", "HERMES_ENABLE_PROJECT_PLUGINS", "HERMES_CONFIG_BACKEND",
		"HERMES_HOME", "HERMES_LANGUAGE", "HERMES_BUNDLED_LOCALES", "PATH", "HOME", "PYTHONPATH",
		"LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "TERMINAL_CWD", "XDG_STATE_HOME", "SYSTEMROOT",
		"lower_case", "BAD-NAME", "", "DATABASE_URL", "PGPASSWORD",
		// Shell, interpreter, proxy and TLS switches (review finding): not credentials.
		"BASH_ENV", "ENV", "NODE_OPTIONS", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "SSL_CERT_FILE",
		"REQUESTS_CA_BUNDLE", "PERL5OPT", "GCONV_PATH", "UV_INDEX_URL", "PIP_INDEX_URL", "BROWSER",
		"SSL_KEY", "UV_PUBLISH_TOKEN", "NODE_AUTH_TOKEN", "TELEGRAM_BOT_TOKEN", "SLACK_BOT_TOKEN",
		"HERMES_YOLO_MODE", "SUDO_PASSWORD", "_KEY",
		// Messaging platforms bundled at v0.23.0 (decision 6; hermes-sync-check checks every
		// kind: platform manifest against this list).
		"YUANBAO_APP_SECRET", "YUANBAO_APP_KEY", "A2A_BEARER_TOKEN", "NTFY_TOKEN", "IRC_NICKSERV_PASSWORD",
		"GOOGLE_CHAT_SERVICE_ACCOUNT_JSON", "BUZZ_PRIVATE_KEY", "QQBOT_HOME_CHANNEL", "SMS_ALLOWED_USERS",
	} {
		if _, err := BuildEnv(layout, "a", EnvConfig{}, map[string]string{name: "x"}); err == nil {
			t.Errorf("tool key %q accepted", name)
		}
	}
	env, err := BuildEnv(layout, "a", EnvConfig{}, map[string]string{"EXA_API_KEY": "k", "GITHUB_TOKEN": "g", "FIRECRAWL_API_KEY": "",
		"BROWSERBASE_PROJECT_ID": "p", "SEARXNG_URL": "http://searx"})
	if err != nil {
		t.Fatal(err)
	}
	joined := "\n" + strings.Join(env, "\n") + "\n"
	for _, want := range []string{"\nEXA_API_KEY=k\n", "\nGITHUB_TOKEN=g\n"} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing %q", want)
		}
	}
	if strings.Contains(joined, "FIRECRAWL_API_KEY") {
		t.Error("an empty key was set")
	}
	if _, err := BuildEnv(layout, "", EnvConfig{}, nil); err == nil {
		t.Error("no account accepted")
	}
}

func TestBuildEnvInheritsNothing(t *testing.T) {
	t.Setenv("JWT_SECRET", "s")
	t.Setenv("SSH_AUTH_SOCK", "/run/agent")
	t.Setenv("HERMES_HOME", "/somewhere/else")
	env, err := BuildEnv(Layout{Root: "r"}, "a", EnvConfig{Path: "/usr/bin", Packaged: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, kv := range env {
		name, value, _ := strings.Cut(kv, "=")
		switch name {
		case "JWT_SECRET", "SSH_AUTH_SOCK":
			t.Errorf("%s inherited", name)
		case "HERMES_HOME":
			if value != filepath.Join("r", "accounts", AccountDirName("a")) {
				t.Errorf("HERMES_HOME = %q", value)
			}
		}
	}
	if !strings.Contains(strings.Join(env, "\n"), "PYTHONDONTWRITEBYTECODE=1") {
		t.Error("packaged runtime without PYTHONDONTWRITEBYTECODE")
	}
	if runtime.GOOS == "windows" {
		// Hermes' Windows bootstrap would add them after the start check.
		for _, kv := range []string{"PYTHONUTF8=1", "PYTHONIOENCODING=utf-8"} {
			if !slices.Contains(env, kv) {
				t.Errorf("Windows worker environment lacks %s", kv)
			}
		}
	}
}

func TestAccountDirNameMatchesTheBackupScheme(t *testing.T) {
	// sha256("user-1")[:12], the same as portability.safeAccountDirectory.
	if got := AccountDirName("user-1"); got != "account-c6c289e49e9c05b214586038" {
		t.Fatalf("AccountDirName = %q", got)
	}
	if AccountDirName("a") == AccountDirName("b") {
		t.Fatal("two accounts share a folder")
	}
	if got := DefaultRoot(func(string) string { return "" }); got != filepath.Join("data", "agent") {
		t.Fatalf("DefaultRoot = %q", got)
	}
	if got := DefaultRoot(func(k string) string {
		if k == "TIMELY_DATA_DIR" {
			return "/srv/timely"
		}
		return ""
	}); got != filepath.Join("/srv/timely", "agent") {
		t.Fatalf("DefaultRoot = %q", got)
	}
}

func TestEncodeStampsTheEnvelope(t *testing.T) {
	line, err := encode("run.start", "", "acct", map[string]any{"run": "r1", "type": "spoofed"})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(line, &got); err != nil {
		t.Fatal(err)
	}
	if got["type"] != "run.start" || got["account"] != "acct" || got["run"] != "r1" {
		t.Fatalf("encoded %s", line)
	}
	if _, ok := got["id"]; ok {
		t.Fatal("empty id encoded")
	}
	if line[len(line)-1] != '\n' {
		t.Fatal("no newline")
	}
	if _, err := encode("x", "", "acct", map[string]any{"account": "other"}); err == nil {
		t.Fatal("encoded a message for another account")
	}
	if _, err := encode("x", "", "acct", []int{1}); err == nil {
		t.Fatal("encoded non-object fields")
	}
	if runField(map[string]any{"run": "r2"}) != "r2" {
		t.Fatal("runField")
	}
}

func TestParseLineChecksTheEnvelope(t *testing.T) {
	m, err := parseLine([]byte(`{"type":"event","account":"a","run":"r","kind":"delta"}`), "a")
	if err != nil || m.Type != "event" || m.Run != "r" || len(m.Raw) == 0 {
		t.Fatalf("%+v %v", m, err)
	}
	for _, bad := range []string{`not json`, `{"account":"a"}`, `{"type":"event"}`, `{"type":"event","account":"b"}`,
		`[1]`, `{"type":"error","account":"b","message":"x"}`, `{"type":"run.done","account":""}`,
		// Python's json.dumps writes these by default; the worker must never send them
		// (protocol.encode, allow_nan=False), since one kills the whole worker.
		`{"type":"event","account":"a","payload":{"x":NaN}}`, `{"type":"event","account":"a","payload":{"x":Infinity}}`} {
		if _, err := parseLine([]byte(bad), "a"); !errors.Is(err, ErrProtocol) {
			t.Errorf("%s: err = %v", bad, err)
		}
	}
	if _, err := parseLine([]byte(`{"type":"error","code":"refused","message":"x"}`), "a"); err != nil {
		t.Errorf("account-less error refused: %v", err)
	}
}

func TestSelfTestFailures(t *testing.T) {
	both := SelfTest{Failures: []string{"plugins: timely_bot failed"}, Checks: []SelfCheck{{Name: "plugins", Detail: "x"}}}
	if got := both.failures(); got != "plugins: timely_bot failed" {
		t.Fatalf("failures() = %q", got)
	}
	checks := SelfTest{Checks: []SelfCheck{{Name: "home", OK: true}, {Name: "mcp", Detail: "stdio server"}, {Name: "gate_hook"}}}
	if got := checks.failures(); got != "mcp: stdio server; gate_hook" {
		t.Fatalf("failures() = %q", got)
	}
}

func TestParseBusy(t *testing.T) {
	cases := map[string]Busy{
		`{"type":"heartbeat","account":"a","busy":{"runs":2,"learning":false,"children":0}}`: {Runs: 2},
		`{"type":"heartbeat","account":"a","runs":["r1","r2"],"ts":1}`:                       {Runs: 2},
		`{"type":"heartbeat","account":"a","runs":[],"learning":true}`:                       {Learning: true},
		`{"type":"pong","account":"a","busy":{"runs":1,"children":2}}`:                       {Runs: 1, Children: 2},
		`{"type":"heartbeat","account":"a","busy":{}}`:                                       {},
	}
	for raw, want := range cases {
		got, ok := parseBusy(Message{Raw: json.RawMessage(raw)})
		if !ok || got != want {
			t.Errorf("%s: %+v %v, want %+v", raw, got, ok, want)
		}
	}
	if _, ok := parseBusy(Message{Raw: json.RawMessage(`{"type":"pong","account":"a","id":"go-ping-1"}`)}); ok {
		t.Error("a bare pong reported busy state")
	}
}

func TestReadLineLimitsAndCRLF(t *testing.T) {
	r := bufio.NewReaderSize(strings.NewReader("one\r\ntwo\nthree"), 16)
	for _, want := range []string{"one", "two", "three"} {
		got, err := readLine(r, 100)
		if err != nil || string(got) != want {
			t.Fatalf("got %q %v, want %q", got, err, want)
		}
	}
	long := bufio.NewReaderSize(strings.NewReader(strings.Repeat("x", 200)+"\n"), 16)
	if _, err := readLine(long, 100); !errors.Is(err, errLineTooLong) {
		t.Fatalf("err = %v", err)
	}
}

func TestResolveRuntime(t *testing.T) {
	root := t.TempDir()
	agent := filepath.Join(root, "apps", "agent")
	boot := filepath.Join(agent, "timely_agent", "boot.py")
	python := venvPython(agent)
	api := filepath.Join(root, "apps", "api")
	for _, dir := range []string{filepath.Dir(boot), filepath.Dir(python), api} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(boot, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ResolveRuntime("", api); !errors.Is(err, ErrNoRuntime) || !strings.Contains(err.Error(), "agent-install") {
		t.Fatalf("missing venv: %v", err)
	}
	if err := os.WriteFile(python, nil, 0o755); err != nil {
		t.Fatal(err)
	}
	want := PythonRuntime(python, boot)
	for _, value := range []string{"", agent, filepath.Dir(boot), boot} {
		got, err := ResolveRuntime(value, api)
		if err != nil {
			t.Fatalf("%q: %v", value, err)
		}
		if got.Program != want.Program || strings.Join(got.Args, " ") != strings.Join(want.Args, " ") {
			t.Fatalf("%q: %+v, want %+v", value, got, want)
		}
	}
	interp := filepath.Join(root, "python3")
	if err := os.WriteFile(interp, nil, 0o755); err != nil {
		t.Fatal(err)
	}
	got, err := ResolveRuntime(interp, api)
	if err != nil || got.Program != interp || got.Args[1] != boot {
		t.Fatalf("interpreter: %+v %v", got, err)
	}
	if len(got.Args) != 2 || got.Args[0] != "-I" || got.command("worker")[2] != "worker" {
		t.Fatalf("args %v", got.Args)
	}
	if _, err := ResolveRuntime(filepath.Join(root, "missing"), api); !errors.Is(err, ErrNoRuntime) {
		t.Fatalf("missing path: %v", err)
	}
	if _, err := ResolveRuntime("", t.TempDir()); !errors.Is(err, ErrNoRuntime) {
		t.Fatalf("no apps/agent: %v", err)
	}
	if runtime.GOOS == "windows" && !strings.HasSuffix(python, "python.exe") {
		t.Fatal("windows venv python")
	}
}

func TestConfigFromEnv(t *testing.T) {
	env := map[string]string{"TIMELY_AGENT_MAX_WORKERS": "5", "TIMELY_AGENT_IDLE_MINUTES": "2", "TIMELY_DATA_DIR": "/d", "PATH": "/bin"}
	cfg := ConfigFromEnv(func(k string) string { return env[k] }, t.TempDir())
	if cfg.MaxWorkers != 5 || cfg.IdleTimeout.Minutes() != 2 || cfg.Root != filepath.Join("/d", "agent") || cfg.Env.Path != "/bin" {
		t.Fatalf("%+v", cfg)
	}
	if cfg.Runtime.Program != "" || !errors.Is(cfg.RuntimeErr, ErrNoRuntime) {
		t.Fatalf("runtime %+v %v", cfg.Runtime, cfg.RuntimeErr)
	}
	env = map[string]string{"TIMELY_AGENT_MAX_WORKERS": "zero", "TIMELY_AGENT_IDLE_MINUTES": "-1"}
	cfg = ConfigFromEnv(func(k string) string { return env[k] }, t.TempDir())
	if cfg.MaxWorkers != 3 || cfg.IdleTimeout.Minutes() != 15 {
		t.Fatalf("defaults %+v", cfg)
	}
}
