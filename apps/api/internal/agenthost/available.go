package agenthost

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// ErrWorktreeShared means the API runs in a git worktree without a DB_SCHEMA of
// its own, so it shares chats and bots with the main checkout (plan 6.7).
var ErrWorktreeShared = errors.New("worktree API without its own DB_SCHEMA")

// UnavailableError says why the agent engine cannot run on this API now. Its
// Error is a sentence for Settings and the failed-run card; Err is
// ErrNoRuntime, ErrWorktreeShared or ErrClosed.
type UnavailableError struct {
	Reason string
	Err    error
}

func (e *UnavailableError) Error() string { return e.Reason }
func (e *UnavailableError) Unwrap() error { return e.Err }

// Available reports whether this API can run agent workers at all: nil, or
// an *UnavailableError when the runtime is missing, when the API runs in a
// git worktree without its own DB_SCHEMA, or when the supervisor is shutting
// down. It does not start a worker; a start can still fail for one account
// (Ensure's StartError).
func (s *Supervisor) Available() error {
	s.mu.Lock()
	closed := s.closed
	s.mu.Unlock()
	if closed {
		return &UnavailableError{Reason: "Timely is shutting down, so the new engine cannot start a run.", Err: ErrClosed}
	}
	if s.cfg.Runtime.Program == "" || !isFile(s.cfg.Runtime.Program) {
		reason := "The new engine's runtime is not installed on this server"
		if detail := errDetail(s.cfg.RuntimeErr); detail != "" {
			reason += " (" + detail + ")"
		} else if s.cfg.Runtime.Program != "" {
			reason += " (" + s.cfg.Runtime.Program + " is missing)"
		}
		return &UnavailableError{Reason: reason + ".", Err: ErrNoRuntime}
	}
	if s.cfg.Worktree != "" && (s.cfg.DBSchema == "" || s.cfg.DBSchema == "public") {
		return &UnavailableError{
			Reason: "This API runs in a git worktree without its own DB_SCHEMA, so it would share chats with the main checkout. Set DB_SCHEMA for this API to use the new engine.",
			Err:    ErrWorktreeShared,
		}
	}
	return nil
}

// GitWorktree returns the root of the linked git worktree that holds dir, or
// "" when dir is in a main checkout or in no checkout at all (a packaged
// app). A linked worktree's root has a .git file ("gitdir: <repo>/.git/
// worktrees/<name>") where a main checkout has a .git folder.
func GitWorktree(dir string) string {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return ""
	}
	for {
		dotGit := filepath.Join(abs, ".git")
		if info, err := os.Stat(dotGit); err == nil {
			if info.IsDir() {
				return ""
			}
			raw, err := os.ReadFile(dotGit)
			if err != nil {
				return ""
			}
			gitdir, ok := strings.CutPrefix(strings.TrimSpace(string(raw)), "gitdir:")
			if ok && strings.Contains(filepath.ToSlash(strings.TrimSpace(gitdir)), "/worktrees/") {
				return abs
			}
			return "" // a submodule, or something else
		}
		parent := filepath.Dir(abs)
		if parent == abs {
			return ""
		}
		abs = parent
	}
}
