package models

import (
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

// Embedding is one chunk of a user-owned record, stored for semantic search.
type Embedding struct {
	ID          string `gorm:"type:text;primaryKey" json:"id"`
	UserID      string `gorm:"type:text;not null" json:"userId"`
	EntityKind  string `gorm:"type:text;not null" json:"entityKind"`
	EntityID    string `gorm:"type:text;not null" json:"entityId"`
	ChunkIndex  int    `gorm:"not null;default:0" json:"chunkIndex"`
	Title       string `gorm:"type:text;not null;default:''" json:"title"`
	Content     string `gorm:"type:text;not null" json:"content"`
	Embedding   Vector `gorm:"type:real[]" json:"-"`
	ContentHash string `gorm:"type:text;not null" json:"contentHash"`
	Model       string `gorm:"type:text;not null" json:"model"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

func (e *Embedding) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTimestamp()
	if e.CreatedAt == "" {
		e.CreatedAt = now
	}
	e.UpdatedAt = now
	return nil
}

func (e *Embedding) BeforeUpdate(tx *gorm.DB) error {
	e.UpdatedAt = utils.GetCurrentTimestamp()
	return nil
}
