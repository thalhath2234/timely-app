package bots

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"timely-api/internal/features/notify"
	"timely-api/internal/utils"
)

// briefPassStates are passes whose note reached no Bot (folded, past a
// limit, or a failed read): the next brief and the digest list the note.
var briefPassStates = []string{passFolded, passOverflow, passFailed}

const (
	// briefLag is how far behind its start a brief lists notes: a source's
	// save that began before the brief but commits after its read keeps
	// its note for the next brief rather than missing both.
	briefLag       = 10 * time.Second
	briefBodyLines = 6   // lines a brief's template body lists, then "and N more"
	maxBriefLine   = 160 // one source line, in characters
	maxBriefBody   = 600 // an AI-written body, in characters
	// noteBriefLater is why an AI brief went out from the template: it is
	// never written again.
	noteBriefLater = "AI was unavailable, so this brief was written from the template"
)

// briefGroup is one source Bot's part of a brief: its newest notes (at
// most BriefItemsPerBot) and how many more it had.
type briefGroup struct {
	bot   BotRef
	notes []Finding
	more  int
}

// briefDigest is what a brief collected: its sources' new notes by Bot, in
// source order, and how many there were in all.
type briefDigest struct {
	groups []briefGroup
	n      int
}

// briefSourceRefs lists the Bots a brief sums up now: its enabled brief
// links, in the order they were added.
func briefSourceRefs(db *gorm.DB, b Bot) ([]BotRef, error) {
	var out []BotRef
	err := db.Raw(`
SELECT f.id AS bot_id, f.name FROM bot_links l JOIN bots f ON f.id = l.from_bot_id AND f.user_id = l.user_id
WHERE l.user_id = ? AND l.to_bot_id = ? AND l.kind = ? AND l.enabled
ORDER BY l.created_at, l.id`, b.UserID, b.ID, LinkBrief).Scan(&out).Error
	return out, err
}

// collectBrief gathers the notes a brief lists: its sources' notes made
// after cursor and up to until, and notes whose pass reached no Bot in that
// window (briefPassStates). Each source keeps its newest BriefItemsPerBot;
// the rest are counted. It writes nothing.
func collectBrief(db *gorm.DB, userID string, sources []BotRef, cursor, until time.Time) (briefDigest, error) {
	if len(sources) == 0 {
		return briefDigest{}, nil
	}
	ids := make([]string, len(sources))
	for i, src := range sources {
		ids[i] = src.BotID
	}
	var rows []Finding
	if err := db.Raw(`
SELECT f.* FROM bot_findings f
WHERE f.user_id = @uid AND f.bot_id IN @sources
  AND ((f.created_at > @cursor AND f.created_at <= @until)
       OR f.id IN (SELECT p.finding_id FROM bot_passes p WHERE p.user_id = @uid AND p.state IN @states
                   AND p.updated_at > @cursor AND p.updated_at <= @until AND p.finding_id IS NOT NULL))
ORDER BY f.created_at DESC, f.id DESC`,
		sql.Named("uid", userID), sql.Named("sources", ids), sql.Named("cursor", cursor.UTC()), sql.Named("until", until.UTC()),
		sql.Named("states", briefPassStates)).Scan(&rows).Error; err != nil {
		return briefDigest{}, err
	}
	return groupBrief(sources, rows), nil
}

// groupBrief puts notes (newest first) under their source Bots, in source
// order, keeping BriefItemsPerBot each and counting the rest.
func groupBrief(sources []BotRef, notes []Finding) briefDigest {
	at := make(map[string]int, len(sources))
	d := briefDigest{groups: make([]briefGroup, 0, len(sources))}
	for _, src := range sources {
		at[src.BotID] = -1
	}
	for _, f := range notes {
		i, ok := at[f.BotID]
		if !ok {
			continue
		}
		if i < 0 {
			i = len(d.groups)
			at[f.BotID] = i
			d.groups = append(d.groups, briefGroup{bot: refOf(sources, f.BotID)})
		}
		d.n++
		if len(d.groups[i].notes) < BriefItemsPerBot {
			d.groups[i].notes = append(d.groups[i].notes, f)
		} else {
			d.groups[i].more++
		}
	}
	// Source order, not newest first.
	order := make([]briefGroup, 0, len(d.groups))
	for _, src := range sources {
		if i := at[src.BotID]; i >= 0 {
			order = append(order, d.groups[i])
		}
	}
	d.groups = order
	return d
}

