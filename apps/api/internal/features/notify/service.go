package notify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"timely-api/internal/features/calendar"
	"timely-api/internal/features/embed"
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
	indexer  embed.Indexer
	http     *http.Client
}

func NewService(db *gorm.DB, queue *jobs.Queue, calendar calendar.Service, tasks task.TaskService, indexer embed.Indexer) *Service {
	return &Service{
		repo:     newRepository(db),
		queue:    queue,
		calendar: calendar,
		tasks:    tasks,
		indexer:  indexer,
		http:     &http.Client{Timeout: 15 * time.Second},
	}
}

func (s *Service) Register(worker *jobs.Worker) {
	worker.Handle(models.JobSendReminder, s.HandleReminder)
	worker.Handle(models.JobDailyDigest, s.HandleDigest)
	worker.Handle(models.JobSendPush, s.HandlePush)
	worker.Handle(models.JobIndexEntity, s.HandleIndex)
	worker.SetSweep(s.Sweep)
}

// GetSettings returns the stored preferences with the *effective* timezone
// filled in: an explicit notification timezone wins, otherwise the working
// hours timezone, otherwise UTC. Digest and quiet-hour jobs use the same
// resolution, so what the settings screen shows is what the scheduler uses.
func (s *Service) GetSettings(userID string) (models.NotificationSettings, error) {
	settings, err := s.repo.GetSettings(userID)
	if err != nil {
		return settings, err
	}
	settings.Timezone = settings.Location(s.repo.WorkingHoursTimezone(userID)).String()
	return settings, nil
}

func (s *Service) UpdateSettings(userID string, settings models.NotificationSettings) (models.NotificationSettings, error) {
	normalized := settings.Normalized()
	if tz := strings.TrimSpace(normalized.Timezone); tz != "" {
		if _, err := time.LoadLocation(tz); err != nil {
			return models.NotificationSettings{}, fmt.Errorf("invalid timezone %q", tz)
		}
		normalized.Timezone = tz
	}
	if err := s.repo.UpdateSettings(userID, normalized); err != nil {
		return models.NotificationSettings{}, err
	}
	normalized.Timezone = normalized.Location(s.repo.WorkingHoursTimezone(userID)).String()
	return normalized, nil
}

func (s *Service) List(userID string, unreadOnly bool, limit int) ([]models.Notification, error) {
	return s.repo.List(userID, unreadOnly, limit)
}

func (s *Service) UnreadCount(userID string) (int64, error) {
	return s.repo.UnreadCount(userID)
}

func (s *Service) MarkRead(userID, id string) (*models.Notification, error) {
	return s.repo.MarkRead(userID, id)
}

func (s *Service) MarkAllRead(userID string) error {
	return s.repo.MarkAllRead(userID)
}

func (s *Service) RegisterDevice(userID, token, platform string) (*models.PushDevice, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, errors.New("push token is required")
	}
	return s.repo.RegisterDevice(userID, token, platform)
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
	}
	return nil
}

