package agenthost

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// An account's agent state in a per-account backup (plan 6.5, 9b.7; Q-3.4;
// PROTOCOL.md section 10.8). The runtime's helpers do the work on files:
//
//	agent-export    --agent-dir <root> --account ID --out <zip>  the zip that goes in the backup
//	agent-import    --agent-dir <root> --account ID --zip <zip>  stages it beside the live home
//	agent-reconcile --agent-dir <root>                            finishes or drops staged folders (prepare runs it too)
//
// A restore runs in three steps around the Postgres transaction: StageRestore
// before it (nothing live changes), CommitRestore after it commits (the
// worker is suspended while the staged folder replaces the home), or
// DiscardRestore when it does not. A crash between the steps is settled by
// the next prepare: a staged folder holding COMMITTED is swapped in, any
// other is deleted.

const (
	// AgentStateFormat and AgentStateVersion name the zip agent-export writes.
	AgentStateFormat  = "timely-agent-state"
	AgentStateVersion = 1
	// MaxStateBytes caps the agent state a backup carries (Q-3.4); above it
	// the backup leaves the agent state out and says so.
	MaxStateBytes = 64 << 20

	stateTimeout = 3 * time.Minute
	// committedMarker and restoreMeta are agent-import's names (backup.py).
	committedMarker = "COMMITTED"
	restoreMeta     = "RESTORE.json"
)

var (
	// ErrNoAgentState means the account never used the agent: it has no
	// home, so there is nothing to export.
	ErrNoAgentState = errors.New("the account has no agent state")
	// ErrStateTooLarge means the exported zip is above MaxStateBytes.
	ErrStateTooLarge = errors.New("the agent state is too large for a backup")
)

// Staged is an agent state agent-import extracted beside the account's live
// home, waiting for the Postgres restore to commit.
type Staged struct {
	Account string
	// Dir is accounts/.restore-<account dir>-<stamp>.
	Dir string
	// RestoredSkills are the skill names that came back; they stay off,
	// marked "restored, review", until the person turns them on (Q-3.4).
	RestoredSkills []string
	// Dropped are paths the import left out (never-restore paths, threat
	// scan hits in memory and staged writes); Blocked the skills the threat
	// scan refused.
	Dropped []string
	Blocked []string
}

// ExportState zips the account's agent state with agent-export and returns
// the zip and its sha256. An account with no home answers ErrNoAgentState;
// a zip above MaxStateBytes answers ErrStateTooLarge (wrapped with its size)
// without reading it. The worker may keep running: the helper snapshots
// state.db the WAL-safe way.
func (s *Supervisor) ExportState(ctx context.Context, account string) ([]byte, string, error) {
	if account == "" {
		return nil, "", errors.New("agenthost: no account")
	}
	if info, err := os.Stat(s.layout.Home(account)); err != nil || !info.IsDir() {
		return nil, "", ErrNoAgentState
	}
	env, err := s.stateEnv(ctx)
	if err != nil {
		return nil, "", err
	}
	out, err := s.stateTemp("export", ".zip")
	if err != nil {
		return nil, "", err
	}
	defer os.Remove(out)
	var res struct {
		Format  string `json:"format"`
		Version int    `json:"version"`
		SHA256  string `json:"sha256"`
		Size    int64  `json:"size"`
	}
	if err := s.runHelper(ctx, stateTimeout, env, nil, &res, "agent-export", "--agent-dir", s.layout.Root, "--account", account, "--out", out); err != nil {
		return nil, "", err
	}
	if res.Format != AgentStateFormat || res.Version != AgentStateVersion {
		return nil, "", fmt.Errorf("%w: agent-export wrote format %q version %d", ErrHelperFailed, res.Format, res.Version)
	}
	info, err := os.Stat(out)
	if err != nil {
		return nil, "", fmt.Errorf("%w: agent-export wrote no zip: %v", ErrHelperFailed, err)
	}
	if info.Size() > MaxStateBytes {
		return nil, "", fmt.Errorf("%w (%d MB, the limit is %d MB)", ErrStateTooLarge, (info.Size()+(1<<20)-1)>>20, MaxStateBytes>>20)
	}
	zip, err := os.ReadFile(out)
	if err != nil {
		return nil, "", err
	}
	sum := sha256.Sum256(zip)
	sha := hex.EncodeToString(sum[:])
	if !strings.EqualFold(sha, res.SHA256) {
		return nil, "", fmt.Errorf("%w: agent-export reported sha256 %s, the zip hashes to %s", ErrHelperFailed, trimForLog(res.SHA256, 12), sha[:12])
	}
	return zip, sha, nil
}

// StageRestore extracts zip beside the account's live home with
// agent-import (threat scan, never-restore paths dropped, ledger paths
// rewritten). Nothing live changes: CommitRestore swaps it in, and
// DiscardRestore (or the next prepare) deletes it.
func (s *Supervisor) StageRestore(ctx context.Context, account string, zip []byte) (Staged, error) {
	if account == "" {
		return Staged{}, errors.New("agenthost: no account")
	}
	if len(zip) == 0 {
		return Staged{}, errors.New("agenthost: empty agent state")
	}
	env, err := s.stateEnv(ctx)
	if err != nil {
		return Staged{}, err
	}
	in, err := s.stateTemp("import", ".zip")
	if err != nil {
		return Staged{}, err
	}
	defer os.Remove(in)
	if err := os.WriteFile(in, zip, 0o600); err != nil {
		return Staged{}, err
	}
	var res struct {
		StagedDir      string   `json:"staged_dir"`
		RestoredSkills []string `json:"restored_skills"`
		Dropped        []string `json:"dropped"`
		Blocked        []string `json:"blocked"`
	}
	if err := s.runHelper(ctx, stateTimeout, env, nil, &res, "agent-import", "--agent-dir", s.layout.Root, "--account", account, "--zip", in); err != nil {
		return Staged{}, err
	}
	staged := Staged{Account: account, Dir: res.StagedDir, RestoredSkills: res.RestoredSkills, Dropped: res.Dropped, Blocked: res.Blocked}
	if err := s.checkStaged(staged); err != nil {
		// Not ours to delete: a folder outside the account's staging names.
		return Staged{}, err
	}
	return staged, nil
}

