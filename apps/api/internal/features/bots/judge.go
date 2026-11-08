package bots

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"timely-api/internal/features/bots/fetch"
)

// Judge is the AI that decides whether what a Bot's rules spotted is worth
// telling the person (ADR 0024). The provider package implements it; bots
// cannot import provider, so main.go wires it with SetJudge. A Judge has no
// tools: it reads the input and answers in a fixed shape, nothing more.
type Judge interface {
	Ready(ctx context.Context, userID string) AIStatus
	Judge(ctx context.Context, userID string, in JudgeInput) (Verdict, error)
	WriteBrief(ctx context.Context, userID string, in BriefInput) (BriefText, error)
}

// AIStatus says whether the person's AI can judge now, and which it is.
type AIStatus struct {
	Ready    bool   `json:"ready"`
	Provider string `json:"provider"`
	Label    string `json:"label"`
	Model    string `json:"model"`
	Reason   string `json:"reason"` // "" | "none" | "not_chosen" | "off"
}

// Why AI is not ready (AIStatus.Reason).
const (
	AIReasonNone      = "none"
	AIReasonNotChosen = "not_chosen"
	AIReasonOff       = "off"
)

// JudgeInput is everything the judge sees about one check. Bot, Description
// and Lessons go in the prompt's <person> block: only the person and code
// wrote them. The rest is untrusted <data>: page text, feed titles and the
// last alert are to be judged, never obeyed.
type JudgeInput struct {
	Bot         string          `json:"bot"`
	Description string          `json:"description,omitempty"`
	Lessons     []string        `json:"lessons,omitempty"`
	LastAlert   *JudgeAlert     `json:"lastAlert,omitempty"`
	Changes     []JudgeChange   `json:"changes"`
	More        int             `json:"more,omitempty"`
	Passed      *JudgeNote      `json:"passed,omitempty"`
	Knowledge   *JudgeKnowledge `json:"knowledge,omitempty"`
	Now         string          `json:"now"` // "Sat 7 Nov 14:30" in the notification zone
}

// JudgeAlert is the Bot's last sent alert, in the rules' words only.
type JudgeAlert struct {
	Title    string `json:"title"`
	Body     string `json:"body,omitempty"`
	At       string `json:"at"`
	Feedback string `json:"feedback,omitempty"`
}

// JudgeChange is one rule that fired: the watch, the rule as the person set
// it, what the rules made of it and the reading before and after.
type JudgeChange struct {
	Watch  string `json:"watch"`
	Rule   string `json:"rule"`
	What   string `json:"what"`
	Body   string `json:"body,omitempty"`
	Before string `json:"before,omitempty"`
	After  string `json:"after,omitempty"`
}

// JudgeNote is a note another Bot passed on (Pass to).
type JudgeNote struct {
	From    string `json:"from"`
	Title   string `json:"title"`
	Why     string `json:"why,omitempty"`
	URL     string `json:"url,omitempty"`
	Reading string `json:"reading,omitempty"`
}

// JudgeKnowledge is the person's doc or sheet the Bot reads (Text ≤2,000).
type JudgeKnowledge struct {
	Kind  string `json:"kind"`
	Title string `json:"title"`
	Text  string `json:"text"`
}

// Verdict is the judge's answer: tell the person or not, a title (without
// the Bot's name), one line on why and how urgent.
type Verdict struct {
	Alert   bool   `json:"alert"`
	Title   string `json:"title"`
	Why     string `json:"why"`
	Urgency string `json:"urgency"`
}

// BriefInput is what a brief Bot's AI write sees.
type BriefInput struct {
	Brief       string       `json:"brief"`
	Description string       `json:"description,omitempty"`
	Lessons     []string     `json:"lessons,omitempty"`
	Groups      []BriefGroup `json:"groups"`
	Now         string       `json:"now"`
}

type BriefGroup struct {
	Bot   string   `json:"bot"`
	Lines []string `json:"lines"`
	More  int      `json:"more,omitempty"`
}

type BriefText struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// JudgeJob is what bot_alerts.ai_input holds while a re-judge is queued:
// the chain the first call counted against, and the input to ask again.
type JudgeJob struct {
	ChainID string     `json:"chainId"`
	Input   JudgeInput `json:"input"`
}

