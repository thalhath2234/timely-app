package agenthost

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// ErrNoRuntime means no agent runtime was found; Ensure fails with it and the
// classic engine keeps working.
var ErrNoRuntime = errors.New("agent runtime not found")

// Runtime is the agent runtime command without its subcommand: the
// supervisor appends "worker", "prepare --agent-dir ..." or
// "render-account --agent-dir ... --account ...", and supplies the
// environment and working directory.
type Runtime struct {
	Program string
	Args    []string
	// Packaged marks the staged runtime of a desktop install or the Docker
	// image (plan 11.4): read-only, so workers get PYTHONDONTWRITEBYTECODE=1
	// (New copies it into Config.Env.Packaged).
	Packaged bool
}

func (r Runtime) command(sub ...string) []string {
	return append(append([]string(nil), r.Args...), sub...)
}

// PythonRuntime is `<python> -I <boot.py>` (plan 11.1). -I ignores
// PYTHONPATH and the user site; boot.py sets sys.path itself.
func PythonRuntime(python, boot string) Runtime {
	return Runtime{Program: python, Args: []string{"-I", boot}}
}

func venvPython(agentDir string) string {
	if runtime.GOOS == "windows" {
		return filepath.Join(agentDir, ".venv", "Scripts", "python.exe")
	}
	return filepath.Join(agentDir, ".venv", "bin", "python")
}

// packagedPython is the interpreter of a staged runtime: the
// python-build-standalone tree keeps python.exe at its root on Windows and
// bin/python3 elsewhere.
func packagedPython(agentRoot, goos string) string {
	if goos == "windows" {
		return filepath.Join(agentRoot, "python", "python.exe")
	}
	return filepath.Join(agentRoot, "python", "bin", "python3")
}

// isPackagedRoot reports whether dir looks like a staged runtime (plan 11.4:
// boot.py next to python/ or app/). Whether the rest is there is checked by
// packagedRuntime, so a broken stage fails with the missing path instead of
// being read as a dev timely_agent folder.
func isPackagedRoot(dir string) bool {
	if !isFile(filepath.Join(dir, "boot.py")) {
		return false
	}
	for _, sub := range []string{"python", "app"} {
		if info, err := os.Stat(filepath.Join(dir, sub)); err == nil && info.IsDir() {
			return true
		}
	}
	return false
}

// packagedRuntime is `<agent>/python/... -I <agent>/boot.py` for the staged
// layout agent/{boot.py, python/, app/timely_agent/, ...} (plan 11.4).
func packagedRuntime(agentRoot, goos string) (Runtime, error) {
	python := packagedPython(agentRoot, goos)
	if !isFile(python) {
		return Runtime{}, fmt.Errorf("%w: no %s (the packaged runtime is incomplete)", ErrNoRuntime, python)
	}
	app := filepath.Join(agentRoot, "app", "timely_agent", "boot.py")
	if !isFile(app) {
		return Runtime{}, fmt.Errorf("%w: no %s (the packaged runtime is incomplete)", ErrNoRuntime, app)
	}
	rt := PythonRuntime(python, filepath.Join(agentRoot, "boot.py"))
	rt.Packaged = true
	return rt, nil
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// findAgentDir walks up from start looking for apps/agent/timely_agent/boot.py
// and returns the apps/agent folder.
func findAgentDir(start string) (string, bool) {
	dir, err := filepath.Abs(start)
	if err != nil {
		return "", false
	}
	for {
		candidate := filepath.Join(dir, "apps", "agent")
		if isFile(filepath.Join(candidate, "timely_agent", "boot.py")) {
			return candidate, true
		}
		if filepath.Base(dir) == "agent" && isFile(filepath.Join(dir, "timely_agent", "boot.py")) {
			return dir, true
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}

// ResolveRuntime finds the worker command from TIMELY_AGENT_RUNTIME (plan
// 11.2), which may name:
//   - a packaged runtime (plan 11.4: <resources>/agent on the desktop,
//     /app/agent in Docker), the folder holding boot.py, python/ and
//     app/timely_agent/, or its boot.py: `<agent>/python/bin/python3
//     -I <agent>/boot.py` (python\python.exe on Windows), Packaged;
//   - the timely_agent folder (the one holding boot.py) or boot.py itself:
//     the interpreter is <apps/agent>/.venv's python;
//   - the apps/agent folder;
//   - an interpreter: boot.py is found by searching up from searchFrom.
//
// Empty value: the dev default, apps/agent found by searching up from
// searchFrom (the API's working directory, apps/api under make dev).
func ResolveRuntime(value, searchFrom string) (Runtime, error) {
	return resolveRuntime(value, searchFrom, runtime.GOOS)
}

func resolveRuntime(value, searchFrom, goos string) (Runtime, error) {
	fromAgentDir := func(agentDir string) (Runtime, error) {
		boot := filepath.Join(agentDir, "timely_agent", "boot.py")
		python := venvPython(agentDir)
		if !isFile(boot) {
			return Runtime{}, fmt.Errorf("%w: no %s", ErrNoRuntime, boot)
		}
		if !isFile(python) {
			return Runtime{}, fmt.Errorf("%w: no %s (run make agent-install)", ErrNoRuntime, python)
		}
		return PythonRuntime(python, boot), nil
	}
	if value == "" {
		agentDir, ok := findAgentDir(searchFrom)
		if !ok {
			return Runtime{}, fmt.Errorf("%w: apps/agent not found above %s", ErrNoRuntime, searchFrom)
		}
		return fromAgentDir(agentDir)
	}
	abs, err := filepath.Abs(value)
	if err != nil {
		return Runtime{}, fmt.Errorf("%w: %v", ErrNoRuntime, err)
	}
	info, err := os.Stat(abs)
	if err != nil {
		return Runtime{}, fmt.Errorf("%w: %v", ErrNoRuntime, err)
	}
	switch {
	case info.IsDir() && isPackagedRoot(abs):
		return packagedRuntime(abs, goos)
	case !info.IsDir() && filepath.Base(abs) == "boot.py" && isPackagedRoot(filepath.Dir(abs)):
		return packagedRuntime(filepath.Dir(abs), goos)
	case info.IsDir() && isFile(filepath.Join(abs, "boot.py")):
		return fromAgentDir(filepath.Dir(abs))
	case info.IsDir() && isFile(filepath.Join(abs, "timely_agent", "boot.py")):
		return fromAgentDir(abs)
	case info.IsDir():
		return Runtime{}, fmt.Errorf("%w: %s holds no boot.py", ErrNoRuntime, abs)
	case filepath.Base(abs) == "boot.py":
		return fromAgentDir(filepath.Dir(filepath.Dir(abs)))
	}
	agentDir, ok := findAgentDir(searchFrom)
	if !ok {
		return Runtime{}, fmt.Errorf("%w: boot.py not found above %s", ErrNoRuntime, searchFrom)
	}
	return PythonRuntime(abs, filepath.Join(agentDir, "timely_agent", "boot.py")), nil
}
