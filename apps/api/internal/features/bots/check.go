package bots

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/url"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/features/bots/extract"
	"timely-api/internal/features/bots/fetch"
	"timely-api/internal/features/bots/price"
	"timely-api/internal/features/notify"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

// Check outcomes, as stored in bot_checks.outcome and per watch.
const (
	outBaseline    = "baseline"
	outUnchanged   = "unchanged"
	outNotModified = "not_modified"
	outChanged     = "changed"
	outFired       = "fired"
	outOffline     = "offline"
	outRateLimited = "rate_limited"
	outSiteBusy    = "site_busy"
	outRobots      = "robots"
	outStrike      = "strike"
	outSuperseded  = "superseded"
	// outJudgedQuiet: rules fired, and the AI judge said it was not worth
	// telling (the alert is held). outPassed: rules fired, and everything
	// went on to other Bots or into a brief.
	outJudgedQuiet = "judged_quiet"
	outPassed      = "passed"
)

const (
	healthWorking = "working"
	// maxCheckError bounds bot_checks.error.
	maxCheckError = 500
	offlineEvery  = 5 * time.Minute
	robotsEvery   = 24 * time.Hour
	waitSpread    = 30 * time.Second
	closedEvery   = time.Hour
	releaseWithin = 2 * time.Second
)

// errUnreadable is a body the extractors could not read at all.
var errUnreadable = errors.New("could not read it")

// watchRead is what reading one watch gave.
type watchRead struct {
	w        Watch
	reading  Reading
	res      *fetch.Response // nil for a price watch
	notMod   bool
	closed   bool // a market price read while the market is shut
	cw       CheckWatch
	err      error
	duration time.Duration
}

// HandleCheck runs one bot_check job: claim the Bot, read every watch,
// then save the readings, rule states, findings and alert in one
// transaction, or save the problem. A job that loses the claim does
// nothing, so a stale, retried or doubled job is harmless.
func (s *Service) HandleCheck(ctx context.Context, job *models.Job) error {
	trigger := job.Payload.String("trigger")
	if trigger != TriggerWake && !runsNow(trigger) {
		trigger = TriggerSchedule
	}
	// "Pause all bots": the check ends unclaimed, and the Bot stays due.
	if paused, err := accountPaused(s.db.WithContext(ctx), job.UserID); err != nil || paused {
		return retryDB(err)
	}
	started := s.now().UTC()
	b, prevStarted, ws, ok, err := s.claim(ctx, job, job.Payload.String("botId"), trigger, started)
	if err != nil {
		return jobs.RetryAfter(err, time.Minute)
	}
	if !ok {
		return nil
	}
	if b.Kind == KindBrief {
		// A brief reads nothing: it sums up its sources' notes.
		checkID := utils.PrefixedUUID("bchk")
		c := checkRun{job: job, bot: b, trigger: trigger, started: started, floor: Floor(nil), checkID: checkID, chainID: checkID}
		err := s.runBrief(ctx, c)
		if ctx.Err() != nil {
			s.release(b.ID, job.ID, prevStarted)
			return nil
		}
		return retryDB(err)
	}
	readCtx, cancel := context.WithTimeout(ctx, CheckBudget)
	reads := s.read(readCtx, b, ws, started)
	cancel()
	if ctx.Err() != nil {
		s.release(b.ID, job.ID, prevStarted)
		return nil
	}
	checkID := utils.PrefixedUUID("bchk")
	c := checkRun{job: job, bot: b, trigger: trigger, started: started, floor: Floor(ws), reads: reads, checkID: checkID, chainID: checkID}
	p, err := classify(reads)
	switch {
	case err != nil:
		// Not the site's fault (the database, a bug): the provisional time
		// keeps the Bot from looping, and one slow retry follows.
	case p != nil:
		err = s.saveProblem(ctx, c, p)
	default:
		// The judge runs here, never inside the save's transaction, which
		// holds the Bot's row.
		err = s.planCheck(ctx, &c)
		if ctx.Err() != nil {
			s.release(b.ID, job.ID, prevStarted)
			return nil
		}
		if err != nil {
			break
		}
		if err = s.saveOK(ctx, c); err == nil {
			// Outside the transaction: a logo never holds up a check.
			s.askIcons(ctx, b.UserID, readWatches(reads))
		}
	}
	if err != nil {
		return jobs.RetryAfter(err, time.Minute)
	}
	return nil
}

func readWatches(reads []watchRead) []Watch {
	ws := make([]Watch, len(reads))
	for i, r := range reads {
		ws[i] = r.w
	}
	return ws
}

