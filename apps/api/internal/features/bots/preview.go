package bots

import (
	"container/list"
	"context"
	"errors"
	"log"
	"slices"
	"strings"
	"sync"
	"time"

	"timely-api/internal/features/bots/extract"
	"timely-api/internal/features/bots/fetch"
	"timely-api/internal/features/bots/price"
	"timely-api/internal/utils"
)

const (
	// PreviewTTL is how long a preview's reading is reused for the same
	// person and watch, so the model's preview, the proposal card and the
	// editor's Test share one fetch.
	PreviewTTL = 10 * time.Minute
	// PreviewMemoMax caps the remembered previews; the oldest goes first.
	PreviewMemoMax = 500
	// PreviewReadsPerMinute caps one person's fresh preview reads. Reused
	// readings are free.
	PreviewReadsPerMinute = 12
	// PreviewMaxWait is the longest a preview waits for a site's slot.
	// Longer gives the site_busy line instead of keeping the person waiting.
	PreviewMaxWait = 5 * time.Second
	// MaxPreviewText bounds the text a selector or text read shows, in
	// characters.
	MaxPreviewText = 600
	// PreviewItems is how many of a feed's newest items a preview shows.
	PreviewItems = 5
	// previewBudget bounds one whole preview.
	previewBudget = time.Minute
)

// ErrPreviewLimit is a person previewing faster than PreviewReadsPerMinute.
var ErrPreviewLimit = errors.New("Too many previews right now. Try again in a minute.")

// PreviewInput is what to read once: watches as a client would send them
// (1 to MaxWatches; their ids are ignored), or a saved Bot's watches by its
// id, whatever its status.
type PreviewInput struct {
	Watches []WatchInput `json:"watches,omitempty"`
	BotID   string       `json:"botId,omitempty"`
}

// PreviewCandidate is one price a shop page shows, which a selector_price
// watch can follow by its selector.
type PreviewCandidate = extract.Candidate

// PreviewExcerpt is the page's text around the price it read. Mark and
// Struck are rune ranges in Text: the price read, and crossed-out prices.
type PreviewExcerpt struct {
	Text   string   `json:"text"`
	Mark   [2]int   `json:"mark"`
	Struck [][2]int `json:"struck"`
}

// PreviewWatch is what one watch reads right now. OK false carries the
// problem in Health, written as a check's health line.
type PreviewWatch struct {
	Index    int      `json:"index"`
	WatchID  string   `json:"watchId"` // the saved watch, botId previews only
	OK       bool     `json:"ok"`
	Kind     string   `json:"kind"`
	Read     string   `json:"read"`
	Site     string   `json:"site"`
	Summary  string   `json:"summary"`
	Value    *float64 `json:"value"`
	Currency string   `json:"currency"`
	// Availability is whether the product can be bought, on a product_price
	// page: an extract.Avail word, "unknown" when the page says nothing.
	// "" for every other read.
	Availability string             `json:"availability"`
	Text         string             `json:"text"`  // text and selector reads, up to MaxPreviewText
	Items        []ItemBrief        `json:"items"` // feeds: the newest PreviewItems
	Excerpt      *PreviewExcerpt    `json:"excerpt"`
	Candidates   []PreviewCandidate `json:"candidates"` // shop prices: every price the page shows
	Health       *Health            `json:"health"`
	At           time.Time          `json:"at"`
}

// PreviewResult is one PreviewWatch per watch, in order.
type PreviewResult struct {
	Watches []PreviewWatch `json:"watches"`
}

// previews is shared by every Service in the process, so REST, the chat
// tool and the chat runner reuse one another's readings and count toward
// one limit.
var previews = struct {
	memo  *previewMemo
	limit *previewLimiter
	slots *previewSlots
}{newPreviewMemo(PreviewTTL, PreviewMemoMax), newPreviewLimiter(PreviewReadsPerMinute, time.Minute), &previewSlots{byUser: map[string]*fetch.Slots{}}}

