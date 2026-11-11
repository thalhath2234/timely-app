package agenthost

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// helloEcho is the fake worker's echo of the hello the supervisor sent.
type helloEcho struct {
	Hello struct {
		CatalogVersion string `json:"catalog_version"`
		TimelyTools    *struct {
			CatalogVersion string            `json:"catalog_version"`
			Tools          []json.RawMessage `json:"tools"`
		} `json:"timely_tools"`
	} `json:"hello"`
}

func echoHello(t *testing.T, h *harness, account string) helloEcho {
	t.Helper()
	w, ok := h.sup.Worker(account)
	if !ok {
		t.Fatal("no worker")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	reply, err := w.Request(ctx, TypeHello, helloFields{Protocol: ProtocolVersion, Home: w.Home()})
	if err != nil {
		t.Fatal(err)
	}
	var out helloEcho
	if err := reply.Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

const specJSON = `[{"name":"get_context","description":"What the person is looking at","parameters":{"type":"object","properties":{}},"outside":false}]`

func TestHelloCarriesTheTimelyToolCatalog(t *testing.T) {
	h := newHarness(t, "ok", func(c *Config) {
		c.CatalogVersion = "ignored-when-timely-tools-is-set"
		c.TimelyTools = func(context.Context) (string, json.RawMessage, error) {
			return "sha-1", json.RawMessage(specJSON), nil
		}
	})
	w := h.ensure("acct-1")
	if w.CatalogVersion() != "sha-1" {
		t.Fatalf("worker catalog version %q", w.CatalogVersion())
	}
	echo := echoHello(t, h, "acct-1")
	if echo.Hello.CatalogVersion != "sha-1" || echo.Hello.TimelyTools == nil ||
		echo.Hello.TimelyTools.CatalogVersion != "sha-1" || len(echo.Hello.TimelyTools.Tools) != 1 {
		t.Fatalf("hello = %+v", echo.Hello)
	}
	var tool struct {
		Name    string `json:"name"`
		Outside *bool  `json:"outside"`
	}
	if err := json.Unmarshal(echo.Hello.TimelyTools.Tools[0], &tool); err != nil || tool.Name != "get_context" || tool.Outside == nil {
		t.Fatalf("tool spec = %s (%v)", echo.Hello.TimelyTools.Tools[0], err)
	}
}

func TestHelloWithoutTimelyToolsSendsTheCatalogVersionOnly(t *testing.T) {
	h := newHarness(t, "ok", func(c *Config) { c.CatalogVersion = "cat-9" })
	h.ensure("acct-1")
	echo := echoHello(t, h, "acct-1")
	if echo.Hello.CatalogVersion != "cat-9" || echo.Hello.TimelyTools != nil {
		t.Fatalf("hello = %+v", echo.Hello)
	}
}

func TestEmptyCatalogVersionIsTheToolsHash(t *testing.T) {
	h := newHarness(t, "ok", func(c *Config) {
		c.TimelyTools = func(context.Context) (string, json.RawMessage, error) {
			return "", json.RawMessage(" " + specJSON + "\n"), nil
		}
	})
	w := h.ensure("acct-1")
	if want := toolsVersion(json.RawMessage(specJSON)); w.CatalogVersion() != want || len(want) != 64 {
		t.Fatalf("catalog version %q, want %q", w.CatalogVersion(), want)
	}
}

func TestUnreadableToolSpecsStopTheStart(t *testing.T) {
	for name, tools := range map[string]func(context.Context) (string, json.RawMessage, error){
		"error": func(context.Context) (string, json.RawMessage, error) { return "", nil, errors.New("catalog broke") },
		"not a list": func(context.Context) (string, json.RawMessage, error) {
			return "v", json.RawMessage(`{"name":"x"}`), nil
		},
		"bad json": func(context.Context) (string, json.RawMessage, error) { return "v", json.RawMessage(`[{`), nil },
	} {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t, "ok", func(c *Config) { c.TimelyTools = tools })
			err := h.ensureErr("acct-1")
			var se *StartError
			if !errors.As(err, &se) || !strings.Contains(se.Error(), "Timely tool specs") && !strings.Contains(se.Error(), "catalog broke") {
				t.Fatalf("err = %v", err)
			}
		})
	}
}

