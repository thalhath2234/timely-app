package price

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var errShape = errors.New("the reply is not in the expected shape")

// The labels are constants so a Parse func can name its source without an
// initialization cycle through its registry entry.
const (
	yahooLabel     = "Yahoo Finance"
	finnhubLabel   = "Finnhub"
	coingeckoLabel = "CoinGecko"
	coinbaseLabel  = "Coinbase"
)

// yahoo is Yahoo Finance's unofficial chart API. Its robots.txt disallows
// everything, so with robots honoured it answers fetch.ErrRobots.
var yahoo = Source{
	Name: "yahoo", Label: yahooLabel, Kind: "stock",
	Symbol:     regexp.MustCompile(`^[A-Z0-9^][A-Z0-9.\-=^]{0,19}$`),
	SymbolHint: "its ticker, like AAPL or RELIANCE.NS",
	URL: func(sym, _ string) string {
		return "https://query1.finance.yahoo.com/v8/finance/chart/" + url.PathEscape(sym) + "?interval=1d&range=1d"
	},
	Parse: parseYahoo,
}

func parseYahoo(body []byte, sym, _ string, now time.Time) (Quote, error) {
	type period struct {
		Start int64 `json:"start"`
		End   int64 `json:"end"`
	}
	var r struct {
		Chart *struct {
			Result []struct {
				Meta struct {
					Currency             string   `json:"currency"`
					RegularMarketPrice   *float64 `json:"regularMarketPrice"`
					RegularMarketTime    int64    `json:"regularMarketTime"`
					ExchangeTimezoneName string   `json:"exchangeTimezoneName"`
					GMTOffset            int      `json:"gmtoffset"`
					CurrentTradingPeriod struct {
						Regular period `json:"regular"`
					} `json:"currentTradingPeriod"`
				} `json:"meta"`
			} `json:"result"`
			Error *struct {
				Code        string `json:"code"`
				Description string `json:"description"`
			} `json:"error"`
		} `json:"chart"`
	}
	if err := json.Unmarshal(body, &r); err != nil || r.Chart == nil {
		return Quote{}, errShape
	}
	if e := r.Chart.Error; e != nil {
		if e.Code == "Not Found" {
			return Quote{}, notFound(yahooLabel, sym)
		}
		return Quote{}, fmt.Errorf("%s: %s", e.Code, e.Description)
	}
	if len(r.Chart.Result) == 0 {
		return Quote{}, errShape
	}
	m := r.Chart.Result[0].Meta
	if m.RegularMarketPrice == nil || m.Currency == "" {
		return Quote{}, errShape
	}
	price, currency := minorUnits(*m.RegularMarketPrice, m.Currency)
	q := Quote{Price: price, Currency: currency, At: unixOr(m.RegularMarketTime, now), MarketOpen: true}
	if reg := m.CurrentTradingPeriod.Regular; reg.Start > 0 && reg.End > reg.Start {
		start, end := time.Unix(reg.Start, 0), time.Unix(reg.End, 0)
		if now.Before(start) || !now.Before(end) {
			loc, err := time.LoadLocation(m.ExchangeTimezoneName)
			if err != nil || m.ExchangeTimezoneName == "" {
				loc = time.FixedZone("exchange", m.GMTOffset)
			}
			q.MarketOpen, q.NextOpen = false, nextOpen(start, now, loc)
		}
	}
	return q, nil
}

// minorUnits turns Yahoo's minor-unit currencies (pence, cents, agorot)
// into the major unit, so a London price is never 100 times too high.
func minorUnits(price float64, currency string) (float64, string) {
	switch currency {
	case "GBp", "GBX":
		return price / 100, "GBP"
	case "ZAc", "ZAC":
		return price / 100, "ZAR"
	case "ILA":
		return price / 100, "ILS"
	}
	return price, strings.ToUpper(currency)
}

// finnhub is Finnhub's quote API. Its free plan covers US stocks and needs
// a key, sent in a header so it never shows in a URL or an error.
var finnhub = Source{
	Name: "finnhub", Label: finnhubLabel, Kind: "stock",
	Symbol:          regexp.MustCompile(`^[A-Z0-9][A-Z0-9.\-]{0,14}$`),
	SymbolHint:      "a US ticker, like AAPL or BRK.B",
	Currency:        regexp.MustCompile(`^USD$`),
	DefaultCurrency: "USD",
	KeyHeader:       "X-Finnhub-Token",
	Probe:           "AAPL",
	URL: func(sym, _ string) string {
		return "https://finnhub.io/api/v1/quote?symbol=" + url.QueryEscape(sym)
	},
	Parse: parseFinnhub,
}

