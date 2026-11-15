package bots

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"math"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/features/bots/extract"
	"timely-api/internal/features/notify"
	"timely-api/internal/utils"
)

// Saving an agent tick (plan 7.3 step 5): the Check, the readings, the alerts
// with their fingerprints, proposals, Findings, Things and passes, the Bot's
// next check and its failure ladder, in ONE transaction.

const (
	// heldDup holds an alert whose fingerprint was already sent in the last
	// DuplicateDays days.
	heldDup = "duplicate"
	// DuplicateDays is how long the same alert is held as a duplicate.
	DuplicateDays = 7
	// maxTickReports bounds the alerts one tick may raise.
	maxTickReports = MaxItemFindings
	// maxProposalBytes bounds a stored proposal.
	maxProposalBytes = 16 << 10
	// rateHold is how long a rate-limited provider holds the next check when
	// the provider says nothing more.
	rateHold = 15 * time.Minute
	// maxRateHold caps what a provider's Retry-After may hold a Bot for.
	maxRateHold = 24 * time.Hour
	// maxReportBody bounds what a report's body keeps, in characters.
	maxReportBody = 600
)

// How an agent tick ends, which decides what is saved.
const (
	endOK = iota
	endUnchanged
	endBusy
	endNoAI
	endCapped
	endUnreachable
	endRateLimited
	endStrike
)

// agentEnd is how a tick ended, worked out from its run.
type agentEnd struct {
	kind        int
	outcome     string
	errKind     string
	errText     string
	skip        string
	gateSkipped bool
	// consume is true when the readings become what the next gate compares to.
	// A tick that did not get its readings looked at (a failed or waiting run)
	// leaves them, so the next tick wakes on the same change again.
	consume bool
	// retryAfter is the wait a rate-limited provider asked for, 0 for none.
	retryAfter time.Duration
}

// endOf works out how a tick ended.
func endOf(run agentRun) agentEnd {
	e := agentEnd{kind: endOK, outcome: outSilent, consume: true}
	switch {
	case run.skip == SkipUnchanged:
		e.kind, e.outcome, e.gateSkipped, e.skip = endUnchanged, outUnchanged, true, SkipUnchanged
	case run.skip == SkipBrowserBusy || run.class == ClassBrowserBusy:
		e.kind, e.outcome, e.skip, e.consume = endBusy, outSkipped, SkipBrowserBusy, false
	case run.class == classNoAI:
		e.kind, e.outcome, e.skip = endNoAI, outNoAI, SkipNoAI
	case run.capped:
		e.kind, e.outcome, e.consume = endCapped, outSkipped, false
	case run.class == ClassUnreachable:
		e.kind, e.outcome, e.errKind, e.consume = endUnreachable, outOffline, ClassUnreachable, false
	case run.class == ClassRateLimited:
		e.kind, e.outcome, e.errKind, e.consume = endRateLimited, outRateLimited, ClassRateLimited, false
		e.retryAfter = run.res.RetryAfter
	case run.class != "":
		e.kind, e.outcome, e.errKind, e.consume = endStrike, outFailed, run.class, false
	}
	if run.class != "" && run.class != classNoAI && run.class != ClassBrowserBusy {
		text := run.res.Response
		if run.err != nil {
			text = run.err.Error()
		}
		e.errText = utils.StorableText(utils.RedactSecrets(text), maxCheckError)
	}
	return e
}

// runRecordOf is the tick's own record for its Check: what the run said and
// did, without the readings. nil for a tick that did not ask the Agent.
func runRecordOf(run agentRun) *RunRecord {
	if !run.ran {
		return nil
	}
	trace := run.res.Trace
	if trace == nil {
		trace = []ToolTrace{}
	}
	return &RunRecord{
		Response: utils.ClipUTF8(utils.RedactSecrets(run.res.Response), maxRunResponse), Silent: run.res.Silent,
		Reports: len(run.res.Reports), Trace: trace, Usage: run.res.Usage, ErrorClass: run.class, Model: run.model,
	}
}

// strikeLine is the health line of a failed run.
var strikeLine = map[string]string{
	ClassTimeout:     "The run took too long",
	ClassCrash:       "The agent stopped while it was running",
	ClassCronFailure: "The run reported that it failed",
	ClassInjection:   "The run was stopped for following text from a page",
}

