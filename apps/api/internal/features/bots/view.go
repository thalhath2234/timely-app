package bots

import (
	"math"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"timely-api/internal/features/bots/extract"
	"timely-api/internal/features/bots/fetch"
	"timely-api/internal/features/bots/price"
)

// Health is a status code with a line written for the person.
type Health struct {
	Code string `json:"code"`
	Line string `json:"line"`
}

// View is a Bot as the clients see it.
type View struct {
	ID              string      `json:"id"`
	Name            string      `json:"name"`
	Description     string      `json:"description"`
	Status          string      `json:"status"`
	PauseReason     *string     `json:"pauseReason"`
	Origin          Origin      `json:"origin"`
	JudgeMode       string      `json:"judgeMode"`
	IntervalMinutes int         `json:"intervalMinutes"`
	Urgent          bool        `json:"urgent"`
	Desktop         bool        `json:"desktop"`
	Phone           bool        `json:"phone"`
	SnoozedUntil    *time.Time  `json:"snoozedUntil"`
	NextCheckAt     *time.Time  `json:"nextCheckAt"`
	LastCheckAt     *time.Time  `json:"lastCheckAt"`
	LastOkAt        *time.Time  `json:"lastOkAt"`
	Strikes         int         `json:"strikes"`
	Health          Health      `json:"health"`
	AlertsToday     int         `json:"alertsToday"`
	Watches         []WatchView `json:"watches"`
	CreatedAt       time.Time   `json:"createdAt"`
	UpdatedAt       time.Time   `json:"updatedAt"`
	// The board's fields.
	OriginClient string      `json:"originClient"` // "" unless origin is mcp
	Checking     bool        `json:"checking"`     // a check is running now
	RunNowAt     *time.Time  `json:"runNowAt"`     // the earliest Run now can check, when later than now
	FloorLine    string      `json:"floorLine"`    // "Shop prices are checked every 6 hours at most"
	Strip        string      `json:"strip"`        // the last checks, oldest first: one stripMark each
	LatestAlert  *AlertBrief `json:"latestAlert"`  // the newest alert of the last 30 days, held for a cap or not
	ItemsToday   int         `json:"itemsToday"`   // new feed items today's alerts told of, held included
}

// AlertBrief is the alert a board card shows.
type AlertBrief struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	URL       string    `json:"url"`
	Held      string    `json:"held"`
	CreatedAt time.Time `json:"createdAt"`
	Feedback  *string   `json:"feedback"` // useful, not_useful or nil
}

// ItemBrief is one feed item a watch read.
type ItemBrief struct {
	Title       string     `json:"title"`
	URL         string     `json:"url"`
	PublishedAt *time.Time `json:"publishedAt"`
}

// WatchView is one watch, with a short code-made summary of its last
// reading instead of the reading itself.
type WatchView struct {
	ID            string     `json:"id"`
	Kind          string     `json:"kind"`
	URL           string     `json:"url"`
	Read          string     `json:"read"`
	Selector      string     `json:"selector"`
	Source        string     `json:"source"`
	Symbol        string     `json:"symbol"`
	Currency      string     `json:"currency"`
	Rules         []Rule     `json:"rules"`
	Health        Health     `json:"health"`
	LastReadingAt *time.Time `json:"lastReadingAt"`
	Summary       string     `json:"summary"`
	// The board's fields.
	Site          string       `json:"site"`            // the page's registrable domain; "" for a price
	Title         string       `json:"title"`           // the page's own name, from its last reading
	Value         *float64     `json:"value"`           // the last price read
	Excerpt       string       `json:"excerpt"`         // a line of what it read, see excerpt
	LatestItem    *ItemBrief   `json:"latestItem"`      // feeds: the newest item
	Items         []ItemBrief  `json:"items,omitempty"` // Detail only: the newest 5 items
	LastChangedAt *time.Time   `json:"lastChangedAt"`   // the last check whose reading moved
	Spark         [][2]float64 `json:"spark"`           // prices: [unix seconds, price], the last 30 daily closes and the reading
	DayChangePct  *float64     `json:"dayChangePct"`    // prices: against the previous UTC day's close, else the day's open
}

