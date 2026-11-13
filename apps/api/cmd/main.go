package main

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	_ "time/tzdata" // IANA zones for recurrence and working hours, even on hosts without a zoneinfo directory

	"gorm.io/gorm"
	"timely-api/internal/buildinfo"
	"timely-api/internal/database"
	"timely-api/internal/features/agent"
	"timely-api/internal/features/apikey"
	"timely-api/internal/features/auth"
	"timely-api/internal/features/bots"
	"timely-api/internal/features/calendar"
	"timely-api/internal/features/chat"
	"timely-api/internal/features/decide"
	"timely-api/internal/features/doc"
	"timely-api/internal/features/docfile"
	"timely-api/internal/features/embed"
	"timely-api/internal/features/event"
	"timely-api/internal/features/focus"
	"timely-api/internal/features/instance"
	"timely-api/internal/features/linkpreview"
	"timely-api/internal/features/notify"
	"timely-api/internal/features/placement"
	"timely-api/internal/features/portability"
	"timely-api/internal/features/project"
	"timely-api/internal/features/provider"
	"timely-api/internal/features/schedule"
	"timely-api/internal/features/search"
	"timely-api/internal/features/sheet"
	"timely-api/internal/features/suggest"
	"timely-api/internal/features/task"
	"timely-api/internal/features/workspace"
	"timely-api/internal/jobs"
	"timely-api/internal/lifeline"
	"timely-api/internal/middleware"
	"timely-api/internal/models"
	"timely-api/internal/procguard"
	"timely-api/internal/realtime"
	"timely-api/internal/recurrence"
	"timely-api/internal/routes"
	"timely-api/internal/utils"

	"github.com/joho/godotenv"
	"github.com/labstack/echo/v5"
	echoMiddleware "github.com/labstack/echo/v5/middleware"
)

// version is set at build time: go build -ldflags "-X main.version=1.2.3".
var version = "dev"