// cleanReports is the alerts a finished run asks for, cleaned: a silent run
// has none; a run that answered with text and no report gets one from its
// first line (plan 7.3 step 5). At most maxTickReports are kept.
func cleanReports(run agentRun) []Report {
	if !run.ran || run.class != "" || run.res.Silent {
		return nil
	}
	reports := run.res.Reports
	if len(reports) == 0 {
		resp := strings.TrimSpace(run.res.Response)
		if resp == "" || strings.HasPrefix(strings.ToUpper(resp), "[SILENT]") {
			return nil
		}
		reports = []Report{{Title: firstLine(resp), Body: resp}}
	}
	out := make([]Report, 0, min(len(reports), maxTickReports))
	for _, r := range reports {
		r.Body = clipRunes(cleanBody(r.Body), maxReportBody)
		r.Title = clipRunes(cleanLine(r.Title, 2*maxFindingTitle), maxFindingTitle)
		if r.Title == "" {
			r.Title = clipRunes(cleanLine(firstLine(r.Body), 2*maxFindingTitle), maxFindingTitle)
		}
		if r.Title == "" {
			continue
		}
		if r.URL != "" {
			if u, err := cleanURL(r.URL, "report"); err == nil {
				r.URL = u
			} else {
				r.URL = ""
			}
		}
		r.Symbol = cleanLine(r.Symbol, 20)
		switch r.Urgency {
		case UrgencyLow, UrgencyNormal, UrgencyHigh:
		default:
			r.Urgency = UrgencyNormal
		}
		if r.Price != nil && (math.IsNaN(*r.Price) || math.IsInf(*r.Price, 0)) {
			r.Price = nil
		}
		if len(r.Proposal) > 0 && (len(r.Proposal) > maxProposalBytes || !json.Valid(r.Proposal) || r.Proposal[0] != '{') {
			r.Proposal = nil
		}
		out = append(out, r)
		if len(out) == maxTickReports {
			break
		}
	}
	return out
}

func firstLine(s string) string {
	line, _, _ := strings.Cut(strings.TrimSpace(s), "\n")
	return strings.TrimSpace(line)
}

// reportThing is the thing a report tells of: its page, else its symbol.
func reportThing(r Report) string {
	switch {
	case r.URL != "":
		return "page:" + normURL(r.URL)
	case r.Symbol != "":
		return "symbol:" + strings.ToUpper(r.Symbol)
	}
	return ""
}

// reportFingerprint identifies an alert's content: its normalised title, its
// address, the thing it tells of and the price rounded to the cent. The same
// fingerprint within DuplicateDays days is held as a duplicate.
func reportFingerprint(r Report, thing string) string {
	title := strings.ToLower(strings.Join(strings.Fields(r.Title), " "))
	value := ""
	if r.Price != nil {
		value = strconv.FormatFloat(math.Round(*r.Price*100)/100, 'f', -1, 64)
	}
	sum := sha256.Sum256([]byte(title + "\x00" + normURL(r.URL) + "\x00" + thing + "\x00" + value))
	return hex.EncodeToString(sum[:])
}

// reportSave is what a report's alerts and findings need of the tick that
// made them.
type reportSave struct {
	bot     Bot
	checkID string
	chainID string
	depth   int
	now     time.Time
	away    string
	via     []ViaStep
	// source is the note a pass tick was handed, nil for a tick of its own.
	source *Finding
}

// reportResult is what a tick's reports became.
type reportResult struct {
	firstAlert string // the first alert row that was not a duplicate
	raised     int    // alert rows that were not duplicates, held or not
	duplicates int
	passed     int  // reports a link took, or the brief did
	briefOnly  bool // the Bot is "Only in the brief"
	posts      []string
}

