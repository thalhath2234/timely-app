package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"os"
	"sync"
	"time"

	"gorm.io/gorm"
	"timely-api/internal/agenthost"
	"timely-api/internal/features/agent"
	"timely-api/internal/features/chat"
	"timely-api/internal/features/provider"
	"timely-api/internal/models"
)

// newAgentEngine wires chat's agent engine (ADR 0026, plan phase 2) to an
// agent worker supervisor: the supervisor from the environment
// (agenthost.ConfigFromEnv), the chat tool specs as its Timely toolset, each
// account's rendered settings, run credentials from the provider service and
// the host-allowed account. Without a runtime (or in a worktree without its
// own DB_SCHEMA) the engine is still set, so Settings can say why it is
// unavailable, and every chat runs on classic exactly as before.
func newAgentEngine(db *gorm.DB, chatService *chat.Service, catalog func() agent.Catalog, providers *provider.Service) *chat.WorkerEngine {
	wd, err := os.Getwd()
	if err != nil {
		wd = "."
	}
	cfg := agenthost.ConfigFromEnv(os.Getenv, wd)
	cfg.TimelyTools = timelyTools(catalog)
	cfg.Account = accountSettings(db)
	engine := chat.NewWorkerEngine(chatService, chat.WorkerEngineOptions{
		Model: func(ctx context.Context, uid, providerID, model string) (any, error) {
			return providers.AgentModel(ctx, uid, providerID, model)
		},
		Unsupported: func(err error) bool { return errors.Is(err, provider.ErrAgentEngineUnsupported) },
		HostAllowed: agenthost.HostAccounts(os.Getenv),
	})
	cfg.Handler = engine.Handle
	cfg.OnExit = engine.WorkerExited
	sup := agenthost.New(cfg)
	engine.Attach(sup)
	chatService.SetAgentEngine(engine)
	if err := sup.Available(); err != nil {
		log.Printf("agent engine: %v Chats use the classic engine.", err)
		return engine
	}
	// The host-wide prepare step moves its cost out of the first chat on
	// the new engine; Ensure runs it itself if this fails.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		if _, err := sup.Prepare(ctx, map[string]any{"browser_executable": ""}); err != nil {
			log.Printf("agent engine: prepare: %v", err)
		}
	}()
	return engine
}

// timelyTools is the supervisor's TimelyTools: the chat tool specs
// (chat.AgentToolSpecs), built once, since Ensure asks for them every time.
func timelyTools(catalog func() agent.Catalog) func(context.Context) (string, json.RawMessage, error) {
	var once sync.Once
	var version string
	var tools json.RawMessage
	var err error
	return func(context.Context) (string, json.RawMessage, error) {
		once.Do(func() {
			var specs []agent.ToolSpec
			version, specs = chat.AgentToolSpecs(catalog())
			tools, err = json.Marshal(specs)
		})
		return version, tools, err
	}
}

// accountSettings is the supervisor's Account: the settings render-account
// turns into the account's config.yaml (plan 6.3). Phase 2 runs chat only:
// the chat toolsets, the account's time zone, no memory, profile or curator
// writes (learning is phase 3). No provider keys go into the worker's
// environment: the one auxiliary call a phase 2 chat can make (context
// compression) uses the run's own credentials (PROTOCOL.md section 9.8).
func accountSettings(db *gorm.DB) func(context.Context, string) (agenthost.AccountSpec, error) {
	return func(ctx context.Context, uid string) (agenthost.AccountSpec, error) {
		var config models.Config
		if err := db.WithContext(ctx).Select("working_hours").Where("user_id = ?", uid).Limit(1).Find(&config).Error; err != nil {
			return agenthost.AccountSpec{}, err
		}
		settings := map[string]any{
			"toolsets": []string{"timely", "todo", "skills"},
			"learning": map[string]bool{"memory": false, "user_profile": false},
			"curator":  false,
		}
		if zone := config.WorkingHours.Timezone; zone != "" {
			if _, err := time.LoadLocation(zone); err == nil && zone != "Local" {
				settings["timezone"] = zone
			}
		}
		raw, err := json.Marshal(settings)
		if err != nil {
			return agenthost.AccountSpec{}, err
		}
		return agenthost.AccountSpec{Settings: raw}, nil
	}
}
