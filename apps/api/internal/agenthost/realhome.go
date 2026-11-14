package agenthost

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Phase 5 test safety (work packages decision 20): host tools act on the
// real home, so a test API points the "real" home its workers see at a
// throwaway folder under $HOME/.cache/p5-sandbox (make agent-host-sandbox).

// RealHomeEnv names that folder. It is honoured only with DB_SCHEMA (a test
// API) and only inside SandboxRoot.
const RealHomeEnv = "TIMELY_AGENT_REAL_HOME"

// SandboxRoot is the only place a test real home may be: <home>/.cache/p5-sandbox.
func SandboxRoot(home string) string { return filepath.Join(home, ".cache", "p5-sandbox") }

// TestRealHome reads TIMELY_AGENT_REAL_HOME. ok is false when it is unset
// or DB_SCHEMA is not set; an error refuses a folder outside SandboxRoot
// (or one that does not exist), and the real home is used.
func TestRealHome(getenv func(string) string, home string) (dir string, ok bool, err error) {
	raw := strings.TrimSpace(getenv(RealHomeEnv))
	if raw == "" || strings.TrimSpace(getenv("DB_SCHEMA")) == "" || home == "" {
		return "", false, nil
	}
	root, err := filepath.Abs(SandboxRoot(home))
	if err != nil {
		return "", false, err
	}
	dir, err = filepath.Abs(raw)
	if err != nil {
		return "", false, err
	}
	if resolved, rerr := filepath.EvalSymlinks(dir); rerr == nil {
		dir = resolved
	}
	if resolvedRoot, rerr := filepath.EvalSymlinks(root); rerr == nil {
		root = resolvedRoot
	}
	rel, err := filepath.Rel(root, dir)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", false, fmt.Errorf("%s=%s is outside %s: refused", RealHomeEnv, raw, root)
	}
	if info, serr := os.Stat(dir); serr != nil || !info.IsDir() {
		return "", false, fmt.Errorf("%s=%s is not a folder: refused", RealHomeEnv, raw)
	}
	return dir, true, nil
}
