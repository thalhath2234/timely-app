package auth

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
)

// PairingCodeTTL is how long a code from POST /pairing-codes can sign a phone
// in. It is shown in a QR code on the desktop, so it is short and single use.
const PairingCodeTTL = 5 * time.Minute

// ErrPairingCode covers an unknown, used or expired code alike, so a caller
// learns nothing about which codes exist.
var ErrPairingCode = errors.New("this sign-in code has expired or was already used")

// PairingCodes stores the one-time codes in pairing_codes.
type PairingCodes struct {
	db  *gorm.DB
	now func() time.Time
}

func NewPairingCodes(db *gorm.DB) *PairingCodes {
	return &PairingCodes{db: db, now: time.Now}
}

// Create returns a new code for userID and when it stops working.
func (p *PairingCodes) Create(userID string) (string, time.Time, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", time.Time{}, err
	}
	code := "pair_" + base64.RawURLEncoding.EncodeToString(buf)
	now := p.now().UTC()
	expires := now.Add(PairingCodeTTL)
	// Spent and expired codes go first so the table never grows.
	if err := p.db.Exec(`DELETE FROM pairing_codes WHERE expires_at <= ? OR used_at IS NOT NULL`, now).Error; err != nil {
		return "", time.Time{}, err
	}
	err := p.db.Exec(
		`INSERT INTO pairing_codes (code_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
		hashRefreshToken(code), userID, now, expires,
	).Error
	if err != nil {
		return "", time.Time{}, err
	}
	return code, expires, nil
}

// Redeem spends code and returns the user it was made for. A code works once:
// two phones racing with the same code get one session between them.
func (p *PairingCodes) Redeem(code string) (string, error) {
	if code == "" {
		return "", ErrPairingCode
	}
	var userID string
	row := p.db.Raw(
		`UPDATE pairing_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id`,
		p.now().UTC(), hashRefreshToken(code), p.now().UTC(),
	).Row()
	if err := row.Scan(&userID); err != nil || userID == "" {
		return "", ErrPairingCode
	}
	return userID, nil
}

// SetPairingCodes turns on POST /pairing-codes and POST /auth/pair.
func (h *Handler) SetPairingCodes(codes *PairingCodes) { h.pairing = codes }

type pairingCodeResponse struct {
	Code      string `json:"code"`
	ExpiresAt string `json:"expiresAt"`
}

// CreatePairingCode makes a code the signed-in person's desktop puts in its
// pairing QR, so the phone that scans it is signed in to the same account.
func (h *Handler) CreatePairingCode(c *echo.Context) error {
	if h.pairing == nil {
		return echo.NewHTTPError(http.StatusNotFound, "Pairing codes are not available")
	}
	userID, ok := c.Get("userID").(string)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "User context not found")
	}
	code, expires, err := h.pairing.Create(userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Could not create a sign-in code")
	}
	return c.JSON(http.StatusCreated, pairingCodeResponse{Code: code, ExpiresAt: expires.Format(time.RFC3339)})
}

type pairRequest struct {
	Code string `json:"code"`
}

// Pair trades a pairing code for a session, like /login does for a password.
func (h *Handler) Pair(c *echo.Context) error {
	if h.pairing == nil {
		return echo.NewHTTPError(http.StatusNotFound, "Pairing codes are not available")
	}
	var req pairRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "Invalid request payload")
	}
	userID, err := h.pairing.Redeem(req.Code)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, err.Error())
	}
	user, err := h.userRepo.GetUserByID(userID)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, ErrPairingCode.Error())
	}
	tokens, err := h.authService.IssueSession(user, deviceLabel(c))
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "Could not sign in")
	}
	return c.JSON(http.StatusOK, sessionResponse("paired", tokens, h.profileFor(user.ID, user.Email, user.Name)))
}
