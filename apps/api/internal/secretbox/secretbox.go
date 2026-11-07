// Package secretbox seals small secrets (API keys) at rest with the server's
// secret: TIMELY_BACKUP_KEY, else JWT_SECRET. It is the scheme the agent's
// provider keys use (AES-256-GCM, a random nonce in front, base64, the key
// sha256(label + secret)), so a value sealed there opens here with the same
// label. The label keeps one feature's secrets from opening as another's.
package secretbox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"os"
	"strings"
)

// ErrUnreadable means a sealed value does not open: it was changed, sealed
// under another label, or the server's secret changed since.
var ErrUnreadable = errors.New("stored key is unreadable; replace it")

// Box seals and opens values under one label.
type Box struct{ aead cipher.AEAD }

// New makes a Box for label from the server's secret. It fails when neither
// TIMELY_BACKUP_KEY nor JWT_SECRET is set.
func New(label string) (*Box, error) {
	secret := strings.TrimSpace(os.Getenv("TIMELY_BACKUP_KEY"))
	if secret == "" {
		secret = os.Getenv("JWT_SECRET")
	}
	if secret == "" {
		return nil, errors.New("secretbox: set TIMELY_BACKUP_KEY or JWT_SECRET")
	}
	key := sha256.Sum256([]byte(label + secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Box{aead: aead}, nil
}

// Seal encrypts plain with a fresh nonce.
func (b *Box) Seal(plain string) (string, error) {
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(b.aead.Seal(nonce, nonce, []byte(plain), nil)), nil
}

// Open decrypts a value from Seal. "" opens as "". Any other failure is
// ErrUnreadable.
func (b *Box) Open(sealed string) (string, error) {
	if sealed == "" {
		return "", nil
	}
	raw, err := base64.StdEncoding.DecodeString(sealed)
	if err != nil || len(raw) < b.aead.NonceSize() {
		return "", ErrUnreadable
	}
	n := b.aead.NonceSize()
	plain, err := b.aead.Open(nil, raw[:n], raw[n:], nil)
	if err != nil {
		return "", ErrUnreadable
	}
	return string(plain), nil
}

// Hint is what a person sees of a saved key: its last four characters.
func Hint(key string) string {
	if len(key) <= 4 {
		return "…"
	}
	return "…" + key[len(key)-4:]
}
