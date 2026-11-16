package bots

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"
)

// What a Bot thread may do to a Bot (ADR 0027, phase 6): change it at once
// and say "Changed: X -> Y" with Undo, except a change that gives the Bot
// more reach, which waits for one tap. The thread never touches a Bot's Reads
// or alerts; the grouped-row editor stays for those.

// Reach is the part of an agent Bot a change can widen.
type Reach struct {
	// Permission is supervised, auto or full.
	Permission string
	// BrowserSites are the signed-in sites the Bot may read.
	BrowserSites []string
	// UseMemory is memory and About you.
	UseMemory bool
	// Egress are the extra hosts its outbound URL tools may reach, and MCP
	// its tool servers' modes. Adding either waits for a tap only after the
	// turn read page text (ChangeInput.AfterPageText).
	Egress []string
	MCP    map[string]string
}

// ReachOf is a stored Bot's reach.
func ReachOf(b Bot) Reach {
	return Reach{Permission: b.Permission, BrowserSites: b.Tools.BrowserSites, UseMemory: b.UseMemory, Egress: b.Tools.Egress, MCP: b.Tools.MCP}
}

// reachOfFields is the reach a checked change would leave.
func reachOfFields(f AgentFields) Reach {
	return Reach{Permission: f.Permission, BrowserSites: f.Tools.BrowserSites, UseMemory: f.Tools.UseMemory, Egress: f.Tools.Egress, MCP: f.Tools.MCP}
}

// The reasons a change waits for one tap (the contract's pending_change
// reasons).
const (
	WidenBrowserSite = "browser_site"
	WidenMemory      = "memory"
	WidenPermission  = "permission"
	// WidenEgress and WidenMCP hold a new egress host or a looser tool server
	// for a tap, only in a thread turn that read page text.
	WidenEgress = "egress"
	WidenMCP    = "mcp"
)

// mcpRank orders a tool server's modes from off (or absent) to use.
var mcpRank = map[string]int{"off": 0, "ask": 1, "use": 2}

// permissionRank orders the modes from the tightest to the loosest.
var permissionRank = map[string]int{PermissionSupervised: 0, PermissionAuto: 1, PermissionFull: 2}

// WidenReason says why a change from before to after gives the Bot more
// reach: a new signed-in browser site, memory turned on, or a looser
// permission mode. It is "" for any other change. It is the Go twin of the
// contract's widensBot.
func WidenReason(before, after Reach) string {
	had := map[string]bool{}
	for _, s := range before.BrowserSites {
		had[strings.ToLower(strings.TrimSpace(s))] = true
	}
	for _, s := range after.BrowserSites {
		if !had[strings.ToLower(strings.TrimSpace(s))] {
			return WidenBrowserSite
		}
	}
	if !before.UseMemory && after.UseMemory {
		return WidenMemory
	}
	b, bok := permissionRank[before.Permission]
	a, aok := permissionRank[after.Permission]
	if bok && aok && a > b {
		return WidenPermission
	}
	return ""
}

// Widens reports whether a change gives the Bot more reach, so it waits for
// one tap.
func Widens(before, after Reach) bool { return WidenReason(before, after) != "" }

// TaintedWidenReason is WidenReason for a change asked for after page text
// was read in the same turn: a new egress host or a tool server turned on
// (off to ask or use, or ask to use) waits for the tap as well, so text a
// page wrote can't open the Bot a way out.
func TaintedWidenReason(before, after Reach) string {
	if r := WidenReason(before, after); r != "" {
		return r
	}
	had := map[string]bool{}
	for _, h := range before.Egress {
		had[strings.ToLower(strings.TrimSpace(h))] = true
	}
	for _, h := range after.Egress {
		if !had[strings.ToLower(strings.TrimSpace(h))] {
			return WidenEgress
		}
	}
	for name, mode := range after.MCP {
		if mcpRank[mode] > mcpRank[before.MCP[name]] {
			return WidenMCP
		}
	}
	return ""
}

// WidenReason is why this change, from before to after, waits for a tap:
// TaintedWidenReason when it was asked for after page text, else WidenReason.
func (in ChangeInput) WidenReason(before, after Reach) string {
	if in.AfterPageText {
		return TaintedWidenReason(before, after)
	}
	return WidenReason(before, after)
}

