package notify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"maps"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"timely-api/internal/features/calendar"
	"timely-api/internal/features/embed"
	"timely-api/internal/features/schedule"
	"timely-api/internal/features/task"
	"timely-api/internal/jobs"
	"timely-api/internal/models"

	"gorm.io/gorm"
)

type Service struct {
	repo     *repository
	queue    *jobs.Queue
	calendar calendar.Service
	tasks    task.TaskService
	schedule schedule.Service
	indexer  embed.Indexer
	http     *http.Client
	// expoBase is Expo's push API (send is expoBase+"/send", receipts
	// expoBase+"/getReceipts"); expoToken, when set, goes as a Bearer token.
	expoBase     string
	expoToken    string
	overdueSwept map[string]time.Time
	triage       Triager   // nil until SetTriage
	alerts       Alerter   // nil until SetAlerts
	briefing     Briefer   // nil until SetBriefing
	botDigest    BotDigest // nil until SetBotDigest
	triageSlots  chan struct{}
	triageWait   sync.WaitGroup
	// triagePending holds each account's notifications waiting for a step;
	// an account is listed while its runTriage runs.
	triageMu      sync.Mutex
	triagePending map[string][]triageWork
	triageGather  time.Duration
	// briefSlots are the morning briefing's own, so a triage backlog never
	// holds a briefing back.
	briefSlots chan struct{}

	// Smart suggestions' status and feedback; nil until SetDecisions.
	decisionsOn func(ctx context.Context, userID string) bool
	feedback    func(userID, logID string, accepted bool) error
	// dismissed records a smart alert set aside without its step; nil until
	// SetDismissed.
	dismissed func(userID, logID string) error
	// dismissedPruned is when each account's old dismissed alerts were last
	// deleted; sweepDismissed fills it.
	dismissedPruned map[string]time.Time
	// reminderSwept is when each account's reminders were last swept, so a
	// sweep after a gap (the computer slept, the app was closed) catches up.
	reminderSwept map[string]time.Time
	// smartOffUntil is when the sweep next asks whether an account without
	// smart suggestions has them now; sweepSmartAlerts fills it.
	smartOffUntil map[string]time.Time
}

func NewService(db *gorm.DB, queue *jobs.Queue, calendar calendar.Service, tasks task.TaskService, scheduler schedule.Service, indexer embed.Indexer) *Service {
	expoBase, err := expoBaseURL(os.Getenv("TIMELY_EXPO_PUSH_URL"))
	if err != nil {
		log.Printf("notify: TIMELY_EXPO_PUSH_URL must be https; using Expo's")
	}
	return &Service{
		repo:         newRepository(db),
		queue:        queue,
		calendar:     calendar,
		tasks:        tasks,
		schedule:     scheduler,
		indexer:      indexer,
		http:         &http.Client{Timeout: 15 * time.Second},
		expoBase:     expoBase,
		expoToken:    strings.TrimSpace(os.Getenv("TIMELY_EXPO_ACCESS_TOKEN")),
		overdueSwept: map[string]time.Time{},
		triageSlots:  make(chan struct{}, triageParallel),

		triagePending: map[string][]triageWork{},
		triageGather:  triageGather,
		briefSlots:    make(chan struct{}, briefParallel),
	}
}

func (s *Service) Register(worker *jobs.Worker) {
	worker.Handle(models.JobSendReminder, s.HandleReminder)
	worker.Handle(models.JobDailyDigest, s.HandleDigest)
	worker.Handle(models.JobOverdueTask, s.HandleOverdueTask)
	worker.Handle(models.JobMissedBlock, s.HandleMissedBlock)
	worker.Handle(models.JobStartSoon, s.HandleStartSoon)
	worker.Handle(models.JobSmartAlerts, s.HandleSmartAlerts)
	worker.Handle(models.JobSendPush, s.HandlePush)
	worker.Handle(models.JobPushReceipts, s.HandleReceipts)
	worker.Handle(models.JobIndexEntity, s.HandleIndex)
	worker.SetSweep(s.Sweep)
}

// GetSettings returns the stored preferences with the *effective* timezone
// filled in: an explicit notification timezone wins, otherwise the working
// hours timezone, otherwise the server's own zone (reported as "" since it has
// no IANA name). Digest and quiet-hour jobs use the same
// resolution, so what the settings screen shows is what the scheduler uses.
func (s *Service) GetSettings(userID string) (models.NotificationSettings, error) {
	settings, err := s.repo.GetSettings(userID)
	if err != nil {
		return settings, err
	}
	settings.Timezone = settings.ZoneName(s.repo.WorkingHoursTimezone(userID))
	return settings, nil
}

func (s *Service) UpdateSettings(userID string, settings models.NotificationSettings) (models.NotificationSettings, error) {
	normalized := settings.Normalized()
	if tz := strings.TrimSpace(normalized.Timezone); tz != "" {
		if _, err := time.LoadLocation(tz); err != nil || tz == "Local" {
			return models.NotificationSettings{}, fmt.Errorf("invalid timezone %q", tz)
		}
		normalized.Timezone = tz
	}
	if err := s.repo.UpdateSettings(userID, normalized); err != nil {
		return models.NotificationSettings{}, err
	}
	// Read back, so the reply shows the stored hidePushText.
	return s.GetSettings(userID)
}

// SetPushTextHidden turns "Hide alert text in push" on or off and returns
// the saved settings.
func (s *Service) SetPushTextHidden(userID string, hidden bool) (models.NotificationSettings, error) {
	if err := s.repo.SetPushTextHidden(userID, hidden); err != nil {
		return models.NotificationSettings{}, err
	}
	return s.GetSettings(userID)
}