// saveReports writes a tick's reports in the caller's transaction: per report
// an alert (held as a duplicate, snoozed, shared or capped as the rules
// Bots' alerts are, else notified), its Finding and Thing, then what links
// take on to other Bots. A report a link took, or one of a Bot that is only
// in its brief, raises no alert of its own.
func (s *Service) saveReports(tx *gorm.DB, rs reportSave, reports []Report) (reportResult, error) {
	var res reportResult
	if len(reports) == 0 {
		return res, nil
	}
	b := rs.bot
	var links []linkTarget
	if rs.depth+1 <= ChainSteps {
		var err error
		if links, err = passLinks(tx, b); err != nil {
			return res, err
		}
	}
	briefOnly, err := briefOnlyNow(tx, b)
	if err != nil {
		return res, err
	}
	res.briefOnly = briefOnly
	ev := firedEvent{
		ev:   Event{WatchID: "agent", RuleID: "report", Kind: RuleNewItem},
		w:    Watch{ID: "agent"},
		rule: Rule{Kind: RuleNewItem},
	}
	keys := make([]itemKey, len(reports))
	for i, r := range reports {
		id := "r" + strconv.Itoa(i)
		ev.ev.NewItems = append(ev.ev.NewItems, extract.FeedItem{ID: id, Title: r.Title + "\n" + r.Body, Link: r.URL})
		keys[i] = itemKey{"agent", "report", id}
	}
	taken := takeItems([]firedEvent{ev}, links, rs.depth)
	findings := make([]Finding, 0, len(reports))
	for i, r := range reports {
		thing := reportThing(r)
		told := false
		takenByLink := len(taken[keys[i]]) > 0
		if takenByLink || briefOnly {
			res.passed++
		} else {
			alert, sent, err := s.agentAlert(tx, rs, r, thing)
			if err != nil {
				return res, err
			}
			switch {
			case alert.Held == heldDup:
				res.duplicates++
			default:
				res.raised++
				if res.firstAlert == "" {
					res.firstAlert = alert.ID
				}
			}
			if sent {
				told = true
				res.posts = append(res.posts, alert.ID)
			}
		}
		kind := "change"
		if r.Price != nil {
			kind = "price"
		}
		f := Finding{
			ID: utils.PrefixedUUID("bfd"), BotID: b.ID, UserID: b.UserID, CheckID: &rs.checkID, Kind: kind,
			Title: r.Title, Why: clipRunes(firstLine(r.Body), maxFindingWhy), URL: r.URL, Price: r.Price,
			Urgency: r.Urgency, OutsideData: true, Alerted: told, ThingKey: thing, CreatedAt: rs.now,
		}
		if rs.source != nil {
			src := rs.source.ID
			f.ChainID, f.Depth, f.SourceFindingID = rs.chainID, rs.depth, &src
		}
		findings = append(findings, f)
	}
	if err := tx.Create(&findings).Error; err != nil {
		return res, err
	}
	pr := passRun{bot: b, checkID: rs.checkID, chainID: rs.chainID, depth: rs.depth, now: rs.now}
	if err := applyPasses(tx, pr, []firedEvent{ev}, taken, findings, keys); err != nil {
		return res, err
	}
	return res, nil
}

// agentAlert raises the alert for one report in the caller's transaction:
// held 'duplicate' when its fingerprint was sent in the last DuplicateDays
// days, held while the Bot is snoozed, held 'shared' when another Bot told of
// the same thing today, sent while the Bot has sent fewer than AlertsPerDay
// today, else folded into "and N more today". The report's urgency is kept on
// the row and never lifts quiet hours: only the Bot's own urgent switch does.
// A proposal waits on the row as a pending Review card; nothing applies it.
func (s *Service) agentAlert(tx *gorm.DB, rs reportSave, r Report, thing string) (Alert, bool, error) {
	b, now := rs.bot, rs.now
	settings, loc, err := notify.LoadAlertSettings(tx, b.UserID)
	if err != nil {
		return Alert{}, false, err
	}
	local := now.In(loc)
	day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	opts := notify.AlertOptions{Urgent: b.Urgent, Phone: b.NotifyPhone, Now: now}
	alertID := utils.PrefixedUUID("bal")
	figures := jsonMap[string, any]{"what": r.Title}
	if r.Price != nil {
		figures["price"] = *r.Price
	}
	if rs.away != "" {
		figures["away"] = rs.away
	}
	title, body := b.Name+": "+r.Title, withAway(r.Body, rs.away)
	row := Alert{
		ID: alertID, BotID: b.ID, UserID: b.UserID, CheckID: &rs.checkID, Kind: alertKindAlert, LocalDay: day,
		Title: title, Body: body, URL: r.URL, Figures: figures, Urgent: b.Urgent, Urgency: r.Urgency, Via: rs.via,
		Fingerprint: reportFingerprint(r, thing), CreatedAt: now,
	}
	if len(r.Proposal) > 0 {
		row.Proposal, row.ProposalState = r.Proposal, ProposalPending
	}
	var dup int64
	if err := tx.Model(&Alert{}).Where("bot_id = ? AND kind = ? AND fingerprint = ? AND held = '' AND created_at > ?",
		b.ID, alertKindAlert, row.Fingerprint, now.Add(-DuplicateDays*24*time.Hour)).Count(&dup).Error; err != nil {
		return row, false, err
	}
	if dup > 0 {
		row.Held, row.Proposal, row.ProposalState = heldDup, nil, ""
		return row, false, tx.Create(&row).Error
	}
	if _, held := notify.QuietUntil(settings, loc, opts); held {
		title = withHeldTime(title, now, loc)
		row.Title = title
	}
	if b.SnoozedUntil != nil && b.SnoozedUntil.After(now) {
		row.Held = heldSnoozed
		return row, false, tx.Create(&row).Error
	}
	things := []Thing{}
	if thing != "" {
		things = append(things, Thing{Key: thing, Value: r.Price, Urgency: r.Urgency})
	}
	if shared, err := shareAlert(tx, b, &row, things); err != nil || shared {
		return row, false, err
	}
	var today int64
	if err := tx.Model(&Alert{}).Where("bot_id = ? AND local_day = ? AND kind = ? AND held = ''", b.ID, day.Format(dayLayout), alertKindAlert).
		Count(&today).Error; err != nil {
		return row, false, err
	}
	if today < AlertsPerDay {
		ntf := botNotification(b, title, body, "bot:"+b.ID+":"+rs.checkID+":"+alertID, alertData(b, alertID, rs.checkID, r.URL, alertKindAlert))
		if _, err := notify.WriteAlert(tx, &ntf, settings, loc, opts); err != nil {
			return row, false, err
		}
		row.NotificationID, row.Things = &ntf.ID, things
		return row, true, tx.Create(&row).Error
	}
	row.Held = heldCap
	if err := tx.Create(&row).Error; err != nil {
		return row, false, err
	}
	return row, false, s.moreAlert(tx, b, row, settings, loc, opts)
}

