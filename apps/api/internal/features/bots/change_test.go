package bots

import (
	"encoding/json"
	"strings"
	"testing"
)

// The cases mirror packages/contract/src/bots.ts widensBot: a new signed-in
// browser site, memory turned on or a looser permission mode widens; nothing
// else does.
func TestWidensMirrorsTheContract(t *testing.T) {
	base := Reach{Permission: PermissionAuto, BrowserSites: []string{"shop.example"}, UseMemory: false}
	cases := []struct {
		name   string
		after  Reach
		reason string
	}{
		{"same", base, ""},
		{"new site", Reach{Permission: PermissionAuto, BrowserSites: []string{"shop.example", "bank.example"}}, WidenBrowserSite},
		{"site in another case or with spaces is the same site", Reach{Permission: PermissionAuto, BrowserSites: []string{" SHOP.example "}}, ""},
		{"a site removed", Reach{Permission: PermissionAuto}, ""},
		{"memory on", Reach{Permission: PermissionAuto, BrowserSites: []string{"shop.example"}, UseMemory: true}, WidenMemory},
		{"looser permission", Reach{Permission: PermissionFull, BrowserSites: []string{"shop.example"}}, WidenPermission},
		{"tighter permission", Reach{Permission: PermissionSupervised, BrowserSites: []string{"shop.example"}}, ""},
		{"unknown permission never widens", Reach{Permission: "other", BrowserSites: []string{"shop.example"}}, ""},
	}
	for _, c := range cases {
		if got := WidenReason(base, c.after); got != c.reason {
			t.Errorf("%s: reason %q, want %q", c.name, got, c.reason)
		}
		if got := Widens(base, c.after); got != (c.reason != "") {
			t.Errorf("%s: Widens %v", c.name, got)
		}
	}
	// Memory that was already on turned off, then on again is a change from
	// off; from on to on is not.
	on := Reach{Permission: PermissionAuto, UseMemory: true}
	if Widens(on, on) || Widens(on, Reach{Permission: PermissionAuto}) {
		t.Fatal("memory already on, or turned off, must not widen")
	}
	// The three steps of the permission ladder.
	for _, p := range [][2]string{{PermissionSupervised, PermissionAuto}, {PermissionAuto, PermissionFull}, {PermissionSupervised, PermissionFull}} {
		if !Widens(Reach{Permission: p[0]}, Reach{Permission: p[1]}) {
			t.Errorf("%s -> %s must widen", p[0], p[1])
		}
	}
}

func TestChangedLine(t *testing.T) {
	if got := ChangedLine("alert under 90000", "alert under 85000"); got != "Changed: alert under 90000 -> alert under 85000" {
		t.Fatalf("line %q", got)
	}
	r := ChangeResult{Before: "a", After: "b"}
	if r.Line() != "Changed: a -> b" {
		t.Fatalf("applied line %q", r.Line())
	}
	r.Pending = true
	if !strings.HasPrefix(r.Line(), "Waiting for your tap") {
		t.Fatalf("pending line %q", r.Line())
	}
}

func agentBotFixture() Bot {
	return Bot{
		ID: "bot_1", Name: "Pixel", Engine: EngineAgent, Prompt: "Alert under 90000", Timezone: "Asia/Kolkata",
		Schedule: Schedule{EveryMinutes: 360}.Map(), Permission: PermissionAuto, Gate: GateChanged,
		Tools: AgentTools{BrowserSites: []string{"shop.example"}, Egress: []string{}, MCP: map[string]string{"files": "ask"}},
	}
}

