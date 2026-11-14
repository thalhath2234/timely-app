package instance

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
)

// instance_settings keys (migration agent_instance_settings).
const (
	keyHostAccounts     = "host_accounts"
	keyAgentMaxWorkers  = "agent_max_workers"
	keyAgentIdleMinutes = "agent_idle_minutes"
)

// Where a host-allowed account was turned on.
const (
	SourceDesktop = "desktop" // the desktop window (instance_settings); removable there
	SourceServer  = "server"  // TIMELY_AGENT_HOST_ACCOUNTS; only the server's owner changes it
)

// Limits the worker cap and the idle minutes may take (Settings -> Server).
const (
	MinWorkers, MaxWorkers         = 1, 16
	MinIdleMinutes, MaxIdleMinutes = 1, 240
	maxWorkingDirLen               = 1024
	hostCacheTTL                   = 5 * time.Second
)

// HostAccount is an account whose approved commands may run on this computer
// (plan 12; owner answer Q-5.2: several, each turned on separately).
type HostAccount struct {
	UID        string    `json:"uid"`
	WorkingDir string    `json:"workingDir"`
	Source     string    `json:"source"`
	AddedAt    time.Time `json:"addedAt"`
}

// AgentLimits is how many agent workers run at once and how long an idle one
// lives; both are the instance's, not an account's.
type AgentLimits struct {
	MaxWorkers  int `json:"maxWorkers"`
	IdleMinutes int `json:"idleMinutes"`
}

// ErrInvalid marks input the person can fix; its text is shown to them.
var ErrInvalid = errors.New("invalid instance setting")

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

// storedHostAccount is the JSON shape stored under host_accounts.
type storedHostAccount struct {
	UID        string    `json:"uid"`
	WorkingDir string    `json:"working_dir"`
	AddedAt    time.Time `json:"added_at"`
}

// Store reads and writes instance_settings and answers "may this account use
// this computer": the accounts turned on in the desktop window united with
// TIMELY_AGENT_HOST_ACCOUNTS. A database error fails closed: only the
// environment's accounts count until the store can be read.
type Store struct {
	db       *sql.DB
	env      []string
	defaults AgentLimits
	onLimits func(AgentLimits)

	mu       sync.Mutex
	cached   []storedHostAccount
	cachedAt time.Time
	now      func() time.Time
}

// NewStore takes the ids TIMELY_AGENT_HOST_ACCOUNTS names (agenthost.HostAccountIDs)
// and the limits that apply while none were stored (the environment's
// TIMELY_AGENT_MAX_WORKERS and TIMELY_AGENT_IDLE_MINUTES, or their defaults).
func NewStore(db *sql.DB, envHostAccounts []string, defaults AgentLimits) *Store {
	return &Store{db: db, env: slices.Clone(envHostAccounts), defaults: defaults, now: time.Now}
}

// OnLimits registers what runs after the limits changed, and once now with
// the effective limits so a restart applies what was stored. main points it
// at the agent supervisor.
func (s *Store) OnLimits(fn func(AgentLimits)) {
	s.mu.Lock()
	s.onLimits = fn
	s.mu.Unlock()
	if fn != nil {
		if limits, err := s.AgentLimits(context.Background()); err == nil {
			fn(limits)
		}
	}
}

func (s *Store) invalidate() {
	s.mu.Lock()
	s.cached, s.cachedAt = nil, time.Time{}
	s.mu.Unlock()
}

func (s *Store) isEnv(uid string) bool { return slices.Contains(s.env, uid) }

// stored returns the accounts turned on in the desktop window, cached for a
// few seconds (every agent gate asks) and dropped on every write here.
func (s *Store) stored(ctx context.Context) ([]storedHostAccount, error) {
	if s == nil || s.db == nil {
		return nil, nil
	}
	s.mu.Lock()
	if !s.cachedAt.IsZero() && s.now().Sub(s.cachedAt) < hostCacheTTL {
		out := slices.Clone(s.cached)
		s.mu.Unlock()
		return out, nil
	}
	s.mu.Unlock()
	list, err := s.readHostAccounts(ctx, s.db)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.cached, s.cachedAt = slices.Clone(list), s.now()
	s.mu.Unlock()
	return list, nil
}

