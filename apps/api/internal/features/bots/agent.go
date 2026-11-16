package bots

import (
	"context"
	"encoding/json"
	"time"
)

// Agent runs one tick of an agent Bot (engine 'agent') on the New engine.
// The tick (phase 6) builds a RunInput from the Bot and what Go already
// fetched, calls Run and records the result; the bridge to the agent worker
// implements it. Tests use a fake.
type Agent interface {
	// Run runs the Bot's prompt once and waits for it to end or for
	// in.Deadline. A run that fails still returns an AgentResult whose
	// ErrorClass says how; err is for what stops Run being asked at all
	// (no worker, a cancelled ctx).
	Run(ctx context.Context, userID string, in RunInput) (AgentResult, error)
	// BrowserBusy reports whether one of the person's chats holds the
	// browser (Q-B2: a chat holding it wins). A Check that needs the browser
	// while it is true is skipped and recorded as "browser busy".
	BrowserBusy(userID string) bool
}

// ThreadPoster writes a Bot's alert into its Bot thread as well as notifying
// (Q-B6). The thread task implements it; the tick calls it after the alert
// row is saved.
type ThreadPoster interface {
	// PostAlert posts the alert alertID, raised by Bot botID, into that
	// Bot's thread. It makes the thread first when the Bot has none.
	PostAlert(ctx context.Context, userID, botID, alertID string) error
}

// RunInput is everything one tick hands the agent. A field the Bot does not
// use is left empty.
type RunInput struct {
	// Bot is the Bot being run.
	Bot Bot
	// Prompt is what the agent is asked: the Bot's own prompt, with the
	// tick's context already added by the caller.
	Prompt string
	// Lessons are what the person taught the Bot, newest first.
	Lessons []string
	// Notes are the Bot's own notes (bot_notes), by key.
	Notes map[string]string
	// LastAlert is the Bot's latest alert, so the run can avoid repeating
	// it; nil before the first.
	LastAlert *Alert
	// Diff is what changed in the Bot's Watches since the last tick, when
	// Go fetched them first (gate 'changed'); empty for a Bot with no Reads.
	Diff []ReadingDiff
	// Readings are the Watches' current readings, by watch id.
	Readings map[string]Reading
	// Passed are the notes other Bots passed to this one on a link.
	Passed []Finding
	// Knowledge is the text of the doc or sheet the Bot's knowledge names,
	// "" for none.
	Knowledge string
	// Skills are the skill names the run may load.
	Skills []string
	// Tools is the Bot's reach: browser sites, egress, memory, MCP modes.
	Tools AgentTools
	// Permission is the Bot's mode: supervised, auto or full.
	Permission string
	// UseMemory turns memory and About you on for this run (Q-B10); off
	// means skip_memory.
	UseMemory bool
	// Model picks the model; the zero value follows the account default.
	Model ModelChoice
	// Deadline is when the run must be over: 5 minutes of wall clock from
	// its start.
	Deadline time.Time
	// CheckID is the Check this tick writes; it is the run's idempotency
	// key, so the same tick is never run twice.
	CheckID string
	// DryRun runs without effects: nothing is written, no alert is made.
	// The Bot thread's "try it" and the preview use it.
	DryRun bool
}

// ModelChoice is a provider and a model name; both empty follows the
// account's default AI provider.
type ModelChoice struct {
	// Provider is the AI provider id.
	Provider string `json:"provider"`
	// Model is the provider's model name.
	Model string `json:"model"`
}

// ReadingDiff is what changed in one Watch between two ticks.
type ReadingDiff struct {
	// WatchID is the Watch that changed.
	WatchID string `json:"watchId"`
	// Kind is what moved: content, price or availability.
	Kind string `json:"kind"`
	// Before is the earlier value, as a short line.
	Before string `json:"before"`
	// After is the new value, as a short line.
	After string `json:"after"`
}

// AgentResult is how one tick's run ended (named so it does not clash with
// RunResult, Run now's answer in service.go).
type AgentResult struct {
	// Response is the agent's final text.
	Response string
	// Silent is true when the agent ended with nothing to say: no alert.
	Silent bool
	// Reports are the things the agent chose to tell the person, one alert
	// each (after the cap and duplicate checks).
	Reports []Report
	// Usage is what the run spent.
	Usage Usage
	// Trace is the run's tool calls, in order.
	Trace []ToolTrace
	// ErrorClass is "" for a run that finished, else one of the Class*
	// constants.
	ErrorClass string
	// Model is the model that actually ran: the Bot's own, or the account
	// default it followed. Zero when unknown (the run never reached a model).
	Model ModelChoice
	// RetryAfter is how long the provider asked Timely to wait when the run
	// ended ClassRateLimited (a 429's Retry-After). Zero when it said nothing;
	// the tick then holds the next check for rateHold. Ignored for any other
	// class.
	RetryAfter time.Duration
}