func TestDiffAndInverse(t *testing.T) {
	b := agentBotFixture()
	prompt := "Alert under 85000"
	every := json.RawMessage(`"every 1h"`)
	perm := PermissionSupervised
	memory := true
	in := ChangeInput{AgentInput: AgentInput{Prompt: &prompt, Schedule: every, Permission: &perm, Tools: &ToolsInput{UseMemory: &memory}}}
	next, err := CleanAgent(in.AgentInput, &b, nil, OriginChat)
	if err != nil {
		t.Fatal(err)
	}
	before, after := diffOf(b, next, in).words()
	for _, want := range []string{`prompt "Alert under 90000"`, "schedule every 6h", "permission auto", "memory off"} {
		if !strings.Contains(before, want) {
			t.Errorf("before %q lacks %q", before, want)
		}
	}
	for _, want := range []string{`prompt "Alert under 85000"`, "schedule every 1h", "permission supervised", "memory on"} {
		if !strings.Contains(after, want) {
			t.Errorf("after %q lacks %q", after, want)
		}
	}
	inv := inverseOf(b, in)
	if inv.Prompt == nil || *inv.Prompt != "Alert under 90000" || inv.Permission == nil || *inv.Permission != PermissionAuto {
		t.Fatalf("inverse %+v", inv)
	}
	if inv.Tools == nil || inv.Tools.UseMemory == nil || *inv.Tools.UseMemory || inv.Tools.BrowserSites != nil {
		t.Fatalf("the inverse restores only what the change touched: %+v", inv.Tools)
	}
	if string(inv.Schedule) != `{"everyMinutes":360}` {
		t.Fatalf("schedule inverse %s", inv.Schedule)
	}
	// The inverse of the inverse puts the change back, and checks clean.
	if _, err := CleanAgent(inv.AgentInput, &b, nil, OriginChat); err != nil {
		t.Fatalf("the inverse must pass CleanAgent: %v", err)
	}
	// A change that sets a field to what it already is moves nothing.
	same := ChangeInput{AgentInput: AgentInput{Permission: ptrTo(PermissionAuto)}}
	nextSame, err := CleanAgent(same.AgentInput, &b, nil, OriginChat)
	if err != nil {
		t.Fatal(err)
	}
	if got := diffOf(b, nextSame, same); len(got) != 0 {
		t.Fatalf("no move expected, got %+v", got)
	}
}

// A prompt edit reads as the words that moved, after the few words before
// them, never as two whole prompts.
func TestPromptWordsShowWhatMoved(t *testing.T) {
	cases := []struct{ was, next, from, to string }{
		{"Alert under 90000", "Alert under 85000", "Alert under 90000", "Alert under 85000"},
		{"Alert me when the Pixel is under 90000 and in stock", "Alert me when the Pixel is under 85000 and in stock",
			"...Pixel is under 90000", "...Pixel is under 85000"},
		{"Watch the Pixel", "Watch the Pixel and the Galaxy", "Watch the Pixel", "Watch the Pixel and the Galaxy"},
		{"Tell me about rain", "Summarise the news", "Tell me about rain", "Summarise the news"},
	}
	for _, c := range cases {
		if from, to := promptWords(c.was, c.next); from != c.from || to != c.to {
			t.Errorf("%q -> %q: %q -> %q, want %q -> %q", c.was, c.next, from, to, c.from, c.to)
		}
	}
	b := agentBotFixture()
	b.Prompt = "Alert me when the Pixel is under 90000 and it can be bought"
	prompt := "Alert me when the Pixel is under 85000 and it can be bought"
	in := ChangeInput{AgentInput: AgentInput{Prompt: &prompt}}
	next, err := CleanAgent(in.AgentInput, &b, nil, OriginChat)
	if err != nil {
		t.Fatal(err)
	}
	if before, after := diffOf(b, next, in).words(); before != `prompt "...Pixel is under 90000"` || after != `prompt "...Pixel is under 85000"` {
		t.Fatalf("line %q -> %q", before, after)
	}
}

