package agenthost

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func touch(t *testing.T, path string, mode os.FileMode) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, nil, mode); err != nil {
		t.Fatal(err)
	}
}

// stagedTree makes a fake staged runtime (plan 11.4) for goos and returns
// its root.
func stagedTree(t *testing.T, goos string) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), "agent")
	touch(t, filepath.Join(root, "boot.py"), 0o644)
	touch(t, filepath.Join(root, "app", "timely_agent", "boot.py"), 0o644)
	touch(t, packagedPython(root, goos), 0o755)
	return root
}

func TestResolveRuntimePackaged(t *testing.T) {
	for _, tc := range []struct {
		goos   string
		python []string // below the agent root
	}{
		{"linux", []string{"python", "bin", "python3"}},
		{"darwin", []string{"python", "bin", "python3"}},
		{"windows", []string{"python", "python.exe"}},
	} {
		t.Run(tc.goos, func(t *testing.T) {
			root := stagedTree(t, tc.goos)
			python := filepath.Join(append([]string{root}, tc.python...)...)
			if got := packagedPython(root, tc.goos); got != python {
				t.Fatalf("interpreter %s, want %s", got, python)
			}
			boot := filepath.Join(root, "boot.py")
			// The folder and its boot.py, from anywhere (no apps/agent above).
			for _, value := range []string{root, boot} {
				got, err := resolveRuntime(value, t.TempDir(), tc.goos)
				if err != nil {
					t.Fatalf("%s: %v", value, err)
				}
				if got.Program != python || strings.Join(got.Args, "|") != "-I|"+boot || !got.Packaged {
					t.Fatalf("%s: %+v", value, got)
				}
				if c := got.command("worker"); len(c) != 3 || c[2] != "worker" {
					t.Fatalf("command %v", c)
				}
			}
		})
	}
}

func TestResolveRuntimePackagedIncomplete(t *testing.T) {
	goos := runtime.GOOS
	t.Run("no interpreter", func(t *testing.T) {
		root := stagedTree(t, goos)
		python := packagedPython(root, goos)
		if err := os.Remove(python); err != nil {
			t.Fatal(err)
		}
		for _, value := range []string{root, filepath.Join(root, "boot.py")} {
			_, err := resolveRuntime(value, t.TempDir(), goos)
			if !errors.Is(err, ErrNoRuntime) || !strings.Contains(err.Error(), python) {
				t.Fatalf("%s: %v", value, err)
			}
		}
	})
	t.Run("no app/timely_agent/boot.py", func(t *testing.T) {
		root := stagedTree(t, goos)
		app := filepath.Join(root, "app", "timely_agent", "boot.py")
		if err := os.Remove(app); err != nil {
			t.Fatal(err)
		}
		_, err := resolveRuntime(root, t.TempDir(), goos)
		if !errors.Is(err, ErrNoRuntime) || !strings.Contains(err.Error(), app) {
			t.Fatalf("%v", err)
		}
	})
	t.Run("only boot.py and app", func(t *testing.T) {
		// No python/ at all: still read as a packaged root, so the error
		// names the interpreter instead of a dev .venv beside it.
		root := filepath.Join(t.TempDir(), "agent")
		touch(t, filepath.Join(root, "boot.py"), 0o644)
		touch(t, filepath.Join(root, "app", "timely_agent", "boot.py"), 0o644)
		_, err := resolveRuntime(root, t.TempDir(), goos)
		if !errors.Is(err, ErrNoRuntime) || !strings.Contains(err.Error(), packagedPython(root, goos)) {
			t.Fatalf("%v", err)
		}
	})
}

// The dev forms resolve as before and are never Packaged.
func TestResolveRuntimeDevNotPackaged(t *testing.T) {
	root := t.TempDir()
	agent := filepath.Join(root, "apps", "agent")
	boot := filepath.Join(agent, "timely_agent", "boot.py")
	python := venvPython(agent)
	api := filepath.Join(root, "apps", "api")
	touch(t, boot, 0o644)
	touch(t, python, 0o755)
	if err := os.MkdirAll(api, 0o755); err != nil {
		t.Fatal(err)
	}
	interp := filepath.Join(root, "python3")
	touch(t, interp, 0o755)
	for value, program := range map[string]string{
		"": python, agent: python, filepath.Dir(boot): python, boot: python, interp: interp,
	} {
		got, err := ResolveRuntime(value, api)
		if err != nil {
			t.Fatalf("%q: %v", value, err)
		}
		if got.Packaged || got.Program != program || strings.Join(got.Args, "|") != "-I|"+boot {
			t.Fatalf("%q: %+v", value, got)
		}
	}
}

func TestPackagedRuntimeSetsEnv(t *testing.T) {
	root := stagedTree(t, runtime.GOOS)
	rt, err := ResolveRuntime(root, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	bytecodeOff := func(s *Supervisor) bool {
		return hostEnv(s.layout, s.cfg.Env)["PYTHONDONTWRITEBYTECODE"] == "1"
	}
	for _, tc := range []struct {
		name string
		cfg  Config
		want bool
	}{
		// TestIntegrationRealWorker's shape: Runtime only, Env defaulted.
		{"packaged, env defaulted", Config{Root: testRoot(t), Runtime: rt}, true},
		{"packaged, env given", Config{Root: testRoot(t), Runtime: rt, Env: EnvConfig{Path: "/bin"}}, true},
		{"dev runtime", Config{Root: testRoot(t), Runtime: PythonRuntime("/py", "/boot.py")}, false},
		{"Env.Packaged kept when env defaults", Config{Root: testRoot(t), Env: EnvConfig{Packaged: true}}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := New(tc.cfg)
			defer func() { _ = s.Shutdown(context.Background()) }()
			if s.cfg.Env.Packaged != tc.want || bytecodeOff(s) != tc.want {
				t.Fatalf("Env.Packaged %v, PYTHONDONTWRITEBYTECODE %v, want %v", s.cfg.Env.Packaged, bytecodeOff(s), tc.want)
			}
		})
	}

	env := map[string]string{"TIMELY_AGENT_RUNTIME": root, "PATH": "/bin"}
	cfg := ConfigFromEnv(func(k string) string { return env[k] }, t.TempDir())
	if cfg.RuntimeErr != nil || !cfg.Runtime.Packaged || !cfg.Env.Packaged || cfg.Env.Path != "/bin" {
		t.Fatalf("ConfigFromEnv: %+v %v", cfg, cfg.RuntimeErr)
	}
}
