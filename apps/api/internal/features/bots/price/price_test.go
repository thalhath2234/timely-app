package price

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
	_ "time/tzdata" // exchange zones on hosts without a zoneinfo directory, as cmd/main.go does

	"timely-api/internal/features/bots/fetch"
	"timely-api/internal/netguard"
)

type reply struct {
	status int
	ct     string
	body   string
}

// fakeNet answers by full URL; anything else, robots.txt included, is a 404.
type fakeNet struct {
	mu       sync.Mutex
	replies  map[string]reply
	requests []*http.Request
}

func (n *fakeNet) RoundTrip(r *http.Request) (*http.Response, error) {
	n.mu.Lock()
	n.requests = append(n.requests, r)
	rep, ok := n.replies[r.URL.String()]
	n.mu.Unlock()
	if !ok {
		rep = reply{status: http.StatusNotFound, ct: "text/plain", body: "404 page not found"}
	}
	h := http.Header{"Content-Type": {rep.ct}}
	return &http.Response{StatusCode: rep.status, Header: h, Body: io.NopCloser(strings.NewReader(rep.body)), Request: r}, nil
}

func (n *fakeNet) last(rawURL string) *http.Request {
	n.mu.Lock()
	defer n.mu.Unlock()
	for i := len(n.requests) - 1; i >= 0; i-- {
		if n.requests[i].URL.String() == rawURL {
			return n.requests[i]
		}
	}
	return nil
}

