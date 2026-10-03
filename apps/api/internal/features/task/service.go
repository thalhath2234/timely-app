package task

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"timely-api/internal/features/embed"
	"timely-api/internal/features/placement"
	"timely-api/internal/features/project"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"
	"timely-api/internal/utils"

	"gorm.io/gorm"
)

const (
	maxNameLength        = 200
	maxDescriptionLength = 100000
)

// TaskUpdate carries only the fields a client is allowed to change. Nil means
// "leave untouched", so autosave can send partial payloads. For the nullable
// columns an empty string clears the value.
type TaskUpdate struct {
	Name                  *string
	Description           *string
	DescriptionRich       *models.JSONMap
	Duration              *int
	Deadline              *string
	StartDate             *string
	ScheduledOn           *string
	CompletedAt           *string
	WorkspaceID           *string
	ProjectID             *string
	StatusID              *string
	PriorityLevel         *string
	StageID               *string
	BlockedByID           *string
	Kind                  *string
	TodayFocusOn          *string
	MinChunkMinutes       *int
	PreferredChunkMinutes *int
	Contiguous            *bool
	EarliestStartAt       *string
	PreferredWindows      *models.PreferredWindows
	ScheduleLocked        *bool
	// LabelIDs nil = leave unchanged; non-nil (including empty) replaces the set.
	LabelIDs *models.LabelInputs
	// CustomFieldValues nil = leave unchanged; non-nil replaces the value of
	// every field listed. A blank value clears that field.
	CustomFieldValues *[]*models.CustomFieldValue
	// RecurrenceSet is true when the client sent the key at all; a nil
	// Recurrence then removes the rule and turns the series back into a one-off.
	RecurrenceSet bool
	Recurrence    *models.RecurrenceInput
}

// OccurrenceAction edits one instance of a recurring task without touching
// the series: complete/uncomplete it, skip it, restore it, or move it.
type OccurrenceAction struct {
	OriginalStart string
	Action        string
	NewStart      *string
	NewEnd        *string
}

// SplitInput ends the series before FromStart and creates a new task that
// continues with the given recurrence ("this and future").
type SplitInput struct {
	FromStart  string
	Recurrence models.RecurrenceInput
	Name       *string
	Duration   *int
}

type TaskService interface {
	Create(task *models.Task, customFieldValues []*models.CustomFieldValue, rec *models.RecurrenceInput) (*models.Task, error)
	Capture(userID, name string) (*models.Task, error)
	Clarify(userID, inboxID string, in ClarifyInput) (*models.Task, error)
	GetAllTaskByUser(userID string) ([]models.Task, error)
	GetTaskById(taskId string) (*models.Task, error)
	Update(userID string, taskID string, update TaskUpdate) (*models.Task, error)
	EditOccurrence(userID, taskID string, action OccurrenceAction) (*models.Task, error)
	Split(userID, taskID string, input SplitInput) (*models.Task, error)
	ListActivity(userID string, taskID string) ([]models.TaskActivity, error)
	AddComment(userID string, taskID string, comment string) (*models.TaskActivity, error)
	List(userID string, filter TaskFilter) ([]models.Task, error)
	Delete(userID, taskID string) error
	BulkUpdate(userID string, ids []string, update TaskUpdate) ([]models.Task, error)
	GetForUser(userID, taskID string) (*models.Task, error)
	Duplicate(userID, taskID string) (*models.Task, error)
	CopyProjectTasks(userID, fromProjectID, toProjectID string, stageMap map[string]string) error
	AddChecklistItem(userID, taskID, title string) (*models.Task, error)
	UpdateChecklistItem(userID, taskID, itemID string, title *string, completed *bool) (*models.Task, error)
	DeleteChecklistItem(userID, taskID, itemID string) (*models.Task, error)
	ReplaceChecklist(userID, taskID string, items models.Checklist) (*models.Task, error)
	StartFocus(userID, taskID string) (*models.Task, error)
	PauseFocus(userID, taskID string) (*models.Task, error)
	StopFocus(userID, taskID string) (*models.Task, error)
	SetTodayFocus(userID, taskID string, date *string) (*models.Task, error)
	WithActor(name string) TaskService
}

// TaskFilter narrows List. Empty fields are ignored. Limit defaults to 200.
type TaskFilter struct {
	WorkspaceIDs  []string
	ProjectIDs    []string
	StatusIDs     []string
	LabelIDs      []string
	Priority      string
	StageID       string
	Completed     *bool
	Overdue       *bool
	DueBefore     string
	DueAfter      string
	Scheduled     *bool
	HasRecurrence *bool
	Text          string
	Sort          string
	Limit         int
	Offset        int
	// Reminders is nil (default): hide duration-0 pings from the task list.
	// true: only reminders. false: same as default.
	Reminders *bool
	// Kind filters by task | reminder | inbox. Inbox is also accepted via Inbox=true.
	Kind  string
	Inbox *bool
}

type workspaceOwner interface {
	GetWorkspaceById(userID string, workspaceID string) (*models.Workspace, error)
}

type taskService struct {
	taskRepo    TaskRepository
	projectRepo project.ProjectRepository
	workspaces  workspaceOwner
	recurrence  *recurrence.Store
	placement   *placement.Service
	indexer     embed.Indexer
	actor       string
}

