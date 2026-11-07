package bots

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"timely-api/internal/features/notify"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

// Alert kinds and why one was held, as stored in bot_alerts.
const (
	alertKindAlert  = "alert"
	alertKindMore   = "more"
	alertKindPaused = "paused"
	heldSnoozed     = "snoozed"
	heldCap         = "cap"
	awayKind        = "away"

	maxFindingTitle = 120
	maxFindingWhy   = 400
	maxChangedLine  = 140
)

// alert raises the one alert a firing check gets, inside its transaction:
// held while the Bot is snoozed, sent while it has sent fewer than
// AlertsPerDay today, else folded into one "and N more today" alert that is
// rewritten without a new push. sent reports a notification of its own.
func (s *Service) alert(tx *gorm.DB, b Bot, checkID, alertID string, fired []firedEvent, now time.Time) (sent bool, err error) {
	settings, loc, err := notify.LoadAlertSettings(tx, b.UserID)
	if err != nil {
		return false, err
	}
	local := now.In(loc)
	day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	opts := notify.AlertOptions{Urgent: b.Urgent, Phone: b.NotifyPhone, Now: now}
	what, body, figures := alertText(fired)
	title := b.Name + ": " + what
	if _, held := notify.QuietUntil(settings, loc, opts); held {
		title = withHeldTime(title, now, loc)
	}
	url := fired[0].w.URL
	row := Alert{
		ID: alertID, BotID: b.ID, UserID: b.UserID, CheckID: &checkID, Kind: alertKindAlert, LocalDay: day,
		Title: title, Body: body, URL: url, Figures: figures, Urgent: b.Urgent, CreatedAt: now,
	}
	if b.SnoozedUntil != nil && b.SnoozedUntil.After(now) {
		row.Held = heldSnoozed
		return false, tx.Create(&row).Error
	}
	var today int64
	if err := tx.Model(&Alert{}).Where("bot_id = ? AND local_day = ? AND kind = ? AND held = ''", b.ID, day.Format(dayLayout), alertKindAlert).
		Count(&today).Error; err != nil {
		return false, err
	}
	if today < AlertsPerDay {
		ntf := botNotification(b, title, body, "bot:"+b.ID+":"+checkID, alertData(b, alertID, checkID, url, alertKindAlert))
		if _, err := notify.WriteAlert(tx, &ntf, settings, loc, opts); err != nil {
			return false, err
		}
		row.NotificationID = &ntf.ID
		return true, tx.Create(&row).Error
	}
	row.Held = heldCap
	if err := tx.Create(&row).Error; err != nil {
		return false, err
	}
	return false, s.moreAlert(tx, b, row, settings, loc, opts)
}

// moreAlert counts a capped alert into the day's "and N more today" row and
// its one notification.
func (s *Service) moreAlert(tx *gorm.DB, b Bot, capped Alert, settings models.NotificationSettings, loc *time.Location, opts notify.AlertOptions) error {
	day := capped.LocalDay.Format(dayLayout)
	var more struct {
		ID             string
		MoreCount      int
		NotificationID *string
	}
	if err := tx.Raw(`
INSERT INTO bot_alerts (id, bot_id, user_id, kind, local_day, title, body, url, urgent, more_count, created_at)
VALUES (?, ?, ?, 'more', CAST(? AS date), ?, ?, ?, ?, 1, ?)
ON CONFLICT (bot_id, local_day) WHERE kind = 'more' DO UPDATE SET more_count = bot_alerts.more_count + 1
RETURNING id, more_count, notification_id`,
		utils.PrefixedUUID("bal"), b.ID, b.UserID, day, b.Name+": and 1 more today", capped.Title, capped.URL, b.Urgent, capped.CreatedAt,
	).Scan(&more).Error; err != nil {
		return err
	}
	title := fmt.Sprintf("%s: and %d more today", b.Name, more.MoreCount)
	body := capped.Title
	set := map[string]any{"title": title, "body": body, "url": capped.URL}
	write := func() error {
		ntf := botNotification(b, title, body, "bot:"+b.ID+":"+day+":more", alertData(b, more.ID, *capped.CheckID, capped.URL, alertKindMore))
		if _, err := notify.WriteAlert(tx, &ntf, settings, loc, opts); err != nil {
			return err
		}
		set["notification_id"] = ntf.ID
		return nil
	}
	switch {
	case more.NotificationID == nil:
		if err := write(); err != nil {
			return err
		}
	default:
		err := notify.BumpAlert(tx, *more.NotificationID, title, body)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// The person cleared it: a fresh one carries the count on.
			err = write()
		}
		if err != nil {
			return err
		}
	}
	return tx.Model(&Alert{}).Where("id = ?", more.ID).Updates(set).Error
}