func main() {
	buildinfo.Set(version)
	// Agent workers and their terminal commands run as this uid: make our
	// /proc/<pid>/environ (JWT_SECRET, DB_PASSWORD, keys) unreadable to them.
	if _, err := procguard.Harden(os.Getenv); err != nil {
		log.Printf("Warning: could not mark the API non-dumpable: %v", err)
	}
	// Desktop sidecar: stop when the app that started us is gone, even if it
	// died without stopping us (crash, OOM kill, lost session). Started first
	// so a startup still waiting on the database also notices.
	parentGone := lifeline.FromEnv()
	if parentGone != nil {
		go func() {
			<-parentGone
			log.Println("lifeline: the desktop app is gone; shutting down")
			// The orderly shutdown below takes at most ~18 s; this also covers
			// a startup that has not reached it yet.
			time.AfterFunc(30*time.Second, func() {
				log.Println("lifeline: shutdown did not finish; exiting")
				os.Exit(1)
			})
		}()
	}
	// Load environment variables from the repo-root .env (the API runs from
	// apps/api), or from a .env beside the binary when deployed outside the repo.
	if godotenv.Load("../../.env") != nil && godotenv.Load() != nil {
		log.Println("Warning: No .env file found or failed to load")
	}
	if err := auth.CheckSecret("JWT_SECRET", os.Getenv("JWT_SECRET")); err != nil {
		log.Fatal(err)
	}
	if key := os.Getenv("TIMELY_BACKUP_KEY"); key != "" {
		// Not fatal: changing the key makes existing encrypted backups unreadable.
		if err := auth.CheckSecret("TIMELY_BACKUP_KEY", key); err != nil {
			log.Printf("Warning: %v", err)
		}
	}
	if dir := utils.DataDir(); dir != "" {
		if err := utils.EnsureDir(dir); err != nil {
			log.Fatalf("TIMELY_DATA_DIR %s: %v", dir, err)
		}
	}

	// Initialize database
	db := database.InitDB()

	// Initialize repository, service, and handler
	userRepo := auth.NewUserRepository(db)
	taskRepo := task.NewTaskRepository(db)
	projectRepo := project.NewProjectRepository(db)
	workspaceRepo := workspace.NewWorkspaceRepository(db)
	documentRepo := doc.NewDocumentRepository(db)
	sheetRepo := sheet.NewSheetRepository(db)
	eventRepo := event.NewEventRepository(db)
	scheduleRepo := schedule.NewRepository(db)
	recurrenceStore := recurrence.NewStore(db)
	place := placement.New(db, scheduleRepo.GetWorkingHours)

	sessionRepo := auth.NewSessionRepository(db)
	authService := auth.NewAuthService(userRepo, workspaceRepo, sessionRepo)
	apiKeyService := apikey.NewService(db)
	indexer := embed.New(db)
	jobQueue := jobs.NewQueue(db)
	indexer.SetQueue(jobQueue)
	taskService := task.NewTaskService(taskRepo, projectRepo, workspaceRepo, recurrenceStore, place, indexer)
	projectService := project.NewProjectService(projectRepo, workspaceRepo, indexer)
	projectService.SetTaskCopier(taskService)
	workspaceService := workspace.NewWorkspaceService(workspaceRepo)
	live := realtime.NewHub()
	documentService := doc.NewDocumentService(documentRepo, indexer, live)
	sheetService := sheet.NewSheetService(sheetRepo, indexer, live)
	eventService := event.NewEventService(eventRepo, recurrenceStore, place, indexer)
	calendarService := calendar.NewService(taskRepo, eventRepo, scheduleRepo.GetWorkingHours)
	scheduleService := schedule.NewService(scheduleRepo, taskRepo, eventRepo, place)
	searchService := search.NewService(db, indexer, rebuildIndex)
	notifyService := notify.NewService(db, jobQueue, calendarService, taskService, scheduleService, indexer)
	portabilityService := portability.NewService(db, jobQueue)
	// Bots (ADR 0021): bots.next_check_at is the schedule; the sweep queues
	// due Bots and checks run three at a time on a lane of their own; passed
	// items and re-judges share one more slot (ADR 0024).
	botService := bots.New(db, jobQueue)
	botKeys, err := bots.NewKeyStore(db)
	if err != nil {
		log.Fatalf("bots: price source keys: %v", err)
	}
	botService.SetKeys(botKeys)
	botService.SetLive(live)
	jobWorker := jobs.NewWorker(jobQueue)
	// Embedding work waits on OpenRouter: a whole account's reindex makes one
	// request per item, so it and per-item index jobs each get a lane of their
	// own and never hold up reminders, pushes or each other.
	jobWorker.Separate(models.JobReindexUser)
	jobWorker.Separate(models.JobIndexEntity)
	jobWorker.SeparateN(bots.CheckSlots, models.JobBotCheck)
	// Re-judges and passed items share one slot of their own.
	jobWorker.Separate(models.JobBotPass, models.JobBotJudge)
	// A site logo can wait on robots.txt, a home page and the logo itself,
	// each behind its site's spacing, so logos keep to a lane of their own.
	jobWorker.Separate(models.JobBotIcon)
	// Expo's push receipts can be slow to answer; asking for them never
	// holds up the main lane's sweep.
	jobWorker.Separate(models.JobPushReceipts)
	botService.Register(jobWorker)
	notifyService.Register(jobWorker)
	portabilityService.Register(jobWorker)
	var decisions *decide.Service // set below, once the provider keys exist
	// Every sweep runs each tick: an error in one no longer skips the rest.
	jobWorker.SetSweep(func(ctx context.Context) error {
		return errors.Join(botService.Sweep(ctx), notifyService.Sweep(ctx), decisions.Prune(), portabilityService.Sweep(ctx))
	})
	providerService := provider.New(db, indexer, jobQueue)
	providerService.Register(jobWorker)
	// AI-judged Bots ask the account's provider, on its small model.
	botService.SetJudge(providerService.BotJudge())
	indexRebuild = providerService.EnsureIndex
	// Restored Bots get the checks a save makes, and stay off when an
	// outside app restored them.
	portabilityService.SetRestoreVet(botService.VetRestore)
	// Smart suggestions (Jev): TypeSafe key first, then the OpenRouter key;
	// with neither, decide answers ErrOff and nothing changes.
	jev := decide.NewClient(nil)
	jev.Rejected = providerService.MarkTypeSafeRejected
	decisions = decide.New(db, providerService.DecisionKeys, jev)
	providerService.SetDecisions(decisions, jev)
	suggestions := suggest.New(db, decisions, searchService)
	suggestions.SetSchedule(scheduleService)
	notifyService.SetTriage(suggestions.Triage)
	notifyService.SetAlerts(suggestions.Alerts)
	notifyService.SetBriefing(suggestions.Brief)
	notifyService.SetBotDigest(botService.DigestLines)
	notifyService.SetDecisions(func(ctx context.Context, userID string) bool {
		on, _ := decisions.Status(ctx, userID)
		return on
	}, decisions.Feedback)
	notifyService.SetDismissed(decisions.Dismissed)
	workEstimate = suggestions.Estimate
	smartSearch := search.NewSmart(searchService, indexer, decisions)
	smartSearch.SetViews(search.ViewsFromDB(db))
	searchRerank = smartSearch.Rerank
	taskPick = smartSearch.Pick
	docDecisions = decisions
	todaySuggestions = suggestions
	liveBlockWriter = providerService.LiveBlock
	liveBlockRehearsal = providerService.RehearseLiveBlock
	// Describe (dashboard cards, live blocks) reads through the chat agent's
	// read tools and draws its drafts from the account's data. It gets no
	// Bots: preview_bot and ask_bot fetch from the network and stay chat
	// only, and an outside app's add_live_block words reach Describe.
	providerService.SetReadTools(func(tx *gorm.DB) agent.Catalog {
		return chatCatalog(tx, live, providerService.EmbedCredentials, nil)
	})
	providerService.SetBoardData(boardData(db))
	mcpServer := agent.New(agent.Deps{
		Auth:       authService,
		Tasks:      taskService,
		Projects:   projectService,
		Workspaces: workspaceService,
		Events:     eventService,
		Calendar:   calendarService,
		Schedule:   scheduleService,
		Docs:       documentService,
		Sheets:     sheetService,
		Search:     searchService,
		Notify:     notifyService,
		Jobs:       jobQueue,
		Portable:   portabilityService,
		Estimate:   suggestions.Estimate,
		Rerank:     smartSearch.Rerank,
		Pick:       smartSearch.Pick,
		Decisions:  decisions,
		Focus:      focus.NewStore(db),
		Suggest:    suggestions,
		LiveBlock:  providerService.LiveBlock,
		Bots:       botService,
		DecisionsOn: func(ctx context.Context, userID string) bool {
			on, _ := decisions.Status(ctx, userID)
			return on
		},
	})

	chatService := chat.New(db, func(tx *gorm.DB) agent.Catalog {
		return chatCatalog(tx, live, providerService.EmbedCredentials, botService)
	}, chat.NewOpenRouter())
	// Proposals are rehearsed in a rolled-back transaction: no live doc
	// broadcasts, and live blocks are written by the model only on apply.
	chatService.SetRehearsal(func(tx *gorm.DB) agent.Catalog {
		return rehearsalCatalog(tx, providerService.EmbedCredentials, botService)
	})
	chatService.SetCompleters(providerService)
	chatService.SetLive(live)
	chatService.SetDecisions(decisions)
	chatService.SetEstimates(suggestions.EstimateMany)
	chatService.SetBotNames(chatBotNames(botService))
	// Chats an account switches to the new engine run in its Hermes worker
	// (ADR 0026); everything else stays on classic.
	agentStack := newAgentEngine(db, chatService, func() agent.Catalog {
		return chatCatalog(db, live, providerService.EmbedCredentials, botService)
	}, providerService, live)
	agentEngine := agentStack.engine
	// Backups carry the account's agent state (plan 6.5): memory, learned
	// skills, staged writes and chat sessions.
	portabilityService.SetAgentState(agentStack.sup)
	chatService.SetStopLearning(func(uid, cid string, searchOnly bool) {
		if searchOnly {
			agentStack.learning.StopSearch(context.Background(), uid, cid)
			return
		}
		agentStack.learning.StopLearning(context.Background(), uid, cid)
	})
	// A restore replaces every row and drops the search index with them, so
	// it queues a rebuild, which Settings shows while it runs. The account's
	// worker restarts once idle, so its config is rendered from the restored
	// learning settings.
	portabilityService.SetAfterRestore(func(userID string) {
		indexer.Invalidate(userID)
		botService.AfterRestore(userID)
		if err := providerService.QueueReindex(userID); err != nil {
			log.Printf("restore: queue search reindex: %v", err)
		}
		// The restored agent home's state.db holds the backup's
		// transcripts: each chat's next agent run reseeds from its messages.
		if err := chatService.AgentStateRestored(context.Background(), userID); err != nil {
			log.Printf("restore: mark chats for a reseed: %v", err)
		}
		agentStack.sup.RestartWhenIdle(userID)
	})

	authHandler := auth.NewHandler(authService, userRepo)
	authHandler.SetPairingCodes(auth.NewPairingCodes(db))
	// Chat images need no step here: the image sweep removes every upload
	// file within 24 hours of its upload.
	// What the agent learned goes with the user row (FK cascade); its home
	// is removed here.
	removeAgentHome := afterAgentAccountDelete(agentStack.sup)
	authHandler.SetAfterDelete(func(userID string) {
		indexer.Invalidate(userID)
		if err := portabilityService.RemoveAccount(userID); err != nil {
			log.Printf("delete account: remove backups: %v", err)
		}
		removeAgentHome(userID)
	})
	port, bind := listenConfig()
	instanceHandler := instance.NewHandler(instance.Config{
		Port:              port,
		Bind:              bind,
		DataDir:           utils.DataDir(),
		BackupDir:         portabilityService.Dir(),
		AllowRegistration: authHandler.AllowRegistration(),
		LocalCLI:          providerService.LocalCLI(),
		RegistrationOpen:  authHandler.RegistrationOpen,
	}, mustSQLDB(db))

	handlers := routes.Handlers{
		Chat:      chatService,
		Providers: providerService,
		Learning:  agentStack.learning,
		Auth:      authHandler,
		Instance:  instanceHandler,
		Task:      task.NewHandler(taskService),
		Project:   project.NewHandler(projectService),
		Workspace: workspace.NewHandler(workspaceService),
		Document:  doc.NewHandler(documentService, live),
		DocFiles:  docfile.New(db),
		Links:     linkpreview.New(),
		Sheet:     sheet.NewHandler(sheetService, live),
		Event:     event.NewHandler(eventService),
		Calendar:  calendar.NewHandler(calendarService),
		Schedule:  schedule.NewHandler(scheduleService),
		ApiKey:    apikey.NewHandler(apiKeyService),
		Search:    searchHandler(searchService, smartSearch),
		Suggest:   suggestions,
		Focus:     focus.New(db, decisions),
		Bots:      botService,
		Merge:     workspace.NewMerger(db),
		Notify:    notify.NewHandler(notifyService, jobQueue),
		Portable:  portability.NewHandler(portabilityService),
		MCP:       agent.Handler(mcpServer, apiKeyService.Verifier()),
		Sessions:  authService,
	}

	e := newRouter(handlers)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if parentGone != nil {
		go func() {
			select {
			case <-parentGone:
				cancel()
			case <-ctx.Done():
			}
		}()
	}

	var background sync.WaitGroup
	background.Add(1)
	go func() {
		defer background.Done()
		jobWorker.Run(ctx)
	}()
	chatService.Run(ctx)
	// Bot changes reach GET /bots/watch from whichever process made them.
	background.Add(1)
	go func() {
		defer background.Done()
		botService.Relay(ctx)
	}()

	servers, listening := listenAll(bind, port, e)
	if len(servers) == 0 {
		log.Fatalf("could not bind the API on any of %v port %d", bind, port)
	}
	instanceHandler.SetListening(listening)
	// Watch streams never end on their own, so Shutdown would wait them out.
	for _, srv := range servers {
		srv.RegisterOnShutdown(live.Close)
	}

	<-ctx.Done()
	log.Println("Shutting down")
	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelShutdown()
	// Agent workers get their shutdown grace while the servers drain; runs
	// they interrupt are marked Try again while the database is still open.
	agentStopped := make(chan struct{})
	go func() {
		defer close(agentStopped)
		if err := agentEngine.Shutdown(shutdownCtx); err != nil {
			log.Printf("agent engine shutdown: %v", err)
		}
	}()
	for _, srv := range servers {
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("http shutdown: %v", err)
		}
	}
	stopped := make(chan struct{})
	go func() {
		background.Wait()
		chatService.Wait()
		<-agentStopped
		close(stopped)
	}()
	select {
	case <-stopped:
	case <-time.After(8 * time.Second):
		log.Println("background loops did not stop in time; exiting anyway")
	}
}

