package bots

import (
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
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
}

// Detail is a View with the Bot's recent log, alerts and prices.
type Detail struct {
	View
	Checks  []CheckView    `json:"checks"`
	Alerts  []AlertView    `json:"alerts"`
	Prices  []PriceDayView `json:"prices"`
	Lessons []Lesson       `json:"lessons"`
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
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	Held      string    `json:"held"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	URL       string    `json:"url"`
	Urgent    bool      `json:"urgent"`
	MoreCount int       `json:"moreCount"`
	CreatedAt time.Time `json:"createdAt"`
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

func viewOf(b Bot, ws []Watch, alertsToday int) View {
	v := View{
		ID: b.ID, Name: b.Name, Description: b.Description, Status: b.Status, PauseReason: b.PauseReason,
		Origin: b.Origin, JudgeMode: b.JudgeMode, IntervalMinutes: b.IntervalSeconds / 60,
		Urgent: b.Urgent, Desktop: b.NotifyDesktop, Phone: b.NotifyPhone,
		SnoozedUntil: b.SnoozedUntil, NextCheckAt: b.NextCheckAt, LastCheckAt: b.LastCheckAt, LastOkAt: b.LastOkAt,
		Strikes: b.Strikes, Health: healthOf(b.Health, b.HealthDetail), AlertsToday: alertsToday,
		Watches: make([]WatchView, 0, len(ws)), CreatedAt: b.CreatedAt, UpdatedAt: b.UpdatedAt,
	}
	for _, w := range ws {
		rules := []Rule(w.Rules)
		if rules == nil {
			rules = []Rule{}
		}
		v.Watches = append(v.Watches, WatchView{
			ID: w.ID, Kind: w.Kind, URL: w.URL, Read: w.ReadMode, Selector: w.Selector,
			Source: w.Source, Symbol: w.Symbol, Currency: w.Currency, Rules: rules,
			Health: healthOf(w.Health, w.HealthDetail), LastReadingAt: w.LastReadingAt, Summary: summary(w.LastReading),
		})
	}
	return v
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
