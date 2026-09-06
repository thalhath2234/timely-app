package routes

import (
	"net/http"

	"timely-api/internal/features/apikey"
	"timely-api/internal/features/auth"
	"timely-api/internal/features/calendar"
	"timely-api/internal/features/doc"
	"timely-api/internal/features/event"
	"timely-api/internal/features/project"
	"timely-api/internal/features/schedule"
	"timely-api/internal/features/search"
	"timely-api/internal/features/sheet"
	"timely-api/internal/features/task"
	"timely-api/internal/features/workspace"
	"timely-api/internal/middleware"

	"github.com/labstack/echo/v5"
)

// Handlers groups every feature handler so SetupRoutes has one parameter.
type Handlers struct {
	Auth      *auth.Handler
	Task      *task.Handler
	Project   *project.Handler
	Workspace *workspace.Handler
	Document  *doc.Handler
	Sheet     *sheet.Handler
	Event     *event.Handler
	Calendar  *calendar.Handler
	Schedule  *schedule.Handler
	ApiKey    *apikey.Handler
	Search    *search.Handler
	MCP       http.Handler
}

func SetupRoutes(e *echo.Echo, h Handlers) {
	// Public routes
	setupPublicRoutes(e, h.Auth)

	if h.MCP != nil {
		e.Any("/mcp", echo.WrapHandler(h.MCP))
	}

	// Protected routes group
	protected := e.Group("")
	protected.Use(middleware.JWTMiddleware())

	setupAuthRoutes(protected, h.Auth)
	setupTaskRoutes(protected, h.Task)
	setupProjectRoutes(protected, h.Project)
	setupWorkspaceRoutes(protected, h.Workspace)
	setupDocumentRoutes(protected, h.Document)
	setupSheetRoutes(protected, h.Sheet)
	setupEventRoutes(protected, h.Event)
	setupCalendarRoutes(protected, h.Calendar)
	setupScheduleRoutes(protected, h.Schedule)
	setupApiKeyRoutes(protected, h.ApiKey)
	setupSearchRoutes(protected, h.Search)
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
	g.PUT("/me", authHandler.UpdateMe)
}

// setupTaskRoutes defines all protected task endpoints
func setupTaskRoutes(g *echo.Group, taskHandler *task.Handler) {
	g.POST("/tasks", taskHandler.Create)
	g.GET("/tasks", taskHandler.GetAllTaskByUser)
	g.PATCH("/tasks/bulk", taskHandler.BulkUpdate)
	g.GET("/task/:id", taskHandler.GetTaskById)
	g.PUT("/tasks/:id", taskHandler.Update)
	g.DELETE("/tasks/:id", taskHandler.Delete)
	g.GET("/tasks/:id/activity", taskHandler.ListActivity)
	g.POST("/tasks/:id/activity", taskHandler.AddComment)

	// Recurring tasks: edit one occurrence, or split the series from a date
	g.PUT("/tasks/:id/occurrences", taskHandler.EditOccurrence)
	g.POST("/tasks/:id/recurrence/split", taskHandler.Split)
}

// setupEventRoutes defines all protected calendar event endpoints
func setupEventRoutes(g *echo.Group, eventHandler *event.Handler) {
	g.POST("/events", eventHandler.Create)
	g.GET("/events", eventHandler.List)
	g.GET("/events/:id", eventHandler.GetByID)
	g.PUT("/events/:id", eventHandler.Update)
	g.DELETE("/events/:id", eventHandler.Delete)
	g.PUT("/events/:id/occurrences", eventHandler.EditOccurrence)
	g.POST("/events/:id/recurrence/split", eventHandler.Split)
}

// setupCalendarRoutes serves the unified range payload the calendar renders
func setupCalendarRoutes(g *echo.Group, calendarHandler *calendar.Handler) {
	g.GET("/calendar", calendarHandler.Range)
}