func NewTaskService(
	taskRepo TaskRepository,
	projectRepo project.ProjectRepository,
	workspaces workspaceOwner,
	recurrenceStore *recurrence.Store,
	place *placement.Service,
	indexer embed.Indexer,
) TaskService {
	return &taskService{
		taskRepo:    taskRepo,
		projectRepo: projectRepo,
		workspaces:  workspaces,
		recurrence:  recurrenceStore,
		placement:   place,
		indexer:     indexer,
	}
}

func (s *taskService) Create(task *models.Task, customFieldValues []*models.CustomFieldValue, rec *models.RecurrenceInput) (*models.Task, error) {
	name, err := normalizeName(task.Name)
	if err != nil {
		return nil, err
	}
	task.Name = name
	if len(task.Description) > maxDescriptionLength {
		task.Description = task.Description[:maxDescriptionLength]
	}
	if err := validateDuration(task.Duration); err != nil {
		return nil, err
	}
	if err := validateDateRange(task.StartDate, task.Deadline); err != nil {
		return nil, err
	}
	if err := validatePreferredWindows(task.PreferredWindows); err != nil {
		return nil, err
	}
	if rec != nil && rec.RRule != "" {
		if _, err := recurrence.Parse(rec.RRule); err != nil {
			return nil, err
		}
	}

	userID := deref(task.UserID)
	hasRecurrence := rec != nil && rec.RRule != ""
	task.Kind = models.ResolveCreateKind(task.Kind, task.Duration, task.ScheduledOn, hasRecurrence)
	if task.Kind == models.KindTask && task.Duration <= 0 {
		return nil, errors.New("work tasks need a duration greater than 0")
	}
	if task.Kind == models.KindTask && (task.WorkspaceID == nil || *task.WorkspaceID == "") {
		return nil, errors.New("workspaceId is required")
	}
	if task.Kind == models.KindInbox {
		task.Duration = 0
		task.ScheduledOn = nil
		rec = nil
		task.WorkspaceID = nil
		task.ProjectID = nil
		task.StatusID = nil
		task.StageID = nil
		task.LabelIDs = nil
		task.PriorityLevel = nil
		task.Deadline = nil
		task.StartDate = nil
	}
	if task.Kind == models.KindReminder {
		task.Duration = 0
		if !reminderHasPing(task.ScheduledOn, hasRecurrence) {
			return nil, errReminderNeedsPing
		}
	}
	if task.Checklist == nil {
		task.Checklist = models.Checklist{}
	}
	if err := s.assertTaskScope(userID, task.WorkspaceID, task.ProjectID, task.BlockedByID); err != nil {
		return nil, err
	}
	if err := normalizeTaskPriority(task.PriorityLevel); err != nil {
		return nil, err
	}

	// The first block is written after the row exists; keep the column empty
	// so the block store owns it.
	requestedScheduledOn := task.ScheduledOn
	task.ScheduledOn = nil

	task.ID = utils.NewTaskID()

	for _, cfv := range customFieldValues {
		cfv.ID = utils.NewCustomFieldValueID()
	}

	if task.WorkspaceID != nil && len(task.LabelIDs) > 0 {
		labelIDsMap := make(map[string]struct{}, len(task.LabelIDs))
		for _, l := range task.LabelIDs {
			if l.Id != "" {
				labelIDsMap[l.Id] = struct{}{}
			}
		}

		if len(labelIDsMap) > 0 {
			labelIDs := make([]string, 0, len(labelIDsMap))
			for id := range labelIDsMap {
				labelIDs = append(labelIDs, id)
			}

			labels, err := s.taskRepo.GetLabelsByIds(*task.WorkspaceID, labelIDs)
			if err != nil {
				return nil, err
			}
			if len(labels) != len(labelIDs) {
				return nil, errors.New("invalid label ids")
			}
			task.Labels = labels
		}
	}

	task, err = s.taskRepo.CreateTask(task, customFieldValues)
	if err != nil {
		return nil, err
	}

	userID = deref(task.UserID)
	switch {
	case rec != nil && rec.RRule != "":
		if err := s.applyRecurrence(userID, task, rec); err != nil {
			return nil, err
		}
	case requestedScheduledOn != nil && *requestedScheduledOn != "":
		if err := s.placeSingleBlock(userID, task, *requestedScheduledOn, task.Duration); err != nil {
			return nil, err
		}
	}

	_ = s.taskRepo.CreateActivities([]models.TaskActivity{
		newActivity(userID, s.actorName(userID), task.ID, "created", "", "created this task", "", ""),
	})

	created, err := s.taskRepo.GetTaskById(task.ID)
	if err != nil {
		return nil, err
	}
	s.indexTask(created)
	return created, nil
}

// applyRecurrence turns the task into a series. Its calendar presence comes
// from expanded occurrences, so any one-off blocks are dropped and
// scheduled_on mirrors the series start for list sorting.
func (s *taskService) applyRecurrence(userID string, task *models.Task, rec *models.RecurrenceInput) error {
	input := *rec
	if input.Dtstart == "" {
		switch {
		case task.ScheduledOn != nil && *task.ScheduledOn != "":
			input.Dtstart = *task.ScheduledOn
		case task.StartDate != nil && *task.StartDate != "":
			input.Dtstart = *task.StartDate + "T09:00:00"
		default:
			return errors.New("recurrence requires a start date and time")
		}
	}
	rule, err := s.recurrence.Upsert(models.RecurrenceOwnerTask, task.ID, userID, input)
	if err != nil {
		return err
	}
	if err := s.placement.ClearTask(task.ID); err != nil {
		return err
	}
	return s.taskRepo.DB().Model(&models.Task{}).
		Where("id = ?", task.ID).
		Update("scheduled_on", rule.Dtstart).Error
}