type queryRower interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func (s *Store) readHostAccounts(ctx context.Context, q queryRower) ([]storedHostAccount, error) {
	var raw []byte
	err := q.QueryRowContext(ctx, `SELECT value FROM instance_settings WHERE key = $1`, keyHostAccounts).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var list []storedHostAccount
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, fmt.Errorf("instance_settings %s: %w", keyHostAccounts, err)
	}
	return list, nil
}

// HostAccounts lists every host-allowed account, the desktop window's first
// (in the order turned on), then the server's. An id in both is the server's:
// the desktop window cannot turn it off.
func (s *Store) HostAccounts(ctx context.Context) ([]HostAccount, error) {
	stored, err := s.stored(ctx)
	var out []HostAccount
	seen := map[string]bool{}
	for _, a := range stored {
		if a.UID == "" || seen[a.UID] {
			continue
		}
		seen[a.UID] = true
		source := SourceDesktop
		if s.isEnv(a.UID) {
			source = SourceServer
		}
		out = append(out, HostAccount{UID: a.UID, WorkingDir: a.WorkingDir, Source: source, AddedAt: a.AddedAt})
	}
	for _, id := range s.env {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, HostAccount{UID: id, Source: SourceServer})
	}
	return out, err
}

// IsHostAllowed reports whether the account may use this computer: turned on
// in the desktop window or named in TIMELY_AGENT_HOST_ACCOUNTS. An empty id
// never is, and a store that cannot be read counts only the environment.
func (s *Store) IsHostAllowed(ctx context.Context, uid string) bool {
	if s == nil || uid == "" {
		return false
	}
	if s.isEnv(uid) {
		return true
	}
	stored, err := s.stored(ctx)
	if err != nil {
		log.Printf("instance: reading host accounts failed, none from the store: %v", err)
		return false
	}
	for _, a := range stored {
		if a.UID == uid {
			return true
		}
	}
	return false
}

// WorkingDir is the folder the account chose for its terminal and files, or ""
// (its own workspace folder). An account that is not host-allowed has none.
func (s *Store) WorkingDir(ctx context.Context, uid string) string {
	if s == nil || uid == "" {
		return ""
	}
	stored, err := s.stored(ctx)
	if err != nil {
		return ""
	}
	for _, a := range stored {
		if a.UID == uid {
			return a.WorkingDir
		}
	}
	return ""
}

// ValidateWorkingDir checks a folder the person picked: an absolute path of
// an existing directory on this computer.
func ValidateWorkingDir(dir string) (string, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return "", nil
	}
	if len(dir) > maxWorkingDirLen || strings.ContainsRune(dir, 0) {
		return "", invalid("That folder path isn't valid.")
	}
	if !filepath.IsAbs(dir) {
		return "", invalid("Pick a folder by its full path.")
	}
	clean := filepath.Clean(dir)
	info, err := os.Stat(clean)
	if err != nil || !info.IsDir() {
		return "", invalid("That folder doesn't exist on this computer.")
	}
	// The working folder is where the agent may delete and overwrite without
	// asking in Auto: the disk's root, the home folder and any folder above
	// the home would make everything "inside" it.
	if filepath.Dir(clean) == clean {
		return "", invalid("Pick a project folder, not the whole disk.")
	}
	if home, herr := os.UserHomeDir(); herr == nil && home != "" {
		home = filepath.Clean(home)
		if clean == home || strings.HasPrefix(home+string(filepath.Separator), clean+string(filepath.Separator)) {
			return "", invalid("Pick a project folder, not your whole home folder.")
		}
	}
	return clean, nil
}

