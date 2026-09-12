package auth

import (
	"net/mail"
	"strings"
)

func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func ValidateEmail(email string) bool {
	normalized := NormalizeEmail(email)
	if normalized == "" {
		return false
	}
	addr, err := mail.ParseAddress(normalized)
	return err == nil && addr.Address == normalized
}