// Detail is a View with the Bot's recent log, alerts and prices.
type Detail struct {
	View
	Checks      []CheckView    `json:"checks"`
	Alerts      []AlertView    `json:"alerts"`
	Prices      []PriceDayView `json:"prices"`
	Lessons     []Lesson       `json:"lessons"`
	Week        WeekCounts     `json:"week"`        // the last 7 days
	AlertsMonth int            `json:"alertsMonth"` // alerts of the last 30 days
	Rearms      []RearmView    `json:"rearms"`      // newest first: the last 30 days, at most 5
}

// RearmView is a below or above rule that armed again ("Armed again, no
// alert"), at the start of the check that saw it.
type RearmView struct {
	At       time.Time `json:"at"`
	WatchID  string    `json:"watchId"`
	RuleID   string    `json:"ruleId"`
	Value    float64   `json:"value"`
	Currency string    `json:"currency"`
}

// WeekCounts is how busy a Bot was in the last 7 days.
type WeekCounts struct {
	Checks int `json:"checks"`
	Alerts int `json:"alerts"`
}

type CheckView struct {
	ID        string      `json:"id"`
	Trigger   string      `json:"trigger"`
	StartedAt time.Time   `json:"startedAt"`
	Outcome   string      `json:"outcome"`
	ErrorKind string      `json:"errorKind"`
	Error     string      `json:"error"`
	Fired     []FiredRule `json:"fired"`
}

type AlertView struct {
	ID        string         `json:"id"`
	CheckID   *string        `json:"checkId"`
	Figures   map[string]any `json:"figures"` // only the keys in alertFigureKeys
	Kind      string         `json:"kind"`
	Held      string         `json:"held"`
	Title     string         `json:"title"`
	Body      string         `json:"body"`
	URL       string         `json:"url"`
	Urgent    bool           `json:"urgent"`
	MoreCount int            `json:"moreCount"`
	CreatedAt time.Time      `json:"createdAt"`
	// The person's rating, see Alert.
	Feedback       *string    `json:"feedback"`
	FeedbackReason string     `json:"feedbackReason"`
	FeedbackNote   string     `json:"feedbackNote"`
	FeedbackAt     *time.Time `json:"feedbackAt"`
}

type PriceDayView struct {
	WatchID  string       `json:"watchId"`
	Day      string       `json:"day"` // YYYY-MM-DD, UTC
	Currency string       `json:"currency"`
	Points   [][2]float64 `json:"points"`
	Open     *float64     `json:"open"`
	High     *float64     `json:"high"`
	Low      *float64     `json:"low"`
	Close    *float64     `json:"close"`
}

var healthLines = map[string]string{
	HealthNew: "Not checked yet",
	"working": "Working",
}

func healthOf(code, detail string) Health {
	if detail == "" {
		detail = healthLines[code]
	}
	return Health{Code: code, Line: detail}
}

// board is what the board shows beyond a Bot's own rows, loaded for many
// Bots at once (loadBoard). A nil board shows a Bot with no history.
type board struct {
	alertsToday map[string]int         // by Bot: sent alerts today
	itemsToday  map[string]int         // by Bot
	strips      map[string]string      // by Bot
	latest      map[string]*AlertBrief // by Bot
	days        map[string][]dayClose  // by watch, oldest first
}

// dayClose is one UTC day of a price series, without its points.
type dayClose struct {
	WatchID string
	Day     string // YYYY-MM-DD
	Open    *float64
	Close   *float64
}

