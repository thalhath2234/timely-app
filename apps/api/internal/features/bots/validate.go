package bots

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"timely-api/internal/features/bots/extract"
	"timely-api/internal/features/bots/fetch"
	"timely-api/internal/features/bots/price"
	"timely-api/internal/netguard"
	"timely-api/internal/utils"
)

const (
	maxInterval = 7 * 24 * time.Hour // the bots CHECK allows 604800 s
	maxSnooze   = 30 * 24 * time.Hour
)

// WatchInput is one watch as a client sends it. On an edit, a watch that
// keeps its ID keeps its readings; Rules left out (nil) keeps its rules.
type WatchInput struct {
	ID       string `json:"id,omitempty"`
	Kind     string `json:"kind"`
	URL      string `json:"url,omitempty"`
	Read     string `json:"read,omitempty"`
	Selector string `json:"selector,omitempty"`
	Source   string `json:"source,omitempty"`
	Symbol   string `json:"symbol,omitempty"`
	Currency string `json:"currency,omitempty"`
	Rules    []Rule `json:"rules,omitempty"`
}

// Input is a new Bot. IntervalMinutes 0 means DefaultInterval.
type Input struct {
	Name            string       `json:"name"`
	Description     string       `json:"description"`
	IntervalMinutes int          `json:"intervalMinutes"`
	JudgeMode       string       `json:"judgeMode"`
	Urgent          *bool        `json:"urgent"`
	Desktop         *bool        `json:"desktop"`
	Phone           *bool        `json:"phone"`
	Watches         []WatchInput `json:"watches"`
	// Knowledge is the doc or sheet the Bot's judge reads, or nil for none.
	Knowledge *KnowledgeInput `json:"knowledge"`
	// PassesTo is the full list of Bots this one passes what it finds to
	// (Pass to), or nil for none.
	PassesTo *[]LinkInput `json:"passesTo"`
	// Kind is "watch" (the default) or "brief". A brief takes no watches:
	// Sources (1 to MaxBriefSources watch Bots, ids or names) are the Bots
	// it sums up, BriefTime ("08:00") when, and BriefAI "Write it with AI".
	Kind      string    `json:"kind"`
	Sources   *[]string `json:"sources"`
	BriefTime *string   `json:"briefTime"`
	BriefAI   *bool     `json:"briefAi"`
	// BriefOnly: a watch Bot alerts only through the briefs it is in.
	BriefOnly *bool `json:"briefOnly"`
	// OriginClient names the outside app a Bot made over MCP came from: the
	// name the person gave its API key. It is kept only for OriginMCP and
	// never read from a request body.
	OriginClient string `json:"-"`
}

// Patch is an edit; nil fields are left as they are. Watches, when set, is
// the full list. Knowledge sets the doc or sheet the judge reads, and
// ClearKnowledge (a PATCH's "knowledge": null, see KnowledgePatch) clears it.
type Patch struct {
	Name            *string         `json:"name"`
	Description     *string         `json:"description"`
	IntervalMinutes *int            `json:"intervalMinutes"`
	JudgeMode       *string         `json:"judgeMode"`
	Urgent          *bool           `json:"urgent"`
	Desktop         *bool           `json:"desktop"`
	Phone           *bool           `json:"phone"`
	Watches         *[]WatchInput   `json:"watches"`
	Knowledge       *KnowledgeInput `json:"knowledge"`
	ClearKnowledge  bool            `json:"-"`
	// PassesTo, when set, is the full list of Pass to links; [] removes
	// them all.
	PassesTo *[]LinkInput `json:"passesTo"`
	// Kind cannot change; it is read only to refuse a different one.
	// Sources, when set, is a brief's full list.
	Kind      *string   `json:"kind"`
	Sources   *[]string `json:"sources"`
	BriefTime *string   `json:"briefTime"`
	BriefAI   *bool     `json:"briefAi"`
	BriefOnly *bool     `json:"briefOnly"`
}