// setupScheduleRoutes covers availability, manual blocks and the engine
func setupScheduleRoutes(g *echo.Group, scheduleHandler *schedule.Handler) {
	g.GET("/schedule/working-hours", scheduleHandler.GetWorkingHours)
	g.PUT("/schedule/working-hours", scheduleHandler.UpdateWorkingHours)

	g.POST("/schedule/preview", scheduleHandler.Preview)
	g.POST("/schedule/apply", scheduleHandler.Apply)
	g.POST("/schedule/reschedule", scheduleHandler.Apply)

	g.POST("/tasks/:id/blocks", scheduleHandler.AddBlock)
	g.DELETE("/tasks/:id/blocks", scheduleHandler.ClearBlocks)
	g.PUT("/blocks/:id", scheduleHandler.MoveBlock)
	g.DELETE("/blocks/:id", scheduleHandler.DeleteBlock)
}

// setupProjectRoutes defines all protected project endpoints
func setupProjectRoutes(g *echo.Group, projectHandler *project.Handler) {
	g.POST("/projects", projectHandler.Create)
	g.GET("/projects", projectHandler.GetAllProjectByUser)
	g.GET("/projects/:id", projectHandler.GetProjectById)
	g.PUT("/projects/:id", projectHandler.Update)
	g.DELETE("/projects/:id", projectHandler.Delete)
	g.POST("/projects/:id/stages", projectHandler.CreateStage)
	g.PUT("/projects/:id/stages/:stageId", projectHandler.UpdateStage)
	g.DELETE("/projects/:id/stages/:stageId", projectHandler.DeleteStage)
	g.PUT("/projects/:id/stages/reorder", projectHandler.ReorderStages)
}

// setupWorkspaceRoutes defines all protected workspace endpoints
func setupWorkspaceRoutes(g *echo.Group, workspaceHandler *workspace.Handler) {
	// Workspace CRUD
	g.POST("/workspaces", workspaceHandler.Create)
	g.GET("/workspaces", workspaceHandler.GetAllWorkspaceByUser)
	g.GET("/workspaces/:id", workspaceHandler.GetWorkspaceById)
	g.PUT("/workspaces/:id", workspaceHandler.Update)
	g.DELETE("/workspaces/:id", workspaceHandler.Delete)

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

// setupDocumentRoutes defines all protected document endpoints
func setupDocumentRoutes(g *echo.Group, documentHandler *doc.Handler) {
	g.POST("/docs", documentHandler.Create)
	g.GET("/docs", documentHandler.GetAllDocumentsByUser)
	g.GET("/docs/:id", documentHandler.GetDocumentById)
	g.GET("/docs/:id/watch", documentHandler.Watch)
	g.PUT("/docs/:id", documentHandler.Update)
	g.DELETE("/docs/:id", documentHandler.Delete)
}

// setupSheetRoutes defines all protected sheet endpoints
func setupSheetRoutes(g *echo.Group, sheetHandler *sheet.Handler) {
	g.POST("/sheets", sheetHandler.Create)
	g.GET("/sheets", sheetHandler.GetAllSheetsByUser)
	g.GET("/sheets/:id", sheetHandler.GetSheetById)
	g.PUT("/sheets/:id", sheetHandler.Update)
	g.DELETE("/sheets/:id", sheetHandler.Delete)
}

func setupApiKeyRoutes(g *echo.Group, apiKeyHandler *apikey.Handler) {
	if apiKeyHandler == nil {
		return
	}
	g.GET("/api-keys", apiKeyHandler.List)
	g.POST("/api-keys", apiKeyHandler.Create)
	g.DELETE("/api-keys/:id", apiKeyHandler.Revoke)
}

func setupSearchRoutes(g *echo.Group, searchHandler *search.Handler) {
	if searchHandler == nil {
		return
	}
	g.GET("/search", searchHandler.Search)
	g.POST("/search/reindex", searchHandler.Reindex)
}