func viewOf(b Bot, ws []Watch, bd *board, now time.Time) View {
	if bd == nil {
		bd = &board{}
	}
	floor := Floor(ws)
	v := View{
		ID: b.ID, Name: b.Name, Description: b.Description, Status: b.Status, PauseReason: b.PauseReason,
		Origin: b.Origin, JudgeMode: b.JudgeMode, IntervalMinutes: b.IntervalSeconds / 60,
		Urgent: b.Urgent, Desktop: b.NotifyDesktop, Phone: b.NotifyPhone,
		SnoozedUntil: b.SnoozedUntil, NextCheckAt: b.NextCheckAt, LastCheckAt: b.LastCheckAt, LastOkAt: b.LastOkAt,
		Strikes: b.Strikes, Health: healthOf(b.Health, b.HealthDetail), AlertsToday: bd.alertsToday[b.ID],
		Watches: make([]WatchView, 0, len(ws)), CreatedAt: b.CreatedAt, UpdatedAt: b.UpdatedAt,
		OriginClient: b.OriginClient, Checking: b.CheckingJobID != nil, FloorLine: floorLine(floor),
		Strip: bd.strips[b.ID], LatestAlert: bd.latest[b.ID], ItemsToday: bd.itemsToday[b.ID],
	}
	if b.Origin != OriginMCP {
		v.OriginClient = ""
	}
	if at := spacedAt(b.CheckStartedAt, floor); at.After(now) {
		v.RunNowAt = &at
	}
	for _, w := range ws {
		v.Watches = append(v.Watches, watchView(w, bd.days[w.ID]))
	}
	return v
}

func watchView(w Watch, days []dayClose) WatchView {
	rules := []Rule(w.Rules)
	if rules == nil {
		rules = []Rule{}
	}
	wv := WatchView{
		ID: w.ID, Kind: w.Kind, URL: w.URL, Read: w.ReadMode, Selector: w.Selector,
		Source: w.Source, Symbol: w.Symbol, Currency: w.Currency, Rules: rules,
		Health: healthOf(w.Health, w.HealthDetail), LastReadingAt: w.LastReadingAt, Summary: summary(w.LastReading),
		Site: watchSite(w), Excerpt: excerpt(w), LastChangedAt: w.LastChangedAt, Spark: [][2]float64{},
	}
	r := w.LastReading
	if r == nil {
		return wv
	}
	if w.Kind == WatchPage {
		wv.Title = r.Title
	}
	if w.Kind == WatchFeed {
		if items := newestItems(r.Items, 1); len(items) > 0 {
			wv.LatestItem = &items[0]
		}
	}
	if r.Kind == ReadingPrice && r.Price != nil {
		p := *r.Price
		wv.Value = &p
		wv.Spark = sparkOf(days, *r)
		wv.DayChangePct = dayChangePct(days, *r)
	}
	return wv
}

// watchSite is the registrable domain a page or feed watch reads, "" for a
// price.
func watchSite(w Watch) string {
	if w.Kind == WatchPrice {
		return ""
	}
	if u, err := url.Parse(w.URL); err == nil && u.Host != "" {
		return fetch.Site(u)
	}
	return ""
}

// watchTitle names a watch for a person: "amazon.in · Sony WH-1000XM6
// Wireless" from the page's own title, else "amazon.in · Product price";
// a coin is "BTC-USD · Coinbase" and a stock "NVDA · Finnhub" (a stock
// source quotes one currency, so it is left out). The clients' watchTitle
// (packages/contract/src/bots.ts) follows the same rule.
func watchTitle(w Watch) string {
	if w.Kind == WatchPrice {
		sym := w.Symbol
		if src, ok := price.Sources[w.Source]; w.Currency != "" && (!ok || src.Kind != "stock") {
			sym += "-" + w.Currency
		}
		return sym + " · " + siteOf(w)
	}
	site := watchSite(w)
	if site == "" {
		site = "The site"
	}
	if w.Kind == WatchPage && w.LastReading != nil && w.LastReading.Title != "" {
		return site + " · " + w.LastReading.Title
	}
	return site + " · " + watchKindLine(w)
}

// watchKindLine says what a watch reads, in a few words.
func watchKindLine(w Watch) string {
	switch {
	case w.Kind == WatchFeed:
		return "Feed"
	case w.Kind == WatchPrice:
		return "Price"
	case w.ReadMode == ReadProductPrice:
		return "Product price"
	case w.ReadMode == ReadSelectorPrice:
		return "One price on the page"
	case w.ReadMode == ReadSelector:
		return "One part of the page"
	}
	return "Page text"
}

// maxExcerpt bounds WatchView.Excerpt, in characters.
const maxExcerpt = 160

