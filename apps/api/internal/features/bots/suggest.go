package bots

import (
	"context"
	"encoding/json"
	"math"
	"strconv"
	"time"

	"gorm.io/gorm"
	"timely-api/internal/utils"
)

// suggestAfter is how many Not useful alerts in a row make a rules-only Bot
// suggest a better rule.
const suggestAfter = 3

// The ladders a suggestion climbs: a move's percent, an above or below
// rule's further step, and the interval in minutes.
var (
	movePctLadder  = []float64{3, 5, 8, 10, 15, 20, 25, 30, 40, 50}
	stepLadder     = []float64{5, 10, 15, 20, 25}
	intervalLadder = []int{30, 60, 120, 360, 720, 1440, 10080}
)

// reasonRank breaks ties between ratings' reasons: too_small wins, then
// not_wanted, then already_knew.
var reasonRank = map[string]int{"too_small": 3, "not_wanted": 2, "already_knew": 1}

// suggest proposes a better rule inside RateAlert's transaction, once the
// Bot's suggestAfter newest sent alerts are all Not useful and each was
// rated after the last suggestion was applied or dismissed. b is the Bot,
// locked; only a rules-only Bot without a suggestion gets one. The words
// and the patch are code's (suggestFor), so they cost no AI.
func suggest(tx *gorm.DB, b Bot, aiReady bool, now time.Time) error {
	if b.JudgeMode != JudgeRules || b.Suggestion != nil {
		return nil
	}
	var alerts []Alert
	if err := tx.Where("bot_id = ? AND user_id = ? AND kind = ? AND held = ''", b.ID, b.UserID, alertKindAlert).
		Order("created_at DESC, id DESC").Limit(suggestAfter).Find(&alerts).Error; err != nil {
		return err
	}
	if len(alerts) < suggestAfter {
		return nil
	}
	var checkIDs []string
	for _, a := range alerts {
		if a.Feedback == nil || *a.Feedback != FeedbackNotUseful {
			return nil
		}
		if d := b.SuggestionDismissedAt; d != nil && (a.FeedbackAt == nil || !a.FeedbackAt.After(*d)) {
			return nil
		}
		if a.CheckID != nil {
			checkIDs = append(checkIDs, *a.CheckID)
		}
	}
	fired := map[string]FiredRule{}
	if len(checkIDs) > 0 {
		var checks []Check
		if err := tx.Select("id", "fired").Where("id IN ? AND bot_id = ?", checkIDs, b.ID).Find(&checks).Error; err != nil {
			return err
		}
		first := map[string]FiredRule{}
		for _, c := range checks {
			if len(c.Fired) > 0 {
				first[c.ID] = c.Fired[0]
			}
		}
		for _, a := range alerts {
			if a.CheckID != nil {
				if f, ok := first[*a.CheckID]; ok {
					fired[a.ID] = f
				}
			}
		}
	}
	ws, err := loadWatches(tx, b.ID, false)
	if err != nil {
		return err
	}
	sg := suggestFor(b, ws, alerts, fired, aiReady)
	if sg == nil {
		return nil
	}
	sg.ID, sg.CreatedAt = utils.PrefixedUUID("bsg"), now.UTC()
	raw, err := json.Marshal(sg)
	if err != nil {
		return err
	}
	return tx.Model(&Bot{}).Where("id = ? AND user_id = ?", b.ID, b.UserID).Update("suggestion", string(raw)).Error
}