func fixture(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func jsonReply(t *testing.T, status int, name string) reply {
	return reply{status: status, ct: "application/json; charset=utf-8", body: fixture(t, name)}
}

func fetcher(n *fakeNet) *fetch.Fetcher {
	client := netguard.NewClient(netguard.Options{Timeout: time.Second, MaxRedirects: 4, Ports: []string{"80", "443"}})
	client.Transport = n
	return fetch.New(fetch.Config{Client: client, Sleep: func(context.Context, time.Duration) error { return nil }})
}

type keys map[string]string

func (k keys) SourceKey(_ context.Context, userID, source string) (string, error) {
	return k[userID+"/"+source], nil
}

type brokenKeys struct{ err error }

func (b brokenKeys) SourceKey(context.Context, string, string) (string, error) { return "", b.err }

const (
	yahooAAPL  = "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1d"
	geckoBTC   = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_last_updated_at=true"
	coinbaseBT = "https://api.coinbase.com/v2/prices/BTC-USD/spot"
	finnAAPL   = "https://finnhub.io/api/v1/quote?symbol=AAPL"
)

// Fixed times on Friday 2026-11-06 (New York is UTC-5 after 1 November).
var (
	friOpen   = time.Date(2026, 11, 6, 15, 0, 0, 0, time.UTC)  // 10:00 New York
	friEarly  = time.Date(2026, 11, 6, 13, 0, 0, 0, time.UTC)  // 08:00, before the bell
	friLate   = time.Date(2026, 11, 6, 22, 0, 0, 0, time.UTC)  // 17:00, after the close
	saturday  = time.Date(2026, 11, 7, 16, 0, 0, 0, time.UTC)  // weekend
	friBell   = time.Date(2026, 11, 6, 14, 30, 0, 0, time.UTC) // 09:30 New York
	monBell   = time.Date(2026, 11, 9, 14, 30, 0, 0, time.UTC)
	quoteTime = time.Unix(1793976391, 0).UTC() // 14:46:31 UTC
)

func TestRegistry(t *testing.T) {
	if got := strings.Join(Names(), ","); got != "coinbase,coingecko,finnhub,yahoo" {
		t.Errorf("Names() = %s", got)
	}
	for name, s := range Sources {
		if s.Name != name || s.Label == "" || (s.Kind != "stock" && s.Kind != "crypto") || s.Symbol == nil || s.URL == nil || s.Parse == nil || s.SymbolHint == "" {
			t.Errorf("%s: incomplete entry %+v", name, s)
		}
		// The owner's decision of 2026-11-06: robots.txt is honoured for every source.
		if s.IgnoreRobots {
			t.Errorf("%s: IgnoreRobots must stay false", name)
		}
		if s.Currency != nil && !s.Currency.MatchString(s.DefaultCurrency) {
			t.Errorf("%s: default currency %q fails its own pattern", name, s.DefaultCurrency)
		}
		u, err := url.Parse(s.URL("X", "USD"))
		if err != nil || u.Scheme != "https" || netguard.CheckURL(u) != nil {
			t.Errorf("%s: URL %v %v", name, u, err)
		}
	}
	for kind, name := range Default {
		if s, ok := Sources[name]; !ok || s.Kind != kind {
			t.Errorf("Default[%s] = %s, not a %s source", kind, name, kind)
		}
	}
	if Sources["finnhub"].KeyHeader == "" || Sources["coinbase"].KeyHeader != "" {
		t.Error("only Finnhub needs a key")
	}
	// A key is tested with one read of the source's probe before it is saved.
	for name, s := range Sources {
		if s.KeyHeader == "" {
			continue
		}
		if _, _, err := s.Check(s.Probe, ""); s.Probe == "" || err != nil {
			t.Errorf("%s: probe %q: %v", name, s.Probe, err)
		}
	}
}

func TestCheck(t *testing.T) {
	for _, c := range []struct {
		source, symbol, currency string
		sym, cur                 string // "" sym: refused
	}{
		{"yahoo", " aapl ", "", "AAPL", ""},
		{"yahoo", "reliance.ns", "INR", "RELIANCE.NS", ""}, // the reply names the currency
		{"yahoo", "^gspc", "", "^GSPC", ""},
		{"yahoo", "eurusd=x", "", "EURUSD=X", ""},
		{"yahoo", "AAPL; DROP", "", "", ""},
		{"yahoo", "a/b", "", "", ""},
		{"yahoo", "", "", "", ""},
		{"yahoo", strings.Repeat("A", 21), "", "", ""},
		{"finnhub", "brk.b", "", "BRK.B", "USD"},
		{"finnhub", "AAPL", "usd", "AAPL", "USD"},
		{"finnhub", "AAPL", "EUR", "", ""},
		{"finnhub", "AAPL?token=x", "", "", ""},
		{"coingecko", "Bitcoin", "", "bitcoin", "USD"},
		{"coingecko", "usd-coin", "inr", "usd-coin", "INR"},
		{"coingecko", "bit coin", "", "", ""},
		{"coingecko", "bitcoin", "EURO12", "", ""},
		{"coinbase", "btc", "", "BTC", "USD"},
		{"coinbase", "eth", "eur", "ETH", "EUR"},
		{"coinbase", "BTC-USD", "", "", ""},
		{"coinbase", "B", "", "", ""},
		{"coinbase", "BTC", "U$D", "", ""},
	} {
		sym, cur, err := Sources[c.source].Check(c.symbol, c.currency)
		if c.sym == "" {
			if err == nil {
				t.Errorf("%s %q %q: accepted as %q %q", c.source, c.symbol, c.currency, sym, cur)
			}
			continue
		}
		if err != nil || sym != c.sym || cur != c.cur {
			t.Errorf("%s %q %q = %q %q %v, want %q %q", c.source, c.symbol, c.currency, sym, cur, err, c.sym, c.cur)
		}
	}
	_, _, err := Sources["yahoo"].Check("a/b", "")
	if err == nil || !strings.Contains(err.Error(), "AAPL") {
		t.Errorf("a bad symbol's error should show an example: %v", err)
	}
}

func TestYahooMarketHours(t *testing.T) {
	n := &fakeNet{replies: map[string]reply{yahooAAPL: jsonReply(t, 200, "yahoo_chart_aapl.json")}}
	f := fetcher(n)
	for _, c := range []struct {
		name string
		now  time.Time
		open bool
		next time.Time
	}{
		{"open", friOpen, true, time.Time{}},
		{"before the bell", friEarly, false, friBell},
		{"after the close", friLate, false, monBell},
		{"weekend", saturday, false, monBell},
	} {
		q, err := Get(context.Background(), f, nil, Query{Source: "yahoo", Symbol: "aapl"}, c.now)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if q.Price != 271.35 || q.Currency != "USD" || !q.At.Equal(quoteTime) {
			t.Errorf("%s: quote = %+v", c.name, q)
		}
		if q.MarketOpen != c.open || !q.NextOpen.Equal(c.next) {
			t.Errorf("%s: open %v next %v, want %v %v", c.name, q.MarketOpen, q.NextOpen, c.open, c.next)
		}
	}
	if n.last("https://query1.finance.yahoo.com/robots.txt") == nil {
		t.Error("robots.txt was not asked")
	}
}

func TestYahooMinorUnits(t *testing.T) {
	body := strings.NewReplacer(`"currency":"USD"`, `"currency":"GBp"`, `"regularMarketPrice":271.35`, `"regularMarketPrice":1234.5`).Replace(fixture(t, "yahoo_chart_aapl.json"))
	n := &fakeNet{replies: map[string]reply{"https://query1.finance.yahoo.com/v8/finance/chart/VOD.L?interval=1d&range=1d": {200, "application/json", body}}}
	q, err := Get(context.Background(), fetcher(n), nil, Query{Source: "yahoo", Symbol: "VOD.L"}, friOpen)
	if err != nil || q.Price != 12.345 || q.Currency != "GBP" {
		t.Errorf("pence: %+v %v, want 12.345 GBP", q, err)
	}
}

func TestNotFoundAndSourceGone(t *testing.T) {
	for _, c := range []struct {
		name  string
		q     Query
		url   string
		reply reply
		gone  bool // else ErrNotFound
	}{
		{"yahoo 404", Query{Source: "yahoo", Symbol: "AAPL"}, yahooAAPL, jsonReply(t, 404, "yahoo_notfound.json"), false},
		{"yahoo not found in a 200", Query{Source: "yahoo", Symbol: "AAPL"}, yahooAAPL, jsonReply(t, 200, "yahoo_notfound.json"), false},
		{"yahoo shape changed", Query{Source: "yahoo", Symbol: "AAPL"}, yahooAAPL, jsonReply(t, 200, "yahoo_shape_changed.json"), true},
		{"yahoo gone (HTML)", Query{Source: "yahoo", Symbol: "AAPL"}, yahooAAPL, reply{200, "text/html", fixture(t, "yahoo_gone.html")}, true},
		{"yahoo empty body", Query{Source: "yahoo", Symbol: "AAPL"}, yahooAAPL, reply{200, "application/json", ""}, true},
		{"coingecko unknown id", Query{Source: "coingecko", Symbol: "bitcoin"}, geckoBTC, jsonReply(t, 200, "coingecko_empty.json"), false},
		{"coingecko unknown currency", Query{Source: "coingecko", Symbol: "bitcoin", Currency: "EUR"},
			"https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur&include_last_updated_at=true", jsonReply(t, 200, "coingecko_btc.json"), false},
		{"coingecko error object", Query{Source: "coingecko", Symbol: "bitcoin"}, geckoBTC, reply{200, "application/json", `{"status":{"error_code":10002,"error_message":"gone"}}`}, true},
		{"coinbase 404", Query{Source: "coinbase", Symbol: "BTC"}, coinbaseBT, jsonReply(t, 404, "coinbase_notfound.json"), false},
		{"coinbase not found in a 200", Query{Source: "coinbase", Symbol: "BTC"}, coinbaseBT, jsonReply(t, 200, "coinbase_notfound.json"), false},
		{"coinbase errors[].id", Query{Source: "coinbase", Symbol: "BTC"}, coinbaseBT, jsonReply(t, 200, "coinbase_errors.json"), false},
		{"coinbase amount not a number", Query{Source: "coinbase", Symbol: "BTC"}, coinbaseBT, reply{200, "application/json", `{"data":{"amount":"n/a","currency":"USD"}}`}, true},
		{"coinbase zero price", Query{Source: "coinbase", Symbol: "BTC"}, coinbaseBT, reply{200, "application/json", `{"data":{"amount":"0","currency":"USD"}}`}, true},
		{"finnhub unknown symbol", Query{UserID: "u1", Source: "finnhub", Symbol: "AAPL"}, finnAAPL, jsonReply(t, 200, "finnhub_unknown.json"), false},
		{"finnhub shape changed", Query{UserID: "u1", Source: "finnhub", Symbol: "AAPL"}, finnAAPL, reply{200, "application/json", `{"price":271.35}`}, true},
	} {
		n := &fakeNet{replies: map[string]reply{c.url: c.reply}}
		_, err := Get(context.Background(), fetcher(n), keys{"u1/finnhub": "k1"}, c.q, friOpen)
		var gone *SourceGoneError
		switch {
		case c.gone && (!errors.As(err, &gone) || gone.Source != c.q.Source):
			t.Errorf("%s: got %v, want SourceGoneError", c.name, err)
		case c.gone && (errors.Is(err, fetch.ErrUnsupported) || errors.Is(err, fetch.ErrNotFound)):
			t.Errorf("%s: SourceGoneError must not unwrap to a fetch error", c.name)
		case !c.gone && (!errors.Is(err, fetch.ErrNotFound) || errors.As(err, &gone)):
			t.Errorf("%s: got %v, want ErrNotFound", c.name, err)
		}
	}
	_, err := Get(context.Background(), fetcher(&fakeNet{}), nil, Query{Source: "kraken", Symbol: "BTC"}, friOpen)
	var gone *SourceGoneError
	if !errors.As(err, &gone) || gone.Source != "kraken" {
		t.Errorf("unknown source: got %v, want SourceGoneError", err)
	}
	if _, err := Get(context.Background(), fetcher(&fakeNet{}), nil, Query{Source: "coinbase", Symbol: "BTC-USD"}, friOpen); !errors.Is(err, fetch.ErrNotFound) {
		t.Errorf("a stored symbol the pattern refuses: got %v, want ErrNotFound", err)
	}
}

// The robots.txt files as they stood on 2026-11-06.
func TestRobotsHonoured(t *testing.T) {
	robots := func(body string) reply { return reply{200, "text/plain", body} }
	n := &fakeNet{replies: map[string]reply{
		"https://query1.finance.yahoo.com/robots.txt": robots("User-agent: *\nDisallow: /\n"),
		"https://api.coingecko.com/robots.txt":        robots("User-agent: *\nDisallow: /api/v3\n"),
		"https://finnhub.io/robots.txt":               robots("User-agent: *\nDisallow: /terms-of-service\nDisallow: /faq\nAllow: /\n"),
		yahooAAPL:                                     jsonReply(t, 200, "yahoo_chart_aapl.json"),
		geckoBTC:                                      jsonReply(t, 200, "coingecko_btc.json"),
		coinbaseBT:                                    jsonReply(t, 200, "coinbase_spot.json"), // its robots.txt is a 404: allowed
		finnAAPL:                                      jsonReply(t, 200, "finnhub_quote_aapl.json"),
	}}
	f := fetcher(n)
	k := keys{"u1/finnhub": "k1"}
	for _, c := range []struct {
		q       Query
		blocked bool
	}{
		{Query{Source: "yahoo", Symbol: "AAPL"}, true},
		{Query{Source: "coingecko", Symbol: "bitcoin"}, true},
		{Query{Source: "coinbase", Symbol: "BTC"}, false},
		{Query{UserID: "u1", Source: "finnhub", Symbol: "AAPL"}, false},
	} {
		_, err := Get(context.Background(), f, k, c.q, friOpen)
		if c.blocked != errors.Is(err, fetch.ErrRobots) || (!c.blocked && err != nil) {
			t.Errorf("%s: got %v, blocked by robots %v", c.q.Source, err, c.blocked)
		}
	}
	if n.last(yahooAAPL) != nil || n.last(geckoBTC) != nil {
		t.Error("a source robots.txt disallows was read")
	}
}

func TestCoinGecko(t *testing.T) {
	n := &fakeNet{replies: map[string]reply{geckoBTC: jsonReply(t, 200, "coingecko_btc.json")}}
	q, err := Get(context.Background(), fetcher(n), nil, Query{Source: "coingecko", Symbol: "Bitcoin"}, saturday)
	want := Quote{Price: 76054, Currency: "USD", At: time.Unix(1793976350, 0).UTC(), MarketOpen: true}
	if err != nil || q != want {
		t.Errorf("got %+v %v, want %+v", q, err, want)
	}
}

func TestCoinbase(t *testing.T) {
	n := &fakeNet{replies: map[string]reply{coinbaseBT: jsonReply(t, 200, "coinbase_spot.json")}}
	q, err := Get(context.Background(), fetcher(n), nil, Query{Source: "coinbase", Symbol: "btc"}, saturday)
	want := Quote{Price: 76054.29, Currency: "USD", At: saturday, MarketOpen: true}
	if err != nil || q != want {
		t.Errorf("got %+v %v, want %+v", q, err, want)
	}
	if ua := n.last(coinbaseBT).Header.Get("User-Agent"); !strings.HasPrefix(ua, "Timely/") {
		t.Errorf("User-Agent = %q", ua)
	}
}

func TestFinnhub(t *testing.T) {
	n := &fakeNet{replies: map[string]reply{finnAAPL: jsonReply(t, 200, "finnhub_quote_aapl.json")}}
	f := fetcher(n)
	q := Query{UserID: "u1", Source: "finnhub", Symbol: "aapl"}

	// No key: nothing is fetched.
	for _, k := range []Keys{nil, keys{}, keys{"u1/finnhub": "  "}, keys{"u2/finnhub": "k2"}} {
		var ke *KeyError
		if _, err := Get(context.Background(), f, k, q, friOpen); !errors.As(err, &ke) || ke.Rejected || ke.Source != "finnhub" {
			t.Errorf("keys %v: got %v, want a missing-key KeyError", k, err)
		}
	}
	if len(n.requests) != 0 {
		t.Fatalf("a keyless Finnhub read made %d requests", len(n.requests))
	}
	boom := errors.New("db down")
	if _, err := Get(context.Background(), f, brokenKeys{boom}, q, friOpen); !errors.Is(err, boom) {
		t.Errorf("a failed key lookup: got %v", err)
	}

	k := keys{"u1/finnhub": "k1"}
	got, err := Get(context.Background(), f, k, q, friOpen)
	want := Quote{Price: 271.35, Currency: "USD", At: quoteTime, MarketOpen: true}
	if err != nil || got != want {
		t.Errorf("open: got %+v %v, want %+v", got, err, want)
	}
	r := n.last(finnAAPL)
	if r.Header.Get("X-Finnhub-Token") != "k1" || strings.Contains(r.URL.String(), "k1") {
		t.Errorf("the key must travel in the header only: %s %v", r.URL, r.Header)
	}
	if robots := n.last("https://finnhub.io/robots.txt"); robots == nil || robots.Header.Get("X-Finnhub-Token") != "" {
		t.Error("robots.txt must be asked, without the key")
	}
	for _, c := range []struct {
		now  time.Time
		next time.Time
	}{{friEarly, friBell}, {friLate, monBell}, {saturday, monBell}} {
		got, err := Get(context.Background(), f, k, q, c.now)
		if err != nil || got.MarketOpen || !got.NextOpen.Equal(c.next) {
			t.Errorf("%v: got %+v %v, want closed until %v", c.now, got, err, c.next)
		}
	}

	n.replies[finnAAPL] = jsonReply(t, 401, "finnhub_nokey.json")
	var ke *KeyError
	if _, err := Get(context.Background(), f, k, q, friOpen); !errors.As(err, &ke) || !ke.Rejected {
		t.Errorf("401: got %v, want a rejected KeyError", err)
	} else if strings.Contains(err.Error(), "k1") {
		t.Errorf("the error shows the key: %v", err)
	}
}

func TestFetchErrorsPassThrough(t *testing.T) {
	n := &fakeNet{replies: map[string]reply{coinbaseBT: {429, "application/json", `{}`}}}
	var rl *fetch.RateLimitedError
	if _, err := Get(context.Background(), fetcher(n), nil, Query{Source: "coinbase", Symbol: "BTC"}, friOpen); !errors.As(err, &rl) {
		t.Errorf("429: got %v, want RateLimitedError", err)
	}
	n.replies[coinbaseBT] = reply{500, "application/json", `{}`}
	var se *fetch.StatusError
	if _, err := Get(context.Background(), fetcher(n), nil, Query{Source: "coinbase", Symbol: "BTC"}, friOpen); !errors.As(err, &se) || se.Status != 500 {
		t.Errorf("500: got %v, want StatusError", err)
	}
}

func TestErrorTexts(t *testing.T) {
	for _, c := range []struct {
		err  error
		want string
	}{
		{&SourceGoneError{Source: "yahoo", Err: errShape}, "Yahoo Finance changed how it answers, or stopped answering: the reply is not in the expected shape"},
		{&SourceGoneError{Source: "kraken"}, "kraken changed how it answers, or stopped answering"},
		{&KeyError{Source: "finnhub"}, "Finnhub needs a free API key before Timely can read its prices"},
		{&KeyError{Source: "finnhub", Rejected: true}, "Finnhub did not accept the saved API key"},
	} {
		if got := c.err.Error(); got != c.want {
			t.Errorf("got %q, want %q", got, c.want)
		}
	}
}

func TestNextOpenAcrossDST(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	// Friday 2026-10-30 after the close: Monday's bell is 09:30 EST, an hour
	// later in UTC than Friday's 09:30 EDT.
	start := time.Date(2026, 10, 30, 9, 30, 0, 0, loc)
	got := nextOpen(start, time.Date(2026, 10, 30, 21, 0, 0, 0, time.UTC), loc)
	if want := time.Date(2026, 11, 2, 14, 30, 0, 0, time.UTC); !got.Equal(want) {
		t.Errorf("nextOpen = %v, want %v", got, want)
	}
}
