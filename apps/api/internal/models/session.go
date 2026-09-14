package models

type UserSession struct {
	ID               string `gorm:"type:text;primaryKey" json:"id"`
	UserID           string `gorm:"type:text;not null;index" json:"userId"`
	RefreshTokenHash string `gorm:"type:text;not null;uniqueIndex" json:"-"`
	DeviceLabel      string `gorm:"type:text;not null;default:''" json:"deviceLabel"`
	CreatedAt        string `json:"createdAt"`
	LastUsedAt       string `json:"lastUsedAt"`
	ExpiresAt        string `json:"expiresAt"`

	User *User `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
}

func (UserSession) TableName() string {
	return "user_sessions"
}