// placeSingleBlock is the compatibility path for clients that still send
// scheduledOn. Placement writes the Manual block (or ping).
func (s *taskService) placeSingleBlock(userID string, task *models.Task, scheduledOn string, duration int) error {
	start, err := recurrence.ParseTime(scheduledOn)
	if err != nil {
		return errors.New("invalid scheduledOn")
	}
	if duration <= 0 {
		return s.placement.PlacePing(userID, task, start)
	}
	return s.placement.PlaceWork(userID, task, start, duration)
}

func (s *taskService) GetAllTaskByUser(userID string) ([]models.Task, error) {
	if userID == "" {
		return nil, errors.New("invalid user id")
	}

	tasks, err := s.taskRepo.GetAllTaskByUser(userID)
	if err != nil {
		return nil, err
	}

	return tasks, nil
}

func (s *taskService) GetTaskById(taskId string) (*models.Task, error) {

	task, err := s.taskRepo.GetTaskById(taskId)
	if err != nil {
		return nil, err
	}

	return task, nil
}

func (s *taskService) Update(userID string, taskID string, update TaskUpdate) (*models.Task, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	if taskID == "" {
		return nil, errors.New("invalid task id")
	}

	updates := map[string]any{}

	if update.Name != nil {
		name, err := normalizeName(*update.Name)
		if err != nil {
			return nil, err
		}
		updates["name"] = name
	}
	if update.Duration != nil {
		if err := validateDuration(*update.Duration); err != nil {
			return nil, err
		}
	}
	if update.Description != nil {
		text := *update.Description
		if len(text) > maxDescriptionLength {
			text = text[:maxDescriptionLength]
		}
		updates["description"] = text
	}
	if update.DescriptionRich != nil {
		rich := models.NormalizeDocumentContent(*update.DescriptionRich)
		if update.Description != nil && strings.TrimSpace(*update.Description) != "" && models.IsDocumentContentEmpty(rich) {
			rich = models.DocumentFromPlainText(*update.Description)
		}
		updates["description_rich"] = rich
	}
	if update.MinChunkMinutes != nil {
		if *update.MinChunkMinutes < 15 {
			return nil, errors.New("minChunkMinutes must be at least 15")
		}
		updates["min_chunk_minutes"] = *update.MinChunkMinutes
	}
	if update.PreferredChunkMinutes != nil {
		if *update.PreferredChunkMinutes < 0 {
			return nil, errors.New("preferredChunkMinutes cannot be negative")
		}
		if *update.PreferredChunkMinutes == 0 {
			updates["preferred_chunk_minutes"] = nil
		} else {
			updates["preferred_chunk_minutes"] = *update.PreferredChunkMinutes
		}
	}
	if update.Contiguous != nil {
		updates["contiguous"] = *update.Contiguous
	}
	if update.ScheduleLocked != nil {
		updates["schedule_locked"] = *update.ScheduleLocked
	}
	if update.PreferredWindows != nil {
		if err := validatePreferredWindows(*update.PreferredWindows); err != nil {
			return nil, err
		}
		updates["preferred_windows"] = *update.PreferredWindows
	}
	if update.EarliestStartAt != nil {
		if strings.TrimSpace(*update.EarliestStartAt) == "" {
			updates["earliest_start_at"] = nil
		} else {
			updates["earliest_start_at"] = *update.EarliestStartAt
		}
	}

	nullableColumns := map[string]*string{
		"deadline":       update.Deadline,
		"start_date":     update.StartDate,
		"scheduled_on":   update.ScheduledOn,
		"completed_at":   update.CompletedAt,
		"workspace_id":   update.WorkspaceID,
		"project_id":     update.ProjectID,
		"status_id":      update.StatusID,
		"priority_level": update.PriorityLevel,
		"stage_id":       update.StageID,
		"today_focus_on": update.TodayFocusOn,
	}
	if err := normalizeTaskPriority(update.PriorityLevel); err != nil {
		return nil, err
	}
	if err := s.assertTaskScope(userID, update.WorkspaceID, update.ProjectID, nil); err != nil {
		return nil, err
	}
	for column, value := range nullableColumns {
		if value == nil {
			continue
		}
		if *value == "" {
			updates[column] = nil
		} else {
			updates[column] = *value
		}
	}

	if update.BlockedByID != nil {
		switch {
		case *update.BlockedByID == "":
			updates["blocked_by_id"] = nil
		case *update.BlockedByID == taskID:
			return nil, errors.New("a task cannot block itself")
		default:
			if _, err := s.taskRepo.GetTaskByIdForUser(userID, *update.BlockedByID); err != nil {
				return nil, errors.New("blocking task not found")
			}
			// Indirect loops (A waits on B, B waits on A) are as fatal as a
			// self-reference: nothing in the ring can ever become ready.
			if err := s.assertNoDependencyCycle(userID, taskID, *update.BlockedByID); err != nil {
				return nil, err
			}
			updates["blocked_by_id"] = *update.BlockedByID
		}
	}

	if update.RecurrenceSet && update.Recurrence != nil && update.Recurrence.RRule != "" {
		if _, err := recurrence.Parse(update.Recurrence.RRule); err != nil {
			return nil, err
		}
	}

	// Duration and kind are written by applyKindUpdate below, so they count
	// as changes here even though the update map is still empty.
	if len(updates) == 0 && update.LabelIDs == nil && update.CustomFieldValues == nil && !update.RecurrenceSet && update.Kind == nil && update.Duration == nil {
		return s.taskRepo.GetTaskByIdForUser(userID, taskID)
	}

	before, err := s.taskRepo.GetTaskByIdForUser(userID, taskID)
	if err != nil {
		return nil, err
	}

	// Date range is checked against the merged row so a lone deadline edit
	// that lands before an existing start date is caught too.
	if update.StartDate != nil || update.Deadline != nil {
		startDate := before.StartDate
		if update.StartDate != nil {
			startDate = update.StartDate
		}
		deadline := before.Deadline
		if update.Deadline != nil {
			deadline = update.Deadline
		}
		if err := validateDateRange(startDate, deadline); err != nil {
			return nil, err
		}
	}

	if err := s.syncCompletionWithStatus(before, updates); err != nil {
		return nil, err
	}
	if completedAt, ok := updates["completed_at"]; ok && completedAt != nil {
		if before.IsFocusing() {
			updates["actual_minutes"] = before.ActualMinutes + elapsedFocusMinutes(*before.FocusStartedAt)
		}
		updates["focus_started_at"] = nil
		updates["focus_paused_at"] = nil
	}
	if err := s.applyKindUpdate(userID, before, update, updates); err != nil {
		return nil, err
	}
	if err := assertReminderPing(before, update, updates); err != nil {
		return nil, err
	}

	workspaceID := before.WorkspaceID
	if update.WorkspaceID != nil && *update.WorkspaceID != "" {
		id := *update.WorkspaceID
		workspaceID = &id
	}

	if update.LabelIDs != nil {
		labelInputs := models.LabelInputs{}
		if len(*update.LabelIDs) > 0 {
			if workspaceID == nil {
				return nil, errors.New("task has no workspace for labels")
			}

			labelIDsMap := make(map[string]struct{}, len(*update.LabelIDs))
			for _, l := range *update.LabelIDs {
				if l.Id != "" {
					labelIDsMap[l.Id] = struct{}{}
				}
			}

			labelIDs := make([]string, 0, len(labelIDsMap))
			for id := range labelIDsMap {
				labelIDs = append(labelIDs, id)
			}

			if len(labelIDs) > 0 {
				labels, err := s.taskRepo.GetLabelsByIds(*workspaceID, labelIDs)
				if err != nil {
					return nil, err
				}
				if len(labels) != len(labelIDs) {
					return nil, errors.New("invalid label ids")
				}
			}

			for _, id := range labelIDs {
				labelInputs = append(labelInputs, models.LabelInput{Id: id})
			}
		}

		// Store as LabelInputs in the updates map; repository writes it with
		// Select/Updates so GORM uses the JSONB Valuer correctly.
		updates["label_ids"] = labelInputs
	}

	if update.CustomFieldValues != nil {
		scoped := *before
		scoped.WorkspaceID = workspaceID
		values, err := s.prepareCustomFieldValues(&scoped, *update.CustomFieldValues)
		if err != nil {
			return nil, err
		}
		if err := s.taskRepo.ReplaceCustomFieldValues(taskID, values); err != nil {
			return nil, err
		}
	}

	if len(updates) > 0 || update.CustomFieldValues != nil {
		updates["updated_at"] = utils.GetCurrentTime()
	}

	after, err := s.taskRepo.UpdateTask(userID, taskID, updates)
	if err != nil {
		return nil, err
	}

	if err := s.syncCalendarPresence(userID, after, update); err != nil {
		return nil, err
	}
	after, err = s.taskRepo.GetTaskByIdForUser(userID, taskID)
	if err != nil {
		return nil, err
	}

	touched := make(map[string]bool, len(updates)+2)
	for key := range updates {
		touched[key] = true
	}
	if update.LabelIDs != nil {
		touched["label_ids"] = true
	}
	if update.CustomFieldValues != nil {
		touched["custom_field_values"] = true
	}

	entries := collectTaskActivity(userID, s.actorName(userID), before, after, touched)
	if err := s.taskRepo.CreateActivities(entries); err != nil {
		return nil, err
	}

	s.indexTask(after)
	return after, nil
}

