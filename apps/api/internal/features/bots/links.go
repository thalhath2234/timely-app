package bots

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

// Link kinds (bot_links.kind) and the pass states (bot_passes.state).
const (
	LinkPass  = "pass"
	LinkBrief = "brief"

	linkOffPerson = "person"

	passPending  = "pending"
	passAlerted  = "alerted"
	passQuiet    = "quiet"
	passFailed   = "failed"
	passFolded   = "folded"
	passOverflow = "overflow"
	passRepeat   = "repeat"
)

// PassFeedbackReason is the Not useful reason only a passed alert takes:
// "Shouldn't have been passed on". It is not one of FeedbackReasons' chips.
const PassFeedbackReason = "not_passed"

var (
	errLinkCircle = invalid("That would make bots pass items in a circle")
	errLinkChain  = invalid("A chain can be at most %d steps", ChainSteps)
)

// LinkView is a link as the clients see it, with how many items it passed
// today (notification zone).
type LinkView struct {
	ID          string    `json:"id"`
	Kind        string    `json:"kind"`
	FromBotID   string    `json:"fromBotId"`
	ToBotID     string    `json:"toBotId"`
	Filter      []string  `json:"filter"`
	Enabled     bool      `json:"enabled"`
	OffReason   string    `json:"offReason"`
	PassedToday int       `json:"passedToday"`
	CreatedAt   time.Time `json:"createdAt"`
}

func linkView(l Link, passed int) LinkView {
	filter := []string(l.Filter)
	if filter == nil {
		filter = []string{}
	}
	return LinkView{ID: l.ID, Kind: l.Kind, FromBotID: l.FromBotID, ToBotID: l.ToBotID, Filter: filter,
		Enabled: l.Enabled, OffReason: l.OffReason, PassedToday: passed, CreatedAt: l.CreatedAt}
}

// countedStates are the passes that count toward a link's day: the ones it
// actually handed on.
var countedStates = []string{passPending, passAlerted, passQuiet, passFailed}

// passedToday counts, by link, the items the account's links handed on
// today.
func passedToday(db *gorm.DB, userID, day string) (map[string]int, error) {
	var rows []struct {
		LinkID string
		N      int
	}
	if err := db.Model(&Pass{}).Select("link_id, count(*) AS n").
		Where("user_id = ? AND local_day = CAST(? AS date) AND link_id IS NOT NULL AND state IN ?", userID, day, countedStates).
		Group("link_id").Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[string]int, len(rows))
	for _, r := range rows {
		out[r.LinkID] = r.N
	}
	return out, nil
}

// accountLinks lists every link of the account, oldest first, and how many
// items they handed on today (day, notification zone) in all.
func accountLinks(db *gorm.DB, userID, day string) ([]LinkView, int, error) {
	var links []Link
	if err := db.Where("user_id = ?", userID).Order("created_at, id").Find(&links).Error; err != nil {
		return nil, 0, err
	}
	passed, err := passedToday(db, userID, day)
	if err != nil {
		return nil, 0, err
	}
	total := 0
	for _, n := range passed {
		total += n
	}
	out := make([]LinkView, 0, len(links))
	for _, l := range links {
		out = append(out, linkView(l, passed[l.ID]))
	}
	return out, total, nil
}

// botLinks lists every link from or to a Bot, oldest first.
func botLinks(db *gorm.DB, userID, botID string, now time.Time) ([]LinkView, error) {
	var links []Link
	if err := db.Where("user_id = ? AND (from_bot_id = ? OR to_bot_id = ?)", userID, botID, botID).
		Order("created_at, id").Find(&links).Error; err != nil {
		return nil, err
	}
	out := make([]LinkView, 0, len(links))
	if len(links) == 0 {
		return out, nil
	}
	day, err := localDay(db, userID, now)
	if err != nil {
		return nil, err
	}
	passed, err := passedToday(db, userID, day)
	if err != nil {
		return nil, err
	}
	for _, l := range links {
		out = append(out, linkView(l, passed[l.ID]))
	}
	return out, nil
}