// checkRun is one claimed check on its way to being saved.
type checkRun struct {
	job     *models.Job
	bot     Bot
	trigger string
	started time.Time
	floor   time.Duration // of the watches it claimed with
	reads   []watchRead
	// checkID is the bot_checks row the save writes; chainID is the check
	// that started the chain this one is part of (itself for a check of its
	// own).
	checkID string
	chainID string
	depth   int // the check's step in its chain: 0 for a check of its own
	plan    checkPlan
}

// spaced is the earliest the next check of c's Bot may be due.
func (c checkRun) spaced() time.Time { return spacedAt(&c.started, c.floor) }

// claim is the fence: it takes the Bot for this job only when it is active,
// due (or run now), and the floor has passed since its last check, or when
// this job claimed it on an earlier attempt (its own automatic retry; a
// person's Retry starts again at attempt 1 and must pass the fence). It moves
// next_check_at to a provisional time no earlier than the floor allows, so a
// crash or a final failure cannot leave the Bot due in a loop.
func (s *Service) claim(ctx context.Context, job *models.Job, botID, trigger string, now time.Time) (Bot, *time.Time, []Watch, bool, error) {
	db := s.db.WithContext(ctx)
	var rows []Bot
	if err := db.Where("id = ? AND user_id = ?", botID, job.UserID).Limit(1).Find(&rows).Error; err != nil {
		return Bot{}, nil, nil, false, err
	}
	if len(rows) == 0 {
		return Bot{}, nil, nil, false, nil
	}
	ws, err := loadWatches(db, botID, false)
	if err != nil || (len(ws) == 0 && rows[0].Kind != KindBrief) {
		return Bot{}, nil, nil, false, err
	}
	floor := Floor(ws)
	prevStarted := rows[0].CheckStartedAt
	provisional := maxTime(Provisional(rows[0].Interval(), now), spacedAt(&now, floor))
	var claimed []Bot
	err = db.Raw(`
UPDATE bots SET check_started_at = @now, checking_job_id = @job, next_check_at = @provisional, updated_at = @now
WHERE id = @id AND user_id = @uid AND status = 'active'
  AND ((checking_job_id = @job AND CAST(@retry AS boolean))
       OR ((next_check_at <= @due_by OR CAST(@run_now AS boolean))
           AND (check_started_at IS NULL OR check_started_at <= @spaced_by)))
RETURNING *`,
		sql.Named("now", now), sql.Named("job", job.ID), sql.Named("provisional", provisional),
		sql.Named("id", botID), sql.Named("uid", job.UserID), sql.Named("retry", job.Attempts > 1),
		sql.Named("due_by", now.Add(FenceSlack)), sql.Named("run_now", runsNow(trigger)),
		sql.Named("spaced_by", now.Add(-floor+FenceSlack)),
	).Scan(&claimed).Error
	if err != nil {
		return Bot{}, nil, nil, false, err
	}
	if len(claimed) == 0 {
		// Lost. A Bot left due before its floor allows (an old row, a
		// restore) is moved to when the fence lets it run, so the sweep
		// stops queueing checks that do nothing.
		err = db.Exec(`
UPDATE bots SET next_check_at = check_started_at + make_interval(secs => @gap), updated_at = @now
WHERE id = @id AND user_id = @uid AND status = 'active' AND next_check_at < check_started_at + make_interval(secs => @gap)`,
			sql.Named("gap", (floor-FenceSlack).Seconds()), sql.Named("now", now), sql.Named("id", botID), sql.Named("uid", job.UserID)).Error
		return Bot{}, nil, nil, false, err
	}
	return claimed[0], prevStarted, ws, true, nil
}

// release hands a claimed Bot back on shutdown: due now, with its last start
// restored, so the sweep queues it again after the restart with no strike.
func (s *Service) release(botID, jobID string, prevStarted *time.Time) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(context.Background()), releaseWithin)
	defer cancel()
	err := s.db.WithContext(ctx).Model(&Bot{}).
		Where("id = ? AND checking_job_id = ? AND status = ?", botID, jobID, StatusActive).
		Updates(map[string]any{"next_check_at": s.now().UTC(), "check_started_at": prevStarted, "checking_job_id": nil}).Error
	if err != nil {
		log.Printf("bots: release %s: %v", botID, err)
	}
}

// read reads the watches in order and stops at the first failure: a check
// saves readings only when every watch is clean.
func (s *Service) read(ctx context.Context, b Bot, ws []Watch, now time.Time) []watchRead {
	out := make([]watchRead, 0, len(ws))
	for _, w := range ws {
		start := time.Now()
		r := s.readWatch(ctx, b, w, now, s.keys, 0)
		r.duration = time.Since(start)
		r.cw.WatchID, r.cw.MS = w.ID, r.duration.Milliseconds()
		out = append(out, r)
		if r.err != nil {
			break
		}
	}
	return out
}

