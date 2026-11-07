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
	LastCheckAt     *time.Time `json:"lastCheckAt"`
	LastOkAt        *time.Time `json:"lastOkAt"`
	Strikes         int        `gorm:"not null" json:"strikes"`
	OfflineSince    *time.Time `json:"offlineSince"`
	Health          string     `gorm:"type:text;not null" json:"health"`
	HealthDetail    string     `gorm:"type:text;not null" json:"healthDetail"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

func (Bot) TableName() string { return "bots" }

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
}

// FiredRule names one rule that fired in a check.
type FiredRule struct {
	WatchID string `json:"watchId"`
	RuleID  string `json:"ruleId"`
	Kind    string `json:"kind"`
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
	AlertID    *string              `gorm:"type:text" json:"alertId"`
	CreatedAt  time.Time            `json:"createdAt"`
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
	Kind           string               `gorm:"type:text;not null" json:"kind"` // alert|more|paused
	Held           string               `gorm:"type:text;not null" json:"held"` // ""|snoozed|cap
	LocalDay       time.Time            `gorm:"type:date;not null" json:"-"`
	Title          string               `gorm:"type:text;not null" json:"title"`
	Body           string               `gorm:"type:text;not null" json:"body"`
	URL            string               `gorm:"column:url;type:text;not null" json:"url"`
	Figures        jsonMap[string, any] `gorm:"type:jsonb;not null" json:"figures"`
	Urgent         bool                 `gorm:"not null" json:"urgent"`
	MoreCount      int                  `gorm:"not null" json:"moreCount"`
	CreatedAt      time.Time            `json:"createdAt"`
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
	CreatedAt   time.Time  `json:"createdAt"`
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

// Lesson is something the person taught a Bot (table bot_lessons). It is
// written from the teaching branch; the table is here so backups carry it.
type Lesson struct {
	ID        string    `gorm:"type:text;primaryKey" json:"id"`
	BotID     string    `gorm:"type:text;not null" json:"botId"`
	UserID    string    `gorm:"type:text;not null" json:"-"`
	AlertID   *string   `gorm:"type:text" json:"alertId"`
	Text      string    `gorm:"type:text;not null" json:"text"`
	CreatedAt time.Time `json:"createdAt"`
}

func (Lesson) TableName() string { return "bot_lessons" }

// Models lists the account tables, for tests and tools that walk them.
var Models = []any{&Bot{}, &Watch{}, &Check{}, &Alert{}, &Finding{}, &PriceDay{}, &Lesson{}}

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
