package embed

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
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
	} `json:"error"`
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
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("openrouter embed: invalid json (%s): %w", res.Status, err)
	}
	if parsed.Error != nil && parsed.Error.Message != "" {
		return nil, fmt.Errorf("openrouter embed: %s", parsed.Error.Message)
	}
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("openrouter embed: HTTP %s: %s", res.Status, truncate(string(raw), 300))
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
			return fmt.Errorf("openrouter embed: expected %d dims, got %d", vectorDims, len(vec))
		}
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func defaultHTTPClient() *http.Client {
	return &http.Client{Timeout: 25 * time.Second}
}