func refOf(sources []BotRef, id string) BotRef {
	for _, s := range sources {
		if s.BotID == id {
			return s
		}
	}
	return BotRef{BotID: id}
}

// briefLine is one note in a brief, in the rules' words: "<Bot>: <title>",
// and a price note's why ("Now ₹27,499 (was ₹31,999)").
func briefLine(name string, f Finding) string {
	return clipRunes(name+": "+noteWords(f), maxBriefLine)
}

// noteWords is a note's title, with a price note's why.
func noteWords(f Finding) string {
	line := f.Title
	if f.Kind == "price" && strings.TrimSpace(f.Why) != "" {
		line += " · " + f.Why
	}
	return line
}

// lines are the brief's source lines (BriefItemsPerBot a Bot), then "and N
// more" for the notes they leave out.
func (d briefDigest) lines() []string {
	out := []string{}
	listed := 0
	for _, g := range d.groups {
		for _, f := range g.notes {
			out = append(out, briefLine(g.bot.Name, f))
			listed++
		}
	}
	if more := d.n - listed; more > 0 {
		out = append(out, fmt.Sprintf("and %d more", more))
	}
	return out
}

// template is a brief written by code: what it tells of, without the
// Bot's name ("7 new from 3 bots"), and its body, the first
// briefBodyLines lines and "and N more".
func (d briefDigest) template() (what, body string) {
	what = fmt.Sprintf("%d new from %s", d.n, countOf(len(d.groups), "bot"))
	var lines []string
	for _, g := range d.groups {
		for _, f := range g.notes {
			if len(lines) < briefBodyLines {
				lines = append(lines, briefLine(g.bot.Name, f))
			}
		}
	}
	if more := d.n - len(lines); more > 0 {
		lines = append(lines, fmt.Sprintf("and %d more", more))
	}
	return what, strings.Join(lines, "\n")
}

// input is the brief as its AI writer sees it: each source's notes in the
// rules' words.
func (d briefDigest) input() []BriefGroup {
	out := make([]BriefGroup, 0, len(d.groups))
	for _, g := range d.groups {
		lines := make([]string, 0, len(g.notes))
		for _, f := range g.notes {
			lines = append(lines, clipRunes(noteWords(f), maxBriefLine))
		}
		out = append(out, BriefGroup{Bot: g.bot.Name, Lines: lines, More: g.more})
	}
	return out
}

// countOf words a count: "1 bot", "3 bots".
func countOf(n int, unit string) string {
	if n == 1 {
		return "1 " + unit
	}
	return strconv.Itoa(n) + " " + unit + "s"
}

// briefWrite is how a brief is worded: by the template, or by AI.
type briefWrite struct {
	what    string // the template's words, kept as figures.what
	title   string // without the Bot's name
	body    string
	aiState string
	aiWhy   string
}

// briefWindow is the cursor a brief lists notes after, and the time it
// lists them up to (and moves its cursor to): briefLag before at, never
// before the cursor.
func briefWindow(b Bot, at time.Time) (cursor, until time.Time) {
	cursor = b.CreatedAt
	if b.BriefCursorAt != nil {
		cursor = *b.BriefCursorAt
	}
	return cursor, maxTime(cursor, at.Add(-briefLag))
}