// List and UnreadCount first settle overdue and missed notices whose task was
// finished since, however it was finished (any app, chat or an MCP agent).
func (s *Service) List(userID string, unreadOnly bool, limit int) ([]models.Notification, error) {
	_ = s.repo.MarkDoneTaskAlertsRead(userID)
	return s.repo.List(userID, unreadOnly, limit)
}

func (s *Service) UnreadCount(userID string) (int64, error) {
	_ = s.repo.MarkDoneTaskAlertsRead(userID)
	return s.repo.UnreadCount(userID)
}

func (s *Service) MarkRead(userID, id string) (*models.Notification, error) {
	return s.repo.MarkRead(userID, id)
}

func (s *Service) MarkAllRead(userID string) error {
	return s.repo.MarkAllRead(userID)
}

// ClearAll removes every notification. Smart alerts are hidden rather than
// deleted, and each one cleared without its step counts as dismissed.
func (s *Service) ClearAll(userID string) error {
	rows, err := s.repo.DismissAlerts(userID, "")
	if err != nil {
		return err
	}
	s.alertsDismissed(userID, rows)
	return s.repo.ClearAll(userID)
}

// Delete removes one notification; a smart alert is dismissed as in
// ClearAll.
func (s *Service) Delete(userID, id string) error {
	n, err := s.repo.Get(userID, id)
	if err != nil {
		return err
	}
	if n.Category != models.NotifySuggestion {
		return s.repo.Delete(userID, id)
	}
	rows, err := s.repo.DismissAlerts(userID, id)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return gorm.ErrRecordNotFound // already dismissed
	}
	s.alertsDismissed(userID, rows)
	return nil
}

// PrioritizeOverdue is the server-side action for an overdue task.
// Scheduling all eligible tasks lets the urgent task take the earliest free
// slot instead of leaving existing lower-priority engine blocks in its way.
func (s *Service) PrioritizeOverdue(userID, taskID string) (*schedule.PlanResponse, error) {
	item, err := s.tasks.GetForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	if item.Deadline == nil || !overdueTaskCurrent(item, *item.Deadline, s.notificationToday(userID)) {
		return nil, errors.New("task is no longer past its deadline")
	}
	priority := models.PriorityUrgent
	previousPriority := ""
	if item.PriorityLevel != nil {
		previousPriority = *item.PriorityLevel
	}
	if _, err := s.tasks.Update(userID, item.ID, task.TaskUpdate{PriorityLevel: &priority}); err != nil {
		return nil, err
	}
	plan, err := s.schedule.Apply(userID, schedule.PlanRequest{Timezone: s.notificationTimezone(userID)})
	if err != nil {
		if _, restoreErr := s.tasks.Update(userID, item.ID, task.TaskUpdate{PriorityLevel: &previousPriority}); restoreErr != nil {
			return nil, errors.Join(err, fmt.Errorf("restore task priority: %w", restoreErr))
		}
		return nil, err
	}
	_ = s.repo.MarkOverdueRead(userID, taskID)
	return plan, nil
}

// notificationTimezone is the zone name Auto-schedule is asked to use, "" when
// it is the server's own.
func (s *Service) notificationTimezone(userID string) string {
	settings, _ := s.repo.GetSettings(userID)
	return settings.ZoneName(s.repo.WorkingHoursTimezone(userID))
}

func (s *Service) RegisterDevice(userID, sessionID, token, platform string) (*models.PushDevice, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, errors.New("push token is required")
	}
	return s.repo.RegisterDevice(userID, sessionID, token, platform)
}

func (s *Service) UnregisterDevice(userID, token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return errors.New("push token is required")
	}
	return s.repo.UnregisterDevice(userID, token)
}

type SnoozeInput struct {
	Minutes int    `json:"minutes"`
	Until   string `json:"until"`
}

func (s *Service) Snooze(userID, id string, in SnoozeInput) (*models.Notification, error) {
	ntf, err := s.repo.Get(userID, id)
	if err != nil {
		return nil, err
	}
	until, err := parseSnoozeUntil(in)
	if err != nil {
		return nil, err
	}
	if err := s.rescheduleReminder(userID, ntf, until); err != nil {
		return nil, err
	}
	if err := s.repo.SetSnoozed(userID, id, until); err != nil {
		return nil, err
	}
	return s.repo.Get(userID, id)
}

func parseSnoozeUntil(in SnoozeInput) (time.Time, error) {
	if in.Until != "" {
		parsed, err := time.Parse(time.RFC3339, in.Until)
		if err != nil {
			return time.Time{}, errors.New("until must be RFC3339")
		}
		if !parsed.After(time.Now()) {
			return time.Time{}, errors.New("until must be in the future")
		}
		return parsed, nil
	}
	if in.Minutes <= 0 {
		return time.Time{}, errors.New("minutes or until is required")
	}
	return time.Now().Add(time.Duration(in.Minutes) * time.Minute), nil
}

func (s *Service) rescheduleReminder(userID string, ntf *models.Notification, until time.Time) error {
	taskID := ntf.Data.String("taskId")
	if taskID == "" && ntf.EntityID != nil {
		taskID = *ntf.EntityID
	}
	if taskID == "" {
		return errors.New("notification is not tied to a reminder")
	}
	item, err := s.tasks.GetForUser(userID, taskID)
	if err != nil {
		return err
	}
	untilStr := until.UTC().Format(time.RFC3339)
	originalStart := ntf.Data.String("originalStart")
	if item.IsRecurring() && originalStart != "" {
		_, err = s.tasks.EditOccurrence(userID, taskID, task.OccurrenceAction{
			OriginalStart: originalStart,
			Action:        "move",
			NewStart:      &untilStr,
		})
	} else {
		_, err = s.tasks.Update(userID, taskID, task.TaskUpdate{ScheduledOn: &untilStr})
	}
	if err != nil {
		return err
	}
	key := reminderDedupe(taskID, until.UTC())
	_, err = s.queue.Enqueue(jobs.Enqueue{
		UserID:    userID,
		Kind:      models.JobSendReminder,
		DedupeKey: key,
		RunAt:     until.UTC(),
		Payload: models.JobPayload{
			"taskId":        taskID,
			"start":         until.UTC().Format(time.RFC3339),
			"originalStart": originalStart,
			"title":         item.Name,
		},
	})
	return err
}

