package provider

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/features/decide"
	"timely-api/internal/features/embed"
)

func user(c *echo.Context) string { v, _ := c.Get("userID").(string); return v }

// oneShotPerUser is how many one-shot AI requests (Help me write, checklist
// names, view queries, card descriptions) one account may have running at
// once. The apps send one at a time and cancel the one before, so only a
// script or a stuck client reaches it; each request costs a model call.
const oneShotPerUser = 4

// inFlight counts requests in flight per account.
type inFlight struct {
	mu sync.Mutex
	n  map[string]int
}

func (f *inFlight) take(id string, limit int) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.n == nil {
		f.n = map[string]int{}
	}
	if f.n[id] >= limit {
		return false
	}
	f.n[id]++
	return true
}

func (f *inFlight) give(id string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.n[id]--; f.n[id] <= 0 {
		delete(f.n, id)
	}
}

// oneShotLimit answers 429 while the account already has oneShotPerUser
// one-shot AI requests running.
func (s *Service) oneShotLimit(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c *echo.Context) error {
		id := user(c)
		if !s.busy.take(id, oneShotPerUser) {
			return echo.NewHTTPError(429, "Too many AI requests at once. Wait for one to finish, then try again")
		}
		defer s.busy.give(id)
		return next(c)
	}
}

func (s *Service) Routes(g *echo.Group) {
	g.GET("/agent/providers", s.overview)
	g.POST("/agent/providers/rescan", s.rescan)
	g.PATCH("/agent/providers", s.configure)
	g.GET("/agent/providers/:id/models", s.listModels)
	g.POST("/agent/providers/:id/connect", s.connect)
	g.POST("/agent/providers/:id/disconnect", s.disconnect)
	g.POST("/agent/providers/:id/key", s.setAPIKey)
	g.DELETE("/agent/providers/:id/key", s.removeAPIKey)
	g.POST("/agent/write", s.write, s.oneShotLimit)
	g.POST("/agent/checklist-tasks", s.checklistTasks, s.oneShotLimit)
	g.POST("/agent/view-query", s.viewQuery, s.oneShotLimit)
	g.POST("/agent/dashboard-card", s.dashboardCard, s.oneShotLimit)
	g.GET("/agent/decisions", s.decisionsOverview)
	g.PATCH("/agent/decisions", s.configureDecisions)
	g.POST("/agent/decisions/key", s.setTypeSafeKey)
	g.DELETE("/agent/decisions/key", s.removeTypeSafeKey)
	g.POST("/agent/decisions/feedback", s.decisionFeedback)
	g.GET("/agent/decisions/learned", s.decisionsLearned)
	g.POST("/agent/decisions/learned/reset", s.resetLearned)
	g.POST("/agent/decisions/test", s.testDecisions)
}

type cliView struct {
	Enabled     bool       `json:"enabled"`
	Status      Status     `json:"status"`
	Connected   bool       `json:"connected"`
	ConnectedAt *time.Time `json:"connectedAt,omitempty"`
	Model       string     `json:"model"`
	Ready       bool       `json:"ready"`
}

type openRouterView struct {
	KeySet     bool   `json:"keySet"`
	KeyHint    string `json:"keyHint,omitempty"`
	ChatModel  string `json:"chatModel"`
	EmbedModel string `json:"embedModel"`
	Ready      bool   `json:"ready"`
}

type overview struct {
	// DefaultProvider is the provider the person chose for new runs and the
	// writing features; "" until they choose one, and then those wait
	// (ADR 0020). DefaultChosen says the same as a flag.
	DefaultProvider string         `json:"defaultProvider"`
	DefaultChosen   bool           `json:"defaultChosen"`
	LocalCLI        bool           `json:"localCli"`
	OpenRouter      openRouterView `json:"openrouter"`
	Claude          cliView        `json:"claude"`
	Codex           cliView        `json:"codex"`
	APIs            []apiView      `json:"apiProviders"`
	Reindex         ReindexState   `json:"reindex"`
}