// previewSlots is each person's site bookings from their own recent
// previews, so a preview a few seconds after another on the same site (the
// chat reading a page again, or Test pressed twice) waits out its own
// spacing instead of taking it for a busy site.
type previewSlots struct {
	mu     sync.Mutex
	byUser map[string]*fetch.Slots
}

// of is userID's bookings; sets whose spacing is over are dropped.
func (p *previewSlots) of(userID string, now time.Time) *fetch.Slots {
	p.mu.Lock()
	defer p.mu.Unlock()
	for id, o := range p.byUser {
		if id != userID && o.Idle(now) {
			delete(p.byUser, id)
		}
	}
	o, ok := p.byUser[userID]
	if !ok {
		o = fetch.NewSlots()
		p.byUser[userID] = o
	}
	return o
}

// Preview reads each watch once, the way a check would, and says what it
// reads right now. It saves nothing: no Bot, watch, check, alert, finding,
// price or key state, only the shared site spacing and robots.txt caches a
// check also writes. A watch that fails gives its health line and the others
// are still read. The watches are read one after another and share their
// site slots with the person's other recent previews (previewSlots), so a
// second watch on one site waits behind the first instead of taking it for
// a busy site.
func (s *Service) Preview(ctx context.Context, userID string, in PreviewInput) (PreviewResult, error) {
	ws, ids, err := s.previewWatches(ctx, userID, in)
	if err != nil {
		return PreviewResult{}, err
	}
	now := s.now().UTC()
	keys := make([]string, len(ws))
	cached := make([]*PreviewWatch, len(ws))
	fresh := map[string]bool{} // a watch sent twice is read once
	for i, w := range ws {
		keys[i] = previewKey(userID, w)
		if pw, ok := previews.memo.get(keys[i], now); ok {
			cached[i] = &pw
		} else {
			fresh[keys[i]] = true
		}
	}
	if len(fresh) > 0 && !previews.limit.take(userID, len(fresh), now) {
		return PreviewResult{}, ErrPreviewLimit
	}
	ctx, cancel := context.WithTimeout(ctx, previewBudget)
	defer cancel()
	ctx = fetch.WithSlots(ctx, previews.slots.of(userID, now))
	b := Bot{UserID: userID}
	out := PreviewResult{Watches: make([]PreviewWatch, 0, len(ws))}
	read := map[string]PreviewWatch{}
	for i, w := range ws {
		var pw PreviewWatch
		if cached[i] != nil {
			pw = *cached[i]
		} else if again, ok := read[keys[i]]; ok {
			pw = clonePreview(again)
		} else {
			var keep bool
			if pw, keep = s.previewOne(ctx, b, w); keep {
				previews.memo.put(keys[i], pw, s.now().UTC())
			}
			read[keys[i]] = pw
		}
		pw.Index, pw.WatchID = i, ids[i]
		out.Watches = append(out.Watches, pw)
	}
	return out, nil
}

// previewWatches checks the input and returns the watches to read, with
// the saved watch ids ("" for watches sent in).
func (s *Service) previewWatches(ctx context.Context, userID string, in PreviewInput) ([]Watch, []string, error) {
	db := s.db.WithContext(ctx)
	botID := strings.TrimSpace(in.BotID)
	switch {
	case botID != "" && len(in.Watches) > 0:
		return nil, nil, invalid("Preview either watches or a bot, not both")
	case botID != "":
		b, err := findBot(db, userID, botID, false)
		if err != nil {
			return nil, nil, err
		}
		saved, err := loadWatches(db, b.ID, false)
		if err != nil {
			return nil, nil, err
		}
		ws := make([]Watch, len(saved))
		ids := make([]string, len(saved))
		for i, w := range saved {
			ids[i] = w.ID
			ws[i] = previewCopy(w)
		}
		return ws, ids, nil
	}
	hasKey, err := keySet(db, userID)
	if err != nil {
		return nil, nil, err
	}
	sent := make([]WatchInput, len(in.Watches))
	for i, wi := range in.Watches {
		wi.ID = "" // an unsaved draft: nothing to keep
		sent[i] = wi
	}
	ws, err := cleanWatches(sent, nil, hasKey)
	if err != nil {
		return nil, nil, err
	}
	return ws, make([]string, len(ws)), nil
}