// readWatch reads one watch, finding price source keys in keys. maxWait
// above zero caps the wait for the site's slot (a preview); 0 is the
// fetcher's default.
func (s *Service) readWatch(ctx context.Context, b Bot, w Watch, now time.Time, keys price.Keys, maxWait time.Duration) watchRead {
	r := watchRead{w: w}
	if w.Kind == WatchPrice {
		q, err := price.Get(ctx, s.fetch, keys, price.Query{UserID: b.UserID, Source: w.Source, Symbol: w.Symbol, Currency: w.Currency, MaxWait: maxWait}, now)
		if err != nil {
			r.err = err
			return r
		}
		p := q.Price
		r.reading = Reading{Kind: ReadingPrice, Price: &p, Currency: q.Currency, At: q.At.UTC()}
		r.closed = !q.MarketOpen
		return r
	}
	req := fetch.Request{URL: w.URL, Want: fetch.WantPage, MaxWait: maxWait}
	if w.Kind == WatchFeed {
		req.Want = fetch.WantFeed
	}
	if w.LastReading != nil {
		req.ETag, req.LastModified, req.ValidatorsURL = w.ETag, w.LastModified, w.ValidatorsURL
	}
	res, err := s.fetch.Get(ctx, req)
	if err != nil {
		r.err = err
		return r
	}
	r.res, r.cw.Status, r.cw.Bytes = res, res.Status, len(res.Body)
	if res.NotModified && w.LastReading != nil {
		r.notMod, r.reading = true, *w.LastReading
		return r
	}
	r.reading, r.err = extractReading(w, res, now)
	if r.err == nil && w.Kind == WatchPage {
		r.reading.Title = extract.PageTitle(res.Body, res.ContentType)
	}
	return r
}

// extractReading turns a fetched body into a Reading.
func extractReading(w Watch, res *fetch.Response, now time.Time) (Reading, error) {
	unreadable := func(err error) error {
		if errors.Is(err, extract.ErrEmpty) || errors.Is(err, extract.ErrTooComplex) {
			return err
		}
		return fmt.Errorf("%w: %v", errUnreadable, err)
	}
	switch {
	case w.Kind == WatchFeed:
		f, err := extract.ParseFeed(res.Body)
		if err != nil {
			return Reading{}, unreadable(err)
		}
		items := f.Items[:min(len(f.Items), MaxItems)]
		var prevSeen []string
		if w.LastReading != nil {
			prevSeen = w.LastReading.Seen
		}
		return Reading{Kind: ReadingFeed, Items: items, Seen: MergeSeen(prevSeen, f.Items), At: now}, nil
	case w.ReadMode == ReadProductPrice:
		p, err := extract.ProductPrice(res.Body, res.ContentType)
		if err != nil {
			return Reading{}, unreadable(err)
		}
		amount := p.Amount
		return Reading{Kind: ReadingPrice, Price: &amount, Currency: p.Currency, At: now}, nil
	}
	if w.ReadMode == ReadSelectorPrice {
		amount, currency, err := extract.SelectPrice(res.Body, res.ContentType, w.Selector)
		if err != nil {
			return Reading{}, unreadable(err)
		}
		return Reading{Kind: ReadingPrice, Price: &amount, Currency: currency, At: now}, nil
	}
	var text string
	var err error
	if w.ReadMode == ReadSelector {
		text, err = extract.Select(res.Body, res.ContentType, w.Selector)
	} else {
		text, err = extract.Text(res.Body, res.ContentType)
	}
	if err != nil {
		return Reading{}, unreadable(err)
	}
	return Reading{Kind: ReadingText, Text: text, Hash: extract.Hash(text), At: now}, nil
}

// Problem classes, from the mildest.
const (
	classOffline = iota + 1 // the network is down; try again soon
	classWait               // the site asked to wait, or is busy
	classRobots             // robots.txt says no; try again tomorrow
	classStrike             // the watch is broken; back off, pause at MaxStrikes
)

// problem is why a check could not save its readings.
type problem struct {
	class   int
	outcome string
	code    string // the health code and error_kind
	line    string // the health line, written for the person
	err     error
	watch   Watch
	wait    time.Duration // classWait: the site's Retry-After
	until   time.Time     // classWait: the site's next free slot
	site    string        // who asked to wait
	// fold groups paused alerts for one failing price source per account
	// and day.
	fold string
}