// syncCalendarPresence reconciles recurrence and blocks after the row update:
// a recurrence change switches the task between series and one-off, a
// scheduledOn change re-places the single manual block, and a duration change
// on a task with exactly one block stretches that block.
func (s *taskService) syncCalendarPresence(userID string, task *models.Task, update TaskUpdate) error {
	recurring := task.IsRecurring()

	if update.RecurrenceSet {
		if update.Recurrence == nil || update.Recurrence.RRule == "" {
			if recurring {
				if err := s.recurrence.Delete(models.RecurrenceOwnerTask, task.ID); err != nil {
					return err
				}
				if err := s.placement.ClearTask(task.ID); err != nil {
					return err
				}
			}
			recurring = false
		} else {
			if err := s.applyRecurrence(userID, task, update.Recurrence); err != nil {
				return err
			}
			return nil
		}
	}

	if recurring {
		// A series has no blocks; scheduledOn edits move the anchor instead.
		if update.ScheduledOn != nil && *update.ScheduledOn != "" && task.Recurrence != nil {
			rec := models.RecurrenceInput{
				RRule:    task.Recurrence.RRule,
				Dtstart:  *update.ScheduledOn,
				Timezone: task.Recurrence.Timezone,
			}
			_, err := s.recurrence.Upsert(models.RecurrenceOwnerTask, task.ID, userID, rec)
			return err
		}
		return nil
	}

	switch {
	case update.ScheduledOn != nil && *update.ScheduledOn == "":
		if err := s.placement.ClearTask(task.ID); err != nil {
			return err
		}
		if task.IsReminder() {
			return s.taskRepo.DB().Model(&models.Task{}).
				Where("id = ?", task.ID).
				Update("scheduled_on", nil).Error
		}
		return nil
	case update.ScheduledOn != nil:
		return s.placeSingleBlock(userID, task, *update.ScheduledOn, task.Duration)
	case update.Duration != nil && task.IsReminder():
		var keep *time.Time
		if len(task.Blocks) > 0 {
			start := task.Blocks[0].StartAt
			keep = &start
		}
		if err := s.placement.ClearTask(task.ID); err != nil {
			return err
		}
		if keep != nil {
			return s.taskRepo.DB().Model(&models.Task{}).
				Where("id = ?", task.ID).
				Update("scheduled_on", *keep).Error
		}
		return nil
	case update.Duration != nil && task.Duration > 0 && len(task.Blocks) == 0 && task.ScheduledOn != nil && *task.ScheduledOn != "":
		return s.placeSingleBlock(userID, task, *task.ScheduledOn, task.Duration)
	case update.Duration != nil && len(task.Blocks) == 1 && task.Duration > 0:
		block := task.Blocks[0]
		return s.placement.ReplaceWork(task.ID, userID, []models.ScheduledBlock{{
			StartAt: block.StartAt,
			EndAt:   block.StartAt.Add(time.Duration(task.Duration) * time.Minute),
			Source:  block.Source,
		}})
	}
	return nil
}

