package bots

import (
	"context"
	"net/url"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/features/bots/extract"
	"timely-api/internal/features/bots/fetch"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

// passReadWait caps how long a passed note's read waits for its site.
const passReadWait = 30 * time.Second

// deletedBot names a Bot in "How this came to you" that is gone.
const deletedBot = "A deleted bot"

// passCheck is one pending pass on its way to being checked by the Bot it
// went to (B): B, the Bot that passed it (A), the link and the note.
type passCheck struct {
	job     *models.Job
	pass    Pass
	bot     Bot
	from    string // A's name
	note    Finding
	ws      []Watch
	started time.Time
	checkID string

	// What B made of it.
	reading Reading
	read    *CheckWatch // the read of the note's link, when B made one
	readErr *problem
	fired   []firedEvent // at most one: the first of B's rules that holds
	taken   map[itemKey][]linkTarget
	plan    checkPlan
	via     []ViaStep
}

// HandlePass runs one bot_pass job: the Bot a note was passed to checks it
// under its own rules, caps and allowed sites (decision 0.16). It reads the
// note's link only when one of its page watches reads that site and it made
// no pass read within its floor; otherwise it tests its rules against the
// note itself. Its schedule, readings and strikes are left alone. A pass
// whose Bot is off or gone, whose link is off or gone, whose note is gone,
// or that waited over PassFoldAfter is folded into the next brief instead.
func (s *Service) HandlePass(ctx context.Context, job *models.Job) error {
	db := s.db.WithContext(ctx)
	var rows []Pass
	if err := db.Where("id = ? AND user_id = ? AND state = ?", job.Payload.String("passId"), job.UserID, passPending).
		Limit(1).Find(&rows).Error; err != nil {
		return jobs.RetryAfter(err, time.Minute)
	}
	if len(rows) == 0 {
		return nil
	}
	pc := &passCheck{job: job, pass: rows[0], started: s.now().UTC(), checkID: utils.PrefixedUUID("bchk")}
	// "Pause all bots" folds it: it goes into the next brief instead.
	paused, err := accountPaused(db, job.UserID)
	if err != nil {
		return jobs.RetryAfter(err, time.Minute)
	}
	if paused {
		return retryDB(s.foldPass(ctx, pc.pass))
	}
	ok, err := s.loadPass(db, pc)
	if err != nil {
		return jobs.RetryAfter(err, time.Minute)
	}
	if !ok {
		return retryDB(s.foldPass(ctx, pc.pass))
	}
	if err := s.readPass(ctx, db, pc); err != nil {
		return jobs.RetryAfter(err, time.Minute)
	}
	if ctx.Err() != nil {
		return jobs.RetryAfter(ctx.Err(), time.Minute)
	}
	if err := s.planPass(ctx, db, pc); err != nil {
		return jobs.RetryAfter(err, time.Minute)
	}
	return retryDB(s.savePass(ctx, pc))
}

func retryDB(err error) error {
	if err != nil {
		return jobs.RetryAfter(err, time.Minute)
	}
	return nil
}

// loadPass loads B, A's name, the link and the note, each as the pass's
// account's (never the job payload's Bot). ok is false when the pass is to
// be folded.
func (s *Service) loadPass(db *gorm.DB, pc *passCheck) (bool, error) {
	p := pc.pass
	if p.LinkID == nil || p.FindingID == nil || pc.started.Sub(p.CreatedAt) > PassFoldAfter {
		return false, nil
	}
	var bots []Bot
	if err := db.Where("id = ? AND user_id = ?", p.ToBotID, p.UserID).Limit(1).Find(&bots).Error; err != nil {
		return false, err
	}
	if len(bots) == 0 || bots[0].Status != StatusActive || bots[0].Kind != KindWatch {
		return false, nil
	}
	pc.bot = bots[0]
	var links []Link
	if err := db.Where("id = ? AND user_id = ?", *p.LinkID, p.UserID).Limit(1).Find(&links).Error; err != nil {
		return false, err
	}
	if len(links) == 0 || !links[0].Enabled || links[0].ToBotID != p.ToBotID || links[0].FromBotID != p.FromBotID {
		return false, nil
	}
	var notes []Finding
	if err := db.Where("id = ? AND user_id = ?", *p.FindingID, p.UserID).Limit(1).Find(&notes).Error; err != nil {
		return false, err
	}
	if len(notes) == 0 {
		return false, nil
	}
	pc.note = notes[0]
	var names []string
	if err := db.Model(&Bot{}).Where("id = ? AND user_id = ?", p.FromBotID, p.UserID).Limit(1).Pluck("name", &names).Error; err != nil {
		return false, err
	}
	if len(names) == 0 {
		return false, nil
	}
	pc.from = names[0]
	ws, err := loadWatches(db, pc.bot.ID, false)
	if err != nil {
		return false, err
	}
	pc.ws = ws
	return true, nil
}

// foldPass marks a pending pass folded: it goes into the next brief.
func (s *Service) foldPass(ctx context.Context, p Pass) error {
	return s.db.WithContext(ctx).Model(&Pass{}).Where("id = ? AND user_id = ? AND state = ?", p.ID, p.UserID, passPending).
		Updates(map[string]any{"state": passFolded, "updated_at": s.now().UTC()}).Error
}

// readPass works out what B tests: the note's link read through B's page
// watch on that site (its read mode and selector, B's fetcher, site spacing
// and robots), at most once per B's floor; else the note's own price, or
// its title and line as text. The note's link is checked again first: a
// restored or older row may hold anything.
func (s *Service) readPass(ctx context.Context, db *gorm.DB, pc *passCheck) error {
	note := pc.note
	var match *Watch
	if link, err := cleanURL(note.URL, "item"); err == nil {
		if u, err := url.Parse(link); err == nil {
			site := fetch.Site(u)
			for i, w := range pc.ws {
				if w.Kind == WatchPage && watchSite(w) == site {
					match = &pc.ws[i]
					break
				}
			}
		}
		if match != nil {
			var recent int64
			if err := db.Model(&Check{}).Where("bot_id = ? AND user_id = ? AND trigger = ? AND watches <> '[]'::jsonb AND started_at > ?",
				pc.bot.ID, pc.bot.UserID, TriggerPass, pc.started.Add(-Floor(pc.ws))).Count(&recent).Error; err != nil {
				return err
			}
			if recent == 0 {
				w := Watch{ID: match.ID, BotID: match.BotID, UserID: match.UserID, Kind: WatchPage, URL: link, ReadMode: match.ReadMode, Selector: match.Selector}
				start := time.Now()
				r := s.readWatch(ctx, pc.bot, w, pc.started, s.keys, passReadWait)
				cw := r.cw
				cw.WatchID, cw.MS = match.ID, time.Since(start).Milliseconds()
				cw.Outcome = outUnchanged
				if r.err != nil {
					p := describeErr(w, r.err)
					if p == nil {
						p = &problem{outcome: outUnchanged, code: "error", err: r.err, watch: w}
					}
					cw.Outcome, cw.ErrorKind = p.outcome, p.code
					pc.readErr = p
				}
				pc.read = &cw
				pc.reading = clipReading(r.reading, MaxReadingBytes)
				if r.err == nil {
					pc.fired = firstHolding([]Watch{*match}, pc.reading)
				}
				return nil
			}
		}
	}
	// The note itself: its price, or its words.
	if note.Price != nil {
		v := *note.Price
		pc.reading = Reading{Kind: ReadingPrice, Price: &v, Currency: note.Currency, At: pc.started}
	} else {
		text := strings.TrimSpace(note.Title + "\n" + note.Why)
		pc.reading = Reading{Kind: ReadingText, Text: text, Hash: extract.Hash(text), At: pc.started}
	}
	var same []Watch
	for _, w := range pc.ws {
		if ReadingKind(w.Kind, w.ReadMode) == pc.reading.Kind {
			same = append(same, w)
		}
	}
	pc.fired = firstHolding(same, pc.reading)
	return nil
}

// firstHolding is the first rule of ws (in order) that holds for reading,
// as the one event a passed note's check raises.
func firstHolding(ws []Watch, reading Reading) []firedEvent {
	for _, w := range ws {
		// A page's own currency once read wins over its hint.
		currency := w.Currency
		if (currency == "" || w.Kind == WatchPage) && w.LastReading != nil && w.LastReading.Currency != "" {
			currency = w.LastReading.Currency
		}
		for _, r := range w.Rules {
			if holds(r, reading, currency) {
				return []firedEvent{{ev: Event{WatchID: w.ID, RuleID: r.ID, Kind: r.Kind, After: reading}, w: w, rule: r}}
			}
		}
	}
	return nil
}

// planPass decides, before the save's transaction: what B passes on in
// turn, whether B is "Only in the brief" now, and for an AI-judged B that
// is not the judge's verdict on the rest, with the note passed to it as
// data.
func (s *Service) planPass(ctx context.Context, db *gorm.DB, pc *passCheck) error {
	via, err := passVia(db, pc)
	if err != nil {
		return err
	}
	pc.via = via
	if len(pc.fired) == 0 {
		return nil
	}
	if pc.pass.Depth+1 <= ChainSteps {
		links, err := passLinks(db, pc.bot)
		if err != nil {
			return err
		}
		pc.taken = takeItems(pc.fired, links, pc.pass.Depth)
	}
	pc.plan.taken = pc.taken
	// Only in the brief holds for a passed note too: B's note waits for
	// the brief, with no judge call and no alert of its own.
	briefOnly, err := briefOnlyNow(db, pc.bot)
	if err != nil {
		return err
	}
	pc.plan.briefOnly = briefOnly
	alertable := untaken(pc.fired, pc.taken)
	if pc.bot.JudgeMode != JudgeAI || len(alertable) == 0 || briefOnly {
		return nil
	}
	lessons, last, at, err := judgeContext(db, pc.bot, pc.started)
	if err != nil {
		return err
	}
	in := buildJudgeInput(pc.bot, lessons, last, alertable, nil, at)
	in.Passed = &JudgeNote{From: pc.from, Title: pc.note.Title, Why: pc.note.Why, URL: pc.note.URL, Reading: summary(&pc.reading)}
	in = clipJudgeInput(in, judgeMaxInput)
	return s.judgeInto(ctx, &pc.plan, pc.bot, pc.pass.ChainID, eventKeys(alertable), in, JudgeTimeout, pc.started)
}

// passVia is how the note came to B, from the start of its chain: each Bot
// it went through, the link it went on by and the note's title there.
func passVia(db *gorm.DB, pc *passCheck) ([]ViaStep, error) {
	p := pc.pass
	steps := []ViaStep{{BotID: p.FromBotID, Name: pc.from, LinkID: p.LinkID, Title: pc.note.Title}}
	cur := pc.note
	for range ChainSteps {
		if cur.SourceFindingID == nil {
			break
		}
		var srcs []Finding
		if err := db.Where("id = ? AND user_id = ?", *cur.SourceFindingID, p.UserID).Limit(1).Find(&srcs).Error; err != nil {
			return nil, err
		}
		if len(srcs) == 0 {
			break
		}
		src := srcs[0]
		var links []*string
		if err := db.Model(&Pass{}).Where("user_id = ? AND finding_id = ? AND to_bot_id = ?", p.UserID, src.ID, cur.BotID).
			Order("created_at DESC").Limit(1).Pluck("link_id", &links).Error; err != nil {
			return nil, err
		}
		var names []string
		if err := db.Model(&Bot{}).Where("id = ? AND user_id = ?", src.BotID, p.UserID).Limit(1).Pluck("name", &names).Error; err != nil {
			return nil, err
		}
		step := ViaStep{BotID: src.BotID, Name: deletedBot, Title: src.Title}
		if len(names) > 0 {
			step.Name = names[0]
		}
		if len(links) > 0 {
			step.LinkID = links[0]
		}
		steps = append([]ViaStep{step}, steps...)
		cur = src
	}
	return steps, nil
}

// savePass saves B's check of a passed note in one transaction, with B's
// row locked as a check's save does: the log row (trigger pass), the alert
// (with "How this came to you") under B's daily cap and snooze, B's note
// (in the rules' words, never the judge's, naming the note it was passed),
// what B passes on in turn, and the pass's end state. B's schedule,
// readings and strikes are untouched; a failed read is logged with no
// strike.
func (s *Service) savePass(ctx context.Context, pc *passCheck) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		done := s.now().UTC()
		// B's row first, as a check's save locks it (by id only), then the
		// pass, which another run of this job may have ended.
		var bots []Bot
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", pc.pass.ToBotID, pc.pass.UserID).
			Limit(1).Find(&bots).Error; err != nil {
			return err
		}
		p, ok, err := lockPass(tx, pc.pass.ID, pc.pass.UserID)
		if err != nil || !ok {
			return err
		}
		if len(bots) == 0 || bots[0].Status != StatusActive || bots[0].Kind != KindWatch {
			return tx.Model(&Pass{}).Where("id = ?", p.ID).Updates(map[string]any{"state": passFolded, "updated_at": done}).Error
		}
		b := bots[0]
		check := Check{
			ID: pc.checkID, BotID: b.ID, UserID: b.UserID, JobID: &pc.job.ID, Trigger: TriggerPass, StartedAt: pc.started,
			FinishedAt: done, Outcome: outUnchanged, Watches: jsonList[CheckWatch]{}, Fired: jsonList[FiredRule]{}, Rearmed: jsonList[Rearm]{},
		}
		if pc.read != nil {
			check.Watches = jsonList[CheckWatch]{*pc.read}
		}
		state := passQuiet
		end := func() error {
			return tx.Model(&Pass{}).Where("id = ?", p.ID).Updates(map[string]any{"state": state, "check_id": check.ID, "updated_at": done}).Error
		}
		switch {
		case pc.readErr != nil:
			state = passFailed
			check.ErrorKind = pc.readErr.code
			check.Error = utils.StorableText(utils.RedactSecrets(pc.readErr.err.Error()), maxCheckError)
			if err := tx.Create(&check).Error; err != nil {
				return err
			}
			return end()
		case len(pc.fired) == 0:
			if err := tx.Create(&check).Error; err != nil {
				return err
			}
			return end()
		}
		f := pc.fired[0]
		if pc.read != nil {
			check.Watches[0].Outcome = outFired
		}
		check.Fired = jsonList[FiredRule]{{WatchID: f.ev.WatchID, RuleID: f.ev.RuleID, Kind: f.ev.Kind}}
		check.Reading = map[string]Reading{f.w.ID: pc.reading}
		alertable := untaken(pc.fired, pc.taken)
		if pc.plan.briefOnly {
			alertable = nil
		}
		var things []Thing
		if pc.note.ThingKey != "" {
			th := Thing{Key: pc.note.ThingKey}
			if v, ok := pc.reading.value(); ok {
				th.Value = &v
			}
			things = []Thing{th}
		}
		run := alertRun{checkID: check.ID, fired: alertable, now: done, via: pc.via, things: things}
		if run.things == nil {
			run.things = []Thing{}
		}
		if link, err := cleanURL(pc.note.URL, "item"); err == nil {
			run.url = link
		}
		if len(alertable) > 0 {
			run = judgedRun(b, pc.plan, run)
			alertID := utils.PrefixedUUID("bal")
			check.AlertID, run.alertID = &alertID, alertID
		}
		switch {
		case len(alertable) == 0:
			check.Outcome = outPassed
		default:
			check.Outcome = firedOutcome(run)
		}
		if err := tx.Create(&check).Error; err != nil {
			return err
		}
		sent := false
		if len(alertable) > 0 {
			if sent, err = s.alert(tx, b, run); err != nil {
				return err
			}
			if run.verdict == nil || run.verdict.Alert {
				state = passAlerted
			}
		}
		note := passNote(b, pc, f, run, sent && len(alertable) > 0, done)
		if err := tx.Create(&note).Error; err != nil {
			return err
		}
		pr := passRun{bot: b, checkID: check.ID, chainID: p.ChainID, depth: p.Depth, now: done}
		if err := applyPasses(tx, pr, pc.fired, pc.taken, []Finding{note}, []itemKey{{f.ev.WatchID, f.ev.RuleID, ""}}); err != nil {
			return err
		}
		return end()
	})
}

