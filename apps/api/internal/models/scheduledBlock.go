package models

import (
	"time"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

const (
	BlockSourceManual = "manual"
	BlockSourceEngine = "engine"
)

// ScheduledBlock is one interval of calendar time reserved for Work or an Event.
// A task split into chunks owns several blocks. Manual blocks are pinned by the
// person; engine blocks are rebuilt whenever Auto-schedule runs. Event blocks
// are always Manual. Placement is the only writer.
type ScheduledBlock struct {
	ID      string  `gorm:"type:text;primaryKey" json:"id"`
	TaskID  string  `gorm:"type:text" json:"taskId"`
	EventID *string `gorm:"type:text" json:"eventId,omitempty"`
	UserID  string  `gorm:"type:text;not null" json:"userId"`

	StartAt         time.Time  `gorm:"type:timestamptz;not null" json:"start"`
	EndAt           time.Time  `gorm:"type:timestamptz;not null" json:"end"`
	Source          string     `gorm:"type:text;not null;default:'manual'" json:"source"`
	ChunkIndex      int        `gorm:"not null;default:0" json:"chunkIndex"`
	Locked          bool       `gorm:"not null;default:false" json:"locked"`
	OccurrenceStart *time.Time `gorm:"type:timestamptz" json:"occurrenceStart,omitempty"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

func (b *ScheduledBlock) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTimestamp()
	if b.CreatedAt == "" {
		b.CreatedAt = now
	}
	b.UpdatedAt = now
	return nil
}

func (b *ScheduledBlock) BeforeUpdate(tx *gorm.DB) error {
	b.UpdatedAt = utils.GetCurrentTimestamp()
	return nil
}