// previewCopy is a saved watch's config with no reading, so the read sends
// no conditional headers and starts from nothing.
func previewCopy(w Watch) Watch {
	return Watch{
		ID: w.ID, BotID: w.BotID, UserID: w.UserID, Kind: w.Kind, URL: w.URL, ReadMode: w.ReadMode,
		Selector: w.Selector, Source: w.Source, Symbol: w.Symbol, Currency: w.Currency, Rules: w.Rules,
	}
}

// previewOne reads one watch. keep is false for a reading not worth
// reusing: the network was down, the site asked to wait, the key failed
// (the person may fix it and try again at once), or the read failed in a
// way a check would retry.
func (s *Service) previewOne(ctx context.Context, b Bot, w Watch) (pw PreviewWatch, keep bool) {
	now := s.now().UTC()
	r := s.readWatch(ctx, b, w, now, s.previewKeys(), PreviewMaxWait)
	pw = PreviewWatch{Kind: w.Kind, Read: w.ReadMode, Site: watchSite(w), Items: []ItemBrief{}, Candidates: []PreviewCandidate{}, At: now}
	if r.err != nil {
		p := describeErr(w, r.err)
		if p == nil {
			// Not a problem a check would blame on the site (a check
			// retries its job): this watch says so, and the others are
			// still read.
			log.Printf("bots: preview %s: %v", siteOf(w), utils.RedactSecrets(r.err.Error()))
			pw.Health = &Health{Code: "offline", Line: "Could not read " + siteOf(w) + " just now. Try again in a minute"}
			return pw, false
		}
		line := p.line
		if p.outcome == outRateLimited {
			line = p.site + " asked Timely to wait before reading it again"
		}
		pw.Health = &Health{Code: p.code, Line: line}
		// The page was read but no price came out of it: the prices it
		// does show are what the person (or the chat) picks one from.
		if r.res != nil && isPagePrice(w) {
			pw.Candidates = priceCandidates(r.res.Body, r.res.ContentType)
		}
		return pw, (p.class == classStrike && p.code != "needs_key") || p.class == classRobots
	}
	reading := r.reading
	pw.OK = true
	pw.Summary = summary(&reading)
	if !reading.At.IsZero() {
		pw.At = reading.At.UTC()
	}
	switch reading.Kind {
	case ReadingPrice:
		if reading.Price != nil {
			v := *reading.Price
			pw.Value, pw.Currency = &v, reading.Currency
		}
		pw.Availability = availabilityOf(&reading, w)
	case ReadingText:
		pw.Text = clipRunes(reading.Text, MaxPreviewText)
	case ReadingFeed:
		pw.Items = newestItems(reading.Items, PreviewItems)
	}
	if r.res != nil && isPagePrice(w) {
		pw.Candidates = priceCandidates(r.res.Body, r.res.ContentType)
		if pw.Value != nil {
			if text, mark, struck := extract.PriceExcerpt(r.res.Body, r.res.ContentType, *pw.Value); text != "" {
				if struck == nil {
					struck = [][2]int{}
				}
				pw.Excerpt = &PreviewExcerpt{Text: text, Mark: mark, Struck: struck}
			}
		}
	}
	return pw, true
}

// isPagePrice is a page watch that reads a price off the page.
func isPagePrice(w Watch) bool {
	return w.ReadMode == ReadProductPrice || w.ReadMode == ReadSelectorPrice
}

// priceCandidates lists the prices a page shows, or none.
func priceCandidates(body []byte, contentType string) []PreviewCandidate {
	if cs, err := extract.PriceCandidates(body, contentType); err == nil && len(cs) > 0 {
		return cs
	}
	return []PreviewCandidate{}
}

// previewKeys finds keys without marking one refused: a key that no longer
// opens fails this read as needs_key, and the next check marks it.
func (s *Service) previewKeys() price.Keys {
	if s.keyStore != nil {
		return lookOnlyKeys{s.keyStore}
	}
	return s.keys
}

