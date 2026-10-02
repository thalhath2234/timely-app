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
	g.PATCH("/agent/providers", s.configure)
	g.GET("/agent/providers/:id/models", s.listModels)
	g.POST("/agent/providers/:id/connect", s.connect)
	g.POST("/agent/providers/:id/disconnect", s.disconnect)
	g.POST("/agent/providers/openrouter/key", s.setKey)
	g.DELETE("/agent/providers/openrouter/key", s.removeKey)
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
		return echo.NewHTTPError(404, "Unknown provider")
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
			return echo.NewHTTPError(400, "Unknown provider")
		}
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
		// Switching the default requires the target to be usable right now.
		if _, err := s.build(trial, trial.DefaultProvider, s.chatModel(trial, trial.DefaultProvider)); err != nil {
			return echo.NewHTTPError(409, err.Error())
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