func (s *Service) view(ctx context.Context, row Settings, maxAge time.Duration) overview {
	out := overview{DefaultProvider: row.DefaultProvider, LocalCLI: s.localCLI, Reindex: row.Reindex}
	out.OpenRouter = openRouterView{KeySet: row.OpenRouterKey != "", KeyHint: row.OpenRouterKeyHint, ChatModel: s.chatModel(row, OpenRouter)}
	out.OpenRouter.EmbedModel = row.OpenRouterEmbedModel
	if out.OpenRouter.EmbedModel == "" {
		out.OpenRouter.EmbedModel = s.envEmbed
	}
	out.OpenRouter.Ready = out.OpenRouter.KeySet
	// Runs read the rows again through defaultProvider, which returns this error.
	rows, _ := s.apiRows(s.db.WithContext(ctx), row.UserID)
	out.APIs = s.apiViews(rows)
	if s.localCLI {
		claude := s.claude.Check(ctx, maxAge)
		out.Claude = cliView{Enabled: true, Status: claude, Connected: row.ClaudeConnectedAt != nil, ConnectedAt: row.ClaudeConnectedAt, Model: s.chatModel(row, ClaudeCLI)}
		out.Claude.Ready = out.Claude.Connected && claude.Found && claude.LoggedIn
		codex := s.codex.Check(ctx, maxAge)
		out.Codex = cliView{Enabled: true, Status: codex, Connected: row.CodexConnectedAt != nil, ConnectedAt: row.CodexConnectedAt, Model: s.chatModel(row, CodexCLI)}
		out.Codex.Ready = out.Codex.Connected && codex.Found && codex.LoggedIn
	}
	out.DefaultChosen = out.DefaultProvider != ""
	return out
}

// firstSetUp is the first provider the account has set up, direct API keys
// first (registry order), then a connected CLI, and OpenRouter last; "" when
// none is. It is never picked for the person: it only tells "nothing set up"
// (the add-a-key message) from "set up but not chosen" (errNotChosen).
//
// It reads stored settings only, so a run never waits on a CLI check.
func firstSetUp(row Settings, rows map[string]APIKey, localCLI bool) string {
	for _, spec := range apiProviders {
		if api, ok := rows[spec.ID]; ok && (api.Key != "" || spec.KeyOptional) {
			return spec.ID
		}
	}
	if localCLI && row.ClaudeConnectedAt != nil {
		return ClaudeCLI
	}
	if localCLI && row.CodexConnectedAt != nil {
		return CodexCLI
	}
	if row.OpenRouterKey != "" {
		return OpenRouter
	}
	return ""
}

func (s *Service) overview(c *echo.Context) error {
	s.checkIndex(c.Request().Context(), user(c))
	row, err := s.load(s.db, user(c))
	if err != nil {
		return err
	}
	return c.JSON(200, s.view(c.Request().Context(), row, time.Minute))
}

// rescan drops the cached CLI detection and detects again, so a person who
// just installed or signed in to a CLI sees it without waiting for the cache.
func (s *Service) rescan(c *echo.Context) error {
	s.claude.Invalidate()
	s.codex.Invalidate()
	row, err := s.load(s.db, user(c))
	if err != nil {
		return err
	}
	return c.JSON(200, s.view(c.Request().Context(), row, 0))
}

func (s *Service) listModels(c *echo.Context) error {
	ctx := c.Request().Context()
	var list []ModelOption
	var err error
	switch c.Param("id") {
	case OpenRouter:
		if c.QueryParam("kind") == "embed" {
			list, err = s.models.OpenRouterEmbedModels(ctx, s.envEmbed)
		} else {
			list, err = s.models.OpenRouterChatModels(ctx, s.envChat)
		}
	case ClaudeCLI:
		list = append([]ModelOption{}, claudeModels...)
	case CodexCLI:
		if !s.localCLI {
			return echo.NewHTTPError(404, "Local CLIs are turned off on this server")
		}
		bin := s.codex.Locate()
		if bin == "" {
			return echo.NewHTTPError(409, "Codex was not found on the server")
		}
		list, err = s.models.CodexModels(ctx, bin)
	default:
		spec := apiProviderByID(c.Param("id"))
		if spec == nil {
			return echo.NewHTTPError(404, "Unknown provider")
		}
		// Distinct names: a := here would shadow err, and a failed list
		// would be answered 200 with no models and no reason.
		row, found, rowErr := s.apiRow(s.db, user(c), spec.ID)
		if rowErr != nil {
			return rowErr
		}
		if !found && !spec.KeyOptional {
			return echo.NewHTTPError(409, "Add "+apiKeyName(spec)+" first")
		}
		key, keyErr := s.apiKey(row)
		if keyErr != nil {
			return echo.NewHTTPError(409, keyErr.Error())
		}
		base := row.BaseURL
		if base == "" {
			base = s.defaultBase(spec)
		}
		list, err = s.apiModelList(ctx, spec, base, key, 10*time.Minute)
		if err == nil && row.Model != "" {
			for i := range list {
				list[i].Default = list[i].ID == row.Model
			}
		}
	}
	if err != nil {
		// 409, not 502: the apps take a 502 on a GET for an API restart and
		// send it again four times, asking the provider each time.
		return echo.NewHTTPError(409, err.Error())
	}
	return c.JSON(200, list)
}