// postAlerts posts the alerts a tick told into the Bot's thread, after the
// save, so a thread that fails never loses an alert.
func (s *Service) postAlerts(ctx context.Context, b Bot, alertIDs []string) {
	if s.threads == nil {
		return
	}
	for _, id := range alertIDs {
		if err := s.threads.PostAlert(ctx, b.UserID, b.ID, id); err != nil {
			log.Printf("bots: post alert %s into the thread of %s: %v", id, b.ID, err)
		}
	}
}

// agentNextAt is when an agent Bot is next due after now: its schedule in its
// zone (the notification zone while it names none), with the usual jitter on
// an interval, only inside the market session with MarketHours, and never
// before the floor of its Reads allows.
func (s *Service) agentNextAt(b Bot, ws []Watch, loc *time.Location, now time.Time) time.Time {
	if b.Timezone == "" && loc != nil {
		b.Timezone = loc.String()
	}
	floor := AgentFloor(ws)
	sched, err := ScheduleFromMap(b.Schedule)
	var at time.Time
	switch {
	case err != nil || sched.Kind() == "":
		at = s.nextCheck(max(b.Interval(), floor), now)
	case sched.Kind() == ScheduleEvery:
		at = s.nextCheck(AgentInterval(sched, ws), now)
		if b.MarketHours && !MarketOpen(at) {
			at = nextMarketOpen(at)
		}
	default:
		at = NextAgentCheck(b, now, ws...)
		if at.IsZero() {
			at = s.nextCheck(max(b.Interval(), floor), now)
		}
	}
	if b.CheckStartedAt != nil {
		at = maxTime(at, spacedAt(b.CheckStartedAt, floor))
	}
	return at
}

// unreachableRuns counts the Bot's checks in a row, newest first, that ended
// because the model could not be reached.
func unreachableRuns(tx *gorm.DB, botID string) (int, error) {
	var kinds []string
	err := tx.Model(&Check{}).Where("bot_id = ?", botID).Order("started_at DESC, id DESC").Limit(len(agentLadder)).Pluck("error_kind", &kinds).Error
	n := 0
	for _, k := range kinds {
		if k != ClassUnreachable {
			break
		}
		n++
	}
	return n, err
}

