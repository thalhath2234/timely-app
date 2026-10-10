package task

import (
	"errors"
	"math"
	"strings"
	"time"
	"timely-api/internal/models"
	"timely-api/internal/recurrence"
	"timely-api/internal/utils"
)

const maxTodayFocus = 7

func annotateProgress(tasks []models.Task) {
	for i := range tasks {
		applyProgress(&tasks[i])
	}
}

func annotateProgressOne(task *models.Task) {
	if task == nil {
		return
	}
	applyProgress(task)
}

func applyProgress(task *models.Task) {
	doneChk, totalChk := task.Checklist.Progress()
	task.ChecklistDone = doneChk
	task.ChecklistTotal = totalChk
	task.ProgressDone = doneChk
	task.ProgressTotal = totalChk
}

func (s *taskService) Duplicate(userID, taskID string) (*models.Task, error) {
	return s.duplicateTree(userID, taskID, duplicateOpts{namePrefix: "Copy of "})
}

type duplicateOpts struct {
	namePrefix string
	projectID  *string
	stageID    *string
	// fresh starts the copy over: no dates, unchecked checklist and the
	// workspace's default status, for a new project started from an old one.
	// A repeating task's series starts again on seriesFrom (a date; today
	// when empty) with the same rule.
	fresh      bool
	seriesFrom string
}

func (s *taskService) duplicateTree(userID, taskID string, opts duplicateOpts) (*models.Task, error) {
	src, err := s.taskRepo.GetTaskByIdForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	clone := &models.Task{
		Name:                  strings.TrimSpace(opts.namePrefix + src.Name),
		Description:           src.Description,
		DescriptionRich:       src.DescriptionRich,
		Duration:              src.Duration,
		Kind:                  src.Kind,
		Deadline:              src.Deadline,
		StartDate:             src.StartDate,
		UserID:                &userID,
		ProjectID:             firstNonEmpty(opts.projectID, src.ProjectID),
		StatusID:              src.StatusID,
		PriorityLevel:         src.PriorityLevel,
		WorkspaceID:           src.WorkspaceID,
		StageID:               firstNonEmpty(opts.stageID, src.StageID),
		LabelIDs:              src.LabelIDs,
		Checklist:             src.Checklist.Clone(),
		MinChunkMinutes:       src.MinChunkMinutes,
		PreferredChunkMinutes: src.PreferredChunkMinutes,
		Contiguous:            src.Contiguous,
		EarliestStartAt:       src.EarliestStartAt,
		PreferredWindows:      src.PreferredWindows,
	}
	if opts.fresh {
		clone.Deadline = nil
		clone.StartDate = nil
		clone.EarliestStartAt = nil
		clone.Checklist = src.Checklist.CloneUnchecked()
		clone.StatusID = nil
		if clone.WorkspaceID != nil {
			if statusID := s.defaultStatusID(*clone.WorkspaceID); statusID != "" {
				clone.StatusID = &statusID
			}
		}
	}
	if clone.Kind == models.KindInbox {
		clone.Duration = 0
		clone.StatusID = nil
		clone.StageID = nil
	}
	if clone.Kind == models.KindReminder {
		// A Reminder is its ping; Create refuses one without it. A repeating
		// Reminder's scheduled_on mirrors its series start, so this covers both.
		clone.ScheduledOn = src.ScheduledOn
	}
	created, err := s.Create(clone, nil, nil)
	if err != nil {
		return nil, err
	}
	if src.IsRecurring() && src.Recurrence != nil {
		rec := models.RecurrenceInput{
			RRule:    src.Recurrence.RRule,
			Dtstart:  src.Recurrence.Dtstart.UTC().Format(time.RFC3339),
			Timezone: src.Recurrence.Timezone,
		}
		if opts.fresh {
			from := opts.seriesFrom
			if from == "" {
				from = time.Now().In(src.Recurrence.Location()).Format("2006-01-02")
			}
			if restarted, err := restartSeries(src.Recurrence, from); err == nil {
				rec = restarted
			}
		}
		if err := s.applyRecurrence(userID, created, &rec); err != nil {
			return nil, err
		}
	}

	return s.GetForUser(userID, created.ID)
}

