package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	"timely-api/internal/agenthost"
	"timely-api/internal/features/agent"
	"timely-api/internal/features/chat"
	"timely-api/internal/features/learning"
	"timely-api/internal/features/provider"
	"timely-api/internal/models"
	"timely-api/internal/realtime"
)

// agentStack is the agent engine and what hangs off its supervisor: the
// learning service (what the agent learned, phase 3) and the supervisor
// itself, which backups (agent state), account deletion and web search keys
// use.
type agentStack struct {
	engine   *chat.WorkerEngine
	sup      *agenthost.Supervisor
	learning *learning.Service
}

// newAgentEngine wires chat's agent engine (ADR 0026, plan phases 2 and 3)
// to an agent worker supervisor: the supervisor from the environment
// (agenthost.ConfigFromEnv), the chat tool specs as its Timely toolset, each
// account's rendered settings and tool keys, run credentials from the
// provider service, the host-allowed account, and the learning service
// (worker "learning" messages, the About you copy on ready, the account's
// learning switches for each run). Without a runtime (or in a worktree
// without its own DB_SCHEMA) everything is still set, so Settings can say
// why the engine is unavailable, and every chat runs on classic exactly as
// before.
func newAgentEngine(db *gorm.DB, chatService *chat.Service, catalog func() agent.Catalog, providers *provider.Service, live *realtime.Hub) agentStack {
	wd, err := os.Getwd()
	if err != nil {
		wd = "."
	}
	cfg := agenthost.ConfigFromEnv(os.Getenv, wd)
	cfg.TimelyTools = timelyTools(catalog)
	// learn is set right after the supervisor exists, before any worker can
	// start (workers start only on Ensure).
	var learn *learning.Service
	prefs := func(ctx context.Context, uid string) (learning.Prefs, error) { return learn.Prefs(ctx, uid) }
	cfg.Account = accountSettings(db, prefs, providers.WebToolKeys)
	engine := chat.NewWorkerEngine(chatService, chat.WorkerEngineOptions{
		Model: func(ctx context.Context, uid, providerID, model string) (any, error) {
			return providers.AgentModel(ctx, uid, providerID, model)
		},
		Unsupported: func(err error) bool { return errors.Is(err, provider.ErrAgentEngineUnsupported) },
		HostAllowed: agenthost.HostAccounts(os.Getenv),
		Learning:    runLearningPrefs(prefs),
		Fetch:       webFetcher(os.Getenv),
	})
	cfg.Handler = workerMux(func(w *agenthost.Worker, m agenthost.Message) bool { return learn.HandleWorker(w, m) }, engine.Handle)
	cfg.OnExit = engine.WorkerExited
	cfg.OnReady = func(w *agenthost.Worker) { learn.AfterReady(w) }
	sup := agenthost.New(cfg)
	learn = learning.NewService(db, sup)
	learn.SetPublish(func(uid string, ev realtime.Event) { live.Publish(uid, chat.WatchKey, ev) })
	learn.SetAccountSettings(func(ctx context.Context, uid string) (json.RawMessage, error) {
		spec, err := cfg.Account(ctx, uid)
		return spec.Settings, err
	})
	// A web search key travels in the worker's environment (plan 6.4), so a
	// change restarts the account's worker once it is idle.
	providers.SetWebKeyChanged(sup.RestartWhenIdle)
	providers.SetWebBackends(liveWebBackends(sup))
	engine.Attach(sup)
	chatService.SetAgentEngine(engine)
	stack := agentStack{engine: engine, sup: sup, learning: learn}
	if err := sup.Available(); err != nil {
		log.Printf("agent engine: %v Chats use the classic engine.", err)
		return stack
	}
	// Claude Code and Codex reach the agent engine through the loopback
	// model gateway (plan 5.7); it lives as long as the API process.
	if _, err := providers.StartAgentGateway(); err != nil {
		log.Printf("agent engine: %v. Claude Code and Codex chats use the classic engine.", err)
	}
	// The host-wide prepare step moves its cost out of the first chat on
	// the new engine; Ensure runs it itself if this fails. It also finishes
	// or drops agent state restores a crash left staged.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		if _, err := sup.Prepare(ctx, map[string]any{"browser_executable": ""}); err != nil {
			log.Printf("agent engine: prepare: %v", err)
		}
		// Chats deleted while their account had no worker, before a restart
		// or a restore, leave the homes now (review round 8).
		engine.DrainForgets(ctx)
	}()
	return stack
}

// workerMux sends a worker's "learning" messages to the learning service
// (first reports true when it took the message) and everything else to the
// chat engine.
func workerMux(first func(*agenthost.Worker, agenthost.Message) bool, rest func(*agenthost.Worker, agenthost.Message)) func(*agenthost.Worker, agenthost.Message) {
	return func(w *agenthost.Worker, m agenthost.Message) {
		if first(w, m) {
			return
		}
		rest(w, m)
	}
}

