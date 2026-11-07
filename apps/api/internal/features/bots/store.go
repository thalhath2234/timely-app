package bots

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

const (
	detailRows   = 20
	detailItems  = 5  // feed items a Detail shows per watch
	stripChecks  = 28 // checks a board card's strip shows
	detailDays   = 30
	findingsMax  = 100
	findingsPage = 50
	dayLayout    = "2006-01-02"
	mcpPausedNew = "Made by an outside app. Turn it on in Timely."
	mcpPausedNow = "Changed by an outside app. Turn it on in Timely."
)

// Store reads and writes Bots. Every write that checks the account's Bots
// as a whole runs under lockAccount.
type Store struct{ db *gorm.DB }

func NewStore(db *gorm.DB) *Store { return &Store{db: db} }

func (s *Store) conn(ctx context.Context) *gorm.DB { return s.db.WithContext(ctx) }

// lockAccount holds a transaction lock on the account's Bots. Row locks miss
// a first create, so this keeps two creates from passing the cap together.
func lockAccount(tx *gorm.DB, userID string) error {
	return tx.Exec("SELECT pg_advisory_xact_lock(hashtext('bots:' || ?))", userID).Error
}

// FindingQuery filters the findings board. BotID may be an id or a name.
type FindingQuery struct {
	BotID string
	Since time.Time
	Limit int
}

// Create saves a new Bot. Made in the app it is active and due now, so its
// first check records a quiet baseline; made over MCP it starts paused.
func (s *Store) Create(ctx context.Context, userID string, in Input, o Origin, now time.Time) (View, error) {
	now = now.UTC()
	if err := refuseMCPSettings(o, &in.JudgeMode, in.Urgent, in.Desktop, in.Phone); err != nil {
		return View{}, err
	}
	if o == OriginMCP && (in.Knowledge != nil || in.PassesTo != nil) {
		return View{}, errMCPSetup
	}
	name, err := cleanName(in.Name)
	if err != nil {
		return View{}, err
	}
	desc, err := cleanDescription(in.Description)
	if err != nil {
		return View{}, err
	}
	judge, err := cleanJudge(in.JudgeMode)
	if err != nil {
		return View{}, err
	}
	hasKey, err := keySet(s.conn(ctx), userID)
	if err != nil {
		return View{}, err
	}
	ws, err := cleanWatches(in.Watches, nil, hasKey)
	if err != nil {
		return View{}, err
	}
	interval, err := cleanInterval(in.IntervalMinutes, ws)
	if err != nil {
		return View{}, err
	}
	// Switches left unset (always, from chat and outside apps) follow the
	// person's "Alerts for new bots".
	defs := models.DefaultBotAlertDefaults()
	if in.Urgent == nil || in.Desktop == nil || in.Phone == nil {
		if defs, err = alertDefaults(s.conn(ctx), userID); err != nil {
			return View{}, err
		}
	}
	if o == OriginMCP {
		defs.Urgent = false // an outside app never makes a Bot urgent
	}
	b := Bot{
		ID: utils.PrefixedUUID("bot"), UserID: userID, Name: name, Description: desc, Origin: o,
		Status: StatusActive, JudgeMode: judge, IntervalSeconds: interval,
		Urgent: deref(in.Urgent, defs.Urgent), NotifyDesktop: deref(in.Desktop, defs.Desktop), NotifyPhone: deref(in.Phone, defs.Phone),
		NextCheckAt: &now, Health: HealthNew, CreatedAt: now, UpdatedAt: now,
	}
	if o == OriginMCP {
		reason := PauseMCP
		b.Status, b.PauseReason, b.NextCheckAt, b.HealthDetail = StatusPaused, &reason, nil, mcpPausedNew
		b.OriginClient = cleanOriginClient(in.OriginClient)
	}
	for i := range ws {
		ws[i] = newWatch(ws[i], b, now)
	}
	var bd *board
	err = s.conn(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockAccount(tx, userID); err != nil {
			return err
		}
		if in.Knowledge != nil {
			k, err := cleanKnowledge(tx, userID, *in.Knowledge)
			if err != nil {
				return err
			}
			b.KnowledgeKind, b.KnowledgeID = k.Kind, k.ID
			bd = &board{knowledge: map[string]*KnowledgeView{b.ID: &k}}
		}
		var rows []Bot
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "name").Where("user_id = ?", userID).Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) >= MaxBots {
			return invalid("You can keep up to %d bots", MaxBots)
		}
		if err := nameTaken(rows, "", name); err != nil {
			return err
		}
		if err := tx.Create(&b).Error; err != nil {
			return nameConflict(err, name)
		}
		if err := tx.Create(&ws).Error; err != nil {
			return err
		}
		if in.PassesTo != nil {
			return saveLinks(tx, userID, b, *in.PassesTo, now)
		}
		return nil
	})
	if err != nil {
		return View{}, err
	}
	return viewOf(b, ws, bd, now), nil
}

// newWatch fills in a watch that is about to be inserted.
func newWatch(w Watch, b Bot, now time.Time) Watch {
	w.ID, w.BotID, w.UserID = utils.PrefixedUUID("bw"), b.ID, b.UserID
	w.Rules = ruleIDs(w.Rules, nil)
	w.RuleState = jsonMap[string, RuleState]{}
	w.BaselinePending, w.ConfigVersion, w.Health = true, 1, HealthNew
	w.CreatedAt, w.UpdatedAt = now, now
	return w
}