// SetLink switches a pass link on or off. Off is the person's (off_reason
// person); on clears it. A brief link is always on: the brief's list of
// bots is what changes it.
func (s *Store) SetLink(ctx context.Context, userID, linkID string, enabled bool, now time.Time) (LinkView, error) {
	db := s.conn(ctx)
	reason := ""
	if !enabled {
		reason = linkOffPerson
	}
	res := db.Model(&Link{}).Where("id = ? AND user_id = ? AND kind = ?", linkID, userID, LinkPass).
		Updates(map[string]any{"enabled": enabled, "off_reason": reason, "updated_at": now.UTC()})
	if res.Error != nil {
		return LinkView{}, res.Error
	}
	if res.RowsAffected == 0 {
		var n int64
		if err := db.Model(&Link{}).Where("id = ? AND user_id = ?", linkID, userID).Count(&n).Error; err != nil {
			return LinkView{}, err
		}
		if n > 0 {
			return LinkView{}, errBriefLinkOff
		}
		return LinkView{}, ErrLinkNotFound
	}
	var l Link
	if err := db.Where("id = ? AND user_id = ?", linkID, userID).First(&l).Error; err != nil {
		return LinkView{}, err
	}
	day, err := localDay(db, userID, now)
	if err != nil {
		return LinkView{}, err
	}
	passed, err := passedToday(db, userID, day)
	if err != nil {
		return LinkView{}, err
	}
	return linkView(l, passed[l.ID]), nil
}

// cleanFilter keeps a link's filter words: each one line of at most
// MaxFilterWordLen characters, empties and repeats dropped, at most
// MaxFilterWords.
func cleanFilter(in []string) ([]string, error) {
	out := filterWords(in)
	if len(out) > MaxFilterWords {
		return nil, invalid("Up to %d filter words", MaxFilterWords)
	}
	return out, nil
}

// filterWords is cleanFilter's words with no count limit.
func filterWords(in []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, w := range in {
		w = cleanLine(w, MaxFilterWordLen)
		key := strings.ToLower(w)
		if w == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, w)
	}
	return out
}

// saveLinks applies a Bot's full Pass to list inside Create or Update,
// under lockAccount: links to Bots already linked keep their id (and stay
// on or off unless the input says), new ones are added and missing ones
// removed. The account's links must then hold no circle and no chain
// longer than ChainSteps.
func saveLinks(tx *gorm.DB, userID string, b Bot, in []LinkInput, now time.Time) error {
	if b.Kind == KindBrief && len(in) > 0 {
		return invalid("A brief cannot pass items on")
	}
	if len(in) > MaxLinks {
		return invalid("A bot can pass to up to %d bots", MaxLinks)
	}
	var cur []Link
	if err := tx.Where("user_id = ? AND from_bot_id = ? AND kind = ?", userID, b.ID, LinkPass).Find(&cur).Error; err != nil {
		return err
	}
	byTarget := make(map[string]Link, len(cur))
	for _, l := range cur {
		byTarget[l.ToBotID] = l
	}
	keep := map[string]bool{}
	for _, li := range in {
		ref := strings.TrimSpace(li.BotID)
		if ref == "" {
			return invalid("Pick a bot to pass to")
		}
		target, err := findBot(tx, userID, ref, false)
		if errors.Is(err, ErrNotFound) {
			return invalid("There is no bot called %q to pass to", utils.ClipUTF8(ref, MaxNameLen))
		}
		if err != nil {
			return err
		}
		if target.ID == b.ID {
			return invalid("A bot cannot pass to itself")
		}
		if target.Kind != KindWatch {
			return invalid("Items can only be passed to a bot that watches something")
		}
		if keep[target.ID] {
			return invalid("%s is in the list twice", target.Name)
		}
		keep[target.ID] = true
		filter, err := cleanFilter(li.Filter)
		if err != nil {
			return err
		}
		if old, ok := byTarget[target.ID]; ok {
			set := map[string]any{"filter": jsonList[string](filter), "updated_at": now}
			if li.Enabled != nil {
				set["enabled"], set["off_reason"] = *li.Enabled, ""
				if !*li.Enabled {
					set["off_reason"] = linkOffPerson
				}
			}
			if err := tx.Model(&Link{}).Where("id = ? AND user_id = ?", old.ID, userID).Updates(set).Error; err != nil {
				return err
			}
			continue
		}
		l := Link{ID: utils.PrefixedUUID("blk"), UserID: userID, Kind: LinkPass, FromBotID: b.ID, ToBotID: target.ID,
			Filter: filter, Enabled: deref(li.Enabled, true), CreatedAt: now, UpdatedAt: now}
		if !l.Enabled {
			l.OffReason = linkOffPerson
		}
		if err := tx.Create(&l).Error; err != nil {
			return err
		}
	}
	var gone []string
	for _, l := range cur {
		if !keep[l.ToBotID] {
			gone = append(gone, l.ID)
		}
	}
	if len(gone) > 0 {
		if err := tx.Where("id IN ? AND user_id = ?", gone, userID).Delete(&Link{}).Error; err != nil {
			return err
		}
	}
	edges, err := passEdges(tx, userID)
	if err != nil {
		return err
	}
	switch problem, _ := graphProblem(edges); problem {
	case graphCircle:
		return errLinkCircle
	case graphTooLong:
		return errLinkChain
	}
	return nil
}

