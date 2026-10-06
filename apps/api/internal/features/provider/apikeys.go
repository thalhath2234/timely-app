package provider

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/features/chat"
)

// APIKey is one account's connection to a direct API provider (see
// registry.go): the encrypted key, the endpoint it belongs to and the chosen
// chat model. OpenRouter keeps its own columns because embeddings use it.
type APIKey struct {
	UserID    string    `gorm:"primaryKey;column:user_id"`
	Provider  string    `gorm:"primaryKey;column:provider"`
	Key       string    `gorm:"column:api_key"` // AES-256-GCM, base64
	KeyHint   string    `gorm:"column:key_hint"`
	BaseURL   string    `gorm:"column:base_url"`
	Model     string    `gorm:"column:model"`
	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
}

func (APIKey) TableName() string { return "agent_api_keys" }

type apiEndpointView struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	BaseURL string `json:"baseUrl"`
}

type apiView struct {
	ID             string            `json:"id"`
	Label          string            `json:"label"`
	Description    string            `json:"description"`
	KeyURL         string            `json:"keyUrl"`
	KeyPlaceholder string            `json:"keyPlaceholder,omitempty"`
	KeyOptional    bool              `json:"keyOptional"`
	CustomURL      bool              `json:"customUrl"`
	Search         bool              `json:"search"`
	Endpoints      []apiEndpointView `json:"endpoints"`
	Connected      bool              `json:"connected"`
	KeySet         bool              `json:"keySet"`
	KeyHint        string            `json:"keyHint,omitempty"`
	BaseURL        string            `json:"baseUrl"`
	Model          string            `json:"model"`
	Ready          bool              `json:"ready"`
}

func (s *Service) apiRows(db *gorm.DB, userID string) (map[string]APIKey, error) {
	var rows []APIKey
	if err := db.Where("user_id = ?", userID).Find(&rows).Error; err != nil {
		return nil, err
	}
	out := map[string]APIKey{}
	for _, row := range rows {
		out[row.Provider] = row
	}
	return out, nil
}

func (s *Service) apiRow(db *gorm.DB, userID, id string) (APIKey, bool, error) {
	var row APIKey
	err := db.Where("user_id = ? AND provider = ?", userID, id).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return APIKey{UserID: userID, Provider: id}, false, nil
	}
	return row, err == nil, err
}

func (s *Service) saveAPIRow(row *APIKey) error {
	now := time.Now().UTC()
	if row.CreatedAt.IsZero() {
		row.CreatedAt = now
	}
	row.UpdatedAt = now
	return s.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "provider"}}, UpdateAll: true}).Create(row).Error
}

func (s *Service) apiViews(rows map[string]APIKey) []apiView {
	out := make([]apiView, 0, len(apiProviders))
	for _, spec := range apiProviders {
		row, connected := rows[spec.ID]
		v := apiView{ID: spec.ID, Label: spec.Label, Description: spec.Description, KeyURL: spec.KeyURL, KeyPlaceholder: spec.KeyPlaceholder,
			KeyOptional: spec.KeyOptional, CustomURL: spec.CustomURL, Search: spec.Anthropic, Connected: connected, BaseURL: s.defaultBase(spec)}
		for _, e := range spec.Endpoints {
			v.Endpoints = append(v.Endpoints, apiEndpointView{ID: e.ID, Label: e.Label, BaseURL: e.BaseURL})
		}
		if connected {
			v.KeySet, v.KeyHint, v.BaseURL, v.Model = row.Key != "", row.KeyHint, row.BaseURL, row.Model
			v.Ready = (v.KeySet || spec.KeyOptional) && row.Model != ""
		}
		out = append(out, v)
	}
	return out
}

func (s *Service) defaultBase(spec *apiProvider) string {
	if spec.ID == "ollama" && s.ollamaURL != "" {
		return s.ollamaURL
	}
	return spec.Endpoints[0].BaseURL
}

