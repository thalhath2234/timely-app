package bots

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

func pixelBot(t *testing.T, rules ...Rule) (Bot, []Watch) {
	t.Helper()
	w := shopWatch(t, rules...)
	w.URL = "https://www.flipkart.com/google-pixel-10-pro/p/itm1"
	b := Bot{ID: "bot_pixel", Name: "Pixel 10 Pro under ₹90,000", IntervalSeconds: 6 * 3600}
	return b, []Watch{w}
}

// The Pixel rule bot, written as an agent Bot.
func TestConvertPromptPixel(t *testing.T) {
	b, ws := pixelBot(t, Rule{Kind: RuleBelow, Threshold: f(90000)})
	prompt, sched, skills := ConvertPrompt(b, ws)
	want := "Pixel 10 Pro under ₹90,000. Watch https://www.flipkart.com/google-pixel-10-pro/p/itm1. " +
		"Alert when the price is below ₹90,000 and it can be bought (in stock). Stay silent otherwise."
	if prompt != want {
		t.Errorf("prompt\n got %q\nwant %q", prompt, want)
	}
	if sched.EveryMinutes != 360 || sched.Kind() != ScheduleEvery {
		t.Errorf("schedule %+v, want every 6 h", sched)
	}
	if !reflect.DeepEqual(skills, []string{"product-price-monitor"}) {
		t.Errorf("skills %v", skills)
	}
	c := ConvertBot(b, ws)
	if c.Prompt != want || c.Gate != GateChanged {
		t.Errorf("ConvertBot %+v", c)
	}
}

func TestConvertPromptStockClause(t *testing.T) {
	no := false
	cases := []struct {
		name string
		rule Rule
		want string
	}{
		{"above", Rule{Kind: RuleAbove, Threshold: f(100000)}, "Alert when the price is above ₹100,000 and it can be bought (in stock)."},
		{"move", Rule{Kind: RuleMovePct, Percent: f(5), Direction: DirDown}, "Alert when the price drops 5% and it can be bought (in stock)."},
		{"in stock or not", Rule{Kind: RuleBelow, Threshold: f(90000), OnlyInStock: &no}, "Alert when the price is below ₹90,000, in stock or not."},
		{"restock", Rule{Kind: RuleInStock}, "Alert when back in stock."},
		{"any change", Rule{Kind: RuleAnyChange}, "Alert when anything changes."},
	}
	for _, c := range cases {
		b, ws := pixelBot(t, c.rule)
		prompt, _, _ := ConvertPrompt(b, ws)
		if !strings.Contains(prompt, c.want) {
			t.Errorf("%s: %q lacks %q", c.name, prompt, c.want)
		}
	}
	// Two rules on one product are joined with "or", each with the clause.
	b, ws := pixelBot(t, Rule{Kind: RuleBelow, Threshold: f(90000)}, Rule{Kind: RuleInStock})
	prompt, _, _ := ConvertPrompt(b, ws)
	want := "Alert when the price is below ₹90,000 and it can be bought (in stock) or back in stock."
	if !strings.Contains(prompt, want) {
		t.Errorf("%q lacks %q", prompt, want)
	}
}

func TestConvertPromptOtherWatches(t *testing.T) {
	// A page that is not a shop price takes no stock clause and no skill.
	pg := Watch{Kind: WatchPage, ReadMode: ReadText, URL: "https://example.com/visa",
		Rules: jsonList[Rule]{{Kind: RuleWordsAppear, Words: []string{"appointments available", "slots"}}}}
	b := Bot{Name: "Visa dates", Description: "tell me when slots open", IntervalSeconds: 3600}
	prompt, sched, skills := ConvertPrompt(b, []Watch{pg})
	want := "Visa dates. tell me when slots open. Watch https://example.com/visa. " +
		"Alert when “appointments available” or “slots” appears. Stay silent otherwise."
	if prompt != want {
		t.Errorf("prompt\n got %q\nwant %q", prompt, want)
	}
	if sched.EveryMinutes != 60 || len(skills) != 0 || skills == nil {
		t.Errorf("schedule %+v, skills %#v", sched, skills)
	}

	// A feed's new-post rule, a quote's symbol, two watches.
	feedW := Watch{Kind: WatchFeed, URL: "https://example.com/feed.xml", Rules: jsonList[Rule]{{Kind: RuleNewItem, Words: []string{"sale"}}}}
	quoteW := Watch{Kind: WatchPrice, Symbol: "AAPL", Currency: "USD", Rules: jsonList[Rule]{{Kind: RuleBelow, Threshold: f(150)}}}
	prompt, _, _ = ConvertPrompt(Bot{Name: "Mixed", IntervalSeconds: 1800}, []Watch{feedW, quoteW})
	want = "Mixed. Watch https://example.com/feed.xml. Alert when a new post with “sale”. " +
		"Watch AAPL. Alert when the price is below $150. Stay silent otherwise."
	if prompt != want {
		t.Errorf("prompt\n got %q\nwant %q", prompt, want)
	}
}

func TestConvertScheduleIsClampedToTheFloor(t *testing.T) {
	b, ws := pixelBot(t, Rule{Kind: RuleBelow, Threshold: f(90000)})
	b.IntervalSeconds = 600 // a rules Bot never had less than its floor, but a bad row must not escape
	if _, sched, _ := ConvertPrompt(b, ws); sched.EveryMinutes != 360 {
		t.Errorf("schedule %+v, want 6 h", sched)
	}
	b.IntervalSeconds = 0
	if _, sched, _ := ConvertPrompt(b, ws); sched.EveryMinutes != 360 {
		t.Errorf("no interval: %+v, want the default 6 h", sched)
	}
	// A Bot with no Reads (a brief) runs on its schedule.
	c := ConvertBot(Bot{Name: "Brief", IntervalSeconds: int((24 * time.Hour).Seconds())}, nil)
	if c.Gate != GateAlways || c.Schedule.EveryMinutes != 1440 {
		t.Errorf("no Reads: %+v", c)
	}
}

// A brief becomes an agent prompt over its sources' notes, scheduled at its
// daily time, with the gate always and no skills (plan 7.8).
func TestConvertBrief(t *testing.T) {
	b := Bot{ID: "bot_brief", Name: "Morning", Description: "What my bots found overnight", Kind: KindBrief, BriefTime: "07:30"}
	prompt, sched, skills := ConvertPrompt(b, nil)
	if !strings.HasPrefix(prompt, "Morning. What my bots found overnight. Sum up what these bots found since the last brief") {
		t.Errorf("prompt %q", prompt)
	}
	if sched.Kind() != ScheduleDaily || sched.DailyAt != "07:30" || sched.EveryMinutes != 0 || len(sched.Weekdays) != 0 || len(skills) != 0 {
		t.Errorf("schedule %+v skills %v", sched, skills)
	}
	if c := ConvertBot(b, nil); c.Prompt != prompt || c.Gate != GateAlways {
		t.Errorf("ConvertBot %+v", c)
	}
	// A brief with no time of its own runs at the default.
	b.BriefTime = ""
	if _, sched, _ = ConvertPrompt(b, nil); sched.DailyAt != DefaultBriefTime {
		t.Errorf("default time %+v", sched)
	}
}