func (s *taskService) EditOccurrence(userID, taskID string, action OccurrenceAction) (*models.Task, error) {
	if userID == "" || taskID == "" {
		return nil, errors.New("invalid request")
	}
	task, err := s.taskRepo.GetTaskByIdForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	if !task.IsRecurring() {
		return nil, errors.New("task is not recurring")
	}
	originalStart, err := recurrence.ParseTime(action.OriginalStart)
	if err != nil {
		return nil, errors.New("invalid occurrence start")
	}

	patch := recurrence.ExceptionPatch{}
	message := ""
	switch action.Action {
	case "complete":
		now := time.Now().UTC()
		patch.CompletedAt = &now
		message = "completed the occurrence on " + prettyDate(originalStart.Format(time.RFC3339))
	case "uncomplete":
		patch.ClearDone = true
		message = "reopened the occurrence on " + prettyDate(originalStart.Format(time.RFC3339))
	case "skip":
		cancelled := true
		patch.IsCancelled = &cancelled
		message = "skipped the occurrence on " + prettyDate(originalStart.Format(time.RFC3339))
	case "restore":
		cancelled := false
		patch.IsCancelled = &cancelled
		patch.ClearMove = true
	case "move":
		if action.NewStart == nil {
			return nil, errors.New("move requires newStart")
		}
		newStart, err := recurrence.ParseTime(*action.NewStart)
		if err != nil {
			return nil, errors.New("invalid newStart")
		}
		duration := task.Duration
		newEnd := newStart
		if duration > 0 {
			newEnd = newStart.Add(time.Duration(duration) * time.Minute)
		}
		if action.NewEnd != nil && duration > 0 {
			parsed, err := recurrence.ParseTime(*action.NewEnd)
			if err != nil {
				return nil, errors.New("invalid newEnd")
			}
			if !parsed.After(newStart) {
				return nil, errors.New("occurrence must end after it starts")
			}
			newEnd = parsed
		}
		cancelled := false
		patch.IsCancelled = &cancelled
		patch.NewStart = &newStart
		patch.NewEnd = &newEnd
		message = "moved the occurrence on " + prettyDate(originalStart.Format(time.RFC3339)) + " to " + prettyDate(newStart.Format(time.RFC3339))
	default:
		return nil, errors.New("unknown occurrence action")
	}

	if _, err := s.recurrence.UpsertException(task.Recurrence, originalStart, patch); err != nil {
		return nil, err
	}
	if message != "" {
		_ = s.taskRepo.CreateActivities([]models.TaskActivity{
			newActivity(userID, s.actorName(userID), task.ID, "updated", "occurrence", message, "", ""),
		})
	}
	return s.taskRepo.GetTaskByIdForUser(userID, taskID)
}