// saveBriefLinks applies a brief's full list of sources inside Create or
// Update, under lockAccount: 1 to MaxBriefSources watch Bots of the
// account, each a brief link from the source to the brief. Sources already
// linked keep their link; missing ones lose it, and a Bot left in no brief
// stops being "Only in the brief". It returns the source ids in the order
// given; new links are a microsecond apart, so they list in that order.
func saveBriefLinks(tx *gorm.DB, userID string, b Bot, sources []string, now time.Time) ([]string, error) {
	if len(sources) == 0 || len(sources) > MaxBriefSources {
		return nil, errBriefSources
	}
	var cur []Link
	if err := tx.Where("user_id = ? AND to_bot_id = ? AND kind = ?", userID, b.ID, LinkBrief).Find(&cur).Error; err != nil {
		return nil, err
	}
	have := make(map[string]bool, len(cur))
	for _, l := range cur {
		have[l.FromBotID] = true
	}
	keep := map[string]bool{}
	ids := make([]string, 0, len(sources))
	for i, raw := range sources {
		ref := strings.TrimSpace(raw)
		if ref == "" {
			return nil, invalid("Pick a bot for the brief to sum up")
		}
		src, err := findBot(tx, userID, ref, false)
		if errors.Is(err, ErrNotFound) {
			return nil, invalid("There is no bot called %q to sum up", utils.ClipUTF8(ref, MaxNameLen))
		}
		if err != nil {
			return nil, err
		}
		if src.ID == b.ID || src.Kind != KindWatch {
			return nil, invalid("A brief sums up bots that watch something")
		}
		if keep[src.ID] {
			return nil, invalid("%s is in the list twice", src.Name)
		}
		keep[src.ID] = true
		ids = append(ids, src.ID)
		if have[src.ID] {
			continue
		}
		l := Link{ID: utils.PrefixedUUID("blk"), UserID: userID, Kind: LinkBrief, FromBotID: src.ID, ToBotID: b.ID,
			Filter: jsonList[string]{}, Enabled: true, CreatedAt: now.Add(time.Duration(i) * time.Microsecond), UpdatedAt: now}
		if err := tx.Create(&l).Error; err != nil {
			return nil, err
		}
	}
	var gone []string
	for _, l := range cur {
		if !keep[l.FromBotID] {
			gone = append(gone, l.ID)
		}
	}
	if len(gone) > 0 {
		if err := tx.Where("id IN ? AND user_id = ?", gone, userID).Delete(&Link{}).Error; err != nil {
			return nil, err
		}
	}
	return ids, resetBriefOnly(tx, userID, now)
}

// resetBriefOnly turns "Only in the brief" off on every Bot of the account
// that is in no brief any more, so none goes silent.
func resetBriefOnly(tx *gorm.DB, userID string, now time.Time) error {
	return tx.Exec(`UPDATE bots SET brief_only = false, updated_at = ? WHERE user_id = ? AND brief_only
  AND id NOT IN (SELECT from_bot_id FROM bot_links WHERE user_id = ? AND kind = ?)`, now.UTC(), userID, userID, LinkBrief).Error
}

// inBrief reports whether a Bot is a source of one of the account's briefs.
func inBrief(tx *gorm.DB, userID, botID string) (bool, error) {
	var n int64
	err := tx.Model(&Link{}).Where("user_id = ? AND from_bot_id = ? AND kind = ?", userID, botID, LinkBrief).Count(&n).Error
	return n > 0, err
}

