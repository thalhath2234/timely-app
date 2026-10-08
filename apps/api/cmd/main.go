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
	"timely-api/internal/features/calendar"
	"timely-api/internal/features/chat"
	"timely-api/internal/features/doc"
	"timely-api/internal/features/docfile"
	"timely-api/internal/features/embed"
	"timely-api/internal/features/event"
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
	"timely-api/internal/features/task"
	"timely-api/internal/features/workspace"
	"timely-api/internal/jobs"
	"timely-api/internal/middleware"
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
	sheetService := sheet.NewSheetService(sheetRepo, indexer)
	eventService := event.NewEventService(eventRepo, recurrenceStore, place, indexer)
	calendarService := calendar.NewService(taskRepo, eventRepo, scheduleRepo.GetWorkingHours)
	scheduleService := schedule.NewService(scheduleRepo, taskRepo, eventRepo, place)
	searchService := search.NewService(db, indexer)
	notifyService := notify.NewService(db, jobQueue, calendarService, taskService, scheduleService, indexer)
	portabilityService := portability.NewService(db, jobQueue)
	portabilityService.SetAfterRestore(indexer.Invalidate)
	jobWorker := jobs.NewWorker(jobQueue)
	notifyService.Register(jobWorker)
	portabilityService.Register(jobWorker)
	jobWorker.SetSweep(func(ctx context.Context) error {
		if err := notifyService.Sweep(ctx); err != nil {
			return err
		}
		return portabilityService.Sweep(ctx)
	})
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
	})

	providerService := provider.New(db, indexer, jobQueue)
	providerService.Register(jobWorker)
	chatService := chat.New(db, func(tx *gorm.DB) agent.Catalog { return chatCatalog(tx, live, providerService.EmbedCredentials) }, chat.NewOpenRouter())
	// Proposals are rehearsed in a rolled-back transaction; no live doc broadcasts.
	chatService.SetRehearsal(func(tx *gorm.DB) agent.Catalog { return chatCatalog(tx, nil, providerService.EmbedCredentials) })
	chatService.SetCompleters(providerService)

	authHandler := auth.NewHandler(authService, userRepo)
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
		Auth:      authHandler,
		Instance:  instanceHandler,
		Task:      task.NewHandler(taskService),
		Project:   project.NewHandler(projectService),
		Workspace: workspace.NewHandler(workspaceService),
		Document:  doc.NewHandler(documentService, live),
		DocFiles:  docfile.New(db),
		Links:     linkpreview.New(),
		Sheet:     sheet.NewHandler(sheetService),
		Event:     event.NewHandler(eventService),
		Calendar:  calendar.NewHandler(calendarService),
		Schedule:  schedule.NewHandler(scheduleService),
		ApiKey:    apikey.NewHandler(apiKeyService),
		Search:    search.NewHandler(searchService),
		Notify:    notify.NewHandler(notifyService, jobQueue),
		Portable:  portability.NewHandler(portabilityService),
		MCP:       agent.Handler(mcpServer, apiKeyService.Verifier()),
		Sessions:  authService,
	}

	// Create Echo instance
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
	}))

	// Setup all routes
	routes.SetupRoutes(e, handlers)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	var background sync.WaitGroup
	background.Add(1)
	go func() {
		defer background.Done()
		jobWorker.Run(ctx)
	}()
	chatService.Run(ctx)

	servers, listening := listenAll(bind, port, e)
	if len(servers) == 0 {
		log.Fatalf("could not bind the API on any of %v port %d", bind, port)
	}
	instanceHandler.SetListening(listening)

	<-ctx.Done()
	log.Println("Shutting down")
	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelShutdown()
	for _, srv := range servers {
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("http shutdown: %v", err)
		}
	}
	stopped := make(chan struct{})
	go func() {
		background.Wait()
		chatService.Wait()
		close(stopped)
	}()
	select {
	case <-stopped:
	case <-time.After(8 * time.Second):
		log.Println("background loops did not stop in time; exiting anyway")
	}
}

// listenConfig reads API_PORT (fallback PORT, default 8080) and API_BIND, a
// comma-separated list of hosts that defaults to loopback only. Hosting on a
// server still works with API_BIND=0.0.0.0.
func listenConfig() (int, []string) {
	portText := strings.TrimSpace(os.Getenv("API_PORT"))
	if portText == "" {
		portText = strings.TrimSpace(os.Getenv("PORT"))
	}
	if portText == "" {
		portText = "8080"
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
