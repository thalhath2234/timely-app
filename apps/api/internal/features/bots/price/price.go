// Package price reads one quote for a price watch from a fixed registry of
// public JSON sources. Every source goes through the bot fetcher, so
// robots.txt is honoured for each one (ADR 0021): today Yahoo and CoinGecko
// answer ErrRobots, Coinbase serves crypto, and Finnhub serves stocks with a
// free per-account key. Keys cannot be saved yet (branch 3), so watches on a
// keyed source are refused when they are saved.
package price

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"timely-api/internal/features/bots/fetch"
)

// Quote is one price reading.
type Quote struct {
	Price    float64
	Currency string // ISO 4217, upper case
	// At is the source's own quote time, or the fetch time when it gives
	// none. Two reads with the same At are the same quote.
	At         time.Time
	MarketOpen bool
	NextOpen   time.Time // set only when the market is closed and the source knows its hours
}

// Source is one registry entry. Adding a source needs no migration.
type Source struct {
	Name, Label string
	Kind        string // stock or crypto
	// IgnoreRobots skips robots.txt. It is false for every source (the
	// owner's decision of 2026-11-06); flipping it is the only way a price
	// read may skip robots.txt.
	IgnoreRobots bool
	Symbol       *regexp.Regexp // checked after the case is folded
	LowerSymbol  bool           // the source's symbols are lower case (CoinGecko ids)
	SymbolHint   string         // completes "Use …" in the error for a bad symbol
	// Currency checks the watch's currency. Nil means the reply names it, so
	// a watch leaves it empty.
	Currency        *regexp.Regexp
	DefaultCurrency string
	// KeyHeader, when set, is the request header that carries the person's
	// API key for this source. With no key saved, Get fetches nothing.
	KeyHeader string
	URL       func(symbol, currency string) string
	// Parse reads a 2xx body. An error that wraps fetch.ErrNotFound means
	// the symbol is unknown; any other error means the reply's shape changed.
	Parse func(body []byte, symbol, currency string, now time.Time) (Quote, error)
}

// Sources is the registry, keyed by Source.Name.
var Sources = map[string]Source{
	"yahoo":     yahoo,
	"finnhub":   finnhub,
	"coingecko": coingecko,
	"coinbase":  coinbase,
}

// Default names the source a new watch of each kind uses.
var Default = map[string]string{
	"stock":  "finnhub",
	"crypto": "coinbase",
}

// Names lists the registry's source names in order.
func Names() []string {
	names := make([]string, 0, len(Sources))
	for name := range Sources {
		names = append(names, name)
	}
	slices.Sort(names)
	return names
}

// Check cleans a watch's symbol and currency for s. Its errors are
// sentences for the person.
func (s Source) Check(symbol, currency string) (string, string, error) {
	sym := strings.TrimSpace(symbol)
	if s.LowerSymbol {
		sym = strings.ToLower(sym)
	} else {
		sym = strings.ToUpper(sym)
	}
	if !s.Symbol.MatchString(sym) {
		return "", "", fmt.Errorf("%q is not a %s symbol. Use %s", strings.TrimSpace(symbol), s.Label, s.SymbolHint)
	}
	if s.Currency == nil {
		return sym, "", nil
	}
	cur := strings.ToUpper(strings.TrimSpace(currency))
	if cur == "" {
		cur = s.DefaultCurrency
	}
	if !s.Currency.MatchString(cur) {
		return "", "", fmt.Errorf("%s does not quote prices in %q", s.Label, strings.TrimSpace(currency))
	}
	return sym, cur, nil
}

// SourceGoneError means the source's reply no longer has the expected shape,
// or the source left the registry. It deliberately does not unwrap, so a
// classifier never mistakes it for the fetch error behind it.
type SourceGoneError struct {
	Source string
	Err    error
}

func (e *SourceGoneError) Error() string {
	msg := label(e.Source) + " changed how it answers, or stopped answering"
	if e.Err != nil {
		msg += ": " + e.Err.Error()
	}
	return msg
}

// KeyError means a source that needs the person's API key has none saved
// (Rejected false) or refused the saved one (Rejected true).
type KeyError struct {
	Source   string
	Rejected bool
}

func (e *KeyError) Error() string {
	if e.Rejected {
		return label(e.Source) + " did not accept the saved API key"
	}
	return label(e.Source) + " needs a free API key before Timely can read its prices"
}

// Keys finds the API key a person saved for a source, or "" when there is
// none. Its errors are infrastructure errors.
type Keys interface {
	SourceKey(ctx context.Context, userID, source string) (string, error)
}

// Query names one price to read. UserID picks whose key a keyed source uses.
type Query struct {
	UserID, Source, Symbol, Currency string
}

// Get reads one quote. Besides the fetcher's own errors it returns
// *SourceGoneError, *KeyError, an error wrapping fetch.ErrNotFound for an
// unknown symbol, or an error from keys. keys may be nil (no keys saved).
func Get(ctx context.Context, f *fetch.Fetcher, keys Keys, q Query, now time.Time) (Quote, error) {
	src, ok := Sources[q.Source]
	if !ok {
		return Quote{}, &SourceGoneError{Source: q.Source, Err: errors.New("Timely no longer reads this source")}
	}
	sym, cur, err := src.Check(q.Symbol, q.Currency)
	if err != nil {
		return Quote{}, fmt.Errorf("%w: %v", fetch.ErrNotFound, err)
	}
	var header http.Header
	if src.KeyHeader != "" {
		key := ""
		if keys != nil {
			if key, err = keys.SourceKey(ctx, q.UserID, src.Name); err != nil {
				return Quote{}, fmt.Errorf("price key for %s: %w", src.Name, err)
			}
		}
		if key = strings.TrimSpace(key); key == "" {
			return Quote{}, &KeyError{Source: src.Name}
		}
		header = http.Header{src.KeyHeader: {key}}
	}
	res, err := f.Get(ctx, fetch.Request{URL: src.URL(sym, cur), Want: fetch.WantJSON, IgnoreRobots: src.IgnoreRobots, Header: header})
	if err != nil {
		return Quote{}, src.sortErr(err, sym)
	}
	quote, err := src.Parse(res.Body, sym, cur, now)
	switch {
	case errors.Is(err, fetch.ErrNotFound):
		return Quote{}, err
	case err != nil:
		return Quote{}, &SourceGoneError{Source: src.Name, Err: err}
	case quote.Price <= 0 || math.IsNaN(quote.Price) || math.IsInf(quote.Price, 0) || quote.Currency == "":
		return Quote{}, &SourceGoneError{Source: src.Name, Err: errors.New("the reply has no usable price")}
	}
	return quote, nil
}

// sortErr turns the fetch errors a JSON source can give into price errors.
func (s Source) sortErr(err error, sym string) error {
	var status *fetch.StatusError
	switch {
	case errors.Is(err, fetch.ErrUnsupported):
		// HTML or something else where JSON should be.
		return &SourceGoneError{Source: s.Name, Err: err}
	case errors.Is(err, fetch.ErrNotFound):
		return notFound(s.Label, sym)
	case s.KeyHeader != "" && errors.As(err, &status) && status.Status == http.StatusUnauthorized:
		return &KeyError{Source: s.Name, Rejected: true}
	}
	return err
}

func notFound(source, what string) error {
	return fmt.Errorf("%w: %s has no price for %s", fetch.ErrNotFound, source, what)
}

func label(name string) string {
	if s, ok := Sources[name]; ok {
		return s.Label
	}
	if name == "" {
		return "The price source"
	}
	return name
}