func (s *Service) sweepReminders(userID string, now time.Time) error {
	from := now.Add(-90 * time.Second)
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
		if s.queue.HasNotification(key) {
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

func (s *Service) sweepDigests(userID string, now time.Time) error {
	settings, err := s.repo.GetSettings(userID)
	if err != nil {
		return err
	}
	loc := settings.Location(s.repo.WorkingHoursTimezone(userID))
	local := now.In(loc)
	day := local.Format("2006-01-02")
	if settings.DigestMorning || settings.Planning {
		if nearClock(local, settings.MorningDigestAt, 2*time.Minute) {
			kind := "morning"
			key := digestDedupe(kind, userID, day)
			if !s.queue.HasNotification(key) {
				if _, err := s.queue.Enqueue(jobs.Enqueue{
					UserID:    userID,
					Kind:      models.JobDailyDigest,
					DedupeKey: key,
					Payload:   models.JobPayload{"kind": kind, "date": day, "timezone": loc.String()},
				}); err != nil {
					return err
				}
			}
		}
	}
	if settings.DigestEvening {
		if nearClock(local, settings.EveningDigestAt, 2*time.Minute) {
			kind := "evening"
			key := digestDedupe(kind, userID, day)
			if !s.queue.HasNotification(key) {
				if _, err := s.queue.Enqueue(jobs.Enqueue{
					UserID:    userID,
					Kind:      models.JobDailyDigest,
					DedupeKey: key,
					Payload:   models.JobPayload{"kind": kind, "date": day, "timezone": loc.String()},
				}); err != nil {
					return err
				}
			}
		}
	}
	return nil
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
	tz := job.Payload.String("timezone")
	today, err := s.calendar.Today(job.UserID, job.Payload.String("date"), tz)
	if err != nil {
		return err
	}
	title, body, category := digestCopy(kind, today)
	key := job.DedupeKey
	ntf, err := s.repo.Upsert(&models.Notification{
		UserID:    job.UserID,
		Category:  category,
		Title:     title,
		Body:      body,
		Data:      job.Payload,
		DedupeKey: key,
	})
	if err != nil {
		return err
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
			fmt.Sprintf("Done today: %d. Unfinished from today's plan: %d. Overdue: %d.", len(today.CompletedToday), len(today.Unfinished), len(today.Overdue)),
			models.NotifyDigest
	}
	return "Plan your day",
		fmt.Sprintf("On the calendar: %d. Overdue: %d. Inbox: %d.", scheduled, len(today.Overdue), today.InboxCount),
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
	settings, err := s.repo.GetSettings(job.UserID)
	if err != nil {
		return err
	}
	return s.sendPush(ctx, ntf, settings)
}

func (s *Service) HandleIndex(ctx context.Context, job *models.Job) error {
	if s.indexer == nil {
		return nil
	}
	err := s.indexer.IndexDocument(ctx, embed.Document{
		UserID:   job.UserID,
		Kind:     job.Payload.String("kind"),
		EntityID: job.Payload.String("entityId"),
		Title:    job.Payload.String("title"),
		Body:     job.Payload.String("body"),
	})
	if errors.Is(err, embed.ErrDisabled) {
		return nil
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
		messages = append(messages, expoMessage{
			To:        device.Token,
			Title:     ntf.Title,
			Body:      ntf.Body,
			Sound:     "default",
			ChannelID: "reminders",
			Data: map[string]any{
				"notificationId": ntf.ID,
				"category":       ntf.Category,
				"taskId":         ntf.Data.String("taskId"),
			},
		})
	}
	if err := s.postExpo(ctx, messages); err != nil {
		return err
	}
	_ = settings
	return s.repo.MarkDelivered(ntf.ID)
}

type expoMessage struct {
	To        string         `json:"to"`
	Title     string         `json:"title"`
	Body      string         `json:"body"`
	Sound     string         `json:"sound,omitempty"`
	ChannelID string         `json:"channelId,omitempty"`
	Data      map[string]any `json:"data,omitempty"`
}

type expoTicket struct {
	Status  string `json:"status"`
	Message string `json:"message"`
	Details struct {
		Error string `json:"error"`
	} `json:"details"`
}

func (s *Service) postExpo(ctx context.Context, messages []expoMessage) error {
	body, err := json.Marshal(messages)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://exp.host/--/api/v2/push/send", strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	res, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode >= 300 {
		return fmt.Errorf("expo push %d: %s", res.StatusCode, strings.TrimSpace(string(raw)))
	}
	var parsed struct {
		Data []expoTicket `json:"data"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil
	}
	for i, ticket := range parsed.Data {
		if ticket.Status == "error" && ticket.Details.Error == "DeviceNotRegistered" && i < len(messages) {
			_ = s.repo.DeleteToken(messages[i].To)
		}
	}
	return nil
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