func (s *taskService) Split(userID, taskID string, input SplitInput) (*models.Task, error) {
	if userID == "" || taskID == "" {
		return nil, errors.New("invalid request")
	}
	source, err := s.taskRepo.GetTaskByIdForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	if !source.IsRecurring() {
		return nil, errors.New("task is not recurring")
	}
	fromStart, err := recurrence.ParseTime(input.FromStart)
	if err != nil {
		return nil, errors.New("invalid split point")
	}
	if !fromStart.After(source.Recurrence.Dtstart) {
		return nil, errors.New("split point must be after the series start; edit the whole series instead")
	}

	rec := input.Recurrence
	if rec.RRule == "" {
		rec.RRule = source.Recurrence.RRule
	}
	if rec.Timezone == "" {
		rec.Timezone = source.Recurrence.Timezone
	}
	if rec.Dtstart == "" {
		rec.Dtstart = fromStart.Format(time.RFC3339)
	}
	if _, err := recurrence.Parse(rec.RRule); err != nil {
		return nil, err
	}

	next := &models.Task{
		ID:              utils.NewTaskID(),
		Name:            source.Name,
		Description:     source.Description,
		DescriptionRich: source.DescriptionRich,
		Duration:        source.Duration,
		Deadline:        source.Deadline,
		StartDate:       source.StartDate,
		UserID:          source.UserID,
		ProjectID:       source.ProjectID,
		StatusID:        source.StatusID,
		PriorityLevel:   source.PriorityLevel,
		WorkspaceID:     source.WorkspaceID,
		StageID:         source.StageID,
		BlockedByID:     source.BlockedByID,
		LabelIDs:        source.LabelIDs,
	}
	if input.Name != nil && strings.TrimSpace(*input.Name) != "" {
		next.Name = strings.TrimSpace(*input.Name)
	}
	if input.Duration != nil && *input.Duration >= 0 {
		next.Duration = *input.Duration
	}

	err = s.taskRepo.DB().Transaction(func(tx *gorm.DB) error {
		store := s.recurrence.WithTx(tx)
		if err := store.CloseBefore(source.Recurrence, fromStart); err != nil {
			return err
		}
		if err := tx.Omit("Recurrence", "Blocks").Create(next).Error; err != nil {
			return err
		}
		rule, err := store.Upsert(models.RecurrenceOwnerTask, next.ID, userID, rec)
		if err != nil {
			return err
		}
		if err := store.PreserveFutureExceptions(source.Recurrence, rule, fromStart); err != nil {
			return err
		}
		return tx.Model(&models.Task{}).Where("id = ?", next.ID).Update("scheduled_on", rule.Dtstart).Error
	})
	if err != nil {
		return nil, err
	}

	_ = s.taskRepo.CreateActivities([]models.TaskActivity{
		newActivity(userID, s.actorName(userID), next.ID, "created", "", "continued this series from "+prettyDate(fromStart.Format(time.RFC3339)), "", ""),
	})
	created, err := s.taskRepo.GetTaskByIdForUser(userID, next.ID)
	if err != nil {
		return nil, err
	}
	s.indexTask(created)
	return created, nil
}

func isCompletedStatusName(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "completed", "complete", "done":
		return true
	default:
		return false
	}
}

// syncCompletionWithStatus keeps completedAt and the workspace Completed status
// in lockstep when the client only sent one of the two.
func (s *taskService) syncCompletionWithStatus(task *models.Task, updates map[string]any) error {
	_, completedTouched := updates["completed_at"]
	_, statusTouched := updates["status_id"]
	if (!completedTouched && !statusTouched) || task.WorkspaceID == nil {
		return nil
	}

	statuses, err := s.taskRepo.GetWorkspaceStatuses(*task.WorkspaceID)
	if err != nil {
		return err
	}

	var completedStatus *models.Status
	var defaultStatus *models.Status
	for i := range statuses {
		status := &statuses[i]
		if completedStatus == nil && isCompletedStatusName(status.Name) {
			completedStatus = status
		}
		if status.IsDefault {
			defaultStatus = status
		}
	}

	if completedTouched && !statusTouched {
		if updates["completed_at"] != nil {
			if completedStatus != nil {
				updates["status_id"] = completedStatus.ID
			}
		} else if defaultStatus != nil {
			updates["status_id"] = defaultStatus.ID
		}
		return nil
	}

	if statusTouched && !completedTouched {
		statusID, _ := updates["status_id"].(string)
		var chosen *models.Status
		for i := range statuses {
			if statuses[i].ID == statusID {
				chosen = &statuses[i]
				break
			}
		}
		if chosen == nil {
			return nil
		}
		if isCompletedStatusName(chosen.Name) {
			if task.CompletedAt == nil || *task.CompletedAt == "" {
				updates["completed_at"] = utils.GetCurrentTimestamp()
			}
		} else if task.CompletedAt != nil && *task.CompletedAt != "" {
			updates["completed_at"] = nil
		}
	}

	return nil
}