// saveAgentReads saves what the tick's Watches read: each Watch's health,
// reading time and price day, and, when consume is set, the reading itself
// and the validators that go with it, so the next gate compares to it. It
// returns the Check's per-watch outcomes and the readings of Watches that were
// new or moved.
func saveAgentReads(tx *gorm.DB, c checkRun, cur []Watch, consume bool, done time.Time) (cws []CheckWatch, moved map[string]Reading, closed, read bool, err error) {
	byID := make(map[string]Watch, len(cur))
	for _, w := range cur {
		byID[w.ID] = w
	}
	moved = map[string]Reading{}
	cws = make([]CheckWatch, 0, len(c.reads))
	for _, r := range c.reads {
		cw := r.cw
		w, ok := byID[r.w.ID]
		if !ok || w.ConfigVersion != r.w.ConfigVersion {
			cw.Outcome = outSuperseded
			cws = append(cws, cw)
			continue
		}
		read = true
		closed = closed || r.closed
		reading := clipReading(r.reading, MaxReadingBytes)
		set := map[string]any{"last_reading_at": done, "health": healthWorking, "health_detail": "", "updated_at": done}
		first := w.LastReading == nil || w.BaselinePending
		switch {
		case first:
			cw.Outcome = outBaseline
			moved[w.ID] = reading
			if w.LastReading == nil || w.LastChangedAt == nil || watchChanged(*w.LastReading, reading) {
				set["last_changed_at"] = done
			}
		case r.notMod:
			cw.Outcome = outNotModified
		default:
			cw.Outcome = outUnchanged
			if watchChanged(*w.LastReading, reading) {
				cw.Outcome = outChanged
				moved[w.ID] = reading
				set["last_changed_at"] = done
			}
		}
		if consume {
			raw, err := json.Marshal(reading)
			if err != nil {
				return nil, nil, false, false, err
			}
			set["last_reading"], set["baseline_pending"] = string(raw), false
			if r.res != nil && !r.notMod {
				set["etag"], set["last_modified"] = "", ""
				if r.res.FinalURL == w.URL {
					set["etag"], set["last_modified"] = r.res.ETag, r.res.LastModified
				}
				set["validators_url"] = w.URL
			}
		}
		if err := tx.Model(&Watch{}).Where("id = ?", w.ID).Updates(set).Error; err != nil {
			return nil, nil, false, false, err
		}
		if !r.notMod && reading.Kind == ReadingPrice && reading.Price != nil {
			if err := addPricePoint(tx, w, reading); err != nil {
				return nil, nil, false, false, err
			}
		}
		cws = append(cws, cw)
	}
	return cws, moved, closed, read, nil
}