// newRouter is the API's Echo router: its middleware and every feature
// route. It serves on each API_BIND address; the agent model gateway is never
// on it (provider.Gateway has its own loopback server).
func newRouter(h routes.Handlers) *echo.Echo {
	e := echo.New()
	// The web app reaches the API through its Next.js proxy, so the client is
	// the nearest untrusted address in X-Forwarded-For, not the proxy's own.
	// Without this every web user shares one sign-in rate-limit bucket.
	e.IPExtractor = echo.ExtractIPFromXFFHeader()

	e.Use(middleware.RequestID())
	e.Use(echoMiddleware.BodyLimitWithConfig(echoMiddleware.BodyLimitConfig{
		// Restores carry a whole account export; everything else is small.
		Skipper:    func(c *echo.Context) bool { return c.Request().URL.Path == "/restore" },
		LimitBytes: maxRequestBodyBytes,
	}))
	e.Use(middleware.StructuredLogger())
	e.Use(echoMiddleware.Recover())
	origins := corsOrigins()
	e.Use(middleware.CrossSiteGuard(origins))
	e.Use(echoMiddleware.CORSWithConfig(echoMiddleware.CORSConfig{
		AllowOrigins:     origins,
		AllowCredentials: true,
		AllowHeaders: []string{
			echo.HeaderOrigin,
			echo.HeaderContentType,
			echo.HeaderAccept,
			echo.HeaderAuthorization,
			"Cache-Control",
			"Last-Event-ID",
			"X-Timely-Restore",
			"ngrok-skip-browser-warning",
		},
		// Downloads name their file from it when the web app calls the API
		// on another origin.
		ExposeHeaders: []string{echo.HeaderContentDisposition},
	}))

	routes.SetupRoutes(e, h)
	return e
}

