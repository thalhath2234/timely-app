package agenthost

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Layout is the agent data folder (plan 6.1):
//
//	<root>/managed/   HERMES_MANAGED_DIR, host-wide floors
//	<root>/runtime/   HERMES_RUNTIME_DIR, shared PM tool store
//	<root>/locks/     HERMES_GATEWAY_LOCK_DIR (XDG_STATE_HOME is locks/state)
//	<root>/accounts/account-<sha256(uid)[:12]>/   HERMES_HOME per account
//	<root>/.trash/    homes of deleted accounts, removed with retry
type Layout struct {
	Root string
}

// DefaultRoot is <TIMELY_DATA_DIR>/agent, or data/agent under the working
// directory (apps/api/data/agent under make dev, so every checkout and
// worktree has its own).
func DefaultRoot(getenv func(string) string) string {
	if dir := strings.TrimSpace(getenv("TIMELY_DATA_DIR")); dir != "" {
		return filepath.Join(dir, "agent")
	}
	return filepath.Join("data", "agent")
}

// AccountDirName is the hashed folder name for an account, the same scheme
// as the per-account backup folders (portability.safeAccountDirectory).
func AccountDirName(account string) string {
	sum := sha256.Sum256([]byte(account))
	return fmt.Sprintf("account-%x", sum[:12])
}

func (l Layout) Managed() string  { return filepath.Join(l.Root, "managed") }
func (l Layout) Runtime() string  { return filepath.Join(l.Root, "runtime") }
func (l Layout) Locks() string    { return filepath.Join(l.Root, "locks") }
func (l Layout) Accounts() string { return filepath.Join(l.Root, "accounts") }
func (l Layout) Trash() string    { return filepath.Join(l.Root, ".trash") }

// State is XDG_STATE_HOME, kept out of ~/.local/state/hermes.
func (l Layout) State() string { return filepath.Join(l.Locks(), "state") }

// PrepareHome is HOME for the host-wide prepare step (boot.py points Hermes
// at runtime/prepare-home itself).
func (l Layout) PrepareHome() string { return filepath.Join(l.Runtime(), "prepare-home", "home") }

// HelperTemp is TMPDIR for the prepare step.
func (l Layout) HelperTemp() string { return filepath.Join(l.Runtime(), "tmp") }

// Home is the account's HERMES_HOME.
func (l Layout) Home(account string) string {
	return filepath.Join(l.Accounts(), AccountDirName(account))
}

// ProfileHome is HOME for the worker and its terminal children
// (terminal.home_mode=profile), so nothing lands in the real home.
func (l Layout) ProfileHome(account string) string { return filepath.Join(l.Home(account), "home") }

// Workspace is TERMINAL_CWD and the worker's working directory.
func (l Layout) Workspace(account string) string { return filepath.Join(l.Home(account), "workspace") }

// Temp is the worker's TMPDIR.
func (l Layout) Temp(account string) string { return filepath.Join(l.Home(account), "tmp") }

// prepare creates the shared folders and the account's home before a spawn.
func (l Layout) prepare(account string) error {
	if strings.TrimSpace(l.Root) == "" {
		return fmt.Errorf("agenthost: no agent data folder")
	}
	dirs := []string{l.Managed(), l.Runtime(), l.State(), l.PrepareHome(), l.HelperTemp()}
	if account != "" {
		dirs = append(dirs, l.ProfileHome(account), l.Workspace(account), l.Temp(account))
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return fmt.Errorf("agenthost: create %s: %w", dir, err)
		}
	}
	return nil
}
