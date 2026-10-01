package auth

import (
	"errors"
	"os"

	"github.com/golang-jwt/jwt/v5"
)

func jwtSecret(*jwt.Token) (interface{}, error) {
	return []byte(os.Getenv("JWT_SECRET")), nil
}

// ParseAccessToken verifies the signature and standard claims of an access token.
func ParseAccessToken(tokenString string) (*JWTClaims, error) {
	claims := &JWTClaims{}
	_, err := jwt.ParseWithClaims(tokenString, claims, jwtSecret)
	if err != nil {
		return claims, err
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