// saveAgent saves one agent tick of a Bot's own schedule in ONE transaction
// and returns the alerts to post into the Bot thread. A tick already saved
// (the Check exists) or whose claim was lost saves nothing.
func (s *Service) saveAgent(ctx context.Context, c checkRun, run agentRun) ([]string, error) {
	var posts []string
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		posts = nil
		done := s.now().UTC()
		var have int64
		if err := tx.Model(&Check{}).Where("id = ?", c.checkID).Count(&have).Error; err != nil || have > 0 {
			return err
		}
		b, ok, err := lockClaimed(tx, c)
		if err != nil || !ok {
			return err
		}
		cur, err := loadWatches(tx, b.ID, true)
		if err != nil {
			return err
		}
		end := endOf(run)
		cws, moved, closed, read, err := saveAgentReads(tx, c, cur, end.consume, done)
		if err != nil {
			return err
		}
		check := Check{
			ID: c.checkID, BotID: b.ID, UserID: b.UserID, JobID: &c.job.ID, Trigger: c.trigger, StartedAt: c.started, FinishedAt: done,
			Outcome: end.outcome, ErrorKind: end.errKind, Error: end.errText, Watches: cws, Fired: jsonList[FiredRule]{}, Rearmed: jsonList[Rearm]{},
			GateSkipped: end.gateSkipped, SkipReason: end.skip, Run: runRecordOf(run),
		}
		check.AwaySecs, check.AwayReason = awayOf(b)
		if len(moved) > 0 && (end.kind == endOK || end.kind == endNoAI || end.kind == endUnchanged) {
			check.Reading = make(map[string]Reading, len(moved))
			for id, r := range moved {
				check.Reading[id] = clipReading(r, MaxReadingBytes/max(len(moved), 1))
			}
		}
		if err := tx.Create(&check).Error; err != nil {
			return err
		}
		if end.kind == endOK {
			res, err := s.saveReports(tx, reportSave{
				bot: b, checkID: c.checkID, chainID: c.chainID, depth: c.depth, now: done,
				away: awayLineOf(check.AwaySecs, check.AwayReason),
			}, cleanReports(run))
			if err != nil {
				return err
			}
			posts = res.posts
			outcome, skip := outSilent, ""
			switch {
			case res.raised > 0:
				outcome = outAlerted
			case res.duplicates > 0:
				outcome, skip = outDuplicate, SkipDuplicate
			case res.passed > 0:
				outcome = outPassed
			}
			upd := map[string]any{"outcome": outcome, "skip_reason": skip}
			if res.firstAlert != "" {
				upd["alert_id"] = res.firstAlert
			}
			if err := tx.Model(&Check{}).Where("id = ?", c.checkID).Updates(upd).Error; err != nil {
				return err
			}
		}
		if err := s.finishAgentBot(tx, c, b, cur, end, closed, read, done); err != nil {
			return err
		}
		if s.beforeCommit != nil {
			return s.beforeCommit(tx)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return posts, nil
}

// finishAgentBot updates the Bot after its tick: strikes, health, offline
// time, the next check and, at MaxStrikes, the pause and its alert.
func (s *Service) finishAgentBot(tx *gorm.DB, c checkRun, b Bot, cur []Watch, end agentEnd, closed, read bool, done time.Time) error {
	_, loc, err := notify.LoadAlertSettings(tx, b.UserID)
	if err != nil {
		return err
	}
	set := map[string]any{"last_check_at": done, "checking_job_id": nil, "updated_at": done}
	if read {
		clearAway(set)
	}
	next := s.agentNextAt(b, cur, loc, done)
	switch end.kind {
	case endOK, endUnchanged, endBusy, endCapped:
		set["strikes"], set["last_ok_at"], set["offline_since"] = 0, done, nil
		set["health"], set["health_detail"] = healthWorking, ""
	case endNoAI:
		set["last_ok_at"], set["offline_since"] = done, nil
		set["health"], set["health_detail"] = healthNeedsAI, "Needs AI. Timely records what it reads and sends no alert until an AI provider is set up"
	case endUnreachable:
		n, err := unreachableRuns(tx, b.ID)
		if err != nil {
			return err
		}
		// n counts this check too: the first failure waits the first step.
		delay := agentLadder[min(max(n-1, 0), len(agentLadder)-1)]
		next = done.Add(delay)
		set["health"], set["health_detail"] = "offline", "The AI could not be reached. Trying again at "+next.In(loc).Format("15:04")
		if b.OfflineSince == nil {
			set["offline_since"] = done
		}
		// Nothing was lost: the floor its claim took is given back so the
		// retry is not turned away by it.
		set["check_started_at"] = c.prevStarted
	case endRateLimited:
		// Never a strike. The provider's Retry-After holds the Bot, no shorter
		// than the source floor and no longer than a day; without one, rateHold.
		next = maxTime(done.Add(rateHoldFor(end.retryAfter, c.floor)), c.spaced())
		set["health"], set["health_detail"] = "rate_limited", "The AI provider asked Timely to wait until "+next.In(loc).Format("15:04")
	case endStrike:
		if end.errKind == ClassInjection {
			// A page gave the run instructions: no strike to count, the Bot
			// stops at once and the person decides.
			set["health"], set["health_detail"] = ClassInjection, injectionLine
			if b.Status == StatusActive {
				set["status"], set["pause_reason"], set["next_check_at"] = StatusPaused, PauseInjection, nil
				if err := s.injectionAlert(tx, b, c.checkID, done); err != nil {
					return err
				}
			}
			break
		}
		strikes := b.Strikes + 1
		set["strikes"] = strikes
		next = maxTime(done.Add(StrikeDelay(b.Interval(), strikes)), c.spaced())
		line := strikeLine[end.errKind]
		if line == "" {
			line = "The run failed"
		}
		set["health"], set["health_detail"] = end.errKind, line
		if strikes >= MaxStrikes && b.Status == StatusActive {
			set["status"], set["pause_reason"], set["next_check_at"] = StatusPaused, PauseStrikes, nil
			b.Strikes = strikes
			p := &problem{class: classStrike, outcome: outFailed, code: end.errKind, line: line, err: errors.New(line)}
			if err := s.pausedAlert(tx, b, c.checkID, p, done); err != nil {
				return err
			}
		}
	}
	if end.kind != endUnreachable {
		next = maxTime(next, c.spaced())
	} else {
		next = maxTime(next, spacedAt(c.prevStarted, c.floor))
	}
	if closed && end.kind != endUnreachable {
		next = maxTime(next, done.Add(closedEvery))
	}
	if _, paused := set["status"]; !paused && b.Status == StatusActive {
		set["next_check_at"] = next
	}
	return tx.Model(&Bot{}).Where("id = ?", b.ID).Updates(set).Error
}

// rateHoldFor is how long a rate-limited run holds the Bot's next check: the
// provider's Retry-After, no shorter than the source floor and no longer than
// maxRateHold, or rateHold when it said nothing.
func rateHoldFor(retryAfter, floor time.Duration) time.Duration {
	if retryAfter <= 0 {
		return rateHold
	}
	return min(max(retryAfter, floor), maxRateHold)
}

// injectionLine is the health line of a Bot stopped for following a page (the
// contract's INJECTION_LINE).
const injectionLine = "Stopped: a page tried to instruct it"

// injectionAlert tells the person a Bot stopped at once because a page tried to
// give it instructions, with a Resume they can act on from the alert. Like the
// strike pause it is not counted in the daily cap.
func (s *Service) injectionAlert(tx *gorm.DB, b Bot, checkID string, now time.Time) error {
	settings, loc, err := notify.LoadAlertSettings(tx, b.UserID)
	if err != nil {
		return err
	}
	local := now.In(loc)
	day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	title := b.Name + " stopped: a page tried to instruct it"
	body := "It stopped because a page tried to give it instructions. Nothing it read was acted on. Check the Bot, then resume it from this alert or in the Assistant."
	row := Alert{
		ID: utils.PrefixedUUID("bal"), BotID: b.ID, UserID: b.UserID, CheckID: &checkID, Kind: alertKindPaused, LocalDay: day,
		Title: title, Body: body, Figures: jsonMap[string, any]{"health": ClassInjection}, CreatedAt: now,
	}
	data := alertData(b, row.ID, checkID, "", alertKindPaused)
	data["resume"] = true
	ntf := botNotification(b, title, body, "bot:"+b.ID+":paused:"+checkID, data)
	if _, err := notify.WriteAlert(tx, &ntf, settings, loc, notify.AlertOptions{Phone: b.NotifyPhone, Now: now}); err != nil {
		return err
	}
	row.NotificationID = &ntf.ID
	return tx.Create(&row).Error
}

// passAgent runs a pass tick of an agent Bot: the note another Bot passed is
// the run's data, the Bot's own prompt the task. The Bot's schedule, readings
// and strikes are left alone, and a run that cannot happen leaves the pass
// folded into the next brief or failed, never a strike.
func (s *Service) passAgent(ctx context.Context, pc *passCheck) error {
	pc.checkID = agentCheckID(pc.job)
	c := checkRun{
		job: pc.job, bot: pc.bot, trigger: TriggerPass, started: pc.started, floor: AgentFloor(pc.ws),
		checkID: pc.checkID, chainID: pc.pass.ChainID, depth: pc.pass.Depth,
	}
	note := pc.note
	run, err := s.runAgent(ctx, c, pc.ws, &note)
	if err != nil {
		return retryDB(err)
	}
	if ctx.Err() != nil {
		return retryDB(ctx.Err())
	}
	posts, err := s.savePassAgent(ctx, pc, c, run)
	if err != nil {
		return retryDB(err)
	}
	s.postAlerts(ctx, pc.bot, posts)
	return nil
}

// savePassAgent saves a pass tick of an agent Bot in one transaction.
func (s *Service) savePassAgent(ctx context.Context, pc *passCheck, c checkRun, run agentRun) ([]string, error) {
	var posts []string
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		posts = nil
		done := s.now().UTC()
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
		end := endOf(run)
		state := passQuiet
		switch end.kind {
		case endBusy, endCapped:
			state = passFolded
		case endNoAI, endUnreachable, endRateLimited, endStrike:
			state = passFailed
		}
		check := Check{
			ID: c.checkID, BotID: b.ID, UserID: b.UserID, JobID: &pc.job.ID, Trigger: TriggerPass, StartedAt: pc.started, FinishedAt: done,
			Outcome: end.outcome, ErrorKind: end.errKind, Error: end.errText, Watches: jsonList[CheckWatch]{}, Fired: jsonList[FiredRule]{}, Rearmed: jsonList[Rearm]{},
			SkipReason: end.skip, Run: runRecordOf(run),
		}
		if err := tx.Create(&check).Error; err != nil {
			return err
		}
		if end.kind == endOK {
			via, err := passVia(tx, pc)
			if err != nil {
				return err
			}
			res, err := s.saveReports(tx, reportSave{
				bot: b, checkID: c.checkID, chainID: p.ChainID, depth: p.Depth, now: done, via: via, source: &pc.note,
			}, cleanReports(run))
			if err != nil {
				return err
			}
			posts = res.posts
			outcome, skip := outSilent, ""
			switch {
			case res.raised > 0:
				outcome = outAlerted
				state = passAlerted
			case res.duplicates > 0:
				outcome, skip = outDuplicate, SkipDuplicate
			case res.passed > 0:
				outcome = outPassed
			}
			upd := map[string]any{"outcome": outcome, "skip_reason": skip}
			if res.firstAlert != "" {
				upd["alert_id"] = res.firstAlert
			}
			if err := tx.Model(&Check{}).Where("id = ?", c.checkID).Updates(upd).Error; err != nil {
				return err
			}
		}
		return tx.Model(&Pass{}).Where("id = ?", p.ID).Updates(map[string]any{"state": state, "check_id": c.checkID, "updated_at": done}).Error
	})
	if err != nil {
		return nil, err
	}
	return posts, nil
}