// ChangeInput is one change to an agent Bot: its name or description and the
// agent fields. From and To are the model's own words for it ("alert under
// 90000", "alert under 85000"); without them the line is made from the fields
// that moved.
type ChangeInput struct {
	Name        *string `json:"name,omitempty"`
	Description *string `json:"description,omitempty"`
	AgentInput
	From string `json:"from,omitempty"`
	To   string `json:"to,omitempty"`
	// AfterPageText is set by a Bot thread turn that read page text
	// (bot_history) before asking for this change: then a new egress host or
	// tool server waits for the tap too. It is never stored, so the person's
	// tap on the held change applies it.
	AfterPageText bool `json:"-"`
}

// Set reports whether the change sets anything.
func (in ChangeInput) Set() bool {
	return in.Name != nil || in.Description != nil || in.AgentInput.Set()
}

// ChangeResult is what Change did.
type ChangeResult struct {
	// Applied is true when the Bot was changed.
	Applied bool `json:"applied"`
	// Pending is true when the change widens the Bot's reach and waits for one
	// tap; Reason says how.
	Pending bool   `json:"pending"`
	Reason  string `json:"reason,omitempty"`
	// Before and After are the two sides of "Changed: X -> Y".
	Before string `json:"before"`
	After  string `json:"after"`
	// Inverse restores the Bot to what it was before this change (Undo).
	Inverse ChangeInput `json:"inverse"`
	// Bot is the Bot after an applied change.
	Bot View `json:"bot"`
}

// ChangedLine is the reply to an applied change.
func ChangedLine(before, after string) string {
	return fmt.Sprintf("Changed: %s -> %s", before, after)
}

// Line is the result's own line: "Changed: X -> Y" once applied, else what
// waits for the tap.
func (r ChangeResult) Line() string {
	if r.Pending {
		return fmt.Sprintf("Waiting for your tap: %s -> %s", r.Before, r.After)
	}
	return ChangedLine(r.Before, r.After)
}

// Change changes an agent Bot's name, description and agent fields at once.
// A change that widens its reach (WidenReason) is not applied unless tapped is
// set (the person's tap, or Undo putting back what the person had); it comes
// back Pending instead. After page text (in.AfterPageText) a new egress host
// or tool server waits as well. The change goes through CleanAgent as a chat's
// edit, so every bound holds, and a rules Bot is refused (convert it first).
func (s *Service) Change(ctx context.Context, userID, idOrName string, in ChangeInput, tapped bool) (ChangeResult, error) {
	if !in.Set() {
		return ChangeResult{}, invalid("Say what to change")
	}
	cur, ws, err := s.agentBot(ctx, userID, idOrName)
	if err != nil {
		return ChangeResult{}, err
	}
	next := agentFieldsOf(cur)
	if in.AgentInput.Set() {
		if next, err = CleanAgent(in.AgentInput, &cur, ws, OriginChat); err != nil {
			return ChangeResult{}, err
		}
	}
	res := ChangeResult{Inverse: inverseOf(cur, in)}
	moves := diffOf(cur, next, in)
	res.Before, res.After = moves.words()
	if in.From != "" || in.To != "" {
		if from, to := lineEnd(in.From), lineEnd(in.To); from != "" && to != "" {
			res.Before, res.After = from, to
		}
	}
	if res.Before == "" && res.After == "" {
		return ChangeResult{}, invalid("That is already how the bot is set")
	}
	if reason := in.WidenReason(ReachOf(cur), reachOfFields(next)); reason != "" && !tapped {
		res.Pending, res.Reason = true, reason
		return res, nil
	}
	p := Patch{Name: in.Name, Description: in.Description, AgentInput: in.AgentInput}
	v, err := s.Update(ctx, userID, cur.ID, p, OriginChat)
	if err != nil {
		return ChangeResult{}, err
	}
	res.Applied, res.Bot = true, v
	return res, nil
}

// agentBot loads an agent Bot and its Reads.
func (s *Service) agentBot(ctx context.Context, userID, idOrName string) (Bot, []Watch, error) {
	d, err := s.store.Get(ctx, userID, idOrName, s.now())
	if err != nil {
		return Bot{}, nil, err
	}
	var b Bot
	db := s.db.WithContext(ctx)
	if err := db.Where("id = ? AND user_id = ?", d.ID, userID).First(&b).Error; err != nil {
		return Bot{}, nil, err
	}
	if b.Engine != EngineAgent {
		return Bot{}, nil, invalid("This bot has rules. Switch it to an agent first")
	}
	ws, err := loadWatches(db, b.ID, false)
	if err != nil {
		return Bot{}, nil, err
	}
	return b, ws, nil
}

