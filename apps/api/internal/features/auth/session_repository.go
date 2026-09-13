package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"time"
	"timely-api/internal/models"

	"gorm.io/gorm"
)

type SessionRepository interface {
	Create(session *models.UserSession) error
	GetByID(id string) (*models.UserSession, error)
	GetByRefreshHash(hash string) (*models.UserSession, error)
	ListByUser(userID string) ([]models.UserSession, error)
	Touch(id string, lastUsedAt string) error
	Update(session *models.UserSession) error
	Revoke(id string, revokedAt string) error
	RevokeOthers(userID, keepID, revokedAt string) (int64, error)
}

type sessionRepository struct {
	db *gorm.DB
}

func NewSessionRepository(db *gorm.DB) SessionRepository {
	return &sessionRepository{db: db}
}

func (r *sessionRepository) Create(session *models.UserSession) error {
	return r.db.Create(session).Error
}

func (r *sessionRepository) GetByID(id string) (*models.UserSession, error) {
	var session models.UserSession
	if err := r.db.Where("id = ?", id).First(&session).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *sessionRepository) GetByRefreshHash(hash string) (*models.UserSession, error) {
	var session models.UserSession
	if err := r.db.Where("refresh_token_hash = ?", hash).First(&session).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *sessionRepository) ListByUser(userID string) ([]models.UserSession, error) {
	var sessions []models.UserSession
	err := r.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&sessions).Error
	return sessions, err
}

func (r *sessionRepository) Touch(id string, lastUsedAt string) error {
	return r.db.Model(&models.UserSession{}).Where("id = ?", id).Update("last_used_at", lastUsedAt).Error
}

func (r *sessionRepository) Update(session *models.UserSession) error {
	return r.db.Model(&models.UserSession{}).Where("id = ?", session.ID).Updates(map[string]any{
		"refresh_token_hash": session.RefreshTokenHash,
		"last_used_at":       session.LastUsedAt,
		"expires_at":         session.ExpiresAt,
		"device_label":       session.DeviceLabel,
	}).Error
}

func (r *sessionRepository) Revoke(id string, revokedAt string) error {
	return r.db.Model(&models.UserSession{}).Where("id = ?", id).Update("revoked_at", revokedAt).Error
}

func (r *sessionRepository) RevokeOthers(userID, keepID, revokedAt string) (int64, error) {
	res := r.db.Model(&models.UserSession{}).
		Where("user_id = ? AND id <> ? AND revoked_at IS NULL", userID, keepID).
		Update("revoked_at", revokedAt)
	return res.RowsAffected, res.Error
}

func hashRefreshToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func newRefreshToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "ref_" + hex.EncodeToString(buf), nil
}

func sessionStillValid(session *models.UserSession, now time.Time) bool {
	if session == nil || session.IsRevoked() {
		return false
	}
	expires, err := time.Parse(time.RFC3339, session.ExpiresAt)
	if err != nil {
		return false
	}
	return now.Before(expires)
}