func TestStaleCatalogRestartsAnIdleWorkerNeverMidRun(t *testing.T) {
	var version atomic.Value
	version.Store("v1")
	h := newHarness(t, "ok", func(c *Config) {
		c.StaleGrace = 300 * time.Millisecond
		c.TimelyTools = func(context.Context) (string, json.RawMessage, error) {
			v := version.Load().(string)
			return v, json.RawMessage(`[{"name":"tool_` + v + `"}]`), nil
		}
	})
	w1 := h.ensure("acct-1")
	if w1.CatalogVersion() != "v1" {
		t.Fatalf("version %q", w1.CatalogVersion())
	}

	// A live run keeps the old worker, whatever its catalog.
	if err := w1.Send(TypeRunStart, map[string]any{"run": "hang-1", "conversation_id": "c1"}); err != nil {
		t.Fatal(err)
	}
	h.message("event")
	version.Store("v2")
	time.Sleep(500 * time.Millisecond)
	if w := h.ensure("acct-1"); w.PID() != w1.PID() {
		t.Fatalf("a worker with a live run was replaced (pid %d, then %d)", w1.PID(), w.PID())
	}
	if err := w1.Send(TypeRunStop, map[string]any{"run": "hang-1", "reason": "test"}); err != nil {
		t.Fatal(err)
	}
	h.message(TypeRunDone)

	// Used a moment ago (the Ensure above claimed it): still served as is.
	if w := h.ensure("acct-1"); w.PID() != w1.PID() {
		t.Fatalf("a worker used within StaleGrace was replaced")
	}
	time.Sleep(500 * time.Millisecond)

	// Idle now: stopped and replaced before the next run.
	w2 := h.ensure("acct-1")
	if w2.PID() == w1.PID() || w2.CatalogVersion() != "v2" {
		t.Fatalf("stale worker kept: pid %d (was %d), version %q", w2.PID(), w1.PID(), w2.CatalogVersion())
	}
	exit := h.exit(5 * time.Second)
	if exit.PID != w1.PID() || exit.Reason != "catalog changed" || exit.Crashed || len(exit.LiveRuns) != 0 {
		t.Fatalf("exit = %+v", exit)
	}
	echo := echoHello(t, h, "acct-1")
	if echo.Hello.TimelyTools == nil || echo.Hello.TimelyTools.CatalogVersion != "v2" {
		t.Fatalf("new worker's hello = %+v", echo.Hello)
	}

	// The same catalog never restarts it.
	time.Sleep(500 * time.Millisecond)
	if w := h.ensure("acct-1"); w.PID() != w2.PID() {
		t.Fatal("a worker with the current catalog was replaced")
	}
}

func TestAvailableExplainsWhyTheEngineCannotRun(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name   string
		cfg    Config
		want   error
		reason string
	}{
		{"ready", Config{Runtime: Runtime{Program: exe}}, nil, ""},
		{"no runtime", Config{RuntimeErr: fmt.Errorf("%w: no /x/.venv/bin/python (run make agent-install)", ErrNoRuntime)},
			ErrNoRuntime, "make agent-install"},
		{"runtime deleted", Config{Runtime: Runtime{Program: filepath.Join(t.TempDir(), "python")}}, ErrNoRuntime, "is missing"},
		{"worktree without schema", Config{Runtime: Runtime{Program: exe}, Worktree: "/src/wt"}, ErrWorktreeShared, "DB_SCHEMA"},
		{"worktree on public", Config{Runtime: Runtime{Program: exe}, Worktree: "/src/wt", DBSchema: "public"}, ErrWorktreeShared, "DB_SCHEMA"},
		{"worktree with schema", Config{Runtime: Runtime{Program: exe}, Worktree: "/src/wt", DBSchema: "wt_feature"}, nil, ""},
		{"main checkout without schema", Config{Runtime: Runtime{Program: exe}}, nil, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tc.cfg.Root = testRoot(t)
			tc.cfg.Logf = newTestLog(t).logf
			s := New(tc.cfg)
			defer func() { _ = s.Shutdown(context.Background()) }()
			err := s.Available()
			if tc.want == nil {
				if err != nil {
					t.Fatalf("Available = %v", err)
				}
				return
			}
			var ue *UnavailableError
			if !errors.Is(err, tc.want) || !errors.As(err, &ue) || !strings.Contains(err.Error(), tc.reason) {
				t.Fatalf("Available = %v, want %v with %q", err, tc.want, tc.reason)
			}
			if strings.HasSuffix(ue.Reason, "..") || !strings.HasSuffix(ue.Reason, ".") {
				t.Errorf("reason %q is not one sentence", ue.Reason)
			}
		})
	}

	s := New(Config{Root: testRoot(t), Runtime: Runtime{Program: exe}, Logf: newTestLog(t).logf})
	if err := s.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := s.Available(); !errors.Is(err, ErrClosed) {
		t.Fatalf("Available after Shutdown = %v", err)
	}
}