// LinkInput is one Pass to link as a client sends it: the Bot to pass to
// (an id or a name), the words a note must hold (any one; none passes
// every note) and, optionally, whether it is on. A link to a Bot already
// linked keeps its id, and stays on or off unless Enabled is given.
type LinkInput struct {
	ID      string   `json:"id,omitempty"`
	BotID   string   `json:"botId"`
	Filter  []string `json:"filter"`
	Enabled *bool    `json:"enabled,omitempty"`
}

func cleanName(raw string) (string, error) {
	name := strings.Join(strings.Fields(strings.ReplaceAll(raw, "\x00", "")), " ")
	switch {
	case name == "":
		return "", invalid("Give the bot a name")
	case utf8.RuneCountInString(name) > MaxNameLen:
		return "", invalid("Keep the bot's name under %d characters", MaxNameLen)
	}
	return name, nil
}

// maxOriginClient bounds bots.origin_client, in characters.
const maxOriginClient = 60

// cleanOriginClient keeps an outside app's name printable, clipped to
// maxOriginClient characters (cleanLine).
func cleanOriginClient(raw string) string { return cleanLine(raw, maxOriginClient) }

// cleanLine makes a line someone typed safe to keep and show: control and
// format characters are dropped, spaces collapsed, and it is clipped to limit
// characters.
func cleanLine(raw string, limit int) string {
	s := strings.Map(func(r rune) rune {
		switch {
		case unicode.IsSpace(r):
			return ' '
		case r == utf8.RuneError || unicode.IsControl(r) || unicode.Is(unicode.Cf, r):
			return -1
		}
		return r
	}, raw)
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > limit {
		s = strings.TrimSpace(string(r[:limit]))
	}
	return s
}

func cleanDescription(raw string) (string, error) {
	d := strings.TrimSpace(strings.ReplaceAll(raw, "\x00", ""))
	if utf8.RuneCountInString(d) > MaxDescriptionLen {
		return "", invalid("Keep the description under %d characters", MaxDescriptionLen)
	}
	return d, nil
}

// briefTimeRe is a brief's time of day, "HH:MM" (bots_brief_check).
var briefTimeRe = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)

// cleanBriefTime checks a brief's time; nil or blank is DefaultBriefTime.
func cleanBriefTime(raw *string) (string, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return DefaultBriefTime, nil
	}
	t := strings.TrimSpace(*raw)
	if !briefTimeRe.MatchString(t) {
		return "", invalid("Give the brief a time like 08:00")
	}
	return t, nil
}

// cleanKind reads a new Bot's kind: "" or "watch", or "brief".
func cleanKind(raw string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", KindWatch:
		return KindWatch, nil
	case KindBrief:
		return KindBrief, nil
	}
	return "", invalid("A bot watches something or is a brief")
}

func cleanJudge(raw string) (string, error) {
	switch strings.TrimSpace(raw) {
	case "", JudgeRules:
		return JudgeRules, nil
	case JudgeAI:
		return JudgeAI, nil
	}
	return "", invalid("Pick Rules only or AI judges")
}

// errMCPJudged refuses an outside app's edit of what an AI judge obeys: an
// AI-judged Bot's name and description are the person's instruction to it.
var errMCPJudged = invalid("Change an AI-judged bot's name or description in Timely")

// refuseMCPSettings keeps alert settings in Timely: an outside app cannot make
// a Bot urgent, choose where it alerts or how it judges.
func refuseMCPSettings(o Origin, judge *string, flags ...*bool) error {
	if o != OriginMCP {
		return nil
	}
	set := judge != nil && strings.TrimSpace(*judge) != ""
	for _, f := range flags {
		set = set || f != nil
	}
	if set {
		return invalid("Urgent, desktop, phone and judging settings are made in Timely")
	}
	return nil
}

// hasKeyFunc reports whether the person has a working key saved for a keyed
// price source (keySet). Nil means none.
type hasKeyFunc func(source string) bool