func TestScheduleWords(t *testing.T) {
	cases := map[string]Schedule{
		"every 6h":         {EveryMinutes: 360},
		"every 45m":        {EveryMinutes: 45},
		"every 2d":         {EveryMinutes: 2 * 24 * 60},
		"daily at 09:00":   {DailyAt: "09:00", Weekdays: []int{0, 1, 2, 3, 4, 5, 6}},
		"Mon Tue at 09:00": {DailyAt: "09:00", Weekdays: []int{1, 2}},
		"cron 0 9 * * *":   {Cron: "0 9 * * *"},
		"never":            {},
	}
	for want, s := range cases {
		if got := scheduleWords(s); got != want {
			t.Errorf("%+v: %q, want %q", s, got, want)
		}
	}
}

func TestLineEndKeepsOneShortLine(t *testing.T) {
	got := lineEnd("alert\n  under    85000 " + strings.Repeat("x", 200))
	if strings.ContainsAny(got, "\n\t") || len([]rune(got)) > maxMoveWords+1 || !strings.HasPrefix(got, "alert under 85000") {
		t.Fatalf("line end %q", got)
	}
}

// After page text was read in the turn, a new egress host or a tool server
// turned on waits for the tap as well; without it they apply at once.
func TestTaintedWidenReasonHoldsEgressAndMCP(t *testing.T) {
	base := Reach{Permission: PermissionAuto, Egress: []string{"api.example.com"}, MCP: map[string]string{"files": "ask", "notes": "off"}}
	cases := []struct {
		name   string
		after  Reach
		reason string
	}{
		{"same", base, ""},
		{"new host", Reach{Permission: PermissionAuto, Egress: []string{"api.example.com", "evil.example"}, MCP: base.MCP}, WidenEgress},
		{"host in another case is the same", Reach{Permission: PermissionAuto, Egress: []string{" API.example.com "}, MCP: base.MCP}, ""},
		{"host removed", Reach{Permission: PermissionAuto, MCP: base.MCP}, ""},
		{"new server", Reach{Permission: PermissionAuto, Egress: base.Egress, MCP: map[string]string{"files": "ask", "notes": "off", "gmail": "ask"}}, WidenMCP},
		{"off to use", Reach{Permission: PermissionAuto, Egress: base.Egress, MCP: map[string]string{"files": "ask", "notes": "use"}}, WidenMCP},
		{"ask to use", Reach{Permission: PermissionAuto, Egress: base.Egress, MCP: map[string]string{"files": "use", "notes": "off"}}, WidenMCP},
		{"ask to off", Reach{Permission: PermissionAuto, Egress: base.Egress, MCP: map[string]string{"files": "off"}}, ""},
		{"new server off", Reach{Permission: PermissionAuto, Egress: base.Egress, MCP: map[string]string{"files": "ask", "x": "off"}}, ""},
		{"the base rule still holds", Reach{Permission: PermissionFull, Egress: base.Egress, MCP: base.MCP}, WidenPermission},
	}
	for _, c := range cases {
		if got := TaintedWidenReason(base, c.after); got != c.reason {
			t.Errorf("%s: reason %q, want %q", c.name, got, c.reason)
		}
		tainted := ChangeInput{AfterPageText: true}
		if got := tainted.WidenReason(base, c.after); got != c.reason {
			t.Errorf("%s: tainted change reason %q, want %q", c.name, got, c.reason)
		}
		// Without a page read, only the base rule holds.
		if got, want := (ChangeInput{}).WidenReason(base, c.after), WidenReason(base, c.after); got != want {
			t.Errorf("%s: plain change reason %q, want %q", c.name, got, want)
		}
	}
	if WidenReason(base, Reach{Permission: PermissionAuto, Egress: []string{"evil.example"}}) != "" {
		t.Fatal("a new host must apply at once without a page read")
	}
	// The flag is never stored: a held change replayed by the tap has none.
	b, _ := json.Marshal(ChangeInput{AfterPageText: true, From: "a", To: "b"})
	var back ChangeInput
	if err := json.Unmarshal(b, &back); err != nil || back.AfterPageText {
		t.Fatalf("stored %s: %+v %v", b, back, err)
	}
}