// Update edits a Bot. A watch whose address, read mode, selector, source,
// symbol, currency or rules change records a quiet baseline on its next
// check. Over MCP, such a change also pauses an active Bot. A change to the
// watches, the interval or judging drops the Bot's suggestion.
func (s *Store) Update(ctx context.Context, userID, idOrName string, p Patch, o Origin, now time.Time) (View, error) {
	now = now.UTC()
	if err := refuseMCPSettings(o, p.JudgeMode, p.Urgent, p.Desktop, p.Phone); err != nil {
		return View{}, err
	}
	if o == OriginMCP && (p.Knowledge != nil || p.ClearKnowledge || p.PassesTo != nil) {
		return View{}, errMCPSetup
	}
	set := map[string]any{"updated_at": now}
	var name string
	var err error
	if p.Name != nil {
		if name, err = cleanName(*p.Name); err != nil {
			return View{}, err
		}
		set["name"] = name
	}
	if p.Description != nil {
		desc, err := cleanDescription(*p.Description)
		if err != nil {
			return View{}, err
		}
		set["description"] = desc
	}
	if p.JudgeMode != nil {
		judge, err := cleanJudge(*p.JudgeMode)
		if err != nil {
			return View{}, err
		}
		set["judge_mode"] = judge
	}
	for col, v := range map[string]*bool{"urgent": p.Urgent, "notify_desktop": p.Desktop, "notify_phone": p.Phone} {
		if v != nil {
			set[col] = *v
		}
	}
	var botID string
	err = s.conn(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockAccount(tx, userID); err != nil {
			return err
		}
		b, err := findBot(tx, userID, idOrName, true)
		if err != nil {
			return err
		}
		botID = b.ID
		if o == OriginMCP && b.JudgeMode == JudgeAI &&
			((p.Description != nil && set["description"] != b.Description) || (p.Name != nil && name != b.Name)) {
			return errMCPJudged
		}
		switch {
		case p.Knowledge != nil:
			k, err := cleanKnowledge(tx, userID, *p.Knowledge)
			if err != nil {
				return err
			}
			set["knowledge_kind"], set["knowledge_id"] = k.Kind, k.ID
		case p.ClearKnowledge:
			set["knowledge_kind"], set["knowledge_id"] = "", ""
		}
		if p.Name != nil {
			var rows []Bot
			if err := tx.Select("id", "name").Where("user_id = ?", userID).Find(&rows).Error; err != nil {
				return err
			}
			if err := nameTaken(rows, b.ID, name); err != nil {
				return err
			}
		}
		cur, err := loadWatches(tx, b.ID, true)
		if err != nil {
			return err
		}
		ws := cur
		watchesChanged := false
		if p.Watches != nil {
			hasKey, err := keySet(tx, userID)
			if err != nil {
				return err
			}
			if ws, watchesChanged, err = saveWatches(tx, b, cur, *p.Watches, hasKey, now); err != nil {
				return err
			}
		}
		interval := b.IntervalSeconds
		if p.IntervalMinutes != nil {
			if interval, err = cleanInterval(*p.IntervalMinutes, ws); err != nil {
				return err
			}
		} else if floor := int(Floor(ws) / time.Second); interval < floor {
			interval = floor
		}
		if interval != b.IntervalSeconds {
			set["interval_seconds"] = interval
		}
		if b.Status == StatusActive && b.NextCheckAt != nil {
			next := *b.NextCheckAt
			if soon := now.Add(time.Duration(interval) * time.Second); interval != b.IntervalSeconds && soon.Before(next) {
				next = soon
			}
			// A watch with a longer floor may have been added.
			if next = maxTime(next, spacedAt(b.CheckStartedAt, Floor(ws))); !next.Equal(*b.NextCheckAt) {
				set["next_check_at"] = next
			}
		}
		// A suggestion is about the rules, interval and judging it saw.
		if b.Suggestion != nil && (watchesChanged || interval != b.IntervalSeconds || (p.JudgeMode != nil && set["judge_mode"] != b.JudgeMode)) {
			set["suggestion"] = gorm.Expr("NULL")
		}
		if o == OriginMCP && watchesChanged && b.Status == StatusActive {
			set["status"], set["pause_reason"], set["next_check_at"], set["health_detail"] = StatusPaused, PauseMCP, nil, mcpPausedNow
		}
		if err := tx.Model(&Bot{}).Where("id = ? AND user_id = ?", b.ID, userID).Updates(set).Error; err != nil {
			return nameConflict(err, name)
		}
		if p.PassesTo != nil {
			return saveLinks(tx, userID, b, *p.PassesTo, now)
		}
		return nil
	})
	if err != nil {
		return View{}, err
	}
	return s.view(ctx, userID, botID, now)
}