// listenConfig reads API_PORT (fallback PORT, default 8080) and API_BIND, a
// comma-separated list of hosts that defaults to loopback only. Hosting on a
// server still works with API_BIND=0.0.0.0.
// searchHandler serves /search with smart search on top.
func searchHandler(service search.Service, smart *search.Smart) *search.Handler {
	h := search.NewHandler(service)
	h.SetSmart(smart)
	return h
}

func listenConfig() (int, []string) {
	portText := strings.TrimSpace(os.Getenv("API_PORT"))
	if portText == "" {
		portText = strings.TrimSpace(os.Getenv("PORT"))
	}
	if portText == "" {
		portText = "8087"
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 0 || port > 65535 {
		log.Fatalf("API_PORT %q is not a port number", portText)
	}
	var bind []string
	seen := map[string]bool{}
	for _, host := range strings.Split(os.Getenv("API_BIND"), ",") {
		host = strings.Trim(strings.TrimSpace(host), "[]")
		if host == "" || seen[host] {
			continue
		}
		seen[host] = true
		bind = append(bind, host)
	}
	if len(bind) == 0 {
		bind = []string{"127.0.0.1"}
	}
	return port, bind
}

// listenAll binds one http.Server per host; hosts that fail to bind are
// logged and skipped so a missing Tailscale address does not stop loopback.
func listenAll(bind []string, port int, handler http.Handler) ([]*http.Server, []string) {
	var servers []*http.Server
	var listening []string
	for _, host := range bind {
		addr := net.JoinHostPort(host, strconv.Itoa(port))
		ln, err := net.Listen("tcp", addr)
		if err != nil {
			log.Printf("warning: cannot listen on %s: %v", addr, err)
			continue
		}
		srv := &http.Server{
			Handler:           handler,
			ReadHeaderTimeout: 10 * time.Second,
		}
		servers = append(servers, srv)
		listening = append(listening, ln.Addr().String())
		log.Printf("API listening on http://%s", ln.Addr().String())
		go func(srv *http.Server, ln net.Listener) {
			if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Printf("http serve %s: %v", ln.Addr(), err)
			}
		}(srv, ln)
	}
	return servers, listening
}

// maxRequestBodyBytes caps request bodies, unauthenticated ones included, so
// a few oversized requests cannot exhaust the API's memory.
const maxRequestBodyBytes = 25 << 20

// corsOrigins is the development allow list plus any CORS_ORIGINS entries.
func corsOrigins() []string {
	origins := []string{
		"http://localhost:4001",
		"http://127.0.0.1:4001",
	}
	for _, origin := range strings.Split(os.Getenv("CORS_ORIGINS"), ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			origins = append(origins, origin)
		}
	}
	return origins
}

func mustSQLDB(db *gorm.DB) *sql.DB {
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("database handle: %v", err)
	}
	return sqlDB
}

// chatBotNames lets chat messages tag the person's Bots by name.
func chatBotNames(svc *bots.Service) func(ctx context.Context, userID string) ([]chat.BotName, error) {
	return func(ctx context.Context, userID string) ([]chat.BotName, error) {
		names, err := svc.Names(ctx, userID)
		if err != nil {
			return nil, err
		}
		out := make([]chat.BotName, len(names))
		for i, n := range names {
			out[i] = chat.BotName{ID: n.ID, Name: n.Name}
		}
		return out, nil
	}
}