// SetHostAccount turns an account on or off for host tools, or changes its
// working folder. on == nil keeps the account's state (the folder of an
// account that is on); workingDir == nil keeps its folder. Turning off an
// account the server names (TIMELY_AGENT_HOST_ACCOUNTS) is refused: that is
// the server owner's decision. The caller has already checked that uid is the
// signed-in account.
func (s *Store) SetHostAccount(ctx context.Context, uid string, on *bool, workingDir *string) error {
	if s == nil || s.db == nil {
		return errors.New("instance settings are not available")
	}
	if uid == "" {
		return invalid("Missing account.")
	}
	dir := ""
	if workingDir != nil {
		var err error
		if dir, err = ValidateWorkingDir(*workingDir); err != nil {
			return err
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	// The row exists before it is locked, so two writers queue on it.
	if _, err := tx.ExecContext(ctx, `INSERT INTO instance_settings (key, value) VALUES ($1, '[]'::jsonb) ON CONFLICT (key) DO NOTHING`, keyHostAccounts); err != nil {
		return err
	}
	var raw []byte
	if err := tx.QueryRowContext(ctx, `SELECT value FROM instance_settings WHERE key = $1 FOR UPDATE`, keyHostAccounts).Scan(&raw); err != nil {
		return err
	}
	var list []storedHostAccount
	if err := json.Unmarshal(raw, &list); err != nil {
		return fmt.Errorf("instance_settings %s: %w", keyHostAccounts, err)
	}
	at := slices.IndexFunc(list, func(a storedHostAccount) bool { return a.UID == uid })
	switch {
	case on != nil && !*on:
		if s.isEnv(uid) {
			return invalid("This account is allowed by the server's settings (%s); turn it off there.", "TIMELY_AGENT_HOST_ACCOUNTS")
		}
		if at >= 0 {
			list = slices.Delete(list, at, at+1)
		}
	case on != nil && *on:
		if at < 0 {
			list = append(list, storedHostAccount{UID: uid, WorkingDir: dir, AddedAt: s.now().UTC()})
		} else if workingDir != nil {
			list[at].WorkingDir = dir
		}
	default: // a folder change only
		if workingDir == nil {
			return invalid("Nothing to change.")
		}
		if at < 0 {
			if !s.isEnv(uid) {
				return invalid("Turn on \"Let the assistant use this computer\" for this account first.")
			}
			// A server-named account keeps its folder in the same list.
			list = append(list, storedHostAccount{UID: uid, WorkingDir: dir, AddedAt: s.now().UTC()})
		} else {
			list[at].WorkingDir = dir
		}
	}
	if list == nil {
		list = []storedHostAccount{}
	}
	out, err := json.Marshal(list)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE instance_settings SET value = $2::jsonb, updated_at = now() WHERE key = $1`, keyHostAccounts, string(out)); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.invalidate()
	return nil
}

// AgentLimits returns the worker cap and idle minutes in force: the stored
// values, else the defaults from the environment.
func (s *Store) AgentLimits(ctx context.Context) (AgentLimits, error) {
	if s == nil {
		return AgentLimits{}, nil
	}
	limits := s.defaults
	if s.db == nil {
		return limits, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT key, value FROM instance_settings WHERE key IN ($1, $2)`, keyAgentMaxWorkers, keyAgentIdleMinutes)
	if err != nil {
		return limits, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var raw []byte
		if err := rows.Scan(&key, &raw); err != nil {
			return limits, err
		}
		var n int
		if err := json.Unmarshal(raw, &n); err != nil || n <= 0 {
			continue
		}
		switch key {
		case keyAgentMaxWorkers:
			limits.MaxWorkers = n
		case keyAgentIdleMinutes:
			limits.IdleMinutes = n
		}
	}
	return limits, rows.Err()
}

// SetAgentLimits stores the limits and tells the supervisor.
func (s *Store) SetAgentLimits(ctx context.Context, limits AgentLimits) error {
	if s == nil || s.db == nil {
		return errors.New("instance settings are not available")
	}
	if limits.MaxWorkers < MinWorkers || limits.MaxWorkers > MaxWorkers {
		return invalid("Workers must be between %d and %d.", MinWorkers, MaxWorkers)
	}
	if limits.IdleMinutes < MinIdleMinutes || limits.IdleMinutes > MaxIdleMinutes {
		return invalid("Idle minutes must be between %d and %d.", MinIdleMinutes, MaxIdleMinutes)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for key, n := range map[string]int{keyAgentMaxWorkers: limits.MaxWorkers, keyAgentIdleMinutes: limits.IdleMinutes} {
		if _, err := tx.ExecContext(ctx, `INSERT INTO instance_settings (key, value) VALUES ($1, to_jsonb($2::int))
			ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, key, n); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.mu.Lock()
	fn := s.onLimits
	s.mu.Unlock()
	if fn != nil {
		fn(limits)
	}
	return nil
}
