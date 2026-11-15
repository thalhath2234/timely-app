package bots

import (
	"context"
	"encoding/json"
	"errors"
	"math/rand/v2"
	"strings"
	"testing"
	"time"
)

func ran(res AgentResult) agentRun { return agentRun{ran: true, res: res} }

func TestCleanReports(t *testing.T) {
	price := 89999.0
	nan := func() *float64 { v := price - price; v = v / v; return &v }()

	if got := cleanReports(ran(AgentResult{Silent: true, Reports: []Report{{Title: "dropped"}}})); got != nil {
		t.Errorf("a silent run kept reports: %+v", got)
	}
	if got := cleanReports(agentRun{res: AgentResult{Reports: []Report{{Title: "never ran"}}}}); got != nil {
		t.Errorf("a run that did not happen made reports: %+v", got)
	}
	if got := cleanReports(agentRun{ran: true, class: ClassTimeout, res: AgentResult{Reports: []Report{{Title: "failed"}}}}); got != nil {
		t.Errorf("a failed run made reports: %+v", got)
	}
	// Text with no report becomes one from its first line; [SILENT] is nothing.
	got := cleanReports(ran(AgentResult{Response: "Pixel is back\nin stock now"}))
	if len(got) != 1 || got[0].Title != "Pixel is back" || got[0].Body != "Pixel is back\nin stock now" {
		t.Errorf("synthesised report %+v", got)
	}
	for _, text := range []string{"", "  ", "[SILENT]", "[silent] nothing new"} {
		if got := cleanReports(ran(AgentResult{Response: text})); got != nil {
			t.Errorf("%q made %+v", text, got)
		}
	}
	// Cleaning: the title clipped to 120, the body's lines, the address kept
	// only when it is public, urgency defaulted, a proposal only as an object.
	long := strings.Repeat("x", 300)
	got = cleanReports(ran(AgentResult{Reports: []Report{
		{Title: " A  title\x00 ", Body: "line one\n\nline two", URL: "http://localhost/admin", Urgency: "extreme", Proposal: json.RawMessage(`["x"]`), Price: nan},
		{Title: long, URL: "https://example.com/a?utm_source=x", Price: &price, Proposal: json.RawMessage(`{"tool":"t"}`), Urgency: UrgencyLow},
		{Title: "", Body: "from the body\nsecond"},
		{Title: "", Body: ""},
	}}))
	if len(got) != 3 {
		t.Fatalf("%d reports: %+v", len(got), got)
	}
	if got[0].Title != "A title" || got[0].Body != "line one\nline two" || got[0].URL != "" || got[0].Urgency != UrgencyNormal || got[0].Proposal != nil || got[0].Price != nil {
		t.Errorf("first %+v", got[0])
	}
	if len([]rune(got[1].Title)) > maxFindingTitle || got[1].URL != "https://example.com/a?utm_source=x" || string(got[1].Proposal) != `{"tool":"t"}` || got[1].Urgency != UrgencyLow {
		t.Errorf("second %+v", got[1])
	}
	if got[2].Title != "from the body" {
		t.Errorf("third %+v", got[2])
	}
	// At most maxTickReports.
	many := make([]Report, maxTickReports+5)
	for i := range many {
		many[i] = Report{Title: "r" + strings.Repeat("x", i)}
	}
	if got := cleanReports(ran(AgentResult{Reports: many})); len(got) != maxTickReports {
		t.Errorf("%d reports kept", len(got))
	}
}

func TestReportFingerprint(t *testing.T) {
	p := func(v float64) *float64 { return &v }
	base := Report{Title: "Pixel 10 Pro is under 90k", URL: "https://www.flipkart.com/p/itm1?utm_source=x&ref=y", Price: p(89999)}
	fp := func(r Report) string { return reportFingerprint(r, reportThing(r)) }
	want := fp(base)
	same := []Report{
		{Title: "  pixel 10 PRO is   under 90k", URL: "https://flipkart.com/p/itm1", Price: p(89999.004)},
		{Title: base.Title, URL: "https://www.flipkart.com/p/itm1/", Price: p(89999), Body: "other words", Urgency: UrgencyHigh},
	}
	for _, r := range same {
		if fp(r) != want {
			t.Errorf("%+v is another alert", r)
		}
	}
	other := []Report{
		{Title: base.Title, URL: base.URL, Price: p(84999)},
		{Title: base.Title, URL: "https://www.flipkart.com/p/itm2", Price: p(89999)},
		{Title: "Pixel 10 Pro is back", URL: base.URL, Price: p(89999)},
		{Title: base.Title, URL: base.URL},
	}
	for _, r := range other {
		if fp(r) == want {
			t.Errorf("%+v is the same alert", r)
		}
	}
	if reportThing(Report{Symbol: "btc"}) != "symbol:BTC" || reportThing(Report{}) != "" || reportThing(base) != "page:https://flipkart.com/p/itm1" {
		t.Errorf("things %q %q", reportThing(Report{Symbol: "btc"}), reportThing(base))
	}
}