// passNote is B's note on a passed note: what B's rule made of it, in the
// rules' words (decision 0.31: the judge's line lives only in B's alert),
// about the same thing and link, naming the note it was passed and its
// place in the chain. It is page text passed on, so outside data.
func passNote(b Bot, pc *passCheck, f firedEvent, run alertRun, alerted bool, now time.Time) Finding {
	what, why, _ := describe(f)
	src := pc.note.ID
	urgency := UrgencyNormal
	switch {
	case run.verdict != nil:
		urgency = run.verdict.Urgency
	case b.Urgent:
		urgency = UrgencyHigh
	}
	watchID := f.w.ID
	row := Finding{
		ID: utils.PrefixedUUID("bfd"), BotID: b.ID, UserID: b.UserID, CheckID: &run.checkID, WatchID: &watchID, Kind: "change",
		Title: clipRunes(what, maxFindingTitle), Why: clipRunes(why, maxFindingWhy), URL: pc.note.URL, Currency: pc.reading.Currency,
		Urgency: urgency, OutsideData: true, Alerted: alerted, ThingKey: pc.note.ThingKey,
		ChainID: pc.pass.ChainID, Depth: pc.pass.Depth, SourceFindingID: &src, CreatedAt: now,
	}
	if v, ok := pc.reading.value(); ok {
		row.Price = &v
	}
	switch f.rule.Kind {
	case RuleAbove, RuleBelow, RuleMovePct:
		row.Kind = "price"
	}
	return row
}
