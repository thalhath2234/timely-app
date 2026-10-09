// Package decide asks TypeSafe's Jev model typed questions (choice, score,
// yes/no) and returns answers with a confidence, for suggestions only. It is
// optional: with no TypeSafe or OpenRouter key, or with suggestions switched
// off, Ask returns ErrOff without a network call and callers keep their usual
// behaviour. Jev never decides approvals, permissions or writes; see
// docs/adr/0012-jev-decisions.md.
package decide

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"sort"
	"strconv"
	"sync"
	"time"

	"gorm.io/gorm"
)

// ErrOff means no suggestion is available: no key, switched off, or Jev did
// not answer in time. Callers treat it as "no suggestion".
var ErrOff = errors.New("suggestions are off")

// Thresholds. Confidence runs from 0 (spread evenly) to 1 (certain), as
// TypeSafe defines it for choice and score; yes/no uses |2p-1|.
const (
	Prefill = 0.6 // fill a form field the person still confirms
	Route   = 0.8 // change what the agent does
	Flag    = 0.5 // show a review hint
)

const (
	typeChoice = "choice"
	typeScore  = "score"
	typeNoul   = "noul"

	maxOptions    = 255
	maxLevels     = 10
	maxStateBytes = 32000 // about 8,000 tokens, well inside Jev's 32K limit
	perUserCalls  = 4
	cacheFor      = 10 * time.Minute
)

// Option is one choice option or score level. Description may be empty when
// the name says enough.
type Option struct {
	Name        string
	Description string
}

// Question is one typed question. Build it with Choice, Score or YesNo.
type Question struct {
	kind         string
	instructions string
	options      []Option // choice options; score levels in order
	yes, no      string
	twice        bool
}

// Choice asks Jev to pick one option. Options are shuffled before sending,
// because Jev leans toward the first one.
func Choice(instructions string, options ...Option) Question {
	return Question{kind: typeChoice, instructions: instructions, options: options}
}

// Score asks Jev to place the state on ordered levels, lowest first.
func Score(instructions string, levels ...string) Question {
	opts := make([]Option, len(levels))
	for i, l := range levels {
		opts[i] = Option{Name: l}
	}
	return Question{kind: typeScore, instructions: instructions, options: opts}
}

// YesNo asks a yes/no question; yes and no say what each answer means.
func YesNo(instructions, yes, no string) Question {
	return Question{kind: typeNoul, instructions: instructions, yes: yes, no: no}
}

// Twice marks a choice as important: it is asked in two option orders and
// only kept when both agree.
func (q Question) Twice() Question { q.twice = true; return q }

// Request is one call: the state every question reads, and the questions.
type Request struct {
	Feature   string
	State     any
	Questions map[string]Question
}

// Answer is Jev's answer to one question.
type Answer struct {
	Kind       string
	Choice     string  // choice: the option name
	Level      int     // score: the nearest level index, 0 = first level
	Yes        float64 // yes/no: probability of yes
	Confidence float64
}

// Answers holds every answer of one call.
type Answers struct {
	Provider string
	LogID    string
	answers  map[string]Answer
}

// Choice returns the chosen option when confidence reaches min.
func (a Answers) Choice(id string, min float64) (string, bool) {
	x, ok := a.answers[id]
	if !ok || x.Kind != typeChoice || x.Confidence < min {
		return "", false
	}
	return x.Choice, true
}

// Level returns the score level index when confidence reaches min.
func (a Answers) Level(id string, min float64) (int, bool) {
	x, ok := a.answers[id]
	if !ok || x.Kind != typeScore || x.Confidence < min {
		return 0, false
	}
	return x.Level, true
}

// Yes returns the yes/no answer when confidence reaches min.
func (a Answers) Yes(id string, min float64) (bool, bool) {
	x, ok := a.answers[id]
	if !ok || x.Kind != typeNoul || x.Confidence < min {
		return false, false
	}
	return x.Yes >= 0.5, true
}

// Raw returns the answer whatever its confidence (for tests and logs).
func (a Answers) Raw(id string) (Answer, bool) { x, ok := a.answers[id]; return x, ok }