func TestRunClass(t *testing.T) {
	cases := []struct {
		name string
		res  AgentResult
		err  error
		want string
	}{
		{"finished", AgentResult{Response: "ok"}, nil, ""},
		{"no provider", AgentResult{}, ErrNoAI, classNoAI},
		{"wrapped no provider", AgentResult{}, errors.Join(errors.New("x"), ErrNoAI), classNoAI},
		{"deadline", AgentResult{}, context.DeadlineExceeded, ClassTimeout},
		{"no worker", AgentResult{}, errors.New("broken pipe"), ClassUnreachable},
		{"class", AgentResult{ErrorClass: ClassRateLimited}, nil, ClassRateLimited},
		{"cron failure", AgentResult{Response: "\n [CRON_FAILURE] could not read"}, nil, ClassCronFailure},
		{"cron failure later is not one", AgentResult{Response: "all fine\n[CRON_FAILURE]"}, nil, ""},
	}
	for _, c := range cases {
		if got := runClass(c.res, c.err); got != c.want {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}
}

func TestEndOf(t *testing.T) {
	cases := []struct {
		name    string
		run     agentRun
		kind    int
		outcome string
		consume bool
	}{
		{"unchanged", agentRun{skip: SkipUnchanged}, endUnchanged, outUnchanged, true},
		{"busy before", agentRun{skip: SkipBrowserBusy, class: ClassBrowserBusy}, endBusy, outSkipped, false},
		{"busy during", agentRun{ran: true, class: ClassBrowserBusy}, endBusy, outSkipped, false},
		{"no AI", agentRun{skip: SkipNoAI, class: classNoAI}, endNoAI, outNoAI, true},
		{"capped", agentRun{capped: true}, endCapped, outSkipped, false},
		{"unreachable", agentRun{ran: true, class: ClassUnreachable}, endUnreachable, outOffline, false},
		{"rate limited", agentRun{ran: true, class: ClassRateLimited}, endRateLimited, outRateLimited, false},
		{"timeout", agentRun{ran: true, class: ClassTimeout}, endStrike, outFailed, false},
		{"crash", agentRun{ran: true, class: ClassCrash}, endStrike, outFailed, false},
		{"cron failure", agentRun{ran: true, class: ClassCronFailure}, endStrike, outFailed, false},
		{"injection", agentRun{ran: true, class: ClassInjection}, endStrike, outFailed, false},
		{"finished", agentRun{ran: true}, endOK, outSilent, true},
	}
	for _, c := range cases {
		e := endOf(c.run)
		if e.kind != c.kind || e.outcome != c.outcome || e.consume != c.consume {
			t.Errorf("%s: %+v", c.name, e)
		}
	}
	if e := endOf(agentRun{skip: SkipUnchanged}); !e.gateSkipped || e.skip != SkipUnchanged {
		t.Errorf("unchanged %+v", e)
	}
	// A failure keeps its text, without secrets, within the check's bound.
	e := endOf(agentRun{ran: true, class: ClassCrash, res: AgentResult{Response: strings.Repeat("y", 2000)}})
	if e.errText == "" || len([]rune(e.errText)) > maxCheckError+1 { // the cut ends in "…"
		t.Errorf("error text %d long", len([]rune(e.errText)))
	}
	if e := endOf(agentRun{ran: true, class: ClassUnreachable, err: errors.New("worker is down")}); e.errText != "worker is down" {
		t.Errorf("error text %q", e.errText)
	}
}

func TestRunRecordOf(t *testing.T) {
	if runRecordOf(agentRun{skip: SkipUnchanged}) != nil {
		t.Error("a tick that never asked the agent has a run record")
	}
	rec := runRecordOf(agentRun{ran: true, model: ModelChoice{Provider: "p", Model: "m"}, res: AgentResult{
		Response: strings.Repeat("z", 10000), Reports: []Report{{}, {}}, Usage: Usage{InputTokens: 5, Calls: 1},
	}})
	if rec == nil || len(rec.Response) > maxRunResponse+len("…") || rec.Reports != 2 || rec.Trace == nil || rec.Usage.InputTokens != 5 || rec.Model.Model != "m" {
		t.Errorf("record %+v", rec)
	}
}

func TestGateDiffs(t *testing.T) {
	p := func(v float64) *float64 { return &v }
	prev := Reading{Kind: ReadingPrice, Price: p(100), Currency: "INR", Availability: "out_of_stock"}
	same := watchRead{w: Watch{ID: "w1", LastReading: &prev}, reading: prev}
	moved := watchRead{w: Watch{ID: "w2", LastReading: &prev}, reading: Reading{Kind: ReadingPrice, Price: p(90), Currency: "INR", Availability: "out_of_stock"}}
	fresh := watchRead{w: Watch{ID: "w3"}, reading: prev}
	restored := watchRead{w: Watch{ID: "w4", LastReading: &prev, BaselinePending: true}, reading: Reading{Kind: ReadingPrice, Price: p(1), Currency: "INR"}}
	notMod := watchRead{w: Watch{ID: "w5", LastReading: &prev}, reading: prev, notMod: true}
	failed := watchRead{w: Watch{ID: "w6"}, err: errors.New("down")}
	got := gateDiffs([]watchRead{same, moved, fresh, restored, notMod, failed})
	if len(got) != 2 || got[0].WatchID != "w2" || got[0].Kind != DiffPrice || got[1].WatchID != "w3" || got[1].Kind != DiffContent {
		t.Errorf("diffs %+v", got)
	}
	if gateDiffs([]watchRead{same, restored, notMod}) != nil {
		t.Error("nothing moved but the gate woke")
	}
}

func TestAgentNextAt(t *testing.T) {
	s := &Service{rnd: rand.New(rand.NewPCG(1, 2))}
	kolkata, _ := time.LoadLocation("Asia/Kolkata")
	now := time.Date(2026, 11, 6, 9, 30, 0, 0, time.UTC) // Fri 15:00 in Kolkata

	// An interval keeps its jitter and never goes under the floor.
	b := Bot{IntervalSeconds: 900, Schedule: jsonMap[string, any]{"everyMinutes": 15}}
	if at := s.agentNextAt(b, nil, kolkata, now); at.Before(now.Add(14*time.Minute)) || at.After(now.Add(18*time.Minute)) {
		t.Errorf("every 15 minutes: %v", at)
	}
	shop := []Watch{{Kind: WatchPage, ReadMode: ReadProductPrice}}
	b = Bot{IntervalSeconds: 900, Schedule: jsonMap[string, any]{"everyMinutes": 15}}
	if at := s.agentNextAt(b, shop, kolkata, now); at.Before(now.Add(5*time.Hour + 50*time.Minute)) {
		t.Errorf("a shop price every 15 minutes: %v", at)
	}
	// A daily time is read in the Bot's zone, the notification zone when it names none.
	b = Bot{IntervalSeconds: 86400, Schedule: jsonMap[string, any]{"dailyAt": "09:00", "weekdays": []any{}}}
	want := time.Date(2026, 11, 7, 9, 0, 0, 0, kolkata)
	if at := s.agentNextAt(b, nil, kolkata, now); !at.Equal(want) {
		t.Errorf("daily 09:00 in Kolkata: %v, want %v", at, want)
	}
	b.Timezone = "UTC"
	if at := s.agentNextAt(b, nil, kolkata, now); !at.Equal(time.Date(2026, 11, 7, 9, 0, 0, 0, time.UTC)) {
		t.Errorf("daily 09:00 UTC: %v", at)
	}
	// Market hours hold an interval to the open.
	b = Bot{IntervalSeconds: 900, MarketHours: true, Schedule: jsonMap[string, any]{"everyMinutes": 15}}
	friEvening := time.Date(2026, 11, 6, 22, 0, 0, 0, time.UTC)
	if at := s.agentNextAt(b, nil, kolkata, friEvening); !at.Equal(time.Date(2026, 11, 9, 14, 30, 0, 0, time.UTC)) {
		t.Errorf("market hours on a Friday night: %v", at)
	}
	// A broken schedule still has a next check.
	b = Bot{IntervalSeconds: 1800, Schedule: jsonMap[string, any]{}}
	if at := s.agentNextAt(b, nil, kolkata, now); at.Before(now.Add(29 * time.Minute)) {
		t.Errorf("no schedule: %v", at)
	}
}
