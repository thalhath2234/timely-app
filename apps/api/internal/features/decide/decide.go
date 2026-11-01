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
	"log"
	"math"
	"math/rand/v2"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
)

// ErrOff means no suggestion is available: no key, switched off, or Jev did
// not answer in time. Callers treat it as "no suggestion".
var ErrOff = errors.New("suggestions are off")

// Failed reports whether err is a call that went out and failed (a refused
// key, a timeout, an answer with no answers), or one held back while the
// provider recovers, rather than suggestions being off, the account busy or
// a request the provider refuses every time. A background job can try the
// first again later.
func Failed(err error) bool {
	if err == nil || err == ErrOff || !errors.Is(err, ErrOff) {
		return false
	}
	return !errors.Is(err, ErrBusy) && !errors.Is(err, ErrKeyRefused) && !errors.Is(err, ErrKeyUnreadable) && !permanent(err)
}

// MaxStateBytes is the largest JSON state Ask sends (about 8,000 tokens,
// well inside Jev's 32K limit). Callers with open-ended state trim to it.
const MaxStateBytes = 32000

type sensitiveKey struct{}

// WithSensitive marks work done for a sensitive chat (a receipt photo).
// Helpers that would send its searches or titles to Jev check IsSensitive
// and skip the call; only callers that mark their state Private send.
func WithSensitive(ctx context.Context) context.Context {
	return context.WithValue(ctx, sensitiveKey{}, true)
}

// IsSensitive reports whether ctx belongs to a sensitive chat.
func IsSensitive(ctx context.Context) bool {
	v, _ := ctx.Value(sensitiveKey{}).(bool)
	return v
}

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

	maxOptions    = MaxOptions
	maxLevels     = 10
	maxStateBytes = MaxStateBytes
	perUserCalls  = 4
	cacheFor      = 10 * time.Minute
	// coolFor is how long an account waits after the provider was out of
	// credit, rate limited or down and gave no Retry-After; maxCool caps the
	// wait.
	coolFor = 30 * time.Second
	maxCool = 2 * time.Minute
)

// MaxOptions is the most options one choice question can offer.
const MaxOptions = 255

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
	// Private marks state taken from private content such as a receipt.
	// OpenRouter then routes the call only to zero-data-retention endpoints.
	Private bool
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
	// raise is added to every reader's minimum confidence: learned from
	// how often the person kept this feature's suggestions (see learned.go).
	raise float64
}

// need is the confidence a reader asks for once the person's history is
// counted. A reader asking for any confidence (0) is left alone.
func (a Answers) need(min float64) float64 {
	if min <= 0 || a.raise <= 0 {
		return min
	}
	return math.Min(min+a.raise, maxNeed)
}

// Choice returns the chosen option when confidence reaches min.
func (a Answers) Choice(id string, min float64) (string, bool) {
	x, ok := a.answers[id]
	if !ok || x.Kind != typeChoice || x.Confidence < a.need(min) {
		return "", false
	}
	return x.Choice, true
}

// Level returns the score level index when confidence reaches min.
func (a Answers) Level(id string, min float64) (int, bool) {
	x, ok := a.answers[id]
	if !ok || x.Kind != typeScore || x.Confidence < a.need(min) {
		return 0, false
	}
	return x.Level, true
}