// suggestFor works out the suggestion for a Bot whose alerts (newest first)
// were all Not useful, or nil when nothing fits. fired holds each alert's
// first fired rule, by alert id. The rule it changes is the newest alert's;
// what it proposes follows the ratings' most common reason:
//
//   - too small on a move: only bigger moves ("Raise to 8%");
//   - too small on above or below: a bigger further step before it tells
//     again;
//   - too small on any change of a price: a 5% move instead;
//   - any change of text, or "already knew" on any rule: checking less often;
//   - not wanted or too small on new items or words: AI judging, when the
//     person has an AI provider.
func suggestFor(b Bot, ws []Watch, alerts []Alert, fired map[string]FiredRule, aiReady bool) *Suggestion {
	if len(alerts) == 0 {
		return nil
	}
	w, r := targetRule(ws, alerts[0], fired)
	if r == nil {
		return nil
	}
	reason := commonReason(alerts)
	sg := &Suggestion{Reason: reason, AlertIDs: make([]string, 0, len(alerts))}
	for _, a := range alerts {
		sg.AlertIDs = append(sg.AlertIDs, a.ID)
	}
	withRule := func(nr Rule, line, button string) *Suggestion {
		nr.ID = r.ID
		sg.WatchID, sg.RuleID, sg.Rule, sg.Line, sg.Button = w.ID, r.ID, &nr, line, button
		return sg
	}
	priceReading := ReadingKind(w.Kind, w.ReadMode) == ReadingPrice
	switch {
	case reason == "already_knew" || (r.Kind == RuleAnyChange && !priceReading):
		next, ok := nextInterval(b.IntervalSeconds/60, int(Floor(ws)/time.Minute))
		if !ok {
			return nil
		}
		sg.IntervalMinutes = &next
		sg.Line, sg.Button = "Check "+everyWords(next)+" instead?", everyButton(next)
		return sg
	case reason == "too_small" && r.Kind == RuleMovePct:
		least := 0.0
		if r.Percent != nil {
			least = *r.Percent
		}
		for _, a := range alerts {
			if pct, ok := figureNumber(a.Figures, "changePct"); ok {
				least = math.Max(least, math.Abs(pct))
			}
		}
		p, ok := nextAbove(movePctLadder, least)
		if !ok {
			return nil
		}
		nr := *r
		nr.Percent = &p
		return withRule(nr, "Only tell me about moves over "+pctWords(p)+"?", "Raise to "+pctWords(p))
	case reason == "too_small" && (r.Kind == RuleBelow || r.Kind == RuleAbove):
		step, ok := nextAbove(stepLadder, r.step())
		if !ok {
			return nil
		}
		nr := *r
		nr.StepPercent = step
		return withRule(nr, "Only tell me again after a further "+pctWords(step)+" move?", "Raise to "+pctWords(step))
	case reason == "too_small" && r.Kind == RuleAnyChange:
		five := 5.0
		return withRule(Rule{Kind: RuleMovePct, Percent: &five, Direction: DirAny}, "Only tell me about moves over 5%?", "Use 5%")
	case (reason == "not_wanted" || reason == "too_small") && isItemRule(r.Kind):
		if !aiReady {
			return nil
		}
		sg.JudgeMode, sg.Line, sg.Button = JudgeAI, "Let AI judge which ones matter?", "Turn on AI judging"
		return sg
	}
	return nil
}

// targetRule finds the rule a suggestion changes: the newest alert's first
// fired rule, else the first rule of the alert's watch with the alert's rule
// kind (figures.watchId and figures.rule).
func targetRule(ws []Watch, a Alert, fired map[string]FiredRule) (Watch, *Rule) {
	watchID, ruleID, kind := "", "", ""
	if f, ok := fired[a.ID]; ok {
		watchID, ruleID, kind = f.WatchID, f.RuleID, f.Kind
	} else {
		watchID, _ = a.Figures["watchId"].(string)
		kind, _ = a.Figures["rule"].(string)
	}
	for _, w := range ws {
		if w.ID != watchID {
			continue
		}
		for i := range w.Rules {
			if r := w.Rules[i]; (ruleID != "" && r.ID == ruleID) || (ruleID == "" && kind != "" && r.Kind == kind) {
				return w, &r
			}
		}
	}
	return Watch{}, nil
}

// commonReason is the most common reason the alerts were not useful, ties
// going to reasonRank; a rating without a reason counts for nothing.
func commonReason(alerts []Alert) string {
	counts := map[string]int{}
	for _, a := range alerts {
		if reasonRank[a.FeedbackReason] > 0 {
			counts[a.FeedbackReason]++
		}
	}
	best := ""
	for reason, n := range counts {
		if n > counts[best] || (n == counts[best] && reasonRank[reason] > reasonRank[best]) {
			best = reason
		}
	}
	return best
}

func isItemRule(kind string) bool {
	return kind == RuleNewItem || kind == RuleWordsAppear || kind == RuleWordsDisappear
}

// nextAbove is the first step of ladder above v.
func nextAbove(ladder []float64, v float64) (float64, bool) {
	for _, step := range ladder {
		if step > v {
			return step, true
		}
	}
	return 0, false
}

// nextInterval is the first interval of the ladder above cur minutes that
// the watches' floor allows.
func nextInterval(cur, floor int) (int, bool) {
	for _, m := range intervalLadder {
		if m > cur && m >= floor {
			return m, true
		}
	}
	return 0, false
}

func figureNumber(f jsonMap[string, any], key string) (float64, bool) {
	switch v := f[key].(type) {
	case float64:
		return v, true
	case json.Number:
		n, err := v.Float64()
		return n, err == nil
	}
	return 0, false
}