// resolveBase accepts one of the provider's endpoints, or for providers that
// run on the person's own machine (Ollama) a plain http(s) URL.
func (s *Service) resolveBase(spec *apiProvider, requested, current string) (string, error) {
	requested = strings.TrimRight(strings.TrimSpace(requested), "/")
	if requested == "" {
		if current != "" {
			return current, nil
		}
		return s.defaultBase(spec), nil
	}
	for _, e := range spec.Endpoints {
		if requested == strings.TrimRight(e.BaseURL, "/") {
			return e.BaseURL, nil
		}
	}
	if requested == strings.TrimRight(s.defaultBase(spec), "/") {
		return requested, nil
	}
	if !spec.CustomURL {
		return "", fmt.Errorf("Choose one of the listed %s endpoints", spec.Label)
	}
	u, err := url.Parse(requested)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(requested) > 300 {
		return "", errors.New("Enter a plain http:// or https:// address, such as http://192.168.1.20:11434")
	}
	// Link-local addresses host cloud metadata services; Ollama never lives there.
	if ip := net.ParseIP(u.Hostname()); ip != nil && (ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified()) {
		return "", errors.New("That address is not allowed for Ollama")
	}
	return requested, nil
}

// apiKey decrypts the stored key.
func (s *Service) apiKey(row APIKey) (string, error) {
	return s.decrypt(row.Key)
}

func (s *Service) apiModelList(ctx context.Context, spec *apiProvider, base, key string, maxAge time.Duration) ([]ModelOption, error) {
	sum := sha256.Sum256([]byte(base + "\x00" + key))
	cacheKey := "api:" + spec.ID + ":" + hex.EncodeToString(sum[:8])
	return s.models.get(cacheKey, maxAge, func() ([]ModelOption, error) {
		if spec.Anthropic {
			list, effort, err := anthropicModels(ctx, &Anthropic{Key: key, Base: s.anthropicBase(base), Label: spec.Label, Client: s.models.client})
			if err == nil {
				s.models.mu.Lock()
				for id, ok := range effort {
					s.models.effort[id] = ok
				}
				s.models.mu.Unlock()
			}
			return list, err
		}
		if spec.ListModels != nil {
			return spec.ListModels(ctx, s.models.client, spec, base, key)
		}
		return fetchCompatModels(ctx, s.models.client, spec, base, key)
	})
}

// anthropicBase maps the stored endpoint to the SDK's base URL, which has no
// /v1 suffix.
func (s *Service) anthropicBase(base string) string {
	if s.anthropicURL != "" {
		return s.anthropicURL
	}
	return strings.TrimSuffix(strings.TrimRight(base, "/"), "/v1")
}

// pickModel keeps a still-listed choice, else the provider's preferred
// default, else the first listed model.
func pickModel(spec *apiProvider, current string, list []ModelOption) string {
	has := func(id string) bool {
		for _, m := range list {
			if m.ID == id {
				return true
			}
		}
		return false
	}
	if current != "" && (has(current) || len(list) == 0) {
		return current
	}
	for _, id := range spec.Defaults {
		if has(id) {
			return id
		}
	}
	if len(list) > 0 {
		return list[0].ID
	}
	if len(spec.Defaults) > 0 {
		return spec.Defaults[0]
	}
	return ""
}

func (s *Service) buildAPI(spec *apiProvider, row APIKey, model string) (chat.Completer, error) {
	key, err := s.apiKey(row)
	if err != nil {
		return nil, err
	}
	if key == "" && !spec.KeyOptional {
		return nil, fmt.Errorf("Add a %s API key in Settings → Agent", spec.Label)
	}
	if model == "" {
		return nil, fmt.Errorf("Choose a %s model in Settings → Agent", spec.Label)
	}
	base := row.BaseURL
	if base == "" {
		base = s.defaultBase(spec)
	}
	client := &http.Client{Timeout: 4 * time.Minute}
	switch spec.route(model) {
	case routeMessages:
		s.models.mu.Lock()
		effort := s.models.effort[model]
		s.models.mu.Unlock()
		sdkBase := strings.TrimSuffix(strings.TrimRight(base, "/"), "/v1")
		if spec.Anthropic && s.anthropicURL != "" {
			sdkBase = s.anthropicURL
		}
		return &Anthropic{Key: key, Model: model, Base: sdkBase, Effort: spec.Anthropic && effort, Search: spec.Anthropic, Label: spec.Label, Client: client}, nil
	case routeResponses:
		return &Responses{Spec: spec, Base: base, Key: key, Model: model, Client: client}, nil
	case routeOllama:
		return &Ollama{Spec: spec, Base: base, Key: key, Model: model, Client: client}, nil
	case routeChat:
		return &Compat{Spec: spec, Base: base, Key: key, Model: model, Client: client}, nil
	}
	return nil, fmt.Errorf("%s serves %s through a protocol Timely does not support. Choose another model", spec.Label, model)
}