// Yes returns the yes/no answer when confidence reaches min.
func (a Answers) Yes(id string, min float64) (bool, bool) {
	x, ok := a.answers[id]
	if !ok || x.Kind != typeNoul || x.Confidence < a.need(min) {
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
	// A saved TypeSafe key left out of TypeSafe because TypeSafe refused it,
	// or because it cannot be decrypted, so Ask can say why nothing ran.
	TypeSafeRefused    bool
	TypeSafeUnreadable bool
}

// unusable is why a call cannot be made with these keys: ErrOff, or the
// saved TypeSafe key that cannot be used when it was the only one.
func (k Keys) unusable() error {
	switch {
	case !k.Enabled || k.OpenRouter != "":
		return ErrOff
	case k.TypeSafeUnreadable:
		return ErrKeyUnreadable
	case k.TypeSafeRefused:
		return ErrKeyRefused
	}
	return ErrOff
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
	// flights holds calls in progress by cache key, so an identical request
	// made meanwhile (a double submit) waits for that answer.
	flights map[string]*flight
	// cool holds, per account, until when calls wait after the provider was
	// out of credit, rate limited or down, and that failure.
	cool map[string]cooling
	rand func(int) []int
	// learned holds each account's raise per feature for a while.
	learned map[string]learnedRaise
	// learnGen counts forget calls (see learned.go).
	learnGen uint64

	pruned time.Time
}

type cached struct {
	answers Answers
	until   time.Time
}

type flight struct {
	done    chan struct{}
	answers Answers
	err     error
}

type cooling struct {
	until time.Time
	err   error
}

// New builds the service. A nil db skips the decision log; a nil client uses
// the real TypeSafe and OpenRouter endpoints.
func New(db *gorm.DB, keys KeySource, client Caller) *Service {
	if client == nil {
		client = NewClient(nil)
	}
	return &Service{db: db, keys: keys, client: client, slots: map[string]chan struct{}{}, cache: map[string]cached{},
		flights: map[string]*flight{}, cool: map[string]cooling{}, rand: rand.Perm, learned: map[string]learnedRaise{}}
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
	if err != nil {
		return Answers{}, ErrOff
	}
	if !keys.Usable() {
		return Answers{}, keys.unusable()
	}
	// Work for a sensitive chat (a receipt photo) only goes out as private
	// state, whichever helper asks, so none can forget to mark it.
	if IsSensitive(ctx) {
		req.Private = true
	}
	body, plan, err := s.build(req)
	if err != nil {
		// Nothing was sent, so the log is the only trace of the dropped check.
		log.Printf("decide: %s not sent: %v", req.Feature, err)
		return Answers{}, err
	}
	cacheKey := fmt.Sprintf("%x", sha256.Sum256(append([]byte(userID+"\x00"+req.Feature+"\x00"), stableKey(req)...)))
	if a, ok := s.cached(cacheKey); ok {
		a.raise = s.raiseFor(userID, req.Feature)
		return a, nil
	}
	if err := s.cooling(userID); err != nil {
		return Answers{}, err
	}
	f, leader := s.join(cacheKey)
	if !leader {
		// The same question is already out: wait for its answer.
		select {
		case <-f.done:
		case <-ctx.Done():
			return Answers{}, errors.Join(ErrOff, ctx.Err())
		}
		if f.err != nil {
			return Answers{}, f.err
		}
		a := f.answers
		a.raise = s.raiseFor(userID, req.Feature)
		return a, nil
	}
	answers, err := s.call(ctx, userID, req, keys, body, plan)
	if err == nil {
		s.store(cacheKey, answers)
	}
	s.land(cacheKey, f, answers, err)
	if err != nil {
		return Answers{}, err
	}
	answers.raise = s.raiseFor(userID, req.Feature)
	return answers, nil
}

// call makes the network call for Ask once a slot is free.
func (s *Service) call(ctx context.Context, userID string, req Request, keys Keys, body wire, plan plan) (Answers, error) {
	release, ok := s.acquire(ctx, userID)
	if !ok {
		return Answers{}, ErrBusy
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
		// The answer is dropped, so the server log is the only place a broken
		// key or endpoint shows up outside Settings → Agent → Test.
		log.Printf("decide: %s via %s failed after %s: %v", req.Feature, provider, time.Since(started).Round(time.Millisecond), err)
		s.coolAfter(userID, err)
		return Answers{}, errors.Join(ErrOff, err)
	}
	answers.LogID = logID
	return answers, nil
}

// join returns the call in progress for key, or starts one this caller
// leads (leader true) and must land.
func (s *Service) join(key string) (*flight, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if f, ok := s.flights[key]; ok {
		return f, false
	}
	f := &flight{done: make(chan struct{})}
	s.flights[key] = f
	return f, true
}

// land hands the leader's result to everyone waiting on it.
func (s *Service) land(key string, f *flight, a Answers, err error) {
	s.mu.Lock()
	delete(s.flights, key)
	s.mu.Unlock()
	f.answers, f.err = a, err
	close(f.done)
}

// cooling returns the held-back error while the account waits after the
// provider was out of credit, rate limited or down.
func (s *Service) cooling(userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.cool[userID]
	if !ok {
		return nil
	}
	if time.Now().After(c.until) {
		delete(s.cool, userID)
		return nil
	}
	return errors.Join(ErrOff, ErrCooling, c.err)
}

// coolAfter makes the account wait when the last provider tried was out of
// credit (402), rate limited (429) or down (5xx): for its Retry-After when
// it gave one, else coolFor, at most maxCool. Reloading a screen then costs
// no call.
func (s *Service) coolAfter(userID string, err error) {
	var se *StatusError
	if !errors.As(lastErr(err), &se) || (se.Code != 402 && se.Code != 429 && se.Code < 500) {
		return
	}
	wait := coolFor
	if se.RetryAfter > 0 {
		wait = min(se.RetryAfter, maxCool)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.cool) > 5000 {
		s.cool = map[string]cooling{}
	}
	s.cool[userID] = cooling{until: time.Now().Add(wait), err: err}
}

// wire is the request body both endpoints accept.
type wire struct {
	Model     string               `json:"model"`
	State     any                  `json:"state"`
	Questions map[string]wireQuest `json:"questions"`
	// Provider is OpenRouter's routing preference; TypeSafe takes none.
	Provider map[string]any `json:"provider,omitempty"`
	private  bool
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
	kinds   map[string]string   // feature id -> kind
	pairs   map[string][]string // feature id -> wire ids (two for Twice)
	levels  map[string]int      // feature id -> number of score levels
	options map[string][]string // feature id -> choice option names
}

func (s *Service) build(req Request) (wire, plan, error) {
	state, err := json.Marshal(req.State)
	if err != nil {
		return wire{}, plan{}, err
	}
	if len(state) > maxStateBytes {
		return wire{}, plan{}, &TooBigError{fmt.Sprintf("decide: state for %s is %d bytes; trim it below %d", req.Feature, len(state), maxStateBytes)}
	}
	w := wire{State: req.State, Questions: map[string]wireQuest{}, private: req.Private}
	p := plan{kinds: map[string]string{}, pairs: map[string][]string{}, levels: map[string]int{}, options: map[string][]string{}}
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
			if len(q.options) < 2 {
				return wire{}, plan{}, fmt.Errorf("decide: %s needs 2 to %d options, got %d", id, maxOptions, len(q.options))
			}
			if len(q.options) > maxOptions {
				return wire{}, plan{}, &TooBigError{fmt.Sprintf("decide: %s needs 2 to %d options, got %d", id, maxOptions, len(q.options))}
			}
			for _, o := range q.options {
				p.options[id] = append(p.options[id], o.Name)
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

// errUnreadable is an answer body that is not Jev's JSON.
var errUnreadable = errors.New("decide: unreadable answer")

// read maps the answers back to the questions. An answer that does not fit
// its question is dropped as if Jev had not answered it: a type other than
// the one asked, a confidence outside 0..1, a score off the levels, or a
// choice that is not one of the options (matched ignoring case and spaces).
func (p plan) read(raw []byte) (map[string]Answer, error) {
	var r response
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, fmt.Errorf("%w: %v", errUnreadable, err)
	}
	out := map[string]Answer{}
	for id, kind := range p.kinds {
		wires := p.pairs[id]
		first, ok := r.Answers[wires[0]]
		if !ok || (first.Type != "" && first.Type != kind) || !unit(first.Confidence) {
			continue
		}
		switch kind {
		case typeChoice:
			choice, ok := p.option(id, first.Choice)
			if !ok {
				continue
			}
			a := Answer{Kind: kind, Choice: choice, Confidence: first.Confidence}
			if len(wires) == 2 {
				second, ok := r.Answers[wires[1]]
				again, known := p.option(id, second.Choice)
				if !ok || !known || again != choice || !unit(second.Confidence) {
					a.Confidence = 0 // the two orders disagree: not reliable
				} else {
					a.Confidence = math.Min(first.Confidence, second.Confidence)
				}
			}
			out[id] = a
		case typeScore:
			// Levels run 0..n-1; rounding to the nearest is fine, a score
			// beyond half a level past either end is not an answer.
			n := p.levels[id]
			if first.Score < -0.5 || first.Score > float64(n)-0.5 || math.IsNaN(first.Score) {
				continue
			}
			level := min(max(int(math.Round(first.Score)), 0), n-1)
			out[id] = Answer{Kind: kind, Level: level, Confidence: first.Confidence}
		case typeNoul:
			if first.Noul == nil || !unit(*first.Noul) {
				continue
			}
			y := *first.Noul
			out[id] = Answer{Kind: kind, Yes: y, Confidence: math.Abs(2*y - 1)}
		}
	}
	// An answer to none of the questions asked is a failed call, not a
	// decision: it is neither logged as one nor cached.
	if len(out) == 0 {
		return nil, fmt.Errorf("decide: the answer had none of the questions asked: %w", errNoAnswers)
	}
	return out, nil
}

// unit reports whether v is a probability or confidence (0..1).
func unit(v float64) bool { return v >= 0 && v <= 1 }

// option is the name of the option a choice answer names: the exact name, or
// the one name it matches ignoring case and surrounding spaces.
func (p plan) option(id, choice string) (string, bool) {
	names := p.options[id]
	for _, n := range names {
		if n == choice {
			return n, true
		}
	}
	want := strings.ToLower(strings.TrimSpace(choice))
	found := ""
	for _, n := range names {
		if strings.ToLower(strings.TrimSpace(n)) == want {
			if found != "" {
				return "", false
			}
			found = n
		}
	}
	return found, found != ""
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

// minCallTime is the least time left that a call which waited for a slot
// still starts with; Jev usually answers well within it.
const minCallTime = time.Second

// acquire limits each account to a few calls at once. A call that had to
// wait for a slot is not started when too little of its time is left for an
// answer: smart search used to get a slot with under a second of its three
// left, and its call could only time out.
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
	default:
	}
	select {
	case slot <- struct{}{}:
		if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) < minCallTime {
			<-slot
			return nil, false
		}
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
	err := s.db.Model(&DecisionLog{}).Where("id = ? AND user_id = ?", logID, userID).Where(notReset).
		Updates(map[string]any{"accepted": accepted, "decided_at": now}).Error
	s.forget(userID)
	return err
}

// Dismissed records that the person set a suggestion aside without using
// it, unless they already answered it: a kept answer stands, and a second
// dismissal of the same decision changes nothing.
func (s *Service) Dismissed(userID, logID string) error {
	if s == nil || s.db == nil || logID == "" {
		return nil
	}
	err := s.db.Model(&DecisionLog{}).Where("id = ? AND user_id = ? AND accepted IS NULL AND decided_at IS NULL", logID, userID).
		Updates(map[string]any{"accepted": false, "decided_at": time.Now().UTC()}).Error
	s.forget(userID)
	return err
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