// cleanWatches checks a full watch list. prev maps the Bot's current
// watches by ID (nil on create); a watch with an ID must be one of them.
func cleanWatches(in []WatchInput, prev map[string]Watch, hasKey hasKeyFunc) ([]Watch, error) {
	if len(in) == 0 {
		return nil, invalid("Give the bot something to watch: a page, a feed or a price")
	}
	if len(in) > MaxWatches {
		return nil, invalid("A bot can watch up to %d things", MaxWatches)
	}
	out := make([]Watch, 0, len(in))
	seen := map[string]bool{}
	for i, wi := range in {
		var old *Watch
		if id := strings.TrimSpace(wi.ID); id != "" {
			w, ok := prev[id]
			if !ok || seen[id] {
				return nil, watchErr(len(in), i, invalid("This watch is not on the bot. Leave out the id to add a new one"))
			}
			seen[id] = true
			old = &w
		}
		w, err := cleanWatch(wi, old, hasKey)
		if err != nil {
			return nil, watchErr(len(in), i, err)
		}
		w.Position = i
		out = append(out, w)
	}
	return out, nil
}

// watchErr names the watch when there are several.
func watchErr(n, i int, err error) error {
	var in *InputError
	if n > 1 && errors.As(err, &in) {
		return invalid("Watch %d: %s", i+1, in.Message)
	}
	return err
}

// cleanWatch checks one watch and returns its config and rules. Rule IDs are
// not set here (see ruleIDs). old is the watch being edited, if any.
func cleanWatch(in WatchInput, old *Watch, hasKey hasKeyFunc) (Watch, error) {
	w := Watch{Kind: strings.ToLower(strings.TrimSpace(in.Kind))}
	if old != nil {
		w.ID = old.ID
	}
	read := strings.ToLower(strings.TrimSpace(in.Read))
	selector := strings.TrimSpace(in.Selector)
	priceSet := strings.TrimSpace(in.Source) != "" || strings.TrimSpace(in.Symbol) != "" || strings.TrimSpace(in.Currency) != ""
	var err error
	switch w.Kind {
	case WatchPage:
		if w.URL, err = cleanURL(in.URL, "page"); err != nil {
			return Watch{}, err
		}
		if read == "" {
			read = ReadText
		}
		if read != ReadText && read != ReadSelector && read != ReadProductPrice && read != ReadSelectorPrice {
			return Watch{}, invalid("Read a page as text, selector, product_price or selector_price")
		}
		w.ReadMode = read
		switch {
		case read == ReadSelector || read == ReadSelectorPrice:
			if err := extract.ValidSelector(selector); err != nil {
				return Watch{}, invalid("%s", sentence(err.Error()))
			}
			w.Selector = selector
		case selector != "":
			return Watch{}, invalid("Only a page read with a selector takes a CSS selector")
		}
		switch {
		case strings.TrimSpace(in.Source) != "" || strings.TrimSpace(in.Symbol) != "":
			return Watch{}, invalid("A page watch takes no price source or symbol")
		case strings.TrimSpace(in.Currency) != "" && read != ReadProductPrice && read != ReadSelectorPrice:
			return Watch{}, invalid("A page watch takes no currency")
		}
		// A page's price comes with the currency the page shows. Until the
		// first read the watch keeps a hint: a known code sent along, else
		// the site's country. Checks never change it.
		if read == ReadProductPrice || read == ReadSelectorPrice {
			w.Currency = pageCurrency(in.Currency, w.URL, old)
		}
	case WatchFeed:
		if w.URL, err = cleanURL(in.URL, "feed"); err != nil {
			return Watch{}, err
		}
		if read != "" || selector != "" {
			return Watch{}, invalid("A feed is read whole; it takes no read mode or selector")
		}
		if priceSet {
			return Watch{}, invalid("A feed watch takes no price source, symbol or currency")
		}
	case WatchPrice:
		if strings.TrimSpace(in.URL) != "" || read != "" || selector != "" {
			return Watch{}, invalid("A price watch takes a source and a symbol, not a web address")
		}
		if w.Source, w.Symbol, w.Currency, err = cleanPrice(in.Source, in.Symbol, in.Currency, hasKey); err != nil {
			return Watch{}, err
		}
	default:
		return Watch{}, invalid("A watch is a page, a feed or a price")
	}

	if in.Rules == nil && old != nil && ReadingKind(old.Kind, old.ReadMode) == ReadingKind(w.Kind, w.ReadMode) {
		w.Rules = append(jsonList[Rule]{}, old.Rules...)
		return w, nil
	}
	rules, err := CleanRules(w.Kind, w.ReadMode, in.Rules)
	if err != nil {
		return Watch{}, err
	}
	w.Rules = rules
	return w, nil
}