// classify returns the problem of the first watch that failed, nil when
// every watch is clean, or the error itself when it is not the site's.
func classify(reads []watchRead) (*problem, error) {
	for _, r := range reads {
		if r.err != nil {
			if p := describeErr(r.w, r.err); p != nil {
				return p, nil
			}
			return nil, r.err
		}
	}
	return nil, nil
}

func describeErr(w Watch, err error) *problem {
	p := &problem{err: err, watch: w, site: siteOf(w)}
	strike := func(code, line string) *problem {
		p.class, p.outcome, p.code, p.line = classStrike, outStrike, code, line
		return p
	}
	var rate *fetch.RateLimitedError
	var busy *fetch.SiteBusyError
	var status *fetch.StatusError
	var gone *price.SourceGoneError
	var key *price.KeyError
	switch {
	case errors.Is(err, fetch.ErrOffline), errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		p.class, p.outcome, p.code, p.line = classOffline, outOffline, "offline", "Waiting for the network"
	case errors.As(err, &rate):
		p.class, p.outcome, p.code, p.wait = classWait, outRateLimited, "rate_limited", rate.RetryAfter
	case errors.As(err, &busy):
		p.class, p.outcome, p.code, p.until = classWait, outSiteBusy, "waiting", busy.Until
		p.line = "Waiting its turn to read " + p.site
	case errors.Is(err, fetch.ErrRobots):
		p.class, p.outcome, p.code = classRobots, outRobots, "robots"
		p.line = p.site + " asks automated tools not to read this page"
		if w.Kind == WatchPrice {
			p.line = p.site + " asks automated tools not to read its price API"
		}
	case errors.As(err, &gone):
		p.fold = gone.Source
		head, _, _ := strings.Cut(gone.Error(), ": ")
		return strike("source_down", head)
	case errors.As(err, &key):
		p.fold = key.Source
		return strike("needs_key", sentence(key.Error()))
	case errors.Is(err, fetch.ErrCaptcha):
		return strike("captcha", p.site+" showed a robot check")
	case errors.Is(err, fetch.ErrForbidden):
		return strike("forbidden", p.site+" refused the request")
	case errors.Is(err, fetch.ErrNotFound):
		if w.Kind == WatchPrice {
			return strike("not_found", sentence(strings.TrimPrefix(err.Error(), fetch.ErrNotFound.Error()+": ")))
		}
		return strike("not_found", "The page is gone")
	case errors.Is(err, fetch.ErrTooBig):
		return strike("too_big", "The page is too large to read")
	case errors.Is(err, extract.ErrTooComplex):
		return strike("too_big", "The page is too large to read with this selector")
	case errors.Is(err, fetch.ErrBlockedAddress):
		return strike("blocked", "This is not a public web address")
	case errors.Is(err, fetch.ErrNoSuchHost):
		return strike("not_found", p.site+" doesn't exist. Check the address")
	case errors.Is(err, fetch.ErrUnsupported), errors.Is(err, errUnreadable):
		if w.Kind == WatchFeed {
			return strike("unsupported", "This address is not a feed Timely can read")
		}
		return strike("unsupported", "This address is not a page Timely can read")
	case errors.Is(err, extract.ErrEmpty):
		switch {
		case w.Kind == WatchFeed:
			return strike("cant_find", "The feed has no items")
		case w.ReadMode == ReadSelector:
			return strike("cant_find", "The selector matched nothing on the page")
		case w.ReadMode == ReadSelectorPrice:
			return strike("cant_find", "The part it reads has no price any more")
		case w.ReadMode == ReadProductPrice:
			return strike("cant_find", "Could not find a price on the page")
		}
		return strike("cant_find", "The page has no text to read")
	case errors.As(err, &status):
		return strike("server_error", fmt.Sprintf("%s answered with status %d", p.site, status.Status))
	default:
		return nil // not the site's: the caller retries the job
	}
	return p
}

// siteOf names who a watch reads from: the price source's label, or the
// page's registrable domain.
func siteOf(w Watch) string {
	if w.Kind == WatchPrice {
		if src, ok := price.Sources[w.Source]; ok {
			return src.Label
		}
		return w.Source
	}
	if u, err := url.Parse(w.URL); err == nil && u.Host != "" {
		return fetch.Site(u)
	}
	return "The site"
}

// awayOf is the gap b has not caught up on, as a check records it: whole
// seconds (at least 1) and the reason, or nils for none. b must be the row
// the save locked, never the claim's copy.
func awayOf(b Bot) (*int, *string) {
	if b.AwaySince == nil || b.AwayUntil == nil || b.AwayReason == nil {
		return nil, nil
	}
	secs := max(int(math.Round(b.AwayUntil.Sub(*b.AwaySince).Seconds())), 1)
	reason := *b.AwayReason
	return &secs, &reason
}

