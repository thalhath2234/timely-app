package agentmcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"timely-api/internal/agenthost"
	"timely-api/internal/features/agent"
	"timely-api/internal/secretbox"
)

// secretLabel keeps this feature's sealed values from opening as another's
// (the provider keys' scheme, a label of its own).
const secretLabel = "timely-agent-secret:"

var (
	// ErrNotFound answers a server that is not the account's (or not there).
	ErrNotFound = errors.New("MCP server not found")
	// ErrConflict answers a name the account already uses.
	ErrConflict = errors.New("an MCP server with that name already exists")
	// ErrForbidden answers an action this account may not do.
	ErrForbidden = errors.New("not allowed")
	// ErrUnavailable answers a request that needs the agent when none runs.
	ErrUnavailable = errors.New("the agent is not running")
)

// Requester is what the service needs of a worker: *agenthost.Worker.
type Requester interface {
	Request(ctx context.Context, typ string, fields any) (agenthost.Message, error)
}

// Workers gives the service the account's worker: start true starts one,
// false returns only a running one (nil, nil when none).
type Workers interface {
	Requester(ctx context.Context, account string, start bool) (Requester, error)
}

// SupervisorWorkers adapts *agenthost.Supervisor.
type SupervisorWorkers struct{ Sup *agenthost.Supervisor }

func (w SupervisorWorkers) Requester(ctx context.Context, account string, start bool) (Requester, error) {
	if w.Sup == nil {
		return nil, ErrUnavailable
	}
	if !start {
		if wk, ok := w.Sup.Worker(account); ok {
			return wk, nil
		}
		return nil, nil
	}
	wk, err := w.Sup.Ensure(ctx, account)
	if err != nil {
		return nil, err
	}
	return wk, nil
}

// PendingStdio is a command server waiting for the person's OK on a host
// card (kind mcp_server): the exact command, args and env names.
type PendingStdio struct {
	Name     string
	Command  string
	Args     []string
	EnvNames []string
	Hash     string
}

// Options wires the service.
type Options struct {
	Workers Workers
	// HostAllowed says whether the account may use this computer
	// (instance.Store.IsHostAllowed). A command server needs it.
	HostAllowed func(ctx context.Context, uid string) bool
	// Resolver looks remote hosts up; nil uses the system's.
	Resolver Resolver
	// OnChange is called after a change that reaches the account's worker
	// (a mode, an entry, a token): the engine restarts the worker when it is idle.
	OnChange func(ctx context.Context, uid string)
	// OnStdioPending raises the host card for a command server that was added
	// or changed (go-engine). Without it the entry stays pending.
	OnStdioPending func(ctx context.Context, uid string, p PendingStdio)
	Now            func() time.Time
	Logf           func(format string, args ...any)
}

// Service is the external MCP servers feature.
type Service struct {
	db      *gorm.DB
	box     *secretbox.Box
	o       Options
	now     func() time.Time
	logf    func(format string, args ...any)
	signIns *signIns

	mu      sync.Mutex
	catalog []CatalogItem
	tools   map[string][]ToolInfo // uid + "\x00" + server -> the last probe
}

// NewService needs TIMELY_BACKUP_KEY or JWT_SECRET (secretbox.New).
func NewService(db *gorm.DB, o Options) (*Service, error) {
	box, err := secretbox.New(secretLabel)
	if err != nil {
		return nil, err
	}
	s := &Service{db: db, box: box, o: o, now: o.Now, logf: o.Logf, tools: map[string][]ToolInfo{}}
	if s.now == nil {
		s.now = time.Now
	}
	if s.logf == nil {
		s.logf = log.Printf
	}
	if s.o.HostAllowed == nil {
		s.o.HostAllowed = func(context.Context, string) bool { return false }
	}
	s.signIns = newSignIns(s.now)
	return s, nil
}

// ---------------------------------------------------------------- secrets

