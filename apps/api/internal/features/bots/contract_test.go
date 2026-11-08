package bots

import (
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/bots/extract"
	"timely-api/internal/utils"
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
		{"aiPerBot", key("aiPerBot"), AIPerBot},
		{"aiPerAccount", key("aiPerAccount"), AIPerAccount},
		{"chainAi", key("chainAi"), ChainAI},
		{"maxLinks", key("maxLinks"), MaxLinks},
		{"maxBriefSources", key("maxBriefSources"), MaxBriefSources},
		{"briefItemsPerBot", key("briefItemsPerBot"), BriefItemsPerBot},
		{"linkPerDay", key("linkPerDay"), LinkPerDay},
		{"passPerCheck", key("passPerCheck"), PassPerCheck},
		{"chainSteps", key("chainSteps"), ChainSteps},
		{"maxFilterWords", key("maxFilterWords"), MaxFilterWords},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("BOT_LIMITS.%s = %d, API has %d", c.name, c.got, c.want)
		}
	}
}

// TestContractWords checks that the words the clients switch on (read modes,
// check triggers and outcomes, rule kinds, availability, answer freshness, the Not useful reasons, judging, bot and
// link kinds, AI states, urgency, alert kinds and holds) are the ones the API
// writes. An empty string in a union counts as a word, so AiState's "" (rules
// only) and AlertHeld's "" (sent) are checked too.
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
		for _, w := range regexp.MustCompile(`"([a-z_]*)"`).FindAllSubmatch(m[1], -1) {
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
	pass := regexp.MustCompile(`export const PASS_FEEDBACK = \{ id: "([a-z_]+)"`).FindSubmatch(src)
	if pass == nil {
		t.Fatal("PASS_FEEDBACK not found in bots.ts")
	}
	cases := []struct {
		name      string
		got, want []string
	}{
		{"ReadMode", union("ReadMode"), []string{ReadText, ReadSelector, ReadProductPrice, ReadSelectorPrice}},
		{"WatchKind", union("WatchKind"), []string{WatchPage, WatchFeed, WatchPrice}},
		{"PauseReason", union("PauseReason"), []string{PausePerson, PauseStrikes, PauseMCP}},
		{"CheckTrigger", union("CheckTrigger"), []string{TriggerSchedule, TriggerWake, TriggerRunNow, TriggerAsk, TriggerPass}},
		{"AnswerFresh", union("AnswerFresh"), []string{FreshCheckedNow, FreshRecent, FreshWaiting, FreshPaused, FreshLimited, FreshFloor}},
		{"Feedback", union("Feedback"), []string{FeedbackUseful, FeedbackNotUseful}},
		{"FEEDBACK_REASONS", reasons, FeedbackReasons},
		{"PASS_FEEDBACK.id", []string{string(pass[1])}, []string{PassFeedbackReason}},
		{"FeedbackReason", union("FeedbackReason"), append(append([]string{""}, FeedbackReasons...), PassFeedbackReason)},
		{"JudgeMode", union("JudgeMode"), []string{JudgeRules, JudgeAI}},
		{"BotKind", union("BotKind"), []string{KindWatch, KindBrief}},
		{"LinkKind", union("LinkKind"), []string{LinkPass, LinkBrief}},
		{"AiState", union("AiState"), []string{"", aiJudged, aiUnchecked, aiRejudged}},
		{"Urgency", union("Urgency"), []string{UrgencyLow, UrgencyNormal, UrgencyHigh}},
		{"AlertKind", union("AlertKind"), []string{alertKindAlert, alertKindMore, alertKindPaused, alertKindBrief}},
		{"AlertHeld", union("AlertHeld"), []string{"", heldSnoozed, heldCap, heldJudged, heldShared}},
		{"AwayReason", union("AwayReason"), []string{AwayClosed, AwayAsleep, AwayAllPaused}},
		{"RuleKind", union("RuleKind"), []string{RuleAnyChange, RuleAbove, RuleBelow, RuleMovePct, RuleWordsAppear, RuleWordsDisappear, RuleNewItem, RuleInStock}},
		{"Availability", union("Availability"), []string{extract.AvailInStock, extract.AvailOutOfStock, extract.AvailPreorder, extract.AvailBackorder, extract.AvailLimited, extract.AvailDiscontinued, extract.AvailUnknown}},
		{"CheckOutcome", union("CheckOutcome"), []string{outBaseline, outUnchanged, outNotModified, outChanged, outFired, outOffline, outRateLimited, outSiteBusy, outRobots, outStrike, outSuperseded, outJudgedQuiet, outPassed, outHeldStock}},
	}
	for _, c := range cases {
		if strings.Join(c.got, ",") != strings.Join(c.want, ",") {
			t.Errorf("%s in bots.ts is %v, API has %v", c.name, c.got, c.want)
		}
	}
}

