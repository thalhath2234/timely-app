// Package learning is the Go side of the agent's self-learning (plan 9b.2
// item 5, 9b.4; ADR 0028): it records what each account's agent worker
// learned (agent_learning_events, also memory's undo history, since Hermes
// keeps none), holds the account's learning settings
// (agent_learning_settings), and serves /agent/learning/*, which proxies to
// the account's own worker for skills, memory, staged items, upstream
// updates and the export.
//
// Accounts never mix: a recorded event's account is the worker's (never a
// field of the message), every route answers only the signed-in account's
// rows and talks only to that account's worker, and another account's ids
// answer not-found.
package learning

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"timely-api/internal/agenthost"
	"timely-api/internal/realtime"
)

// Workers starts and finds account workers; *agenthost.Supervisor is one.
type Workers interface {
	Ensure(ctx context.Context, account string) (*agenthost.Worker, error)
	Worker(account string) (*agenthost.Worker, bool)
}

// requester is what the service needs of a worker: *agenthost.Worker.
type requester interface {
	Request(ctx context.Context, typ string, fields any) (agenthost.Message, error)
}

// requestTimeout bounds one request to a worker, its start included.
const requestTimeout = 30 * time.Second

// useCasePrefix starts the About you entry copied from "What you use Timely
// for" (Q-3.3).
const useCasePrefix = "Uses Timely for: "

// Service is the learning feature.
type Service struct {
	db      *gorm.DB
	workers Workers
	timeout time.Duration
	logf    func(format string, args ...any)

	mu      sync.Mutex
	publish func(uid string, ev realtime.Event)
	// superseded are the ledger entries (account NUL id) recent Undos took
	// back, so their events that arrive later are recorded undone.
	superseded map[string]time.Time
	settings   func(ctx context.Context, uid string) (json.RawMessage, error)
}

// NewService returns the learning service. sup may be nil (no agent engine
// on this API): routes that need a worker then answer 503.
func NewService(db *gorm.DB, sup Workers) *Service {
	return &Service{db: db, workers: sup, timeout: requestTimeout, logf: log.Printf}
}

// SetPublish sets where learning events go live: the chat watch stream
// (contract 4: event "learning", {type, kind: "chat", id: conversation id or
// "", document: {eventId, status}}). Nil publishes nothing.
func (s *Service) SetPublish(fn func(uid string, ev realtime.Event)) {
	s.mu.Lock()
	s.publish = fn
	s.mu.Unlock()
}

// SetAccountSettings sets how a settings.update gets the account's settings
// in render-account shape (the supervisor's AccountSpec.Settings, which
// carries Prefs.SkillsDisabled). Without it, turning a skill on or off
// restarts the account's worker once it is idle instead, so the next start
// renders the change.
func (s *Service) SetAccountSettings(fn func(ctx context.Context, uid string) (json.RawMessage, error)) {
	s.mu.Lock()
	s.settings = fn
	s.mu.Unlock()
}

func (s *Service) publishEvent(uid string, ev Event) {
	s.mu.Lock()
	fn := s.publish
	s.mu.Unlock()
	if fn == nil {
		return
	}
	fn(uid, realtime.Event{Type: "learning", Kind: "chat", ID: ev.ConversationID,
		Document: map[string]string{"eventId": ev.ID, "status": ev.Status}})
}

// HandleWorker records a worker's "learning" message and reports true; any
// other message is left to the next handler (false). The event belongs to
// the worker's account; a message naming another account is never recorded
// (the supervisor already kills such a worker).
func (s *Service) HandleWorker(w *agenthost.Worker, m agenthost.Message) bool {
	if m.Type != agenthost.TypeLearning {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := s.record(ctx, w.Account(), m); err != nil {
		s.logf("learning: %s: %v", agenthost.AccountDirName(w.Account()), err)
	}
	return true
}

var errRefused = errors.New("learning event refused")

// record stores one learning message for account. The returned event is
// nil when the message was a repeat.
func (s *Service) record(ctx context.Context, account string, m agenthost.Message) (*Event, error) {
	if account == "" || m.Account != account {
		return nil, fmt.Errorf("%w: a learning message for another account", errRefused)
	}
	var body struct {
		Event *wireEvent `json:"event"`
	}
	if err := m.Decode(&body); err != nil || body.Event == nil {
		return nil, fmt.Errorf("%w: no event", errRefused)
	}
	ev, err := eventFromWire(*body.Event)
	if err != nil {
		return nil, err
	}
	ev.ID = "lev_" + uuid.NewString()
	ev.UserID = account
	if ev.Status == StatusApplied {
		now := time.Now()
		ev.AppliedAt = &now
	}
	res := s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "worker_event_id"}},
		DoNothing: true,
	}).Create(&ev)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, nil // seen before
	}
	// An Undo already took this change back (its rollback named the ledger
	// entry, and the event was still on its way): it arrives undone, with
	// no Undo that would bring the skill back.
	if ev.Kind == KindSkill && ev.Status == StatusApplied && s.wasSuperseded(account, ev.LedgerEntryID) {
		if ok, err := s.claim(ctx, account, ev.ID, []string{StatusApplied}, StatusUndone); err == nil && ok {
			ev.Status = StatusUndone
		}
	}
	s.publishEvent(account, ev)
	return &ev, nil
}

