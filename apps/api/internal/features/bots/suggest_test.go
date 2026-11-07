package bots

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func rated(id, feedback, reason, note string, figures jsonMap[string, any]) Alert {
	a := Alert{ID: id, Kind: alertKindAlert, Title: "BTC dip: below 25,000", Figures: figures, FeedbackReason: reason, FeedbackNote: note}
	if feedback != "" {
		a.Feedback = &feedback
	}
	return a
}

func TestLessonText(t *testing.T) {
	what := jsonMap[string, any]{"what": "below 25,000"}
	cases := []struct {
		name string
		a    Alert
		want string
	}{
		{"useful", rated("a", FeedbackUseful, "", "", what), "Wanted: “below 25,000”"},
		{"too small", rated("a", FeedbackNotUseful, "too_small", "", what), "Too small to tell me: “below 25,000”"},
		{"not wanted", rated("a", FeedbackNotUseful, "not_wanted", "", what), "Not what I want: “below 25,000”"},
		{"already knew", rated("a", FeedbackNotUseful, "already_knew", "", what), "I already knew: “below 25,000”"},
		{"no reason", rated("a", FeedbackNotUseful, "", "", what), "Not useful: “below 25,000”"},
		{"note", rated("a", FeedbackNotUseful, "too_small", "Only big dips", what), "Too small to tell me: “below 25,000”. Only big dips"},
		{"figures.what wins over the title", Alert{Title: "BTC dip: HACKED", Figures: jsonMap[string, any]{"what": "up 4.2%"}, Feedback: ptr(FeedbackUseful)}, "Wanted: “up 4.2%”"},
		{"old alert: prefix stripped", Alert{Title: "BTC dip: below 25,000", Feedback: ptr(FeedbackUseful)}, "Wanted: “below 25,000”"},
		{"old alert: quiet hours stripped", Alert{Title: "BTC dip: below 25,000 (at 23:15)", Feedback: ptr(FeedbackNotUseful), FeedbackReason: "not_wanted"}, "Not what I want: “below 25,000”"},
		{"old alert: another name kept", Alert{Title: "Old name: page changed", Feedback: ptr(FeedbackUseful)}, "Wanted: “Old name: page changed”"},
		{"nothing to say", Alert{Title: "BTC dip: ", Feedback: ptr(FeedbackUseful)}, "Wanted: “this alert”"},
		{"held by the judge", Alert{Held: heldJudged, Figures: what, Feedback: ptr(FeedbackUseful)}, "Should have told me: “below 25,000”"},
		{"passed on: names the Bot that passed it", Alert{Figures: what, Feedback: ptr(FeedbackNotUseful), FeedbackReason: PassFeedbackReason,
			Via: jsonList[ViaStep]{{Name: "Feed"}, {Name: "Middle"}}}, "Not worth passing on from Middle: “below 25,000”"},
	}
	for _, c := range cases {
		if got := lessonText(c.a, "BTC dip"); got != c.want {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}

	// A long name and a long note still fit the 200-character CHECK.
	name := strings.Repeat("n", MaxNameLen)
	a := Alert{Title: name + ": " + strings.Repeat("w", 150), Feedback: ptr(FeedbackNotUseful), FeedbackReason: "too_small", FeedbackNote: strings.Repeat("x", MaxFeedbackNote)}
	got := lessonText(a, name)
	if n := utf8.RuneCountInString(got); n != MaxLessonLen || !strings.HasPrefix(got, "Too small to tell me: “www") || !strings.HasSuffix(got, "…") {
		t.Fatalf("long lesson %q (%d)", got, n)
	}
	a.Title = strings.Repeat("é", 300)
	if n := utf8.RuneCountInString(lessonText(a, "other")); n > MaxLessonLen {
		t.Fatalf("long title gave %d characters", n)
	}
}

func ptr[T any](v T) *T { return &v }

func TestSuggestFor(t *testing.T) {
	price := Watch{ID: "bw_p", Kind: WatchPrice, Source: "coinbase", Symbol: "BTC"}
	page := Watch{ID: "bw_t", Kind: WatchPage, URL: "https://example.com/", ReadMode: ReadText}
	shop := Watch{ID: "bw_s", Kind: WatchPage, URL: "https://shop.example/", ReadMode: ReadProductPrice}
	feed := Watch{ID: "bw_f", Kind: WatchFeed, URL: "https://news.example/rss"}
	with := func(w Watch, rules ...Rule) Watch { w.Rules = rules; return w }
	move := func(p float64) Rule { return Rule{ID: "brl_1", Kind: RuleMovePct, Percent: &p, Direction: DirDown} }
	below := func(step float64) Rule {
		th := 25000.0
		return Rule{ID: "brl_1", Kind: RuleBelow, Threshold: &th, StepPercent: step, ResetPercent: 0.5}
	}
	anyChange := Rule{ID: "brl_1", Kind: RuleAnyChange}
	newItem := Rule{ID: "brl_1", Kind: RuleNewItem}
	words := Rule{ID: "brl_1", Kind: RuleWordsAppear, Words: []string{"sale"}}
	three := func(w Watch, reasons [3]string, figs ...jsonMap[string, any]) []Alert {
		out := make([]Alert, 3)
		for i := range out {
			f := jsonMap[string, any]{"watchId": w.ID, "rule": w.Rules[0].Kind}
			if i < len(figs) {
				for k, v := range figs[i] {
					f[k] = v
				}
			}
			out[i] = rated("bal_"+string(rune('a'+i)), FeedbackNotUseful, reasons[i], "", f)
		}
		return out
	}
	small := [3]string{"too_small", "too_small", "too_small"}
	knew := [3]string{"already_knew", "", ""}
	unwanted := [3]string{"not_wanted", "not_wanted", ""}
	none := [3]string{"", "", ""}
	bot := func(minutes int) Bot { return Bot{ID: "bot_1", JudgeMode: JudgeRules, IntervalSeconds: minutes * 60} }

	type want struct {
		line, button string
		percent      float64 // move_pct's new percent
		step         float64 // below's new step
		interval     int
		judge        string
	}
	cases := []struct {
		name    string
		bot     Bot
		w       Watch
		alerts  []Alert
		aiReady bool
		want    *want
	}{
		{"move: next step above the rule", bot(15), with(price, move(5)), three(with(price, move(5)), small), false,
			&want{line: "Only tell me about moves over 8%?", button: "Raise to 8%", percent: 8}},
		{"move: above the biggest move seen", bot(15), with(price, move(5)), three(with(price, move(5)), small, jsonMap[string, any]{"changePct": -9.5}, jsonMap[string, any]{"changePct": 6.0}), false,
			&want{line: "Only tell me about moves over 10%?", button: "Raise to 10%", percent: 10}},
		{"move: a move exactly on a step goes past it", bot(15), with(price, move(5)), three(with(price, move(5)), small, jsonMap[string, any]{"changePct": 8.0}), false,
			&want{line: "Only tell me about moves over 10%?", button: "Raise to 10%", percent: 10}},
		{"move: under the first step", bot(15), with(price, move(1)), three(with(price, move(1)), small), false,
			&want{line: "Only tell me about moves over 3%?", button: "Raise to 3%", percent: 3}},
		{"move: top of the ladder", bot(15), with(price, move(50)), three(with(price, move(50)), small), false, nil},
		{"move: not wanted has no fix", bot(15), with(price, move(5)), three(with(price, move(5)), unwanted), true, nil},
		{"move: no reason has no fix", bot(15), with(price, move(5)), three(with(price, move(5)), none), true, nil},
		{"below: default step 5 goes to 10", bot(15), with(price, below(0)), three(with(price, below(0)), small), false,
			&want{line: "Only tell me again after a further 10% move?", button: "Raise to 10%", step: 10}},
		{"below: step 12 goes to 15", bot(15), with(price, below(12)), three(with(price, below(12)), small), false,
			&want{line: "Only tell me again after a further 15% move?", button: "Raise to 15%", step: 15}},
		{"below: top of the ladder", bot(15), with(price, below(25)), three(with(price, below(25)), small), false, nil},
		{"any change on a shop price: a 5% move", bot(360), with(shop, anyChange), three(with(shop, anyChange), small), false,
			&want{line: "Only tell me about moves over 5%?", button: "Use 5%", percent: 5}},
		{"any change on text: check less often", bot(60), with(page, anyChange), three(with(page, anyChange), unwanted), false,
			&want{line: "Check every 2 hours instead?", button: "Every 2 h", interval: 120}},
		{"any change on text, no reason", bot(15), with(page, anyChange), three(with(page, anyChange), none), false,
			&want{line: "Check every 30 minutes instead?", button: "Every 30 min", interval: 30}},
		{"already knew on a move: check less often", bot(15), with(price, move(5)), three(with(price, move(5)), knew), false,
			&want{line: "Check every 30 minutes instead?", button: "Every 30 min", interval: 30}},
		{"interval: the floor rules out shorter steps", bot(15), with(shop, move(5)), three(with(shop, move(5)), knew), false,
			&want{line: "Check every 6 hours instead?", button: "Every 6 h", interval: 360}},
		{"interval: a shop's 6 h floor", bot(360), with(shop, move(5)), three(with(shop, move(5)), knew), false,
			&want{line: "Check every 12 hours instead?", button: "Every 12 h", interval: 720}},
		{"interval: once a day", bot(720), with(page, anyChange), three(with(page, anyChange), knew), false,
			&want{line: "Check once a day instead?", button: "Once a day", interval: 1440}},
		{"interval: once a week", bot(1440), with(page, anyChange), three(with(page, anyChange), knew), false,
			&want{line: "Check once a week instead?", button: "Once a week", interval: 10080}},
		{"interval: top of the ladder", bot(10080), with(page, anyChange), three(with(page, anyChange), knew), false, nil},
		{"interval: every hour", bot(30), with(page, anyChange), three(with(page, anyChange), knew), false,
			&want{line: "Check every hour instead?", button: "Every hour", interval: 60}},
		{"new items, AI ready", bot(30), with(feed, newItem), three(with(feed, newItem), unwanted), true,
			&want{line: "Let AI judge which ones matter?", button: "Turn on AI judging", judge: JudgeAI}},
		{"words, too small, AI ready", bot(30), with(page, words), three(with(page, words), small), true,
			&want{line: "Let AI judge which ones matter?", button: "Turn on AI judging", judge: JudgeAI}},
		{"new items without AI", bot(30), with(feed, newItem), three(with(feed, newItem), unwanted), false, nil},
		{"new items, no reason", bot(30), with(feed, newItem), three(with(feed, newItem), none), true, nil},
		// Ties: too_small beats not_wanted beats already_knew.
		{"tie: too small wins", bot(15), with(price, move(5)), three(with(price, move(5)), [3]string{"already_knew", "too_small", "not_wanted"}), false,
			&want{line: "Only tell me about moves over 8%?", button: "Raise to 8%", percent: 8}},
		{"tie: not wanted beats already knew", bot(30), with(feed, newItem), three(with(feed, newItem), [3]string{"already_knew", "not_wanted", ""}), true,
			&want{line: "Let AI judge which ones matter?", button: "Turn on AI judging", judge: JudgeAI}},
		{"majority: already knew twice", bot(15), with(price, move(5)), three(with(price, move(5)), [3]string{"already_knew", "too_small", "already_knew"}), false,
			&want{line: "Check every 30 minutes instead?", button: "Every 30 min", interval: 30}},
	}
	for _, c := range cases {
		got := suggestFor(c.bot, []Watch{c.w}, c.alerts, nil, c.aiReady)
		if c.want == nil {
			if got != nil {
				t.Errorf("%s: want none, got %+v", c.name, got)
			}
			continue
		}
		if got == nil {
			t.Errorf("%s: no suggestion", c.name)
			continue
		}
		if got.Line != c.want.line || got.Button != c.want.button || got.JudgeMode != c.want.judge || len(got.AlertIDs) != 3 || got.AlertIDs[0] != "bal_a" {
			t.Errorf("%s: %+v", c.name, got)
		}
		switch {
		case c.want.interval != 0:
			if got.IntervalMinutes == nil || *got.IntervalMinutes != c.want.interval || got.Rule != nil {
				t.Errorf("%s: interval %+v", c.name, got)
			}
		case c.want.percent != 0:
			if r := got.Rule; r == nil || r.Kind != RuleMovePct || r.Percent == nil || *r.Percent != c.want.percent || r.ID != "brl_1" || got.WatchID != c.w.ID || got.RuleID != "brl_1" {
				t.Errorf("%s: rule %+v", c.name, got.Rule)
			}
		case c.want.step != 0:
			if r := got.Rule; r == nil || r.Kind != RuleBelow || r.StepPercent != c.want.step || r.Threshold == nil || *r.Threshold != 25000 {
				t.Errorf("%s: rule %+v", c.name, got.Rule)
			}
		}
	}

	// The fired rule wins over the alert's figures, and a rule that is gone
	// gives nothing.
	two := with(price, move(5), Rule{ID: "brl_2", Kind: RuleMovePct, Percent: ptr(20.0), Direction: DirUp})
	alerts := three(two, small)
	got := suggestFor(bot(15), []Watch{two}, alerts, map[string]FiredRule{"bal_a": {WatchID: "bw_p", RuleID: "brl_2", Kind: RuleMovePct}}, false)
	if got == nil || got.RuleID != "brl_2" || got.Rule.Direction != DirUp || *got.Rule.Percent != 25 {
		t.Fatalf("fired rule %+v", got)
	}
	if got := suggestFor(bot(15), []Watch{two}, alerts, map[string]FiredRule{"bal_a": {WatchID: "bw_p", RuleID: "brl_gone", Kind: RuleMovePct}}, false); got != nil {
		t.Fatalf("gone rule %+v", got)
	}
	if got := suggestFor(bot(15), nil, alerts, nil, false); got != nil {
		t.Fatalf("no watches %+v", got)
	}
}
