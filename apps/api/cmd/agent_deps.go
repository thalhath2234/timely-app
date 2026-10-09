package main

import (
	"context"

	"gorm.io/gorm"
	"timely-api/internal/features/agent"
	"timely-api/internal/features/auth"
	"timely-api/internal/features/calendar"
	"timely-api/internal/features/doc"
	"timely-api/internal/features/embed"
	"timely-api/internal/features/event"
	"timely-api/internal/features/notify"
	"timely-api/internal/features/placement"
	"timely-api/internal/features/project"
	"timely-api/internal/features/schedule"
	"timely-api/internal/features/search"
	"timely-api/internal/features/sheet"
	"timely-api/internal/features/task"
	"timely-api/internal/features/workspace"
	"timely-api/internal/jobs"
	"timely-api/internal/realtime"
	"timely-api/internal/recurrence"
)

// workEstimate is the smart-suggestion estimate for new Work the agent creates
// without a length (nil keeps the 30-minute default). Set in main.
var workEstimate func(ctx context.Context, userID, name, description string) (int, bool)

// searchRerank lets smart suggestions reorder the agent's semantic_search
// results; nil keeps the plain order. Set in main once Jev is wired.
var searchRerank func(ctx context.Context, userID, query string, hits []search.Hit) (kept, hidden []search.Hit, ok bool)

// Bind all writes (including indexing jobs) to the same transaction as the
// agent's execution checkpoint. Existing REST and Hermes behavior stays intact.
// creds supplies each account's own embedding key, as for the REST indexer;
// without it nothing the agent writes would be indexed.
func chatCatalog(db *gorm.DB, live *realtime.Hub, creds embed.Credentials) agent.Catalog {
	tasks := task.NewTaskRepository(db)
	projects := project.NewProjectRepository(db)
	workspaces := workspace.NewWorkspaceRepository(db)
	events := event.NewEventRepository(db)
	sched := schedule.NewRepository(db)
	rules := recurrence.NewStore(db)
	place := placement.New(db, sched.GetWorkingHours)
	indexer := embed.New(db)
	indexer.SetQueue(jobs.NewQueue(db))
	if creds != nil {
		indexer.SetCredentials(creds)
	}
	taskService := task.NewTaskService(tasks, projects, workspaces, rules, place, indexer)
	projectService := project.NewProjectService(projects, workspaces, indexer)
	projectService.SetTaskCopier(taskService)
	calendarService := calendar.NewService(tasks, events, sched.GetWorkingHours)
	scheduleService := schedule.NewService(sched, tasks, events, place)
	return agent.NewCatalog(agent.Deps{
		Auth:  auth.NewAuthService(auth.NewUserRepository(db), workspaces, auth.NewSessionRepository(db)),
		Tasks: taskService, Projects: projectService, Workspaces: workspace.NewWorkspaceService(workspaces),
		Events: event.NewEventService(events, rules, place, indexer), Calendar: calendarService,
		Schedule: scheduleService,
		// Notifications, snooze and mark-read run in the same transaction too.
		Notify: notify.NewService(db, jobs.NewQueue(db), calendarService, taskService, scheduleService, indexer),
		Docs:   doc.NewDocumentService(doc.NewDocumentRepository(db), indexer, live), Sheets: sheet.NewSheetService(sheet.NewSheetRepository(db), indexer),
		Search:   search.NewService(db, indexer),
		Estimate: workEstimate,
		Rerank:   searchRerank,
	})
}
