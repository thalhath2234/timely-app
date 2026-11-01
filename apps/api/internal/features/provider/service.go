// Package provider lets each account choose which model runs the in-app
// agent: OpenRouter or a direct API provider (registry.go) with the account's
// own key, or the Claude Code / Codex CLIs installed and signed in on the API
// host. See ADR 0009.
package provider

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/features/agent"
	"timely-api/internal/features/chat"
	"timely-api/internal/features/decide"
	"timely-api/internal/features/embed"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
	"timely-api/internal/utils"
)

const (
	OpenRouter = "openrouter"
	ClaudeCLI  = "claude"
	CodexCLI   = "codex"

	defaultChatModel  = "z-ai/glm-5.3-flash"
	defaultEmbedModel = "openai/text-embedding-3-small"
)

// ReindexState is the progress of the account's semantic-search rebuild after
// its key or embedding model changed.
type ReindexState struct {
	Status    string    `json:"status,omitempty"` // queued, running, done, failed
	Done      int       `json:"done"`
	Total     int       `json:"total"`
	Error     string    `json:"error,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Settings struct {
	UserID               string       `gorm:"primaryKey;column:user_id" json:"-"`
	DefaultProvider      string       `gorm:"column:default_provider" json:"defaultProvider"`
	OpenRouterKey        string       `gorm:"column:openrouter_key" json:"-"` // AES-256-GCM, base64
	OpenRouterKeyHint    string       `gorm:"column:openrouter_key_hint" json:"-"`
	OpenRouterChatModel  string       `gorm:"column:openrouter_chat_model" json:"-"`
	OpenRouterEmbedModel string       `gorm:"column:openrouter_embed_model" json:"-"`
	ClaudeModel          string       `gorm:"column:claude_model" json:"-"`
	ClaudeConnectedAt    *time.Time   `gorm:"column:claude_connected_at" json:"-"`
	CodexModel           string       `gorm:"column:codex_model" json:"-"`
	CodexConnectedAt     *time.Time   `gorm:"column:codex_connected_at" json:"-"`
	Reindex              ReindexState `gorm:"column:reindex;serializer:json;type:jsonb" json:"-"`
	// Smart suggestions (Jev): on by default once a TypeSafe or OpenRouter
	// key exists; TypeSafeRejected is set when TypeSafe refuses the saved key.
	DecisionsOff     bool `gorm:"column:decisions_off" json:"-"`
	TypeSafeRejected bool `gorm:"column:typesafe_rejected" json:"-"`
	// The time of day the person prefers for deep work, which suggestions
	// weigh. Goals moved to their own table (features/focus); the old
	// decision_goals column is no longer read or written.
	DeepWorkTime string    `gorm:"column:deep_work_time" json:"-"`
	CreatedAt    time.Time `gorm:"column:created_at" json:"-"`
	UpdatedAt    time.Time `gorm:"column:updated_at" json:"-"`
}

func (Settings) TableName() string { return "agent_provider_settings" }

type Service struct {
	db       *gorm.DB
	key      [32]byte
	indexer  embed.Indexer
	queue    *jobs.Queue
	models   *catalogue
	claude   *Tool
	codex    *Tool
	localCLI bool
	envChat  string
	envEmbed string

	decisions     *decide.Service
	decisionCheck decide.Caller

	// readTools and boardData let the Describe AI read the person's data and
	// draw its drafts from it (describe_tools.go); nil leaves Describe one-shot.
	readTools func(*gorm.DB) agent.Catalog
	boardData BoardData

	openRouterURL    string // overridable for tests
	openRouterKeyURL string // overridable for tests; checks a key without spending tokens
	anthropicURL     string // overridable for tests
	ollamaURL        string // OLLAMA_BASE_URL: the default Ollama address
}

func New(db *gorm.DB, indexer embed.Indexer, queue *jobs.Queue) *Service {
	secret := strings.TrimSpace(os.Getenv("TIMELY_BACKUP_KEY"))
	if secret == "" {
		secret = os.Getenv("JWT_SECRET")
	}
	chatModel := strings.TrimSpace(os.Getenv("OPENROUTER_CHAT_MODEL"))
	if chatModel == "" {
		chatModel = defaultChatModel
	}
	embedModel := strings.TrimSpace(os.Getenv("OPENROUTER_EMBED_MODEL"))
	if embedModel == "" {
		embedModel = defaultEmbedModel
	}
	s := &Service{
		db: db, indexer: indexer, queue: queue, models: newCatalogue(),
		claude:   &Tool{Name: "claude", EnvVar: "CLAUDE_BIN"},
		codex:    &Tool{Name: "codex", EnvVar: "CODEX_BIN"},
		localCLI: !strings.EqualFold(strings.TrimSpace(os.Getenv("CHAT_LOCAL_CLI")), "off"),
		envChat:  chatModel, envEmbed: embedModel,
		key: sha256.Sum256([]byte("timely-agent-provider:" + secret)),

		openRouterURL:    "https://openrouter.ai/api/v1/chat/completions",
		openRouterKeyURL: "https://openrouter.ai/api/v1/key",
		ollamaURL:        strings.TrimRight(strings.TrimSpace(os.Getenv("OLLAMA_BASE_URL")), "/"),
	}
	if indexer != nil {
		indexer.SetCredentials(s.EmbedCredentials)
	}
	return s
}

func (s *Service) Register(worker *jobs.Worker) {
	worker.Handle(models.JobReindexUser, s.handleReindex)
}

// LocalCLI reports whether host CLIs may be used (CHAT_LOCAL_CLI != off).
func (s *Service) LocalCLI() bool { return s.localCLI }

// ---- storage ----

// An empty DefaultProvider means the person has not picked one: runs then use
// the first ready provider in autoProvider's order.
func (s *Service) load(db *gorm.DB, userID string) (Settings, error) {
	var row Settings
	err := db.Where("user_id = ?", userID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Settings{UserID: userID}, nil
	}
	return row, err
}

func (s *Service) save(db *gorm.DB, row *Settings) error {
	now := time.Now().UTC()
	if row.CreatedAt.IsZero() {
		row.CreatedAt = now
	}
	row.UpdatedAt = now
	return db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}}, UpdateAll: true}).Create(row).Error
}

// update applies fn under a row lock so concurrent saves and reindex progress
// never clobber each other.
func (s *Service) update(userID string, fn func(*Settings) error) (Settings, error) {
	var row Settings
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var err error
		row, err = s.load(tx.Clauses(clause.Locking{Strength: "UPDATE"}), userID)
		if err != nil {
			return err
		}
		if err := fn(&row); err != nil {
			return err
		}
		return s.save(tx, &row)
	})
	return row, err
}

func (s *Service) encrypt(plain string) (string, error) {
	block, err := aes.NewCipher(s.key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(plain), nil)), nil
}

func (s *Service) decrypt(sealed string) (string, error) {
	if sealed == "" {
		return "", nil
	}
	raw, err := base64.StdEncoding.DecodeString(sealed)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(s.key[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("stored key is unreadable")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	if err != nil {
		return "", errors.New("stored key is unreadable; replace it")
	}
	return string(plain), nil
}

func hint(key string) string {
	if len(key) <= 4 {
		return "…"
	}
	return "…" + key[len(key)-4:]
}

// ---- resolution for chat runs ----

// openRouterKey is the account's own key; there is no server-wide key.
func (s *Service) openRouterKey(row Settings) (string, error) {
	return s.decrypt(row.OpenRouterKey)
}

func (s *Service) chatModel(row Settings, provider string) string {
	switch provider {
	case ClaudeCLI:
		if row.ClaudeModel != "" {
			return row.ClaudeModel
		}
		return defaultClaudeModel
	case CodexCLI:
		if row.CodexModel != "" {
			return row.CodexModel
		}
		if list, err := s.models.CodexModels(context.Background(), s.codex.Locate()); err == nil {
			for _, m := range list {
				if m.Default {
					return m.ID
				}
			}
			if len(list) > 0 {
				return list[0].ID
			}
		}
		return ""
	default:
		if row.OpenRouterChatModel != "" {
			return row.OpenRouterChatModel
		}
		return s.envChat
	}
}

// errNoProvider is the answer when no provider is chosen and none is set up.
var errNoProvider = errors.New("No AI provider is set up. Add an API key or connect one in Settings → Agent")

// defaultProvider is the provider new chat runs and the writing features
// (Help me write, checklist task offers, view queries, dashboard cards) use:
// the person's choice, else autoProvider's pick ("" when nothing is set up).
// Both read it here so they never move to different providers.
func (s *Service) defaultProvider(ctx context.Context, row Settings) (string, error) {
	if row.DefaultProvider != "" {
		return row.DefaultProvider, nil
	}
	rows, err := s.apiRows(s.db.WithContext(ctx), row.UserID)
	if err != nil {
		return "", err
	}
	return autoProvider(row, rows, s.localCLI), nil
}

func (s *Service) Resolve(ctx context.Context, userID string) (string, string, error) {
	row, err := s.load(s.db.WithContext(ctx), userID)
	if err != nil {
		return "", "", err
	}
	provider, err := s.defaultProvider(ctx, row)
	if err != nil {
		return "", "", err
	}
	if provider == "" {
		return "", "", errNoProvider
	}
	if (provider == ClaudeCLI || provider == CodexCLI) && !s.localCLI {
		return provider, "", fmt.Errorf("Local CLIs are turned off on this server (CHAT_LOCAL_CLI=off). Pick another provider in Settings → Agent")
	}
	if spec := apiProviderByID(provider); spec != nil {
		api, _, err := s.apiRow(s.db.WithContext(ctx), userID, provider)
		if err != nil {
			return provider, "", err
		}
		return provider, api.Model, nil
	}
	return provider, s.chatModel(row, provider), nil
}

func (s *Service) Completer(ctx context.Context, userID, provider, model string) (chat.Completer, error) {
	row, err := s.load(s.db.WithContext(ctx), userID)
	if err != nil {
		return nil, err
	}
	if provider == "" {
		if provider, err = s.defaultProvider(ctx, row); err != nil {
			return nil, err
		}
		if provider == "" {
			return nil, errNoProvider
		}
	}
	if spec := apiProviderByID(provider); spec != nil {
		api, found, err := s.apiRow(s.db.WithContext(ctx), userID, provider)
		if err != nil {
			return nil, err
		}
		if !found {
			return nil, fmt.Errorf("%s is not connected. Add its key in Settings → Agent", spec.Label)
		}
		if model == "" {
			model = api.Model
		}
		return s.buildAPI(spec, api, model)
	}
	if model == "" {
		model = s.chatModel(row, provider)
	}
	return s.build(row, provider, model)
}

func (s *Service) build(row Settings, provider, model string) (chat.Completer, error) {
	switch provider {
	case OpenRouter:
		key, err := s.openRouterKey(row)
		if err != nil {
			return nil, err
		}
		if key == "" {
			return nil, fmt.Errorf("Add an OpenRouter API key in Settings → Agent")
		}
		return &chat.OpenRouter{Key: key, Model: model, URL: s.openRouterURL, Client: &http.Client{Timeout: 4 * time.Minute}}, nil
	case ClaudeCLI:
		if !s.localCLI {
			return nil, fmt.Errorf("Local CLIs are turned off on this server (CHAT_LOCAL_CLI=off)")
		}
		bin := s.claude.Locate()
		if bin == "" {
			return nil, fmt.Errorf("Claude Code was not found on the server. Reconnect it in Settings → Agent")
		}
		if row.ClaudeConnectedAt == nil {
			return nil, fmt.Errorf("Claude is not connected. Open Settings → Agent and press Connect")
		}
		return &Claude{Bin: bin, Model: model}, nil
	case CodexCLI:
		if !s.localCLI {
			return nil, fmt.Errorf("Local CLIs are turned off on this server (CHAT_LOCAL_CLI=off)")
		}
		bin := s.codex.Locate()
		if bin == "" {
			return nil, fmt.Errorf("Codex was not found on the server. Reconnect it in Settings → Agent")
		}
		if row.CodexConnectedAt == nil {
			return nil, fmt.Errorf("Codex is not connected. Open Settings → Agent and press Connect")
		}
		if model == "" {
			return nil, fmt.Errorf("Choose a Codex model in Settings → Agent")
		}
		return &Codex{Bin: bin, Model: model}, nil
	}
	return nil, fmt.Errorf("Unknown AI provider %q. Pick one in Settings → Agent", provider)
}

// EmbedCredentials feeds an indexer the account's key and embedding model.
func (s *Service) EmbedCredentials(userID string) (string, string) {
	row, err := s.load(s.db, userID)
	if err != nil {
		return "", ""
	}
	key, err := s.openRouterKey(row)
	if err != nil {
		return "", ""
	}
	model := row.OpenRouterEmbedModel
	if model == "" {
		model = s.envEmbed
	}
	return key, model
}

// checkOpenRouterKey asks OpenRouter whether a key is valid. The key endpoint
// spends no tokens and sends no chat, so a key saved only for embeddings and
// smart suggestions never runs a chat model.
func (s *Service) checkOpenRouterKey(ctx context.Context, key string) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.openRouterKeyURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	res, err := s.models.client.Do(req)
	if err != nil {
		return fmt.Errorf("Could not reach OpenRouter to check this key. Try again")
	}
	defer res.Body.Close()
	var body struct {
		Data struct {
			// LimitRemaining is null for a key with no spending limit.
			LimitRemaining *float64 `json:"limit_remaining"`
		} `json:"data"`
	}
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<16))
	switch {
	case res.StatusCode/100 == 2:
		// A key whose own limit is spent still reads as valid here, but every
		// embedding and Jev call would fail with it.
		if json.Unmarshal(raw, &body) == nil && body.Data.LimitRemaining != nil && *body.Data.LimitRemaining <= 0 {
			return errors.New("This OpenRouter key has used up its credit limit. Raise the limit on openrouter.ai or use another key")
		}
		return nil
	case res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden:
		return errors.New("OpenRouter rejected this key")
	default:
		return fmt.Errorf("OpenRouter could not check this key (HTTP %d). Try again", res.StatusCode)
	}
}

// testCompleter sends one tiny request so a saved model or key is known to work.
func testCompleter(ctx context.Context, c chat.Completer) error {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	reply, err := c.Complete(ctx, []chat.WireMessage{{Role: "system", Content: "You are a connectivity check."}, {Role: "user", Content: "Reply with the single word OK."}}, nil, false)
	if err != nil {
		return err
	}
	if strings.TrimSpace(reply.Content) == "" && len(reply.ToolCalls) == 0 {
		return errors.New("The provider returned an empty answer")
	}
	return nil
}

// ---- reindex ----

func (s *Service) enqueueReindex(userID string) error {
	if s.queue == nil {
		return nil
	}
	_, err := s.queue.Enqueue(jobs.Enqueue{UserID: userID, Kind: models.JobReindexUser, DedupeKey: "reindex:" + userID, RunAt: time.Now().UTC()})
	return err
}

// QueueReindex marks the account's search index as being rebuilt and queues
// the rebuild, as after a restore. Accounts without embeddings are left alone.
func (s *Service) QueueReindex(userID string) error {
	if s.indexer == nil || s.queue == nil || !s.indexer.EnabledFor(userID) {
		return nil
	}
	if _, err := s.update(userID, func(row *Settings) error {
		row.Reindex = ReindexState{Status: "queued", UpdatedAt: time.Now().UTC()}
		return nil
	}); err != nil {
		return err
	}
	return s.enqueueReindex(userID)
}

// retryFailedReindexAfter is how long a failed rebuild is left alone before
// a search or Settings may queue another one; Settings shows the failure
// meanwhile.
const retryFailedReindexAfter = 30 * time.Minute

// EnsureIndex queues a rebuild for an account whose index is missing items
// (see embed.Indexer.Missing), unless one is already on the way or one
// failed recently.
func (s *Service) EnsureIndex(userID string) {
	if s.indexer == nil || s.queue == nil || !s.indexer.EnabledFor(userID) {
		return
	}
	row, err := s.load(s.db, userID)
	if err != nil {
		log.Printf("ensure search index: %v", err)
		return
	}
	switch st := row.Reindex; {
	case st.Status == "queued" || st.Status == "running":
		// The job may be gone (a restore deletes the account's jobs); the
		// dedupe key makes this a no-op when it is still there.
		if err := s.enqueueReindex(userID); err != nil {
			log.Printf("ensure search index: %v", err)
		}
		return
	case st.Status == "failed" && time.Since(st.UpdatedAt) < retryFailedReindexAfter:
		return
	}
	if err := s.QueueReindex(userID); err != nil {
		log.Printf("ensure search index: %v", err)
	}
}

// checkIndex keeps the Settings index status truthful: an index reported as
// done that is missing items gets a rebuild, which Settings then shows.
func (s *Service) checkIndex(ctx context.Context, userID string) {
	if s.indexer == nil || !s.indexer.EnabledFor(userID) {
		return
	}
	missing, err := s.indexer.Missing(ctx, userID)
	if err != nil || missing == 0 {
		return
	}
	s.EnsureIndex(userID)
}

func (s *Service) handleReindex(ctx context.Context, job *models.Job) error {
	if s.indexer == nil {
		return nil
	}
	setState := func(fn func(*ReindexState)) {
		_, _ = s.update(job.UserID, func(row *Settings) error {
			fn(&row.Reindex)
			row.Reindex.UpdatedAt = time.Now().UTC()
			return nil
		})
	}
	setState(func(st *ReindexState) { st.Status, st.Done, st.Error = "running", 0, "" })
	last := time.Now()
	n, err := s.indexer.Reindex(ctx, job.UserID, func(done, total int) {
		if time.Since(last) < 2*time.Second && done != total {
			return
		}
		last = time.Now()
		setState(func(st *ReindexState) { st.Done, st.Total = done, total })
	})
	if errors.Is(err, embed.ErrDisabled) {
		setState(func(st *ReindexState) { st.Status, st.Error = "failed", "Semantic search is off: no OpenRouter key" })
		return nil
	}
	if err != nil {
		// The error usually quotes OpenRouter. The state is jsonb, which
		// refuses a NUL: an unsaved failure would leave the status "running",
		// and EnsureIndex would queue a new rebuild on every look.
		setState(func(st *ReindexState) { st.Status, st.Error = "failed", utils.StorableText(err.Error(), 500) })
		return err
	}
	setState(func(st *ReindexState) { st.Status, st.Done, st.Total = "done", n, n })
	return nil
}