// ---- handlers ----

// setAPIKey checks a key by listing the provider's models (no tokens spent;
// providers with a public list also answer one test call), then stores it
// encrypted with a working default model. An empty key keeps
// the saved one, so an endpoint can change without retyping it.
func (s *Service) setAPIKey(c *echo.Context) error {
	id := c.Param("id")
	if id == OpenRouter {
		return s.setKey(c)
	}
	spec := apiProviderByID(id)
	if spec == nil {
		return echo.NewHTTPError(404, "Unknown provider")
	}
	var in struct {
		Key     string `json:"key"`
		BaseURL string `json:"baseUrl"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "Invalid request")
	}
	ctx := c.Request().Context()
	row, _, err := s.apiRow(s.db, user(c), id)
	if err != nil {
		return err
	}
	key := strings.TrimSpace(in.Key)
	if key != "" && (len(key) < 8 || len(key) > 400 || strings.ContainsAny(key, " \n\t")) {
		return echo.NewHTTPError(400, "That does not look like a "+spec.Label+" API key")
	}
	sealed := row.Key
	if key != "" {
		if sealed, err = s.encrypt(key); err != nil {
			return err
		}
	} else if key, err = s.apiKey(row); err != nil {
		return echo.NewHTTPError(409, err.Error())
	}
	if key == "" && !spec.KeyOptional {
		return echo.NewHTTPError(400, "Paste a "+spec.Label+" API key")
	}
	base, err := s.resolveBase(spec, in.BaseURL, row.BaseURL)
	if err != nil {
		return echo.NewHTTPError(400, err.Error())
	}
	if spec.KeyOptional && in.Key == "" && row.BaseURL != "" && base != row.BaseURL {
		// A saved key belongs to its address (Ollama Cloud); never send it to another.
		key, sealed = "", ""
	}
	list, err := s.apiModelList(ctx, spec, base, key, 0)
	if err != nil {
		return echo.NewHTTPError(409, err.Error())
	}
	row.Key, row.BaseURL, row.Model = sealed, base, pickModel(spec, row.Model, list)
	if spec.PublicList && key != "" && in.Key != "" {
		completer, err := s.buildAPI(spec, row, row.Model)
		if err != nil {
			return echo.NewHTTPError(409, err.Error())
		}
		if err := testCompleter(ctx, completer); err != nil {
			return echo.NewHTTPError(409, spec.Label+" did not accept this key: "+err.Error())
		}
	}
	if in.Key != "" {
		row.KeyHint = hint(key)
	}
	if row.Key == "" {
		row.KeyHint = ""
	}
	if err := s.saveAPIRow(&row); err != nil {
		return err
	}
	return s.respond(c)
}

func (s *Service) removeAPIKey(c *echo.Context) error {
	id := c.Param("id")
	if id == OpenRouter {
		return s.removeKey(c)
	}
	if apiProviderByID(id) == nil {
		return echo.NewHTTPError(404, "Unknown provider")
	}
	if err := s.db.Where("user_id = ? AND provider = ?", user(c), id).Delete(&APIKey{}).Error; err != nil {
		return err
	}
	if _, err := s.update(user(c), func(row *Settings) error {
		if row.DefaultProvider == id {
			row.DefaultProvider = OpenRouter
		}
		return nil
	}); err != nil {
		return err
	}
	return s.respond(c)
}

func (s *Service) respond(c *echo.Context) error {
	row, err := s.load(s.db, user(c))
	if err != nil {
		return err
	}
	return c.JSON(200, s.view(c.Request().Context(), row, time.Minute))
}
