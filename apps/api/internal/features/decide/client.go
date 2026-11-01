package decide

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	ProviderTypeSafe   = "typesafe"
	ProviderOpenRouter = "openrouter"

	typeSafeURL = "https://api.typesafe.ai/v1/systemone"
	// OpenRouter's Decisions API takes the same body. Its model ids differ
	// from TypeSafe's: there is no plain "typesafe/jev-latest".
	openRouterURL = "https://openrouter.ai/api/alpha/decisions"
	typeSafeModel = "jev-latest"
	routerModel   = "typesafe/jev-1.13"

	// typeSafeRest is how long an account skips TypeSafe after it was down,
	// overloaded or too slow, while its OpenRouter key can answer instead.
	typeSafeRest = 2 * time.Minute
)

type userKey struct{}

// UserKey carries the account id on a context passed straight to a Caller,
// so a refused TypeSafe key is remembered for that account.
var UserKey = userKey{}

type probeKey struct{}

// Caller sends one request and reports which provider answered.
type Caller interface {
	Call(ctx context.Context, keys Keys, body wire) ([]byte, string, error)
}

// Client calls TypeSafe first and OpenRouter second. Both take the same body
// (model, state, questions) and return the same answers.
type Client struct {
	HTTP          *http.Client
	TypeSafeURL   string
	OpenRouterURL string
	// Rejected is told which account's TypeSafe key was refused (401), and
	// which key that was, so Settings can say so unless the key was replaced
	// while the call was out.
	Rejected func(userID, key string)

	mu      sync.Mutex
	resting map[string]time.Time // account -> until when TypeSafe is skipped
}

// NewClient returns a client for the real endpoints.
func NewClient(httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 15 * time.Second}
	}
	return &Client{HTTP: httpClient, TypeSafeURL: typeSafeURL, OpenRouterURL: openRouterURL}
}

// StatusError is a refused call.
type StatusError struct {
	Provider string
	Code     int
	Message  string
	// RetryAfter is the provider's Retry-After, when it sent one.
	RetryAfter time.Duration
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("%s answered %d: %s", e.Provider, e.Code, e.Message)
}

// errNoAnswers is a 200 that carried no answers to read.
var errNoAnswers = errors.New("sent no answers")

// fallback reports whether a TypeSafe failure should move the call to
// OpenRouter. Only a request TypeSafe could not take (400, 413, 422) stays
// there: OpenRouter gets the same body and would refuse it too. Anything
// about the TypeSafe account or service (a refused key, no credit, forbidden,
// a timeout, rate limits, overload, server errors) may still work on the
// person's OpenRouter key.
func fallback(err error) bool {
	var se *StatusError
	if errors.As(err, &se) {
		return se.Code != 400 && se.Code != 413 && se.Code != 422
	}
	return true // network error, timeout or an answer with no answers
}

// outage reports whether a failure is about the service rather than the
// request or the key: an account out of credit, rate limits, overload,
// server errors, timeouts and network errors. The same call a moment later
// is likely to fail too.
func outage(err error) bool {
	var se *StatusError
	if errors.As(err, &se) {
		return se.Code == 402 || se.Code == 408 || se.Code == 429 || se.Code >= 500
	}
	return !errors.Is(err, errNoAnswers)
}

func (c *Client) Call(ctx context.Context, keys Keys, body wire) ([]byte, string, error) {
	uid, _ := ctx.Value(userKey{}).(string)
	probe, _ := ctx.Value(probeKey{}).(bool)
	var first error
	// After an outage TypeSafe rests for a while when OpenRouter can answer,
	// so each suggestion costs one call rather than a failed one and a
	// second. A key check or Settings → Test always asks TypeSafe.
	if keys.TypeSafe != "" && (keys.OpenRouter == "" || probe || !c.isResting(uid)) {
		body.Model = typeSafeModel
		body.Provider = nil
		tsCtx, cancel := ctx, context.CancelFunc(func() {})
		// With OpenRouter to fall back on, TypeSafe gets half the time left,
		// so a slow or hung TypeSafe still leaves OpenRouter time to answer.
		if deadline, ok := ctx.Deadline(); ok && keys.OpenRouter != "" {
			tsCtx, cancel = context.WithTimeout(ctx, time.Until(deadline)/2)
		}
		raw, err := c.post(tsCtx, ProviderTypeSafe, c.TypeSafeURL, keys.TypeSafe, body)
		cancel()
		if err == nil {
			c.rest(uid, 0)
			return raw, ProviderTypeSafe, nil
		}
		var se *StatusError
		if errors.As(err, &se) && se.Code == 401 && c.Rejected != nil && uid != "" {
			c.Rejected(uid, keys.TypeSafe)
		}
		// A call the caller gave up on (the screen closed) says nothing
		// about TypeSafe, so it does not make TypeSafe rest.
		if outage(err) && ctx.Err() == nil {
			c.rest(uid, typeSafeRest)
		}
		if !fallback(err) || keys.OpenRouter == "" || ctx.Err() != nil {
			return nil, ProviderTypeSafe, err
		}
		first = err
	}
	if keys.OpenRouter == "" {
		return nil, "", ErrOff
	}
	// TypeSafe is Jev's only provider on OpenRouter, so the request reaches
	// the same company as a direct call. Private state asks for an endpoint
	// that keeps no data, as chat does for receipts (zdr).
	body.Model = routerModel
	body.Provider = nil
	if body.private {
		body.Provider = map[string]any{"zdr": true}
	}
	raw, err := c.post(ctx, ProviderOpenRouter, c.OpenRouterURL, keys.OpenRouter, body)
	if err != nil {
		return nil, ProviderOpenRouter, errors.Join(first, err)
	}
	return raw, ProviderOpenRouter, nil
}

