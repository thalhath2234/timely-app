package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/agenthost"
	"timely-api/internal/features/agent"
	"timely-api/internal/features/agentmcp"
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
	// mcp is the external MCP servers feature (phase 5); nil when it cannot
	// seal secrets (no TIMELY_BACKUP_KEY or JWT_SECRET).
	mcp *agentmcp.Service
}

// newAgentEngine wires chat's agent engine (ADR 0026, plan phases 2 and 3)
// to an agent worker supervisor: the supervisor from the environment
// (agenthost.ConfigFromEnv), the chat tool specs as its Timely toolset, each
// account's rendered settings and tool keys, run credentials from the
// provider service, the host-allowed account, and the learning service
// (worker "learning" messages, the About you copy on ready, the account's
// learning switches for each run). Without a runtime (or in a worktree
// without its own DB_SCHEMA) everything is still set, so Settings can say
// why the engine is unavailable, and every chat fails with that reason
// (ADR 0029: there is no other engine).
func newAgentEngine(db *gorm.DB, chatService *chat.Service, catalog func() agent.Catalog, providers *provider.Service, live *realtime.Hub) agentStack {
	wd, err := os.Getwd()
	if err != nil {
		wd = "."
	}
	cfg := agenthost.ConfigFromEnv(os.Getenv, wd)
	cfg.TimelyTools = timelyTools(catalog)
	// learn and mcp are set right after the supervisor exists, before any
	// worker can start (workers start only on Ensure).
	var learn *learning.Service
	var mcp *agentmcp.Service
	prefs := func(ctx context.Context, uid string) (learning.Prefs, error) { return learn.Prefs(ctx, uid) }
	// Who may use this computer: Settings -> Server (instance_settings)
	// united with TIMELY_AGENT_HOST_ACCOUNTS (Q-5.2), and each account's
	// working folder (decision 10). instanceStore is set by main first.
	hostAllowed := agenthost.HostAllowed(os.Getenv, instanceStore)
	liveWait, parkFor := hostTimers(os.Getenv)
	host := &accountHost{allowed: hostAllowed, workingDir: agenthost.HostWorkingDir(hostAllowed, instanceStore), liveWait: liveWait}
	host.mcp = func(ctx context.Context, uid string) (map[string]json.RawMessage, map[string]string, []string, map[string]json.RawMessage, []string, error) {
		if mcp == nil {
			return nil, nil, nil, nil, nil, nil
		}
		return mcp.AccountMCP(ctx, uid)
	}
	cfg.Account = accountSettingsWith(db, prefs, providers.WebToolKeys, host)
	var rules chat.MCPRules
	engine := chat.NewWorkerEngine(chatService, chat.WorkerEngineOptions{
		Model:          agentRunModel(providers),
		Unsupported:    func(err error) bool { return errors.Is(err, provider.ErrAgentEngineUnsupported) },
		HostAllowed:    hostAllowed,
		HostWorkingDir: host.workingDir,
		HostHome:       cfg.Env.RealHome,
		RenderedHost:   host.renderedHost,
		Learning:       runLearningPrefs(prefs),
		Fetch:          webFetcher(os.Getenv),
		// 10 minutes; a test API may shorten it (phase 4 decision 3).
		ClarifyTimeout: clarifyTimeout(os.Getenv),
		// Host cards wait live 10 minutes, then parked for the account's
		// approval timeout; a test API may shorten both (decision 20).
		LiveWait: liveWait,
		ParkFor:  parkFor,
	})
	cfg.Handler = workerMux(func(w *agenthost.Worker, m agenthost.Message) bool {
		if learn.HandleWorker(w, m) {
			return true
		}
		// The worker's MCP sign-in tokens (mcp.tokens, PROTOCOL.md 12.7):
		// stored sealed in Postgres, never in a backup.
		return mcpTokens(func(ctx context.Context, uid string, tokens map[string]json.RawMessage) error {
			if mcp == nil {
				return nil
			}
			return mcp.SaveTokens(ctx, uid, tokens)
		})(w, m)
	}, engine.Handle)
	// The gateway's grants end with the worker they were made for (phase 5
	// decision 18); gateway is set once it starts.
	var gateway atomic.Pointer[provider.Gateway]
	cfg.OnExit = func(info agenthost.ExitInfo) {
		engine.WorkerExited(info)
		gateway.Load().RevokeAccount(info.Account)
	}
	cfg.OnReady = func(w *agenthost.Worker) { learn.AfterReady(w) }
	sup := agenthost.New(cfg)
	learn = learning.NewService(db, sup)
	// External MCP servers (phase 5, Q-5.6): a change restarts the account's
	// worker once idle; a command server waits for a host card.
	if svc, err := agentmcp.NewService(db, agentmcp.Options{
		Workers:     agentmcp.SupervisorWorkers{Sup: sup},
		HostAllowed: hostAllowed,
		OnChange:    func(_ context.Context, uid string) { sup.RestartWhenIdle(uid) },
		OnStdioPending: func(ctx context.Context, uid string, p agentmcp.PendingStdio) {
			if err := chatService.RaiseServerCard(ctx, uid, p.Name, p.Command, p.Args, p.EnvNames, p.Hash); err != nil {
				log.Printf("agent engine: the host card for MCP server %s: %v", p.Name, err)
			}
		},
	}); err != nil {
		log.Printf("agent engine: external MCP servers are off: %v", err)
	} else {
		mcp = svc
		rules = mcpRules{svc: svc, rendered: host.renderedMCP}
		engine.SetMCP(rules)
		chatService.SetMCP(rules)
	}
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
	stack := agentStack{engine: engine, sup: sup, learning: learn, mcp: mcp}
	if err := sup.Available(); err != nil {
		log.Printf("agent engine: %v Chats fail until the runtime is installed (make agent-install).", err)
		return stack
	}
	// Claude Code and Codex reach the agent engine through the loopback
	// model gateway (plan 5.7); it lives as long as the API process.
	if g, err := providers.StartAgentGateway(); err != nil {
		log.Printf("agent engine: %v. Claude Code and Codex chats cannot run.", err)
	} else {
		gateway.Store(g)
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

// agentRunModel is WorkerEngineOptions.Model: the run's credentials from the
// provider service, through the gateway's Sensitive grant for a Sensitive
// (no-persist) run (phase 4 decision 11).
func agentRunModel(providers *provider.Service) func(context.Context, string, string, string, chat.RunModelOptions) (any, error) {
	return func(ctx context.Context, uid, providerID, model string, opts chat.RunModelOptions) (any, error) {
		return providers.AgentModelFor(ctx, uid, providerID, model, provider.AgentRunOptions{Sensitive: opts.Sensitive, SupportsVision: opts.SupportsVision})
	}
}

// testOnly reads a test switch: honoured only when DB_SCHEMA is also set,
// so a shipped API (one schema) never sees it.
func testOnly(getenv func(string) string, name string) string {
	if strings.TrimSpace(getenv("DB_SCHEMA")) == "" {
		return ""
	}
	return strings.TrimSpace(getenv(name))
}

// clarifyTimeout is how long a question card waits: 10 minutes, or
// TIMELY_AGENT_CLARIFY_TIMEOUT_S seconds (1 to 86,400) on a test API. 0
// leaves the engine's default.
func clarifyTimeout(getenv func(string) string) time.Duration {
	n, err := strconv.Atoi(testOnly(getenv, "TIMELY_AGENT_CLARIFY_TIMEOUT_S"))
	if err != nil || n < 1 || n > 86400 {
		return 0
	}
	return time.Duration(n) * time.Second
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
//   - clarify and delegation (phase 4): question cards and sub-tasks; each
//     chat run's run.start offers them only when it may ask (not an
//     answer-only or no-persist run; bots never).
//
// No provider keys go into the worker's environment: auxiliary calls use
// the run's own credentials (PROTOCOL.md section 9.8).
func accountSettings(db *gorm.DB, prefs func(context.Context, string) (learning.Prefs, error),
	webKeys func(context.Context, string) (string, map[string]string, error)) func(context.Context, string) (agenthost.AccountSpec, error) {
	return accountSettingsWith(db, prefs, webKeys, nil)
}

// accountSettingsWith is accountSettings with phase 5's host and MCP
// settings (PROTOCOL.md 12.1): a host-allowed account gets the host
// toolsets, its working folder, the real home for terminal children
// (Q-5.4), filesystem checkpoints and the real browser profile (Q-5.3);
// every account gets its MCP servers, their modes, approved command
// hashes and sign-in tokens; the live wait is approval_timeout_s. A nil
// host renders none of it.
func accountSettingsWith(db *gorm.DB, prefs func(context.Context, string) (learning.Prefs, error),
	webKeys func(context.Context, string) (string, map[string]string, error), host *accountHost) func(context.Context, string) (agenthost.AccountSpec, error) {
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
		toolsets = append(toolsets, "web", "clarify", "delegation")
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
		if host != nil {
			if err := host.render(ctx, uid, settings); err != nil {
				return agenthost.AccountSpec{}, err
			}
		}
		raw, err := json.Marshal(settings)
		if err != nil {
			return agenthost.AccountSpec{}, err
		}
		return agenthost.AccountSpec{Settings: raw, ToolKeys: keys}, nil
	}
}

// accountHost is the phase 5 part of an account's worker settings, and what
// each spawn rendered (a worker rendered otherwise refuses the host
// toolsets, or lacks an MCP server, until it restarts).
type accountHost struct {
	allowed    func(ctx context.Context, uid string) bool
	workingDir func(ctx context.Context, uid string) string
	mcp        func(ctx context.Context, uid string) (map[string]json.RawMessage, map[string]string, []string, map[string]json.RawMessage, []string, error)
	liveWait   time.Duration

	mu       sync.Mutex
	host     map[string]bool            // uid -> rendered host-allowed
	servers  map[string]map[string]bool // uid -> MCP servers rendered (not Off)
	warnings map[string][]string
}

// render adds PROTOCOL.md 12.1's keys to settings and records what it
// rendered for uid.
func (h *accountHost) render(ctx context.Context, uid string, settings map[string]any) error {
	allowed := h.allowed != nil && h.allowed(ctx, uid)
	settings["host_allowed"] = allowed
	settings["approval_timeout_s"] = int(h.liveWait / time.Second)
	if allowed {
		dir := ""
		if h.workingDir != nil {
			dir = h.workingDir(ctx, uid)
		}
		settings["working_dir"] = dir
		settings["terminal_home_mode"] = "real"
		settings["checkpoints"] = true
		settings["browser"] = map[string]bool{"use_real_profile": true}
		if ts, ok := settings["toolsets"].([]string); ok {
			settings["toolsets"] = append(ts, "terminal", "file", "code_execution", "browser-use", "browser-cdp")
		}
	}
	rendered := map[string]bool{}
	var warnings []string
	if h.mcp != nil {
		servers, modes, approved, tokens, warn, err := h.mcp(ctx, uid)
		if err != nil {
			// The MCP rows cannot be read: the worker starts without them
			// rather than not at all.
			log.Printf("agent %s: MCP servers: %v", agenthost.AccountDirName(uid), err)
		} else if len(servers) > 0 || len(modes) > 0 {
			if approved == nil {
				approved = []string{}
			}
			settings["mcp_servers"], settings["mcp_modes"], settings["approved_mcp_hashes"], settings["mcp_tokens"] = servers, modes, approved, tokens
			for name := range servers {
				if modes[name] != "off" {
					rendered[name] = true
				}
			}
		}
		warnings = warn
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.host == nil {
		h.host, h.servers, h.warnings = map[string]bool{}, map[string]map[string]bool{}, map[string][]string{}
	}
	h.host[uid], h.servers[uid], h.warnings[uid] = allowed, rendered, warnings
	return nil
}

// renderedHost is WorkerEngineOptions.RenderedHost.
func (h *accountHost) renderedHost(uid string) (allowed, known bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	allowed, known = h.host[uid]
	return allowed, known
}

// renderedMCP reports whether the account's worker was rendered with the
// server (unknown before any render: true).
func (h *accountHost) renderedMCP(uid, server string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	servers, ok := h.servers[uid]
	return !ok || servers[server]
}

// mcpRules adapts agentmcp.Service to chat.MCPRules: a run offers only the
// servers its worker was rendered with (a change restarts it once idle).
type mcpRules struct {
	svc      *agentmcp.Service
	rendered func(uid, server string) bool
}

func (m mcpRules) Mode(ctx context.Context, uid, server string) string {
	return m.svc.Mode(ctx, uid, server)
}

func (m mcpRules) Classify(ctx context.Context, uid, server, tool string, ann chat.MCPAnnotations) agent.HostAction {
	return m.svc.ClassifyWith(ctx, uid, server, tool, agentmcp.Annotations{ReadOnly: ann.ReadOnly, Destructive: ann.Destructive, Idempotent: ann.Idempotent, OpenWorld: ann.OpenWorld})
}

func (m mcpRules) ApproveStdio(ctx context.Context, uid, name, hash string) error {
	return m.svc.ApproveStdio(ctx, uid, name, hash)
}

func (m mcpRules) RefuseStdio(ctx context.Context, uid, name, hash string) error {
	return m.svc.RefuseStdio(ctx, uid, name, hash)
}

func (m mcpRules) Servers(ctx context.Context, uid string) map[string]string {
	servers, modes, _, _, _, err := m.svc.AccountMCP(ctx, uid)
	if err != nil {
		return nil
	}
	out := map[string]string{}
	for name, mode := range modes {
		if _, ok := servers[name]; ok && (m.rendered == nil || m.rendered(uid, name)) {
			out[name] = mode
		}
	}
	return out
}

// mcpTokens takes a worker's mcp.tokens message (not run-scoped) to save
// (agentmcp.Service.SaveTokens); true when the message was one.
func mcpTokens(save func(ctx context.Context, uid string, tokens map[string]json.RawMessage) error) func(*agenthost.Worker, agenthost.Message) bool {
	return func(w *agenthost.Worker, m agenthost.Message) bool {
		if m.Type != "mcp.tokens" {
			return false
		}
		var body struct {
			Tokens map[string]json.RawMessage `json:"tokens"`
		}
		if err := m.Decode(&body); err != nil {
			log.Printf("agent engine: an unreadable mcp.tokens: %v", err)
			return true
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := save(ctx, m.Account, body.Tokens); err != nil {
			log.Printf("agent %s: saving MCP sign-ins: %v", agenthost.AccountDirName(m.Account), err)
		}
		return true
	}
}

// hostTimers are the host card waits: ten minutes live, then the account's
// approval timeout (WorkerEngineOptions' defaults, nil and 0 here). A test
// API (DB_SCHEMA) may shorten them with TIMELY_AGENT_HOST_LIVE_WAIT_S and
// TIMELY_AGENT_HOST_PARK_S (1 to 3,600 seconds; decision 20).
func hostTimers(getenv func(string) string) (time.Duration, func(context.Context, string) time.Duration) {
	seconds := func(name string) time.Duration {
		n, err := strconv.Atoi(testOnly(getenv, name))
		if err != nil || n < 1 || n > 3600 {
			return 0
		}
		log.Printf("agent engine: %s=%d (test only)", name, n)
		return time.Duration(n) * time.Second
	}
	live, park := seconds("TIMELY_AGENT_HOST_LIVE_WAIT_S"), seconds("TIMELY_AGENT_HOST_PARK_S")
	if live == 0 {
		live = 10 * time.Minute
	}
	if park == 0 {
		return live, nil
	}
	return live, func(context.Context, string) time.Duration { return park }
}

// registerAgentMCP adds the MCP servers routes (Settings -> Assistant -> MCP
// servers) to the router: the signed-in ones on protected, and the OAuth
// callback, which the vendor's redirect reaches without a session and
// which checks its one-use state, on e. Nothing without the service.
func registerAgentMCP(e *echo.Echo, protected *echo.Group, stack agentStack) {
	if stack.mcp == nil {
		return
	}
	stack.mcp.Routes(protected)
	stack.mcp.PublicRoutes(e)
}
