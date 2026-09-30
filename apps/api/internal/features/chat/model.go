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
type Message struct {
	Receipt   *ReceiptDraft `json:"receipt,omitempty"`
	ID        string        `json:"id"`
	Role      string        `json:"role"`
	Content   string        `json:"content"`
	CreatedAt time.Time     `json:"createdAt"`
	Steps     []Step        `json:"steps,omitempty"`
	ImageIDs  []string      `json:"imageIds,omitempty"`
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
type Conversation struct {
	Images      []ImageAttachment `gorm:"-" json:"images,omitempty"`
	Sensitive   bool              `json:"sensitive"`
	ImageReview *ImageReview      `gorm:"serializer:json;type:jsonb" json:"imageReview,omitempty"`
	ForceReview bool              `json:"-"`
	ID          string            `gorm:"primaryKey" json:"id"`
	UserID      string            `json:"-"`
	Title       string            `json:"title"`
	Status      string            `json:"status"`
	Phase       string            `json:"phase"`
	WebSearch   bool              `json:"webSearch"`
	Context     []ContextChip     `gorm:"serializer:json;type:jsonb" json:"context"`
	Messages    []Message         `gorm:"serializer:json;type:jsonb" json:"messages"`
	Plan        []Step            `gorm:"serializer:json;type:jsonb" json:"plan"`
	Snapshots   []Snapshot        `gorm:"serializer:json;type:jsonb" json:"-"`
	Transcript  []WireMessage     `gorm:"serializer:json;type:jsonb" json:"-"`
	Revision    int               `json:"revision"`
	Unread      bool              `json:"unread"`
	Error       string            `json:"error"`
	Lease       string            `json:"-"`
	LeaseUntil  *time.Time        `json:"-"`
	CreatedAt   time.Time         `json:"createdAt"`
	UpdatedAt   time.Time         `json:"updatedAt"`
}

func (Conversation) TableName() string { return "agent_conversations" }
