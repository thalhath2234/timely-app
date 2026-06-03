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

	authService := services.NewAuthService(userRepo)
	taskService := services.NewTaskService(taskRepo)

	authHandler := handlers.NewAuthHandler(authService, userRepo)
	taskHandler := handlers.NewTaskHandler(taskService)

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
