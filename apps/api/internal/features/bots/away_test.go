package bots

import (
	"math/rand/v2"
	"testing"
	"time"
)

// Wake checks take one slot each on one tail: the first WakeSettle+WakeStep
// from now, each next WakeStep later, with at most WakeStep/2 of jitter, and
// a tail left in the past starts again from now.
func TestWakeSlot(t *testing.T) {
	s := &Service{rnd: rand.New(rand.NewPCG(1, 2))}
	now := time.Date(2026, 11, 8, 9, 0, 0, 0, time.UTC)
	var prev time.Time
	for i := range 25 {
		got := s.wakeSlot(now)
		slot := now.Add(WakeSettle + time.Duration(i+1)*WakeStep)
		if !s.wakeTail.Equal(slot) || got.Before(slot) || got.After(slot.Add(WakeStep/2)) {
			t.Fatalf("slot %d: %v (tail %v), want %v + up to %v", i, got.Sub(now), s.wakeTail.Sub(now), slot.Sub(now), WakeStep/2)
		}
		if i > 0 && got.Sub(prev) < WakeStep/2 {
			t.Fatalf("slots %d and %d are %v apart", i-1, i, got.Sub(prev))
		}
		prev = got
	}
	// An hour later the tail is in the past: the next slot starts from now.
	later := now.Add(time.Hour)
	got := s.wakeSlot(later)
	if first := later.Add(WakeSettle + WakeStep); !s.wakeTail.Equal(first) || got.Before(first) || got.After(first.Add(WakeStep/2)) {
		t.Fatalf("after the tail passed: %v (tail %v)", got.Sub(later), s.wakeTail.Sub(later))
	}
}

func TestAwayLine(t *testing.T) {
	for _, c := range []struct {
		secs   int
		reason string
		want   string
	}{
		{32400, AwayClosed, "Paused for 9 hours while Timely was closed"},
		{32400, AwayAsleep, "Paused for 9 hours while this computer was asleep"},
		{2700, AwayAllPaused, "Paused for 45 minutes while all bots were paused"},
		{5400, AwayClosed, "Paused for 2 hours while Timely was closed"},
		{3 * 86400, AwayAsleep, "Paused for 3 days while this computer was asleep"},
		{32400, "elsewhere", ""},
		{0, AwayClosed, ""},
	} {
		if got := awayLine(c.secs, c.reason); got != c.want {
			t.Errorf("awayLine(%d, %q) = %q, want %q", c.secs, c.reason, got, c.want)
		}
	}
	if len(awayWhile) != 3 {
		t.Fatalf("%d away reasons", len(awayWhile))
	}
}

func TestAwayOf(t *testing.T) {
	since := time.Date(2026, 11, 8, 0, 0, 0, 0, time.UTC)
	until, reason := since.Add(9*time.Hour+400*time.Millisecond), AwayClosed
	secs, r := awayOf(Bot{AwaySince: &since, AwayUntil: &until, AwayReason: &reason})
	if secs == nil || *secs != 32400 || *r != AwayClosed {
		t.Fatalf("away %v %v", secs, r)
	}
	if secs, _ := awayOf(Bot{AwaySince: &since, AwayUntil: &since, AwayReason: &reason}); *secs != 1 {
		t.Fatalf("a zero gap is %d seconds", *secs)
	}
	if secs, r := awayOf(Bot{}); secs != nil || r != nil {
		t.Fatal("a Bot with no gap has one")
	}
	if got := awayLineOf(nil, nil); got != "" {
		t.Fatalf("no gap words %q", got)
	}
}

// The unchecked mark goes before the away line, which stays last.
func TestNotificationBodyWithAway(t *testing.T) {
	line := awayLine(32400, AwayClosed)
	figures := jsonMap[string, any]{"what": "up 2.0%", "away": line}
	for _, c := range []struct {
		name string
		a    Alert
		want string
	}{
		{"unchecked", Alert{AIState: aiUnchecked, Body: withAway("BTC now $102 (was $100)", line), Figures: figures},
			"BTC now $102 (was $100) (not checked by AI)\n" + line},
		{"unchecked, marked before", Alert{AIState: aiUnchecked, Body: withAway("Sale on"+uncheckedSuffix, line), Figures: figures},
			"Sale on (not checked by AI)\n" + line},
		{"unchecked, empty body", Alert{AIState: aiUnchecked, Body: withAway("", line), Figures: figures},
			"(not checked by AI)\n" + line},
		{"unchecked, no gap", Alert{AIState: aiUnchecked, Body: "Sale on", Figures: jsonMap[string, any]{}}, "Sale on (not checked by AI)"},
		{"judged", Alert{AIState: aiJudged, Body: withAway("Worth knowing", line), Figures: figures}, "Worth knowing\n" + line},
		{"rules", Alert{Body: withAway("Now $9", line), Figures: figures}, "Now $9\n" + line},
	} {
		if got := notificationBody(c.a); got != c.want {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}
}

// The next judge input never reads "Paused for …": it is the code's line
// about Timely, not about what the Bot saw.
func TestLastAlertForDropsAway(t *testing.T) {
	line := awayLine(32400, AwayAsleep)
	at := time.Date(2026, 11, 7, 14, 30, 0, 0, time.UTC)
	a := Alert{Title: "Deals: page changed", Body: withAway("Sale on", line), AIState: aiUnchecked, CreatedAt: at,
		Figures: jsonMap[string, any]{"what": "page changed", "away": line}}
	if got := lastAlertFor(a, "Deals", time.UTC); got.Body != "Sale on" {
		t.Fatalf("judge input body %q", got.Body)
	}
	// A body that only tells of the gap (an item with no line) gives none.
	a.Body = withAway("", line)
	if got := lastAlertFor(a, "Deals", time.UTC); got.Body != "" {
		t.Fatalf("judge input body %q", got.Body)
	}
}

func TestAlertViewPassesAway(t *testing.T) {
	line := awayLine(600*60, AwayClosed)
	v := alertView(Alert{Figures: jsonMap[string, any]{"away": line, "what": "up 2.0%", "rule": RuleMovePct}})
	if v.Figures["away"] != line || v.Figures["what"] != nil || v.Figures["rule"] != RuleMovePct {
		t.Fatalf("figures %v", v.Figures)
	}
}