// TestContractAway checks the catch-up words: each AWAY_WHILE value in the
// contract is the API's awayWhile for the same reason, with no reason missing
// on either side, and AlertFigures names every figure an AlertView passes on
// (away among them).
func TestContractAway(t *testing.T) {
	src, err := os.ReadFile("../../../../../packages/contract/src/bots.ts")
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}
	block := regexp.MustCompile(`(?s)export const AWAY_WHILE: Record<AwayReason, string> = \{(.*?)\n\};`).FindSubmatch(src)
	if block == nil {
		t.Fatal("AWAY_WHILE not found in bots.ts")
	}
	got := map[string]string{}
	for _, m := range regexp.MustCompile(`(?m)^\s*([a-z_]+):\s*"([^"]*)",?\s*$`).FindAllSubmatch(block[1], -1) {
		got[string(m[1])] = string(m[2])
	}
	if len(got) != len(awayWhile) {
		t.Errorf("AWAY_WHILE in bots.ts has %d reasons, API awayWhile has %d", len(got), len(awayWhile))
	}
	for reason, want := range awayWhile {
		if got[reason] != want {
			t.Errorf("AWAY_WHILE.%s in bots.ts is %q, API has %q", reason, got[reason], want)
		}
	}

	figures := regexp.MustCompile(`(?s)export type AlertFigures = \{(.*?)\n\};`).FindSubmatch(src)
	if figures == nil {
		t.Fatal("AlertFigures not found in bots.ts")
	}
	fields := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?m)^\s*([A-Za-z]+)\??:`).FindAllSubmatch(figures[1], -1) {
		fields[string(m[1])] = true
	}
	for _, k := range alertFigureKeys {
		if !fields[k] {
			t.Errorf("AlertFigures in bots.ts has no %q, but AlertView passes it on", k)
		}
	}
}

// TestContractBotID checks that the clients' isBotId pattern, the only gate
// before a Live block fetches a bot, accepts the ids the API makes and
// refuses a name or a sibling path of /bots/:id.
func TestContractBotID(t *testing.T) {
	src, err := os.ReadFile("../../../../../packages/contract/src/bots.ts")
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}
	m := regexp.MustCompile(`export const isBotId = [^\n]*?/(\^[^/\n]+\$)/\.test\(v\)`).FindSubmatch(src)
	if m == nil {
		t.Fatal("isBotId's pattern not found in bots.ts")
	}
	re, err := regexp.Compile(string(m[1]))
	if err != nil {
		t.Fatalf("isBotId's pattern %q does not compile: %v", m[1], err)
	}
	for i := 0; i < 5; i++ {
		if id := utils.PrefixedUUID("bot"); !re.MatchString(id) {
			t.Errorf("isBotId refuses the API's id %q", id)
		}
	}
	for _, v := range []string{"keys", "Price watch", "bot_", `bot_"x`, "rem_" + strings.Repeat("a", 8)} {
		if re.MatchString(v) {
			t.Errorf("isBotId accepts %q", v)
		}
	}
}
