package bots

import (
	"net/url"
	"strings"

	"timely-api/internal/features/bots/extract"
)

// A thing is one product, ticker or link, keyed so that two Bots watching it
// agree on the key: one alert per thing a day (G4), and what a note is about.

// thingKeyWatch is the thing a watch reads: "price:coinbase:BTC:USD" for a
// price, its quote currency last when the source takes one (BTC in USD and
// in USDC are two things), and "page:" and the normalised address for a
// page or feed.
func thingKeyWatch(w Watch) string {
	if w.Kind == WatchPrice {
		key := "price:" + strings.ToLower(w.Source) + ":" + strings.ToUpper(w.Symbol)
		if cur := strings.ToUpper(strings.TrimSpace(w.Currency)); cur != "" {
			key += ":" + cur
		}
		return key
	}
	return "page:" + normURL(w.URL)
}

// thingKeyItem is the thing a feed item is about: its own link when it is a
// public web address, else the item within its feed.
func thingKeyItem(it extract.FeedItem, w Watch) string {
	if link, err := cleanURL(it.Link, "item"); err == nil {
		return "link:" + normURL(link)
	}
	return "item:" + normURL(w.URL) + "#" + it.ID
}

// trackingKeys are query keys that say where a visitor came from, not what
// the page is.
var trackingKeys = map[string]bool{"ref": true, "fbclid": true, "gclid": true, "tag": true}

// normURL writes an address the same way however it was linked: scheme and
// host in lower case, no "www.", no fragment, no tracking keys, the other
// query keys sorted, and no trailing "/" on a path other than the root.
func normURL(raw string) string {
	s := strings.TrimSpace(raw)
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return s
	}
	u.Scheme = strings.ToLower(u.Scheme)
	u.Host = strings.TrimPrefix(strings.ToLower(u.Host), "www.")
	u.Fragment, u.RawFragment = "", ""
	q := u.Query()
	for k := range q {
		if lk := strings.ToLower(k); trackingKeys[lk] || strings.HasPrefix(lk, "utm_") {
			q.Del(k)
		}
	}
	u.RawQuery = q.Encode() // sorted by key
	u.ForceQuery = false
	switch {
	case u.Path == "":
		u.Path, u.RawPath = "/", ""
	case len(u.Path) > 1 && strings.HasSuffix(u.Path, "/"):
		u.Path = strings.TrimRight(u.Path, "/")
		u.RawPath = strings.TrimRight(u.RawPath, "/")
		if u.Path == "" {
			u.Path, u.RawPath = "/", ""
		}
	}
	return u.String()
}

// thingsOf lists the things a check's alert tells of, one entry per key:
// each new item of a feed rule, else the watch, with the price it read.
func thingsOf(fired []firedEvent, urgency string) []Thing {
	out := []Thing{}
	seen := map[string]bool{}
	add := func(key string, value *float64) {
		if key == "" || seen[key] {
			return
		}
		seen[key] = true
		out = append(out, Thing{Key: key, Value: value, Urgency: urgency})
	}
	for _, f := range fired {
		if f.rule.Kind == RuleNewItem {
			for _, it := range f.ev.NewItems {
				add(thingKeyItem(it, f.w), nil)
			}
			continue
		}
		var value *float64
		if v, ok := f.ev.After.value(); ok {
			value = &v
		}
		add(thingKeyWatch(f.w), value)
	}
	return out
}

// urgencyRank orders urgencies: low 0, normal 1, high 2.
func urgencyRank(u string) int {
	switch u {
	case UrgencyLow:
		return 0
	case UrgencyHigh:
		return 2
	}
	return 1
}

// sharedMove is the move after which a later alert on a thing gets through.
const sharedMove = 0.05

// joins reports whether a later alert's thing is already told of by an
// earlier one: it has moved less than 5% since and is no more urgent.
func joins(cur, old Thing) bool {
	if cur.Value != nil && old.Value != nil && *old.Value != 0 {
		d := (*cur.Value - *old.Value) / *old.Value
		if d < 0 {
			d = -d
		}
		if d >= sharedMove {
			return false
		}
	}
	return urgencyRank(cur.Urgency) <= urgencyRank(old.Urgency)
}