// runBrief runs a claimed brief: it collects its sources' new notes, words
// them (with one AI call when Write it with AI is on, outside the
// transaction), and saves the check, the alert and the cursor in one
// transaction. Nothing new sends nothing.
func (s *Service) runBrief(ctx context.Context, c checkRun) error {
	db := s.db.WithContext(ctx)
	b := c.bot
	cursor, until := briefWindow(b, c.started)
	sources, err := briefSourceRefs(db, b)
	if err != nil {
		return err
	}
	d, err := collectBrief(db, b.UserID, sources, cursor, until)
	if err != nil {
		return err
	}
	var w briefWrite
	if d.n > 0 {
		w.what, w.body = d.template()
		w.title = w.what
		if b.BriefAI {
			if err := s.writeBrief(ctx, b, d, &w); err != nil {
				return err
			}
		}
	}
	return s.saveBrief(ctx, c, until, d, w)
}

// writeBrief asks AI to word a brief, within the caps. Any failure leaves
// the template's words, marked unchecked with why; a brief is never
// written again later. Only database errors are returned.
func (s *Service) writeBrief(ctx context.Context, b Bot, d briefDigest, w *briefWrite) error {
	w.aiState = aiUnchecked
	if s.judge == nil {
		w.aiWhy = noteNoProvider
		return nil
	}
	now := s.now().UTC()
	db := s.db.WithContext(ctx)
	loc, err := localZone(db, b.UserID)
	if err != nil {
		return err
	}
	var lessons []string
	if err := db.Model(&Lesson{}).Where("bot_id = ? AND user_id = ?", b.ID, b.UserID).
		Order("created_at DESC, id DESC").Limit(judgeLessons).Pluck("text", &lessons).Error; err != nil {
		return err
	}
	// A brief starts no chain: its call counts against the Bot and the
	// account only.
	callID, err := s.reserveAI(ctx, b, "", purposeBrief, now)
	switch {
	case errors.Is(err, errAICap):
		w.aiWhy = noteUsedUp
		return nil
	case err != nil:
		return err
	}
	in := BriefInput{Brief: b.Name, Description: clipRunes(b.Description, judgeDescription), Lessons: lessons, Groups: d.input(), Now: judgeTime(now, loc)}
	wctx, cancel := context.WithTimeout(ctx, JudgeTimeout)
	t, err := s.judge.WriteBrief(wctx, b.UserID, in)
	cancel()
	s.markAI(callID, err == nil, !errors.Is(err, ErrJudgeOff))
	title, body := clipRunes(cleanLine(t.Title, 2*maxFindingTitle), maxFindingTitle), cleanBody(t.Body)
	switch {
	case err == nil && body != "":
		if title != "" {
			w.title = title
		}
		w.body, w.aiState, w.aiWhy = body, aiJudged, ""
	case errors.Is(err, ErrJudgeOff):
		w.aiWhy = s.offNote(ctx, b.UserID)
	default:
		w.aiWhy = noteBriefLater
	}
	return nil
}

// cleanBody keeps an AI-written body to briefBodyLines+1 clean lines within
// maxBriefBody characters.
func cleanBody(raw string) string {
	var lines []string
	for _, l := range strings.Split(raw, "\n") {
		if l = cleanLine(l, maxBriefLine); l != "" && len(lines) <= briefBodyLines {
			lines = append(lines, l)
		}
	}
	return clipRunes(strings.Join(lines, "\n"), maxBriefBody)
}