// agentFieldsOf is a stored Bot's agent fields, as CleanAgent would leave them
// for a change that sets none.
func agentFieldsOf(b Bot) AgentFields {
	sched, _ := ScheduleFromMap(b.Schedule)
	f := AgentFields{Prompt: b.Prompt, Schedule: sched, Timezone: b.Timezone, Skills: nonNil(b.Skills), Tools: b.Tools,
		Permission: b.Permission, Gate: b.Gate, MarketHours: b.MarketHours, ModelProvider: b.ModelProvider, Model: b.Model}
	f.Tools.BrowserSites = nonNil(b.Tools.BrowserSites)
	f.Tools.Egress = nonNil(b.Tools.Egress)
	f.Tools.UseMemory = b.UseMemory
	if f.Tools.MCP == nil {
		f.Tools.MCP = map[string]string{}
	}
	return f
}

// inverseOf is the change that puts back what in sets, from the Bot as it is.
func inverseOf(b Bot, in ChangeInput) ChangeInput {
	var inv ChangeInput
	if in.Name != nil {
		inv.Name = ptrTo(b.Name)
	}
	if in.Description != nil {
		inv.Description = ptrTo(b.Description)
	}
	if in.Prompt != nil {
		inv.Prompt = ptrTo(b.Prompt)
	}
	if len(in.Schedule) > 0 && string(in.Schedule) != "null" {
		raw, _ := json.Marshal(b.Schedule)
		inv.Schedule = raw
	}
	if in.Timezone != nil {
		inv.Timezone = ptrTo(b.Timezone)
	}
	if in.Skills != nil {
		inv.Skills = ptrTo(nonNil(b.Skills))
	}
	if t := in.Tools; t != nil {
		var back ToolsInput
		if t.BrowserSites != nil {
			back.BrowserSites = ptrTo(nonNil(b.Tools.BrowserSites))
		}
		if t.Egress != nil {
			back.Egress = ptrTo(nonNil(b.Tools.Egress))
		}
		if t.UseMemory != nil {
			back.UseMemory = ptrTo(b.UseMemory)
		}
		if t.MCP != nil {
			back.MCP = map[string]string{}
			for k, v := range b.Tools.MCP {
				back.MCP[k] = v
			}
		}
		inv.Tools = &back
	}
	if in.Permission != nil {
		inv.Permission = ptrTo(b.Permission)
	}
	if in.Gate != nil {
		inv.Gate = ptrTo(b.Gate)
	}
	if in.MarketHours != nil {
		inv.MarketHours = ptrTo(b.MarketHours)
	}
	if in.ModelProvider != nil || in.Model != nil {
		inv.ModelProvider, inv.Model = ptrTo(b.ModelProvider), ptrTo(b.Model)
	}
	return inv
}

func ptrTo[T any](v T) *T { return &v }

// move is one field a change moved.
type move struct{ label, from, to string }

type moves []move

// words writes the moves as the two sides of "Changed: X -> Y".
func (m moves) words() (before, after string) {
	var b, a []string
	for _, mv := range m {
		b = append(b, strings.TrimSpace(mv.label+" "+mv.from))
		a = append(a, strings.TrimSpace(mv.label+" "+mv.to))
	}
	return strings.Join(b, ", "), strings.Join(a, ", ")
}

// maxMoveWords bounds one field's words in a line.
const maxMoveWords = 60

// lineEnd is one side of a line the model wrote, on one line and short.
func lineEnd(s string) string {
	return clipRunes(strings.Join(strings.Fields(s), " "), maxMoveWords)
}

