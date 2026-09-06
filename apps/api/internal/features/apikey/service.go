package apikey

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"timely-api/internal/models"
	"timely-api/internal/utils"

	mcpauth "github.com/modelcontextprotocol/go-sdk/auth"
	"gorm.io/gorm"
)

const (
	keyPrefix     = "tk_"
	rawKeyBytes   = 32
	maxNameLength = 80
)

var (
	ErrInvalidKey = errors.New("invalid or revoked API key")
	ErrNotFound   = errors.New("API key not found")
)

type CreatedKey struct {
	models.ApiKey
	Key string `json:"key"`
}

type Service interface {
	List(userID string) ([]models.ApiKey, error)
	Create(userID, name string) (*CreatedKey, error)
	Revoke(userID, keyID string) error
	Verify(rawKey string) (userID string, err error)
	Verifier() mcpauth.TokenVerifier
}

type service struct {
	db *gorm.DB
}

func NewService(db *gorm.DB) Service {
	return &service{db: db}
}

func (s *service) List(userID string) ([]models.ApiKey, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	var keys []models.ApiKey
	err := s.db.
		Where("user_id = ?", userID).
		Where("revoked_at IS NULL").
		Order("created_at DESC").
		Find(&keys).Error
	if err != nil {
		return nil, err
	}
	if keys == nil {
		keys = []models.ApiKey{}
	}
	return keys, nil
}

func (s *service) Create(userID, name string) (*CreatedKey, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Hermes"
	}
	if len(name) > maxNameLength {
		name = name[:maxNameLength]
	}

	raw, err := randomKey()
	if err != nil {
		return nil, err
	}

	row := models.ApiKey{
		ID:     utils.NewApiKeyID(),
		UserID: userID,
		Name:   name,
		Prefix: raw[:7],
		Hash:   hashKey(raw),
	}
	if err := s.db.Create(&row).Error; err != nil {
		return nil, err
	}
	return &CreatedKey{ApiKey: row, Key: raw}, nil
}

func (s *service) Revoke(userID, keyID string) error {
	if userID == "" || keyID == "" {
		return ErrNotFound
	}
	now := utils.GetCurrentTimestamp()
	result := s.db.Model(&models.ApiKey{}).
		Where("id = ? AND user_id = ? AND revoked_at IS NULL", keyID, userID).
		Update("revoked_at", now)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *service) Verify(rawKey string) (string, error) {
	rawKey = strings.TrimSpace(rawKey)
	if !strings.HasPrefix(rawKey, keyPrefix) {
		return "", ErrInvalidKey
	}

	var row models.ApiKey
	err := s.db.
		Where("hash = ? AND revoked_at IS NULL", hashKey(rawKey)).
		First(&row).Error
	if err != nil {
		return "", ErrInvalidKey
	}

	now := utils.GetCurrentTimestamp()
	_ = s.db.Model(&models.ApiKey{}).Where("id = ?", row.ID).Update("last_used_at", now).Error
	return row.UserID, nil
}

func (s *service) Verifier() mcpauth.TokenVerifier {
	return func(_ context.Context, token string, _ *http.Request) (*mcpauth.TokenInfo, error) {
		userID, err := s.Verify(token)
		if err != nil {
			return nil, fmt.Errorf("%w", mcpauth.ErrInvalidToken)
		}
		return &mcpauth.TokenInfo{
			UserID:     userID,
			Expiration: time.Now().Add(10 * 365 * 24 * time.Hour),
		}, nil
	}
}

func randomKey() (string, error) {
	buf := make([]byte, rawKeyBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return keyPrefix + hex.EncodeToString(buf), nil
}

func hashKey(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