// pausedAlert tells the person a Bot paused after MaxStrikes failed checks.
// It is not counted in the daily cap. A failing price source folds into one
// notification per account and day, however many Bots it pauses.
func (s *Service) pausedAlert(tx *gorm.DB, b Bot, checkID string, p *problem, now time.Time) error {
	settings, loc, err := notify.LoadAlertSettings(tx, b.UserID)
	if err != nil {
		return err
	}
	local := now.In(loc)
	day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	title := fmt.Sprintf("%s paused after %d failed checks", b.Name, MaxStrikes)
	body := strings.TrimRight(p.line, ". ") + ". Resume it in Timely."
	row := Alert{
		ID: utils.PrefixedUUID("bal"), BotID: b.ID, UserID: b.UserID, CheckID: &checkID, Kind: alertKindPaused, LocalDay: day,
		Title: title, Body: body, URL: p.watch.URL, Figures: jsonMap[string, any]{"health": p.code}, CreatedAt: now,
	}
	key := "bot:" + b.ID + ":paused:" + checkID
	if p.fold != "" {
		key = "bot:source:" + b.UserID + ":" + p.fold + ":" + day.Format(dayLayout)
	}
	ntf := botNotification(b, title, body, key, alertData(b, row.ID, checkID, p.watch.URL, alertKindPaused))
	if _, err := notify.WriteAlert(tx, &ntf, settings, loc, notify.AlertOptions{Phone: b.NotifyPhone, Now: now}); err != nil {
		return err
	}
	row.NotificationID = &ntf.ID
	return tx.Create(&row).Error
}

// awayAlert tells the person their Bots missed checks while Timely was
// closed or asleep, once per gap. A later sweep that still counts as a wake
// (a slow tick, another process starting) sees a later earliest missed check
// once the first Bots are checked, so the key alone is not enough: an away
// alert written since that check already covers this gap.
func awayAlert(tx *gorm.DB, userID string, earliest time.Time, bots int, now time.Time) error {
	if err := lockAccount(tx, userID); err != nil {
		return err
	}
	var sent int64
	if err := tx.Model(&models.Notification{}).
		Where("user_id = ? AND category = ? AND data->>'botAlert' = ? AND created_at >= ?", userID, models.NotifyBot, awayKind, earliest).
		Count(&sent).Error; err != nil || sent > 0 {
		return err
	}
	settings, loc, err := notify.LoadAlertSettings(tx, userID)
	if err != nil {
		return err
	}
	checking := fmt.Sprintf("%d bots are checking now.", bots)
	if bots == 1 {
		checking = "1 bot is checking now."
	}
	key := fmt.Sprintf("bot:away:%s:%d", userID, earliest.Unix())
	ntf := models.Notification{
		UserID: userID, Category: models.NotifyBot, Title: "Bots were paused for " + awayFor(now.Sub(earliest)),
		Body: "Timely was closed or asleep. " + checking, DedupeKey: &key, Data: models.JobPayload{"botAlert": awayKind},
	}
	_, err = notify.WriteAlert(tx, &ntf, settings, loc, notify.AlertOptions{Phone: true, Now: now})
	return err
}

// awayFor words a gap: "45 minutes", "9 hours", "3 days".
func awayFor(d time.Duration) string {
	plural := func(n int, unit string) string {
		if n == 1 {
			return "1 " + unit
		}
		return strconv.Itoa(n) + " " + unit + "s"
	}
	switch {
	case d < 90*time.Minute:
		return plural(int(d.Round(time.Minute)/time.Minute), "minute")
	case d < 48*time.Hour:
		return plural(int(d.Round(time.Hour)/time.Hour), "hour")
	}
	return plural(int(d.Round(24*time.Hour)/(24*time.Hour)), "day")
}

func botNotification(b Bot, title, body, key string, data models.JobPayload) models.Notification {
	entity, id := "bot", b.ID
	return models.Notification{
		UserID: b.UserID, Category: models.NotifyBot, Title: title, Body: body,
		EntityType: &entity, EntityID: &id, DedupeKey: &key, Data: data,
	}
}

// alertData is a Bot alert's notification data. It never has a "kind" key:
// the phone routes by data.kind.
func alertData(b Bot, alertID, checkID, url, botAlert string) models.JobPayload {
	return models.JobPayload{
		"botId": b.ID, "alertId": alertID, "checkId": checkID, "url": url,
		"urgent": b.Urgent, "desktop": b.NotifyDesktop, "phone": b.NotifyPhone, "botAlert": botAlert,
	}
}

// withHeldTime marks an alert quiet hours hold with when it happened.
func withHeldTime(title string, now time.Time, loc *time.Location) string {
	return title + " (at " + now.In(loc).Format("15:04") + ")"
}

// alertText writes a check's alert from its first fired rule, with numbers
// from the check: what happened (no Bot name), a body line and the figures.
// More rules firing in the same check are counted in the body.
func alertText(fired []firedEvent) (what, body string, figures jsonMap[string, any]) {
	what, body, figures = describe(fired[0])
	if extra := len(fired) - 1; extra > 0 {
		body = strings.TrimSpace(fmt.Sprintf("%s (+%d more)", body, extra))
	}
	return what, body, figures
}