// excerpt is a line of what a watch last read, for the board: the text a
// selector picked, the line of a page holding the first word a words rule
// looks for, or a feed's newest item title. Prices and whole pages without
// a words rule have none.
func excerpt(w Watch) string {
	r := w.LastReading
	if r == nil {
		return ""
	}
	switch {
	case w.Kind == WatchFeed:
		if items := newestItems(r.Items, 1); len(items) > 0 {
			return clipRunes(strings.Join(strings.Fields(items[0].Title), " "), maxExcerpt)
		}
	case w.Kind == WatchPage && w.ReadMode == ReadSelector:
		return clipRunes(strings.Join(strings.Fields(r.Text), " "), maxExcerpt)
	case w.Kind == WatchPage && w.ReadMode == ReadText:
		for _, rule := range w.Rules {
			if (rule.Kind == RuleWordsAppear || rule.Kind == RuleWordsDisappear) && len(rule.Words) > 0 {
				return clipRunes(lineWith(r.Text, rule.Words[0]), maxExcerpt)
			}
		}
	}
	return ""
}

// newestItems is up to n feed items, newest first. Items without a date
// keep their feed order, after the dated ones.
func newestItems(items []extract.FeedItem, n int) []ItemBrief {
	sorted := make([]extract.FeedItem, len(items))
	copy(sorted, items)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Published.After(sorted[j].Published) })
	out := make([]ItemBrief, 0, min(n, len(sorted)))
	for _, it := range sorted[:min(n, len(sorted))] {
		// Restored readings never went through the feed parser, so the link
		// is vetted again before an app can open it.
		ib := ItemBrief{Title: it.Title, URL: extract.CleanLink(it.Link)}
		if !it.Published.IsZero() {
			at := it.Published.UTC()
			ib.PublishedAt = &at
		}
		out = append(out, ib)
	}
	return out
}

// sparkDays is how many daily closes a sparkline shows before the reading.
const sparkDays = 30

// sparkOf is a price watch's sparkline, oldest first: the closes of up to
// sparkDays UTC days before the reading's day, each at the day's last
// second, then the reading itself. days is oldest first.
func sparkOf(days []dayClose, r Reading) [][2]float64 {
	out := [][2]float64{}
	readDay := r.At.UTC().Format(dayLayout)
	var prior []dayClose
	for _, d := range days {
		if d.Day < readDay && d.Close != nil {
			prior = append(prior, d)
		}
	}
	if len(prior) > sparkDays {
		prior = prior[len(prior)-sparkDays:]
	}
	for _, d := range prior {
		t, err := time.Parse(dayLayout, d.Day)
		if err != nil {
			continue
		}
		out = append(out, [2]float64{float64(t.Add(24*time.Hour - time.Second).Unix()), *d.Close})
	}
	if r.Price != nil {
		out = append(out, [2]float64{float64(r.At.Unix()), *r.Price})
	}
	return out
}

// dayChangePct is how far the reading moved today, in percent: against the
// previous UTC day's close, else the reading day's open. nil without either.
func dayChangePct(days []dayClose, r Reading) *float64 {
	if r.Price == nil {
		return nil
	}
	at := r.At.UTC()
	today, yesterday := at.Format(dayLayout), at.AddDate(0, 0, -1).Format(dayLayout)
	var prevClose, open *float64
	for _, d := range days {
		switch d.Day {
		case yesterday:
			prevClose = d.Close
		case today:
			open = d.Open
		}
	}
	ref := prevClose
	if ref == nil {
		ref = open
	}
	if ref == nil || *ref == 0 || !finite(*ref) {
		return nil
	}
	pct := math.Round((*r.Price-*ref)/math.Abs(*ref)*100*100) / 100
	return &pct
}

// stripMark is one check on a board card's strip: n no change, c changed,
// f told you, x failed (a strike), o offline or waiting (no strike).
// Superseded checks are not shown (0).
func stripMark(outcome string) byte {
	switch outcome {
	case outBaseline, outUnchanged, outNotModified:
		return 'n'
	case outChanged:
		return 'c'
	case outFired:
		return 'f'
	case outStrike:
		return 'x'
	case outOffline, outRateLimited, outSiteBusy, outRobots:
		return 'o'
	}
	return 0
}