// cleanURL checks a watched address without looking it up, so a Bot can be
// made offline. The fetcher checks every address it dials again.
func cleanURL(raw, what string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", invalid("Give the %s's web address", what)
	}
	if len(s) > MaxURLLen {
		return "", invalid("Keep the web address under %d characters", MaxURLLen)
	}
	u, err := url.Parse(s)
	if err != nil {
		return "", invalid("%q is not a web address", utils.ClipUTF8(s, 100))
	}
	if err := netguard.CheckURL(u); err != nil {
		if errors.Is(err, netguard.ErrBlocked) {
			return "", invalid("Timely only reads public web addresses on ports 80 and 443")
		}
		return "", invalid("%s", sentence(err.Error()))
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if ip, err := netip.ParseAddr(host); (err == nil && !netguard.PublicAddr(ip)) || host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return "", invalid("Timely only reads public web addresses")
	}
	return s, nil
}

// cleanPrice resolves the source ("stock" and "crypto" pick price.Default)
// and checks the symbol and currency against it. A source that needs the
// person's API key is refused until they save one: every check would
// otherwise be a needs_key strike, and the Bot would pause after 5.
func cleanPrice(source, symbol, currency string, hasKey hasKeyFunc) (string, string, string, error) {
	name := strings.ToLower(strings.TrimSpace(source))
	if d, ok := price.Default[name]; ok {
		name = d
	}
	if name == "" {
		return "", "", "", invalid("Say where the price comes from: stock, crypto, or one of %s", strings.Join(price.Names(), ", "))
	}
	src, ok := price.Sources[name]
	if !ok {
		return "", "", "", invalid("%q is not a price source. Use stock, crypto, or one of %s", utils.ClipUTF8(strings.TrimSpace(source), 40), strings.Join(price.Names(), ", "))
	}
	if strings.TrimSpace(symbol) == "" {
		return "", "", "", invalid("Give the price watch a symbol. Use %s", src.SymbolHint)
	}
	sym, cur, err := src.Check(symbol, currency)
	if err != nil {
		return "", "", "", invalid("%s", err.Error())
	}
	if src.KeyHeader != "" && (hasKey == nil || !hasKey(src.Name)) {
		return "", "", "", invalid("%s", needsKeyLine(src))
	}
	return name, sym, cur, nil
}

// cleanInterval turns minutes into seconds: 0 is DefaultInterval, and
// anything else must be between Floor and a week.
func cleanInterval(minutes int, ws []Watch) (int, error) {
	if minutes == 0 {
		return int(DefaultInterval(ws) / time.Second), nil
	}
	d := time.Duration(minutes) * time.Minute
	switch floor := Floor(ws); {
	case minutes < 0:
		return 0, invalid("Give the interval in minutes")
	case d < floor:
		return 0, invalid("%s", floorLine(floor))
	case d > maxInterval:
		return 0, invalid("Check at least once a week (%d minutes)", int(maxInterval/time.Minute))
	}
	return int(d / time.Second), nil
}

// floorLine says why an interval is too short.
func floorLine(floor time.Duration) string {
	switch {
	case floor >= MinProductEvery:
		return "Shop prices are checked every 6 hours at most"
	case floor >= MinPageEvery:
		return "Pages and feeds are checked every 15 minutes at most"
	}
	return "Prices are checked every 5 minutes at most"
}

