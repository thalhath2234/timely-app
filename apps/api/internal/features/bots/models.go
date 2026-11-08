package bots

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"time"
)

// Bot is one person's Bot (table bots). next_check_at is its only schedule:
// set while active, NULL while paused.
type Bot struct {
	ID              string     `gorm:"type:text;primaryKey" json:"id"`
	UserID          string     `gorm:"type:text;not null" json:"-"`
	Name            string     `gorm:"type:text;not null" json:"name"`
	Description     string     `gorm:"type:text;not null" json:"description"`
	Origin          Origin     `gorm:"type:text;not null" json:"origin"`
	OriginClient    string     `gorm:"type:text;not null" json:"originClient"` // the API key's name, origin mcp only
	Status          string     `gorm:"type:text;not null" json:"status"`
	PauseReason     *string    `gorm:"type:text" json:"pauseReason"`
	JudgeMode       string     `gorm:"type:text;not null" json:"judgeMode"`
	IntervalSeconds int        `gorm:"not null" json:"intervalSeconds"`
	Urgent          bool       `gorm:"not null" json:"urgent"`
	NotifyDesktop   bool       `gorm:"not null" json:"desktop"`
	NotifyPhone     bool       `gorm:"not null" json:"phone"`
	SnoozedUntil    *time.Time `json:"snoozedUntil"`
	NextCheckAt     *time.Time `json:"nextCheckAt"`
	CheckStartedAt  *time.Time `json:"checkStartedAt"`
	CheckingJobID   *string    `gorm:"column:checking_job_id;type:text" json:"-"`
	AskedAt         *time.Time `json:"-"` // when a tag in chat last started a check (Ask)
	LastCheckAt     *time.Time `json:"lastCheckAt"`
	LastOkAt        *time.Time `json:"lastOkAt"`
	Strikes         int        `gorm:"not null" json:"strikes"`
	OfflineSince    *time.Time `json:"offlineSince"`
	Health          string     `gorm:"type:text;not null" json:"health"`
	HealthDetail    string     `gorm:"type:text;not null" json:"healthDetail"`
	// Suggestion is the better rule a rules-only Bot proposes after three
	// Not useful alerts in a row (T2); SuggestionDismissedAt is when the
	// person last applied or dismissed one.
	Suggestion            *Suggestion `gorm:"serializer:json;type:jsonb" json:"-"`
	SuggestionDismissedAt *time.Time  `json:"-"`
	// KnowledgeKind and KnowledgeID name the doc or sheet the Bot's judge
	// reads ("doc" or "sheet"; both "" for none). No foreign key: a read
	// checks the row is still the person's.
	KnowledgeKind string `gorm:"type:text;not null" json:"-"`
	KnowledgeID   string `gorm:"type:text;not null" json:"-"`
	// Kind is watch or brief. A brief has no watches: it sends one alert a
	// day at BriefTime (notification zone) listing its sources' notes since
	// BriefCursorAt, written with AI when BriefAI. A source with BriefOnly
	// alerts only through its briefs.
	Kind          string     `gorm:"type:text;not null;default:watch" json:"kind"`
	BriefOnly     bool       `gorm:"not null" json:"briefOnly"`
	BriefAI       bool       `gorm:"column:brief_ai;not null" json:"briefAi"`
	BriefTime     string     `gorm:"type:text;not null" json:"briefTime"`
	BriefCursorAt *time.Time `json:"-"`
	// AwaySince, AwayUntil and AwayReason are a gap the Bot has not caught
	// up on yet: set by the sweep after Timely was closed or the computer
	// slept, or by turning Pause all off, and cleared by its next check that
	// reads something (all three or none).
	AwaySince  *time.Time `json:"-"`
	AwayUntil  *time.Time `json:"-"`
	AwayReason *string    `gorm:"type:text" json:"-"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
}

func (Bot) TableName() string { return "bots" }

// Suggestion is a change a Bot proposes, worked out by code from the
// person's ratings: Line asks, Button applies. It names the rule it changes
// (WatchID, RuleID and the new Rule), a new interval or AI judging.
type Suggestion struct {
	ID              string    `json:"id"` // bsg_<uuid>
	Line            string    `json:"line"`
	Button          string    `json:"button"`
	Reason          string    `json:"reason"` // the ratings' most common reason, or ""
	WatchID         string    `json:"watchId,omitempty"`
	RuleID          string    `json:"ruleId,omitempty"`
	Rule            *Rule     `json:"rule,omitempty"`
	IntervalMinutes *int      `json:"intervalMinutes,omitempty"`
	JudgeMode       string    `json:"judgeMode,omitempty"`
	AlertIDs        []string  `json:"alertIds"`
	CreatedAt       time.Time `json:"createdAt"`
}

// Interval is how often the Bot is checked.
func (b Bot) Interval() time.Duration { return time.Duration(b.IntervalSeconds) * time.Second }

// Watch is one thing a Bot reads: a page, a feed or a price (table
// bot_watches). ConfigVersion goes up on every edit that changes what is
// read or how it is judged, so a check that started before the edit drops
// its reading.
type Watch struct {
	ID              string                     `gorm:"type:text;primaryKey" json:"id"`
	BotID           string                     `gorm:"type:text;not null" json:"botId"`
	UserID          string                     `gorm:"type:text;not null" json:"-"`
	Position        int                        `gorm:"not null" json:"position"`
	Kind            string                     `gorm:"type:text;not null" json:"kind"`
	URL             string                     `gorm:"column:url;type:text;not null" json:"url"`
	ReadMode        string                     `gorm:"column:read_mode;type:text;not null" json:"read"`
	Selector        string                     `gorm:"type:text;not null" json:"selector"`
	Source          string                     `gorm:"type:text;not null" json:"source"`
	Symbol          string                     `gorm:"type:text;not null" json:"symbol"`
	Currency        string                     `gorm:"type:text;not null" json:"currency"`
	Rules           jsonList[Rule]             `gorm:"type:jsonb;not null" json:"rules"`
	RuleState       jsonMap[string, RuleState] `gorm:"column:rule_state;type:jsonb;not null" json:"ruleState"`
	LastReading     *Reading                   `gorm:"serializer:json;type:jsonb" json:"lastReading"`
	LastReadingAt   *time.Time                 `json:"lastReadingAt"`
	LastChangedAt   *time.Time                 `json:"lastChangedAt"` // the last check whose reading moved, or a baseline
	BaselinePending bool                       `gorm:"not null" json:"baselinePending"`
	ConfigVersion   int                        `gorm:"not null" json:"configVersion"`
	ETag            string                     `gorm:"column:etag;type:text;not null" json:"-"`
	LastModified    string                     `gorm:"column:last_modified;type:text;not null" json:"-"`
	ValidatorsURL   string                     `gorm:"column:validators_url;type:text;not null" json:"-"`
	Health          string                     `gorm:"type:text;not null" json:"health"`
	HealthDetail    string                     `gorm:"type:text;not null" json:"healthDetail"`
	CreatedAt       time.Time                  `json:"createdAt"`
	UpdatedAt       time.Time                  `json:"updatedAt"`
}

func (Watch) TableName() string { return "bot_watches" }

// CheckWatch is how one watch went in a check.
type CheckWatch struct {
	WatchID   string `json:"watchId"`
	Status    int    `json:"status,omitempty"`
	Bytes     int    `json:"bytes,omitempty"`
	MS        int64  `json:"ms"`
	Outcome   string `json:"outcome"`
	ErrorKind string `json:"errorKind,omitempty"`
	// Note says why a held_stock watch stayed quiet.
	Note string `json:"note,omitempty"`
}

// FiredRule names one rule that fired in a check.
type FiredRule struct {
	WatchID string `json:"watchId"`
	RuleID  string `json:"ruleId"`
	Kind    string `json:"kind"`
}

// Rearm is a below or above rule that armed again in a check: the value
// came back past its reset band, so the next crossing alerts ("Armed
// again, no alert").
type Rearm struct {
	WatchID  string  `json:"watchId"`
	RuleID   string  `json:"ruleId"`
	Value    float64 `json:"value"`
	Currency string  `json:"currency,omitempty"`
}

// Check is one entry in a Bot's log (table bot_checks). Reading, keyed by
// watch id, is kept only for baseline, changed and fired checks.
type Check struct {
	ID         string               `gorm:"type:text;primaryKey" json:"id"`
	BotID      string               `gorm:"type:text;not null" json:"botId"`
	UserID     string               `gorm:"type:text;not null" json:"-"`
	JobID      *string              `gorm:"type:text" json:"-"`
	Trigger    string               `gorm:"type:text;not null" json:"trigger"`
	StartedAt  time.Time            `gorm:"not null" json:"startedAt"`
	FinishedAt time.Time            `gorm:"not null" json:"finishedAt"`
	Outcome    string               `gorm:"type:text;not null" json:"outcome"`
	ErrorKind  string               `gorm:"type:text;not null" json:"errorKind"`
	Error      string               `gorm:"type:text;not null" json:"error"`
	Watches    jsonList[CheckWatch] `gorm:"type:jsonb;not null" json:"watches"`
	Reading    map[string]Reading   `gorm:"serializer:json;type:jsonb" json:"reading,omitempty"`
	Fired      jsonList[FiredRule]  `gorm:"type:jsonb;not null" json:"fired"`
	Rearmed    jsonList[Rearm]      `gorm:"type:jsonb;not null" json:"rearmed"`
	AlertID    *string              `gorm:"type:text" json:"alertId"`
	// AwaySecs and AwayReason are the gap this check caught up on, when it
	// was the first to run after one.
	AwaySecs   *int      `json:"-"`
	AwayReason *string   `gorm:"type:text" json:"-"`
	CreatedAt  time.Time `json:"createdAt"`
}

func (Check) TableName() string { return "bot_checks" }

// Alert is one alert a Bot raised, sent or held (table bot_alerts). It
// outlives the notification, which the person can clear.
type Alert struct {
	ID             string               `gorm:"type:text;primaryKey" json:"id"`
	BotID          string               `gorm:"type:text;not null" json:"botId"`
	UserID         string               `gorm:"type:text;not null" json:"-"`
	CheckID        *string              `gorm:"type:text" json:"checkId"`
	NotificationID *string              `gorm:"type:text" json:"notificationId"`
	Kind           string               `gorm:"type:text;not null" json:"kind"` // alert|more|paused|brief
	Held           string               `gorm:"type:text;not null" json:"held"` // ""|snoozed|cap|judged|shared
	LocalDay       time.Time            `gorm:"type:date;not null" json:"-"`
	Title          string               `gorm:"type:text;not null" json:"title"`
	Body           string               `gorm:"type:text;not null" json:"body"`
	URL            string               `gorm:"column:url;type:text;not null" json:"url"`
	Figures        jsonMap[string, any] `gorm:"type:jsonb;not null" json:"figures"`
	Urgent         bool                 `gorm:"not null" json:"urgent"`
	MoreCount      int                  `gorm:"not null" json:"moreCount"`
	// The person's rating: useful or not_useful, and for not_useful why
	// (FeedbackReason) and a free line (FeedbackNote). The teaching branch
	// learns from them.
	Feedback       *string    `gorm:"type:text" json:"feedback"`
	FeedbackReason string     `gorm:"type:text;not null" json:"feedbackReason"`
	FeedbackNote   string     `gorm:"type:text;not null" json:"feedbackNote"`
	FeedbackAt     *time.Time `json:"feedbackAt"`
	// How AI saw it: AIState judged, unchecked (AIWhy says why) or
	// rejudged (a later verdict said it was not worth it), "" for a rules
	// Bot. AIInput keeps the judge's input only while a re-judge is
	// queued. Urgency is the judge's, or high for an urgent rules Bot.
	AIState string          `gorm:"column:ai_state;type:text;not null" json:"aiState"`
	AIWhy   string          `gorm:"column:ai_why;type:text;not null" json:"aiWhy"`
	AIInput json.RawMessage `gorm:"column:ai_input;type:jsonb" json:"-"`
	Urgency string          `gorm:"type:text;not null;default:normal" json:"urgency"`
	// One alert per thing: Things are what a sent alert told of, so another
	// Bot's alert on the same thing the same day joins it; AlsoSeenBy lists
	// the Bots that did. A held 'shared' alert names the one it joined.
	Things     jsonList[Thing]  `gorm:"type:jsonb;not null" json:"-"`
	AlsoSeenBy jsonList[BotRef] `gorm:"column:also_seen_by;type:jsonb;not null" json:"alsoSeenBy"`
	SharedWith *string          `gorm:"type:text" json:"sharedWith"`
	// Via is how a passed note came to this Bot: the Bots it went through,
	// from the start of the chain, each with the link it went on by.
	Via       jsonList[ViaStep] `gorm:"type:jsonb;not null" json:"via"`
	CreatedAt time.Time         `json:"createdAt"`
}

// ViaStep is one Bot a passed note went through ("How this came to you"):
// the Bot, the link it passed the note on by and the note's title there.
type ViaStep struct {
	BotID  string  `json:"botId"`
	Name   string  `json:"name"`
	LinkID *string `json:"linkId"`
	Title  string  `json:"title"`
}

// BotRef names a Bot.
type BotRef struct {
	BotID string `json:"botId"`
	Name  string `json:"name"`
}

// Thing is one product, ticker or link a sent alert told of: its key
// (thingKey*), the price it told of, if any, and the alert's urgency.
type Thing struct {
	Key     string   `json:"key"`
	Value   *float64 `json:"value,omitempty"`
	Urgency string   `json:"urgency"`
}

func (Alert) TableName() string { return "bot_alerts" }

// Finding is a typed note on the findings board (table bot_findings). It
// never holds raw page text.
type Finding struct {
	ID          string     `gorm:"type:text;primaryKey" json:"id"`
	BotID       string     `gorm:"type:text;not null" json:"botId"`
	UserID      string     `gorm:"type:text;not null" json:"-"`
	CheckID     *string    `gorm:"type:text" json:"checkId"`
	WatchID     *string    `gorm:"type:text" json:"watchId"`
	Kind        string     `gorm:"type:text;not null" json:"kind"` // change|price|item|status
	Title       string     `gorm:"type:text;not null" json:"title"`
	Why         string     `gorm:"type:text;not null" json:"why"`
	URL         string     `gorm:"column:url;type:text;not null" json:"url"`
	Price       *float64   `gorm:"type:numeric" json:"price"`
	Currency    string     `gorm:"type:text;not null" json:"currency"`
	ChangePct   *float64   `gorm:"type:numeric" json:"changePct"`
	Urgency     string     `gorm:"type:text;not null" json:"urgency"` // low|normal|high
	OutsideData bool       `gorm:"not null" json:"outsideData"`
	Alerted     bool       `gorm:"not null" json:"alerted"`
	DigestedAt  *time.Time `json:"digestedAt"`
	// ThingKey is the product, ticker or link the note is about (thingKey*).
	ThingKey string `gorm:"type:text;not null" json:"-"`
	// A note a passed check made names the chain it is part of, its step in
	// it (0 for a check of its own) and the note it was passed.
	ChainID         string    `gorm:"type:text;not null" json:"-"`
	Depth           int       `gorm:"not null" json:"-"`
	SourceFindingID *string   `gorm:"type:text" json:"-"`
	CreatedAt       time.Time `json:"createdAt"`
}

func (Finding) TableName() string { return "bot_findings" }

// PriceDay is one UTC day of a price watch's series (table bot_price_days).
// Points are [unix seconds, price] pairs.
type PriceDay struct {
	WatchID  string               `gorm:"type:text;primaryKey" json:"watchId"`
	Day      time.Time            `gorm:"type:date;primaryKey" json:"day"`
	BotID    string               `gorm:"type:text;not null" json:"botId"`
	UserID   string               `gorm:"type:text;not null" json:"-"`
	Currency string               `gorm:"type:text;not null" json:"currency"`
	Points   jsonList[[2]float64] `gorm:"type:jsonb;not null" json:"points"`
	Open     *float64             `gorm:"type:numeric" json:"open"`
	High     *float64             `gorm:"type:numeric" json:"high"`
	Low      *float64             `gorm:"type:numeric" json:"low"`
	Close    *float64             `gorm:"type:numeric" json:"close"`
}

func (PriceDay) TableName() string { return "bot_price_days" }

// Lesson is something the person taught a Bot (table bot_lessons): one per
// rated alert, written by code from the alert's rules-made words and the
// person's note (lessonText), the newest MaxLessons kept.
type Lesson struct {
	ID        string    `gorm:"type:text;primaryKey" json:"id"`
	BotID     string    `gorm:"type:text;not null" json:"botId"`
	UserID    string    `gorm:"type:text;not null" json:"-"`
	AlertID   *string   `gorm:"type:text" json:"alertId"`
	Text      string    `gorm:"type:text;not null" json:"text"`
	CreatedAt time.Time `json:"createdAt"`
}

func (Lesson) TableName() string { return "bot_lessons" }

// Link passes what one Bot finds to another (table bot_links, kind pass):
// a note holding one of Filter's words, or any note when it has none,
// starts a check by ToBotID. OffReason is "person" while switched off.
type Link struct {
	ID        string           `gorm:"type:text;primaryKey" json:"id"`
	UserID    string           `gorm:"type:text;not null" json:"-"`
	Kind      string           `gorm:"type:text;not null" json:"kind"`
	FromBotID string           `gorm:"type:text;not null" json:"fromBotId"`
	ToBotID   string           `gorm:"type:text;not null" json:"toBotId"`
	Filter    jsonList[string] `gorm:"type:jsonb;not null" json:"filter"`
	Enabled   bool             `gorm:"not null" json:"enabled"`
	OffReason string           `gorm:"type:text;not null" json:"offReason"`
	CreatedAt time.Time        `json:"createdAt"`
	UpdatedAt time.Time        `json:"updatedAt"`
}

func (Link) TableName() string { return "bot_links" }

// Pass is one note a link took (table bot_passes), and what became of it:
// pending until the next Bot checks it, then alerted, quiet or failed; or
// folded (too old, or its Bot, link or note gone), overflow (past a limit)
// or repeat (the same thing went to the same Bot in the last 7 days). It
// has no foreign key to bots, links or findings, so deleting a Bot or a
// restore resets no count.
type Pass struct {
	ID        string    `gorm:"type:text;primaryKey"`
	UserID    string    `gorm:"type:text;not null"`
	LinkID    *string   `gorm:"type:text"`
	FromBotID string    `gorm:"type:text;not null"`
	ToBotID   string    `gorm:"type:text;not null"`
	FindingID *string   `gorm:"type:text"`
	ThingKey  string    `gorm:"type:text;not null"`
	ChainID   string    `gorm:"type:text;not null"`
	Depth     int       `gorm:"not null"`
	LocalDay  time.Time `gorm:"type:date;not null"`
	State     string    `gorm:"type:text;not null"`
	CheckID   *string   `gorm:"type:text"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (Pass) TableName() string { return "bot_passes" }

// Models lists the account tables, for tests and tools that walk them.
var Models = []any{&Bot{}, &Watch{}, &Check{}, &Alert{}, &Finding{}, &PriceDay{}, &Lesson{}, &Link{}}

// jsonList is a NOT NULL jsonb array column: nil is stored as [].
type jsonList[T any] []T

func (l jsonList[T]) Value() (driver.Value, error) {
	if l == nil {
		return "[]", nil
	}
	b, err := json.Marshal([]T(l))
	return string(b), err
}

func (l *jsonList[T]) Scan(src any) error { return scanJSON(src, (*[]T)(l)) }

// jsonMap is a NOT NULL jsonb object column: nil is stored as {}.
type jsonMap[K comparable, V any] map[K]V

func (m jsonMap[K, V]) Value() (driver.Value, error) {
	if m == nil {
		return "{}", nil
	}
	b, err := json.Marshal(map[K]V(m))
	return string(b), err
}

func (m *jsonMap[K, V]) Scan(src any) error { return scanJSON(src, (*map[K]V)(m)) }

func scanJSON(src, dst any) error {
	switch v := src.(type) {
	case nil:
		return nil
	case string:
		return json.Unmarshal([]byte(v), dst)
	case []byte:
		return json.Unmarshal(v, dst)
	}
	return fmt.Errorf("bots: cannot read %T as json", src)
}
