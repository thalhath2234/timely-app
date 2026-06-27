package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"timely-api/internal/database"
	"timely-api/internal/features/auth"
	"timely-api/internal/features/project"
	"timely-api/internal/features/task"
	"timely-api/internal/features/workspace"
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
	authService := auth.NewAuthService(userRepo, workspaceRepo)
	taskService := task.NewTaskService(taskRepo, projectRepo)
	projectService := project.NewProjectService(projectRepo)
	workspaceService := workspace.NewWorkspaceService(workspaceRepo)
	authHandler := auth.NewHandler(authService, userRepo)
	taskHandler := task.NewHandler(taskService)
	projectHandler := project.NewHandler(projectService)
	workspaceHandler := workspace.NewHandler(workspaceService)

	// Create Echo instance
	e := echo.New()

	// Logger & Recover Middlewares
	e.Use(echoMiddleware.RequestLogger())
	e.Use(echoMiddleware.Recover())
	e.Use(echoMiddleware.CORSWithConfig(echoMiddleware.CORSConfig{
		AllowOrigins:     []string{"http://localhost:3000"},
		AllowCredentials: true,
		AllowHeaders: []string{
			echo.HeaderOrigin,
			echo.HeaderContentType,
			echo.HeaderAccept,
		},
	}))

	// Setup all routes
	routes.SetupRoutes(e, authHandler, taskHandler, projectHandler, workspaceHandler)
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
