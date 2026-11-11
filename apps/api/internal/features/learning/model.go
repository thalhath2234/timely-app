package learning

import (
	"encoding/json"
	"time"
)

// Event statuses. A worker reports applied, staged or blocked; the person
// moves an applied (or kept) event to undone, and a staged one to kept or
// discarded.
const (
	StatusApplied   = "applied"
	StatusStaged    = "staged"
	StatusBlocked   = "blocked"
	StatusUndone    = "undone"
	StatusKept      = "kept"
	StatusDiscarded = "discarded"
)

// Event kinds: a skill, Notes (MEMORY.md) or About you (USER.md).
const (
	KindSkill  = "skill"
	KindMemory = "memory"
	KindUser   = "user"
)

// maxText caps before and after, as the worker does (PROTOCOL.md section 10).
const maxText = 20000

// Event is one row of agent_learning_events: something the account's agent
// learned (or was stopped from learning), and what the person did with it.
// Its JSON is the wire LearningEvent (packages/contract/src/agentLearning.ts).
type Event struct {
	ID             string          `gorm:"primaryKey" json:"id"`
	UserID         string          `gorm:"not null;uniqueIndex:agent_learning_events_user_worker_key,priority:1;index:agent_learning_events_user_conversation_idx,priority:1" json:"-"`
	WorkerEventID  string          `gorm:"not null;uniqueIndex:agent_learning_events_user_worker_key,priority:2" json:"-"`
	Kind           string          `gorm:"not null" json:"kind"`
	Action         string          `gorm:"not null;default:''" json:"action"`
	Subject        string          `gorm:"not null;default:''" json:"subject"`
	Before         string          `gorm:"not null;default:''" json:"before"`
	After          string          `gorm:"not null;default:''" json:"after"`
	Origin         string          `gorm:"not null;default:''" json:"origin"`
	ConversationID string          `gorm:"not null;default:'';index:agent_learning_events_user_conversation_idx,priority:2" json:"conversationId"`
	RunID          string          `gorm:"not null;default:''" json:"runId"`
	BotID          string          `gorm:"not null;default:''" json:"botId"`
	TaintedSources json.RawMessage `gorm:"serializer:json;type:jsonb;not null;default:'[]'" json:"taintedSources"`
	Status         string          `gorm:"not null" json:"status"`
	LedgerEntryID  string          `gorm:"not null;default:''" json:"ledgerEntryId"`
	PendingID      string          `gorm:"not null;default:''" json:"pendingId"`
	Summary        string          `gorm:"not null;default:''" json:"summary"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

func (Event) TableName() string { return "agent_learning_events" }

// Settings is one row of agent_learning_settings. A missing row reads as the
// defaults (learning and past-chat search on, nothing copied or disabled).
// Rows are written with SQL, never gorm's Create, so a false switch is never
// swapped for the column default.
type Settings struct {
	UserID          string     `gorm:"primaryKey"`
	Learning        bool       `gorm:"not null;default:true"`
	SearchHistory   bool       `gorm:"not null;default:true"`
	UseCaseCopiedAt *time.Time `gorm:"column:use_case_copied_at"`
	SkillsDisabled  []string   `gorm:"serializer:json;type:jsonb;not null;default:'[]'"`
	SkillsRestored  []string   `gorm:"serializer:json;type:jsonb;not null;default:'[]'"`
	SkillsEnabled   []string   `gorm:"serializer:json;type:jsonb;not null;default:'[]'"`
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

func (Settings) TableName() string { return "agent_learning_settings" }

// Prefs is what the chat engine needs from an account's learning settings
// (go-chat-web's WorkerEngineOptions.Learning, go-backup's render).
type Prefs struct {
	Learning      bool
	SearchHistory bool
	// SkillsDisabled are the skills the person turned off, and the ones a
	// restore brought back until the person turns them on.
	SkillsDisabled []string
	// SkillsEnabled are the skills the person turned on: a reviewed bundled
	// skill that is off by default loads only when listed here (the
	// worker's settings.skills_enabled).
	SkillsEnabled []string
}

// settingsJSON is GET/PATCH /agent/learning/settings.
type settingsJSON struct {
	Learning      bool `json:"learning"`
	SearchHistory bool `json:"searchHistory"`
	UseCaseCopied bool `json:"useCaseCopied"`
}

// wireEvent is a worker's "learning" message event (PROTOCOL.md section 10).
// Unknown fields are ignored.
type wireEvent struct {
	ID             string          `json:"id"`
	Kind           string          `json:"kind"`
	Action         string          `json:"action"`
	Subject        string          `json:"subject"`
	Before         string          `json:"before"`
	After          string          `json:"after"`
	Origin         string          `json:"origin"`
	ConversationID string          `json:"conversation_id"`
	RunID          string          `json:"run_id"`
	BotID          string          `json:"bot_id"`
	TaintedSources json.RawMessage `json:"tainted_sources"`
	Status         string          `json:"status"`
	LedgerEntryID  string          `json:"ledger_entry_id"`
	PendingID      string          `json:"pending_id"`
	Summary        string          `json:"summary"`
}
