// Package bots watches pages, feeds and prices for the person and alerts
// them when a rule they set comes true (ADR 0021). Rules and the schedule
// are pure; the fetcher, extractors and price sources live in the fetch,
// extract and price subpackages.
package bots

import (
	"errors"
	"fmt"
	"time"
)

const (
	MaxBots           = 25
	MaxWatches        = 5
	MaxRulesPerWatch  = 5
	MaxNameLen        = 80
	MaxDescriptionLen = 2000
	MaxURLLen         = 2048
	MaxWords          = 10
	MaxWordLen        = 100
	MaxReadingBytes   = 64 << 10
	MaxStrikes        = 5
	AlertsPerDay      = 3
	// MaxLessons caps what a Bot is taught. The teaching branch enforces it
	// when it writes lessons; the clients show it.
	MaxLessons = 20
	// MaxFeedbackNote bounds the free line under Not useful, in characters.
	MaxFeedbackNote = 200
	// MaxItems and MaxSeen cap a feed reading: the newest items it keeps,
	// and the newest item IDs it remembers so they never alert again.
	MaxItems = 50
	MaxSeen  = 500

	MinPageEvery    = 15 * time.Minute
	MinPriceEvery   = 5 * time.Minute
	MinProductEvery = 6 * time.Hour

	Slots          = 4
	CheckBudget    = 3 * time.Minute
	ProvisionalMax = 10 * time.Minute
	// FenceSlack is how early a check may start against its due time or the
	// floor since the last one.
	FenceSlack = 30 * time.Second
	LateAfter  = 10 * time.Minute
	AwayAfter  = 30 * time.Minute
	WakeSettle = 30 * time.Second
	WakeSpread = 3 * time.Minute

	LogDays       = 30
	LogMax        = 500
	FindingDays   = 30
	AlertKeepDays = 365
	PriceKeepDays = 366
	SiteKeepDays  = 30
)

// Watch kinds and page read modes, as stored in bot_watches.
const (
	WatchPage  = "page"
	WatchFeed  = "feed"
	WatchPrice = "price"

	ReadText         = "text"
	ReadSelector     = "selector"
	ReadProductPrice = "product_price"
)

// Origin is where a Bot was made or changed from. Bots made over MCP start
// paused, and MCP can never turn one on (ADR 0021).
type Origin string

const (
	OriginApp  Origin = "app"
	OriginChat Origin = "chat"
	OriginMCP  Origin = "mcp"
)

// Bot statuses and pause reasons.
const (
	StatusActive = "active"
	StatusPaused = "paused"

	PausePerson  = "person"
	PauseStrikes = "strikes"
	PauseMCP     = "mcp"

	JudgeRules = "rules"
	HealthNew  = "new"
)

var (
	ErrNotFound       = errors.New("not found")
	ErrAlertNotFound  = errors.New("alert not found")
	ErrLessonNotFound = errors.New("lesson not found")
	ErrPaused         = errors.New("This bot is paused. Turn it on in Timely first.")
)

// InputError is a request the person can fix; its text is shown as is.
type InputError struct{ Message string }

func (e *InputError) Error() string { return e.Message }

func invalid(format string, args ...any) error {
	return &InputError{Message: fmt.Sprintf(format, args...)}
}
