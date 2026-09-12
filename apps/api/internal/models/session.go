package models

type UserSession struct {
	ID               string  `gorm:"type:text;primaryKey" json:"id"`
	UserID           string  `gorm:"type:text;not null;index" json:"userId"`
	RefreshTokenHash string  `gorm:"type:text;not null;uniqueIndex" json:"-"`
	DeviceLabel      string  `gorm:"type:text;not null;default:''" json:"deviceLabel"`
	CreatedAt        string  `json:"createdAt"`
	LastUsedAt       string  `json:"lastUsedAt"`
	ExpiresAt        string  `json:"expiresAt"`
	RevokedAt        *string `json:"revokedAt,omitempty"`

	User *User `gorm:"constraint:OnUpdate:CASCADE,OnDelete:CASCADE;" json:"-"`
}

func (UserSession) TableName() string {
	return "user_sessions"
}

func (s UserSession) IsRevoked() bool {
	return s.RevokedAt != nil && *s.RevokedAt != ""
}
