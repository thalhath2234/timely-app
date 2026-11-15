package bots

import (
	"strings"
	"time"
)

// SkillProductPriceMonitor is the skill a converted Bot with a shop price
// Read loads (Timely's override copy, plan 9.2).
const SkillProductPriceMonitor = "product-price-monitor"

// stockClause is added to a price rule on a product page, so the converted
// Bot alerts only when the product can be bought (Q-B4, the Pixel case).
const stockClause = " and it can be bought (in stock)"

// Conversion is a rules Bot written as an agent Bot, waiting for the
// person's one-at-a-time approval (Q-B4): nothing is stored until then, and
// engine flips to "agent" only on approval.
type Conversion struct {
	Prompt   string
	Schedule Schedule
	Skills   []string
	// Gate is "changed" when the Bot has Reads (Q-B1), as every converted
	// Bot does, and "always" for one with none.
	Gate string
}

// ConvertBot writes a rules Bot as an agent Bot: ConvertPrompt, with the
// gate the Bot's Reads call for.
func ConvertBot(b Bot, ws []Watch) Conversion {
	prompt, sched, skills := ConvertPrompt(b, ws)
	gate := GateChanged
	if len(ws) == 0 {
		gate = GateAlways
	}
	return Conversion{Prompt: prompt, Schedule: sched, Skills: skills, Gate: gate}
}

// ConvertPrompt writes a rules Bot as a prompt, a schedule and skills. The
// prompt is the Bot's name, then its description if it has one, then per
// Watch "Watch <address or symbol>." and "Alert when <what its rules say,
// joined with or>.", then "Stay silent otherwise." A price rule on a
// product page adds "and it can be bought (in stock)" unless the rule said
// "in stock or not". The schedule is the Bot's interval, raised to the floor
// of its Reads; skills are product-price-monitor when it reads a shop price.
func ConvertPrompt(b Bot, ws []Watch) (string, Schedule, []string) {
	var parts []string
	if name := sentenceEnd(b.Name); name != "" {
		parts = append(parts, name)
	}
	if d := strings.TrimSpace(b.Description); d != "" && !strings.EqualFold(d, strings.TrimSpace(b.Name)) {
		parts = append(parts, sentenceEnd(d))
	}
	skills := []string{}
	for _, w := range ws {
		parts = append(parts, "Watch "+watchTarget(w)+".")
		if alert := alertClause(w); alert != "" {
			parts = append(parts, alert)
		}
		if readsStock(w.Kind, w.ReadMode) && !contains(skills, SkillProductPriceMonitor) {
			skills = append(skills, SkillProductPriceMonitor)
		}
	}
	parts = append(parts, "Stay silent otherwise.")

	every := b.Interval()
	if every <= 0 {
		every = DefaultInterval(ws)
	}
	sched := ClampSchedule(Schedule{EveryMinutes: int(every / time.Minute)}, ws)
	return strings.Join(parts, " "), sched, skills
}

// sentenceEnd trims s and ends it with a full stop unless it ends one
// already.
func sentenceEnd(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if strings.HasSuffix(s, ".") || strings.HasSuffix(s, "!") || strings.HasSuffix(s, "?") {
		return s
	}
	return s + "."
}

// watchTarget is what a Watch reads: its address, or a price's symbol.
func watchTarget(w Watch) string {
	if w.Kind == WatchPrice {
		return w.Symbol
	}
	return w.URL
}

// convertCurrency is the currency a Watch's amounts are in: what it last
// read, else its hint.
func convertCurrency(w Watch) string {
	if w.LastReading != nil && w.LastReading.Currency != "" {
		return w.LastReading.Currency
	}
	return w.Currency
}

// alertClause is "Alert when ..." for one Watch's rules, "" for one with
// none.
func alertClause(w Watch) string {
	cur := convertCurrency(w)
	var conds []string
	for _, r := range w.Rules {
		c := convertRule(r, cur)
		if c == "" {
			continue
		}
		if readsStock(w.Kind, w.ReadMode) && stockMatters(r) {
			c += stockClause
		}
		conds = append(conds, c)
	}
	if len(conds) == 0 {
		return ""
	}
	return "Alert when " + strings.Join(conds, " or ") + "."
}

// stockMatters reports a price rule that holds while the product cannot be
// bought: above, below and a move, unless the person said "in stock or
// not".
func stockMatters(r Rule) bool {
	switch r.Kind {
	case RuleAbove, RuleBelow, RuleMovePct:
		return r.OnlyInStock == nil || *r.OnlyInStock
	}
	return false
}

// convertRule is a rule's words (ruleWords) as a condition in a sentence:
// "the price is below ₹90,000", "back in stock", "“sale” appears".
func convertRule(r Rule, currency string) string {
	words := ruleWords(r, currency)
	if words == "" {
		return ""
	}
	switch r.Kind {
	case RuleAbove, RuleBelow, RuleMovePct:
		return "the price " + lowerFirst(strings.TrimPrefix(words, "Price "))
	case RuleAnyChange:
		return "anything changes" + strings.TrimPrefix(words, "Any change")
	case RuleNewItem:
		return lowerFirst(words)
	}
	return lowerFirst(words)
}

func lowerFirst(s string) string {
	if s == "" {
		return s
	}
	if s[0] >= 'A' && s[0] <= 'Z' {
		return strings.ToLower(s[:1]) + s[1:]
	}
	return s
}
