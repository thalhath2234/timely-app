package provider

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// ModelOption is one pickable model, shaped the same for every provider.
type ModelOption struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Vision  bool   `json:"vision"`
	Default bool   `json:"default,omitempty"`
	Note    string `json:"note,omitempty"`
}

// Claude Code cannot list models; aliases follow the newest release of each
// tier. A full model name may still be typed and is checked with a test call.
var claudeModels = []ModelOption{
	{ID: "fable", Name: "Fable (latest)", Vision: true, Note: "Most capable"},
	{ID: "opus", Name: "Opus (latest)", Vision: true},
	{ID: "sonnet", Name: "Sonnet (latest)", Vision: true, Default: true, Note: "Balanced"},
	{ID: "haiku", Name: "Haiku (latest)", Vision: true, Note: "Fastest"},
}

const defaultClaudeModel = "sonnet"

type catalogue struct {
	mu      sync.Mutex
	fetched map[string]time.Time
	cached  map[string][]ModelOption
	client  *http.Client
}

func newCatalogue() *catalogue {
	return &catalogue{fetched: map[string]time.Time{}, cached: map[string][]ModelOption{}, client: &http.Client{Timeout: 20 * time.Second}}
}

func (c *catalogue) get(key string, maxAge time.Duration, load func() ([]ModelOption, error)) ([]ModelOption, error) {
	c.mu.Lock()
	if list, ok := c.cached[key]; ok && time.Since(c.fetched[key]) < maxAge {
		c.mu.Unlock()
		return list, nil
	}
	c.mu.Unlock()
	list, err := load()
	if err != nil {
		c.mu.Lock()
		stale, ok := c.cached[key]
		c.mu.Unlock()
		if ok {
			return stale, nil
		}
		return nil, err
	}
	c.mu.Lock()
	c.cached[key], c.fetched[key] = list, time.Now()
	c.mu.Unlock()
	return list, nil
}

type openRouterModel struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Architecture struct {
		InputModalities  []string `json:"input_modalities"`
		OutputModalities []string `json:"output_modalities"`
	} `json:"architecture"`
	SupportedParameters []string `json:"supported_parameters"`
	Description         string   `json:"description"`
}

func (c *catalogue) fetchOpenRouter(ctx context.Context, url string) ([]openRouterModel, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Title", "Timely")
	res, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Could not reach OpenRouter: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("OpenRouter model list returned HTTP %d", res.StatusCode)
	}
	var body struct {
		Data []openRouterModel `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 16<<20)).Decode(&body); err != nil {
		return nil, fmt.Errorf("OpenRouter model list could not be read: %w", err)
	}
	return body.Data, nil
}

// OpenRouterChatModels lists tool-calling models; the agent cannot run on a
// model without function calling. Vision marks models that accept images.
func (c *catalogue) OpenRouterChatModels(ctx context.Context, defaultModel string) ([]ModelOption, error) {
	return c.get("openrouter-chat", time.Hour, func() ([]ModelOption, error) {
		models, err := c.fetchOpenRouter(ctx, "https://openrouter.ai/api/v1/models")
		if err != nil {
			return nil, err
		}
		out := []ModelOption{}
		for _, m := range models {
			if !contains(m.SupportedParameters, "tools") {
				continue
			}
			out = append(out, ModelOption{ID: m.ID, Name: m.Name, Vision: contains(m.Architecture.InputModalities, "image"), Default: m.ID == defaultModel})
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
		return out, nil
	})
}

// OpenRouterEmbedModels lists embedding models. Width is not published, so a
// chosen model is probed against the index before it is saved.
func (c *catalogue) OpenRouterEmbedModels(ctx context.Context, defaultModel string) ([]ModelOption, error) {
	return c.get("openrouter-embed", time.Hour, func() ([]ModelOption, error) {
		models, err := c.fetchOpenRouter(ctx, "https://openrouter.ai/api/v1/embeddings/models")
		if err != nil {
			return nil, err
		}
		out := []ModelOption{}
		for _, m := range models {
			out = append(out, ModelOption{ID: m.ID, Name: m.Name, Default: m.ID == defaultModel})
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
		return out, nil
	})
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// CodexModels asks the app server for the account's model list and falls back
// to the CLI's own cache file. The preselected default is the model named in
// ~/.codex/config.toml, else the list's own default.
func (c *catalogue) CodexModels(ctx context.Context, bin string) ([]ModelOption, error) {
	return c.get("codex", 10*time.Minute, func() ([]ModelOption, error) {
		list, err := codexAppServerModels(ctx, bin)
		if err != nil || len(list) == 0 {
			list, err = codexCachedModels()
		}
		if err != nil {
			return nil, err
		}
		if configured := codexConfiguredModel(); configured != "" {
			for i := range list {
				list[i].Default = list[i].ID == configured
			}
		}
		return list, nil
	})
}

func codexHome() string {
	if dir := strings.TrimSpace(os.Getenv("CODEX_HOME")); dir != "" {
		return dir
	}
	return filepath.Join(home, ".codex")
}

func codexConfiguredModel() string {
	raw, err := os.ReadFile(filepath.Join(codexHome(), "config.toml"))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "[") {
			break // only the top-level table names the default model
		}
		if strings.HasPrefix(line, "model ") || strings.HasPrefix(line, "model=") {
			_, value, _ := strings.Cut(line, "=")
			return strings.Trim(strings.TrimSpace(value), `"'`)
		}
	}
	return ""
}

