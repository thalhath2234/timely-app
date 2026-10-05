package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

func jwtSecret(*jwt.Token) (interface{}, error) {
	return []byte(os.Getenv("JWT_SECRET")), nil
}

// minSecretLength is the shortest JWT_SECRET the API accepts; `openssl rand
// -base64 32` and the desktop app's generated secret are both longer.
const minSecretLength = 32

// leakedSecretHashes are SHA-256 digests of secrets that were once committed
// to this repository and must never sign tokens again.
var leakedSecretHashes = map[string]bool{
	"5ffa1810b8ee954e11aadbbb22870c85ee21241a6860d0f71e5c81db40d25145": true,
}

// CheckSecret rejects a signing secret that is missing, short, a placeholder
// from .env.example, or known to be public. name is the variable, for errors.
func CheckSecret(name, secret string) error {
	secret = strings.TrimSpace(secret)
	switch {
	case secret == "":
		return fmt.Errorf("%s is not set; generate one with: openssl rand -base64 32", name)
	case strings.HasPrefix(secret, "replace-with"):
		return fmt.Errorf("%s is still the .env.example placeholder; generate one with: openssl rand -base64 32", name)
	case len(secret) < minSecretLength:
		return fmt.Errorf("%s must be at least %d characters; generate one with: openssl rand -base64 32", name, minSecretLength)
	}
	digest := sha256.Sum256([]byte(secret))
	if leakedSecretHashes[hex.EncodeToString(digest[:])] {
		return fmt.Errorf("%s was published in this repository's history and must be replaced; generate one with: openssl rand -base64 32", name)
	}
	return nil
}

// ParseAccessToken verifies the signature and standard claims of an access token.
func ParseAccessToken(tokenString string) (*JWTClaims, error) {
	claims := &JWTClaims{}
	// Access tokens are always issued with HS256 (see issueAccessToken).
	parser := jwt.NewParser(jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	token, err := parser.ParseWithClaims(tokenString, claims, jwtSecret)
	if err != nil {
		return claims, err
	}
	if token == nil || !token.Valid {
		return claims, errUnverifiedToken
	}
	return claims, nil
}

var errUnverifiedToken = errors.New("token signature is not verified")

// ParseSignedSessionClaims returns the claims of a token whose signature was
// issued by this server, even when the token has expired. Callers use it for
// session revocation, where an expired access token still proves which session
// the holder was issued. Tokens with an invalid signature are rejected.
func ParseSignedSessionClaims(tokenString string) (*JWTClaims, error) {
	claims := &JWTClaims{}
	// Access tokens are always issued with HS256 (see issueAccessToken).
	parser := jwt.NewParser(jwt.WithoutClaimsValidation(), jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	token, err := parser.ParseWithClaims(tokenString, claims, jwtSecret)
	if err != nil {
		return nil, err
	}
	if token == nil || !token.Valid {
		return nil, errUnverifiedToken
	}
	return claims, nil
}
