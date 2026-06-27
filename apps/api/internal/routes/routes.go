package routes

import (
	"net/http"

	"timely-api/internal/features/auth"
	"timely-api/internal/features/project"
	"timely-api/internal/features/task"
	"timely-api/internal/features/workspace"
	"timely-api/internal/middleware"

	"github.com/labstack/echo/v5"
)

func SetupRoutes(
	e *echo.Echo,
	authHandler *auth.Handler,
	taskHandler *task.Handler,
	projectHandler *project.Handler,
	workspaceHandler *workspace.Handler,
) {
	// Public routes
	setupPublicRoutes(e, authHandler)

	// Protected routes group
	protected := e.Group("")
	protected.Use(middleware.JWTMiddleware())

	setupAuthRoutes(protected, authHandler)
	setupTaskRoutes(protected, taskHandler)
	setupProjectRoutes(protected, projectHandler)
	setupWorkspaceRoutes(protected, workspaceHandler)
}

// setupPublicRoutes defines all public endpoints
func setupPublicRoutes(e *echo.Echo, authHandler *auth.Handler) {
	e.GET("/", func(c *echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{
			"message": "Hello from Timely API",
		})
	})

	e.POST("/register", authHandler.Register)
	e.POST("/login", authHandler.Login)
	e.POST("/logout", authHandler.Logout)
}

// setupAuthRoutes defines all protected auth endpoints
func setupAuthRoutes(g *echo.Group, authHandler *auth.Handler) {
	g.GET("/me", authHandler.Me)
}

// setupTaskRoutes defines all protected task endpoints
func setupTaskRoutes(g *echo.Group, taskHandler *task.Handler) {
	g.POST("/tasks", taskHandler.Create)
	g.GET("/tasks", taskHandler.GetAllTaskByUser)
	g.GET("/task/:id", taskHandler.GetTaskById)
}

// setupProjectRoutes defines all protected project endpoints
func setupProjectRoutes(g *echo.Group, projectHandler *project.Handler) {
	g.POST("/projects", projectHandler.Create)
	g.GET("/projects", projectHandler.GetAllProjectByUser)
	g.GET("/projects/:id", projectHandler.GetProjectById)
}

// setupWorkspaceRoutes defines all protected workspace endpoints
func setupWorkspaceRoutes(g *echo.Group, workspaceHandler *workspace.Handler) {
	// Workspace CRUD
	g.POST("/workspaces", workspaceHandler.Create)
	g.GET("/workspaces", workspaceHandler.GetAllWorkspaceByUser)
	g.GET("/workspaces/:id", workspaceHandler.GetWorkspaceById)

	// Labels
	g.POST("/workspaces/:id/lable", workspaceHandler.CreateLable)
	g.PUT("/workspaces/:workspaceId/lable/:lableId", workspaceHandler.UpdateLable)
	g.DELETE("/workspaces/:workspaceId/lable/:lableId", workspaceHandler.DeleteLable)

	// Status
	g.POST("/workspaces/:id/status", workspaceHandler.CreateStatus)
	g.PUT("/workspaces/:workspaceId/status/:statusId", workspaceHandler.UpdateStatus)
	g.DELETE("/workspaces/:workspaceId/status/:statusId", workspaceHandler.DeleteStatus)

	// Custom Fields
	g.POST("/workspaces/:id/custom-field", workspaceHandler.CreateCustomField)
	g.PUT("/workspaces/:workspaceId/custom-field/:customFieldId", workspaceHandler.UpdateCustomField)
	g.DELETE("/workspaces/:workspaceId/custom-field/:customFieldId", workspaceHandler.DeleteCustomField)

	//Config
	g.GET("/config", workspaceHandler.GetConfig)
	g.PUT("/config", workspaceHandler.UpdateConfig)
}