// previewKey names one person's watch config: what is read and how, not
// its rules.
func previewKey(userID string, w Watch) string {
	return strings.Join([]string{userID, w.Kind, w.URL, w.ReadMode, w.Selector, w.Source, w.Symbol, w.Currency}, "\x00")
}

// previewMemo remembers preview readings for ttl, at most max of them; the
// oldest goes first. Time comes from the caller, so a Service's injected
// clock drives it.
type previewMemo struct {
	mu      sync.Mutex
	ttl     time.Duration
	max     int
	order   *list.List // of *memoEntry, oldest first
	entries map[string]*list.Element
}

type memoEntry struct {
	key string
	at  time.Time
	pw  PreviewWatch
}

func newPreviewMemo(ttl time.Duration, max int) *previewMemo {
	return &previewMemo{ttl: ttl, max: max, order: list.New(), entries: map[string]*list.Element{}}
}

func (m *previewMemo) get(key string, now time.Time) (PreviewWatch, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	el, ok := m.entries[key]
	if !ok {
		return PreviewWatch{}, false
	}
	e := el.Value.(*memoEntry)
	if now.Sub(e.at) >= m.ttl || now.Before(e.at) {
		m.order.Remove(el)
		delete(m.entries, key)
		return PreviewWatch{}, false
	}
	return clonePreview(e.pw), true
}

func (m *previewMemo) put(key string, pw PreviewWatch, now time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if el, ok := m.entries[key]; ok {
		e := el.Value.(*memoEntry)
		e.at, e.pw = now, clonePreview(pw)
		m.order.MoveToBack(el)
	} else {
		m.entries[key] = m.order.PushBack(&memoEntry{key: key, at: now, pw: clonePreview(pw)})
	}
	for m.order.Len() > m.max {
		m.drop(m.order.Front())
	}
	for el := m.order.Front(); el != nil && now.Sub(el.Value.(*memoEntry).at) >= m.ttl; el = m.order.Front() {
		m.drop(el)
	}
}

func (m *previewMemo) drop(el *list.Element) {
	m.order.Remove(el)
	delete(m.entries, el.Value.(*memoEntry).key)
}

func (m *previewMemo) len() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.order.Len()
}

// clonePreview copies the lists, so no caller shares them with the memo.
func clonePreview(pw PreviewWatch) PreviewWatch {
	pw.Items = slices.Clone(pw.Items)
	pw.Candidates = slices.Clone(pw.Candidates)
	if pw.Value != nil {
		v := *pw.Value
		pw.Value = &v
	}
	if pw.Excerpt != nil {
		ex := *pw.Excerpt
		ex.Struck = slices.Clone(ex.Struck)
		pw.Excerpt = &ex
	}
	if pw.Health != nil {
		h := *pw.Health
		pw.Health = &h
	}
	return pw
}

// previewLimiter allows each person per reads in any window.
type previewLimiter struct {
	mu     sync.Mutex
	per    int
	window time.Duration
	reads  map[string][]time.Time
}

func newPreviewLimiter(per int, window time.Duration) *previewLimiter {
	return &previewLimiter{per: per, window: window, reads: map[string][]time.Time{}}
}

// take counts n reads for userID at now, all or none: false means they
// would go over the limit, and nothing is counted.
func (l *previewLimiter) take(userID string, n int, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	recent := l.recent(userID, now)
	if len(recent)+n > l.per {
		return false
	}
	for range n {
		recent = append(recent, now)
	}
	l.reads[userID] = recent
	if len(l.reads) > 1000 {
		for id := range l.reads {
			l.recent(id, now)
		}
	}
	return true
}

// recent drops userID's reads older than the window; under mu.
func (l *previewLimiter) recent(userID string, now time.Time) []time.Time {
	cut := now.Add(-l.window)
	kept := slices.DeleteFunc(l.reads[userID], func(t time.Time) bool { return !t.After(cut) })
	if len(kept) == 0 {
		delete(l.reads, userID)
		return nil
	}
	l.reads[userID] = kept
	return kept
}