// Keys are an account's credentials for Jev, TypeSafe first.
type Keys struct {
	Enabled    bool
	TypeSafe   string
	OpenRouter string
}

// Usable reports whether a call can be made at all.
func (k Keys) Usable() bool { return k.Enabled && (k.TypeSafe != "" || k.OpenRouter != "") }

// KeySource looks up an account's keys and switch.
type KeySource func(ctx context.Context, userID string) (Keys, error)

// Service is the only code in Timely that talks to Jev.
type Service struct {
	db     *gorm.DB
	keys   KeySource
	client Caller

	mu    sync.Mutex
	slots map[string]chan struct{}
	cache map[string]cached
	rand  func(int) []int

	pruned time.Time
}

type cached struct {
	answers Answers
	until   time.Time
}

// New builds the service. A nil db skips the decision log; a nil client uses
// the real TypeSafe and OpenRouter endpoints.
func New(db *gorm.DB, keys KeySource, client Caller) *Service {
	if client == nil {
		client = NewClient(nil)
	}
	return &Service{db: db, keys: keys, client: client, slots: map[string]chan struct{}{}, cache: map[string]cached{}, rand: rand.Perm}
}

// Status reports whether suggestions are available for an account and which
// provider would answer first.
func (s *Service) Status(ctx context.Context, userID string) (bool, string) {
	if s == nil || s.keys == nil {
		return false, ""
	}
	k, err := s.keys(ctx, userID)
	if err != nil || !k.Usable() {
		return false, ""
	}
	if k.TypeSafe != "" {
		return true, ProviderTypeSafe
	}
	return true, ProviderOpenRouter
}

// Ask sends the questions and returns the answers, or ErrOff. The context's
// deadline is the time budget: callers behind a screen pass a short one.
func (s *Service) Ask(ctx context.Context, userID string, req Request) (Answers, error) {
	if s == nil || s.keys == nil || len(req.Questions) == 0 {
		return Answers{}, ErrOff
	}
	keys, err := s.keys(ctx, userID)
	if err != nil || !keys.Usable() {
		return Answers{}, ErrOff
	}
	body, plan, err := s.build(req)
	if err != nil {
		return Answers{}, err
	}
	cacheKey := fmt.Sprintf("%x", sha256.Sum256(append([]byte(userID+"\x00"+req.Feature+"\x00"), stableKey(req)...)))
	if a, ok := s.cached(cacheKey); ok {
		return a, nil
	}
	release, ok := s.acquire(ctx, userID)
	if !ok {
		return Answers{}, ErrOff
	}
	defer release()

	started := time.Now()
	raw, provider, err := s.client.Call(context.WithValue(ctx, userKey{}, userID), keys, body)
	answers := Answers{Provider: provider}
	if err == nil {
		answers.answers, err = plan.read(raw)
	}
	logID := s.log(userID, req.Feature, provider, time.Since(started), err)
	if err != nil {
		return Answers{}, errors.Join(ErrOff, err)
	}
	answers.LogID = logID
	s.store(cacheKey, answers)
	return answers, nil
}

// wire is the request body both endpoints accept.
type wire struct {
	Model     string               `json:"model"`
	State     any                  `json:"state"`
	Questions map[string]wireQuest `json:"questions"`
}

type wireQuest struct {
	Type         string `json:"type"`
	Instructions string `json:"instructions"`
	Criteria     any    `json:"criteria,omitempty"`
}

// ordered keeps choice options in the (shuffled) order they were placed in;
// encoding/json would sort a map's keys.
type ordered []Option

func (o ordered) MarshalJSON() ([]byte, error) {
	buf := []byte{'{'}
	for i, opt := range o {
		if i > 0 {
			buf = append(buf, ',')
		}
		k, _ := json.Marshal(opt.Name)
		buf = append(buf, k...)
		buf = append(buf, ':')
		if opt.Description == "" {
			buf = append(buf, "null"...)
		} else {
			v, _ := json.Marshal(opt.Description)
			buf = append(buf, v...)
		}
	}
	return append(buf, '}'), nil
}