// ConversionView is what switching a rules Bot to an agent would make: shown
// before the person approves it, one Bot at a time (Q-B4). Nothing is stored.
type ConversionView struct {
	BotID           string               `json:"botId"`
	Engine          string               `json:"engine"` // what the Bot is now
	Prompt          string               `json:"prompt"`
	Schedule        jsonMap[string, any] `json:"schedule"`
	IntervalMinutes int                  `json:"intervalMinutes"`
	Skills          []string             `json:"skills"`
	Gate            string               `json:"gate"`
	Timezone        string               `json:"timezone"`
}

var errConvertDone = invalid("This bot is already an agent")

// conversionOf works out a rules Bot's conversion and the agent fields it
// becomes, the same for the preview and the approval.
func conversionOf(db *gorm.DB, b Bot, ws []Watch) (ConversionView, AgentFields, error) {
	if b.Kind == KindBrief {
		return briefConversionOf(db, b)
	}
	if b.Engine == EngineAgent {
		return ConversionView{}, AgentFields{}, errConvertDone
	}
	loc, err := localZone(db, b.UserID)
	if err != nil {
		return ConversionView{}, AgentFields{}, err
	}
	conv := ConvertBot(b, ws)
	sched, err := json.Marshal(conv.Schedule)
	if err != nil {
		return ConversionView{}, AgentFields{}, err
	}
	tz := loc.String()
	f, err := CleanAgent(AgentInput{Prompt: &conv.Prompt, Schedule: sched, Timezone: &tz, Skills: &conv.Skills, Gate: &conv.Gate}, nil, ws, OriginApp)
	if err != nil {
		return ConversionView{}, AgentFields{}, err
	}
	return ConversionView{
		BotID: b.ID, Engine: b.Engine, Prompt: f.Prompt, Schedule: f.Schedule.Map(), IntervalMinutes: f.IntervalSeconds / 60,
		Skills: f.Skills, Gate: f.Gate, Timezone: f.Timezone,
	}, f, nil
}