// connect verifies a CLI end to end: found, signed in, and one test call with
// the saved model. A failure clears the connected state.
func (s *Service) connect(c *echo.Context) error {
	ctx := c.Request().Context()
	id := c.Param("id")
	if id != ClaudeCLI && id != CodexCLI {
		return echo.NewHTTPError(404, "Unknown provider")
	}
	if !s.localCLI {
		return echo.NewHTTPError(409, "Local CLIs are turned off on this server (CHAT_LOCAL_CLI=off)")
	}
	tool := s.claude
	if id == CodexCLI {
		tool = s.codex
	}
	tool.Invalidate()
	status := tool.Check(ctx, 0)
	row, err := s.load(s.db, user(c))
	if err != nil {
		return err
	}
	var verifyErr error
	if !status.Found || !status.LoggedIn {
		verifyErr = errors.New(status.Error)
	} else {
		if id == CodexCLI {
			s.models.CodexModels(ctx, status.Path) // warm the list so a default model exists
		}
		trial := row
		now := time.Now().UTC()
		if id == ClaudeCLI {
			trial.ClaudeConnectedAt = &now
		} else {
			trial.CodexConnectedAt = &now
		}
		completer, err := s.build(trial, id, s.chatModel(trial, id))
		if err != nil {
			verifyErr = err
		} else {
			verifyErr = testCompleter(ctx, completer)
		}
	}
	row, err = s.update(user(c), func(row *Settings) error {
		now := time.Now().UTC()
		var stamp *time.Time
		if verifyErr == nil {
			stamp = &now
		}
		if id == ClaudeCLI {
			row.ClaudeConnectedAt = stamp
		} else {
			row.CodexConnectedAt = stamp
		}
		return nil
	})
	if err != nil {
		return err
	}
	if verifyErr != nil {
		return echo.NewHTTPError(409, verifyErr.Error())
	}
	return c.JSON(200, s.view(ctx, row, 0))
}

func (s *Service) disconnect(c *echo.Context) error {
	id := c.Param("id")
	if id != ClaudeCLI && id != CodexCLI {
		return echo.NewHTTPError(404, "Unknown provider")
	}
	row, err := s.update(user(c), func(row *Settings) error {
		if id == ClaudeCLI {
			row.ClaudeConnectedAt = nil
		} else {
			row.CodexConnectedAt = nil
		}
		if row.DefaultProvider == id {
			row.DefaultProvider = ""
		}
		return nil
	})
	if err != nil {
		return err
	}
	return c.JSON(200, s.view(c.Request().Context(), row, time.Minute))
}