// describe words one fired rule. Every word is the code's; page text only
// appears as the changed line or an item title, clipped.
func describe(f firedEvent) (what, body string, figures jsonMap[string, any]) {
	ev, r := f.ev, f.rule
	figures = jsonMap[string, any]{"rule": r.Kind, "watchId": ev.WatchID}
	after, okA := ev.After.value()
	currency := ev.After.Currency
	nowWas := func(was *float64) string {
		subject := "Now"
		if f.w.Kind == WatchPrice && f.w.Symbol != "" {
			subject = f.w.Symbol + " now"
		}
		line := subject + " " + formatMoney(after, currency)
		if was != nil {
			line += " (was " + formatMoney(*was, currency) + ")"
		}
		return line
	}
	if okA {
		figures["price"], figures["currency"] = after, currency
		if f.ref != nil {
			figures["was"] = *f.ref
		}
	}
	switch r.Kind {
	case RuleBelow, RuleAbove:
		t := 0.0
		if r.Threshold != nil {
			t = *r.Threshold
			figures["threshold"] = t
		}
		dir := "below"
		if r.Kind == RuleAbove {
			dir = "above"
		}
		return dir + " " + formatMoney(t, ""), nowWas(f.ref), figures
	case RuleMovePct:
		pct := 0.0
		if f.ref != nil && *f.ref != 0 {
			pct = (after - *f.ref) / math.Abs(*f.ref) * 100
		}
		figures["changePct"] = pct
		dir := "up"
		if pct < 0 {
			dir = "down"
		}
		return dir + " " + strconv.FormatFloat(math.Abs(pct), 'f', 1, 64) + "%", nowWas(f.ref), figures
	case RuleWordsAppear:
		word := firstOr(MatchWords(r.Words, ev.After.Text), r.Words)
		return "“" + word + "” appeared", lineWith(ev.After.Text, word), figures
	case RuleWordsDisappear:
		word := firstOr(MatchWords(r.Words, ev.Before.Text), r.Words)
		return "“" + word + "” disappeared", "It is no longer on the page.", figures
	case RuleNewItem:
		n := len(ev.NewItems)
		figures["items"] = n
		what = "1 new item"
		if n != 1 {
			what = strconv.Itoa(n) + " new items"
		}
		if n == 0 {
			return what, "", figures
		}
		body = clipRunes(ev.NewItems[0].Title, maxChangedLine)
		if n > 1 {
			body += fmt.Sprintf(" and %d more", n-1)
		}
		return what, body, figures
	}
	// any_change
	if ev.After.Kind == ReadingPrice {
		was, okB := ev.Before.value()
		if !okB {
			return "price changed", nowWas(nil), figures
		}
		return "price changed", nowWas(&was), figures
	}
	return "page changed", firstChangedLine(ev.Before.Text, ev.After.Text), figures
}

// saveFindings writes one typed note per fired rule.
func saveFindings(tx *gorm.DB, b Bot, checkID string, fired []firedEvent, alerted bool, now time.Time) error {
	rows := make([]Finding, 0, len(fired))
	for _, f := range fired {
		what, why, figures := describe(f)
		watchID := f.w.ID
		kind := "change"
		switch f.rule.Kind {
		case RuleAbove, RuleBelow, RuleMovePct:
			kind = "price"
		case RuleNewItem:
			kind = "item"
		}
		row := Finding{
			ID: utils.PrefixedUUID("bfd"), BotID: b.ID, UserID: b.UserID, CheckID: &checkID, WatchID: &watchID, Kind: kind,
			Title: clipRunes(what, maxFindingTitle), Why: clipRunes(why, maxFindingWhy), URL: f.w.URL,
			Currency: f.ev.After.Currency, Urgency: "normal", OutsideData: true, Alerted: alerted, CreatedAt: now,
		}
		if b.Urgent {
			row.Urgency = "high"
		}
		if v, ok := f.ev.After.value(); ok {
			row.Price = &v
			if pct, ok := figures["changePct"].(float64); ok {
				row.ChangePct = &pct
			} else if f.ref != nil && *f.ref != 0 {
				pct := (v - *f.ref) / math.Abs(*f.ref) * 100
				row.ChangePct = &pct
			}
		}
		rows = append(rows, row)
	}
	return tx.Create(&rows).Error
}

// firstChangedLine is the first line of cur that prev does not have.
func firstChangedLine(prev, cur string) string {
	had := map[string]bool{}
	for _, l := range strings.Split(prev, "\n") {
		had[strings.TrimSpace(l)] = true
	}
	for _, l := range strings.Split(cur, "\n") {
		if l = strings.TrimSpace(l); l != "" && !had[l] {
			return clipRunes(l, maxChangedLine)
		}
	}
	return ""
}

// lineWith is the first line of text holding word.
func lineWith(text, word string) string {
	for _, l := range strings.Split(text, "\n") {
		if l = strings.TrimSpace(l); len(MatchWords([]string{word}, l)) > 0 {
			return clipRunes(l, maxChangedLine)
		}
	}
	return ""
}

func firstOr(found, all []string) string {
	if len(found) > 0 {
		return found[0]
	}
	if len(all) > 0 {
		return all[0]
	}
	return ""
}

// clipRunes cuts s to n characters, ending in "…" when cut.
func clipRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:n-1])) + "…"
}