func (s *Service) putSecret(ctx context.Context, db *gorm.DB, uid, kind, name, plain string) error {
	sealed, err := s.box.Seal(plain)
	if err != nil {
		return err
	}
	row := Secret{ID: uuid.NewString(), UserID: uid, Kind: kind, Name: name, Ciphertext: []byte(sealed), UpdatedAt: s.now()}
	return db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "kind"}, {Name: "name"}},
		DoUpdates: clause.AssignmentColumns([]string{"ciphertext", "updated_at"}),
	}).Create(&row).Error
}

func (s *Service) delSecrets(ctx context.Context, db *gorm.DB, uid, kind string, names ...string) error {
	if len(names) == 0 {
		return nil
	}
	return db.WithContext(ctx).Where("user_id = ? AND kind = ? AND name IN ?", uid, kind, names).Delete(&Secret{}).Error
}

// secrets opens the account's values of one kind, by name. A value that no
// longer opens (the server's secret changed) is left out and named in bad.
func (s *Service) secrets(ctx context.Context, uid, kind string) (plain map[string]string, bad []string, err error) {
	var rows []Secret
	if err := s.db.WithContext(ctx).Where("user_id = ? AND kind = ?", uid, kind).Find(&rows).Error; err != nil {
		return nil, nil, err
	}
	plain = make(map[string]string, len(rows))
	for _, r := range rows {
		v, err := s.box.Open(string(r.Ciphertext))
		if err != nil {
			bad = append(bad, r.Name)
			continue
		}
		plain[r.Name] = v
	}
	sort.Strings(bad)
	return plain, bad, nil
}

func envName(server, variable string) string { return server + "/" + variable }

// values are the ${VAR} values of one server.
func values(envs map[string]string, server string) map[string]string {
	out := map[string]string{}
	prefix := server + "/"
	for k, v := range envs {
		if rest, ok := strings.CutPrefix(k, prefix); ok {
			out[rest] = v
		}
	}
	return out
}

// ---------------------------------------------------------------- rows

func (s *Service) rows(ctx context.Context, uid string) ([]Server, error) {
	var rows []Server
	err := s.db.WithContext(ctx).Where("user_id = ?", uid).Order("name").Find(&rows).Error
	return rows, err
}

func (s *Service) row(ctx context.Context, uid, name string) (Server, error) {
	var rows []Server
	if err := s.db.WithContext(ctx).Where("user_id = ? AND name = ?", uid, name).Limit(1).Find(&rows).Error; err != nil {
		return Server{}, err
	}
	if len(rows) == 0 {
		return Server{}, ErrNotFound
	}
	return rows[0], nil
}

func (s *Service) changed(ctx context.Context, uid string) {
	if s.o.OnChange != nil {
		s.o.OnChange(ctx, uid)
	}
}

// prepared is one server as it would reach the worker.
type prepared struct {
	entry    map[string]any // the entry with its ${VAR} values filled in
	hash     string         // entryHash for a command server
	problem  string         // why it is not rendered, "" when it is
	pending  bool           // a command server without the person's OK
	renders  bool
	needsKey bool // some ${VAR} has no value
}

// prepare builds what the worker would get for one row: the secrets filled
// in, a remote address checked now (DNS included), a command server only for
// an account that may use this computer and only when approved.
func (s *Service) prepare(ctx context.Context, row Server, host bool, envs map[string]string) prepared {
	entry, err := entryMap(row.Entry)
	if err != nil {
		return prepared{problem: "The saved entry is not readable. Remove the server and add it again."}
	}
	filled, missing := fill(entry, values(envs, row.Name))
	entry = filled.(map[string]any)
	if len(missing) > 0 {
		return prepared{entry: entry, needsKey: true, problem: "Missing " + strings.Join(missing, ", ") + ". Remove the server and add it again."}
	}
	switch {
	case isCommand(entry):
		p := prepared{entry: entry, hash: entryHash(entry)}
		if !host {
			p.problem = "Only an account that can use this computer can run a command server."
			return p
		}
		if row.ApprovedHash != p.hash {
			p.pending, p.problem = true, "Waiting for your OK on the host card."
			return p
		}
		p.renders = true
		return p
	case isRemote(entry):
		problem, err := checkRemote(ctx, s.o.Resolver, entry)
		if err != nil {
			return prepared{entry: entry, problem: Message(err)}
		}
		if problem != "" {
			return prepared{entry: entry, problem: problem}
		}
		return prepared{entry: entry, renders: true}
	}
	return prepared{entry: entry, problem: "The saved entry has no address or command."}
}