// diffOf lists what a change moves, field by field, for its line. A field the
// change sets to what it already is moves nothing.
func diffOf(cur Bot, next AgentFields, in ChangeInput) moves {
	var out moves
	add := func(label, from, to string) {
		if from != to {
			out = append(out, move{label, lineEnd(from), lineEnd(to)})
		}
	}
	if in.Name != nil {
		add("name", cur.Name, strings.TrimSpace(*in.Name))
	}
	if in.Description != nil {
		add("description", cur.Description, strings.TrimSpace(*in.Description))
	}
	was := agentFieldsOf(cur)
	if in.Prompt != nil && was.Prompt != next.Prompt {
		from, to := promptWords(was.Prompt, next.Prompt)
		add("prompt", `"`+from+`"`, `"`+to+`"`)
	}
	if !sameSchedule(was.Schedule, next.Schedule) {
		add("schedule", scheduleWords(was.Schedule), scheduleWords(next.Schedule))
	}
	add("time zone", was.Timezone, next.Timezone)
	if !slices.Equal(was.Skills, next.Skills) {
		add("skills", listWords(was.Skills), listWords(next.Skills))
	}
	if !slices.Equal(was.Tools.BrowserSites, next.Tools.BrowserSites) {
		add("browser sites", listWords(was.Tools.BrowserSites), listWords(next.Tools.BrowserSites))
	}
	if !slices.Equal(was.Tools.Egress, next.Tools.Egress) {
		add("extra hosts", listWords(was.Tools.Egress), listWords(next.Tools.Egress))
	}
	if was.Tools.UseMemory != next.Tools.UseMemory {
		add("memory", onOff(was.Tools.UseMemory), onOff(next.Tools.UseMemory))
	}
	if in.Tools != nil && in.Tools.MCP != nil && !sameMap(was.Tools.MCP, next.Tools.MCP) {
		add("tool servers", mapWords(was.Tools.MCP), mapWords(next.Tools.MCP))
	}
	add("permission", was.Permission, next.Permission)
	if in.Gate != nil {
		add("wakes", gateWords(was.Gate), gateWords(next.Gate))
	}
	if was.MarketHours != next.MarketHours {
		add("market hours only", onOff(was.MarketHours), onOff(next.MarketHours))
	}
	if was.ModelProvider != next.ModelProvider || was.Model != next.Model {
		add("model", modelWords(was), modelWords(next))
	}
	return out
}

// promptContext is how many unchanged words before a prompt edit its line
// keeps.
const promptContext = 3

// promptWords is a prompt edit as its line shows it: the words that differ,
// after the few words before them that both prompts share, so "Alert me when
// the Pixel is under 90000" -> "... under 85000" reads "...Pixel is under
// 90000" -> "...Pixel is under 85000".
func promptWords(was, next string) (from, to string) {
	a, b := strings.Fields(was), strings.Fields(next)
	head := 0
	for head < len(a) && head < len(b) && a[head] == b[head] {
		head++
	}
	tail := 0
	for tail < len(a)-head && tail < len(b)-head && a[len(a)-1-tail] == b[len(b)-1-tail] {
		tail++
	}
	start := max(0, head-promptContext)
	lead := ""
	if start > 0 {
		lead = "..."
	}
	shared := a[start:head]
	from = lead + strings.Join(append(slices.Clone(shared), a[head:len(a)-tail]...), " ")
	to = lead + strings.Join(append(slices.Clone(shared), b[head:len(b)-tail]...), " ")
	return from, to
}

func sameSchedule(a, b Schedule) bool {
	return a.EveryMinutes == b.EveryMinutes && a.DailyAt == b.DailyAt && a.Cron == b.Cron && slices.Equal(a.Weekdays, b.Weekdays)
}

