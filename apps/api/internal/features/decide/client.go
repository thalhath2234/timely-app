package decide

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
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
)

type userKey struct{}

// UserKey carries the account id on a context passed straight to a Caller,
// so a refused TypeSafe key is remembered for that account.
var UserKey = userKey{}

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
	// Rejected is told which account's TypeSafe key was refused (401), so
	// Settings can say so.
	Rejected func(userID string)
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
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("%s answered %d: %s", e.Provider, e.Code, e.Message)
}

// fallback reports whether a TypeSafe failure should move the call to
// OpenRouter: timeouts, rate limits, overload and server errors. A refused
// key (401) also falls back, since the person may have only an OpenRouter
// key that works.
func fallback(err error) bool {
	var se *StatusError
	if errors.As(err, &se) {
		return se.Code == 401 || se.Code == 429 || se.Code == 529 || se.Code >= 500
	}
	return true // network error or timeout
}

func (c *Client) Call(ctx context.Context, keys Keys, body wire) ([]byte, string, error) {
	var first error
	if keys.TypeSafe != "" {
		body.Model = typeSafeModel
		raw, err := c.post(ctx, ProviderTypeSafe, c.TypeSafeURL, keys.TypeSafe, body)
		if err == nil {
			return raw, ProviderTypeSafe, nil
		}
		var se *StatusError
		if errors.As(err, &se) && se.Code == 401 && c.Rejected != nil {
			if uid, _ := ctx.Value(userKey{}).(string); uid != "" {
				c.Rejected(uid)
			}
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
	// the same company as a direct call; no provider routing is sent.
	body.Model = routerModel
	raw, err := c.post(ctx, ProviderOpenRouter, c.OpenRouterURL, keys.OpenRouter, body)
	if err != nil {
		return nil, ProviderOpenRouter, errors.Join(first, err)
	}
	return raw, ProviderOpenRouter, nil
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
		return nil, &StatusError{Provider: provider, Code: res.StatusCode, Message: errorMessage(raw)}
	}
	return raw, nil
}

// errorMessage reads {"error": {"message": ...}} (OpenRouter), {"detail": ...}
// or a plain body, never echoing more than a short line.
func errorMessage(raw []byte) string {
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
			b, _ := json.Marshal(e.Detail)
			msg = string(b)
		}
	}
	if msg == "" {
		msg = string(raw)
	}
	if len(msg) > 200 {
		msg = msg[:200]
	}
	return msg
}

// Check makes one tiny call with only the given key, to confirm it works
// before it is saved.
func Check(ctx context.Context, c Caller, keys Keys) error {
	_, err := CheckWith(ctx, c, keys)
	return err
}

// CheckWith makes one tiny call with the given keys in the usual order and
// reports which provider answered.
func CheckWith(ctx context.Context, c Caller, keys Keys) (string, error) {
	keys.Enabled = true
	body := wire{State: map[string]string{"note": "Timely is checking that this key works."}, Questions: map[string]wireQuest{
		"ok": {Type: typeNoul, Instructions: "Is this a test message?", Criteria: map[string]string{"true": "It is a test.", "false": "It is not a test."}},
	}}
	raw, provider, err := c.Call(ctx, keys, body)
	if err != nil {
		return provider, err
	}
	var r response
	if json.Unmarshal(raw, &r) != nil || r.Answers["ok"].Noul == nil {
		return provider, errors.New("the answer did not look like Jev's")
	}
	return provider, nil
}
