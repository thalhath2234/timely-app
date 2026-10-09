package chat

import (
	"encoding/json"
	"time"
)

type ContextChip struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
	Value string `json:"value"`
}

// Message kinds: "" is a normal turn, "notice" is a run event (stopped, done,
// data changed), "archive" carries a superseded or discarded plan and
// "similar" points at an earlier chat (Chat) about the same request.
type Message struct {
	Kind      string        `json:"kind,omitempty"`
	RequestID string        `json:"requestId,omitempty"`
	Receipt   *ReceiptDraft `json:"receipt,omitempty"`
	ID        string        `json:"id"`
	Role      string        `json:"role"`
	Content   string        `json:"content"`
	CreatedAt time.Time     `json:"createdAt"`
	Steps     []Step        `json:"steps,omitempty"`
	ImageIDs  []string      `json:"imageIds,omitempty"`
	// Proposal marks a proposal summary. Remaining is what a batched proposal
	// leaves for the next batch; Timely continues automatically once the batch
	// is applied, and Continue carries that remainder on the notice it adds.
	Proposal  bool   `json:"proposal,omitempty"`
	Remaining string `json:"remaining,omitempty"`
	Continue  string `json:"continue,omitempty"`
	// Notes are a proposal's review notes from Jev (see jev.go).
	Notes []string `json:"notes,omitempty"`
	Chat  *ChatRef `json:"chat,omitempty"`
}
type Step struct {
	Tool      string          `json:"tool"`
	Summary   string          `json:"summary"`
	Arguments json.RawMessage `json:"arguments"`
	Result    json.RawMessage `json:"result,omitempty"`
	Status    string          `json:"status"`
	Error     string          `json:"error,omitempty"`
	Before    json.RawMessage `json:"before,omitempty"`
}
type Snapshot struct {
	Tool      string          `json:"tool"`
	Arguments json.RawMessage `json:"arguments"`
	Hash      string          `json:"hash"`
}

// Provider and Model are fixed when a run is claimed, so a run finishes on the
// provider it started with even if the account's default changes meanwhile.
// ChosenProvider and ChosenModel are the model picked for this conversation in
// the chat menu; empty follows the account default.
type Conversation struct {
	Images         []ImageAttachment `gorm:"-" json:"images,omitempty"`
	Sensitive      bool              `json:"sensitive"`
	ImageReview    *ImageReview      `gorm:"serializer:json;type:jsonb" json:"imageReview,omitempty"`
	ForceReview    bool              `json:"-"`
	ID             string            `gorm:"primaryKey" json:"id"`
	UserID         string            `json:"-"`
	Title          string            `json:"title"`
	Status         string            `json:"status"`
	Phase          string            `json:"phase"`
	WebSearch      bool              `json:"webSearch"`
	Timezone       string            `json:"timezone"` // device IANA zone from the latest message
	Language       string            `json:"language"` // see i18n.go; empty means English`
	Provider       string            `json:"provider"`
	Model          string            `json:"model"`
	ChosenProvider string            `json:"chosenProvider"`
	ChosenModel    string            `json:"chosenModel"`
	Context        []ContextChip     `gorm:"serializer:json;type:jsonb" json:"context"`
	Messages       []Message         `gorm:"serializer:json;type:jsonb" json:"messages"`
	Plan           []Step            `gorm:"serializer:json;type:jsonb" json:"plan"`
	Snapshots      []Snapshot        `gorm:"serializer:json;type:jsonb" json:"-"`
	Transcript     []WireMessage     `gorm:"serializer:json;type:jsonb" json:"-"`
	Revision       int               `json:"revision"`
	Unread         bool              `json:"unread"`
	Error          string            `json:"error"`
	Lease          string            `json:"-"`
	LeaseUntil     *time.Time        `json:"-"`
	CreatedAt      time.Time         `json:"createdAt"`
	UpdatedAt      time.Time         `json:"updatedAt"`
}

func (Conversation) TableName() string { return "agent_conversations" }