// Report is one thing a run tells the person.
type Report struct {
	// Title is the alert's headline.
	Title string `json:"title"`
	// Body is the alert's text.
	Body string `json:"body"`
	// URL is the page the alert is about, "" for none.
	URL string `json:"url,omitempty"`
	// Price is the price it tells of, nil for none.
	Price *float64 `json:"price,omitempty"`
	// Symbol is the ticker or currency it tells of, "" for none.
	Symbol string `json:"symbol,omitempty"`
	// Urgency is low, normal or high.
	Urgency string `json:"urgency,omitempty"`
	// Proposal is a Timely write the run proposes, stored on the alert as a
	// Review card; nothing applies until the person approves it (Q-B5). Nil
	// for none.
	Proposal json.RawMessage `json:"proposal,omitempty"`
}

// Usage is a run's spend.
type Usage struct {
	// InputTokens is the prompt tokens the run used.
	InputTokens int `json:"inputTokens"`
	// OutputTokens is the completion tokens the run used.
	OutputTokens int `json:"outputTokens"`
	// Calls is the model calls the run made.
	Calls int `json:"calls"`
}

// ToolTrace is one tool call a run made.
type ToolTrace struct {
	// Tool is the tool's name.
	Tool string `json:"tool"`
	// Summary is a short line of what it did; it never holds page text.
	Summary string `json:"summary"`
	// Outcome is ok, parked (waiting in Needs you), refused or error.
	Outcome string `json:"outcome"`
	// Host is the host the call reached, "" for none.
	Host string `json:"host,omitempty"`
	// MS is how long the call took.
	MS int64 `json:"ms"`
}

// RunRecord is a tick's own record, kept on its Check (bot_checks.run): what
// the run said and did, without the readings.
type RunRecord struct {
	// Response is the agent's final text.
	Response string `json:"response"`
	// Silent is true when the agent ended with nothing to say.
	Silent bool `json:"silent"`
	// Reports is how many alerts the run asked for.
	Reports int `json:"reports"`
	// Trace is the run's tool calls.
	Trace []ToolTrace `json:"trace"`
	// Usage is what the run spent.
	Usage Usage `json:"usage"`
	// ErrorClass is "" or one of the Class* constants.
	ErrorClass string `json:"errorClass,omitempty"`
	// Model is the model that ran it.
	Model ModelChoice `json:"model"`
}

// The classes a failed run ends in (AgentResult.ErrorClass).
const (
	// ClassUnreachable: the model's provider could not be reached.
	ClassUnreachable = "unreachable"
	// ClassRateLimited: the provider refused for rate limits.
	ClassRateLimited = "rate_limited"
	// ClassTimeout: the 5-minute deadline or 120 s of inactivity passed.
	ClassTimeout = "timeout"
	// ClassCrash: the agent worker died mid-run.
	ClassCrash = "crash"
	// ClassCronFailure: the run failed the way a Hermes cron job fails.
	ClassCronFailure = "cron_failure"
	// ClassInjection: the run was stopped for obeying text from a page.
	ClassInjection = "injection"
	// ClassBrowserBusy: a chat took the browser during the tick, so the
	// Bot's next browser call was refused.
	ClassBrowserBusy = "browser_busy"
	// ClassStopped: the person paused or deleted the Bot (or turned on Pause
	// all) and Go stopped its tick. Not a failure: no strike, no health change.
	ClassStopped = "stopped"
)

// Why a tick did not run (bot_checks.skip_reason); "" when it ran.
const (
	// SkipBrowserBusy: a chat held the browser the Check needed.
	SkipBrowserBusy = "browser_busy"
	// SkipNoAI: no AI provider, or an outage; the readings are recorded and
	// no alert is sent (Q-B3).
	SkipNoAI = "no_ai"
	// SkipUnchanged: the changed gate found nothing new to wake the agent.
	SkipUnchanged = "unchanged"
	// SkipDuplicate: the alert's fingerprint was already sent in the last 7
	// days.
	SkipDuplicate = "duplicate"
)

// The states of an alert's proposal (bot_alerts.proposal_state); "" is none.
const (
	// ProposalPending: the Review card waits for the person.
	ProposalPending = "pending"
	// ProposalApproved: the person approved it; the apply has not finished.
	ProposalApproved = "approved"
	// ProposalApplied: chat's model-free apply wrote it, with a receipt.
	ProposalApplied = "applied"
	// ProposalDismissed: the person turned it down.
	ProposalDismissed = "dismissed"
	// ProposalUndone: the person undid it after it applied.
	ProposalUndone = "undone"
	// ProposalFailed: the apply did not go through.
	ProposalFailed = "failed"
)

// Check outcomes an agent tick ends in (bot_checks.outcome), besides the
// rules engine's in check.go.
const (
	// outSilent: the run ran and had nothing to tell.
	outSilent = "silent"
	// outAlerted: the run ran and an alert was made.
	outAlerted = "alerted"
	// outSkipped: the tick did not run; skip_reason says why.
	outSkipped = "skipped"
	// outFailed: the run ended in an error class.
	outFailed = "failed"
	// outBrowserBusy: the browser was held by a chat.
	outBrowserBusy = "browser_busy"
	// outNoAI: no AI provider or an outage; readings recorded, no alert.
	outNoAI = "no_ai"
	// outDuplicate: the alert repeated one sent in the last 7 days.
	outDuplicate = "duplicate"
)