// setKey checks the key with OpenRouter's key endpoint, which spends no
// tokens, before storing it encrypted. The response never includes the key.
func (s *Service) setKey(c *echo.Context) error {
	var in struct {
		Key string `json:"key"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "Invalid request")
	}
	key := strings.TrimSpace(in.Key)
	if len(key) < 8 || len(key) > 400 || strings.ContainsAny(key, " \n\t") {
		return echo.NewHTTPError(400, "That does not look like an OpenRouter API key")
	}
	ctx := c.Request().Context()
	sealed, err := s.encrypt(key)
	if err != nil {
		return err
	}
	// The key also drives embeddings and smart suggestions, so it is checked
	// without a chat call; the chat model is tested when OpenRouter becomes the
	// provider for runs.
	if err := s.checkOpenRouterKey(ctx, key); err != nil {
		return echo.NewHTTPError(409, err.Error())
	}
	row, err := s.update(user(c), func(row *Settings) error {
		row.OpenRouterKey = sealed
		row.OpenRouterKeyHint = hint(key)
		row.Reindex = ReindexState{Status: "queued", UpdatedAt: time.Now().UTC()}
		return nil
	})
	if err != nil {
		return err
	}
	if err := s.enqueueReindex(user(c)); err != nil {
		return err
	}
	return c.JSON(200, s.view(ctx, row, time.Minute))
}

func (s *Service) removeKey(c *echo.Context) error {
	row, err := s.update(user(c), func(row *Settings) error {
		row.OpenRouterKey = ""
		row.OpenRouterKeyHint = ""
		if row.DefaultProvider == OpenRouter {
			row.DefaultProvider = ""
		}
		return nil
	})
	if err != nil {
		return err
	}
	return c.JSON(200, s.view(c.Request().Context(), row, time.Minute))
}

// configure saves the default provider and per-provider models. A changed
// chat model is verified with a test call; a changed embedding model is
// probed for the index width and then triggers a background re-index.
func (s *Service) configure(c *echo.Context) error {
	var in struct {
		DefaultProvider      *string `json:"defaultProvider"`
		OpenRouterChatModel  *string `json:"openrouterChatModel"`
		OpenRouterEmbedModel *string `json:"openrouterEmbedModel"`
		ClaudeModel          *string `json:"claudeModel"`
		CodexModel           *string `json:"codexModel"`
		// Models sets the chat model of direct API providers, keyed by id.
		Models map[string]string `json:"models"`
	}
	if err := c.Bind(&in); err != nil {
		return echo.NewHTTPError(400, "Invalid settings")
	}
	ctx := c.Request().Context()
	row, err := s.load(s.db, user(c))
	if err != nil {
		return err
	}
	trial := row
	reindex := false
	// clean trims a model name; problem says what is wrong with it.
	clean := func(v *string) (value, problem string) {
		if v == nil {
			return "", ""
		}
		value = strings.TrimSpace(*v)
		switch {
		case len(value) > 200:
			return "", "Model names can be at most 200 characters"
		case strings.ContainsAny(value, " \n\t"):
			return "", "Model names cannot contain spaces"
		}
		return value, ""
	}
	if in.DefaultProvider != nil {
		switch *in.DefaultProvider {
		case "", OpenRouter, ClaudeCLI, CodexCLI:
			// "" clears the choice; the features then wait for one (ADR 0020).
			trial.DefaultProvider = *in.DefaultProvider
		default:
			if apiProviderByID(*in.DefaultProvider) == nil {
				return echo.NewHTTPError(400, "Unknown provider")
			}
			trial.DefaultProvider = *in.DefaultProvider
		}
	}
	// Direct API models are verified with a test call before they are saved.
	apiChanges := map[string]APIKey{}
	for id, value := range in.Models {
		spec := apiProviderByID(id)
		if spec == nil {
			return echo.NewHTTPError(400, "Unknown provider")
		}
		model, problem := clean(&value)
		if problem != "" {
			return echo.NewHTTPError(400, problem)
		}
		if model == "" {
			return echo.NewHTTPError(400, "Choose a "+spec.Label+" model")
		}
		api, found, err := s.apiRow(s.db, user(c), id)
		if err != nil {
			return err
		}
		if !found {
			return echo.NewHTTPError(409, "Connect "+spec.Label+" first")
		}
		if api.Model == model {
			continue
		}
		completer, err := s.buildAPI(spec, api, model)
		if err != nil {
			return echo.NewHTTPError(409, err.Error())
		}
		if err := testCompleter(ctx, completer); err != nil {
			return echo.NewHTTPError(409, err.Error())
		}
		s.verified.mark(verifiedKey(api.UserID, id, api.Key, api.BaseURL, model))
		api.Model = model
		apiChanges[id] = api
	}
	openRouterTested := false
	for _, change := range []struct {
		provider string
		input    *string
		target   *string
	}{
		{OpenRouter, in.OpenRouterChatModel, &trial.OpenRouterChatModel},
		{ClaudeCLI, in.ClaudeModel, &trial.ClaudeModel},
		{CodexCLI, in.CodexModel, &trial.CodexModel},
	} {
		value, problem := clean(change.input)
		if change.input == nil {
			continue
		}
		if problem != "" {
			return echo.NewHTTPError(400, problem)
		}
		if value == *change.target {
			continue
		}
		*change.target = value
		if value == "" {
			continue
		}
		// Before Connect a CLI model is only recorded; Connect tests it. Otherwise
		// a default model that is at capacity could never be changed.
		if (change.provider == ClaudeCLI && trial.ClaudeConnectedAt == nil) || (change.provider == CodexCLI && trial.CodexConnectedAt == nil) {
			continue
		}
		// OpenRouter's chat model is only tested while OpenRouter is the chosen
		// default; it is tested when OpenRouter becomes the default.
		if change.provider == OpenRouter && trial.DefaultProvider != OpenRouter {
			continue
		}
		// Verify the chosen model actually answers before it becomes the default.
		completer, err := s.build(trial, change.provider, s.chatModel(trial, change.provider))
		if err != nil {
			return echo.NewHTTPError(409, err.Error())
		}
		if err := testCompleter(ctx, completer); err != nil {
			return echo.NewHTTPError(409, err.Error())
		}
		if change.provider == OpenRouter {
			openRouterTested = true
			s.verified.mark(verifiedKey(trial.UserID, OpenRouter, trial.OpenRouterKey, "", value))
		}
	}
	if value, problem := clean(in.OpenRouterEmbedModel); in.OpenRouterEmbedModel != nil {
		if problem != "" {
			return echo.NewHTTPError(400, problem)
		}
		if value != trial.OpenRouterEmbedModel {
			// Naming the model already in effect (the server's default) is
			// recorded, but embeds nothing and rebuilds nothing.
			effective := func(model string) string {
				if model == "" {
					return s.envEmbed
				}
				return model
			}
			changes := effective(value) != effective(trial.OpenRouterEmbedModel)
			if value != "" && changes {
				key, err := s.openRouterKey(trial)
				if err != nil {
					return err
				}
				if key == "" {
					return echo.NewHTTPError(409, "Add an OpenRouter API key before choosing an embedding model")
				}
				dims, err := embed.Probe(ctx, key, value)
				if err != nil {
					// OpenRouter can quote the key it refused.
					return echo.NewHTTPError(409, "OpenRouter could not embed with this model: "+decide.HideKeys(err.Error(), key))
				}
				if dims != embed.VectorDims() {
					return echo.NewHTTPError(409, fmt.Sprintf("This model produces %d-dimension vectors; Timely's search index needs %d. Pick a %d-dimension model such as openai/text-embedding-3-small", dims, embed.VectorDims(), embed.VectorDims()))
				}
			}
			trial.OpenRouterEmbedModel = value
			reindex = changes
		}
	}
	if trial.DefaultProvider != row.DefaultProvider {
		// Switching the default requires the target to be usable right now. A
		// direct API provider also answers a test call, since its model was
		// picked automatically when the key was saved.
		if spec := apiProviderByID(trial.DefaultProvider); spec != nil {
			api, found, err := s.apiRow(s.db, user(c), spec.ID)
			if err != nil {
				return err
			}
			if changed, ok := apiChanges[spec.ID]; ok {
				api = changed
			} else {
				if !found {
					return echo.NewHTTPError(409, "Add "+apiKeyName(spec)+" first")
				}
				// A model that answered a test call on this key within the
				// hour (just picked, or the default a moment ago) is not
				// asked again.
				checked := verifiedKey(api.UserID, spec.ID, api.Key, api.BaseURL, api.Model)
				if !s.verified.ok(checked) {
					completer, err := s.buildAPI(spec, api, api.Model)
					if err != nil {
						return echo.NewHTTPError(409, err.Error())
					}
					if err := testCompleter(ctx, completer); err != nil {
						return echo.NewHTTPError(409, err.Error())
					}
					s.verified.mark(checked)
				}
			}
		} else if trial.DefaultProvider != "" {
			completer, err := s.build(trial, trial.DefaultProvider, s.chatModel(trial, trial.DefaultProvider))
			if err != nil {
				return echo.NewHTTPError(409, err.Error())
			}
			// Saving an OpenRouter key checks only the key, so choosing it for
			// chat checks its chat model (CLIs answered a test call at Connect).
			if trial.DefaultProvider == OpenRouter && !openRouterTested {
				checked := verifiedKey(trial.UserID, OpenRouter, trial.OpenRouterKey, "", s.chatModel(trial, OpenRouter))
				if !s.verified.ok(checked) {
					if err := testCompleter(ctx, completer); err != nil {
						return echo.NewHTTPError(409, err.Error())
					}
					s.verified.mark(checked)
				}
			}
		}
	}
	// The test calls above take seconds, and another tab or device may
	// disconnect a provider meanwhile. So the save runs under the settings row
	// lock and writes only what this request changed: a tested model only onto
	// the connection it was tested with, and a new default only while that
	// provider is still connected. A removed key stays removed.
	err = s.db.Transaction(func(tx *gorm.DB) error {
		current, err := s.load(tx.Clauses(clause.Locking{Strength: "UPDATE"}), user(c))
		if err != nil {
			return err
		}
		for id, api := range apiChanges {
			res := tx.Model(&APIKey{}).Where("user_id = ? AND provider = ? AND api_key = ? AND base_url = ?", api.UserID, id, api.Key, api.BaseURL).
				Updates(map[string]any{"model": api.Model, "updated_at": time.Now().UTC()})
			if res.Error != nil {
				return res.Error
			}
			if res.RowsAffected == 0 {
				return changedMeanwhile(apiProviderByID(id).Label)
			}
		}
		if trial.DefaultProvider != row.DefaultProvider {
			if err := s.stillConnected(tx, current, trial.DefaultProvider); err != nil {
				return err
			}
			current.DefaultProvider = trial.DefaultProvider
		}
		for _, field := range []struct {
			was, now string
			target   *string
		}{
			{row.OpenRouterChatModel, trial.OpenRouterChatModel, &current.OpenRouterChatModel},
			{row.OpenRouterEmbedModel, trial.OpenRouterEmbedModel, &current.OpenRouterEmbedModel},
			{row.ClaudeModel, trial.ClaudeModel, &current.ClaudeModel},
			{row.CodexModel, trial.CodexModel, &current.CodexModel},
		} {
			if field.now != field.was {
				*field.target = field.now
			}
		}
		if reindex {
			current.Reindex = ReindexState{Status: "queued", UpdatedAt: time.Now().UTC()}
		}
		row = current
		return s.save(tx, &current)
	})
	if err != nil {
		return err
	}
	if reindex {
		if err := s.enqueueReindex(user(c)); err != nil {
			return err
		}
	}
	return c.JSON(200, s.view(ctx, row, time.Minute))
}

// verifiedFor is how long a passed test call vouches for a model on a key.
const verifiedFor = time.Hour

// verifiedChecks remembers recent passed test calls, so choosing a model and
// then pressing "Use as default", or switching back to a provider soon after,
// sends one test request instead of two. A new key, endpoint or model is a
// new entry, so it is always tested.
type verifiedChecks struct {
	mu sync.Mutex
	at map[string]time.Time
}

func verifiedKey(userID, provider, sealedKey, base, model string) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{userID, provider, sealedKey, base, model}, "\x00")))
	return hex.EncodeToString(sum[:])
}

func (v *verifiedChecks) ok(key string) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	at, found := v.at[key]
	return found && time.Since(at) < verifiedFor
}

func (v *verifiedChecks) mark(key string) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.at == nil {
		v.at = map[string]time.Time{}
	}
	for k, at := range v.at {
		if time.Since(at) >= verifiedFor {
			delete(v.at, k)
		}
	}
	v.at[key] = time.Now()
}

// changedMeanwhile answers a change whose provider was disconnected or given
// another key (from another tab or device) while the change was checked.
func changedMeanwhile(label string) error {
	return echo.NewHTTPError(409, label+" changed in another tab or device during the check, so nothing was saved. Try again")
}

// stillConnected checks, inside the saving transaction, that the provider
// about to become the default was not disconnected after it was tested. The
// key row is share-locked, so a disconnect waits for this save and then
// resets the default as usual.
func (s *Service) stillConnected(tx *gorm.DB, row Settings, provider string) error {
	switch provider {
	case "":
		return nil
	case OpenRouter:
		if row.OpenRouterKey == "" {
			return changedMeanwhile("OpenRouter")
		}
	case ClaudeCLI:
		if row.ClaudeConnectedAt == nil {
			return changedMeanwhile("Claude Code")
		}
	case CodexCLI:
		if row.CodexConnectedAt == nil {
			return changedMeanwhile("Codex")
		}
	default:
		spec := apiProviderByID(provider)
		if spec == nil {
			return echo.NewHTTPError(400, "Unknown provider")
		}
		api, found, err := s.apiRow(tx.Clauses(clause.Locking{Strength: "SHARE"}), row.UserID, provider)
		if err != nil {
			return err
		}
		if !found || (api.Key == "" && !spec.KeyOptional) {
			return changedMeanwhile(spec.Label)
		}
	}
	return nil
}
