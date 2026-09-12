package auth

import (
	"os"

	"github.com/golang-jwt/jwt/v5"
)

func ParseAccessToken(tokenString string) (*JWTClaims, error) {
	claims := &JWTClaims{}
	_, err := jwt.ParseWithClaims(
		tokenString,
		claims,
		func(token *jwt.Token) (interface{}, error) {
			return []byte(os.Getenv("JWT_SECRET")), nil
		},
	)
	if err != nil {
		return claims, err
	}
	return claims, nil
}
