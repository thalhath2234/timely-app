package bots

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"net/url"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"timely-api/internal/features/bots/extract"
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
}

// Patch is an edit; nil fields are left as they are. Watches, when set, is
// the full list.
type Patch struct {
	Name            *string       `json:"name"`
	Description     *string       `json:"description"`
	IntervalMinutes *int          `json:"intervalMinutes"`
	JudgeMode       *string       `json:"judgeMode"`
	Urgent          *bool         `json:"urgent"`
	Desktop         *bool         `json:"desktop"`
	Phone           *bool         `json:"phone"`
	Watches         *[]WatchInput `json:"watches"`
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

func cleanDescription(raw string) (string, error) {
	d := strings.TrimSpace(strings.ReplaceAll(raw, "\x00", ""))
	if utf8.RuneCountInString(d) > MaxDescriptionLen {
		return "", invalid("Keep the description under %d characters", MaxDescriptionLen)
	}
	return d, nil
}

func cleanJudge(raw string) (string, error) {
	switch strings.TrimSpace(raw) {
	case "", JudgeRules:
		return JudgeRules, nil
	}
	return "", invalid("AI judging arrives in a later version")
}

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

// cleanWatches checks a full watch list. prev maps the Bot's current
// watches by ID (nil on create); a watch with an ID must be one of them.
func cleanWatches(in []WatchInput, prev map[string]Watch) ([]Watch, error) {
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
		w, err := cleanWatch(wi, old)
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
func cleanWatch(in WatchInput, old *Watch) (Watch, error) {
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
		if read != ReadText && read != ReadSelector && read != ReadProductPrice {
			return Watch{}, invalid("Read a page as text, selector or product_price")
		}
		w.ReadMode = read
		switch {
		case read == ReadSelector:
			if err := extract.ValidSelector(selector); err != nil {
				return Watch{}, invalid("%s", sentence(err.Error()))
			}
			w.Selector = selector
		case selector != "":
			return Watch{}, invalid("Only a page read with a selector takes a CSS selector")
		}
		if priceSet {
			return Watch{}, invalid("A page watch takes no price source, symbol or currency")
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
		if w.Source, w.Symbol, w.Currency, err = cleanPrice(in.Source, in.Symbol, in.Currency); err != nil {
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
// and checks the symbol and currency against it.
func cleanPrice(source, symbol, currency string) (string, string, string, error) {
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

// sameConfig reports whether two watches read the same thing the same way.
func sameConfig(a, b Watch) bool {
	return a.Kind == b.Kind && a.URL == b.URL && a.ReadMode == b.ReadMode && a.Selector == b.Selector &&
		a.Source == b.Source && a.Symbol == b.Symbol && a.Currency == b.Currency
}

// sentence capitalises a lower-case error from another package.
func sentence(s string) string {
	r, n := utf8.DecodeRuneInString(s)
	if n == 0 {
		return s
	}
	return fmt.Sprintf("%c%s", unicode.ToUpper(r), s[n:])
}