// saveBrief saves a brief's run in one transaction: the log row, the alert
// when there was anything new, the cursor (until, what it listed up to)
// and the next run at its time.
func (s *Service) saveBrief(ctx context.Context, c checkRun, until time.Time, d briefDigest, w briefWrite) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		done := s.now().UTC()
		b, ok, err := lockClaimed(tx, c)
		if err != nil || !ok {
			return err
		}
		check := Check{
			ID: c.checkID, BotID: b.ID, UserID: b.UserID, JobID: &c.job.ID, Trigger: c.trigger,
			StartedAt: c.started, FinishedAt: done, Outcome: outUnchanged, Fired: jsonList[FiredRule]{},
		}
		alertID := ""
		if d.n > 0 {
			alertID = utils.PrefixedUUID("bal")
			check.Outcome, check.AlertID = outFired, &alertID
		}
		if err := tx.Create(&check).Error; err != nil {
			return err
		}
		if d.n > 0 {
			if err := s.briefAlert(tx, b, c.checkID, alertID, d, w, done); err != nil {
				return err
			}
		}
		set := map[string]any{
			"strikes": 0, "last_check_at": done, "last_ok_at": done, "offline_since": nil, "checking_job_id": nil,
			"brief_cursor_at": until, "health": healthWorking, "health_detail": "", "updated_at": done,
		}
		if b.Status == StatusActive {
			loc, err := localZone(tx, b.UserID)
			if err != nil {
				return err
			}
			// A brief may start up to FenceSlack before its time: the next
			// run is the next day's, not this one again.
			next := nextBriefAt(loc, b.BriefTime, done.Add(FenceSlack)).Add(s.jitter(briefSpread))
			set["next_check_at"] = maxTime(next, c.spaced())
		}
		if err := tx.Model(&Bot{}).Where("id = ?", b.ID).Updates(set).Error; err != nil {
			return err
		}
		if s.beforeCommit != nil {
			return s.beforeCommit(tx)
		}
		return nil
	})
}

// briefAlert raises a brief's one alert inside its transaction: kind
// brief, its count and source lines in the figures (and the template's
// words as figures.what, which a lesson reads), held while the brief is
// snoozed. It is not capped and never shared: it is the person's own
// summary.
func (s *Service) briefAlert(tx *gorm.DB, b Bot, checkID, alertID string, d briefDigest, w briefWrite, now time.Time) error {
	settings, loc, err := notify.LoadAlertSettings(tx, b.UserID)
	if err != nil {
		return err
	}
	local := now.In(loc)
	day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	opts := notify.AlertOptions{Urgent: b.Urgent, Phone: b.NotifyPhone, Now: now}
	urgency := UrgencyNormal
	if b.Urgent {
		urgency = UrgencyHigh
	}
	title := b.Name + ": " + w.title
	if _, held := notify.QuietUntil(settings, loc, opts); held {
		title = withHeldTime(title, now, loc)
	}
	row := Alert{
		ID: alertID, BotID: b.ID, UserID: b.UserID, CheckID: &checkID, Kind: alertKindBrief, LocalDay: day,
		Title: title, Body: w.body, Figures: jsonMap[string, any]{"what": w.what, "items": d.n, "lines": d.lines()},
		Urgent: b.Urgent, Urgency: urgency, AIState: w.aiState, AIWhy: clipRunes(w.aiWhy, maxAIWhy), CreatedAt: now,
	}
	if b.SnoozedUntil != nil && b.SnoozedUntil.After(now) {
		row.Held = heldSnoozed
		return tx.Create(&row).Error
	}
	ntf := botNotification(b, title, w.body, "bot:"+b.ID+":brief:"+checkID, alertData(b, alertID, checkID, "", alertKindBrief))
	if _, err := notify.WriteAlert(tx, &ntf, settings, loc, opts); err != nil {
		return err
	}
	row.NotificationID = &ntf.ID
	return tx.Create(&row).Error
}

// briefFindings are the notes a brief's next run would list, newest first,
// for a tag in chat: a brief checks nothing, so this is all it knows.
func (s *Service) briefFindings(ctx context.Context, b Bot, now time.Time, limit int) ([]Finding, error) {
	db := s.db.WithContext(ctx)
	sources, err := briefSourceRefs(db, b)
	if err != nil {
		return nil, err
	}
	cursor, until := briefWindow(b, now)
	d, err := collectBrief(db, b.UserID, sources, cursor, until)
	if err != nil {
		return nil, err
	}
	out := []Finding{}
	for _, g := range d.groups {
		out = append(out, g.notes...)
	}
	// Newest first across the sources.
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out[:min(len(out), limit)], nil
}