// Urgency levels, as stored in bot_alerts.urgency and bot_findings.urgency.
const (
	UrgencyLow    = "low"
	UrgencyNormal = "normal"
	UrgencyHigh   = "high"
)

// AI states of an alert (bot_alerts.ai_state).
const (
	aiJudged    = "judged"
	aiUnchecked = "unchecked"
	aiRejudged  = "rejudged"
)

// The line an unchecked alert gives for why (bot_alerts.ai_why).
const (
	noteNoProvider = "No AI provider is set up"
	noteNotChosen  = "Choose which AI provider Timely uses in Settings › Agent"
	noteUsedUp     = "AI checks are used up for today"
	noteLater      = "AI was unavailable; Timely asks again later"
	noteChanged    = "Changed while AI was checking it"
)

// Limits on what goes to the judge, in characters.
const (
	judgeMaxInput    = 9000
	judgeDescription = 600
	judgeLessons     = 10
	judgeSide        = 800 // each of Before and After
	judgeChanges     = 5
	judgeKeepChanges = 3 // the input's last cut keeps this many
	judgeTextLines   = 12
	judgeFeedItems   = 10
	maxAIWhy         = 400
)

// SetJudge gives the Bots an AI judge. nil leaves AI off.
func (s *Service) SetJudge(j Judge) { s.judge = j }

// AIStatus says whether the person's AI can judge now. Without a judge it is
// off.
func (s *Service) AIStatus(ctx context.Context, userID string) AIStatus {
	if s.judge == nil {
		return AIStatus{Reason: AIReasonOff}
	}
	return s.judge.Ready(ctx, userID)
}

// judgeChange words one fired rule for the judge. What and Body are the
// rules' own words (describe); Before and After show what moved.
func judgeChange(f firedEvent) JudgeChange {
	what, body, _ := describe(f)
	c := JudgeChange{Watch: watchTitle(f.w), Rule: ruleWords(f.rule, watchCurrency(f)), What: what, Body: body}
	ev := f.ev
	switch {
	case ev.After.Kind == ReadingFeed:
		lines := make([]string, 0, min(len(ev.NewItems), judgeFeedItems))
		for _, it := range ev.NewItems[:min(len(ev.NewItems), judgeFeedItems)] {
			line := "• " + strings.TrimSpace(it.Title)
			if site := linkSite(it.Link); site != "" {
				line += " (" + site + ")"
			}
			lines = append(lines, line)
		}
		c.After = clipRunes(strings.Join(lines, "\n"), judgeSide)
	case ev.After.Kind == ReadingPrice:
		if v, ok := ev.Before.value(); ok {
			c.Before = formatMoney(v, ev.Before.Currency)
		}
		if v, ok := ev.After.value(); ok {
			c.After = formatMoney(v, ev.After.Currency)
		}
	default:
		c.Before = clipRunes(linesAround(ev.Before.Text, ev.After.Text), judgeSide)
		c.After = clipRunes(linesAround(ev.After.Text, ev.Before.Text), judgeSide)
	}
	return c
}

func watchCurrency(f firedEvent) string {
	if f.ev.After.Currency != "" {
		return f.ev.After.Currency
	}
	return f.w.Currency
}

// linkSite is a feed item link's registrable domain, or "".
func linkSite(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ""
	}
	return fetch.Site(u)
}

// linesAround is up to judgeTextLines lines of text around its first line
// that other does not have (the start of the text when there is none).
func linesAround(text, other string) string {
	lines := strings.Split(text, "\n")
	had := map[string]bool{}
	for _, l := range strings.Split(other, "\n") {
		had[strings.TrimSpace(l)] = true
	}
	at := 0
	for i, l := range lines {
		if l = strings.TrimSpace(l); l != "" && !had[l] {
			at = i
			break
		}
	}
	start := max(0, at-judgeTextLines/3)
	end := min(len(lines), start+judgeTextLines)
	var out []string
	for _, l := range lines[start:end] {
		if l = strings.TrimSpace(l); l != "" {
			out = append(out, l)
		}
	}
	return strings.Join(out, "\n")
}

