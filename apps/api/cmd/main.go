package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"timely-api/internal/database"
	"timely-api/internal/handlers"
	"timely-api/internal/middleware"
	"timely-api/internal/repositories"
	"timely-api/internal/services"

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
	userRepo := repositories.NewUserRepository(db)
	taskRepo := repositories.NewTaskRepository(db)
	projectRepo := repositories.NewProjectRepository(db)
	workspaceRepo := repositories.NewWorkspaceRepository(db)
	authService := services.NewAuthService(userRepo)
	taskService := services.NewTaskService(taskRepo, projectRepo)
	projectService := services.NewProjectService(projectRepo)
	workspaceService := services.NewWorkspaceService(workspaceRepo)
	authHandler := handlers.NewAuthHandler(authService, userRepo)
	taskHandler := handlers.NewTaskHandler(taskService)
	projectHandler := handlers.NewProjectHandler(projectService)
	workspaceHandler := handlers.NewWorkspaceHandler(workspaceService)
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

	// Public routes
	e.GET("/", func(c *echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{
			"message": "Hello from Timely API",
		})
	})
	e.POST("/register", authHandler.Register)
	e.POST("/login", authHandler.Login)
	e.POST("/logout", authHandler.Logout)

	// Protected routes group
	r := e.Group("")
	r.Use(middleware.JWTMiddleware())
	r.GET("/me", authHandler.Me)
	r.POST("/tasks", taskHandler.Create)
	r.GET("/tasks", taskHandler.GetAllTaskByUser)
	r.GET("/tasks/:id", taskHandler.GetTaskById)
	r.POST("/projects", projectHandler.Create)
	r.GET("/projects", projectHandler.GetAllProjectByUser)
	r.GET("/projects/:id", projectHandler.GetProjectById)
	r.POST("/workspaces", workspaceHandler.Create)
	r.GET("/workspaces", workspaceHandler.GetAllWorkspaceByUser)
	r.GET("/workspaces/:id", workspaceHandler.GetWorkspaceById)
	r.POST("/workspaces/:id/lable", workspaceHandler.CreateLable)
	r.PUT("/workspaces/:workspaceId/lable/:lableId", workspaceHandler.UpdateLable)
	r.DELETE("/workspaces/:workspaceId/lable/:lableId", workspaceHandler.DeleteLable)
	r.POST("/workspaces/:id/status", workspaceHandler.CreateStatus)
	r.PUT("/workspaces/:workspaceId/status/:statusId", workspaceHandler.UpdateStatus)
	r.DELETE("/workspaces/:workspaceId/status/:statusId", workspaceHandler.DeleteStatus)
	r.POST("/workspaces/:id/custom-field", workspaceHandler.CreateCustomField)
	r.PUT("/workspaces/:workspaceId/custom-field/:customFieldId", workspaceHandler.UpdateCustomField)
	r.DELETE("/workspaces/:workspaceId/custom-field/:customFieldId", workspaceHandler.DeleteCustomField)
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