// isResting reports whether the account skips TypeSafe for now.
func (c *Client) isResting(uid string) bool {
	if uid == "" {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	until, ok := c.resting[uid]
	if ok && time.Now().After(until) {
		delete(c.resting, uid)
		return false
	}
	return ok
}

// rest makes the account skip TypeSafe for d; 0 ends a rest.
func (c *Client) rest(uid string, d time.Duration) {
	if uid == "" {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if d <= 0 {
		delete(c.resting, uid)
		return
	}
	if c.resting == nil {
		c.resting = map[string]time.Time{}
	}
	c.resting[uid] = time.Now().Add(d)
}

func (c *Client) post(ctx context.Context, provider, url, key string, body any) ([]byte, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	if provider == ProviderOpenRouter {
		req.Header.Set("X-Title", "Timely")
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode/100 != 2 {
		return nil, &StatusError{Provider: provider, Code: res.StatusCode, Message: errorMessage(raw), RetryAfter: retryAfter(res.Header.Get("Retry-After"))}
	}
	// A 200 can still carry an error and no answers (an upstream failure
	// passed on). It is a failed call: OpenRouter may still answer it, and
	// nothing is logged as a decision or cached.
	if !hasAnswers(raw) {
		if msg := messageField(raw); msg != "" {
			return nil, fmt.Errorf("%s %w: %s", provider, errNoAnswers, msg)
		}
		return nil, fmt.Errorf("%s %w", provider, errNoAnswers)
	}
	return raw, nil
}

// hasAnswers reports whether a body holds at least one answer.
func hasAnswers(raw []byte) bool {
	var r struct {
		Answers map[string]json.RawMessage `json:"answers"`
	}
	return json.Unmarshal(raw, &r) == nil && len(r.Answers) > 0
}

// retryAfter reads a Retry-After header given in seconds; an HTTP date or
// anything else reads as none.
func retryAfter(v string) time.Duration {
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n <= 0 {
		return 0
	}
	return time.Duration(n) * time.Second
}

var markup = regexp.MustCompile(`<[^>]*>`)

// errorMessage reads {"error": {"message": ...}} (OpenRouter), {"detail": ...}
// or a plain body, for the server log and Settings: one short line with
// markup and line breaks taken out, cut on a character boundary.
func errorMessage(raw []byte) string {
	msg := messageField(raw)
	if msg == "" {
		msg = markup.ReplaceAllString(string(raw), " ")
	}
	return shortLine(msg)
}

// shortLine collapses whitespace and keeps at most 200 characters.
func shortLine(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > 200 {
		s = string(r[:200])
	}
	return s
}

// messageField is the error message a JSON body names, or "".
func messageField(raw []byte) string {
	var e struct {
		Error   any    `json:"error"`
		Detail  any    `json:"detail"`
		Message string `json:"message"`
	}
	msg := ""
	if json.Unmarshal(raw, &e) == nil {
		switch v := e.Error.(type) {
		case map[string]any:
			msg, _ = v["message"].(string)
		case string:
			msg = v
		}
		if msg == "" && e.Message != "" {
			msg = e.Message
		}
		if msg == "" && e.Detail != nil {
			// FastAPI-style errors nest the message in an object detail.
			if d, ok := e.Detail.(map[string]any); ok {
				msg, _ = d["message"].(string)
			}
			if msg == "" {
				if d, ok := e.Detail.(string); ok {
					msg = d
				} else {
					b, _ := json.Marshal(e.Detail)
					msg = string(b)
				}
			}
		}
	}
	return shortLine(msg)
}

// Check makes one tiny call with only the given key, to confirm it works
// before it is saved.
func Check(ctx context.Context, c Caller, keys Keys) error {
	_, err := CheckWith(ctx, c, keys)
	return err
}

// CheckWith makes one tiny call with the given keys in the usual order and
// reports which provider answered. TypeSafe is asked even while it rests
// after an outage: this is the person checking it.
func CheckWith(ctx context.Context, c Caller, keys Keys) (string, error) {
	keys.Enabled = true
	body := wire{State: map[string]string{"note": "Timely is checking that this key works."}, Questions: map[string]wireQuest{
		"ok": {Type: typeNoul, Instructions: "Is this a test message?", Criteria: map[string]string{"true": "It is a test.", "false": "It is not a test."}},
	}}
	raw, provider, err := c.Call(context.WithValue(ctx, probeKey{}, true), keys, body)
	if err != nil {
		return provider, err
	}
	var r response
	if json.Unmarshal(raw, &r) != nil || r.Answers["ok"].Noul == nil {
		return provider, fmt.Errorf("%w: the answer did not look like Jev's", errNoAnswers)
	}
	return provider, nil
}

// KeyCheckReason is the line Settings shows when a key check failed: a
// refusal reads as a bad key, anything else as TypeSafe being unavailable
// rather than the key being wrong.
func KeyCheckReason(err error) string {
	var se *StatusError
	if errors.As(lastErr(err), &se) {
		switch {
		case se.Code == 401 || se.Code == 403:
			return "TypeSafe did not accept this key."
		case se.Code == 402:
			return "TypeSafe accepted the key but says the account is out of credit. Add credit, then save it again."
		case se.Code == 429 || se.Code >= 500 || se.Code == 408:
			return "TypeSafe could not check this key right now. Try again in a minute."
		}
		return "TypeSafe could not check this key."
	}
	if timedOut(err) {
		return "TypeSafe took too long to check this key. Try again in a minute."
	}
	if errors.Is(err, errNoAnswers) {
		return "TypeSafe answered, but not the way Jev does. Check that this is a TypeSafe API key."
	}
	return "TypeSafe could not be reached to check this key. Try again in a minute."
}