func sameMap(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

func onOff(on bool) string {
	if on {
		return "on"
	}
	return "off"
}

func gateWords(g string) string {
	if g == GateAlways {
		return "every time"
	}
	return "when something changed"
}

func listWords(l []string) string {
	if len(l) == 0 {
		return "none"
	}
	return strings.Join(l, " ")
}

func mapWords(m map[string]string) string {
	if len(m) == 0 {
		return "none"
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	for i, k := range keys {
		keys[i] = k + " " + m[k]
	}
	return strings.Join(keys, " ")
}

func modelWords(f AgentFields) string {
	if f.Model == "" {
		return "the account default"
	}
	return f.ModelProvider + " " + f.Model
}

// scheduleWords says a schedule the way a person would.
func scheduleWords(s Schedule) string {
	switch s.Kind() {
	case ScheduleEvery:
		switch {
		case s.EveryMinutes%(24*60) == 0:
			return fmt.Sprintf("every %dd", s.EveryMinutes/(24*60))
		case s.EveryMinutes%60 == 0:
			return fmt.Sprintf("every %dh", s.EveryMinutes/60)
		}
		return fmt.Sprintf("every %dm", s.EveryMinutes)
	case ScheduleDaily:
		if len(s.Weekdays) == 0 || len(s.Weekdays) == 7 {
			return "daily at " + s.DailyAt
		}
		names := []string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"}
		days := make([]string, 0, len(s.Weekdays))
		for _, d := range s.Weekdays {
			if d >= 0 && d < 7 {
				days = append(days, names[d])
			}
		}
		return strings.Join(days, " ") + " at " + s.DailyAt
	case ScheduleCron:
		return "cron " + s.Cron
	}
	return "never"
}

// The kinds of a Bot's history a thread reads.
const (
	HistoryChecks   = "checks"
	HistoryAlerts   = "alerts"
	HistoryRuns     = "runs"
	HistoryFindings = "findings"
	HistoryNotes    = "notes"
	HistoryAll      = "all"
)

// maxHistoryRows bounds each list of a Bot's history.
const maxHistoryRows = 30

// HistoryQuery asks a Bot's own history: Kind is one of the History*
// constants ("" is all), Since keeps only what happened from then on.
type HistoryQuery struct {
	Kind  string
	Since time.Time
}

// HistoryAlert is an alert as the thread reads it. Its text came from what the
// run read, so the thread treats it as outside data.
type HistoryAlert struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	Held      string    `json:"held,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// HistoryCheck is one tick with the run's own record.
type HistoryCheck struct {
	ID          string     `json:"id"`
	At          time.Time  `json:"at"`
	Outcome     string     `json:"outcome"`
	SkipReason  string     `json:"skipReason,omitempty"`
	GateSkipped bool       `json:"gateSkipped,omitempty"`
	Error       string     `json:"error,omitempty"`
	Run         *RunRecord `json:"run,omitempty"`
}

// HistoryFinding is a Finding as the thread reads it.
type HistoryFinding struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	Title     string    `json:"title"`
	Why       string    `json:"why"`
	CreatedAt time.Time `json:"createdAt"`
}

// History is what a Bot's own record holds, newest first. Every text in it was
// read from a page or written by a run; none is an instruction.
type History struct {
	Bot      string            `json:"bot"`
	Checks   []HistoryCheck    `json:"checks,omitempty"`
	Runs     []HistoryCheck    `json:"runs,omitempty"`
	Alerts   []HistoryAlert    `json:"alerts,omitempty"`
	Findings []HistoryFinding  `json:"findings,omitempty"`
	Notes    map[string]string `json:"notes,omitempty"`
}

// History reads a Bot's own record: its checks, runs (the checks that ran the
// agent), alerts, Findings and notes, for the Bot thread to answer from.
func (s *Service) History(ctx context.Context, userID, idOrName string, q HistoryQuery) (History, error) {
	d, err := s.Get(ctx, userID, idOrName)
	if err != nil {
		return History{}, err
	}
	kind := q.Kind
	if kind == "" {
		kind = HistoryAll
	}
	switch kind {
	case HistoryAll, HistoryChecks, HistoryAlerts, HistoryRuns, HistoryFindings, HistoryNotes:
	default:
		return History{}, invalid("Ask for checks, alerts, runs, findings, notes or all")
	}
	want := func(k string) bool { return kind == HistoryAll || kind == k }
	out := History{Bot: d.Name}
	since := func(t time.Time) bool { return q.Since.IsZero() || !t.Before(q.Since) }
	if want(HistoryChecks) || want(HistoryRuns) {
		for _, c := range d.Checks {
			if !since(c.StartedAt) || len(out.Checks)+len(out.Runs) >= 2*maxHistoryRows {
				continue
			}
			h := HistoryCheck{ID: c.ID, At: c.StartedAt, Outcome: c.Outcome, SkipReason: c.SkipReason, GateSkipped: c.GateSkipped, Error: clipRunes(c.Error, 300)}
			if want(HistoryChecks) {
				out.Checks = append(out.Checks, h)
			}
			if want(HistoryRuns) && c.Run != nil {
				h.Run = c.Run
				out.Runs = append(out.Runs, h)
			}
		}
	}
	if want(HistoryAlerts) {
		for _, a := range d.Alerts {
			if since(a.CreatedAt) && len(out.Alerts) < maxHistoryRows {
				out.Alerts = append(out.Alerts, HistoryAlert{ID: a.ID, Title: clipRunes(a.Title, 200), Body: clipRunes(a.Body, 600), Held: a.Held, CreatedAt: a.CreatedAt})
			}
		}
	}
	if want(HistoryFindings) {
		items, err := s.Findings(ctx, userID, FindingQuery{BotID: d.ID, Since: q.Since, Limit: maxHistoryRows})
		if err != nil {
			return History{}, err
		}
		for _, f := range items {
			out.Findings = append(out.Findings, HistoryFinding{ID: f.ID, Kind: f.Kind, Title: clipRunes(f.Title, 200), Why: clipRunes(f.Why, 400), CreatedAt: f.CreatedAt})
		}
	}
	if want(HistoryNotes) {
		notes, err := s.Notes(ctx, userID, d.ID)
		if err != nil {
			return History{}, err
		}
		out.Notes = map[string]string{}
		for _, n := range notes {
			out.Notes[n.Key] = clipRunes(n.Value, 400)
		}
	}
	return out, nil
}
