package main

import (
	"log"
	"net/http"
	"os"
	"timely-api/internal/database"
	"timely-api/internal/handlers"
	"timely-api/internal/middleware"
	"timely-api/internal/repositories"
	"timely-api/internal/services"

	"github.com/joho/godotenv"
	"github.com/labstack/echo/v4"
	echoMiddleware "github.com/labstack/echo/v4/middleware"
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
	authService := services.NewAuthService(userRepo)
	authHandler := handlers.NewAuthHandler(authService, userRepo)

	// Create Echo instance
	e := echo.New()

	// Logger & Recover Middlewares
	e.Use(echoMiddleware.Logger())
	e.Use(echoMiddleware.Recover())

	// Public routes
	e.GET("/", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{
			"message": "Hello from Timely API",
		})
	})
	e.POST("/register", authHandler.Register)
	e.POST("/login", authHandler.Login)

	// Protected routes group
	r := e.Group("")
	r.Use(middleware.JWTMiddleware())
	r.GET("/me", authHandler.Me)

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	e.Logger.Fatal(e.Start(":" + port))
}