// ConvertPreview shows what converting the Bot would make, without storing it.
func (s *Service) ConvertPreview(ctx context.Context, userID, idOrName string) (ConversionView, error) {
	db := s.db.WithContext(ctx)
	b, err := findBot(db, userID, idOrName, false)
	if err != nil {
		return ConversionView{}, err
	}
	ws, err := loadWatches(db, b.ID, false)
	if err != nil {
		return ConversionView{}, err
	}
	v, _, err := conversionOf(db, b, ws)
	return v, err
}

// Convert approves the conversion of one Bot: its engine flips to 'agent'
// with the prompt ConvertPrompt wrote, and nothing else changes. Its Watches,
// alerts, Findings and history stay. There is no bulk form (Q-B4).
func (s *Service) Convert(ctx context.Context, userID, idOrName string) (View, error) {
	now := s.now().UTC()
	var id string
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		b, err := findBot(tx, userID, idOrName, true)
		if err != nil {
			return err
		}
		ws, err := loadWatches(tx, b.ID, true)
		if err != nil {
			return err
		}
		_, f, err := conversionOf(tx, b, ws)
		if err != nil {
			return err
		}
		f.Apply(&b)
		b.UpdatedAt = now
		id = b.ID
		return tx.Select("Engine", "Prompt", "Schedule", "Timezone", "Skills", "Tools", "Egress", "UseMemory", "Permission", "Gate",
			"MarketHours", "ModelProvider", "Model", "IntervalSeconds", "UpdatedAt").Updates(&b).Error
	})
	if err != nil {
		return View{}, err
	}
	return s.store.view(ctx, userID, id, now)
}

// Notes lists an agent Bot's notepad, by key.
func (s *Service) Notes(ctx context.Context, userID, idOrName string) ([]Note, error) {
	b, err := findBot(s.db.WithContext(ctx), userID, idOrName, false)
	if err != nil {
		return nil, err
	}
	return NewNotesStore(s.db).List(ctx, userID, b.ID)
}

// DeleteNote removes one of the Bot's notes; ErrNoNote when it has none by
// that key.
func (s *Service) DeleteNote(ctx context.Context, userID, idOrName, key string) error {
	b, err := findBot(s.db.WithContext(ctx), userID, idOrName, false)
	if err != nil {
		return err
	}
	return NewNotesStore(s.db).Delete(ctx, userID, b.ID, key)
}

// agentChecks reads the agent fields of checks (their run, gate and skip
// reason) by id, which the Detail's check list adds to its rows.
func (s *Service) agentChecks(ctx context.Context, userID string, ids []string) (map[string]Check, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var rows []Check
	err := s.db.WithContext(ctx).Select("id", "run", "gate_skipped", "skip_reason").Where("user_id = ? AND id IN ?", userID, ids).Find(&rows).Error
	out := make(map[string]Check, len(rows))
	for _, r := range rows {
		out[r.ID] = r
	}
	return out, err
}
