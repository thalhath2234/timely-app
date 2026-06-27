package models

import (
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

type User struct {
	ID        string `gorm:"type:text;primaryKey" json:"id"`
	Email     string `gorm:"uniqueIndex;not null" json:"email"`
	Password  string `gorm:"not null" json:"-"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

func (u *User) BeforeCreate(tx *gorm.DB) error {
	now := utils.GetCurrentTime()
	if u.CreatedAt == "" {
		u.CreatedAt = now
	}
	u.UpdatedAt = now
	return nil
}

func (u *User) BeforeUpdate(tx *gorm.DB) error {
	u.UpdatedAt = utils.GetCurrentTime()
	return nil
}
