package provider

import (
	"context"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/features/chat"
)

// The account's web search key (Q-3.8, plan 8.2). Without one, the agent's
// web_search and web_extract use the timely backend: the chat provider's own
// search and Timely's page reader. A key here switches both to that search
// service; the key reaches the agent's worker as an environment tool key
// under the service's Hermes name (WebToolKeys), so a change restarts the
// worker once it is idle (SetWebKeyChanged). Keys are sealed like provider
// keys, shown only as a hint, and never backed up.

// WebKey is one account's search service key.
type WebKey struct {
	UserID    string    `gorm:"primaryKey;column:user_id"`
	Backend   string    `gorm:"column:backend"`
	Key       string    `gorm:"column:api_key"` // AES-256-GCM, base64
	KeyHint   string    `gorm:"column:key_hint"`
	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
}

func (WebKey) TableName() string { return "agent_web_keys" }

// TimelyWebBackend is the worker's web backend without a key: Go answers its
// searches with the chat provider and reads its pages (chat/web.go).
const TimelyWebBackend = "timely"

// webBackend is a search service a key can be saved for: its Hermes backend
// id (plugins/web/<id>), the environment name its key goes under, and where
// to get one. listed services are offered while the worker has not said
// which it can run (the backends the timely_web README documents).
type webBackend struct {
	ID, Label, KeyURL, Env string
	listed                 bool
}

var webBackends = []webBackend{
	{ID: "exa", Label: "Exa", KeyURL: "https://dashboard.exa.ai/api-keys", Env: "EXA_API_KEY", listed: true},
	{ID: "firecrawl", Label: "Firecrawl", KeyURL: "https://www.firecrawl.dev/app/api-keys", Env: "FIRECRAWL_API_KEY", listed: true},
	{ID: "parallel", Label: "Parallel", KeyURL: "https://platform.parallel.ai/", Env: "PARALLEL_API_KEY", listed: true},
	{ID: "tavily", Label: "Tavily", KeyURL: "https://app.tavily.com/home", Env: "TAVILY_API_KEY"},
}

func webBackendByID(id string) *webBackend {
	for i := range webBackends {
		if webBackends[i].ID == id {
			return &webBackends[i]
		}
	}
	return nil
}

// webHooks are a Service's web key callbacks, kept beside it.
type webHooks struct {
	mu       sync.Mutex
	changed  func(uid string)
	backends func(uid string) []string
}

var webHooksOf sync.Map // *Service -> *webHooks

func (s *Service) webHooks() *webHooks {
	h, _ := webHooksOf.LoadOrStore(s, &webHooks{})
	return h.(*webHooks)
}

// SetWebKeyChanged is called with the account after its web key was saved
// or removed: the API restarts the account's worker once it is idle, so the
// new tool key and backend take effect.
func (s *Service) SetWebKeyChanged(fn func(uid string)) {
	h := s.webHooks()
	h.mu.Lock()
	h.changed = fn
	h.mu.Unlock()
}

// SetWebBackends tells Settings which keyed backends the account's worker
// can run (its ready.web_backends); fn answers nil while that is unknown
// (no worker yet, or a runtime that does not say), and the listed ones are
// offered then.
func (s *Service) SetWebBackends(fn func(uid string) []string) {
	h := s.webHooks()
	h.mu.Lock()
	h.backends = fn
	h.mu.Unlock()
}

func (s *Service) webKeyChanged(uid string) {
	h := s.webHooks()
	h.mu.Lock()
	fn := h.changed
	h.mu.Unlock()
	if fn != nil {
		fn(uid)
	}
}

// availableWebBackends reports which keyed backends the account may pick.
func (s *Service) availableWebBackends(uid string) map[string]bool {
	h := s.webHooks()
	h.mu.Lock()
	fn := h.backends
	h.mu.Unlock()
	var known []string
	if fn != nil {
		known = fn(uid)
	}
	out := map[string]bool{}
	for _, b := range webBackends {
		if len(known) == 0 {
			out[b.ID] = b.listed
		} else {
			out[b.ID] = slices.Contains(known, b.ID)
		}
	}
	return out
}

// WebToolKeys is the account's web backend for the worker's config
// (render-account web.search_backend and extract_backend) and its key under
// the backend's Hermes environment name, for the worker's environment. No
// key gives the timely backend and no environment.
func (s *Service) WebToolKeys(ctx context.Context, uid string) (backend string, env map[string]string, err error) {
	row, found, err := s.webKeyRow(s.db.WithContext(ctx), uid)
	if err != nil || !found {
		return TimelyWebBackend, nil, err
	}
	spec := webBackendByID(row.Backend)
	if spec == nil {
		return TimelyWebBackend, nil, nil
	}
	key, err := s.decrypt(row.Key)
	if err != nil {
		return TimelyWebBackend, nil, err
	}
	return spec.ID, map[string]string{spec.Env: key}, nil
}