// CommitRestore swaps a staged agent state in after the Postgres restore
// committed: the account's worker is suspended (live runs get the shutdown
// grace), COMMITTED is written, the old home goes to .trash and the staged
// folder takes its place, then the worker may start again with the
// account's settings rendered afresh.
//
// On an error the account keeps its old home and the staged folder is
// deleted, except when the old home could not be put back: then the staged
// folder keeps its COMMITTED marker and the next prepare's reconcile swaps
// it in. A crash after the marker is written is finished the same way.
//
// The swap is done here for this one folder rather than by running
// agent-reconcile, which settles every staged folder of the agent folder and
// would delete another account's restore still waiting for its transaction.
func (s *Supervisor) CommitRestore(ctx context.Context, staged Staged) (err error) {
	if err := s.checkStaged(staged); err != nil {
		return err
	}
	if info, err := os.Stat(staged.Dir); err != nil || !info.IsDir() {
		return fmt.Errorf("agenthost: the staged agent state is gone (%s)", filepath.Base(staged.Dir))
	}
	keep := false
	defer func() {
		if err != nil && !keep {
			_ = os.RemoveAll(staged.Dir)
		}
	}()
	resume, err := s.Suspend(ctx, staged.Account)
	if err != nil {
		return err
	}
	defer resume()
	if err := os.WriteFile(filepath.Join(staged.Dir, committedMarker), []byte(time.Now().UTC().Format(time.RFC3339)+"\n"), 0o600); err != nil {
		return err
	}
	home := s.layout.Home(staged.Account)
	var trashed string
	if _, err := os.Stat(home); err == nil {
		if err := os.MkdirAll(s.layout.Trash(), 0o700); err != nil {
			return err
		}
		trashed = filepath.Join(s.layout.Trash(), fmt.Sprintf("%s-%d-replaced", AccountDirName(staged.Account), time.Now().UnixNano()))
		if err := retry(ctx, func() error { return os.Rename(home, trashed) }); err != nil {
			return fmt.Errorf("agenthost: move %s to trash: %w", filepath.Base(home), err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := retry(ctx, func() error { return os.Rename(staged.Dir, home) }); err != nil {
		if trashed != "" && os.Rename(trashed, home) != nil {
			keep = true
		}
		return fmt.Errorf("agenthost: swap in the restored agent state: %w", err)
	}
	for _, name := range []string{committedMarker, restoreMeta} {
		_ = os.Remove(filepath.Join(home, name))
	}
	if trashed != "" {
		// The old home held sign-ins and secrets a backup never carries; it
		// goes like a deleted account's.
		if err := retry(ctx, func() error { return os.RemoveAll(trashed) }); err != nil {
			s.logf("agent %s: delete the replaced home: %v", AccountDirName(staged.Account), err)
		}
	}
	return nil
}

// DiscardRestore deletes a staged agent state whose Postgres restore did not
// commit. Deleting one that is already gone is not an error.
func (s *Supervisor) DiscardRestore(staged Staged) error {
	if err := s.checkStaged(staged); err != nil {
		return err
	}
	return os.RemoveAll(staged.Dir)
}

// checkStaged accepts only accounts/.restore-<the account's dir>-<stamp>, so
// a helper answer can never point a swap or a delete anywhere else.
func (s *Supervisor) checkStaged(staged Staged) error {
	if staged.Account == "" || staged.Dir == "" {
		return errors.New("agenthost: no staged agent state")
	}
	dir := filepath.Clean(staged.Dir)
	prefix := ".restore-" + AccountDirName(staged.Account) + "-"
	name := filepath.Base(dir)
	if filepath.Dir(dir) != filepath.Clean(s.layout.Accounts()) || !strings.HasPrefix(name, prefix) || len(name) == len(prefix) {
		return fmt.Errorf("%w: staged agent state %q is not this account's", ErrHelperFailed, staged.Dir)
	}
	return nil
}

// stateEnv is the helpers' environment: the host part, as for prepare (the
// helpers point Hermes at a throwaway home inside the agent folder). They
// need instance.json, which prepare writes.
func (s *Supervisor) stateEnv(ctx context.Context) ([]string, error) {
	if s.cfg.Runtime.Program == "" {
		return nil, &StartError{Err: ErrNoRuntime, Detail: errDetail(s.cfg.RuntimeErr)}
	}
	if err := s.ensurePrepared(ctx); err != nil {
		return nil, err
	}
	return envList(hostEnv(s.layout, s.hostConfig()))
}

// stateTemp names a fresh file in the helpers' temp folder.
func (s *Supervisor) stateTemp(kind, ext string) (string, error) {
	dir := s.layout.HelperTemp()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return filepath.Join(dir, "agent-state-"+kind+"-"+hex.EncodeToString(b[:])+ext), nil
}