func TestGitWorktree(t *testing.T) {
	root := t.TempDir()
	write := func(path, body string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	mainDir := filepath.Join(root, "main")
	if err := os.MkdirAll(filepath.Join(mainDir, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(mainDir, "apps", "api"), 0o755); err != nil {
		t.Fatal(err)
	}
	wt := filepath.Join(root, "wt")
	write(filepath.Join(wt, ".git"), "gitdir: "+filepath.Join(mainDir, ".git", "worktrees", "wt")+"\n")
	if err := os.MkdirAll(filepath.Join(wt, "apps", "api"), 0o755); err != nil {
		t.Fatal(err)
	}
	sub := filepath.Join(mainDir, "vendor", "lib")
	write(filepath.Join(sub, ".git"), "gitdir: ../../.git/modules/lib\n")
	none := filepath.Join(root, "packaged")
	if err := os.MkdirAll(none, 0o755); err != nil {
		t.Fatal(err)
	}

	wtAbs, _ := filepath.Abs(wt)
	for dir, want := range map[string]string{
		filepath.Join(mainDir, "apps", "api"): "",
		filepath.Join(wt, "apps", "api"):      wtAbs,
		wt:                                    wtAbs,
		sub:                                   "",
	} {
		if got := GitWorktree(dir); got != want {
			t.Errorf("GitWorktree(%s) = %q, want %q", dir, got, want)
		}
	}
	if got := GitWorktree(none); got != "" && !strings.HasPrefix(none, got) {
		t.Errorf("GitWorktree(%s) = %q", none, got)
	}

	cfg := ConfigFromEnv(func(name string) string {
		return map[string]string{"DB_SCHEMA": " wt_feature "}[name]
	}, filepath.Join(wt, "apps", "api"))
	if cfg.Worktree != wtAbs || cfg.DBSchema != "wt_feature" {
		t.Errorf("ConfigFromEnv worktree %q schema %q", cfg.Worktree, cfg.DBSchema)
	}
}

func TestHostAccountsHonoursOneAccount(t *testing.T) {
	env := func(value string) func(string) string {
		return func(name string) string {
			if name == HostAccountsEnv {
				return value
			}
			return ""
		}
	}
	var logged []string
	logf := func(format string, args ...any) { logged = append(logged, fmt.Sprintf(format, args...)) }

	none := hostAccounts(env(""), logf)
	if none("acct-1") || none("") {
		t.Error("unset variable allowed an account")
	}
	if len(logged) != 0 {
		t.Errorf("logged %v", logged)
	}

	one := hostAccounts(env(" acct-1 ,"), logf)
	if !one("acct-1") || one("acct-2") || one("") {
		t.Error("one listed account")
	}
	if len(logged) != 0 {
		t.Errorf("logged %v", logged)
	}

	two := hostAccounts(env("acct-1,acct-2, acct-1 ,acct-3"), logf)
	if !two("acct-1") || two("acct-2") || two("acct-3") {
		t.Error("a second account was honoured")
	}
	if len(logged) != 1 || !strings.Contains(logged[0], "acct-2, acct-3") || !strings.Contains(logged[0], "(acct-1)") {
		t.Errorf("log = %v", logged)
	}

	if !HostAccounts(env("acct-9"))("acct-9") {
		t.Error("HostAccounts")
	}
	if toolKeyName(HostAccountsEnv) {
		t.Errorf("%s could reach a worker as a tool key", HostAccountsEnv)
	}
}