func (s *Service) Sweep(ctx context.Context) error {
	ids, err := s.queue.UserIDs()
	if err != nil {
		return err
	}
	now := time.Now()
	for _, userID := range ids {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := s.sweepReminders(userID, now); err != nil {
			return err
		}
		if err := s.sweepDigests(userID, now); err != nil {
			return err
		}
		if err := s.sweepOverdue(userID, now); err != nil {
			return err
		}
		if err := s.sweepMissedAndStart(userID, now); err != nil {
			return err
		}
		if err := s.sweepDismissed(userID, now); err != nil {
			return err
		}
		if err := s.sweepSmartAlerts(ctx, userID, now); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) sweepOverdue(userID string, now time.Time) error {
	settings, err := s.repo.GetSettings(userID)
	if err != nil {
		return err
	}
	if !settings.Reminders {
		return nil
	}
	today := s.notificationDay(userID, settings, now)
	if now.Sub(s.overdueSwept[userID]) < 5*time.Minute {
		return nil
	}
	tasks, err := s.tasks.GetAllTaskByUser(userID)
	if err != nil {
		return err
	}
	for _, item := range tasks {
		if item.Deadline == nil || !overdueTaskCurrent(&item, *item.Deadline, today) {
			continue
		}
		key := overdueDedupe(item.ID, *item.Deadline)
		if s.queue.HasJob(key) || s.queue.HasNotification(key) {
			continue
		}
		if _, err := s.queue.Enqueue(jobs.Enqueue{
			UserID: userID, Kind: models.JobOverdueTask, DedupeKey: key,
			Payload: models.JobPayload{"taskId": item.ID, "deadline": *item.Deadline},
		}); err != nil {
			return err
		}
	}
	s.overdueSwept[userID] = now
	return nil
}

func (s *Service) HandleOverdueTask(ctx context.Context, job *models.Job) error {
	settings, err := s.repo.GetSettings(job.UserID)
	if err != nil {
		return err
	}
	if !settings.Reminders {
		return nil
	}
	item, err := s.tasks.GetForUser(job.UserID, job.Payload.String("taskId"))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	deadline := job.Payload.String("deadline")
	if !overdueTaskCurrent(item, deadline, s.notificationDay(job.UserID, settings, time.Now())) {
		return nil
	}
	entity := item.ID
	today := s.notificationDay(job.UserID, settings, time.Now())
	row := &models.Notification{
		UserID: job.UserID, Category: models.NotifyOverdue,
		Title: item.Name, Body: "Past deadline. Reschedule as urgent?",
		EntityType: strPtr("task"), EntityID: &entity,
		Data:      models.JobPayload{"taskId": item.ID, "deadline": deadline},
		DedupeKey: job.DedupeKey,
	}
	ntf, err := s.repo.Upsert(row)
	if err != nil {
		return err
	}
	if ntf.ID == row.ID {
		s.suggestLater(ntf.ID, job.UserID, item, models.NotifyOverdue, "overdue", daysPast(deadline, today))
	}
	return s.deliver(ctx, ntf, settings)
}

// overdueTaskCurrent is true when an overdue notification for deadline is still
// actionable: the task is Overdue today, still has that deadline, and is
// schedulable Work (so it can be rescheduled as urgent).
func overdueTaskCurrent(item *models.Task, deadline string, today task.Today) bool {
	return item != nil && deadline != "" &&
		item.Deadline != nil && *item.Deadline == deadline &&
		item.IsSchedulableWork() && task.IsOverdue(*item, today)
}

// notificationDay is today in the notification timezone. Notify deliberately
// does not use the Working hours timezone directly: the person can set a
// notification timezone of their own, which only falls back to Working hours.
func (s *Service) notificationDay(userID string, settings models.NotificationSettings, now time.Time) task.Today {
	return task.TodayAt(now, settings.Location(s.repo.WorkingHoursTimezone(userID)))
}

func (s *Service) notificationToday(userID string) task.Today {
	settings, err := s.repo.GetSettings(userID)
	if err != nil {
		log.Printf("notify: read settings for %s: %v", userID, err)
	}
	return s.notificationDay(userID, settings, time.Now())
}

const startLead = 10 * time.Minute

func (s *Service) sweepMissedAndStart(userID string, now time.Time) error {
	settings, err := s.repo.GetSettings(userID)
	if err != nil {
		return err
	}
	if !settings.Reminders {
		return nil
	}
	from := now.Add(-90 * time.Second)
	to := now.Add(startLead + 90*time.Second)
	res, err := s.calendar.Range(userID, from, to)
	if err != nil {
		return err
	}
	for _, item := range res.Items {
		if item.Reminder || item.TaskID == "" || item.CompletedAt != nil {
			continue
		}
		if item.Task != nil && (item.Task.IsCompleted() || item.Task.IsInbox() || item.Task.IsReminder()) {
			continue
		}
		if !item.End.Before(from) && item.End.Before(now.Add(90*time.Second)) {
			key := missedDedupe(item.TaskID, item.End)
			if s.queue.HasNotification(key) || s.queue.HasJob(key) {
				continue
			}
			if _, err := s.queue.Enqueue(jobs.Enqueue{
				UserID: userID, Kind: models.JobMissedBlock, DedupeKey: key, RunAt: item.End,
				Payload: models.JobPayload{"taskId": item.TaskID, "end": item.End.UTC().Format(time.RFC3339), "title": item.Title},
			}); err != nil {
				return err
			}
		}
		lead := item.Start.Add(-startLead)
		if !lead.Before(from) && lead.Before(now.Add(90*time.Second)) {
			key := startSoonDedupe(item.TaskID, item.Start)
			if s.queue.HasNotification(key) || s.queue.HasJob(key) {
				continue
			}
			if _, err := s.queue.Enqueue(jobs.Enqueue{
				UserID: userID, Kind: models.JobStartSoon, DedupeKey: key, RunAt: lead,
				Payload: models.JobPayload{"taskId": item.TaskID, "start": item.Start.UTC().Format(time.RFC3339), "title": item.Title},
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) HandleMissedBlock(ctx context.Context, job *models.Job) error {
	settings, err := s.repo.GetSettings(job.UserID)
	if err != nil {
		return err
	}
	if !settings.Reminders {
		return nil
	}
	taskID := job.Payload.String("taskId")
	item, err := s.tasks.GetForUser(job.UserID, taskID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if item.IsCompleted() || item.IsInbox() || item.IsReminder() {
		return nil
	}
	if !blockStillScheduled(item, job.Payload.String("end"), true) {
		return nil
	}
	entity := taskID
	data := models.JobPayload{}
	for k, v := range job.Payload {
		data[k] = v
	}
	// Apps hide the steps that would change every occurrence of a series.
	if item.IsRecurring() {
		data["recurring"] = true
	}
	row := &models.Notification{
		UserID: job.UserID, Category: models.NotifyMissed,
		Title: item.Name, Body: "This block ended and the work is still open.",
		EntityType: strPtr("task"), EntityID: &entity,
		Data: data, DedupeKey: job.DedupeKey,
	}
	ntf, err := s.repo.Upsert(row)
	if err != nil {
		return err
	}
	if ntf.ID == row.ID {
		s.suggestLater(ntf.ID, job.UserID, item, models.NotifyMissed, "missed", 0)
	}
	return s.deliver(ctx, ntf, settings)
}

func (s *Service) HandleStartSoon(ctx context.Context, job *models.Job) error {
	settings, err := s.repo.GetSettings(job.UserID)
	if err != nil {
		return err
	}
	if !settings.Reminders {
		return nil
	}
	taskID := job.Payload.String("taskId")
	item, err := s.tasks.GetForUser(job.UserID, taskID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if item.IsCompleted() || item.IsInbox() || item.IsReminder() {
		return nil
	}
	if !blockStillScheduled(item, job.Payload.String("start"), false) {
		return nil
	}
	entity := taskID
	ntf, err := s.repo.Upsert(&models.Notification{
		UserID: job.UserID, Category: models.NotifyStart,
		Title: item.Name, Body: "Starting in 10 minutes.",
		EntityType: strPtr("task"), EntityID: &entity,
		Data: job.Payload, DedupeKey: job.DedupeKey,
	})
	if err != nil {
		return err
	}
	return s.deliver(ctx, ntf, settings)
}

// blockStillScheduled reports whether the job's start or end still matches a
// stored Block. Repeating Work expands on read and has no Block per occurrence,
// so those jobs stay.
func blockStillScheduled(item *models.Task, raw string, atEnd bool) bool {
	if item == nil || raw == "" {
		return false
	}
	when, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return false
	}
	if item.IsRecurring() {
		return true
	}
	for _, block := range item.Blocks {
		got := block.StartAt
		if atEnd {
			got = block.EndAt
		}
		if nearInstant(got, when) {
			return true
		}
	}
	return false
}

func nearInstant(a, b time.Time) bool {
	d := a.Sub(b)
	if d < 0 {
		d = -d
	}
	return d < time.Second
}

// sweepReminders queues the reminders due around now. After a gap it also
// queues the ones that came due since the last sweep, back to the start of
// the local day, so a reminder is late rather than lost.
func (s *Service) sweepReminders(userID string, now time.Time) error {
	from := s.reminderSweepFrom(userID, now)
	to := now.Add(90 * time.Second)
	res, err := s.calendar.Range(userID, from, to)
	if err != nil {
		return err
	}
	for _, item := range res.Items {
		if !item.Reminder || item.CompletedAt != nil || item.TaskID == "" {
			continue
		}
		if item.Start.Before(from) || !item.Start.Before(to) {
			continue
		}
		key := reminderDedupe(item.TaskID, item.Start)
		// A finished job means the reminder already went out, even if the
		// person has since cleared it.
		if s.queue.HasNotification(key) || s.queue.HasJob(key) {
			continue
		}
		original := ""
		if item.OriginalStart != nil {
			original = item.OriginalStart.UTC().Format(time.RFC3339)
		}
		if _, err := s.queue.Enqueue(jobs.Enqueue{
			UserID:    userID,
			Kind:      models.JobSendReminder,
			DedupeKey: key,
			RunAt:     item.Start,
			Payload: models.JobPayload{
				"taskId":        item.TaskID,
				"start":         item.Start.UTC().Format(time.RFC3339),
				"originalStart": original,
				"title":         item.Title,
			},
		}); err != nil {
			return err
		}
	}
	return nil
}

// reminderSweepFrom is where a reminder sweep starts: 90 seconds back
// normally, the last sweep after a gap, and the start of the local day on the
// first sweep after the server starts. It never reaches into an earlier day.
func (s *Service) reminderSweepFrom(userID string, now time.Time) time.Time {
	if s.reminderSwept == nil {
		s.reminderSwept = map[string]time.Time{}
	}
	// Compare wall clocks: the monotonic clock stops while the computer
	// sleeps, so it would hide exactly the gap this looks for.
	wall := now.Round(0)
	last, seen := s.reminderSwept[userID]
	s.reminderSwept[userID] = wall
	from := now.Add(-90 * time.Second)
	if seen && wall.Sub(last) < time.Minute {
		return from
	}
	settings, err := s.repo.GetSettings(userID)
	if err != nil {
		log.Printf("notify: read settings for %s: %v", userID, err)
	}
	local := now.In(settings.Location(s.repo.WorkingHoursTimezone(userID)))
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, local.Location())
	if seen && last.Add(-90*time.Second).After(start) {
		start = last.Add(-90 * time.Second)
	}
	if start.Before(from) {
		return start
	}
	return from
}

func (s *Service) sweepDigests(userID string, now time.Time) error {
	settings, err := s.repo.GetSettings(userID)
	if err != nil {
		return err
	}
	loc := settings.Location(s.repo.WorkingHoursTimezone(userID))
	local := now.In(loc)
	day := local.Format("2006-01-02")
	if settings.DigestMorning || settings.Planning {
		if digestDue(local, settings.MorningDigestAt) {
			kind := "morning"
			key := digestDedupe(kind, userID, day)
			if !s.queue.HasNotification(key) && !s.queue.HasJob(key) {
				if _, err := s.queue.Enqueue(jobs.Enqueue{
					UserID:    userID,
					Kind:      models.JobDailyDigest,
					DedupeKey: key,
					Payload:   models.JobPayload{"kind": kind, "date": day, "timezone": models.ZoneName(loc)},
				}); err != nil {
					return err
				}
			}
		}
	}
	if settings.DigestEvening {
		if digestDue(local, settings.EveningDigestAt) {
			kind := "evening"
			key := digestDedupe(kind, userID, day)
			if !s.queue.HasNotification(key) && !s.queue.HasJob(key) {
				if _, err := s.queue.Enqueue(jobs.Enqueue{
					UserID:    userID,
					Kind:      models.JobDailyDigest,
					DedupeKey: key,
					Payload:   models.JobPayload{"kind": kind, "date": day, "timezone": models.ZoneName(loc)},
				}); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// digestLate is how long after its time a digest still goes out, for a
// server that was not sweeping at that moment (the computer slept).
const digestLate = 4 * time.Hour

// digestDue reports whether a digest set for hhmm is due at local: from two
// minutes before its time until digestLate after it, within the same day.
func digestDue(local time.Time, hhmm string) bool {
	if nearClock(local, hhmm, 2*time.Minute) {
		return true
	}
	target := clockMinutes(hhmm)
	mins := local.Hour()*60 + local.Minute()
	return target >= 0 && mins >= target && mins <= target+int(digestLate.Minutes())
}

func nearClock(now time.Time, hhmm string, window time.Duration) bool {
	target := clockMinutes(hhmm)
	if target < 0 {
		return false
	}
	mins := now.Hour()*60 + now.Minute()
	diff := mins - target
	if diff < 0 {
		diff = -diff
	}
	limit := int(window.Minutes())
	return diff <= limit || diff >= 24*60-limit
}

func clockMinutes(value string) int {
	parts := strings.Split(value, ":")
	if len(parts) < 2 {
		return -1
	}
	h, ok1 := atoi(parts[0])
	m, ok2 := atoi(parts[1])
	if !ok1 || !ok2 || h < 0 || h > 23 || m < 0 || m > 59 {
		return -1
	}
	return h*60 + m
}

func atoi(raw string) (int, bool) {
	n := 0
	if raw == "" {
		return 0, false
	}
	for i, c := range raw {
		if c < '0' || c > '9' {
			if i == 0 {
				return 0, false
			}
			break
		}
		n = n*10 + int(c-'0')
	}
	return n, true
}

func (s *Service) HandleReminder(ctx context.Context, job *models.Job) error {
	settings, err := s.repo.GetSettings(job.UserID)
	if err != nil {
		return err
	}
	if !settings.Reminders {
		return nil
	}
	taskID := job.Payload.String("taskId")
	if taskID == "" {
		return errors.New("missing taskId")
	}
	item, err := s.tasks.GetForUser(job.UserID, taskID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if item.IsCompleted() {
		return nil
	}
	start := job.Payload.String("start")
	key := job.DedupeKey
	if key == nil {
		parsed, _ := time.Parse(time.RFC3339, start)
		k := reminderDedupe(taskID, parsed)
		key = &k
	}
	entity := taskID
	ntf, err := s.repo.Upsert(&models.Notification{
		UserID:     job.UserID,
		Category:   models.NotifyReminder,
		Title:      firstNonEmpty(job.Payload.String("title"), item.Name, "Reminder"),
		Body:       "Reminder",
		EntityType: strPtr("task"),
		EntityID:   &entity,
		Data:       job.Payload,
		DedupeKey:  key,
	})
	if err != nil {
		return err
	}
	return s.deliver(ctx, ntf, settings)
}

func (s *Service) HandleDigest(ctx context.Context, job *models.Job) error {
	settings, err := s.repo.GetSettings(job.UserID)
	if err != nil {
		return err
	}
	kind := job.Payload.String("kind")
	if kind == "morning" && !settings.DigestMorning && !settings.Planning {
		return nil
	}
	if kind == "evening" && !settings.DigestEvening {
		return nil
	}
	// A digest for an earlier day (retried, or run late) is stale: it would
	// count today's work and brief it against that day's date.
	loc := settings.Location(s.repo.WorkingHoursTimezone(job.UserID))
	if day := job.Payload.String("date"); day != "" && day < time.Now().In(loc).Format("2006-01-02") {
		return nil
	}
	tz := job.Payload.String("timezone")
	today, err := s.calendar.Today(job.UserID, job.Payload.String("date"), tz)
	if err != nil {
		return err
	}
	title, body, category := digestCopy(kind, today)
	data := job.Payload
	var botsDone func() error
	if kind == "morning" && s.botDigest != nil {
		// A Bot failure never holds the digest back; it goes out without them.
		if lines, done, err := s.botDigest(ctx, job.UserID, time.Now()); err != nil {
			log.Printf("notify: bot digest: %v", err)
		} else if len(lines) > 0 {
			data = maps.Clone(job.Payload)
			if data == nil {
				data = models.JobPayload{}
			}
			data["bots"] = lines
			body += "\n\nFrom your bots:\n• " + strings.Join(lines, "\n• ")
			botsDone = done
		}
	}
	key := job.DedupeKey
	row := &models.Notification{
		UserID:    job.UserID,
		Category:  category,
		Title:     title,
		Body:      body,
		Data:      data,
		DedupeKey: key,
	}
	ntf, err := s.repo.Upsert(row)
	if err != nil {
		return err
	}
	if botsDone != nil && ntf.ID == row.ID {
		if err := botsDone(); err != nil {
			log.Printf("notify: mark bot findings digested: %v", err)
		}
	}
	if kind == "morning" && ntf.ID == row.ID && s.briefLater(ctx, ntf, today, settings) {
		return nil // sent once the briefing names the day's top items
	}
	return s.deliver(ctx, ntf, settings)
}

func digestCopy(kind string, today *calendar.TodayResponse) (string, string, string) {
	scheduled := 0
	for _, item := range today.Items {
		if !item.Reminder {
			scheduled++
		}
	}
	if kind == "evening" {
		// "Unfinished" is scoped to work that was on today's calendar and is
		// still open — not the whole backlog, which Report counts separately.
		return "Evening recap",
			fmt.Sprintf("Done today: %d. Unfinished from today's plan: %d. Overdue: %d. Still unscheduled: %d.", len(today.CompletedToday), len(today.Unfinished), len(today.Overdue), len(today.Unscheduled)),
			models.NotifyDigest
	}
	return "Plan your day",
		fmt.Sprintf("On the calendar: %d. Overdue: %d. Unscheduled: %d. Inbox: %d.", scheduled, len(today.Overdue), len(today.Unscheduled), today.InboxCount),
		models.NotifyPlanning
}

func (s *Service) HandlePush(ctx context.Context, job *models.Job) error {
	id := job.Payload.String("notificationId")
	if id == "" {
		return errors.New("missing notificationId")
	}
	ntf, err := s.repo.Get(job.UserID, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if ntf.DeliveredAt != nil {
		return nil
	}
	// A smart alert dismissed before its deferred push ran stays quiet.
	if ntf.DismissedAt != nil {
		return s.repo.MarkDelivered(ntf.ID)
	}
	if ntf.Category == models.NotifyOverdue {
		if ntf.ReadAt != nil || ntf.EntityID == nil {
			return s.repo.MarkDelivered(ntf.ID)
		}
		item, err := s.tasks.GetForUser(job.UserID, *ntf.EntityID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return s.repo.MarkDelivered(ntf.ID)
		}
		if err != nil {
			return err
		}
		if !overdueTaskCurrent(item, ntf.Data.String("deadline"), s.notificationToday(job.UserID)) {
			return s.repo.MarkDelivered(ntf.ID)
		}
	}
	settings, err := s.repo.GetSettings(job.UserID)
	if err != nil {
		return err
	}
	if ntf.Category == "agent" {
		if !settings.Planning || ntf.ReadAt != nil {
			return s.repo.MarkDelivered(ntf.ID)
		}
		now := time.Now().In(settings.Location(s.repo.WorkingHoursTimezone(job.UserID)))
		if settings.InQuietHours(now) {
			_, err := s.queue.Enqueue(jobs.Enqueue{UserID: ntf.UserID, Kind: models.JobSendPush, DedupeKey: fmt.Sprintf("push:%s:quiet:%d", ntf.ID, settings.QuietEnd(now).Unix()), RunAt: settings.QuietEnd(now), Payload: models.JobPayload{"notificationId": ntf.ID}})
			return err
		}
	}
	if ntf.Category == models.NotifyBot {
		// A Bot alert that is read or kept off the phone sends nothing; an
		// urgent one ignores quiet hours (WriteAlert).
		if ntf.ReadAt != nil || !dataBool(ntf.Data, "phone", true) {
			return s.repo.MarkDelivered(ntf.ID)
		}
		now := time.Now().In(settings.Location(s.repo.WorkingHoursTimezone(job.UserID)))
		if !dataBool(ntf.Data, "urgent", false) && settings.InQuietHours(now) {
			_, err := s.queue.Enqueue(jobs.Enqueue{UserID: ntf.UserID, Kind: models.JobSendPush, DedupeKey: fmt.Sprintf("push:%s:quiet:%d", ntf.ID, settings.QuietEnd(now).Unix()), RunAt: settings.QuietEnd(now), Payload: models.JobPayload{"notificationId": ntf.ID}})
			return err
		}
	}
	return s.sendPush(ctx, ntf, settings)
}

func (s *Service) HandleIndex(ctx context.Context, job *models.Job) error {
	if s.indexer == nil {
		return nil
	}
	// The job names the item; its text is read now, so a job that waited
	// through edits indexes the latest one and a deleted item is skipped.
	err := s.indexer.IndexEntity(ctx, job.UserID, job.Payload.String("kind"), job.Payload.String("entityId"))
	if errors.Is(err, embed.ErrDisabled) {
		return nil
	}
	if embed.Permanent(err) {
		// A refused key, no credits or a refused text: trying again later
		// would only be refused again.
		return jobs.Permanent(err)
	}
	return err
}

func (s *Service) deliver(ctx context.Context, ntf *models.Notification, settings models.NotificationSettings) error {
	loc := settings.Location(s.repo.WorkingHoursTimezone(ntf.UserID))
	now := time.Now().In(loc)
	if settings.InQuietHours(now) {
		_, err := s.queue.Enqueue(jobs.Enqueue{
			UserID:    ntf.UserID,
			Kind:      models.JobSendPush,
			DedupeKey: "push:" + ntf.ID,
			RunAt:     settings.QuietEnd(now),
			Payload:   models.JobPayload{"notificationId": ntf.ID},
		})
		return err
	}
	return s.sendPush(ctx, ntf, settings)
}

func (s *Service) sendPush(ctx context.Context, ntf *models.Notification, settings models.NotificationSettings) error {
	devices, err := s.repo.Devices(ntf.UserID)
	if err != nil {
		return err
	}
	if len(devices) == 0 {
		return s.repo.MarkDelivered(ntf.ID)
	}
	messages := make([]expoMessage, 0, len(devices))
	for _, device := range devices {
		messages = append(messages, notificationPushMessage(ntf, device.Token, settings))
	}
	if err := s.postExpo(ctx, ntf.UserID, devices, messages); err != nil {
		return err
	}
	return s.repo.MarkDelivered(ntf.ID)
}

// The words a push says instead of a Bot alert's text when the person hides
// it (the clients' HIDDEN_PUSH_TITLE and HIDDEN_PUSH_BODY).
const (
	HiddenPushTitle  = "Timely"
	HiddenPushBody   = "A bot has news"
	hiddenDigestBots = "Your bots have news."
	digestBotsMark   = "\n\nFrom your bots:"
)

// notificationPushMessage is the push a device gets for a notification. A
// Bot alert goes on the "bots" channel, so people can give it its own sound,
// and carries what the phone needs to offer Resume. With the alert text
// hidden, a Bot alert says only HiddenPushBody and its data is a fixed list
// of ids, and a digest's "From your bots" section is cut.
func notificationPushMessage(ntf *models.Notification, token string, settings models.NotificationSettings) expoMessage {
	title, body, channel := ntf.Title, ntf.Body, "reminders"
	if ntf.Category == "agent" {
		title, channel = "Timely assistant", "agent"
		switch ntf.Data.String("status") {
		case "approval":
			body = "Your assistant needs approval."
		case "failed":
			body = "Your assistant needs attention."
		default:
			body = "Your assistant has finished."
		}
	}
	data := map[string]any{
		"notificationId": ntf.ID,
		"category":       ntf.Category,
		"taskId":         ntf.Data.String("taskId"),
		"entityType":     ntf.EntityType,
		"entityId":       ntf.EntityID,
		"kind":           ntf.Data.String("kind"),
		"projectId":      ntf.Data.String("projectId"),
		"botId":          ntf.Data.String("botId"),
		// A smart alert about several tasks opens the first one.
		"taskIds": ntf.Data["taskIds"],
	}
	switch ntf.Category {
	case models.NotifyBot:
		channel = "bots"
		bot := map[string]any{
			"botAlert": ntf.Data.String("botAlert"),
			"resume":   dataBool(ntf.Data, "resume", false),
			"alertId":  ntf.Data.String("alertId"),
			"checkId":  ntf.Data.String("checkId"),
		}
		if settings.HidePushText {
			title, body = HiddenPushTitle, HiddenPushBody
			// Built from scratch: no page URL or later data field reaches
			// Expo or Google.
			data = map[string]any{
				"notificationId": ntf.ID,
				"category":       ntf.Category,
				"botId":          ntf.Data.String("botId"),
				"entityType":     ntf.EntityType,
				"entityId":       ntf.EntityID,
			}
		} else {
			bot["url"] = ntf.Data.String("url")
		}
		maps.Copy(data, bot)
	case models.NotifyDigest, models.NotifyPlanning:
		if settings.HidePushText {
			if cut := strings.Index(body, digestBotsMark); cut >= 0 {
				body = body[:cut] + "\n\n" + hiddenDigestBots
			}
		}
	}
	return expoMessage{
		To:         token,
		Title:      title,
		Body:       body,
		Sound:      "default",
		ChannelID:  channel,
		CategoryID: notificationCategory(ntf),
		Data:       data,
	}
}

func notificationCategory(ntf *models.Notification) string {
	switch {
	case ntf.Category == models.NotifyOverdue:
		return "overdue_task"
	case ntf.Category == models.NotifyBot && ntf.Data.String("botAlert") == "paused" && dataBool(ntf.Data, "resume", false):
		// The phone offers Resume on a paused Bot that can be resumed.
		return "timely_bot_paused"
	}
	return ""
}

type expoMessage struct {
	To         string         `json:"to"`
	Title      string         `json:"title"`
	Body       string         `json:"body"`
	Sound      string         `json:"sound,omitempty"`
	ChannelID  string         `json:"channelId,omitempty"`
	CategoryID string         `json:"categoryId,omitempty"`
	Data       map[string]any `json:"data,omitempty"`
}

type expoTicket struct {
	Status  string `json:"status"`
	ID      string `json:"id"`
	Message string `json:"message"`
	Details struct {
		Error string `json:"error"`
	} `json:"details"`
}

const (
	defaultExpoBase = "https://exp.host/--/api/v2/push"
	// Expo takes at most 100 messages per send and 300 ids per receipts call.
	expoSendChunk    = 100
	expoReceiptChunk = 300
	// receiptsAfter is when a push's receipts are asked for; Expo keeps them
	// for a day.
	receiptsAfter = 15 * time.Minute
	expoDeadToken = "DeviceNotRegistered"
)

// expoBaseURL is the Expo push API to use for a TIMELY_EXPO_PUSH_URL value:
// Expo's own when empty. Alert text and tokens only go over https, or plain
// http to this computer (a test server); anything else is refused, and the
// default comes back with the error.
func expoBaseURL(raw string) (string, error) {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	if raw == "" {
		return defaultExpoBase, nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil {
		return defaultExpoBase, fmt.Errorf("expo push url %q is not a url", raw)
	}
	switch u.Scheme {
	case "https":
		return raw, nil
	case "http":
		switch u.Hostname() {
		case "localhost", "127.0.0.1", "::1":
			return raw, nil
		}
	}
	return defaultExpoBase, fmt.Errorf("expo push url %q is not https", raw)
}

// postExpo sends one notification's messages, at most 100 per request. Only
// a failed first request is an error (nothing went out, so the job tries
// again); a later one is logged, so a retry never sends the earlier ones
// twice. A dead token's device is deleted, and the ok tickets are checked
// again later by a push_receipts job.
func (s *Service) postExpo(ctx context.Context, userID string, devices []models.PushDevice, messages []expoMessage) error {
	sentAt := time.Now().UTC()
	tickets := map[string]any{}
	for start, n := 0, 1; start < len(messages); start, n = start+expoSendChunk, n+1 {
		end := min(start+expoSendChunk, len(messages))
		var parsed struct {
			Data []expoTicket `json:"data"`
		}
		if err := s.expoCall(ctx, "/send", messages[start:end], &parsed); err != nil {
			if n == 1 {
				return err
			}
			log.Printf("notify: expo chunk %d: %v", n, err)
			continue
		}
		for i, ticket := range parsed.Data {
			if start+i >= end {
				break
			}
			device := devices[start+i]
			switch {
			case ticket.Status == "ok" && ticket.ID != "":
				tickets[ticket.ID] = device.ID
			case ticket.Status == "error" && ticket.Details.Error == expoDeadToken:
				if err := s.repo.DeleteDevice(device.ID, userID, sentAt); err != nil {
					log.Printf("notify: delete dead push device %s: %v", device.ID, err)
				}
			case ticket.Status == "error":
				log.Printf("notify: expo ticket %s for device %s", firstNonEmpty(ticket.Details.Error, ticket.Message), device.ID)
			}
		}
	}
	if len(tickets) == 0 {
		return nil
	}
	_, err := s.queue.Enqueue(jobs.Enqueue{
		UserID:      userID,
		Kind:        models.JobPushReceipts,
		RunAt:       sentAt.Add(receiptsAfter),
		MaxAttempts: 3,
		Payload:     models.JobPayload{"sentAt": sentAt.Format(time.RFC3339Nano), "tickets": tickets},
	})
	if err != nil {
		// The push went out; only the dead-token check is lost.
		log.Printf("notify: queue push receipts: %v", err)
	}
	return nil
}

// HandleReceipts asks Expo for one push's receipts and deletes each device
// Expo says is no longer registered, unless it was registered again since
// the push. Receipts Expo no longer has are skipped.
func (s *Service) HandleReceipts(ctx context.Context, job *models.Job) error {
	sentAt, err := time.Parse(time.RFC3339Nano, job.Payload.String("sentAt"))
	if err != nil {
		return jobs.Permanent(fmt.Errorf("push receipts: bad sentAt: %w", err))
	}
	raw, _ := job.Payload["tickets"].(map[string]any)
	ids := make([]string, 0, len(raw))
	for id := range raw {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for start := 0; start < len(ids); start += expoReceiptChunk {
		chunk := ids[start:min(start+expoReceiptChunk, len(ids))]
		var parsed struct {
			Data map[string]expoTicket `json:"data"`
		}
		if err := s.expoCall(ctx, "/getReceipts", map[string]any{"ids": chunk}, &parsed); err != nil {
			return err
		}
		for _, id := range chunk {
			receipt, ok := parsed.Data[id]
			deviceID, _ := raw[id].(string)
			if !ok || receipt.Status != "error" || deviceID == "" {
				continue
			}
			if receipt.Details.Error != expoDeadToken {
				log.Printf("notify: expo receipt %s for device %s", firstNonEmpty(receipt.Details.Error, receipt.Message), deviceID)
				continue
			}
			if err := s.repo.DeleteDevice(deviceID, job.UserID, sentAt); err != nil {
				return err
			}
		}
	}
	return nil
}

// expoCall posts body to one of Expo's push endpoints and decodes the reply
// into out. A transport error or a non-2xx reply is an error.
func (s *Service) expoCall(ctx context.Context, path string, body, out any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.expoBase+path, strings.NewReader(string(payload)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if s.expoToken != "" {
		req.Header.Set("Authorization", "Bearer "+s.expoToken)
	}
	res, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("expo push %d: %s", res.StatusCode, expoErrorText(raw))
	}
	// An unreadable reply still means Expo took the request.
	_ = json.Unmarshal(raw, out)
	return nil
}

// expoPushToken matches a push token, which some of Expo's error replies
// echo back in their details.
var expoPushToken = regexp.MustCompile(`Expo(nent)?PushToken\[[^\]]*\]`)

// expoErrorText is the part of an Expo error reply fit for logs and job
// rows: tokens masked and cut to 300 bytes.
func expoErrorText(raw []byte) string {
	text := expoPushToken.ReplaceAllString(strings.TrimSpace(string(raw)), "[token]")
	if len(text) > 300 {
		text = strings.ToValidUTF8(text[:300], "") + "..."
	}
	return text
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func strPtr(v string) *string { return &v }