// saveWatches applies a full watch list: kept watches are updated, new ones
// inserted and missing ones deleted. changed reports any change to what is
// read or how it is judged.
func saveWatches(tx *gorm.DB, b Bot, cur []Watch, in []WatchInput, hasKey hasKeyFunc, now time.Time) ([]Watch, bool, error) {
	prev := make(map[string]Watch, len(cur))
	for _, w := range cur {
		prev[w.ID] = w
	}
	next, err := cleanWatches(in, prev, hasKey)
	if err != nil {
		return nil, false, err
	}
	changed := false
	kept := map[string]bool{}
	for i, w := range next {
		if w.ID == "" {
			next[i] = newWatch(w, b, now)
			if err := tx.Create(&next[i]).Error; err != nil {
				return nil, false, err
			}
			changed = true
			continue
		}
		kept[w.ID] = true
		old := prev[w.ID]
		sameCfg, sameRl := sameConfig(old, w), sameRules(old.Rules, w.Rules)
		set := map[string]any{"position": w.Position}
		if sameCfg && sameRl {
			old.Position = w.Position
			next[i] = old
			if old.Position != prev[w.ID].Position {
				set["updated_at"] = now
			} else {
				continue
			}
		} else {
			changed = true
			old.Kind, old.URL, old.ReadMode, old.Selector = w.Kind, w.URL, w.ReadMode, w.Selector
			old.Source, old.Symbol, old.Currency, old.Position = w.Source, w.Symbol, w.Currency, w.Position
			old.Rules = ruleIDs(w.Rules, old.Rules)
			if sameRl {
				old.Rules = prev[w.ID].Rules
			}
			old.RuleState = jsonMap[string, RuleState]{}
			old.BaselinePending, old.ConfigVersion = true, old.ConfigVersion+1
			old.ETag, old.LastModified, old.ValidatorsURL = "", "", ""
			old.UpdatedAt = now
			set = map[string]any{
				"kind": old.Kind, "url": old.URL, "read_mode": old.ReadMode, "selector": old.Selector,
				"source": old.Source, "symbol": old.Symbol, "currency": old.Currency, "position": old.Position,
				"rules": old.Rules, "rule_state": old.RuleState, "baseline_pending": true,
				"config_version": old.ConfigVersion, "etag": "", "last_modified": "", "validators_url": "", "updated_at": now,
			}
			if !sameCfg {
				// The old reading and price series belong to something else.
				old.LastReading, old.LastReadingAt, old.LastChangedAt, old.Health, old.HealthDetail = nil, nil, nil, HealthNew, ""
				set["last_reading"], set["last_reading_at"], set["last_changed_at"], set["health"], set["health_detail"] = nil, nil, nil, HealthNew, ""
				if err := tx.Where("watch_id = ?", old.ID).Delete(&PriceDay{}).Error; err != nil {
					return nil, false, err
				}
			}
			next[i] = old
		}
		if err := tx.Model(&Watch{}).Where("id = ? AND bot_id = ?", old.ID, b.ID).Updates(set).Error; err != nil {
			return nil, false, err
		}
	}
	var gone []string
	for _, w := range cur {
		if !kept[w.ID] {
			gone = append(gone, w.ID)
		}
	}
	if len(gone) > 0 {
		changed = true
		if err := tx.Where("id IN ? AND bot_id = ?", gone, b.ID).Delete(&Watch{}).Error; err != nil {
			return nil, false, err
		}
	}
	return next, changed, nil
}

// Pause stops a Bot until the person resumes it. reason is PausePerson or
// PauseMCP. Pausing a paused Bot changes nothing.
func (s *Store) Pause(ctx context.Context, userID, idOrName string, reason string, now time.Time) (View, error) {
	now = now.UTC()
	if reason != PausePerson && reason != PauseMCP {
		return View{}, fmt.Errorf("bots: pause reason %q", reason)
	}
	var botID string
	err := s.conn(ctx).Transaction(func(tx *gorm.DB) error {
		b, err := findBot(tx, userID, idOrName, true)
		if err != nil {
			return err
		}
		botID = b.ID
		if b.Status == StatusPaused {
			return nil
		}
		return tx.Model(&Bot{}).Where("id = ?", b.ID).Updates(map[string]any{
			"status": StatusPaused, "pause_reason": reason, "next_check_at": nil, "updated_at": now,
		}).Error
	})
	if err != nil {
		return View{}, err
	}
	return s.view(ctx, userID, botID, now)
}

// Resume turns a paused Bot on, due as soon as its floor allows, with
// strikes cleared. Every watch
// records a quiet baseline first, so nothing that changed while it was
// paused alerts. Only the app can resume a Bot.
func (s *Store) Resume(ctx context.Context, userID, id string, o Origin, now time.Time) (View, error) {
	now = now.UTC()
	if o == OriginMCP {
		return View{}, invalid("Turn bots on in Timely")
	}
	var botID string
	err := s.conn(ctx).Transaction(func(tx *gorm.DB) error {
		b, err := findBot(tx, userID, id, true)
		if err != nil {
			return err
		}
		botID = b.ID
		if b.Status == StatusActive {
			return nil
		}
		ws, err := loadWatches(tx, b.ID, false)
		if err != nil {
			return err
		}
		// Due now, unless its last check was too recent for the floor.
		next := maxTime(now, spacedAt(b.CheckStartedAt, Floor(ws)))
		if err := tx.Model(&Bot{}).Where("id = ?", b.ID).Updates(map[string]any{
			"status": StatusActive, "pause_reason": nil, "strikes": 0, "health": HealthNew, "health_detail": "",
			"offline_since": nil, "checking_job_id": nil, "next_check_at": next, "updated_at": now,
		}).Error; err != nil {
			return err
		}
		return tx.Model(&Watch{}).Where("bot_id = ?", b.ID).Updates(map[string]any{"baseline_pending": true, "updated_at": now}).Error
	})
	if err != nil {
		return View{}, err
	}
	return s.view(ctx, userID, botID, now)
}

// Snooze holds a Bot's alerts until until; nil ends a snooze. Checks, rule
// state and findings carry on, so nothing bursts when it ends.
func (s *Store) Snooze(ctx context.Context, userID, id string, until *time.Time, now time.Time) (View, error) {
	now = now.UTC()
	if until != nil {
		u := until.UTC()
		switch {
		case !u.After(now):
			return View{}, invalid("Pick a time in the future")
		case u.After(now.Add(maxSnooze)):
			return View{}, invalid("Snooze a bot for at most %d days, or pause it", int(maxSnooze/(24*time.Hour)))
		}
		until = &u
	}
	b, err := findBot(s.conn(ctx), userID, id, false)
	if err != nil {
		return View{}, err
	}
	res := s.conn(ctx).Model(&Bot{}).Where("id = ? AND user_id = ?", b.ID, userID).
		Updates(map[string]any{"snoozed_until": until, "updated_at": now})
	if res.Error != nil {
		return View{}, res.Error
	}
	if res.RowsAffected == 0 {
		return View{}, ErrNotFound
	}
	return s.view(ctx, userID, b.ID, now)
}