// briefOnlyNow reports whether a check of b says nothing itself: b is "Only
// in the brief" and an enabled link puts it in a brief that is on. A Bot
// whose briefs are all paused or gone alerts as usual.
func briefOnlyNow(db *gorm.DB, b Bot) (bool, error) {
	if !b.BriefOnly {
		return false, nil
	}
	var n int64
	err := db.Raw(`SELECT count(*) FROM bot_links l JOIN bots t ON t.id = l.to_bot_id AND t.user_id = l.user_id
WHERE l.user_id = ? AND l.from_bot_id = ? AND l.kind = ? AND l.enabled AND t.kind = ? AND t.status = ?`,
		b.UserID, b.ID, LinkBrief, KindBrief, StatusActive).Scan(&n).Error
	return n > 0, err
}

// linkEdge is one pass link in the account's graph.
type linkEdge struct {
	ID, From, To string
	CreatedAt    time.Time
}

// passEdges lists every pass link of the account, on or off, oldest first.
func passEdges(tx *gorm.DB, userID string) ([]linkEdge, error) {
	var rows []Link
	if err := tx.Select("id", "from_bot_id", "to_bot_id", "created_at").Where("user_id = ? AND kind = ?", userID, LinkPass).
		Order("created_at, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]linkEdge, len(rows))
	for i, r := range rows {
		out[i] = linkEdge{ID: r.ID, From: r.FromBotID, To: r.ToBotID, CreatedAt: r.CreatedAt}
	}
	return out, nil
}

// What is wrong with a pass graph.
const (
	graphOK = iota
	graphCircle
	graphTooLong
)

// graphProblem checks the account's pass links: a circle, or a chain of
// more than ChainSteps links, and the links on the first one found. Links
// that are off count too, since they can be turned on without a save.
func graphProblem(edges []linkEdge) (int, []linkEdge) {
	out := map[string][]linkEdge{}
	var nodes []string
	seenNode := map[string]bool{}
	for _, e := range edges {
		out[e.From] = append(out[e.From], e)
		for _, n := range []string{e.From, e.To} {
			if !seenNode[n] {
				seenNode[n] = true
				nodes = append(nodes, n)
			}
		}
	}
	// A circle: depth-first, with the path so far.
	const (
		white = iota
		grey
		black
	)
	color := map[string]int{}
	var path []linkEdge
	var circle []linkEdge
	var visit func(n string) bool
	visit = func(n string) bool {
		color[n] = grey
		for _, e := range out[n] {
			switch color[e.To] {
			case grey:
				// The circle is the path from where e.To was entered, plus e.
				start := len(path)
				for i := len(path) - 1; i >= 0; i-- {
					if path[i].From == e.To {
						start = i
						break
					}
				}
				circle = append(append([]linkEdge{}, path[start:]...), e)
				return true
			case white:
				path = append(path, e)
				if visit(e.To) {
					return true
				}
				path = path[:len(path)-1]
			}
		}
		color[n] = black
		return false
	}
	for _, n := range nodes {
		if color[n] == white && visit(n) {
			return graphCircle, circle
		}
	}
	// No circle: the longest chain from each Bot.
	longest := map[string][]linkEdge{}
	var chain func(n string) []linkEdge
	chain = func(n string) []linkEdge {
		if c, ok := longest[n]; ok {
			return c
		}
		var best []linkEdge
		for _, e := range out[n] {
			if c := chain(e.To); len(c)+1 > len(best) {
				best = append([]linkEdge{e}, c...)
			}
		}
		longest[n] = best
		return best
	}
	for _, n := range nodes {
		if c := chain(n); len(c) > ChainSteps {
			return graphTooLong, c
		}
	}
	return graphOK, nil
}

// vetLinks checks the links a restore wrote, under lockAccount: over MCP
// none come back (an outside app adds no chains); otherwise a link whose
// filter is not a list of words goes (an empty one would pass everything),
// the rest keep cleanFilter's words, the first MaxFilterWords of them, each
// Bot keeps its oldest MaxLinks pass links, and while the links hold a
// circle or a chain over ChainSteps the newest link on it goes.
func vetLinks(tx *gorm.DB, userID string, fromMCP bool) error {
	if err := lockAccount(tx, userID); err != nil {
		return err
	}
	if fromMCP {
		if err := tx.Where("user_id = ?", userID).Delete(&Link{}).Error; err != nil {
			return err
		}
		return resetBriefOnly(tx, userID, time.Now())
	}
	// Each kind joins the right kinds of Bot: a pass goes from a watch Bot
	// to a watch Bot, a brief link from a watch Bot to a brief.
	if err := tx.Exec(`
DELETE FROM bot_links l USING bots f, bots t
WHERE l.user_id = ? AND f.id = l.from_bot_id AND t.id = l.to_bot_id
  AND (f.kind <> 'watch' OR (l.kind = 'pass' AND t.kind <> 'watch') OR (l.kind = 'brief' AND t.kind <> 'brief'))`, userID).Error; err != nil {
		return err
	}
	if err := tx.Exec(`
DELETE FROM bot_links WHERE id IN (
    SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY to_bot_id ORDER BY created_at, id) AS n
                    FROM bot_links WHERE user_id = ? AND kind = ?) r
    WHERE r.n > ?)`, userID, LinkBrief, MaxBriefSources).Error; err != nil {
		return err
	}
	// A brief link is always on (SetLink cannot turn one off).
	if err := tx.Model(&Link{}).Where("user_id = ? AND kind = ? AND NOT enabled", userID, LinkBrief).
		Updates(map[string]any{"enabled": true, "off_reason": ""}).Error; err != nil {
		return err
	}
	if err := resetBriefOnly(tx, userID, time.Now()); err != nil {
		return err
	}
	if err := tx.Exec(`
DELETE FROM bot_links WHERE user_id = ? AND CASE WHEN jsonb_typeof(filter) = 'array'
    THEN EXISTS (SELECT 1 FROM jsonb_array_elements(filter) w WHERE jsonb_typeof(w) <> 'string')
    ELSE true END`, userID).Error; err != nil {
		return err
	}
	var restored []Link
	if err := tx.Where("user_id = ? AND filter <> '[]'::jsonb", userID).Find(&restored).Error; err != nil {
		return err
	}
	for _, l := range restored {
		words := filterWords(l.Filter)
		switch {
		case len(words) == 0:
			if err := tx.Where("id = ? AND user_id = ?", l.ID, userID).Delete(&Link{}).Error; err != nil {
				return err
			}
			continue
		case len(words) > MaxFilterWords:
			words = words[:MaxFilterWords]
		}
		if !slices.Equal(words, []string(l.Filter)) {
			if err := tx.Model(&Link{}).Where("id = ? AND user_id = ?", l.ID, userID).Update("filter", jsonList[string](words)).Error; err != nil {
				return err
			}
		}
	}
	if err := tx.Exec(`
DELETE FROM bot_links WHERE id IN (
    SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY from_bot_id ORDER BY created_at, id) AS n
                    FROM bot_links WHERE user_id = ? AND kind = ?) r
    WHERE r.n > ?)`, userID, LinkPass, MaxLinks).Error; err != nil {
		return err
	}
	for {
		edges, err := passEdges(tx, userID)
		if err != nil {
			return err
		}
		problem, path := graphProblem(edges)
		if problem == graphOK {
			return nil
		}
		newest := path[0]
		for _, e := range path[1:] {
			if e.CreatedAt.After(newest.CreatedAt) || (e.CreatedAt.Equal(newest.CreatedAt) && e.ID > newest.ID) {
				newest = e
			}
		}
		if err := tx.Where("id = ? AND user_id = ?", newest.ID, userID).Delete(&Link{}).Error; err != nil {
			return err
		}
	}
}

// linkTarget is a link a check may pass its items on by.
type linkTarget struct {
	LinkID, ToBotID, ToName string
	Filter                  []string
	Active                  bool // the Bot it passes to is on
}

// passLinks lists a Bot's pass links that are on, with their targets.
func passLinks(db *gorm.DB, b Bot) ([]linkTarget, error) {
	var rows []struct {
		ID, ToBotID, Name, Status string
		Filter                    jsonList[string]
	}
	if err := db.Raw(`
SELECT l.id, l.to_bot_id, l.filter, t.name, t.status
FROM bot_links l JOIN bots t ON t.id = l.to_bot_id AND t.user_id = l.user_id
WHERE l.user_id = ? AND l.from_bot_id = ? AND l.kind = ? AND l.enabled AND t.kind = ?
ORDER BY l.created_at, l.id`, b.UserID, b.ID, LinkPass, KindWatch).Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]linkTarget, len(rows))
	for i, r := range rows {
		out[i] = linkTarget{LinkID: r.ID, ToBotID: r.ToBotID, ToName: r.Name, Filter: r.Filter, Active: r.Status == StatusActive}
	}
	return out, nil
}