// plan remembers how wire questions map back to the feature's questions.
type plan struct {
	kinds  map[string]string   // feature id -> kind
	pairs  map[string][]string // feature id -> wire ids (two for Twice)
	levels map[string]int      // feature id -> number of score levels
}

func (s *Service) build(req Request) (wire, plan, error) {
	state, err := json.Marshal(req.State)
	if err != nil {
		return wire{}, plan{}, err
	}
	if len(state) > maxStateBytes {
		return wire{}, plan{}, fmt.Errorf("decide: state for %s is %d bytes; trim it below %d", req.Feature, len(state), maxStateBytes)
	}
	w := wire{State: req.State, Questions: map[string]wireQuest{}}
	p := plan{kinds: map[string]string{}, pairs: map[string][]string{}, levels: map[string]int{}}
	ids := make([]string, 0, len(req.Questions))
	for id := range req.Questions {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		q := req.Questions[id]
		p.kinds[id] = q.kind
		switch q.kind {
		case typeChoice:
			if len(q.options) < 2 || len(q.options) > maxOptions {
				return wire{}, plan{}, fmt.Errorf("decide: %s needs 2 to %d options, got %d", id, maxOptions, len(q.options))
			}
			first := s.shuffle(q.options)
			w.Questions[id] = wireQuest{Type: typeChoice, Instructions: q.instructions, Criteria: first}
			p.pairs[id] = []string{id}
			if q.twice {
				second := make(ordered, len(first))
				for i := range first {
					second[i] = first[len(first)-1-i]
				}
				w.Questions[id+"__2"] = wireQuest{Type: typeChoice, Instructions: q.instructions, Criteria: second}
				p.pairs[id] = append(p.pairs[id], id+"__2")
			}
		case typeScore:
			if len(q.options) < 2 || len(q.options) > maxLevels {
				return wire{}, plan{}, fmt.Errorf("decide: %s needs 2 to %d levels, got %d", id, maxLevels, len(q.options))
			}
			levels := make([]string, len(q.options))
			for i, o := range q.options {
				levels[i] = o.Name
			}
			w.Questions[id] = wireQuest{Type: typeScore, Instructions: q.instructions, Criteria: levels}
			p.pairs[id] = []string{id}
			p.levels[id] = len(levels)
		case typeNoul:
			c := map[string]string{"true": q.yes, "false": q.no}
			w.Questions[id] = wireQuest{Type: typeNoul, Instructions: q.instructions, Criteria: c}
			p.pairs[id] = []string{id}
		default:
			return wire{}, plan{}, fmt.Errorf("decide: unknown question kind for %s", id)
		}
	}
	return w, p, nil
}

func (s *Service) shuffle(options []Option) ordered {
	out := make(ordered, len(options))
	for i, j := range s.rand(len(options)) {
		out[i] = options[j]
	}
	return out
}

// response is what both endpoints return.
type response struct {
	Answers map[string]struct {
		Type       string             `json:"type"`
		Choice     string             `json:"choice"`
		Score      float64            `json:"score"`
		Noul       *float64           `json:"noul"`
		Confidence float64            `json:"confidence"`
		Probs      map[string]float64 `json:"probabilities"`
	} `json:"answers"`
}

func (p plan) read(raw []byte) (map[string]Answer, error) {
	var r response
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, fmt.Errorf("decide: unreadable answer: %w", err)
	}
	out := map[string]Answer{}
	for id, kind := range p.kinds {
		wires := p.pairs[id]
		first, ok := r.Answers[wires[0]]
		if !ok {
			continue
		}
		switch kind {
		case typeChoice:
			a := Answer{Kind: kind, Choice: first.Choice, Confidence: first.Confidence}
			if len(wires) == 2 {
				second, ok := r.Answers[wires[1]]
				if !ok || second.Choice != first.Choice {
					a.Confidence = 0 // the two orders disagree: not reliable
				} else {
					a.Confidence = math.Min(first.Confidence, second.Confidence)
				}
			}
			out[id] = a
		case typeScore:
			level := int(math.Round(first.Score))
			if n := p.levels[id]; level >= n {
				level = n - 1
			}
			if level < 0 {
				level = 0
			}
			out[id] = Answer{Kind: kind, Level: level, Confidence: first.Confidence}
		case typeNoul:
			if first.Noul == nil {
				continue
			}
			y := *first.Noul
			out[id] = Answer{Kind: kind, Yes: y, Confidence: math.Abs(2*y - 1)}
		}
	}
	return out, nil
}

