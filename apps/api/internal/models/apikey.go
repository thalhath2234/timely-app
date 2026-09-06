package models

import (
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

// ApiKey is a personal token Hermes (or any MCP client) presents as a Bearer
// token. The raw key is shown once at creation; only a SHA-256 hash is stored.
type ApiKey struct {
	ID         string  `gorm:"type:text;primaryKey" json:"id"`
	UserID     string  `gorm:"type:text;not null;index" json:"userId"`
	Name       string  `gorm:"not null" json:"name"`
	Prefix     string  `gorm:"not null" json:"prefix"`
	Hash       string  `gorm:"type:text;not null;uniqueIndex" json:"-"`
	LastUsedAt *string `json:"lastUsedAt"`
	RevokedAt  *string `json:"revokedAt"`
	CreatedAt  string  `json:"createdAt"`

	User *User `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
}

func (k *ApiKey) BeforeCreate(tx *gorm.DB) error {
	if k.CreatedAt == "" {
		k.CreatedAt = utils.GetCurrentTimestamp()
	}
	return nil
}

func (ApiKey) TableName() string {
	return "api_keys"
}