func firstNonEmpty(preferred, fallback *string) *string {
	if preferred != nil && strings.TrimSpace(*preferred) != "" {
		return preferred
	}
	return fallback
}

// restartSeries starts a repeating task's series again on the first day on
// or after from (a date in the rule's zone) that its rule falls on, at the
// same clock time. The rule stays the same: weekly on Mondays is still weekly
// on Mondays, now from the first Monday on or after from. An UNTIL moves by
// as many days as the start, so the series keeps its length.
func restartSeries(rule *models.RecurrenceRule, from string) (models.RecurrenceInput, error) {
	loc := rule.Location()
	old := rule.Dtstart.In(loc)
	day, err := time.ParseInLocation("2006-01-02", models.NormalizeDate(from), loc)
	if err != nil {
		return models.RecurrenceInput{}, err
	}
	parsed, err := recurrence.Parse(rule.RRule)
	if err != nil {
		return models.RecurrenceInput{}, err
	}
	// The pattern alone, with the parts the old start implied written out,
	// finds the first matching day; the interval then counts from there.
	pattern := *parsed
	pattern.Interval, pattern.Count, pattern.Until = 1, 0, nil
	switch pattern.Freq {
	case recurrence.Weekly:
		if len(pattern.ByDay) == 0 {
			pattern.ByDay = []recurrence.ByDay{{Weekday: old.Weekday()}}
		}
	case recurrence.Monthly:
		if len(pattern.ByDay) == 0 && len(pattern.ByMonthDay) == 0 {
			pattern.ByMonthDay = []int{old.Day()}
		}
	case recurrence.Yearly:
		if len(pattern.ByMonth) == 0 {
			pattern.ByMonth = []int{int(old.Month())}
		}
		if len(pattern.ByDay) == 0 && len(pattern.ByMonthDay) == 0 {
			pattern.ByMonthDay = []int{old.Day()}
		}
	}
	anchor := time.Date(day.Year(), day.Month(), day.Day(), old.Hour(), old.Minute(), old.Second(), 0, loc)
	start := anchor
	if next := pattern.Next(anchor, anchor); next != nil {
		start = *next
	}
	text := rule.RRule
	if parsed.Until != nil {
		shift := int(math.Round(dateOnly(start).Sub(dateOnly(old)).Hours() / 24))
		until := parsed.Until.In(loc).AddDate(0, 0, shift).UTC()
		parsed.Until = &until
		text = parsed.String()
	}
	return models.RecurrenceInput{RRule: text, Dtstart: start.Format(time.RFC3339), Timezone: rule.Timezone}, nil
}