// stableKey identifies a request for the cache, ignoring option order.
func stableKey(req Request) []byte {
	type q struct {
		K, I, Y, N string
		O          []Option
		T          bool
	}
	m := map[string]q{}
	for id, x := range req.Questions {
		m[id] = q{x.kind, x.instructions, x.yes, x.no, x.options, x.twice}
	}
	b, _ := json.Marshal(struct {
		S any
		Q map[string]q
	}{req.State, m})
	return b
}

func (s *Service) cached(key string) (Answers, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.cache[key]
	if !ok || time.Now().After(c.until) {
		delete(s.cache, key)
		return Answers{}, false
	}
	return c.answers, true
}

func (s *Service) store(key string, a Answers) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.cache) > 5000 {
		now := time.Now()
		for k, c := range s.cache {
			if now.After(c.until) {
				delete(s.cache, k)
			}
		}
	}
	s.cache[key] = cached{answers: a, until: time.Now().Add(cacheFor)}
}

// acquire limits each account to a few calls at once.
func (s *Service) acquire(ctx context.Context, userID string) (func(), bool) {
	s.mu.Lock()
	slot, ok := s.slots[userID]
	if !ok {
		slot = make(chan struct{}, perUserCalls)
		s.slots[userID] = slot
	}
	s.mu.Unlock()
	select {
	case slot <- struct{}{}:
		return func() { <-slot }, true
	case <-ctx.Done():
		return nil, false
	}
}

// DecisionLog keeps one row per Jev call for tuning thresholds. It stores no
// task or document text.
type DecisionLog struct {
	ID        string     `gorm:"primaryKey;column:id"`
	UserID    string     `gorm:"column:user_id"`
	Feature   string     `gorm:"column:feature"`
	Provider  string     `gorm:"column:provider"`
	LatencyMS int        `gorm:"column:latency_ms"`
	OK        bool       `gorm:"column:ok"`
	Accepted  *bool      `gorm:"column:accepted"`
	CreatedAt time.Time  `gorm:"column:created_at"`
	DecidedAt *time.Time `gorm:"column:decided_at"`
}

func (DecisionLog) TableName() string { return "decision_log" }

func (s *Service) log(userID, feature, provider string, took time.Duration, err error) string {
	if s.db == nil {
		return ""
	}
	row := DecisionLog{ID: "dec_" + strconv.FormatInt(time.Now().UnixNano(), 36) + strconv.Itoa(rand.IntN(1000)), UserID: userID, Feature: feature, Provider: provider,
		LatencyMS: int(took.Milliseconds()), OK: err == nil, CreatedAt: time.Now().UTC()}
	if s.db.Create(&row).Error != nil {
		return ""
	}
	return row.ID
}

// Feedback records whether the person kept a suggestion.
func (s *Service) Feedback(userID, logID string, accepted bool) error {
	if s == nil || s.db == nil || logID == "" {
		return nil
	}
	now := time.Now().UTC()
	return s.db.Model(&DecisionLog{}).Where("id = ? AND user_id = ?", logID, userID).
		Updates(map[string]any{"accepted": accepted, "decided_at": now}).Error
}

// Prune drops log rows older than 30 days, at most once an hour (the job
// sweep calls it every few seconds).
func (s *Service) Prune() error {
	if s == nil || s.db == nil {
		return nil
	}
	s.mu.Lock()
	due := time.Since(s.pruned) > time.Hour
	if due {
		s.pruned = time.Now()
	}
	s.mu.Unlock()
	if !due {
		return nil
	}
	return s.db.Where("created_at < ?", time.Now().UTC().Add(-30*24*time.Hour)).Delete(&DecisionLog{}).Error
}