// prepareCustomFieldValues checks every value against its field definition in
// the task's workspace and takes the type from that definition, so a client
// cannot write a value for another workspace or invent an option.
func (s *taskService) prepareCustomFieldValues(
	task *models.Task,
	values []*models.CustomFieldValue,
) ([]*models.CustomFieldValue, error) {
	if len(values) == 0 {
		return nil, nil
	}
	if task.WorkspaceID == nil {
		return nil, errors.New("task has no workspace for custom fields")
	}

	fieldIDs := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value.CustomFieldID == "" {
			return nil, errors.New("custom field id is required")
		}
		if _, exists := seen[value.CustomFieldID]; exists {
			return nil, errors.New("duplicate custom field id")
		}
		seen[value.CustomFieldID] = struct{}{}
		fieldIDs = append(fieldIDs, value.CustomFieldID)
	}

	fields, err := s.taskRepo.GetCustomFieldsByIDs(*task.WorkspaceID, fieldIDs)
	if err != nil {
		return nil, err
	}
	if len(fields) != len(fieldIDs) {
		return nil, errors.New("invalid custom field ids")
	}

	definitions := make(map[string]models.CustomField, len(fields))
	for _, field := range fields {
		definitions[field.ID] = field
	}

	for _, value := range values {
		field := definitions[value.CustomFieldID]
		value.Type = string(field.Type)
		value.TaskID = task.ID

		if len(value.OptionsValue) == 0 {
			continue
		}

		allowed := make(map[string]struct{}, len(field.Options.Options))
		for _, option := range field.Options.Options {
			allowed[option.ID] = struct{}{}
		}
		for _, option := range value.OptionsValue {
			if _, ok := allowed[option.Id]; !ok {
				return nil, errors.New("invalid custom field option")
			}
		}
	}

	return values, nil
}

func (s *taskService) ListActivity(userID string, taskID string) ([]models.TaskActivity, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	if taskID == "" {
		return nil, errors.New("invalid task id")
	}

	task, err := s.taskRepo.GetTaskByIdForUser(userID, taskID)
	if err != nil {
		return nil, err
	}

	entries, err := s.taskRepo.ListActivities(userID, taskID)
	if err != nil {
		return nil, err
	}

	hasCreated := false
	for _, entry := range entries {
		if entry.Action == "created" {
			hasCreated = true
			break
		}
	}
	if !hasCreated {
		actorID := deref(task.UserID)
		if actorID == "" {
			actorID = userID
		}
		entry := newActivity(actorID, s.actorName(actorID), task.ID, "created", "", "created this task", "", "")
		if task.CreatedAt != "" {
			entry.CreatedAt = task.CreatedAt
		}
		entries = append(entries, entry)
	}

	return entries, nil
}

func (s *taskService) AddComment(userID string, taskID string, comment string) (*models.TaskActivity, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	if taskID == "" {
		return nil, errors.New("invalid task id")
	}

	text := strings.TrimSpace(comment)
	if text == "" {
		return nil, errors.New("comment cannot be empty")
	}
	if len(text) > 2000 {
		text = text[:2000]
	}

	if _, err := s.taskRepo.GetTaskByIdForUser(userID, taskID); err != nil {
		return nil, err
	}

	entry := newActivity(userID, s.actorName(userID), taskID, "commented", "comment", text, "", text)
	if err := s.taskRepo.CreateActivities([]models.TaskActivity{entry}); err != nil {
		return nil, err
	}

	return &entry, nil
}

func (s *taskService) WithActor(name string) TaskService {
	clone := *s
	clone.actor = name
	return &clone
}

func (s *taskService) actorName(userID string) string {
	if s.actor != "" {
		return s.actor
	}
	return s.taskRepo.ActorName(userID)
}

func (s *taskService) indexTask(task *models.Task) {
	if s.indexer != nil {
		s.indexer.IndexTask(task)
	}
}

func (s *taskService) GetForUser(userID, taskID string) (*models.Task, error) {
	if userID == "" || taskID == "" {
		return nil, errors.New("invalid request")
	}
	task, err := s.taskRepo.GetTaskByIdForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	annotateProgressOne(task)
	return task, nil
}

func (s *taskService) List(userID string, filter TaskFilter) ([]models.Task, error) {
	if userID == "" {
		return nil, errors.New("invalid user id")
	}
	tasks, err := s.taskRepo.GetAllTaskByUser(userID)
	if err != nil {
		return nil, err
	}
	annotateProgress(tasks)
	return applyTaskFilter(tasks, filter), nil
}

func (s *taskService) Delete(userID, taskID string) error {
	if userID == "" || taskID == "" {
		return errors.New("invalid request")
	}
	if _, err := s.taskRepo.GetTaskByIdForUser(userID, taskID); err != nil {
		return err
	}
	if s.recurrence != nil {
		if err := s.recurrence.Delete(models.RecurrenceOwnerTask, taskID); err != nil {
			return err
		}
	}
	if err := s.taskRepo.DeleteTask(userID, taskID); err != nil {
		return err
	}
	if s.indexer != nil {
		s.indexer.Delete(userID, embed.KindTask, taskID)
	}
	return nil
}

const maxBulkIDs = 50

func (s *taskService) BulkUpdate(userID string, ids []string, update TaskUpdate) ([]models.Task, error) {
	if userID == "" {
		return nil, errors.New("user not authenticated")
	}
	if len(ids) == 0 {
		return nil, errors.New("task ids are required")
	}
	if len(ids) > maxBulkIDs {
		return nil, errors.New("too many task ids (max 50)")
	}
	out := make([]models.Task, 0, len(ids))
	for _, id := range ids {
		task, err := s.Update(userID, id, update)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", id, err)
		}
		out = append(out, *task)
	}
	return out, nil
}

