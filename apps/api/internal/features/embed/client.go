package embed

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"timely-api/internal/utils"
)

const embedURL = "https://openrouter.ai/api/v1/embeddings"

type embedRequest struct {
	Model string   `json:"model"`
	Input []string `json:"input"`
}

type embedResponse struct {
	Data []struct {
		Embedding []float32 `json:"embedding"`
		Index     int       `json:"index"`
	} `json:"data"`
	Error *struct {
		Message string `json:"message"`
		Code    any    `json:"code"`
	} `json:"error"`
}

// ProviderError is OpenRouter refusing an embeddings request, with the HTTP
// status it gave (or the code in its error body).
type ProviderError struct {
	Status  int
	Message string
}

func (e *ProviderError) Error() string { return e.Message }

// dimsError is a model whose vectors do not fit the index.
type dimsError struct{ msg string }

func (e *dimsError) Error() string { return e.msg }

// Rejected reports that the provider refused this input itself (a bad
// request, flagged or too long), so other texts may still embed.
func Rejected(err error) bool {
	var pe *ProviderError
	if !errors.As(err, &pe) {
		return false
	}
	switch pe.Status {
	case http.StatusBadRequest, http.StatusForbidden, http.StatusRequestEntityTooLarge, http.StatusUnprocessableEntity:
		return true
	}
	return false
}

// Permanent reports an error that another attempt would repeat: a rejected
// input, a refused key, no credits left, an unknown model or one whose
// vectors do not fit. Timeouts, rate limits and server errors are not.
func Permanent(err error) bool {
	if Rejected(err) {
		return true
	}
	var de *dimsError
	if errors.As(err, &de) {
		return true
	}
	var pe *ProviderError
	if !errors.As(err, &pe) {
		return false
	}
	switch pe.Status {
	case http.StatusUnauthorized, http.StatusPaymentRequired, http.StatusNotFound:
		return true
	}
	return false
}

// providerText is a provider's message as Timely keeps it: keys it quotes
// hidden, at most a few hundred bytes.
func providerText(s string) string {
	return utils.ClipUTF8(strings.TrimSpace(utils.RedactSecrets(s)), 300)
}

func errorCode(code any) int {
	switch v := code.(type) {
	case float64:
		return int(v)
	case string:
		n, _ := strconv.Atoi(v)
		return n
	}
	return 0
}

func (i *indexer) embedTexts(ctx context.Context, userID string, texts []string) ([][]float32, error) {
	key, model := i.credentials(userID)
	if key == "" {
		return nil, ErrDisabled
	}
	return embedWith(ctx, i.http, key, model, texts)
}

// Probe embeds one short text with the given credentials and reports the
// vector width, so a chosen embedding model can be checked against the index
// before it is saved.
func Probe(ctx context.Context, key, model string) (int, error) {
	vectors, err := embedWith(ctx, defaultHTTPClient(), key, model, []string{"Timely"})
	if err != nil {
		return 0, err
	}
	return len(vectors[0]), nil
}

func embedWith(ctx context.Context, client *http.Client, key, model string, texts []string) ([][]float32, error) {
	if len(texts) == 0 {
		return nil, nil
	}

	body, err := json.Marshal(embedRequest{Model: model, Input: texts})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, embedURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("HTTP-Referer", "http://localhost:4001")
	req.Header.Set("X-Title", "Timely")

	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(res.Body, 32<<20))
	if err != nil {
		return nil, err
	}

	var parsed embedResponse
	jsonErr := json.Unmarshal(raw, &parsed)
	if jsonErr == nil && parsed.Error != nil && parsed.Error.Message != "" {
		status := res.StatusCode
		if status < 300 {
			status = errorCode(parsed.Error.Code)
		}
		return nil, &ProviderError{Status: status, Message: "openrouter embed: " + providerText(parsed.Error.Message)}
	}
	if res.StatusCode >= 300 {
		msg := "openrouter embed: HTTP " + res.Status
		// A JSON or plain-text body may say why; an HTML error page is noise.
		if body := strings.TrimSpace(string(raw)); body != "" && !strings.HasPrefix(body, "<") {
			msg += ": " + providerText(body)
		}
		return nil, &ProviderError{Status: res.StatusCode, Message: msg}
	}
	if jsonErr != nil {
		return nil, fmt.Errorf("openrouter embed: invalid json (%s): %w", res.Status, jsonErr)
	}
	if len(parsed.Data) != len(texts) {
		return nil, fmt.Errorf("openrouter embed: expected %d vectors, got %d", len(texts), len(parsed.Data))
	}

	out := make([][]float32, len(texts))
	for _, row := range parsed.Data {
		if row.Index < 0 || row.Index >= len(out) {
			return nil, fmt.Errorf("openrouter embed: bad index %d", row.Index)
		}
		out[row.Index] = row.Embedding
	}
	for i, vec := range out {
		if vec == nil {
			return nil, fmt.Errorf("openrouter embed: missing vector for input %d", i)
		}
	}
	return out, nil
}

// VectorDims is the width of the search index; every embedding model must match it.
func VectorDims() int { return vectorDims }

// CheckDims rejects vectors that would not fit the index.
func CheckDims(vectors [][]float32) error {
	for _, vec := range vectors {
		if len(vec) != vectorDims {
			return &dimsError{fmt.Sprintf("openrouter embed: expected %d dims, got %d", vectorDims, len(vec))}
		}
	}
	return nil
}

func defaultHTTPClient() *http.Client {
	return &http.Client{Timeout: 25 * time.Second}
}