func codexCachedModels() ([]ModelOption, error) {
	raw, err := os.ReadFile(filepath.Join(codexHome(), "models_cache.json"))
	if err != nil {
		return nil, errors.New("Codex has no model list yet. Run `codex` once in a terminal on the server so it downloads one")
	}
	var cache struct {
		Models []struct {
			Slug            string   `json:"slug"`
			DisplayName     string   `json:"display_name"`
			Visibility      string   `json:"visibility"`
			InputModalities []string `json:"input_modalities"`
			Priority        int      `json:"priority"`
		} `json:"models"`
	}
	if err := json.Unmarshal(raw, &cache); err != nil {
		return nil, err
	}
	out := []ModelOption{}
	for _, m := range cache.Models {
		if m.Visibility != "list" {
			continue
		}
		out = append(out, ModelOption{ID: m.Slug, Name: m.DisplayName, Vision: contains(m.InputModalities, "image")})
	}
	if len(out) > 0 {
		out[0].Default = true
	}
	return out, nil
}

// codexAppServerModels speaks the app server's JSON-RPC over stdio just long
// enough to call model/list.
func codexAppServerModels(ctx context.Context, bin string) ([]ModelOption, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, "app-server")
	cmd.Dir = scratchDir()
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	send := func(v any) error {
		raw, _ := json.Marshal(v)
		_, err := stdin.Write(append(raw, '\n'))
		return err
	}
	if err := send(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": map[string]any{"clientInfo": map[string]any{"name": "timely", "title": "Timely", "version": "1.0"}, "capabilities": map[string]any{}}}); err != nil {
		return nil, err
	}
	reader := bufio.NewReader(stdout)
	if _, err := reader.ReadString('\n'); err != nil {
		return nil, err
	}
	_ = send(map[string]any{"jsonrpc": "2.0", "method": "initialized", "params": map[string]any{}})
	if err := send(map[string]any{"jsonrpc": "2.0", "id": 2, "method": "model/list", "params": map[string]any{}}); err != nil {
		return nil, err
	}
	for i := 0; i < 20; i++ {
		line, err := reader.ReadString('\n')
		if err != nil {
			return nil, err
		}
		var msg struct {
			ID     int `json:"id"`
			Result struct {
				Data []struct {
					ID              string   `json:"id"`
					Model           string   `json:"model"`
					DisplayName     string   `json:"displayName"`
					Hidden          bool     `json:"hidden"`
					InputModalities []string `json:"inputModalities"`
					IsDefault       bool     `json:"isDefault"`
				} `json:"data"`
			} `json:"result"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal([]byte(line), &msg) != nil || msg.ID != 2 {
			continue
		}
		if msg.Error != nil {
			return nil, errors.New(msg.Error.Message)
		}
		out := []ModelOption{}
		for _, m := range msg.Result.Data {
			if m.Hidden {
				continue
			}
			id := m.Model
			if id == "" {
				id = m.ID
			}
			out = append(out, ModelOption{ID: id, Name: m.DisplayName, Vision: contains(m.InputModalities, "image"), Default: m.IsDefault})
		}
		return out, nil
	}
	return nil, errors.New("model list not returned")
}