// ruleWords is a rule as the person set it: "Price is below ₹25,000",
// "Moves 5% either way", "“Add to cart” appears" (the contract's ruleLine).
func ruleWords(r Rule, currency string) string {
	money := func(v *float64) string {
		if v == nil {
			return "…"
		}
		return formatMoney(*v, currency)
	}
	quoted := func(words []string) string {
		q := make([]string, len(words))
		for i, w := range words {
			q[i] = "“" + w + "”"
		}
		return strings.Join(q, " or ")
	}
	switch r.Kind {
	case RuleBelow:
		return "Price is below " + money(r.Threshold)
	case RuleAbove:
		return "Price is above " + money(r.Threshold)
	case RuleMovePct:
		p := "…"
		if r.Percent != nil {
			// Two decimals at most, without trailing zeros (pctNumber).
			p = strconv.FormatFloat(math.Round(*r.Percent*100)/100, 'f', -1, 64)
		}
		switch r.Direction {
		case DirUp:
			return "Rises " + p + "%"
		case DirDown:
			return "Drops " + p + "%"
		}
		return "Moves " + p + "% either way"
	case RuleWordsAppear, RuleWordsDisappear:
		w := quoted(r.Words)
		if w == "" {
			w = "Words"
		}
		if r.Kind == RuleWordsAppear {
			return w + " appears"
		}
		return w + " disappears"
	case RuleNewItem:
		if len(r.Words) > 0 {
			return "A new post with " + quoted(r.Words)
		}
		return "A new post"
	}
	return "Any change"
}

// eventKey names a fired rule and, for new items, which ones, so the save
// can tell whether it alerts on what the judge saw.
func eventKey(f firedEvent) string {
	key := f.ev.WatchID + "/" + f.ev.RuleID
	for _, it := range f.ev.NewItems {
		key += "/" + it.ID
	}
	return key
}

func eventKeys(fired []firedEvent) []string {
	out := make([]string, len(fired))
	for i, f := range fired {
		out[i] = eventKey(f)
	}
	sort.Strings(out)
	return out
}