// ---------------------------------------------------------------- account settings

// AccountMCP is the MCP part of the account's worker settings
// (render-account's mcp_servers, mcp_modes, approved_mcp_hashes, mcp_tokens),
// built fresh for each spawn: every remote address is checked again with DNS,
// so a name that now resolves to a private address is dropped, with a warning
// for the Settings screen. Off servers appear only in modes. A command server
// is rendered only for an account that may use this computer and only with
// the hash the person approved.
func (s *Service) AccountMCP(ctx context.Context, uid string) (servers map[string]json.RawMessage, modes map[string]string,
	approved []string, tokens map[string]json.RawMessage, warnings []string, err error) {
	servers, modes, tokens = map[string]json.RawMessage{}, map[string]string{}, map[string]json.RawMessage{}
	rows, err := s.rows(ctx, uid)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	if len(rows) == 0 {
		return servers, modes, nil, tokens, nil, nil
	}
	envs, _, err := s.secrets(ctx, uid, secretEnv)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	saved, bad, err := s.secrets(ctx, uid, secretToken)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}
	host := s.o.HostAllowed(ctx, uid)
	for _, row := range rows {
		if row.Mode == ModeOff {
			modes[row.Name] = ModeOff
			continue
		}
		p := s.prepare(ctx, row, host, envs)
		if !p.renders {
			warnings = append(warnings, row.Name+": "+p.problem)
			continue
		}
		raw, err := json.Marshal(p.entry)
		if err != nil {
			warnings = append(warnings, row.Name+": the entry could not be read")
			continue
		}
		servers[row.Name] = raw
		modes[row.Name] = row.Mode
		if p.hash != "" {
			approved = append(approved, p.hash)
		}
		if tok, ok := saved[row.Name]; ok && signsIn(p.entry) {
			tokens[row.Name] = json.RawMessage(tok)
		} else if slices.Contains(bad, row.Name) {
			warnings = append(warnings, row.Name+": the saved sign-in can't be read. Sign in again.")
		}
	}
	slices.Sort(approved)
	return servers, modes, approved, tokens, warnings, nil
}

// SaveTokens stores the tokens a worker reports (mcp.tokens): Hermes' file
// stems to token JSON. A server of this account gets its token replaced; an
// empty value means Hermes deleted the files (signed out) and removes it.
// A stem that is none of the account's servers is ignored.
func (s *Service) SaveTokens(ctx context.Context, uid string, tokens map[string]json.RawMessage) error {
	if len(tokens) == 0 {
		return nil
	}
	rows, err := s.rows(ctx, uid)
	if err != nil {
		return err
	}
	for _, row := range rows {
		raw, ok := tokens[stem(row.Name)]
		if !ok {
			continue
		}
		if err := s.storeToken(ctx, uid, row.Name, raw); err != nil {
			s.logf("agentmcp: %s: %v", row.Name, err)
		}
	}
	return nil
}

// stem is Hermes' token file name for a server (anything but letters, digits,
// _ and - becomes _). Names are limited to those characters, so it is the name.
func stem(name string) string {
	return strings.Trim(strings.Map(func(r rune) rune {
		if r == '_' || r == '-' || r >= '0' && r <= '9' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' {
			return r
		}
		return '_'
	}, name), "_")
}