// Delete removes a Bot; every child table cascades.
func (s *Store) Delete(ctx context.Context, userID, id string) error {
	b, err := findBot(s.conn(ctx), userID, id, false)
	if err != nil {
		return err
	}
	res := s.conn(ctx).Where("id = ? AND user_id = ?", b.ID, userID).Delete(&Bot{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// BotList is the board: every Bot, oldest first, and the header's numbers.
type BotList struct {
	Bots    []View      `json:"bots"`
	Summary ListSummary `json:"summary"`
}

// ListSummary is the board header: checks, sent alerts, shared alerts and
// AI calls today in the person's notification zone, the account's AI cap,
// the next check of any active Bot, and whether AI can judge now.
type ListSummary struct {
	ChecksToday   int        `json:"checksToday"`
	AlertsToday   int        `json:"alertsToday"`
	NextCheckAt   *time.Time `json:"nextCheckAt"`
	AIChecksToday int        `json:"aiChecksToday"`
	AICap         int        `json:"aiCap"`
	SharedToday   int        `json:"sharedToday"` // alerts held today because another Bot's already told of the same thing
	AI            AIStatus   `json:"ai"`          // filled by the handler: the Store has no judge
}

// List returns the account's Bots, oldest first, with the board's numbers.
// It writes nothing.
func (s *Store) List(ctx context.Context, userID string, now time.Time) (BotList, error) {
	db := s.conn(ctx)
	out := BotList{Bots: []View{}}
	var bots []Bot
	if err := db.Where("user_id = ?", userID).Order("created_at, id").Find(&bots).Error; err != nil {
		return BotList{}, err
	}
	loc, err := localZone(db, userID)
	if err != nil {
		return BotList{}, err
	}
	local := now.In(loc)
	var checks int64
	if err := db.Model(&Check{}).Where("user_id = ? AND started_at >= ? AND outcome <> ?", userID,
		time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc).UTC(), outSuperseded).Count(&checks).Error; err != nil {
		return BotList{}, err
	}
	out.Summary.ChecksToday = int(checks)
	var shared int64
	if err := db.Model(&Alert{}).Where("user_id = ? AND local_day = ? AND kind = ? AND held = ?", userID, local.Format(dayLayout), alertKindAlert, heldShared).
		Count(&shared).Error; err != nil {
		return BotList{}, err
	}
	out.Summary.SharedToday = int(shared)
	out.Summary.AICap = AIPerAccount
	if out.Summary.AIChecksToday, _, err = aiCallsToday(db, userID, local.Format(dayLayout)); err != nil {
		return BotList{}, err
	}
	if len(bots) == 0 {
		return out, nil
	}
	var ws []Watch
	if err := db.Where("user_id = ?", userID).Order("bot_id, position, created_at").Find(&ws).Error; err != nil {
		return BotList{}, err
	}
	byBot := map[string][]Watch{}
	for _, w := range ws {
		byBot[w.BotID] = append(byBot[w.BotID], w)
	}
	bd, err := loadBoard(db, userID, "", now)
	if err != nil {
		return BotList{}, err
	}
	for _, b := range bots {
		v := viewOf(b, byBot[b.ID], bd, now)
		out.Bots = append(out.Bots, v)
		out.Summary.AlertsToday += v.AlertsToday
		if b.Status == StatusActive && b.NextCheckAt != nil && (out.Summary.NextCheckAt == nil || b.NextCheckAt.Before(*out.Summary.NextCheckAt)) {
			next := b.NextCheckAt.UTC()
			out.Summary.NextCheckAt = &next
		}
	}
	return out, nil
}

// Get returns one Bot with its last checks and alerts, its last 30 days of
// prices, its lessons, the newest items of its feeds and its counts for the
// week and the month.
func (s *Store) Get(ctx context.Context, userID, idOrName string, now time.Time) (Detail, error) {
	db := s.conn(ctx)
	b, err := findBot(db, userID, idOrName, false)
	if err != nil {
		return Detail{}, err
	}
	v, ws, err := s.load(ctx, userID, b.ID, now)
	if err != nil {
		return Detail{}, err
	}
	for i, w := range ws {
		if w.Kind == WatchFeed && w.LastReading != nil {
			v.Watches[i].Items = newestItems(w.LastReading.Items, detailItems)
		}
	}
	d := Detail{View: v, Checks: []CheckView{}, Alerts: []AlertView{}, Prices: []PriceDayView{}, Lessons: []Lesson{}, Rearms: []RearmView{}}
	if d.Links, err = botLinks(db, userID, b.ID, now); err != nil {
		return Detail{}, err
	}
	var checks []Check
	if err := db.Where("bot_id = ? AND user_id = ?", b.ID, userID).Order("started_at DESC, id").Limit(detailRows).Find(&checks).Error; err != nil {
		return Detail{}, err
	}
	for _, c := range checks {
		fired := []FiredRule(c.Fired)
		if fired == nil {
			fired = []FiredRule{}
		}
		d.Checks = append(d.Checks, CheckView{ID: c.ID, Trigger: c.Trigger, StartedAt: c.StartedAt, Outcome: c.Outcome, ErrorKind: c.ErrorKind, Error: c.Error, Fired: fired})
	}
	var alerts []Alert
	if err := db.Where("bot_id = ? AND user_id = ?", b.ID, userID).Order("created_at DESC, id").Limit(detailRows).Find(&alerts).Error; err != nil {
		return Detail{}, err
	}
	anchors := []string{}
	for _, a := range alerts {
		if a.SharedWith != nil {
			anchors = append(anchors, *a.SharedWith)
		}
	}
	refs, err := sharedRefs(db, userID, anchors)
	if err != nil {
		return Detail{}, err
	}
	for _, a := range alerts {
		av := alertView(a)
		if a.SharedWith != nil {
			av.SharedWith = refs[*a.SharedWith]
		}
		d.Alerts = append(d.Alerts, av)
	}
	var days []PriceDay
	since := now.UTC().AddDate(0, 0, -detailDays).Format(dayLayout)
	if err := db.Where("bot_id = ? AND user_id = ? AND day >= ?", b.ID, userID, since).Order("watch_id, day").Find(&days).Error; err != nil {
		return Detail{}, err
	}
	for _, p := range days {
		points := [][2]float64(p.Points)
		if points == nil {
			points = [][2]float64{}
		}
		d.Prices = append(d.Prices, PriceDayView{WatchID: p.WatchID, Day: p.Day.Format(dayLayout), Currency: p.Currency, Points: points, Open: p.Open, High: p.High, Low: p.Low, Close: p.Close})
	}
	if err := db.Where("bot_id = ? AND user_id = ?", b.ID, userID).Order("created_at, id").Find(&d.Lessons).Error; err != nil {
		return Detail{}, err
	}
	var counts struct{ Checks, Alerts, AlertsMonth int }
	if err := db.Raw(`
SELECT (SELECT count(*) FROM bot_checks WHERE bot_id = @bot AND user_id = @uid AND started_at >= @week AND outcome <> 'superseded') AS checks,
       (SELECT count(*) FROM bot_alerts WHERE bot_id = @bot AND user_id = @uid AND kind = 'alert' AND held <> 'judged' AND created_at >= @week) AS alerts,
       (SELECT count(*) FROM bot_alerts WHERE bot_id = @bot AND user_id = @uid AND kind = 'alert' AND held <> 'judged' AND created_at >= @month) AS alerts_month`,
		sql.Named("bot", b.ID), sql.Named("uid", userID),
		sql.Named("week", now.UTC().AddDate(0, 0, -7)), sql.Named("month", now.UTC().AddDate(0, 0, -detailDays)),
	).Scan(&counts).Error; err != nil {
		return Detail{}, err
	}
	d.Week, d.AlertsMonth = WeekCounts{Checks: counts.Checks, Alerts: counts.Alerts}, counts.AlertsMonth
	var rearmChecks []Check
	if err := db.Select("id", "started_at", "rearmed").
		Where("bot_id = ? AND user_id = ? AND started_at >= ? AND rearmed <> '[]'::jsonb", b.ID, userID, now.UTC().AddDate(0, 0, -detailDays)).
		Order("started_at DESC, id DESC").Limit(maxRearms).Find(&rearmChecks).Error; err != nil {
		return Detail{}, err
	}
	d.Rearms = rearmsOf(rearmChecks)
	return d, nil
}

// BotName is a Bot's id and name, which is all chat needs to find the Bots
// a message tags.
type BotName struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Names lists the account's Bots by id and name, oldest first, without the
// board's numbers that List works out.
func (s *Store) Names(ctx context.Context, userID string) ([]BotName, error) {
	out := []BotName{}
	err := s.conn(ctx).Model(&Bot{}).Select("id", "name").Where("user_id = ?", userID).Order("created_at, id").Scan(&out).Error
	return out, err
}

// Findings returns the findings board, newest first: at most 100, 50 when
// no limit is given.
func (s *Store) Findings(ctx context.Context, userID string, q FindingQuery) ([]Finding, error) {
	db := s.conn(ctx)
	limit := q.Limit
	if limit <= 0 {
		limit = findingsPage
	}
	limit = min(limit, findingsMax)
	tx := db.Where("user_id = ?", userID)
	if strings.TrimSpace(q.BotID) != "" {
		b, err := findBot(db, userID, q.BotID, false)
		if err != nil {
			return nil, err
		}
		tx = tx.Where("bot_id = ?", b.ID)
	}
	if !q.Since.IsZero() {
		tx = tx.Where("created_at >= ?", q.Since.UTC())
	}
	out := []Finding{}
	err := tx.Order("created_at DESC, id").Limit(limit).Find(&out).Error
	return out, err
}

// Ratings an alert can get, and why it was not useful.
const (
	FeedbackUseful    = "useful"
	FeedbackNotUseful = "not_useful"
)

// FeedbackReasons are the chips under Not useful: the change was too small,
// it is not what the person wants, they already knew.
var FeedbackReasons = []string{"too_small", "not_wanted", "already_knew"}

// Rating is Useful or Not useful on an alert. A nil Feedback takes the
// rating back. Reason and Note are kept only with not_useful.
type Rating struct {
	Feedback *string
	Reason   string
	Note     string
}

// RateResult answers a rating: the alert, and the lesson it taught the Bot
// (nil when the rating was taken back).
type RateResult struct {
	AlertView
	Lesson *Lesson `json:"lesson"`
}

// RateAlert records the person's rating of one of a Bot's alerts. Only an
// alert (not a "more" or "paused" notice) can be rated; rating again
// replaces the last one. In the same transaction the rating becomes the
// alert's one lesson (replaced on a re-rate, deleted on undo), only the
// newest MaxLessons of the Bot are kept, and a Not useful that makes three
// in a row lets a rules-only Bot suggest a better rule. aiReady says the
// person has an AI provider, so that suggestion may be AI judging.
func (s *Store) RateAlert(ctx context.Context, userID, botIDOrName, alertID string, r Rating, now time.Time, aiReady bool) (RateResult, error) {
	set := map[string]any{"feedback": nil, "feedback_reason": "", "feedback_note": "", "feedback_at": nil}
	if r.Reason != "" && r.Reason != PassFeedbackReason && !contains(FeedbackReasons, r.Reason) {
		return RateResult{}, invalid("Pick one of the reasons")
	}
	if r.Feedback != nil {
		switch *r.Feedback {
		case FeedbackUseful:
		case FeedbackNotUseful:
			set["feedback_reason"], set["feedback_note"] = r.Reason, cleanLine(r.Note, MaxFeedbackNote)
		default:
			return RateResult{}, invalid(`Rate an alert "useful" or "not_useful"`)
		}
		set["feedback"], set["feedback_at"] = *r.Feedback, now.UTC()
	}
	var out RateResult
	err := s.conn(ctx).Transaction(func(tx *gorm.DB) error {
		// The Bot first, as a check's save locks it, then the alert.
		b, err := findBot(tx, userID, botIDOrName, true)
		if err != nil {
			return err
		}
		var rows []Alert
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND bot_id = ? AND user_id = ?", alertID, b.ID, userID).
			Limit(1).Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) == 0 {
			return ErrAlertNotFound
		}
		if rows[0].Kind != alertKindAlert {
			return invalid("Only alerts can be rated")
		}
		if r.Feedback != nil && *r.Feedback == FeedbackNotUseful && r.Reason == PassFeedbackReason && len(rows[0].Via) == 0 {
			return invalid("This alert was not passed on")
		}
		if err := tx.Model(&Alert{}).Where("id = ? AND bot_id = ? AND user_id = ?", alertID, b.ID, userID).Updates(set).Error; err != nil {
			return err
		}
		var a Alert
		if err := tx.Where("id = ? AND bot_id = ? AND user_id = ?", alertID, b.ID, userID).First(&a).Error; err != nil {
			return err
		}
		out.AlertView = alertView(a)
		if a.SharedWith != nil {
			refs, err := sharedRefs(tx, userID, []string{*a.SharedWith})
			if err != nil {
				return err
			}
			out.SharedWith = refs[*a.SharedWith]
		}
		if err := tx.Where("alert_id = ? AND bot_id = ?", alertID, b.ID).Delete(&Lesson{}).Error; err != nil {
			return err
		}
		if r.Feedback == nil {
			return nil
		}
		l := Lesson{ID: utils.PrefixedUUID("bls"), BotID: b.ID, UserID: userID, AlertID: &a.ID, Text: lessonText(a, b.Name), CreatedAt: now.UTC()}
		if err := tx.Create(&l).Error; err != nil {
			return err
		}
		out.Lesson = &l
		if err := tx.Exec(`DELETE FROM bot_lessons WHERE bot_id = ? AND id NOT IN (
    SELECT id FROM bot_lessons WHERE bot_id = ? ORDER BY created_at DESC, id DESC LIMIT ?)`, b.ID, b.ID, MaxLessons).Error; err != nil {
			return err
		}
		if *r.Feedback != FeedbackNotUseful {
			return nil
		}
		return suggest(tx, b, aiReady, now)
	})
	if err != nil {
		return RateResult{}, err
	}
	return out, nil
}

// quietSuffix is the " (at HH:MM)" withHeldTime adds to a title.
var quietSuffix = regexp.MustCompile(` \(at \d{2}:\d{2}\)$`)

// lessonText writes the lesson a rated alert teaches its Bot, as the person's
// words: what the rating was and what the alert told of, then their note. It
// never uses words a model wrote: what is the alert's rules-made
// figures.what, or for an alert without it the title without the "<bot>: "
// prefix and the quiet-hours time (rules wrote those titles), else "this
// alert". The whole line fits bot_lessons' 200 characters.
func lessonText(a Alert, botName string) string {
	what, _ := a.Figures["what"].(string)
	what = strings.TrimSpace(what)
	if what == "" {
		what = quietSuffix.ReplaceAllString(strings.TrimPrefix(a.Title, botName+": "), "")
		what = strings.TrimSpace(what)
	}
	if what == "" {
		what = "this alert"
	}
	quoted := "“" + what + "”"
	var line string
	switch {
	case a.Feedback != nil && *a.Feedback == FeedbackUseful && a.Held == heldJudged:
		line = "Should have told me: " + quoted
	case a.Feedback != nil && *a.Feedback == FeedbackUseful:
		line = "Wanted: " + quoted
	case a.FeedbackReason == "too_small":
		line = "Too small to tell me: " + quoted
	case a.FeedbackReason == "not_wanted":
		line = "Not what I want: " + quoted
	case a.FeedbackReason == "already_knew":
		line = "I already knew: " + quoted
	case a.FeedbackReason == PassFeedbackReason && len(a.Via) > 0:
		line = "Not worth passing on from " + a.Via[len(a.Via)-1].Name + ": " + quoted
	default:
		line = "Not useful: " + quoted
	}
	if note := strings.TrimSpace(a.FeedbackNote); note != "" {
		line += ". " + note
	}
	return clipRunes(line, MaxLessonLen)
}

// ForgetLesson removes one thing the person taught a Bot.
func (s *Store) ForgetLesson(ctx context.Context, userID, botIDOrName, lessonID string) error {
	db := s.conn(ctx)
	b, err := findBot(db, userID, botIDOrName, false)
	if err != nil {
		return err
	}
	res := db.Where("id = ? AND bot_id = ? AND user_id = ?", lessonID, b.ID, userID).Delete(&Lesson{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrLessonNotFound
	}
	return nil
}

// AlertDefaults is where the person's new Bots alert ("Alerts for new
// bots"): desktop and phone on, urgent off until they change it.
func (s *Store) AlertDefaults(ctx context.Context, userID string) (models.BotAlertDefaults, error) {
	return alertDefaults(s.conn(ctx), userID)
}

// SetAlertDefaults saves where the person's new Bots alert. Bots they
// already have keep their own switches.
func (s *Store) SetAlertDefaults(ctx context.Context, userID string, d models.BotAlertDefaults) (models.BotAlertDefaults, error) {
	res := s.conn(ctx).Model(&models.Config{}).Where("user_id = ?", userID).
		Updates(map[string]any{"bot_alert_defaults": d, "updated_at": utils.GetCurrentTime()})
	if res.Error != nil {
		return models.BotAlertDefaults{}, res.Error
	}
	if res.RowsAffected == 0 {
		return models.BotAlertDefaults{}, errors.New("bots: the account has no settings row")
	}
	return d, nil
}

func alertDefaults(db *gorm.DB, userID string) (models.BotAlertDefaults, error) {
	var config models.Config
	err := db.Select("bot_alert_defaults").Where("user_id = ?", userID).First(&config).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return models.DefaultBotAlertDefaults(), nil
	case err != nil:
		return models.BotAlertDefaults{}, err
	}
	return config.BotAlertDefaults, nil
}

// view loads one Bot as a View.
func (s *Store) view(ctx context.Context, userID, botID string, now time.Time) (View, error) {
	v, _, err := s.load(ctx, userID, botID, now)
	return v, err
}

// load loads one Bot as a View, with its watches.
func (s *Store) load(ctx context.Context, userID, botID string, now time.Time) (View, []Watch, error) {
	db := s.conn(ctx)
	b, err := findBot(db, userID, botID, false)
	if err != nil {
		return View{}, nil, err
	}
	ws, err := loadWatches(db, b.ID, false)
	if err != nil {
		return View{}, nil, err
	}
	bd, err := loadBoard(db, userID, b.ID, now)
	if err != nil {
		return View{}, nil, err
	}
	return viewOf(b, ws, bd, now), ws, nil
}

// findBot finds a Bot by id, or by name ignoring case.
func findBot(tx *gorm.DB, userID, idOrName string, lock bool) (Bot, error) {
	key := strings.Join(strings.Fields(idOrName), " ")
	if key == "" {
		return Bot{}, ErrNotFound
	}
	q := func() *gorm.DB {
		if lock {
			return tx.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		return tx
	}
	var rows []Bot
	if err := q().Where("user_id = ? AND id = ?", userID, key).Limit(1).Find(&rows).Error; err != nil {
		return Bot{}, err
	}
	if len(rows) == 0 {
		if err := q().Where("user_id = ? AND lower(name) = lower(?)", userID, key).Limit(1).Find(&rows).Error; err != nil {
			return Bot{}, err
		}
	}
	if len(rows) == 0 {
		return Bot{}, ErrNotFound
	}
	return rows[0], nil
}

func loadWatches(tx *gorm.DB, botID string, lock bool) ([]Watch, error) {
	if lock {
		tx = tx.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var ws []Watch
	err := tx.Where("bot_id = ?", botID).Order("position, created_at").Find(&ws).Error
	return ws, err
}

// loadBoard loads what the board shows for the account's Bots, or for one
// when botID is set: today's alerts, the strip of recent checks, the newest
// alert and the price closes of the last 31 days.
func loadBoard(db *gorm.DB, userID, botID string, now time.Time) (*board, error) {
	bd := &board{alertsToday: map[string]int{}, itemsToday: map[string]int{}, strips: map[string]string{},
		latest: map[string]*AlertBrief{}, aiCalls: map[string]int{}, days: map[string][]dayClose{}}
	var err error
	scope := func(q *gorm.DB, col string) *gorm.DB {
		if botID != "" {
			return q.Where(col+" = ?", botID)
		}
		return q
	}
	if bd.knowledge, err = knowledgeViews(db, userID, botID); err != nil {
		return nil, err
	}
	day, err := localDay(db, userID, now)
	if err != nil {
		return nil, err
	}
	// Held alerts do not count as sent, but the items they tell of are new.
	var today []struct {
		BotID string
		N     int
		Items int
	}
	q := db.Model(&Alert{}).Select(`bot_id, count(*) FILTER (WHERE held = '') AS n,
		COALESCE(sum(CASE WHEN jsonb_typeof(figures->'items') = 'number' THEN (figures->>'items')::numeric END), 0)::int AS items`).
		Where("user_id = ? AND local_day = ? AND kind = ?", userID, day, alertKindAlert)
	if err := scope(q, "bot_id").Group("bot_id").Scan(&today).Error; err != nil {
		return nil, err
	}
	for _, r := range today {
		bd.alertsToday[r.BotID], bd.itemsToday[r.BotID] = r.N, r.Items
	}
	if _, bd.aiCalls, err = aiCallsToday(db, userID, day); err != nil {
		return nil, err
	}

	var marks []struct{ BotID, Outcome string }
	q = db.Raw(`
SELECT b.id AS bot_id, c.outcome FROM bots b
CROSS JOIN LATERAL (
    SELECT outcome, started_at, id FROM bot_checks c
    WHERE c.bot_id = b.id AND c.outcome <> 'superseded'
    ORDER BY c.started_at DESC, c.id DESC LIMIT @n) c
WHERE b.user_id = @uid AND (@bot = '' OR b.id = @bot)
ORDER BY b.id, c.started_at DESC, c.id DESC`, sql.Named("n", stripChecks), sql.Named("uid", userID), sql.Named("bot", botID))
	if err := q.Scan(&marks).Error; err != nil {
		return nil, err
	}
	outcomes := map[string][]string{}
	for _, m := range marks {
		outcomes[m.BotID] = append(outcomes[m.BotID], m.Outcome)
	}
	for id, list := range outcomes {
		bd.strips[id] = stripOf(list)
	}

	// The newest alert the person was told of, or that a cap held; an alert
	// the judge held back is not one, nor is one held 'shared', so the
	// board never carries SharedWith (the Bot's page lists both).
	var latest []struct {
		ID, BotID, BotName, Title, Body, URL, Held, Kind, AIState, AIWhy, Urgency string
		What, Feedback                                                            *string
		AlsoSeenBy                                                                jsonList[BotRef]
		Via                                                                       jsonList[ViaStep]
		CreatedAt                                                                 time.Time
	}
	q = db.Raw(`
SELECT DISTINCT ON (a.bot_id) a.id, a.bot_id, a.title, a.body, a.url, a.held, a.kind, a.ai_state, a.ai_why, a.urgency,
       a.figures->>'what' AS what, a.feedback, a.also_seen_by, a.via, a.created_at, b.name AS bot_name
FROM bot_alerts a JOIN bots b ON b.id = a.bot_id
WHERE a.user_id = @uid AND a.kind IN ('alert', 'brief') AND a.held IN ('', @cap) AND a.created_at >= @since AND (@bot = '' OR a.bot_id = @bot)
ORDER BY a.bot_id, a.created_at DESC, a.id DESC`, sql.Named("uid", userID), sql.Named("cap", heldCap),
		sql.Named("since", now.UTC().AddDate(0, 0, -detailDays)), sql.Named("bot", botID))
	if err := q.Scan(&latest).Error; err != nil {
		return nil, err
	}
	for _, a := range latest {
		brief := &AlertBrief{ID: a.ID, Title: a.Title, Body: a.Body, URL: a.URL, Held: a.Held, CreatedAt: a.CreatedAt, Feedback: a.Feedback,
			Kind: a.Kind, AIState: a.AIState, AIWhy: a.AIWhy, Urgency: urgencyOr(a.Urgency), AlsoSeenBy: botRefs(a.AlsoSeenBy), Via: viaSteps(a.Via), RulesTitle: a.Title}
		if a.What != nil && strings.TrimSpace(*a.What) != "" {
			brief.RulesTitle = a.BotName + ": " + *a.What
		}
		bd.latest[a.BotID] = brief
	}

	var days []struct {
		WatchID     string
		Day         time.Time
		Open, Close *float64
	}
	q = db.Model(&PriceDay{}).Select("watch_id, day, open, close").
		Where("user_id = ? AND day >= ?", userID, now.UTC().AddDate(0, 0, -(sparkDays+1)).Format(dayLayout))
	if err := scope(q, "bot_id").Order("watch_id, day").Scan(&days).Error; err != nil {
		return nil, err
	}
	for _, d := range days {
		bd.days[d.WatchID] = append(bd.days[d.WatchID], dayClose{WatchID: d.WatchID, Day: d.Day.UTC().Format(dayLayout), Open: d.Open, Close: d.Close})
	}
	return bd, nil
}

// sharedRefs names the alerts held 'shared' alerts joined, by alert id,
// with their Bots. An alert that is gone, or not the person's, is left out.
func sharedRefs(db *gorm.DB, userID string, ids []string) (map[string]*SharedRef, error) {
	out := map[string]*SharedRef{}
	if len(ids) == 0 {
		return out, nil
	}
	var rows []SharedRef
	if err := db.Raw(`SELECT a.id AS alert_id, a.bot_id, b.name FROM bot_alerts a JOIN bots b ON b.id = a.bot_id
WHERE a.user_id = ? AND b.user_id = a.user_id AND a.id IN ?`, userID, ids).Scan(&rows).Error; err != nil {
		return nil, err
	}
	for i := range rows {
		out[rows[i].AlertID] = &rows[i]
	}
	return out, nil
}

// localDay is today's date in the zone quiet hours and digests use.
func localDay(db *gorm.DB, userID string, now time.Time) (string, error) {
	loc, err := localZone(db, userID)
	if err != nil {
		return "", err
	}
	return now.In(loc).Format(dayLayout), nil
}

// localZone is the zone quiet hours and digests use.
func localZone(db *gorm.DB, userID string) (*time.Location, error) {
	var config models.Config
	if err := db.Select("notification_settings", "working_hours").Where("user_id = ?", userID).First(&config).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	return config.NotificationSettings.Normalized().Location(config.WorkingHours.Timezone), nil
}

func nameTaken(rows []Bot, selfID, name string) error {
	for _, r := range rows {
		if r.ID != selfID && strings.EqualFold(r.Name, name) {
			return invalid("You already have a bot called %q", r.Name)
		}
	}
	return nil
}

// nameConflict turns the unique name index's refusal (lower() can fold a
// name EqualFold kept apart) into the same sentence.
func nameConflict(err error, name string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "bots_user_name_idx" {
		return invalid("You already have a bot called %q", name)
	}
	return err
}

func deref(p *bool, def bool) bool {
	if p == nil {
		return def
	}
	return *p
}
