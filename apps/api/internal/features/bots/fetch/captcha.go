package fetch

import (
	"bytes"
	"net/http"
	"regexp"
	"strings"
)

var (
	// Markers only a challenge page carries, whatever its status: Amazon's
	// robot check and Cloudflare's challenge options.
	challengeMarkers = [][]byte{[]byte("/errors/validateCaptcha"), []byte("cf-chl"), []byte("_cf_chl_opt")}
	// Markers that ordinary pages carry too (a contact form's reCAPTCHA,
	// Cloudflare's bot-detection script), so they count only on a refusal.
	refusalMarkers  = [][]byte{[]byte("challenge-platform"), []byte("g-recaptcha"), []byte("h-captcha"), []byte("px-captcha")}
	robotCheckTitle = regexp.MustCompile(`(?i)<title[^>]*>\s*robot check\s*</title>`)
)

// looksBlocked returns ErrCaptcha when the answer is a robot check rather
// than the page. It runs before the status rules, so a 503 challenge is a
// captcha and not a rate limit.
func looksBlocked(status int, finalURL string, body []byte) error {
	if strings.Contains(finalURL, "/errors/validateCaptcha") || robotCheckTitle.Match(body) {
		return ErrCaptcha
	}
	for _, m := range challengeMarkers {
		if bytes.Contains(body, m) {
			return ErrCaptcha
		}
	}
	if status == http.StatusForbidden || status == http.StatusTooManyRequests || status == http.StatusServiceUnavailable {
		for _, m := range refusalMarkers {
			if bytes.Contains(body, m) {
				return ErrCaptcha
			}
		}
	}
	return nil
}
