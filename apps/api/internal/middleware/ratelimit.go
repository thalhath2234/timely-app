package middleware

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v5"
)

// RateLimiter is an in-memory sliding window for the sign-in routes: a cap
// per client IP and, when the body names an account, a tighter cap per
// normalized email so one address cannot be hammered from many IPs.
type RateLimiter struct {
	window     time.Duration
	perIP      int
	perAccount int

	mu        sync.Mutex
	ips       map[string][]time.Time
	accounts  map[string][]time.Time
	lastPrune time.Time
	now       func() time.Time
}

const maxPeekBytes = 64 << 10

// NewRateLimiter caps requests per window: perIP for every client address,
// perAccount for every email in a JSON body (0 disables that axis).
func NewRateLimiter(window time.Duration, perIP, perAccount int) *RateLimiter {
	return &RateLimiter{
		window:     window,
		perIP:      perIP,
		perAccount: perAccount,
		ips:        map[string][]time.Time{},
		accounts:   map[string][]time.Time{},
		now:        time.Now,
	}
}

// NewLoginRateLimiter is the production configuration: 20/min per IP, 8/min
// per account.
func NewLoginRateLimiter() *RateLimiter {
	return NewRateLimiter(time.Minute, 20, 8)
}

// Middleware limits by IP and, when withAccount is set, by the "email" field
// of a JSON body. The body is restored so the handler can bind it.
func (r *RateLimiter) Middleware(withAccount bool) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			ip := strings.TrimSpace(c.RealIP())
			if ip == "" {
				ip = "unknown"
			}
			account := ""
			if withAccount && r.perAccount > 0 {
				account = r.peekEmail(c)
			}
			if retry := r.take(ip, account); retry > 0 {
				seconds := int(math.Ceil(retry.Seconds()))
				c.Response().Header().Set("Retry-After", fmt.Sprint(seconds))
				return c.JSON(http.StatusTooManyRequests, map[string]string{
					"message": fmt.Sprintf("Too many attempts. Try again in %d seconds", seconds),
				})
			}
			return next(c)
		}
	}
}

// take records one request and returns how long the caller must wait when a
// limit is exceeded; zero means the request may proceed.
func (r *RateLimiter) take(ip, account string) time.Duration {
	now := r.now()
	r.mu.Lock()
	defer r.mu.Unlock()
	if now.Sub(r.lastPrune) > r.window {
		r.prune(now)
		r.lastPrune = now
	}
	ipHits := trimWindow(r.ips[ip], now, r.window)
	if r.perIP > 0 && len(ipHits) >= r.perIP {
		r.ips[ip] = ipHits
		return ipHits[0].Add(r.window).Sub(now)
	}
	var accountHits []time.Time
	if account != "" {
		accountHits = trimWindow(r.accounts[account], now, r.window)
		if r.perAccount > 0 && len(accountHits) >= r.perAccount {
			r.accounts[account] = accountHits
			r.ips[ip] = ipHits
			return accountHits[0].Add(r.window).Sub(now)
		}
	}
	r.ips[ip] = append(ipHits, now)
	if account != "" {
		r.accounts[account] = append(accountHits, now)
	}
	return 0
}

func trimWindow(hits []time.Time, now time.Time, window time.Duration) []time.Time {
	cutoff := now.Add(-window)
	i := 0
	for i < len(hits) && !hits[i].After(cutoff) {
		i++
	}
	return hits[i:]
}

// prune drops keys with no hits in the window so memory does not grow with
// every address that ever tried to sign in.
func (r *RateLimiter) prune(now time.Time) {
	for key, hits := range r.ips {
		if kept := trimWindow(hits, now, r.window); len(kept) == 0 {
			delete(r.ips, key)
		} else {
			r.ips[key] = kept
		}
	}
	for key, hits := range r.accounts {
		if kept := trimWindow(hits, now, r.window); len(kept) == 0 {
			delete(r.accounts, key)
		} else {
			r.accounts[key] = kept
		}
	}
}

// peekEmail reads the JSON body for an "email" key and puts the bytes back so
// the handler can bind them. Non-JSON bodies yield no account key.
func (r *RateLimiter) peekEmail(c *echo.Context) string {
	req := c.Request()
	if req.Body == nil {
		return ""
	}
	raw, err := io.ReadAll(io.LimitReader(req.Body, maxPeekBytes+1))
	_ = req.Body.Close()
	if len(raw) > maxPeekBytes {
		// Larger than any sign-in payload; let the handler reject it.
		req.Body = io.NopCloser(io.MultiReader(bytes.NewReader(raw), req.Body))
		return ""
	}
	req.Body = io.NopCloser(bytes.NewReader(raw))
	if err != nil {
		return ""
	}
	var body struct {
		Email string `json:"email"`
	}
	if json.Unmarshal(raw, &body) != nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(body.Email))
}
