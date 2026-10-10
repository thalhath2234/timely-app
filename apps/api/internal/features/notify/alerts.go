package notify

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"timely-api/internal/features/schedule"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
)

// Smart alert actions: what the alert's button does.
const (
	AlertReview     = "review"     // open the Work to look at it
	AlertClarify    = "clarify"    // open it to rewrite or sort it
	AlertFocus      = "focus"      // add it to today's Focus
	AlertReschedule = "reschedule" // find time for it with Auto-schedule
)

// AlertItem is one piece of Work a smart alert is about.
type AlertItem struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Alert is an optional suggestion Smart suggestions judged worth an alert
// [86], merged with the alerts about the same project or issue [87], with
// the step that fits it best [88].
type Alert struct {
	Key       string // stable for the same suggestion, so it is sent once a day
	Kind      string // what it is about: stale, inbox, due, unblocked or project
	ProjectID string // for a project alert
	Title     string
	Body      string
	Action    string
	Items     []AlertItem
}

// Alerter returns today's smart alerts for a person; Work in skip was alerted
// about in the last week and is left out. Smart suggestions supply it.
type Alerter func(ctx context.Context, userID string, now time.Time, skip map[string]bool) []Alert

// SetAlerts connects smart suggestions to the daily smart alerts.
func (s *Service) SetAlerts(fn Alerter) { s.alerts = fn }

const (
	maxAlertsPerDay = 3
	alertQuietDays  = 7
	alertBudget     = 20 * time.Second
)

// sweepSmartAlerts queues one smart alerts job a day, from the morning
// digest time on, while the setting is on.
func (s *Service) sweepSmartAlerts(userID string, now time.Time) error {
	if s.alerts == nil {
		return nil
	}
	settings, err := s.repo.GetSettings(userID)
	if err != nil {
		return err
	}
	if !settings.SmartAlertsOn() {
		return nil
	}
	local := now.In(settings.Location(s.repo.WorkingHoursTimezone(userID)))
	if local.Hour()*60+local.Minute() < clockMinutes(settings.MorningDigestAt) {
		return nil
	}
	day := local.Format("2006-01-02")
	key := "smart_alerts:" + userID + ":" + day
	if s.queue.HasJob(key) {
		return nil
	}
	_, err = s.queue.Enqueue(jobs.Enqueue{UserID: userID, Kind: models.JobSmartAlerts, DedupeKey: key, Payload: models.JobPayload{"date": day}})
	return err
}

// HandleSmartAlerts writes today's smart alerts as notifications.
func (s *Service) HandleSmartAlerts(ctx context.Context, job *models.Job) error {
	if s.alerts == nil {
		return nil
	}
	settings, err := s.repo.GetSettings(job.UserID)
	if err != nil {
		return err
	}
	if !settings.SmartAlertsOn() {
		return nil
	}
	skip, err := s.repo.RecentlyAlerted(job.UserID, time.Now().AddDate(0, 0, -alertQuietDays))
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, alertBudget)
	defer cancel()
	now := time.Now().In(settings.Location(s.repo.WorkingHoursTimezone(job.UserID)))
	alerts := s.alerts(ctx, job.UserID, now, skip)
	if len(alerts) > maxAlertsPerDay {
		alerts = alerts[:maxAlertsPerDay]
	}
	day := job.Payload.String("date")
	for _, a := range alerts {
		ids := make([]any, 0, len(a.Items))
		items := make([]any, 0, len(a.Items))
		for _, it := range a.Items {
			ids = append(ids, it.ID)
			items = append(items, map[string]any{"id": it.ID, "name": it.Name})
		}
		data := models.JobPayload{"action": a.Action, "kind": a.Kind, "taskIds": ids, "items": items}
		if a.ProjectID != "" {
			data["projectId"] = a.ProjectID
		}
		ntf := &models.Notification{UserID: job.UserID, Category: models.NotifySuggestion, Title: a.Title, Body: a.Body, Data: data,
			DedupeKey: strPtr("suggestion:" + job.UserID + ":" + day + ":" + a.Key)}
		if len(a.Items) == 1 {
			ntf.EntityType, ntf.EntityID = strPtr("task"), strPtr(a.Items[0].ID)
		}
		row, err := s.repo.Upsert(ntf)
		if err != nil {
			return err
		}
		if row.ID != ntf.ID {
			continue // already sent today
		}
		if err := s.deliver(ctx, row, settings); err != nil {
			log.Printf("notify: deliver smart alert: %v", err)
		}
	}
	return nil
}

// applyAlert runs a smart alert's Focus or Reschedule step; Review and
// Clarify open the Work in the app and only mark the alert read.
func (s *Service) applyAlert(userID string, n *models.Notification, action string) (string, error) {
	ids := alertTaskIDs(n)
	if len(ids) == 0 {
		return "", errors.New("this alert has no work left")
	}
	var open []string
	for _, id := range ids {
		if item, err := s.tasks.GetForUser(userID, id); err == nil && !item.IsCompleted() {
			open = append(open, id)
		}
	}
	if len(open) == 0 {
		return "", errors.New("this work is already done")
	}
	var message string
	switch action {
	case AlertFocus:
		day := s.notificationToday(userID).Date()
		added := 0
		for _, id := range open {
			if _, err := s.tasks.SetTodayFocus(userID, id, &day); err != nil {
				if added == 0 {
					return "", err
				}
				break
			}
			added++
		}
		message = fmt.Sprintf("Added %d to today's Focus", added)
		if added == 1 {
			message = "Added to today's Focus"
		}
	case AlertReschedule:
		plan, err := s.schedule.Apply(userID, schedule.PlanRequest{TaskIDs: open, Timezone: s.notificationTimezone(userID)})
		if err != nil {
			return "", err
		}
		placed := 0
		for _, id := range open {
			for _, p := range plan.Proposals {
				if p.TaskID == id && len(p.Blocks) > 0 {
					placed++
					break
				}
			}
		}
		if placed == 0 {
			return "", errNoTime
		}
		message = fmt.Sprintf("Found time for %d of %d", placed, len(open))
		if placed == len(open) {
			message = "Found time for it"
			if placed > 1 {
				message = fmt.Sprintf("Found time for all %d", placed)
			}
		}
	case AlertReview, AlertClarify:
		message = ""
	default:
		return "", errors.New("unknown step")
	}
	if _, err := s.repo.MarkRead(userID, n.ID); err != nil {
		return "", err
	}
	return message, nil
}

func alertTaskIDs(n *models.Notification) []string {
	raw, _ := n.Data["taskIds"].([]any)
	ids := make([]string, 0, len(raw))
	for _, v := range raw {
		if id, ok := v.(string); ok && strings.TrimSpace(id) != "" {
			ids = append(ids, id)
		}
	}
	return ids
}
