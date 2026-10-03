// Package provider lets each account choose which model runs the in-app
// agent: OpenRouter with the account's own key, or the Claude Code / Codex
// CLIs installed and signed in on the API host. See ADR 0009.
package provider

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/features/chat"
	"timely-api/internal/features/embed"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
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
	CreatedAt            time.Time    `gorm:"column:created_at" json:"-"`
	UpdatedAt            time.Time    `gorm:"column:updated_at" json:"-"`
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
	envKey   string
	envChat  string
	envEmbed string

	openRouterURL string // overridable for tests
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
		envKey:   strings.TrimSpace(os.Getenv("OPENROUTER_API_KEY")),
		envChat:  chatModel, envEmbed: embedModel,
		key: sha256.Sum256([]byte("timely-agent-provider:" + secret)),

		openRouterURL: "https://openrouter.ai/api/v1/chat/completions",
	}
	if indexer != nil {
		indexer.SetCredentials(s.embedCredentials)
	}
	return s
}

func (s *Service) Register(worker *jobs.Worker) {
	worker.Handle(models.JobReindexUser, s.handleReindex)
}

// LocalCLI reports whether host CLIs may be used (CHAT_LOCAL_CLI != off).
func (s *Service) LocalCLI() bool { return s.localCLI }

// ---- storage ----

func (s *Service) load(db *gorm.DB, userID string) (Settings, error) {
	var row Settings
	err := db.Where("user_id = ?", userID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Settings{UserID: userID, DefaultProvider: OpenRouter}, nil
	}
	if row.DefaultProvider == "" {
		row.DefaultProvider = OpenRouter
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

// openRouterKey prefers the account's key and falls back to the server's.
func (s *Service) openRouterKey(row Settings) (string, error) {
	if row.OpenRouterKey != "" {
		return s.decrypt(row.OpenRouterKey)
	}
	return s.envKey, nil
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

func (s *Service) Resolve(ctx context.Context, userID string) (string, string, error) {
	row, err := s.load(s.db.WithContext(ctx), userID)
	if err != nil {
		return "", "", err
	}
	provider := row.DefaultProvider
	if (provider == ClaudeCLI || provider == CodexCLI) && !s.localCLI {
		return provider, "", fmt.Errorf("Local CLIs are turned off on this server (CHAT_LOCAL_CLI=off). Pick another provider in Settings → Agent")
	}
	return provider, s.chatModel(row, provider), nil
}

func (s *Service) Completer(ctx context.Context, userID, provider, model string) (chat.Completer, error) {
	row, err := s.load(s.db.WithContext(ctx), userID)
	if err != nil {
		return nil, err
	}
	if provider == "" {
		provider = row.DefaultProvider
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
			return nil, fmt.Errorf("Add an OpenRouter API key in Settings → Agent (or set OPENROUTER_API_KEY on the server)")
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

// embedCredentials feeds the indexer the account's key and embedding model.
func (s *Service) embedCredentials(userID string) (string, string) {
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
		setState(func(st *ReindexState) { st.Status, st.Error = "failed", err.Error() })
		return err
	}
	setState(func(st *ReindexState) { st.Status, st.Done, st.Total = "done", n, n })
	return nil
}
