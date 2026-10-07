package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestCheckSecretRejectsWeakSecrets(t *testing.T) {
	for _, secret := range []string{
		"",
		"   ",
		"replace-with-a-random-secret",
		"too-short",
		"n8SL1dOBK/0miN65rn9+2LJgV7kdxRDrWHzUJtHnrLs=", // published in git history
	} {
		if err := CheckSecret("JWT_SECRET", secret); err == nil {
			t.Errorf("CheckSecret(%q) = nil, want an error", secret)
		}
	}
	if err := CheckSecret("JWT_SECRET", strings.Repeat("k", minSecretLength)); err != nil {
		t.Errorf("CheckSecret(random) = %v, want nil", err)
	}
}

func TestParseAccessTokenRejectsOtherAlgorithms(t *testing.T) {
	secret := "parse-test-secret-parse-test-secret"
	t.Setenv("JWT_SECRET", secret)
	claims := JWTClaims{UserID: "usr_1", SessionID: "ses_1", RegisteredClaims: jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Minute)),
	}}

	good, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if _, err := ParseAccessToken(good); err != nil {
		t.Fatalf("HS256 token rejected: %v", err)
	}
	other, _ := jwt.NewWithClaims(jwt.SigningMethodHS512, claims).SignedString([]byte(secret))
	if _, err := ParseAccessToken(other); err == nil {
		t.Fatal("HS512 token accepted, want rejection")
	}
}