// itemKey names one thing a check can pass on: a fired rule, and for a
// feed's new items, one item.
type itemKey struct{ watchID, ruleID, itemID string }

// takeItems decides which of a check's fired rules (and a feed's items) go
// on to other Bots: an item goes by each link whose target is on and whose
// filter it matches (any word of the note, or every note with no words),
// unless the chain is already ChainSteps long. It is pure; the save decides
// later which become pending, overflow or repeat.
func takeItems(fired []firedEvent, links []linkTarget, depth int) map[itemKey][]linkTarget {
	if depth+1 > ChainSteps || len(links) == 0 {
		return nil
	}
	taken := map[itemKey][]linkTarget{}
	take := func(k itemKey, text string) {
		for _, l := range links {
			if l.Active && (len(l.Filter) == 0 || len(MatchWords(l.Filter, text)) > 0) {
				taken[k] = append(taken[k], l)
			}
		}
	}
	for _, f := range fired {
		if f.rule.Kind == RuleNewItem && len(f.ev.NewItems) > 0 {
			for _, it := range f.ev.NewItems {
				take(itemKey{f.ev.WatchID, f.ev.RuleID, it.ID}, it.Title)
			}
			continue
		}
		what, why, _ := describe(f)
		take(itemKey{f.ev.WatchID, f.ev.RuleID, ""}, what+"\n"+why)
	}
	if len(taken) == 0 {
		return nil
	}
	return taken
}