// stripOf turns outcomes, newest first, into a strip, oldest first.
func stripOf(newestFirst []string) string {
	b := make([]byte, 0, len(newestFirst))
	for i := len(newestFirst) - 1; i >= 0; i-- {
		if m := stripMark(newestFirst[i]); m != 0 {
			b = append(b, m)
		}
	}
	return string(b)
}

// alertFigureKeys are the figures an AlertView passes on.
var alertFigureKeys = []string{"rule", "price", "currency", "was", "threshold", "changePct", "items"}

func alertView(a Alert) AlertView {
	figures := map[string]any{}
	for _, k := range alertFigureKeys {
		if v, ok := a.Figures[k]; ok {
			figures[k] = v
		}
	}
	return AlertView{ID: a.ID, CheckID: a.CheckID, Figures: figures, Kind: a.Kind, Held: a.Held, Title: a.Title, Body: a.Body,
		URL: a.URL, Urgent: a.Urgent, MoreCount: a.MoreCount, CreatedAt: a.CreatedAt,
		Feedback: a.Feedback, FeedbackReason: a.FeedbackReason, FeedbackNote: a.FeedbackNote, FeedbackAt: a.FeedbackAt}
}

// summary is a short line about a reading: "₹27,499", "12 items" or
// "Text, 4,210 characters".
func summary(r *Reading) string {
	switch {
	case r == nil:
		return ""
	case r.Kind == ReadingPrice && r.Price != nil:
		return formatMoney(*r.Price, r.Currency)
	case r.Kind == ReadingFeed:
		if len(r.Items) == 1 {
			return "1 item"
		}
		return group(strconv.Itoa(len(r.Items))) + " items"
	case r.Kind == ReadingText:
		return "Text, " + group(strconv.Itoa(utf8.RuneCountInString(r.Text))) + " characters"
	}
	return ""
}

var moneySymbols = map[string]string{"USD": "$", "EUR": "€", "GBP": "£", "INR": "₹", "JPY": "¥"}

// formatMoney writes a price for a person: a symbol for USD, EUR, GBP, INR
// and JPY ("₹27,499", "$187.20"), else "1,234.50 CHF". Whole amounts drop
// their decimals; JPY never has any, and tiny crypto prices keep enough.
func formatMoney(v float64, currency string) string {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return ""
	}
	decimals := 2
	switch a := math.Abs(v); {
	case currency == "JPY":
		decimals = 0
	case a != 0 && a < 1:
		decimals = min(8, max(2, int(math.Ceil(-math.Log10(a)))+3))
	case a == math.Trunc(a):
		decimals = 0
	}
	s := strconv.FormatFloat(math.Abs(v), 'f', decimals, 64)
	if decimals > 2 {
		s = strings.TrimRight(s, "0")
	}
	whole, frac, _ := strings.Cut(s, ".")
	s = group(whole)
	if frac != "" {
		s += "." + frac
	}
	sign := ""
	if v < 0 {
		sign = "-"
	}
	if sym, ok := moneySymbols[currency]; ok {
		return sign + sym + s
	}
	if currency == "" {
		return sign + s
	}
	return sign + s + " " + currency
}

// group puts commas between thousands in a string of digits.
func group(digits string) string {
	if len(digits) <= 3 {
		return digits
	}
	var b strings.Builder
	head := len(digits) % 3
	if head > 0 {
		b.WriteString(digits[:head])
	}
	for i := head; i < len(digits); i += 3 {
		if b.Len() > 0 {
			b.WriteByte(',')
		}
		b.WriteString(digits[i : i+3])
	}
	return b.String()
}

// maxRearms is how many re-arms a Detail shows.
const maxRearms = 5

// rearmsOf flattens checks, newest first, into at most maxRearms re-arms.
// A check's own list keeps its rules' order.
func rearmsOf(checks []Check) []RearmView {
	out := []RearmView{}
	for _, c := range checks {
		for _, r := range c.Rearmed {
			if len(out) == maxRearms {
				return out
			}
			out = append(out, RearmView{At: c.StartedAt, WatchID: r.WatchID, RuleID: r.RuleID, Value: r.Value, Currency: r.Currency})
		}
	}
	return out
}
