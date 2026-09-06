package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	_ "time/tzdata" // IANA zones for recurrence and working hours, even on hosts without a zoneinfo directory

	"timely-api/internal/blocks"
	"timely-api/internal/database"
	"timely-api/internal/features/agent"
	"timely-api/internal/features/apikey"
	"timely-api/internal/features/auth"
	"timely-api/internal/features/calendar"
	"timely-api/internal/features/doc"
	"timely-api/internal/features/embed"
	"timely-api/internal/features/event"
	"timely-api/internal/features/project"
	"timely-api/internal/features/schedule"
	"timely-api/internal/features/search"
	"timely-api/internal/features/sheet"
	"timely-api/internal/features/task"
	"timely-api/internal/features/workspace"
	"timely-api/internal/realtime"
	"timely-api/internal/recurrence"
	"timely-api/internal/routes"

	"github.com/joho/godotenv"
	"github.com/labstack/echo/v5"
	echoMiddleware "github.com/labstack/echo/v5/middleware"
)

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: No .env file found or failed to load")
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
	blockStore := blocks.NewStore(db)

	authService := auth.NewAuthService(userRepo, workspaceRepo)
	apiKeyService := apikey.NewService(db)
	indexer := embed.New(db)
	taskService := task.NewTaskService(taskRepo, projectRepo, recurrenceStore, blockStore, indexer)
	projectService := project.NewProjectService(projectRepo, indexer)
	workspaceService := workspace.NewWorkspaceService(workspaceRepo)
	live := realtime.NewHub()
	documentService := doc.NewDocumentService(documentRepo, indexer, live)
	sheetService := sheet.NewSheetService(sheetRepo, indexer)
	eventService := event.NewEventService(eventRepo, recurrenceStore, indexer)
	calendarService := calendar.NewService(taskRepo, eventRepo)
	scheduleService := schedule.NewService(scheduleRepo, taskRepo, eventRepo, blockStore)
	searchService := search.NewService(db, indexer)
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
	})

	handlers := routes.Handlers{
		Auth:      auth.NewHandler(authService, userRepo),
		Task:      task.NewHandler(taskService),
		Project:   project.NewHandler(projectService),
		Workspace: workspace.NewHandler(workspaceService),
		Document:  doc.NewHandler(documentService, live),
		Sheet:     sheet.NewHandler(sheetService),
		Event:     event.NewHandler(eventService),
		Calendar:  calendar.NewHandler(calendarService),
		Schedule:  schedule.NewHandler(scheduleService),
		ApiKey:    apikey.NewHandler(apiKeyService),
		Search:    search.NewHandler(searchService),
		MCP:       agent.Handler(mcpServer, apiKeyService.Verifier()),
	}

	// Create Echo instance
	e := echo.New()

	// Logger & Recover Middlewares
	e.Use(echoMiddleware.RequestLogger())
	e.Use(echoMiddleware.Recover())
	e.Use(echoMiddleware.CORSWithConfig(echoMiddleware.CORSConfig{
		AllowOrigins: []string{
			"http://localhost:4001",
			"http://127.0.0.1:4001",
		},
		AllowCredentials: true,
		AllowHeaders: []string{
			echo.HeaderOrigin,
			echo.HeaderContentType,
			echo.HeaderAccept,
			echo.HeaderAuthorization,
			"Cache-Control",
			"Last-Event-ID",
			"ngrok-skip-browser-warning",
		},
	}))

	// Setup all routes
	routes.SetupRoutes(e, handlers)
	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	sc := echo.StartConfig{
		Address:         ":8080",
		GracefulTimeout: 10 * time.Second,
	}
	if err := sc.Start(ctx, e); err != nil {
		log.Fatal(err)
	}
}