// ruleIDs gives each rule an ID, keeping the ones in keep.
func ruleIDs(rules []Rule, keep jsonList[Rule]) jsonList[Rule] {
	known := map[string]bool{}
	for _, r := range keep {
		known[r.ID] = true
	}
	out := make(jsonList[Rule], len(rules))
	for i, r := range rules {
		if r.ID == "" || !known[r.ID] {
			r.ID = utils.PrefixedUUID("brl")
		}
		known[r.ID] = false // a repeated ID gets a new one
		out[i] = r
	}
	return out
}

// sameRules compares rules without their IDs.
func sameRules(a, b []Rule) bool {
	strip := func(rs []Rule) string {
		cp := make([]Rule, len(rs))
		for i, r := range rs {
			r.ID = ""
			cp[i] = r
		}
		raw, _ := json.Marshal(cp)
		return string(raw)
	}
	return len(a) == len(b) && strip(a) == strip(b)
}

// sameConfig reports two watches reading the same thing. A page's currency
// is only a hint (pageCurrency), so it never makes a page watch new.
func sameConfig(a, b Watch) bool {
	return a.Kind == b.Kind && a.URL == b.URL && a.ReadMode == b.ReadMode && a.Selector == b.Selector &&
		a.Source == b.Source && a.Symbol == b.Symbol && (a.Kind != WatchPrice || a.Currency == b.Currency)
}

// hintCurrencies are the codes a page price watch keeps as its currency
// hint when one is sent along.
var hintCurrencies = map[string]bool{
	"USD": true, "EUR": true, "GBP": true, "INR": true, "JPY": true, "CAD": true, "AUD": true, "CHF": true, "SEK": true, "NOK": true,
	"DKK": true, "PLN": true, "BRL": true, "MXN": true, "SGD": true, "NZD": true, "ZAR": true, "LKR": true, "AED": true, "HKD": true,
}

// siteCurrencies map a site's country domain to its currency, most
// specific first.
var siteCurrencies = []struct{ suffix, currency string }{
	{"in", "INR"}, {"co.uk", "GBP"}, {"uk", "GBP"},
	{"de", "EUR"}, {"fr", "EUR"}, {"it", "EUR"}, {"es", "EUR"}, {"nl", "EUR"}, {"ie", "EUR"}, {"at", "EUR"}, {"be", "EUR"}, {"fi", "EUR"}, {"pt", "EUR"},
	{"jp", "JPY"}, {"ca", "CAD"}, {"com.au", "AUD"}, {"au", "AUD"}, {"ch", "CHF"}, {"se", "SEK"}, {"no", "NOK"}, {"dk", "DKK"}, {"pl", "PLN"},
	{"com.br", "BRL"}, {"com.mx", "MXN"}, {"mx", "MXN"}, {"sg", "SGD"}, {"nz", "NZD"}, {"za", "ZAR"}, {"lk", "LKR"}, {"ae", "AED"},
}

// siteCurrency is the currency of a page's country domain, "" when the
// domain names no country this knows.
func siteCurrency(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	site := fetch.Site(u)
	for _, c := range siteCurrencies {
		if strings.HasSuffix(site, "."+c.suffix) {
			return c.currency
		}
	}
	return ""
}

// pageCurrency is a page price watch's currency hint, shown before its first
// read: a known code sent along; else, on an edit that keeps the address, the
// hint it had; else the site's country; else, on an edit that moves the
// address, the hint it had; else none.
func pageCurrency(sent, pageURL string, old *Watch) string {
	if c := strings.ToUpper(strings.TrimSpace(sent)); hintCurrencies[c] {
		return c
	}
	prev := ""
	if old != nil && old.Kind == WatchPage {
		prev = old.Currency
	}
	if prev != "" && old.URL == pageURL {
		return prev
	}
	if c := siteCurrency(pageURL); c != "" {
		return c
	}
	return prev
}

// sentence capitalises a lower-case error from another package.
func sentence(s string) string {
	r, n := utf8.DecodeRuneInString(s)
	if n == 0 {
		return s
	}
	return fmt.Sprintf("%c%s", unicode.ToUpper(r), s[n:])
}