func (s *Service) webKeyRow(db *gorm.DB, uid string) (WebKey, bool, error) {
	var rows []WebKey
	if err := db.Where("user_id = ?", uid).Limit(1).Find(&rows).Error; err != nil {
		return WebKey{}, false, err
	}
	if len(rows) == 0 {
		return WebKey{}, false, nil
	}
	return rows[0], true, nil
}

// webKeysView is GET/PUT/DELETE /agent/web-keys. It never carries the key.
type webKeysView struct {
	Active   *webKeyActive    `json:"active"`
	Backends []webBackendView `json:"backends"`
	// UsesProvider is set while no key is saved: searches use the chat
	// provider's own search. ProviderCanSearch says whether that provider
	// has one; without it, web search asks for a key (ADR 0009).
	UsesProvider      bool `json:"usesProvider"`
	ProviderCanSearch bool `json:"providerCanSearch"`
}

type webKeyActive struct {
	Backend string `json:"backend"`
	Label   string `json:"label"`
	KeyHint string `json:"keyHint"`
}

type webBackendView struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	KeyURL    string `json:"keyUrl"`
	Available bool   `json:"available"`
}

func (s *Service) webKeysView(ctx context.Context, uid string) (webKeysView, error) {
	row, found, err := s.webKeyRow(s.db.WithContext(ctx), uid)
	if err != nil {
		return webKeysView{}, err
	}
	available := s.availableWebBackends(uid)
	out := webKeysView{Backends: []webBackendView{}, UsesProvider: !found, ProviderCanSearch: s.providerCanSearch(ctx, uid)}
	for _, b := range webBackends {
		if b.listed || available[b.ID] {
			out.Backends = append(out.Backends, webBackendView{ID: b.ID, Label: b.Label, KeyURL: b.KeyURL, Available: available[b.ID]})
		}
	}
	if found {
		label := row.Backend
		if spec := webBackendByID(row.Backend); spec != nil {
			label = spec.Label
		}
		out.Active = &webKeyActive{Backend: row.Backend, Label: label, KeyHint: row.KeyHint}
	}
	return out, nil
}

// providerCanSearch reports whether the account's chat provider has a web
// search of its own (chat.Searcher; Claude Code and Codex do).
func (s *Service) providerCanSearch(ctx context.Context, uid string) bool {
	completer, err := s.Completer(ctx, uid, "", "")
	if err != nil {
		return false
	}
	if searcher, ok := completer.(chat.Searcher); ok {
		return searcher.CanSearch()
	}
	return true
}

func (s *Service) webKeys(c *echo.Context) error {
	view, err := s.webKeysView(c.Request().Context(), user(c))
	if err != nil {
		return err
	}
	return c.JSON(200, view)
}

func (s *Service) setWebKey(c *echo.Context) error {
	uid := user(c)
	var in struct {
		Backend string `json:"backend"`
		Key     string `json:"key"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "Invalid request")
	}
	spec := webBackendByID(strings.TrimSpace(in.Backend))
	if spec == nil {
		return echo.NewHTTPError(400, "Choose one of the listed search services")
	}
	if !s.availableWebBackends(uid)[spec.ID] {
		return echo.NewHTTPError(409, spec.Label+" is not installed with this server's assistant")
	}
	key := strings.TrimSpace(in.Key)
	if len(key) < 8 || len(key) > 400 || strings.ContainsAny(key, " \n\t\r\x00") {
		return echo.NewHTTPError(400, "That does not look like a "+spec.Label+" key")
	}
	sealed, err := s.encrypt(key)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	row := WebKey{UserID: uid, Backend: spec.ID, Key: sealed, KeyHint: hint(key), CreatedAt: now, UpdatedAt: now}
	if err := s.db.WithContext(c.Request().Context()).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"backend", "api_key", "key_hint", "updated_at"}),
	}).Create(&row).Error; err != nil {
		return err
	}
	s.webKeyChanged(uid)
	return s.webKeys(c)
}

func (s *Service) removeWebKey(c *echo.Context) error {
	uid := user(c)
	result := s.db.WithContext(c.Request().Context()).Where("user_id = ?", uid).Delete(&WebKey{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected > 0 {
		s.webKeyChanged(uid)
	}
	return s.webKeys(c)
}