// untaken is what a check still alerts on itself: the fired rules no link
// took, and of a feed rule only the items no link took (a rule left with
// none is dropped).
func untaken(fired []firedEvent, taken map[itemKey][]linkTarget) []firedEvent {
	if len(taken) == 0 {
		return fired
	}
	out := make([]firedEvent, 0, len(fired))
	for _, f := range fired {
		if f.rule.Kind == RuleNewItem && len(f.ev.NewItems) > 0 {
			var keep = f.ev.NewItems[:0:0]
			for _, it := range f.ev.NewItems {
				if len(taken[itemKey{f.ev.WatchID, f.ev.RuleID, it.ID}]) == 0 {
					keep = append(keep, it)
				}
			}
			if len(keep) == 0 {
				continue
			}
			f.ev.NewItems = keep
			out = append(out, f)
			continue
		}
		if len(taken[itemKey{f.ev.WatchID, f.ev.RuleID, ""}]) == 0 {
			out = append(out, f)
		}
	}
	return out
}

// passRun is what applyPasses needs of the check that took items.
type passRun struct {
	bot     Bot
	checkID string
	chainID string
	depth   int // the check's own step: 0 for a check of its own
	now     time.Time
}

// applyPasses records, inside the check's transaction and under the things
// lock, what each taken item became for each link: repeat when the same
// thing was handed to that Bot in the last PassRepeatDays days (only
// counted states: a repeat, overflow or folded row never starts a window);
// overflow when the check already passed PassPerCheck items, the link
// passed LinkPerDay today, or the item has no note to pass (a feed's items
// past MaxItemFindings); else pending, with a bot_pass job. Overflow and repeat
// leave the first Bot quiet too, so the limits change nothing it alerts.
func applyPasses(tx *gorm.DB, r passRun, fired []firedEvent, taken map[itemKey][]linkTarget, notes []Finding, keys []itemKey) error {
	if len(taken) == 0 {
		return nil
	}
	if err := lockThings(tx, r.bot.UserID); err != nil {
		return err
	}
	day, err := localDay(tx, r.bot.UserID, r.now)
	if err != nil {
		return err
	}
	noteOf := make(map[itemKey]Finding, len(keys))
	for i, k := range keys {
		if _, ok := noteOf[k]; !ok {
			noteOf[k] = notes[i]
		}
	}
	linkDay := map[string]int{}
	counted := map[string]bool{}
	pending := 0
	q := jobs.NewQueue(tx)
	pass := func(k itemKey, thing string, l linkTarget) error {
		state := passPending
		var repeat int64
		if thing != "" {
			if err := tx.Model(&Pass{}).Where("user_id = ? AND to_bot_id = ? AND thing_key = ? AND created_at > ? AND state IN ?",
				r.bot.UserID, l.ToBotID, thing, r.now.Add(-PassRepeatDays*24*time.Hour), countedStates).Count(&repeat).Error; err != nil {
				return err
			}
		}
		if !counted[l.LinkID] {
			var n int64
			if err := tx.Model(&Pass{}).Where("link_id = ? AND local_day = CAST(? AS date) AND state IN ?", l.LinkID, day, countedStates).
				Count(&n).Error; err != nil {
				return err
			}
			linkDay[l.LinkID], counted[l.LinkID] = int(n), true
		}
		note, hasNote := noteOf[k]
		switch {
		case repeat > 0:
			state = passRepeat
		case pending >= PassPerCheck || linkDay[l.LinkID] >= LinkPerDay || !hasNote:
			state = passOverflow
		}
		p := Pass{
			ID: utils.PrefixedUUID("bps"), UserID: r.bot.UserID, LinkID: &l.LinkID, FromBotID: r.bot.ID, ToBotID: l.ToBotID,
			ThingKey: thing, ChainID: r.chainID, Depth: r.depth + 1, State: state, CreatedAt: r.now, UpdatedAt: r.now,
		}
		p.LocalDay, _ = time.Parse(dayLayout, day)
		if hasNote {
			p.FindingID = &note.ID
		}
		if err := tx.Create(&p).Error; err != nil {
			return err
		}
		if state != passPending {
			return nil
		}
		pending++
		linkDay[l.LinkID]++
		_, err := q.Enqueue(jobs.Enqueue{
			UserID: r.bot.UserID, Kind: models.JobBotPass, DedupeKey: "bot_pass:" + p.ID, MaxAttempts: 2, RunAt: r.now,
			Payload: models.JobPayload{"passId": p.ID, "botId": l.ToBotID},
		})
		return err
	}
	for _, f := range fired {
		if f.rule.Kind == RuleNewItem && len(f.ev.NewItems) > 0 {
			for _, it := range f.ev.NewItems {
				k := itemKey{f.ev.WatchID, f.ev.RuleID, it.ID}
				thing := thingKeyItem(it, f.w)
				if n, ok := noteOf[k]; ok && n.ThingKey != "" {
					thing = n.ThingKey
				}
				for _, l := range taken[k] {
					if err := pass(k, thing, l); err != nil {
						return err
					}
				}
			}
			continue
		}
		k := itemKey{f.ev.WatchID, f.ev.RuleID, ""}
		thing := thingKeyWatch(f.w)
		if n, ok := noteOf[k]; ok && n.ThingKey != "" {
			thing = n.ThingKey
		}
		for _, l := range taken[k] {
			if err := pass(k, thing, l); err != nil {
				return err
			}
		}
	}
	return nil
}

// lockPass takes a pending pass for its job, or reports it is not pending.
func lockPass(tx *gorm.DB, id, userID string) (Pass, bool, error) {
	var rows []Pass
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ? AND state = ?", id, userID, passPending).
		Limit(1).Find(&rows).Error
	if err != nil || len(rows) == 0 {
		return Pass{}, false, err
	}
	return rows[0], true, nil
}

// briefSources lists, by brief, the Bots each of the account's briefs sums
// up (or one brief's, when botID is set), in the order they were added.
func briefSources(db *gorm.DB, userID, botID string) (map[string][]string, error) {
	q := db.Model(&Link{}).Select("from_bot_id", "to_bot_id").Where("user_id = ? AND kind = ?", userID, LinkBrief)
	if botID != "" {
		q = q.Where("to_bot_id = ?", botID)
	}
	var rows []Link
	if err := q.Order("created_at, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	out := map[string][]string{}
	for _, l := range rows {
		out[l.ToBotID] = append(out[l.ToBotID], l.FromBotID)
	}
	return out, nil
}