func sameKeys(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// buildJudgeInput puts one check together for the judge: the person's words
// clipped, the newest lessons, at most judgeChanges changes ("+N more"),
// then the whole within judgeMaxInput characters of JSON, cutting first the
// knowledge text, then Before and After (by halves), then changes beyond
// judgeKeepChanges.
func buildJudgeInput(b Bot, lessons []string, last *JudgeAlert, fired []firedEvent, knowledge *JudgeKnowledge, now string) JudgeInput {
	in := JudgeInput{Bot: b.Name, Description: clipRunes(b.Description, judgeDescription), LastAlert: last, Knowledge: knowledge, Now: now}
	for _, l := range lessons[:min(len(lessons), judgeLessons)] {
		in.Lessons = append(in.Lessons, clipRunes(l, MaxLessonLen))
	}
	in.Changes = make([]JudgeChange, 0, min(len(fired), judgeChanges))
	for _, f := range fired[:min(len(fired), judgeChanges)] {
		in.Changes = append(in.Changes, judgeChange(f))
	}
	in.More = len(fired) - len(in.Changes)
	return clipJudgeInput(in, judgeMaxInput)
}

// clipJudgeInput cuts in until its JSON is at most limit characters.
func clipJudgeInput(in JudgeInput, limit int) JudgeInput {
	for range 40 {
		if judgeInputLen(in) <= limit {
			return in
		}
		switch {
		case in.Knowledge != nil && in.Knowledge.Text != "":
			k := *in.Knowledge
			if n := utf8.RuneCountInString(k.Text); n > 100 {
				k.Text = clipRunes(k.Text, n/2)
			} else {
				k.Text = ""
			}
			in.Knowledge = &k
		case longestSide(in.Changes) > 40:
			changes := make([]JudgeChange, len(in.Changes))
			for i, c := range in.Changes {
				c.Before = halve(c.Before)
				c.After = halve(c.After)
				changes[i] = c
			}
			in.Changes = changes
		case len(in.Changes) > judgeKeepChanges:
			in.More += len(in.Changes) - judgeKeepChanges
			in.Changes = in.Changes[:judgeKeepChanges]
		default:
			return in
		}
	}
	return in
}

func judgeInputLen(in JudgeInput) int {
	raw, err := json.Marshal(in)
	if err != nil {
		return 0
	}
	return utf8.RuneCount(raw)
}

func longestSide(changes []JudgeChange) int {
	n := 0
	for _, c := range changes {
		n = max(n, utf8.RuneCountInString(c.Before), utf8.RuneCountInString(c.After))
	}
	return n
}

func halve(s string) string {
	n := utf8.RuneCountInString(s)
	if n <= 40 {
		return s
	}
	return clipRunes(s, n/2)
}

// judgeContext loads what a judge input needs beyond the check: the Bot's
// newest lessons, its last sent alert in the rules' words, and the time in
// the person's notification zone.
func judgeContext(db *gorm.DB, b Bot, now time.Time) (lessons []string, last *JudgeAlert, at string, err error) {
	loc, err := localZone(db, b.UserID)
	if err != nil {
		return nil, nil, "", err
	}
	if err := db.Model(&Lesson{}).Where("bot_id = ? AND user_id = ?", b.ID, b.UserID).
		Order("created_at DESC, id DESC").Limit(judgeLessons).Pluck("text", &lessons).Error; err != nil {
		return nil, nil, "", err
	}
	var rows []Alert
	if err := db.Where("bot_id = ? AND user_id = ? AND kind = ? AND held = ''", b.ID, b.UserID, alertKindAlert).
		Order("created_at DESC, id DESC").Limit(1).Find(&rows).Error; err != nil {
		return nil, nil, "", err
	}
	if len(rows) > 0 {
		last = lastAlertFor(rows[0], b.Name, loc)
	}
	return lessons, last, judgeTime(now, loc), nil
}

// lastAlertFor is an alert as the next judge input shows it: the rules'
// title ("<bot>: " + figures.what) and, unless the judge wrote it, the body,
// without the line that says how long the Bot was paused. Nothing a model
// wrote goes back to a model.
func lastAlertFor(a Alert, botName string, loc *time.Location) *JudgeAlert {
	out := &JudgeAlert{Title: a.Title, At: judgeTime(a.CreatedAt, loc)}
	if what, _ := a.Figures["what"].(string); strings.TrimSpace(what) != "" {
		out.Title = botName + ": " + what
	}
	if a.AIState != aiJudged {
		body, _ := trimAway(a.Body, a.Figures)
		out.Body = strings.TrimSuffix(body, uncheckedSuffix)
	}
	if a.Feedback != nil {
		out.Feedback = *a.Feedback
	}
	return out
}

func judgeTime(t time.Time, loc *time.Location) string { return t.In(loc).Format("Mon 2 Jan 15:04") }

// cleanVerdict keeps a verdict within what bot_alerts holds.
func cleanVerdict(v Verdict) Verdict {
	switch v.Urgency {
	case UrgencyLow, UrgencyNormal, UrgencyHigh:
	default:
		v.Urgency = UrgencyNormal
	}
	v.Title = clipRunes(cleanLine(v.Title, 2*maxFindingTitle), maxFindingTitle)
	v.Why = clipRunes(cleanLine(v.Why, 2*maxAIWhy), maxAIWhy)
	return v
}

// errJudgeNil is a judge call with no judge wired; it reads as AI off.
var errJudgeNil = fmt.Errorf("%w: no judge", ErrJudgeOff)

// callJudge asks the judge with a time limit.
func (s *Service) callJudge(ctx context.Context, userID string, in JudgeInput, timeout time.Duration) (Verdict, error) {
	if s.judge == nil {
		return Verdict{}, errJudgeNil
	}
	jctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	v, err := s.judge.Judge(jctx, userID, in)
	if err != nil {
		return Verdict{}, err
	}
	return cleanVerdict(v), nil
}

// offNote is why AI did not judge when the judge said it is off.
func (s *Service) offNote(ctx context.Context, userID string) string {
	if s.AIStatus(ctx, userID).Reason == AIReasonNotChosen {
		return noteNotChosen
	}
	return noteNoProvider
}