func applyTaskFilter(tasks []models.Task, filter TaskFilter) []models.Task {
	wantedWorkspaces := setOf(filter.WorkspaceIDs)
	wantedProjects := setOf(filter.ProjectIDs)
	wantedStatuses := setOf(filter.StatusIDs)
	wantedLabels := setOf(filter.LabelIDs)
	text := strings.ToLower(strings.TrimSpace(filter.Text))

	var filtered []models.Task
	for i := range tasks {
		t := tasks[i]
		if !matchTaskKind(t, filter) {
			continue
		}
		if len(wantedWorkspaces) > 0 && (t.WorkspaceID == nil || !wantedWorkspaces[*t.WorkspaceID]) {
			continue
		}
		if len(wantedProjects) > 0 && (t.ProjectID == nil || !wantedProjects[*t.ProjectID]) {
			continue
		}
		if len(wantedStatuses) > 0 && (t.StatusID == nil || !wantedStatuses[*t.StatusID]) {
			continue
		}
		if filter.Priority != "" && deref(t.PriorityLevel) != filter.Priority {
			continue
		}
		if filter.StageID != "" && deref(t.StageID) != filter.StageID {
			continue
		}
		if len(wantedLabels) > 0 && !taskHasAnyLabel(t, wantedLabels) {
			continue
		}
		if filter.Completed != nil {
			if t.IsCompleted() != *filter.Completed {
				continue
			}
		}
		if filter.Overdue != nil && *filter.Overdue {
			if !IsOverdue(t, time.Now()) {
				continue
			}
		}
		if filter.DueBefore != "" && (t.Deadline == nil || *t.Deadline == "" || *t.Deadline >= filter.DueBefore) {
			continue
		}
		if filter.DueAfter != "" && (t.Deadline == nil || *t.Deadline == "" || *t.Deadline < filter.DueAfter) {
			continue
		}
		if filter.Scheduled != nil {
			hasBlock := len(t.Blocks) > 0 || (t.ScheduledOn != nil && *t.ScheduledOn != "")
			if hasBlock != *filter.Scheduled {
				continue
			}
		}
		if filter.HasRecurrence != nil && t.IsRecurring() != *filter.HasRecurrence {
			continue
		}
		if text != "" {
			haystack := strings.ToLower(t.Name + " " + t.Description)
			if !strings.Contains(haystack, text) {
				continue
			}
		}
		filtered = append(filtered, t)
	}

	sort.SliceStable(filtered, func(i, j int) bool {
		a, b := filtered[i], filtered[j]
		switch filter.Sort {
		case "name":
			return strings.ToLower(a.Name) < strings.ToLower(b.Name)
		case "createdAt", "created_at":
			return a.CreatedAt > b.CreatedAt
		case "priority":
			return priorityRank(deref(a.PriorityLevel)) < priorityRank(deref(b.PriorityLevel))
		default:
			return deadlineSortKey(a) < deadlineSortKey(b)
		}
	})

	limit := filter.Limit
	if limit <= 0 {
		limit = 200
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}
	if offset >= len(filtered) {
		return []models.Task{}
	}
	end := offset + limit
	if end > len(filtered) {
		end = len(filtered)
	}
	return filtered[offset:end]
}

func setOf(ids []string) map[string]bool {
	out := map[string]bool{}
	for _, id := range ids {
		if id != "" {
			out[id] = true
		}
	}
	return out
}

func taskHasAnyLabel(t models.Task, wanted map[string]bool) bool {
	for _, label := range t.LabelIDs {
		if wanted[label.Id] {
			return true
		}
	}
	return false
}

func deadlineSortKey(t models.Task) string {
	if t.Deadline == nil || *t.Deadline == "" {
		return "9999-99-99"
	}
	return *t.Deadline
}

func priorityRank(value string) int {
	return models.PriorityRank(value)
}

func normalizeTaskPriority(value *string) error {
	if value == nil || *value == "" {
		return nil
	}
	normalized := models.NormalizePriority(*value)
	if !models.ValidatePriority(normalized) || normalized == "" {
		return errors.New("invalid priority")
	}
	*value = normalized
	return nil
}

func (s *taskService) assertTaskScope(userID string, workspaceID, projectID, blockedByID *string) error {
	if userID == "" {
		return errors.New("user not authenticated")
	}
	if workspaceID != nil && *workspaceID != "" {
		if s.workspaces == nil {
			return errors.New("workspace lookup unavailable")
		}
		if _, err := s.workspaces.GetWorkspaceById(userID, *workspaceID); err != nil {
			return gorm.ErrRecordNotFound
		}
	}
	if projectID != nil && *projectID != "" {
		project, err := s.projectRepo.GetProjectByIdForUser(userID, *projectID)
		if err != nil {
			return gorm.ErrRecordNotFound
		}
		if workspaceID != nil && *workspaceID != "" && project.WorkspaceID != nil && *project.WorkspaceID != *workspaceID {
			return errors.New("project does not belong to workspace")
		}
	}
	if blockedByID != nil && *blockedByID != "" {
		if _, err := s.taskRepo.GetTaskByIdForUser(userID, *blockedByID); err != nil {
			return errors.New("blocking task not found")
		}
	}
	return nil
}