func pctWords(p float64) string { return strconv.FormatFloat(p, 'f', -1, 64) + "%" }

// everyWords says an interval of the ladder in a question: "every 2 hours".
func everyWords(minutes int) string {
	switch {
	case minutes == 60:
		return "every hour"
	case minutes == 1440:
		return "once a day"
	case minutes == 10080:
		return "once a week"
	case minutes%60 == 0:
		return "every " + strconv.Itoa(minutes/60) + " hours"
	}
	return "every " + strconv.Itoa(minutes) + " minutes"
}

// everyButton says it on a button: "Every 2 h".
func everyButton(minutes int) string {
	switch {
	case minutes == 60:
		return "Every hour"
	case minutes == 1440:
		return "Once a day"
	case minutes == 10080:
		return "Once a week"
	case minutes%60 == 0:
		return "Every " + strconv.Itoa(minutes/60) + " h"
	}
	return "Every " + strconv.Itoa(minutes) + " min"
}

// ApplySuggestion makes the change the Bot suggested, through Update as if
// the person had made it in the app: a rule change sends every watch with
// that one rule replaced (so it records a quiet baseline), an interval or
// AI judging just that field. The suggestion is then gone and counts as
// dismissed. A suggestion that was replaced, or whose watch or rule is
// gone, gives ErrSuggestionStale and is cleared.
func (s *Store) ApplySuggestion(ctx context.Context, userID, idOrName, suggestionID string, now time.Time) (View, error) {
	db := s.conn(ctx)
	b, err := findBot(db, userID, idOrName, false)
	if err != nil {
		return View{}, err
	}
	stale := func() (View, error) {
		if b.Suggestion != nil {
			if err := db.Model(&Bot{}).Where("id = ? AND user_id = ?", b.ID, userID).Update("suggestion", gorm.Expr("NULL")).Error; err != nil {
				return View{}, err
			}
		}
		return View{}, ErrSuggestionStale
	}
	sg := b.Suggestion
	if sg == nil || suggestionID == "" || sg.ID != suggestionID {
		return stale()
	}
	var p Patch
	switch {
	case sg.Rule != nil:
		ws, err := loadWatches(db, b.ID, false)
		if err != nil {
			return View{}, err
		}
		list, ok := withRuleReplaced(ws, sg.WatchID, sg.RuleID, *sg.Rule)
		if !ok {
			return stale()
		}
		p.Watches = &list
	case sg.IntervalMinutes != nil:
		p.IntervalMinutes = sg.IntervalMinutes
	case sg.JudgeMode != "":
		p.JudgeMode = &sg.JudgeMode
	default:
		return stale()
	}
	if _, err := s.Update(ctx, userID, b.ID, p, OriginApp, now); err != nil {
		return View{}, err
	}
	if err := s.clearSuggestion(ctx, userID, b.ID, now); err != nil {
		return View{}, err
	}
	return s.view(ctx, userID, b.ID, now)
}

// DismissSuggestion drops the Bot's suggestion. Another comes only after
// three more Not useful ratings.
func (s *Store) DismissSuggestion(ctx context.Context, userID, idOrName string, now time.Time) error {
	b, err := findBot(s.conn(ctx), userID, idOrName, false)
	if err != nil {
		return err
	}
	return s.clearSuggestion(ctx, userID, b.ID, now)
}

func (s *Store) clearSuggestion(ctx context.Context, userID, botID string, now time.Time) error {
	res := s.conn(ctx).Model(&Bot{}).Where("id = ? AND user_id = ?", botID, userID).
		Updates(map[string]any{"suggestion": gorm.Expr("NULL"), "suggestion_dismissed_at": now.UTC()})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// withRuleReplaced is the Bot's full watch list as an edit: each watch kept
// by id with its rules left as they are, except the one rule replaced.
func withRuleReplaced(ws []Watch, watchID, ruleID string, r Rule) ([]WatchInput, bool) {
	found := false
	out := make([]WatchInput, 0, len(ws))
	for _, w := range ws {
		in := WatchInput{ID: w.ID, Kind: w.Kind, URL: w.URL, Read: w.ReadMode, Selector: w.Selector, Source: w.Source, Symbol: w.Symbol, Currency: w.Currency}
		if w.ID == watchID {
			rules := append([]Rule{}, w.Rules...)
			for i := range rules {
				if rules[i].ID == ruleID {
					r.ID = ruleID
					rules[i], found = r, true
				}
			}
			in.Rules = rules
		}
		out = append(out, in)
	}
	return out, found
}
