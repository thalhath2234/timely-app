package bots

import (
	"context"
	"errors"
	"fmt"
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
	ws, err := cleanWatches(in.Watches, nil)
	if err != nil {
		return View{}, err
	}
	interval, err := cleanInterval(in.IntervalMinutes, ws)
	if err != nil {
		return View{}, err
	}
	b := Bot{
		ID: utils.PrefixedUUID("bot"), UserID: userID, Name: name, Description: desc, Origin: o,
		Status: StatusActive, JudgeMode: judge, IntervalSeconds: interval,
		Urgent: deref(in.Urgent, false), NotifyDesktop: deref(in.Desktop, true), NotifyPhone: deref(in.Phone, true),
		NextCheckAt: &now, Health: HealthNew, CreatedAt: now, UpdatedAt: now,
	}
	if o == OriginMCP {
		reason := PauseMCP
		b.Status, b.PauseReason, b.NextCheckAt, b.HealthDetail = StatusPaused, &reason, nil, mcpPausedNew
	}
	for i := range ws {
		ws[i] = newWatch(ws[i], b, now)
	}
	err = s.conn(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockAccount(tx, userID); err != nil {
			return err
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
		return tx.Create(&ws).Error
	})
	if err != nil {
		return View{}, err
	}
	return viewOf(b, ws, 0), nil
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
// check. Over MCP, such a change also pauses an active Bot.
func (s *Store) Update(ctx context.Context, userID, idOrName string, p Patch, o Origin, now time.Time) (View, error) {
	now = now.UTC()
	if err := refuseMCPSettings(o, p.JudgeMode, p.Urgent, p.Desktop, p.Phone); err != nil {
		return View{}, err
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
			if ws, watchesChanged, err = saveWatches(tx, b, cur, *p.Watches, now); err != nil {
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
			if b.Status == StatusActive && b.NextCheckAt != nil {
				if soon := now.Add(time.Duration(interval) * time.Second); soon.Before(*b.NextCheckAt) {
					set["next_check_at"] = soon
				}
			}
		}
		if o == OriginMCP && watchesChanged && b.Status == StatusActive {
			set["status"], set["pause_reason"], set["next_check_at"], set["health_detail"] = StatusPaused, PauseMCP, nil, mcpPausedNow
		}
		if err := tx.Model(&Bot{}).Where("id = ? AND user_id = ?", b.ID, userID).Updates(set).Error; err != nil {
			return nameConflict(err, name)
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
func saveWatches(tx *gorm.DB, b Bot, cur []Watch, in []WatchInput, now time.Time) ([]Watch, bool, error) {
	prev := make(map[string]Watch, len(cur))
	for _, w := range cur {
		prev[w.ID] = w
	}
	next, err := cleanWatches(in, prev)
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
				old.LastReading, old.LastReadingAt, old.Health, old.HealthDetail = nil, nil, HealthNew, ""
				set["last_reading"], set["last_reading_at"], set["health"], set["health_detail"] = nil, nil, HealthNew, ""
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

// Resume turns a paused Bot on, due now, with strikes cleared. Every watch
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
		if err := tx.Model(&Bot{}).Where("id = ?", b.ID).Updates(map[string]any{
			"status": StatusActive, "pause_reason": nil, "strikes": 0, "health": HealthNew, "health_detail": "",
			"offline_since": nil, "checking_job_id": nil, "next_check_at": now, "updated_at": now,
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

// List returns the account's Bots, oldest first. It writes nothing.
func (s *Store) List(ctx context.Context, userID string, now time.Time) ([]View, error) {
	db := s.conn(ctx)
	var bots []Bot
	if err := db.Where("user_id = ?", userID).Order("created_at, id").Find(&bots).Error; err != nil {
		return nil, err
	}
	out := make([]View, 0, len(bots))
	if len(bots) == 0 {
		return out, nil
	}
	var ws []Watch
	if err := db.Where("user_id = ?", userID).Order("bot_id, position").Find(&ws).Error; err != nil {
		return nil, err
	}
	byBot := map[string][]Watch{}
	for _, w := range ws {
		byBot[w.BotID] = append(byBot[w.BotID], w)
	}
	counts, err := alertsToday(db, userID, "", now)
	if err != nil {
		return nil, err
	}
	for _, b := range bots {
		out = append(out, viewOf(b, byBot[b.ID], counts[b.ID]))
	}
	return out, nil
}

// Get returns one Bot with its last checks and alerts, its last 30 days of
// prices and its lessons.
func (s *Store) Get(ctx context.Context, userID, idOrName string, now time.Time) (Detail, error) {
	db := s.conn(ctx)
	b, err := findBot(db, userID, idOrName, false)
	if err != nil {
		return Detail{}, err
	}
	v, err := s.view(ctx, userID, b.ID, now)
	if err != nil {
		return Detail{}, err
	}
	d := Detail{View: v, Checks: []CheckView{}, Alerts: []AlertView{}, Prices: []PriceDayView{}, Lessons: []Lesson{}}
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
	for _, a := range alerts {
		d.Alerts = append(d.Alerts, AlertView{ID: a.ID, Kind: a.Kind, Held: a.Held, Title: a.Title, Body: a.Body, URL: a.URL, Urgent: a.Urgent, MoreCount: a.MoreCount, CreatedAt: a.CreatedAt})
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
	return d, nil
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

// view loads one Bot as a View.
func (s *Store) view(ctx context.Context, userID, botID string, now time.Time) (View, error) {
	db := s.conn(ctx)
	b, err := findBot(db, userID, botID, false)
	if err != nil {
		return View{}, err
	}
	ws, err := loadWatches(db, b.ID, false)
	if err != nil {
		return View{}, err
	}
	counts, err := alertsToday(db, userID, b.ID, now)
	if err != nil {
		return View{}, err
	}
	return viewOf(b, ws, counts[b.ID]), nil
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

// alertsToday counts the alerts each Bot sent today in the person's
// notification zone (held alerts do not count). botID "" counts every Bot.
func alertsToday(db *gorm.DB, userID, botID string, now time.Time) (map[string]int, error) {
	day, err := localDay(db, userID, now)
	if err != nil {
		return nil, err
	}
	q := db.Model(&Alert{}).Select("bot_id, count(*) AS n").
		Where("user_id = ? AND local_day = ? AND kind = 'alert' AND held = ''", userID, day)
	if botID != "" {
		q = q.Where("bot_id = ?", botID)
	}
	var rows []struct {
		BotID string
		N     int
	}
	if err := q.Group("bot_id").Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[string]int, len(rows))
	for _, r := range rows {
		out[r.BotID] = r.N
	}
	return out, nil
}

// localDay is today's date in the zone quiet hours and digests use.
func localDay(db *gorm.DB, userID string, now time.Time) (string, error) {
	var config models.Config
	if err := db.Select("notification_settings", "working_hours").Where("user_id = ?", userID).First(&config).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", err
	}
	loc := config.NotificationSettings.Normalized().Location(config.WorkingHours.Timezone)
	return now.In(loc).Format(dayLayout), nil
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