func emptyToken(raw json.RawMessage) bool {
	t := strings.TrimSpace(string(raw))
	return t == "" || t == "{}" || t == "null"
}

func (s *Service) storeToken(ctx context.Context, uid, name string, raw json.RawMessage) error {
	if emptyToken(raw) {
		return s.delSecrets(ctx, s.db, uid, secretToken, name)
	}
	if len(raw) > maxTokenBytes || !json.Valid(raw) {
		return errors.New("a token that is not valid JSON, or too large, was dropped")
	}
	return s.putSecret(ctx, s.db, uid, secretToken, name, string(raw))
}

// ---------------------------------------------------------------- the gate's questions (chat.MCPRules)

// Mode is the server's mode for the gate: use, ask or off. A server the
// account does not have, and a command server nobody approved, are off.
func (s *Service) Mode(ctx context.Context, uid, server string) string {
	row, err := s.row(ctx, uid, server)
	if err != nil {
		return ModeOff
	}
	if entry, err := entryMap(row.Entry); err == nil && isCommand(entry) {
		envs, _, _ := s.secrets(ctx, uid, secretEnv)
		if p := s.prepare(ctx, row, s.o.HostAllowed(ctx, uid), envs); !p.renders {
			return ModeOff
		}
	}
	return row.Mode
}

// Classify says what a tool of the server does (send, spend, settings, write,
// read) as the host action the permission modes judge. It uses the hints the
// last probe saw; the gate has the call's own hints and should prefer
// ClassifyWith.
func (s *Service) Classify(ctx context.Context, uid, server, tool string) agent.HostAction {
	var ann Annotations
	s.mu.Lock()
	for _, t := range s.tools[uid+"\x00"+server] {
		if t.Name == tool {
			ann = t.Annotations
		}
	}
	s.mu.Unlock()
	return s.ClassifyWith(ctx, uid, server, tool, ann)
}

// ClassifyWith is Classify with the hints the worker's gate.ask carried.
func (s *Service) ClassifyWith(_ context.Context, _ string, server, tool string, ann Annotations) agent.HostAction {
	return action(Class(tool, ann), server)
}

// ApproveStdio records the person's OK of a command server: hash is the
// entryHash the host card showed. It fails when the entry changed after the
// card was raised (the person has not seen what would run).
func (s *Service) ApproveStdio(ctx context.Context, uid, name, hash string) error {
	row, err := s.row(ctx, uid, name)
	if err != nil {
		return err
	}
	if !s.o.HostAllowed(ctx, uid) {
		return fmt.Errorf("%w: this account can't use this computer", ErrForbidden)
	}
	envs, _, err := s.secrets(ctx, uid, secretEnv)
	if err != nil {
		return err
	}
	entry, _ := entryMap(row.Entry)
	if !isCommand(entry) {
		return invalid("%s is not a command server", name)
	}
	p := s.prepare(ctx, row, true, envs)
	if p.needsKey || p.hash == "" || p.hash != hash {
		return fmt.Errorf("%w: the server changed after the card was shown", ErrConflict)
	}
	if err := s.db.WithContext(ctx).Model(&Server{}).Where("id = ?", row.ID).
		Updates(map[string]any{"approved_hash": hash, "updated_at": s.now()}).Error; err != nil {
		return err
	}
	s.changed(ctx, uid)
	return nil
}

// ToolInfo is one tool the last probe saw.
type ToolInfo struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Annotations Annotations `json:"annotations"`
	// Class is what the gate will treat it as: send, pay, config, write or read.
	Class string `json:"class"`
}

func toolsKey(uid, server string) string { return uid + "\x00" + server }

func (s *Service) forgetTools(uid, server string) {
	s.mu.Lock()
	delete(s.tools, toolsKey(uid, server))
	s.mu.Unlock()
}

func sortedNames[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func hostName(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return u.Hostname()
}