// supersededTTL is how long an Undo's superseded ledger entries are kept
// for events still on their way from the worker (the dispatch queue hands
// them over in seconds; a learning pass reports before its reply).
const supersededTTL = time.Hour

// markSuperseded notes ledger entries an Undo of uid's took back, before
// their events are marked undone: record checks after its insert, so an
// event either is in the table when undo marks it or sees the note.
func (s *Service) markSuperseded(uid string, ids []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if s.superseded == nil {
		s.superseded = map[string]time.Time{}
	}
	for key, at := range s.superseded {
		if now.Sub(at) > supersededTTL {
			delete(s.superseded, key)
		}
	}
	for _, id := range ids {
		if id != "" {
			s.superseded[uid+"\x00"+id] = now
		}
	}
}

func (s *Service) wasSuperseded(uid, ledgerID string) bool {
	if ledgerID == "" {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	at, ok := s.superseded[uid+"\x00"+ledgerID]
	return ok && time.Since(at) <= supersededTTL
}

// eventFromWire checks a worker event and caps its texts.
func eventFromWire(in wireEvent) (Event, error) {
	refuse := func(why string) (Event, error) { return Event{}, fmt.Errorf("%w: %s", errRefused, why) }
	switch {
	case in.ID == "" || len(in.ID) > 128:
		return refuse("missing or long id")
	case in.Kind != KindSkill && in.Kind != KindMemory && in.Kind != KindUser:
		return refuse(fmt.Sprintf("unknown kind %q", cut(in.Kind, 40)))
	case in.Status != StatusApplied && in.Status != StatusStaged && in.Status != StatusBlocked:
		return refuse(fmt.Sprintf("status %q is not one a worker reports", cut(in.Status, 40)))
	case in.Status == StatusStaged && in.PendingID == "":
		return refuse("a staged event without pending_id")
	}
	tainted := json.RawMessage("[]")
	if t := strings.TrimSpace(string(in.TaintedSources)); t != "" && t != "null" {
		var list []json.RawMessage
		if json.Unmarshal(in.TaintedSources, &list) != nil {
			return refuse("tainted_sources is not a list")
		}
		tainted = append(json.RawMessage(nil), in.TaintedSources...)
	}
	return Event{
		WorkerEventID:  in.ID,
		Kind:           in.Kind,
		Action:         cut(in.Action, 32),
		Subject:        cut(in.Subject, 300),
		Before:         cut(in.Before, maxText),
		After:          cut(in.After, maxText),
		Origin:         cut(in.Origin, 32),
		ConversationID: cut(in.ConversationID, 128),
		RunID:          cut(in.RunID, 128),
		BotID:          cut(in.BotID, 128),
		TaintedSources: tainted,
		Status:         in.Status,
		LedgerEntryID:  cut(in.LedgerEntryID, 128),
		PendingID:      cut(in.PendingID, 128),
		Summary:        cut(in.Summary, 2000),
		Reason:         stagingReason(in.Reason),
	}, nil
}

// stagingReason keeps a reason the worker names (PROTOCOL.md section 10),
// else "".
func stagingReason(reason string) string {
	switch reason {
	case "tainted", "bot", "unattended", "skill_body":
		return reason
	}
	return ""
}

// cut keeps at most n characters, never splitting one, and only valid UTF-8
// (Postgres text refuses invalid sequences).
func cut(s string, n int) string {
	s = strings.ToValidUTF8(s, "�")
	s = strings.ReplaceAll(s, "\x00", "")
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

// loadSettings reads the account's settings row; a missing row is the
// defaults.
func loadSettings(ctx context.Context, db *gorm.DB, uid string) (Settings, error) {
	row := Settings{UserID: uid, Learning: true, SearchHistory: true}
	var found []Settings
	if err := db.WithContext(ctx).Where("user_id = ?", uid).Limit(1).Find(&found).Error; err != nil {
		return row, err
	}
	if len(found) == 1 {
		row = found[0]
	}
	if row.SkillsDisabled == nil {
		row.SkillsDisabled = []string{}
	}
	if row.SkillsRestored == nil {
		row.SkillsRestored = []string{}
	}
	if row.SkillsEnabled == nil {
		row.SkillsEnabled = []string{}
	}
	return row, nil
}

// ensureRow makes sure the account has a settings row (with the defaults).
func ensureRow(db *gorm.DB, uid string) error {
	return db.Exec(`INSERT INTO agent_learning_settings (user_id) VALUES (?) ON CONFLICT (user_id) DO NOTHING`, uid).Error
}

// lockedSettings reads the account's settings row for update inside tx,
// creating it first.
func lockedSettings(tx *gorm.DB, uid string) (Settings, error) {
	if err := ensureRow(tx, uid); err != nil {
		return Settings{}, err
	}
	var row Settings
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ?", uid).Take(&row).Error; err != nil {
		return Settings{}, err
	}
	return row, nil
}

func saveSkillLists(tx *gorm.DB, uid string, disabled, restored []string) error {
	d, _ := json.Marshal(nonNil(disabled))
	r, _ := json.Marshal(nonNil(restored))
	return tx.Exec(`UPDATE agent_learning_settings SET skills_disabled = ?::jsonb, skills_restored = ?::jsonb, updated_at = now() WHERE user_id = ?`,
		string(d), string(r), uid).Error
}

// saveSkillsEnabled stores the skills the person turned on.
func saveSkillsEnabled(tx *gorm.DB, uid string, enabled []string) error {
	e, _ := json.Marshal(nonNil(enabled))
	return tx.Exec(`UPDATE agent_learning_settings SET skills_enabled = ?::jsonb, updated_at = now() WHERE user_id = ?`,
		string(e), uid).Error
}

func nonNil(list []string) []string {
	if list == nil {
		return []string{}
	}
	return list
}

func union(list []string, add ...string) []string {
	out := slices.Clone(nonNil(list))
	for _, name := range add {
		if !slices.Contains(out, name) {
			out = append(out, name)
		}
	}
	return out
}

func without(list []string, name string) []string {
	return slices.DeleteFunc(slices.Clone(nonNil(list)), func(s string) bool { return s == name })
}

// Prefs reads the account's learning settings for the chat engine and the
// worker's settings render.
func (s *Service) Prefs(ctx context.Context, uid string) (Prefs, error) {
	row, err := loadSettings(ctx, s.db, uid)
	if err != nil {
		return Prefs{}, err
	}
	return Prefs{Learning: row.Learning, SearchHistory: row.SearchHistory, SkillsDisabled: row.SkillsDisabled,
		SkillsEnabled: row.SkillsEnabled}, nil
}

// MarkRestored marks skills a backup restore brought back: disabled, and
// shown as "restored, review" until the person turns them on (Q-3.4). It
// runs inside the restore's transaction. A name it cannot store is an
// error, so the restore rolls back rather than leave that skill on (the
// worker's import blocks such names first).
func MarkRestored(tx *gorm.DB, uid string, names []string) error {
	var clean []string
	for _, name := range names {
		if !validName(name) {
			return fmt.Errorf("a restored skill's name %q cannot be kept turned off", cut(name, 80))
		}
		if !slices.Contains(clean, name) {
			clean = append(clean, name)
		}
	}
	if len(clean) == 0 {
		return nil
	}
	row, err := lockedSettings(tx, uid)
	if err != nil {
		return err
	}
	return saveSkillLists(tx, uid, union(row.SkillsDisabled, clean...), union(row.SkillsRestored, clean...))
}

// AfterReady runs when an account's worker passed its handshake
// (agenthost.Config.OnReady): it copies "What you use Timely for" into About
// you when that is due (Q-3.3).
func (s *Service) AfterReady(w *agenthost.Worker) {
	release := w.Hold()
	defer release()
	ctx, cancel := context.WithTimeout(context.Background(), s.timeout)
	defer cancel()
	if err := s.copyUseCase(ctx, w.Account(), w); err != nil {
		s.logf("learning: %s: copying the use case into About you: %v", agenthost.AccountDirName(w.Account()), err)
	}
}

// copyUseCase copies the person's "What you use Timely for" (suggest's
// personal prefs, read only) into About you (USER.md) once, while learning
// is on (Q-3.3). The copy is claimed in the database first, so two workers
// or a ready and a settings change never both copy; a failed request gives
// the claim back. An empty use case copies nothing and claims nothing.
func (s *Service) copyUseCase(ctx context.Context, uid string, w requester) error {
	row, err := loadSettings(ctx, s.db, uid)
	if err != nil || !row.Learning || row.UseCaseCopiedAt != nil {
		return err
	}
	var useCase string
	if err := s.db.WithContext(ctx).Raw(`SELECT use_case FROM suggestion_prefs WHERE user_id = ?`, uid).Scan(&useCase).Error; err != nil {
		return err
	}
	useCase = strings.TrimSpace(useCase)
	if useCase == "" {
		return nil
	}
	if err := ensureRow(s.db.WithContext(ctx), uid); err != nil {
		return err
	}
	claim := s.db.WithContext(ctx).Exec(`UPDATE agent_learning_settings SET use_case_copied_at = now(), updated_at = now()
		WHERE user_id = ? AND learning AND use_case_copied_at IS NULL`, uid)
	if claim.Error != nil || claim.RowsAffected != 1 {
		return claim.Error
	}
	_, err = askWorker(ctx, w, "learning.memory", map[string]any{
		"target": KindUser, "action": "add", "content": useCasePrefix + cut(useCase, 600), "old": "",
	})
	if err != nil {
		// Give the claim back, so the next ready tries again.
		back := s.db.Exec(`UPDATE agent_learning_settings SET use_case_copied_at = NULL WHERE user_id = ?`, uid)
		return errors.Join(err, back.Error)
	}
	return nil
}