// runLearningPrefs is WorkerEngineOptions.Learning: the account's learning
// switches for each run (an error leaves learning off for that run).
func runLearningPrefs(prefs func(context.Context, string) (learning.Prefs, error)) func(context.Context, string) (chat.LearningPrefs, error) {
	return func(ctx context.Context, uid string) (chat.LearningPrefs, error) {
		p, err := prefs(ctx, uid)
		return chat.LearningPrefs{Learning: p.Learning, SearchHistory: p.SearchHistory}, err
	}
}

// liveWebBackends tells the web key Settings which keyed backends the
// account's running worker can use (its ready.web_backends); nil while no
// worker runs, so the listed ones are offered.
func liveWebBackends(sup *agenthost.Supervisor) func(string) []string {
	return func(uid string) []string {
		if w, ok := sup.Worker(uid); ok {
			return w.Ready().WebBackends
		}
		return nil
	}
}

// webFetcher is WorkerEngineOptions.Fetch: the test pages under
// TIMELY_AGENT_WEB_FIXTURES (https://<name>.fixture.invalid/...) when that
// and DB_SCHEMA are both set, so only an isolated test API ever serves them;
// otherwise nil, the netguard fetcher that reads public pages.
func webFetcher(getenv func(string) string) chat.PageFetcher {
	dir := strings.TrimSpace(getenv("TIMELY_AGENT_WEB_FIXTURES"))
	if dir == "" || strings.TrimSpace(getenv("DB_SCHEMA")) == "" {
		return nil
	}
	log.Printf("agent engine: web pages come from the test fixtures in %s (TIMELY_AGENT_WEB_FIXTURES)", dir)
	return chat.FixtureFetcher(dir)
}

// afterAgentAccountDelete is the agent's part of deleting an account (plan
// 6.6): the worker stops, no new one starts, and the home goes to .trash and
// is deleted. Learning rows go with the user row (FK cascade).
func afterAgentAccountDelete(sup *agenthost.Supervisor) func(userID string) {
	return func(userID string) {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		if err := sup.RemoveAccount(ctx, userID); err != nil {
			log.Printf("delete account: remove agent home: %v", err)
		}
	}
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
// turns into the account's config.yaml (plan 6.3, PROTOCOL.md 10.6) and the
// account's tool keys. Phase 3:
//   - toolsets: the chat ones plus memory and session_search while learning
//     is on (search only with "Search my past chats") and web; each run's
//     run.start narrows them further.
//   - learning: memory and About you on (their writes are decided per run
//     by flags.learning_writes); the learning pass uses the run's own
//     provider and model, never a separate one (Q-3.2).
//   - curator: on while learning is, and it never archives (Q-3.6).
//   - skills_disabled: the learned skills the person turned off and the
//     restored ones still waiting for review (Q-3.4).
//   - skills_enabled: the skills the person turned on; a reviewed bundled
//     skill that is off by default loads only when listed here.
//   - web: the account's keyed backend for search and extract, or timely
//     (the chat provider's own search through Go, Q-3.8); the key goes in
//     the worker's environment under its Hermes name.
//
// No provider keys go into the worker's environment: auxiliary calls use
// the run's own credentials (PROTOCOL.md section 9.8).
func accountSettings(db *gorm.DB, prefs func(context.Context, string) (learning.Prefs, error),
	webKeys func(context.Context, string) (string, map[string]string, error)) func(context.Context, string) (agenthost.AccountSpec, error) {
	return func(ctx context.Context, uid string) (agenthost.AccountSpec, error) {
		var config models.Config
		if err := db.WithContext(ctx).Select("working_hours").Where("user_id = ?", uid).Limit(1).Find(&config).Error; err != nil {
			return agenthost.AccountSpec{}, err
		}
		p, err := prefs(ctx, uid)
		if err != nil {
			return agenthost.AccountSpec{}, err
		}
		toolsets := []string{"timely", "todo", "skills"}
		if p.Learning {
			toolsets = append(toolsets, "memory")
			if p.SearchHistory {
				toolsets = append(toolsets, "session_search")
			}
		}
		toolsets = append(toolsets, "web")
		disabled, enabled := p.SkillsDisabled, p.SkillsEnabled
		if disabled == nil {
			disabled = []string{}
		}
		if enabled == nil {
			enabled = []string{}
		}
		backend, keys, err := webKeys(ctx, uid)
		if err != nil {
			// A key that cannot be read is no key: search falls back to the
			// chat provider's own, and Settings still shows the stored key.
			log.Printf("agent %s: web search key: %v", agenthost.AccountDirName(uid), err)
			backend, keys = provider.TimelyWebBackend, nil
		}
		if backend == "" {
			backend = provider.TimelyWebBackend
		}
		settings := map[string]any{
			"toolsets":        toolsets,
			"learning":        map[string]bool{"memory": true, "user_profile": true},
			"curator":         map[string]bool{"enabled": p.Learning, "auto_archive": false},
			"skills_disabled": disabled,
			"skills_enabled":  enabled,
			"web":             map[string]string{"search_backend": backend, "extract_backend": backend},
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
		return agenthost.AccountSpec{Settings: raw, ToolKeys: keys}, nil
	}
}
