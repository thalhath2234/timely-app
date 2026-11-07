package bots

import (
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

// TestContractLimits reads BOT_LIMITS from the shared contract that the web
// and phone apps draw from and fails when a value drifts from what the API
// enforces.
func TestContractLimits(t *testing.T) {
	src, err := os.ReadFile("../../../../../packages/contract/src/bots.ts")
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}
	block := regexp.MustCompile(`(?s)export const BOT_LIMITS = \{(.*?)\n\} as const;`).FindSubmatch(src)
	if block == nil {
		t.Fatal("BOT_LIMITS block not found in packages/contract/src/bots.ts")
	}
	body := block[1]
	num := func(re string) int {
		t.Helper()
		m := regexp.MustCompile(re).FindSubmatch(body)
		if m == nil {
			t.Fatalf("BOT_LIMITS: no match for %s", re)
		}
		n, err := strconv.Atoi(string(m[1]))
		if err != nil {
			t.Fatalf("BOT_LIMITS: %s: %v", re, err)
		}
		return n
	}
	key := func(k string) int { return num(`\b` + k + `:\s*(\d+)\s*,`) }
	every := func(k string) int {
		return num(`minEveryMinutes:\s*\{[^}]*\b` + k + `:\s*(\d+)`)
	}
	minutes := func(d time.Duration) int { return int(d / time.Minute) }

	cases := []struct {
		name      string
		got, want int
	}{
		{"maxBots", key("maxBots"), MaxBots},
		{"maxWatches", key("maxWatches"), MaxWatches},
		{"maxRulesPerWatch", key("maxRulesPerWatch"), MaxRulesPerWatch},
		{"alertsPerDay", key("alertsPerDay"), AlertsPerDay},
		{"maxLessons", key("maxLessons"), MaxLessons},
		{"maxStrikes", key("maxStrikes"), MaxStrikes},
		{"maxNameLen", key("maxNameLen"), MaxNameLen},
		{"maxDescriptionLen", key("maxDescriptionLen"), MaxDescriptionLen},
		{"minEveryMinutes.page", every("page"), minutes(MinEvery(Watch{Kind: WatchPage}))},
		{"minEveryMinutes.feed", every("feed"), minutes(MinEvery(Watch{Kind: WatchFeed}))},
		{"minEveryMinutes.price", every("price"), minutes(MinEvery(Watch{Kind: WatchPrice}))},
		{"minEveryMinutes.shop", every("shop"), minutes(MinEvery(Watch{Kind: WatchPage, ReadMode: ReadProductPrice}))},
		{"maxEveryMinutes", key("maxEveryMinutes"), minutes(maxInterval)},
		{"maxSnoozeDays", key("maxSnoozeDays"), int(maxSnooze / (24 * time.Hour))},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("BOT_LIMITS.%s = %d, API has %d", c.name, c.got, c.want)
		}
	}
}

// TestContractWords checks that the words the clients switch on (read modes,
// check triggers, answer freshness, the Not useful reasons) are the ones the
// API writes.
func TestContractWords(t *testing.T) {
	src, err := os.ReadFile("../../../../../packages/contract/src/bots.ts")
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}
	union := func(name string) []string {
		t.Helper()
		m := regexp.MustCompile(`export type ` + name + ` =([^;]*);`).FindSubmatch(src)
		if m == nil {
			t.Fatalf("type %s not found in bots.ts", name)
		}
		var out []string
		for _, w := range regexp.MustCompile(`"([a-z_]+)"`).FindAllSubmatch(m[1], -1) {
			out = append(out, string(w[1]))
		}
		return out
	}
	var reasons []string
	block := regexp.MustCompile(`(?s)export const FEEDBACK_REASONS[^=]*= \[(.*?)\];`).FindSubmatch(src)
	if block == nil {
		t.Fatal("FEEDBACK_REASONS not found in bots.ts")
	}
	for _, m := range regexp.MustCompile(`id: "([a-z_]+)"`).FindAllSubmatch(block[1], -1) {
		reasons = append(reasons, string(m[1]))
	}
	cases := []struct {
		name      string
		got, want []string
	}{
		{"ReadMode", union("ReadMode"), []string{ReadText, ReadSelector, ReadProductPrice, ReadSelectorPrice}},
		{"WatchKind", union("WatchKind"), []string{WatchPage, WatchFeed, WatchPrice}},
		{"PauseReason", union("PauseReason"), []string{PausePerson, PauseStrikes, PauseMCP}},
		{"CheckTrigger", union("CheckTrigger"), []string{TriggerSchedule, TriggerWake, TriggerRunNow, TriggerAsk}},
		{"AnswerFresh", union("AnswerFresh"), []string{FreshCheckedNow, FreshRecent, FreshWaiting, FreshPaused, FreshLimited, FreshFloor}},
		{"Feedback", union("Feedback"), []string{FeedbackUseful, FeedbackNotUseful}},
		{"FEEDBACK_REASONS", reasons, FeedbackReasons},
	}
	for _, c := range cases {
		if strings.Join(c.got, ",") != strings.Join(c.want, ",") {
			t.Errorf("%s in bots.ts is %v, API has %v", c.name, c.got, c.want)
		}
	}
}