// awayLineOf is a check's away fields as the line its alert ends with.
func awayLineOf(secs *int, reason *string) string {
	if secs == nil || reason == nil {
		return ""
	}
	return awayLine(*secs, *reason)
}

// clearAway adds to a Bot update the columns that end a gap: its check has
// caught up.
func clearAway(set map[string]any) {
	set["away_since"], set["away_until"], set["away_reason"] = nil, nil, nil
}

// lockClaimed locks the Bot this job claimed. ok is false when it is gone or
// another job holds it now.
func lockClaimed(tx *gorm.DB, c checkRun) (Bot, bool, error) {
	var rows []Bot
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", c.bot.ID, c.bot.UserID).Limit(1).Find(&rows).Error
	if err != nil || len(rows) == 0 || rows[0].CheckingJobID == nil || *rows[0].CheckingJobID != c.job.ID {
		return Bot{}, false, err
	}
	return rows[0], true, nil
}

// saveProblem records a failed check in one small transaction: the log row,
// the Bot's health and next check, and at MaxStrikes the pause and its alert.
// A watch edited or deleted while it was read is superseded instead: its
// failure says nothing about what the Bot watches now.
func (s *Service) saveProblem(ctx context.Context, c checkRun, p *problem) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		done := s.now().UTC()
		b, ok, err := lockClaimed(tx, c)
		if err != nil || !ok {
			return err
		}
		var cur []Watch
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND bot_id = ?", p.watch.ID, b.ID).Limit(1).Find(&cur).Error; err != nil {
			return err
		}
		if len(cur) == 0 || cur[0].ConfigVersion != p.watch.ConfigVersion {
			p = &problem{outcome: outSuperseded, err: p.err, watch: p.watch}
		}
		interval := b.Interval()
		set := map[string]any{"last_check_at": done, "checking_job_id": nil, "updated_at": done}
		var next time.Time
		strikes := b.Strikes
		switch p.class {
		case classOffline:
			next = done.Add(min(interval, offlineEvery))
			if b.OfflineSince == nil {
				set["offline_since"] = done
			}
		case classWait:
			next = Provisional(interval, c.started)
			if at := done.Add(p.wait); p.wait > 0 && at.After(next) {
				next = at
			}
			if p.until.After(next) {
				next = p.until
			}
			next = maxTime(next, c.spaced()).Add(s.jitter(waitSpread))
			if p.outcome == outRateLimited {
				_, loc, err := notify.LoadAlertSettings(tx, b.UserID)
				if err != nil {
					return err
				}
				p.line = p.site + " asked Timely to wait until " + next.In(loc).Format("15:04")
			}
		case classRobots:
			next = done.Add(robotsEvery)
		case classStrike:
			strikes++
			set["strikes"] = strikes
			next = done.Add(StrikeDelay(interval, strikes))
		default: // superseded: check the edited watch as soon as the floor allows
			next = done
		}
		next = maxTime(next, c.spaced())
		cws := make([]CheckWatch, 0, len(c.reads))
		for _, r := range c.reads {
			cw := r.cw
			cw.Outcome = outUnchanged
			if r.err != nil {
				cw.Outcome, cw.ErrorKind = p.outcome, p.code
			}
			cws = append(cws, cw)
		}
		check := Check{
			ID: c.checkID, BotID: b.ID, UserID: b.UserID, JobID: &c.job.ID, Trigger: c.trigger,
			StartedAt: c.started, FinishedAt: done, Outcome: p.outcome, ErrorKind: p.code,
			Error: utils.StorableText(utils.RedactSecrets(p.err.Error()), maxCheckError), Watches: cws, Fired: jsonList[FiredRule]{},
		}
		check.AwaySecs, check.AwayReason = awayOf(b)
		if err := tx.Create(&check).Error; err != nil {
			return err
		}
		// A check that read nothing (offline, asked to wait, superseded) has
		// not caught up yet: the Bot keeps its gap for the next one. robots
		// and a strike are an answer from the site.
		if p.class == classRobots || p.class == classStrike {
			clearAway(set)
		}
		if b.Status == StatusActive {
			set["next_check_at"] = next
		}
		if p.outcome != outSuperseded {
			var key *price.KeyError
			if errors.As(p.err, &key) && key.Rejected {
				if err := markKeyRefused(tx, b.UserID, key.Source, c.started, done); err != nil {
					return err
				}
			}
			if err := tx.Model(&Watch{}).Where("id = ?", p.watch.ID).
				Updates(map[string]any{"health": p.code, "health_detail": p.line, "updated_at": done}).Error; err != nil {
				return err
			}
			if b.Status == StatusActive {
				set["health"], set["health_detail"] = p.code, p.line
				if p.class == classStrike && strikes >= MaxStrikes {
					set["status"], set["pause_reason"], set["next_check_at"] = StatusPaused, PauseStrikes, nil
					b.Strikes = strikes
					if err := s.pausedAlert(tx, b, check.ID, p, done); err != nil {
						return err
					}
				}
			}
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

// firedEvent is one rule that fired, with what alertText needs.
type firedEvent struct {
	ev   Event
	w    Watch
	rule Rule
	// ref is what a move or crossing is measured from: the rule's reference
	// before this check, else the previous value.
	ref *float64
}

// saveOK saves a clean check in ONE transaction (ADR 0021): readings, rule
// states, price days, findings, the alert and the log row, or none of them.
func (s *Service) saveOK(ctx context.Context, c checkRun) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		done := s.now().UTC()
		b, ok, err := lockClaimed(tx, c)
		if err != nil || !ok {
			return err
		}
		cur, err := loadWatches(tx, b.ID, true)
		if err != nil {
			return err
		}
		byID := make(map[string]Watch, len(cur))
		for _, w := range cur {
			byID[w.ID] = w
		}
		var fired []firedEvent
		var rearms []Rearm
		var baseline, moved, closed bool
		saved, notMod := 0, 0
		readings := map[string]Reading{}
		cws := make([]CheckWatch, 0, len(c.reads))
		for _, r := range c.reads {
			cw := r.cw
			w, ok := byID[r.w.ID]
			if !ok || w.ConfigVersion != r.w.ConfigVersion {
				cw.Outcome = outSuperseded // edited or deleted while it was read
				cws = append(cws, cw)
				continue
			}
			saved++
			closed = closed || r.closed
			reading := clipReading(r.reading, MaxReadingBytes)
			states := jsonMap[string, RuleState]{}
			set := map[string]any{"last_reading_at": done, "health": healthWorking, "health_detail": "", "updated_at": done}
			switch {
			case w.BaselinePending || w.LastReading == nil:
				for _, rule := range w.Rules {
					states[rule.ID] = Rebaseline(rule, reading)
				}
				baseline, cw.Outcome = true, outBaseline
				readings[w.ID] = reading
				set["baseline_pending"] = false
				// A first reading starts the clock; a baseline asked for again
				// (Turn on, a rules edit, a restore) moves it only if the
				// reading did.
				if w.LastReading == nil || w.LastChangedAt == nil || watchChanged(*w.LastReading, reading) {
					set["last_changed_at"] = done
				}
			case r.notMod:
				notMod++
				cw.Outcome = outNotModified
				states = nil
			default:
				prev := *w.LastReading
				evs, st, re := evaluateWatch(w, reading)
				fired, states, rearms = append(fired, evs...), st, append(rearms, re...)
				cw.Outcome = outUnchanged
				if watchChanged(prev, reading) {
					moved, cw.Outcome = true, outChanged
					set["last_changed_at"] = done
				}
				if len(evs) > 0 {
					cw.Outcome = outFired
				}
				if cw.Outcome != outUnchanged {
					readings[w.ID] = reading
				}
			}
			if states != nil {
				raw, err := json.Marshal(reading)
				if err != nil {
					return err
				}
				set["last_reading"], set["rule_state"] = string(raw), states
			}
			if r.res != nil && !r.notMod {
				set["etag"], set["last_modified"] = "", ""
				if r.res.FinalURL == w.URL {
					set["etag"], set["last_modified"] = r.res.ETag, r.res.LastModified
				}
				set["validators_url"] = w.URL
			}
			if err := tx.Model(&Watch{}).Where("id = ?", w.ID).Updates(set).Error; err != nil {
				return err
			}
			// Shop prices on a page keep a price series too. A 304 carries
			// the old reading and its old time, so it adds no point.
			if !r.notMod && reading.Kind == ReadingPrice && reading.Price != nil {
				if err := addPricePoint(tx, w, reading); err != nil {
					return err
				}
			}
			cws = append(cws, cw)
		}

		check := Check{
			ID: c.checkID, BotID: b.ID, UserID: b.UserID, JobID: &c.job.ID, Trigger: c.trigger,
			StartedAt: c.started, FinishedAt: done, Watches: cws, Fired: jsonList[FiredRule]{}, Rearmed: rearms,
		}
		check.AwaySecs, check.AwayReason = awayOf(b)
		// What links took goes on to other Bots; the Bot stays quiet about
		// it and alerts only on the rest.
		alertable := untaken(fired, c.plan.taken)
		if c.plan.briefOnly {
			// Only in the brief: the notes wait for the brief.
			alertable = nil
		}
		run := alertRun{checkID: c.checkID, fired: alertable, now: done, away: awayLineOf(check.AwaySecs, check.AwayReason)}
		if len(alertable) > 0 {
			run = judgedRun(b, c.plan, run)
		}
		switch {
		case len(fired) > 0 && len(alertable) == 0:
			check.Outcome = outPassed
		case len(fired) > 0:
			check.Outcome = firedOutcome(run)
		case baseline:
			check.Outcome = outBaseline
		case moved:
			check.Outcome = outChanged
		case saved == 0:
			check.Outcome = outSuperseded
		case notMod == saved:
			check.Outcome = outNotModified
		default:
			check.Outcome = outUnchanged
		}
		if check.Outcome == outFired || check.Outcome == outBaseline || check.Outcome == outChanged {
			check.Reading = make(map[string]Reading, len(readings))
			for id, r := range readings {
				check.Reading[id] = clipReading(r, MaxReadingBytes/len(readings))
			}
		}
		var alertID string
		for _, f := range fired {
			check.Fired = append(check.Fired, FiredRule{WatchID: f.ev.WatchID, RuleID: f.ev.RuleID, Kind: f.ev.Kind})
		}
		if len(alertable) > 0 {
			alertID = utils.PrefixedUUID("bal")
			check.AlertID, run.alertID = &alertID, alertID
		}
		if err := tx.Create(&check).Error; err != nil {
			return err
		}
		if len(fired) > 0 {
			sent := false
			if len(alertable) > 0 {
				if sent, err = s.alert(tx, b, run); err != nil {
					return err
				}
			}
			notes, keys, err := saveFindings(tx, b, run, fired, c.plan.taken, sent)
			if err != nil {
				return err
			}
			pr := passRun{bot: b, checkID: c.checkID, chainID: c.chainID, depth: c.depth, now: done}
			if err := applyPasses(tx, pr, fired, c.plan.taken, notes, keys); err != nil {
				return err
			}
		}

		set := map[string]any{
			"strikes": 0, "last_check_at": done, "last_ok_at": done, "offline_since": nil,
			"checking_job_id": nil, "updated_at": done,
		}
		// Every watch edited or deleted while it was read: nothing was read,
		// so the Bot has not caught up on its gap yet.
		if check.Outcome != outSuperseded {
			clearAway(set)
		}
		if b.Status == StatusActive {
			next := maxTime(s.nextCheck(b.Interval(), done), c.spaced())
			if closed {
				next = maxTime(next, done.Add(closedEvery))
			}
			set["next_check_at"], set["health"], set["health_detail"] = next, healthWorking, ""
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

// evaluateWatch runs a watch's rules against a new reading, measured from
// its last one: the rules that fired, every rule's new state and the rules
// that armed again. The save and planCheck's dry run both use it, so the
// judge sees what the save will alert on.
func evaluateWatch(w Watch, reading Reading) (fired []firedEvent, states jsonMap[string, RuleState], rearms []Rearm) {
	prev := *w.LastReading
	states = jsonMap[string, RuleState]{}
	for _, rule := range w.Rules {
		old := w.RuleState[rule.ID]
		ev, st := Evaluate(rule, old, prev, reading)
		states[rule.ID] = st
		if ev != nil {
			ev.WatchID = w.ID
			fired = append(fired, firedEvent{ev: *ev, w: w, rule: rule, ref: refBefore(rule, old, prev)})
		}
		if v, ok := reading.value(); ok && rearmed(rule, old, st, prev, reading) {
			rearms = append(rearms, Rearm{WatchID: w.ID, RuleID: rule.ID, Value: v, Currency: reading.Currency})
		}
	}
	return fired, states, rearms
}

// judgedRun applies what planCheck decided to the rules that fired in the
// save. The save evaluates again under the lock, and a watch edited while
// it was read drops out, so the verdict applies only when the save alerts
// on exactly what the judge saw; otherwise the alert goes out in the rules'
// words, unchecked, with no re-judge. A Bot switched to AI judging during
// the check is unchecked too; one switched to rules alerts by its rules.
func judgedRun(b Bot, p checkPlan, run alertRun) alertRun {
	if b.JudgeMode != JudgeAI {
		return run
	}
	if !p.asked() || !sameKeys(eventKeys(run.fired), p.judgedKeys) {
		run.aiState, run.aiNote = aiUnchecked, noteChanged
		return run
	}
	run.verdict, run.aiState, run.aiNote, run.aiInput = p.verdict, p.aiState, p.aiNote, p.aiInput
	return run
}

// firedOutcome is the outcome of a check whose rules fired.
func firedOutcome(run alertRun) string {
	if run.verdict != nil && !run.verdict.Alert {
		return outJudgedQuiet
	}
	return outFired
}

// rearmed reports whether a below or above rule armed again in this check:
// it was waiting for the value to come back past its reset band, and now it
// is (the next crossing alerts). Other rule kinds flip Armed on every check,
// and a currency change rebaselines rather than re-arms, so neither counts.
func rearmed(r Rule, old, cur RuleState, prev, reading Reading) bool {
	if r.Kind != RuleBelow && r.Kind != RuleAbove {
		return false
	}
	if prev.Currency != "" && reading.Currency != "" && !strings.EqualFold(prev.Currency, reading.Currency) {
		return false
	}
	before := old
	if before == (RuleState{}) {
		before = Rebaseline(r, prev) // as Evaluate does
	}
	return !before.Armed && cur.Armed
}

// refBefore is the value a fired price rule is measured from.
func refBefore(r Rule, old RuleState, prev Reading) *float64 {
	if r.Kind == RuleMovePct && old.Ref != nil {
		v := *old.Ref
		return &v
	}
	if v, ok := prev.value(); ok {
		return &v
	}
	return nil
}

// watchChanged reports whether a reading moved: new feed items, other text,
// or another price.
func watchChanged(prev, cur Reading) bool {
	if cur.Kind == ReadingFeed {
		seen := map[string]bool{}
		for _, id := range prev.Seen {
			seen[id] = true
		}
		for _, it := range prev.Items {
			seen[it.ID] = true
		}
		for _, it := range cur.Items {
			if !seen[it.ID] {
				return true
			}
		}
		return false
	}
	return changed(prev, cur)
}

// addPricePoint appends a quote to its UTC day. A repeat of the last point's
// quote time adds nothing. A quote in another currency than the series (a
// shop page shown for another country) starts the series again, so the
// spark and the day's move never compare amounts across currencies.
func addPricePoint(tx *gorm.DB, w Watch, r Reading) error {
	at := r.At.UTC()
	if err := tx.Exec(`DELETE FROM bot_price_days WHERE watch_id = ? AND currency <> ?`, w.ID, r.Currency).Error; err != nil {
		return err
	}
	return tx.Exec(`
INSERT INTO bot_price_days (watch_id, day, bot_id, user_id, currency, points, open, high, low, close)
VALUES (@w, CAST(@day AS date), @b, @u, @cur, jsonb_build_array(jsonb_build_array(CAST(@t AS bigint), CAST(@p AS numeric))),
        CAST(@p AS numeric), CAST(@p AS numeric), CAST(@p AS numeric), CAST(@p AS numeric))
ON CONFLICT (watch_id, day) DO UPDATE
   SET points = bot_price_days.points || jsonb_build_array(jsonb_build_array(CAST(@t AS bigint), CAST(@p AS numeric))),
       high = GREATEST(bot_price_days.high, CAST(@p AS numeric)),
       low = LEAST(bot_price_days.low, CAST(@p AS numeric)),
       close = CAST(@p AS numeric)
 WHERE (bot_price_days.points -> -1 ->> 0) IS DISTINCT FROM CAST(@t AS bigint)::text`,
		sql.Named("w", w.ID), sql.Named("day", at.Format(dayLayout)), sql.Named("b", w.BotID), sql.Named("u", w.UserID),
		sql.Named("cur", r.Currency), sql.Named("t", at.Unix()), sql.Named("p", *r.Price)).Error
}

// clipReading keeps a reading's JSON within limit bytes, cutting the text
// and the item lists.
func clipReading(r Reading, limit int) Reading {
	for range 12 {
		raw, err := json.Marshal(r)
		if err != nil || len(raw) <= limit {
			return r
		}
		switch {
		case len(r.Text) > 1:
			// Escapes can make the JSON longer than the text: cut in proportion.
			r.Text = utils.ClipUTF8(r.Text, max(1, len(r.Text)*limit/len(raw)-64))
		case len(r.Items) > 0:
			r.Items = r.Items[:len(r.Items)/2]
		case len(r.Seen) > 0:
			r.Seen = r.Seen[:len(r.Seen)/2]
		default:
			return r
		}
	}
	return r
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
