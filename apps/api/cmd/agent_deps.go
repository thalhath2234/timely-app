package main

import (
	"context"
	"time"

	"gorm.io/gorm"
	"timely-api/internal/features/agent"
	"timely-api/internal/features/auth"
	"timely-api/internal/features/calendar"
	"timely-api/internal/features/doc"
	"timely-api/internal/features/embed"
	"timely-api/internal/features/event"
	"timely-api/internal/features/focus"
	"timely-api/internal/features/notify"
	"timely-api/internal/features/placement"
	"timely-api/internal/features/project"
	"timely-api/internal/features/provider"
	"timely-api/internal/features/schedule"
	"timely-api/internal/features/search"
	"timely-api/internal/features/sheet"
	"timely-api/internal/features/suggest"
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

// taskPick lets smart suggestions check which tasks fit a bulk edit's
// description; nil leaves pick_tasks returning an unchecked shortlist.
var taskPick func(ctx context.Context, userID, description string, hits []search.Hit) (matches, unsure []search.Hit, left int, ok bool)

// docDecisions lets a focused get_doc show only the relevant sections of a
// long doc; nil returns docs whole. Set in main once Jev is wired.
var docDecisions agent.Decider

// todaySuggestions answers the agent's Today suggestions and stale Work; nil
// makes those tools say they are not available. Set in main.
var todaySuggestions *suggest.Service

// liveBlockWriter writes the programs of the agent's live blocks in docs on
// the account's AI provider; nil makes add_live_block unavailable. Set in main.
var liveBlockWriter func(ctx context.Context, userID, words, current, today string) (string, error)

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
		Docs:   doc.NewDocumentService(doc.NewDocumentRepository(db), indexer, live), Sheets: sheet.NewSheetService(sheet.NewSheetRepository(db), indexer, live),
		Search:    search.NewService(db, indexer),
		Estimate:  workEstimate,
		Rerank:    searchRerank,
		Pick:      taskPick,
		Decisions: docDecisions,
		Focus:     focus.NewStore(db),
		Suggest:   todaySuggestions,
		LiveBlock: liveBlockWriter,
	})
}

// boardData loads what the apps' dashboards read for one account, as their
// REST calls return it (the contract's DashboardData), so the Describe AI
// draws its draft cards from the data the person will see.
func boardData(db *gorm.DB) provider.BoardData {
	return func(ctx context.Context, userID string) (any, error) {
		db := db.WithContext(ctx)
		tasks := task.NewTaskRepository(db)
		projects := project.NewProjectRepository(db)
		workspaces := workspace.NewWorkspaceRepository(db)
		sched := schedule.NewRepository(db)
		indexer := embed.New(db)
		taskService := task.NewTaskService(tasks, projects, workspaces, recurrence.NewStore(db), placement.New(db, sched.GetWorkingHours), indexer)
		yes := true
		all, err := taskService.List(userID, task.TaskFilter{})
		if err != nil {
			return nil, err
		}
		inbox, err := taskService.List(userID, task.TaskFilter{Inbox: &yes})
		if err != nil {
			return nil, err
		}
		reminders, err := taskService.List(userID, task.TaskFilter{Reminders: &yes})
		if err != nil {
			return nil, err
		}
		projectList, err := project.NewProjectService(projects, workspaces, indexer).GetAllProjectByUser(userID)
		if err != nil {
			return nil, err
		}
		workspaceList, err := workspace.NewWorkspaceService(workspaces).GetAllWorkspaceByUser(userID)
		if err != nil {
			return nil, err
		}
		docs, err := doc.NewDocumentService(doc.NewDocumentRepository(db), indexer, nil).List(userID, doc.DocumentFilter{})
		if err != nil {
			return nil, err
		}
		sheets, err := sheet.NewSheetService(sheet.NewSheetRepository(db), indexer, nil).List(userID, sheet.SheetFilter{})
		if err != nil {
			return nil, err
		}
		// The apps read events from 180 days back to 181 ahead.
		hours, _ := sched.GetWorkingHours(userID)
		now := time.Now()
		if loc, err := time.LoadLocation(hours.Timezone); err == nil && hours.Timezone != "" {
			now = now.In(loc)
		}
		today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
		events, err := calendar.NewService(tasks, event.NewEventRepository(db), sched.GetWorkingHours).Range(userID, today.AddDate(0, 0, -180), today.AddDate(0, 0, 181))
		if err != nil {
			return nil, err
		}
		return map[string]any{
			"tasks": all, "inbox": inbox, "reminders": reminders, "projects": projectList,
			"workspaces": workspaceList, "docs": docs, "sheets": sheets, "events": events.Items,
		}, nil
	}
}