func parseFinnhub(body []byte, sym, _ string, now time.Time) (Quote, error) {
	var r struct {
		Current *float64 `json:"c"`
		Time    int64    `json:"t"`
		Error   string   `json:"error"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return Quote{}, errShape
	}
	if r.Error != "" {
		return Quote{}, errors.New(r.Error)
	}
	if r.Current == nil {
		return Quote{}, errShape
	}
	if *r.Current == 0 && r.Time == 0 {
		// Finnhub answers an unknown symbol with all zeros.
		return Quote{}, notFound(finnhubLabel, sym)
	}
	open, next := usSession(now)
	return Quote{Price: *r.Current, Currency: "USD", At: unixOr(r.Time, now), MarketOpen: open, NextOpen: next}, nil
}

// coingecko is CoinGecko's simple price API. The symbol is a CoinGecko id.
// Its robots.txt disallows /api/v3, so it answers fetch.ErrRobots today.
var coingecko = Source{
	Name: "coingecko", Label: coingeckoLabel, Kind: "crypto",
	Symbol:          regexp.MustCompile(`^[a-z0-9-]{1,64}$`),
	LowerSymbol:     true,
	SymbolHint:      "its CoinGecko id, like bitcoin",
	Currency:        regexp.MustCompile(`^[A-Z]{3,5}$`),
	DefaultCurrency: "USD",
	URL: func(sym, cur string) string {
		return "https://api.coingecko.com/api/v3/simple/price?ids=" + url.QueryEscape(sym) +
			"&vs_currencies=" + url.QueryEscape(strings.ToLower(cur)) + "&include_last_updated_at=true"
	},
	Parse: parseCoinGecko,
}

func parseCoinGecko(body []byte, sym, cur string, now time.Time) (Quote, error) {
	var r map[string]map[string]float64
	if err := json.Unmarshal(body, &r); err != nil || r == nil {
		return Quote{}, errShape
	}
	coin, ok := r[sym]
	if !ok {
		return Quote{}, notFound(coingeckoLabel, sym)
	}
	price, ok := coin[strings.ToLower(cur)]
	if !ok {
		return Quote{}, notFound(coingeckoLabel, sym+" in "+cur)
	}
	return Quote{Price: price, Currency: cur, At: unixOr(int64(coin["last_updated_at"]), now), MarketOpen: true}, nil
}

// coinbase is Coinbase's public spot price, which needs no key. Its
// robots.txt is a 404, which allows everything.
var coinbase = Source{
	Name: "coinbase", Label: coinbaseLabel, Kind: "crypto",
	Symbol:          regexp.MustCompile(`^[A-Z0-9]{2,10}$`),
	SymbolHint:      "the coin's code, like BTC or ETH",
	Currency:        regexp.MustCompile(`^[A-Z]{3,5}$`),
	DefaultCurrency: "USD",
	URL: func(sym, cur string) string {
		return "https://api.coinbase.com/v2/prices/" + url.PathEscape(sym+"-"+cur) + "/spot"
	},
	Parse: parseCoinbase,
}

func parseCoinbase(body []byte, sym, cur string, now time.Time) (Quote, error) {
	var r struct {
		Data *struct {
			Amount   string `json:"amount"`
			Currency string `json:"currency"`
		} `json:"data"`
		Errors []struct {
			ID      string `json:"id"`
			Message string `json:"message"`
		} `json:"errors"`
		Code  int    `json:"code"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return Quote{}, errShape
	}
	for _, e := range r.Errors {
		if e.ID == "not_found" {
			return Quote{}, notFound(coinbaseLabel, sym+"-"+cur)
		}
	}
	switch {
	case r.Code == 5: // gRPC NotFound, which the v2 API now answers
		return Quote{}, notFound(coinbaseLabel, sym+"-"+cur)
	case len(r.Errors) > 0:
		return Quote{}, errors.New(r.Errors[0].Message)
	case r.Error != "":
		return Quote{}, errors.New(r.Error)
	case r.Data == nil:
		return Quote{}, errShape
	}
	price, err := strconv.ParseFloat(r.Data.Amount, 64)
	if err != nil {
		return Quote{}, errShape
	}
	currency := strings.ToUpper(r.Data.Currency)
	if currency == "" {
		currency = cur
	}
	// Coinbase gives no quote time, so the fetch time stands in.
	return Quote{Price: price, Currency: currency, At: now, MarketOpen: true}, nil
}

func unixOr(sec int64, now time.Time) time.Time {
	if sec <= 0 {
		return now
	}
	return time.Unix(sec, 0).UTC()
}