// dateOnly is t's calendar date at midnight UTC, for counting whole days.
func dateOnly(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// CopyProjectTasks copies a project's tasks into another project. fresh resets
// each copy's dates, checklist and status (see duplicateOpts.fresh) and starts
// a repeating task's series on the new project's start, or today.
func (s *taskService) CopyProjectTasks(userID, fromProjectID, toProjectID string, stageMap map[string]string, fresh bool) error {
	tasks, err := s.taskRepo.GetAllTaskByUser(userID)
	if err != nil {
		return err
	}
	seriesFrom := ""
	if fresh && s.projectRepo != nil {
		if target, err := s.projectRepo.GetProjectByIdForUser(userID, toProjectID); err == nil && target.StartDate != nil {
			seriesFrom = models.NormalizeDate(*target.StartDate)
		}
	}
	for i := range tasks {
		t := tasks[i]
		if deref(t.ProjectID) != fromProjectID {
			continue
		}
		// A Reminder belongs to no project; a copy would be a free-floating
		// ping at the same time as the original.
		if t.IsReminder() {
			continue
		}
		var stage *string
		if t.StageID != nil {
			if mapped, ok := stageMap[*t.StageID]; ok {
				stage = &mapped
			}
		}
		if _, err := s.duplicateTree(userID, t.ID, duplicateOpts{
			projectID:  &toProjectID,
			stageID:    stage,
			fresh:      fresh,
			seriesFrom: seriesFrom,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *taskService) AddChecklistItem(userID, taskID, title string) (*models.Task, error) {
	task, err := s.taskRepo.GetTaskByIdForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	title = strings.TrimSpace(title)
	if title == "" {
		return nil, errors.New("checklist title cannot be empty")
	}
	item := models.NewChecklistItem(title, len(task.Checklist))
	task.Checklist = append(task.Checklist, item)
	return s.saveChecklist(userID, task)
}

func (s *taskService) UpdateChecklistItem(userID, taskID, itemID string, title *string, completed *bool) (*models.Task, error) {
	task, err := s.taskRepo.GetTaskByIdForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	found := false
	for i := range task.Checklist {
		if task.Checklist[i].ID != itemID {
			continue
		}
		found = true
		if title != nil {
			next := strings.TrimSpace(*title)
			if next == "" {
				return nil, errors.New("checklist title cannot be empty")
			}
			task.Checklist[i].Title = next
		}
		if completed != nil {
			if *completed {
				now := utils.GetCurrentTimestamp()
				task.Checklist[i].CompletedAt = &now
			} else {
				task.Checklist[i].CompletedAt = nil
			}
		}
	}
	if !found {
		return nil, errors.New("checklist item not found")
	}
	return s.saveChecklist(userID, task)
}

func (s *taskService) DeleteChecklistItem(userID, taskID, itemID string) (*models.Task, error) {
	task, err := s.taskRepo.GetTaskByIdForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	next := models.Checklist{}
	for _, item := range task.Checklist {
		if item.ID != itemID {
			item.Order = len(next)
			next = append(next, item)
		}
	}
	if len(next) == len(task.Checklist) {
		return nil, errors.New("checklist item not found")
	}
	task.Checklist = next
	return s.saveChecklist(userID, task)
}

func (s *taskService) ReplaceChecklist(userID, taskID string, items models.Checklist) (*models.Task, error) {
	task, err := s.taskRepo.GetTaskByIdForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	normalized := models.Checklist{}
	for i, item := range items {
		title := strings.TrimSpace(item.Title)
		if title == "" {
			continue
		}
		if item.ID == "" {
			item = models.NewChecklistItem(title, i)
		} else {
			item.Title = title
			item.Order = i
		}
		normalized = append(normalized, item)
	}
	task.Checklist = normalized
	return s.saveChecklist(userID, task)
}

func (s *taskService) saveChecklist(userID string, task *models.Task) (*models.Task, error) {
	if task.Checklist == nil {
		task.Checklist = models.Checklist{}
	}
	updated, err := s.taskRepo.UpdateTask(userID, task.ID, map[string]any{
		"checklist":  task.Checklist,
		"updated_at": utils.GetCurrentTime(),
	})
	if err != nil {
		return nil, err
	}
	return s.GetForUser(userID, updated.ID)
}

func (s *taskService) StartFocus(userID, taskID string) (*models.Task, error) {
	task, err := s.taskRepo.GetTaskByIdForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	if task.IsCompleted() {
		return nil, errors.New("cannot focus a completed task")
	}
	all, err := s.taskRepo.GetAllTaskByUser(userID)
	if err != nil {
		return nil, err
	}
	for i := range all {
		other := all[i]
		if other.ID == taskID {
			continue
		}
		if other.IsFocusing() || other.FocusPausedAt != nil {
			if _, err := s.stopFocusTask(userID, &other); err != nil {
				return nil, err
			}
		}
	}
	now := utils.GetCurrentTimestamp()
	if _, err := s.taskRepo.UpdateTask(userID, taskID, map[string]any{
		"focus_started_at": now,
		"focus_paused_at":  nil,
		"updated_at":       utils.GetCurrentTime(),
	}); err != nil {
		return nil, err
	}
	return s.GetForUser(userID, taskID)
}

func (s *taskService) PauseFocus(userID, taskID string) (*models.Task, error) {
	task, err := s.taskRepo.GetTaskByIdForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	if !task.IsFocusing() {
		if task.FocusPausedAt != nil {
			return s.GetForUser(userID, taskID)
		}
		return nil, errors.New("task is not being focused")
	}
	elapsed := elapsedFocusMinutes(*task.FocusStartedAt)
	if _, err := s.taskRepo.UpdateTask(userID, taskID, map[string]any{
		"actual_minutes":   task.ActualMinutes + elapsed,
		"focus_started_at": nil,
		"focus_paused_at":  utils.GetCurrentTimestamp(),
		"updated_at":       utils.GetCurrentTime(),
	}); err != nil {
		return nil, err
	}
	return s.GetForUser(userID, taskID)
}

func (s *taskService) StopFocus(userID, taskID string) (*models.Task, error) {
	task, err := s.taskRepo.GetTaskByIdForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	if _, err := s.stopFocusTask(userID, task); err != nil {
		return nil, err
	}
	return s.GetForUser(userID, taskID)
}

func (s *taskService) stopFocusTask(userID string, task *models.Task) (*models.Task, error) {
	if !task.IsFocusing() {
		if task.FocusPausedAt == nil {
			return task, nil
		}
		return s.taskRepo.UpdateTask(userID, task.ID, map[string]any{
			"focus_paused_at": nil,
			"updated_at":      utils.GetCurrentTime(),
		})
	}
	elapsed := elapsedFocusMinutes(*task.FocusStartedAt)
	return s.taskRepo.UpdateTask(userID, task.ID, map[string]any{
		"actual_minutes":   task.ActualMinutes + elapsed,
		"focus_started_at": nil,
		"focus_paused_at":  nil,
		"updated_at":       utils.GetCurrentTime(),
	})
}

func elapsedFocusMinutes(startedAt string) int {
	start, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		start, err = time.Parse(time.RFC3339Nano, startedAt)
		if err != nil {
			return 0
		}
	}
	seconds := time.Since(start).Seconds()
	if seconds < 15 {
		return 0
	}
	minutes := int(time.Since(start).Minutes())
	if minutes < 1 {
		return 1
	}
	return minutes
}

func (s *taskService) SetTodayFocus(userID, taskID string, date *string) (*models.Task, error) {
	if _, err := s.taskRepo.GetTaskByIdForUser(userID, taskID); err != nil {
		return nil, err
	}
	var focusDate any
	if date != nil && strings.TrimSpace(*date) != "" {
		day := strings.TrimSpace(*date)
		if _, err := time.Parse("2006-01-02", day); err != nil {
			return nil, errors.New("today focus date must be YYYY-MM-DD")
		}
		all, err := s.taskRepo.GetAllTaskByUser(userID)
		if err != nil {
			return nil, err
		}
		count := 0
		for i := range all {
			if models.NormalizeDate(deref(all[i].TodayFocusOn)) == day && all[i].ID != taskID {
				count++
			}
		}
		if count >= maxTodayFocus {
			return nil, errors.New("today focus is limited to 7 tasks")
		}
		focusDate = day
	}
	if _, err := s.taskRepo.UpdateTask(userID, taskID, map[string]any{
		"today_focus_on": focusDate,
		"updated_at":     utils.GetCurrentTime(),
	}); err != nil {
		return nil, err
	}
	return s.GetForUser(userID, taskID)
}

func matchTaskKind(t models.Task, filter TaskFilter) bool {
	wantInbox := (filter.Inbox != nil && *filter.Inbox) || strings.EqualFold(strings.TrimSpace(filter.Kind), models.KindInbox)
	wantReminders := (filter.Reminders != nil && *filter.Reminders) || strings.EqualFold(strings.TrimSpace(filter.Kind), models.KindReminder)
	kind := strings.ToLower(strings.TrimSpace(filter.Kind))

	switch {
	case wantInbox:
		return t.IsInbox()
	case wantReminders:
		return t.IsReminder()
	case kind == models.KindTask:
		return t.Kind == models.KindTask || (t.Kind == "" && t.Duration > 0)
	case kind != "":
		return t.Kind == kind
	default:
		return !t.IsReminder() && !t.IsInbox()
	}
}

func (s *taskService) applyKindUpdate(userID string, before *models.Task, update TaskUpdate, updates map[string]any) error {
	kind := before.Kind
	duration := before.Duration
	workspaceID := before.WorkspaceID
	if update.Duration != nil {
		duration = *update.Duration
	}
	if update.WorkspaceID != nil {
		if strings.TrimSpace(*update.WorkspaceID) == "" {
			workspaceID = nil
		} else {
			workspaceID = update.WorkspaceID
		}
	}
	if update.Kind != nil {
		normalized, err := models.NormalizeKind(*update.Kind)
		if err != nil {
			return err
		}
		kind = normalized
	} else if update.Duration != nil && kind != models.KindInbox {
		if duration <= 0 {
			kind = models.KindReminder
		} else if kind == models.KindReminder || kind == "" {
			kind = models.KindTask
		}
	}
	if update.Duration != nil {
		updates["duration"] = duration
	}
	if kind == models.KindTask {
		if duration <= 0 {
			return errors.New("work tasks need a duration greater than 0")
		}
		if workspaceID == nil || strings.TrimSpace(*workspaceID) == "" {
			return ErrWorkspaceRequired
		}
		// Clarifying an inbox item (or converting a reminder) must land on the
		// board as a normal task: give it the workspace default status when
		// neither the row nor the update carries one.
		if kind != before.Kind {
			if _, statusTouched := updates["status_id"]; !statusTouched && (before.StatusID == nil || *before.StatusID == "") {
				if statusID := s.defaultStatusID(*workspaceID); statusID != "" {
					updates["status_id"] = statusID
				}
			}
		}
	}
	if kind == models.KindInbox {
		updates["duration"] = 0
		updates["scheduled_on"] = nil
	}
	if kind == models.KindReminder {
		updates["duration"] = 0
	}
	// Only the change of kind clears the board fields; a Reminder that stays
	// one keeps what the person sets on it (its workspace picker).
	if kind == models.KindReminder && before.Kind != models.KindReminder {
		labels := before.LabelIDs
		if update.LabelIDs != nil {
			labels = *update.LabelIDs
		}
		fields := len(before.CustomFieldValues)
		if update.CustomFieldValues != nil {
			fields = len(*update.CustomFieldValues)
		}
		row := models.Task{
			WorkspaceID: workspaceID,
			ProjectID:   mergedID(update.ProjectID, before.ProjectID),
			StatusID:    mergedID(update.StatusID, before.StatusID),
			StageID:     mergedID(update.StageID, before.StageID),
		}
		applyReminderRules(&row, len(labels) > 0 || fields > 0)
		for column, kept := range map[string]*string{
			"workspace_id": row.WorkspaceID,
			"project_id":   row.ProjectID,
			"status_id":    row.StatusID,
			"stage_id":     row.StageID,
		} {
			if kept == nil {
				updates[column] = nil
			}
		}
	}
	if kind != before.Kind || update.Kind != nil {
		updates["kind"] = kind
	}
	_ = userID
	return nil
}

// defaultStatusID returns the workspace's default status, or "" when the
// lookup is unavailable (unit tests construct the service without a repo).
func (s *taskService) defaultStatusID(workspaceID string) string {
	if s == nil || s.taskRepo == nil || workspaceID == "" {
		return ""
	}
	statuses, err := s.taskRepo.GetWorkspaceStatuses(workspaceID)
	if err != nil {
		return ""
	}
	for i := range statuses {
		if statuses[i].IsDefault {
			return statuses[i].ID
		}
	}
	if len(statuses) > 0 {
		return statuses[0].ID
	}
	return ""
}
