package provider

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/embed"
)

func user(c *echo.Context) string { v, _ := c.Get("userID").(string); return v }

func (s *Service) Routes(g *echo.Group) {
	g.GET("/agent/providers", s.overview)
	g.POST("/agent/providers/rescan", s.rescan)
	g.PATCH("/agent/providers", s.configure)
	g.GET("/agent/providers/:id/models", s.listModels)
	g.POST("/agent/providers/:id/connect", s.connect)
	g.POST("/agent/providers/:id/disconnect", s.disconnect)
	g.POST("/agent/providers/:id/key", s.setAPIKey)
	g.DELETE("/agent/providers/:id/key", s.removeAPIKey)
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
	ServerKey  bool   `json:"serverKey"`
	ChatModel  string `json:"chatModel"`
	EmbedModel string `json:"embedModel"`
	Ready      bool   `json:"ready"`
}

type overview struct {
	DefaultProvider string         `json:"defaultProvider"`
	LocalCLI        bool           `json:"localCli"`
	OpenRouter      openRouterView `json:"openrouter"`
	Claude          cliView        `json:"claude"`
	Codex           cliView        `json:"codex"`
	APIs            []apiView      `json:"apiProviders"`
	Reindex         ReindexState   `json:"reindex"`
}

func (s *Service) view(ctx context.Context, row Settings, maxAge time.Duration) overview {
	out := overview{DefaultProvider: row.DefaultProvider, LocalCLI: s.localCLI, Reindex: row.Reindex}
	out.OpenRouter = openRouterView{KeySet: row.OpenRouterKey != "", KeyHint: row.OpenRouterKeyHint, ServerKey: s.envKey != "", ChatModel: s.chatModel(row, OpenRouter)}
	out.OpenRouter.EmbedModel = row.OpenRouterEmbedModel
	if out.OpenRouter.EmbedModel == "" {
		out.OpenRouter.EmbedModel = s.envEmbed
	}
	out.OpenRouter.Ready = out.OpenRouter.KeySet || out.OpenRouter.ServerKey
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
	return out
}

func (s *Service) overview(c *echo.Context) error {
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
		row, found, err := s.apiRow(s.db, user(c), spec.ID)
		if err != nil {
			return err
		}
		if !found && !spec.KeyOptional {
			return echo.NewHTTPError(409, "Add a "+spec.Label+" API key first")
		}
		key, err := s.apiKey(row)
		if err != nil {
			return echo.NewHTTPError(409, err.Error())
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
		return echo.NewHTTPError(502, err.Error())
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
			row.DefaultProvider = OpenRouter
		}
		return nil
	})
	if err != nil {
		return err
	}
	return c.JSON(200, s.view(c.Request().Context(), row, time.Minute))
}

// setKey validates the key with one tiny completion before storing it
// encrypted. The response never includes the key.
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
	row, err := s.load(s.db, user(c))
	if err != nil {
		return err
	}
	sealed, err := s.encrypt(key)
	if err != nil {
		return err
	}
	trial := row
	trial.OpenRouterKey = sealed
	completer, err := s.build(trial, OpenRouter, s.chatModel(trial, OpenRouter))
	if err != nil {
		return echo.NewHTTPError(409, err.Error())
	}
	if err := testCompleter(ctx, completer); err != nil {
		return echo.NewHTTPError(409, "OpenRouter rejected this key: "+err.Error())
	}
	row, err = s.update(user(c), func(row *Settings) error {
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
		return nil
	})
	if err != nil {
		return err
	}
	if s.envKey != "" {
		_ = s.enqueueReindex(user(c))
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
	clean := func(v *string) (string, bool) {
		if v == nil {
			return "", false
		}
		value := strings.TrimSpace(*v)
		if len(value) > 200 || strings.ContainsAny(value, " \n\t") {
			return "", false
		}
		return value, true
	}
	if in.DefaultProvider != nil {
		switch *in.DefaultProvider {
		case OpenRouter, ClaudeCLI, CodexCLI:
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
		model, ok := clean(&value)
		if !ok || model == "" {
			return echo.NewHTTPError(400, "Model names cannot be empty or contain spaces")
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
		api.Model = model
		apiChanges[id] = api
	}
	for _, change := range []struct {
		provider string
		input    *string
		target   *string
	}{
		{OpenRouter, in.OpenRouterChatModel, &trial.OpenRouterChatModel},
		{ClaudeCLI, in.ClaudeModel, &trial.ClaudeModel},
		{CodexCLI, in.CodexModel, &trial.CodexModel},
	} {
		value, ok := clean(change.input)
		if change.input == nil {
			continue
		}
		if !ok {
			return echo.NewHTTPError(400, "Model names cannot contain spaces")
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
		// Verify the chosen model actually answers before it becomes the default.
		completer, err := s.build(trial, change.provider, s.chatModel(trial, change.provider))
		if err != nil {
			return echo.NewHTTPError(409, err.Error())
		}
		if err := testCompleter(ctx, completer); err != nil {
			return echo.NewHTTPError(409, err.Error())
		}
	}
	if value, ok := clean(in.OpenRouterEmbedModel); in.OpenRouterEmbedModel != nil {
		if !ok {
			return echo.NewHTTPError(400, "Model names cannot contain spaces")
		}
		if value != trial.OpenRouterEmbedModel {
			if value != "" {
				key, err := s.openRouterKey(trial)
				if err != nil {
					return err
				}
				if key == "" {
					return echo.NewHTTPError(409, "Add an OpenRouter API key before choosing an embedding model")
				}
				dims, err := embed.Probe(ctx, key, value)
				if err != nil {
					return echo.NewHTTPError(409, "OpenRouter could not embed with this model: "+err.Error())
				}
				if dims != embed.VectorDims() {
					return echo.NewHTTPError(409, fmt.Sprintf("This model produces %d-dimension vectors; Timely's search index needs %d. Pick a %d-dimension model such as openai/text-embedding-3-small", dims, embed.VectorDims(), embed.VectorDims()))
				}
			}
			trial.OpenRouterEmbedModel = value
			reindex = true
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
					return echo.NewHTTPError(409, "Add a "+spec.Label+" API key first")
				}
				completer, err := s.buildAPI(spec, api, api.Model)
				if err != nil {
					return echo.NewHTTPError(409, err.Error())
				}
				if err := testCompleter(ctx, completer); err != nil {
					return echo.NewHTTPError(409, err.Error())
				}
			}
		} else if _, err := s.build(trial, trial.DefaultProvider, s.chatModel(trial, trial.DefaultProvider)); err != nil {
			return echo.NewHTTPError(409, err.Error())
		}
	}
	for _, api := range apiChanges {
		if err := s.saveAPIRow(&api); err != nil {
			return err
		}
	}
	row, err = s.update(user(c), func(row *Settings) error {
		row.DefaultProvider = trial.DefaultProvider
		row.OpenRouterChatModel = trial.OpenRouterChatModel
		row.OpenRouterEmbedModel = trial.OpenRouterEmbedModel
		row.ClaudeModel = trial.ClaudeModel
		row.CodexModel = trial.CodexModel
		if reindex {
			row.Reindex = ReindexState{Status: "queued", UpdatedAt: time.Now().UTC()}
		}
		return nil
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
