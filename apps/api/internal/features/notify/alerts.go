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

// alertSteps are the steps that fit each kind of alert [88]. Inbox items
// are not Work yet, so they are only clarified or reviewed.
var alertSteps = map[string][]string{
	"inbox":     {AlertClarify, AlertReview},
	"project":   {AlertReview, AlertFocus, AlertReschedule},
	"due":       {AlertReschedule, AlertFocus, AlertReview},
	"unblocked": {AlertFocus, AlertReschedule, AlertReview},
	"stale":     {AlertReview, AlertClarify, AlertFocus, AlertReschedule},
}

// AlertStepFits reports whether step suits an alert of this kind. An alert
// with no known kind takes any step.
func AlertStepFits(kind, step string) bool {
	steps, ok := alertSteps[kind]
	if !ok {
		return step == AlertReview || step == AlertClarify || step == AlertFocus || step == AlertReschedule
	}
	for _, s := range steps {
		if s == step {
			return true
		}
	}
	return false
}

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
	LogID     string // the decision behind it, for kept feedback
}

// Alerter returns today's smart alerts for a person; Work in skip was alerted
// about in the last week and is left out, and so is every kind of alert in
// muted (see mutedAlertKinds). Smart suggestions supply it.
type Alerter func(ctx context.Context, userID string, now time.Time, skip, muted map[string]bool) []Alert

// SetAlerts connects smart suggestions to the daily smart alerts.
func (s *Service) SetAlerts(fn Alerter) { s.alerts = fn }

// SetDecisions tells smart alerts and the briefing whether smart suggestions
// are available for an account, and records whether the person kept one.
func (s *Service) SetDecisions(available func(ctx context.Context, userID string) bool, feedback func(userID, logID string, accepted bool) error) {
	s.decisionsOn, s.feedback = available, feedback
}

// SetDismissed records a smart alert the person dismissed or cleared
// without taking its step, as a suggestion not kept. It should leave an
// answered decision as it is, since one decision can back several alerts.
func (s *Service) SetDismissed(fn func(userID, logID string) error) { s.dismissed = fn }

// smartOn is false when smart suggestions are off for the account; with no
// status wired, it is left to the Alerter and Briefer.
func (s *Service) smartOn(ctx context.Context, userID string) bool {
	return s.decisionsOn == nil || s.decisionsOn(ctx, userID)
}

const (
	maxAlertsPerDay = 3
	alertQuietDays  = 7
	alertBudget     = 20 * time.Second

	// A kind of alert dismissed this many times in this many days, and never
	// acted on, is left out until the count drops.
	alertMuteDismissals = 3
	alertMuteDays       = 14
	// Dismissed alerts are kept this long to count.
	dismissedKeepDays = 30
)

// sweepSmartAlerts queues one smart alerts job a day, from the morning
// digest time on, while the setting is on.
func (s *Service) sweepSmartAlerts(ctx context.Context, userID string, now time.Time) error {
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
	// The key check happens in the job, so an account with no key costs one
	// queued job a day rather than a key lookup on every sweep.
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
	if !settings.SmartAlertsOn() || !s.smartOn(ctx, job.UserID) {
		return nil
	}
	skip, err := s.repo.RecentlyAlerted(job.UserID, time.Now().AddDate(0, 0, -alertQuietDays))
	if err != nil {
		return err
	}
	if err := s.repo.PruneDismissed(job.UserID, time.Now().AddDate(0, 0, -dismissedKeepDays)); err != nil {
		return err
	}
	outcomes, err := s.repo.AlertOutcomes(job.UserID)
	if err != nil {
		return err
	}
	muted := mutedAlertKinds(outcomes, time.Now())
	ctx, cancel := context.WithTimeout(ctx, alertBudget)
	defer cancel()
	now := time.Now().In(settings.Location(s.repo.WorkingHoursTimezone(job.UserID)))
	alerts := s.alerts(ctx, job.UserID, now, skip, muted)
	day := job.Payload.String("date")
	// A retried job counts what it already sent today against the cap.
	sent, err := s.repo.CountByDedupePrefix(job.UserID, "suggestion:"+job.UserID+":"+day+":")
	if err != nil {
		return err
	}
	if left := maxAlertsPerDay - int(sent); left < len(alerts) {
		alerts = alerts[:max(left, 0)]
	}
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
		if a.LogID != "" {
			data["logId"] = a.LogID
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
// Clarify open the Work in the app and only mark the alert read. A step
// taken counts as a kept suggestion.
func (s *Service) applyAlert(userID string, n *models.Notification, action string) (string, error) {
	if !AlertStepFits(n.Data.String("kind"), action) {
		return "", errors.New("this step does not fit this alert")
	}
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
		// A dry run first: Apply replaces the engine blocks of every task it
		// is given, even one it finds no new time for, so only the tasks the
		// dry run places are applied.
		req := schedule.PlanRequest{TaskIDs: open, Timezone: s.notificationTimezone(userID)}
		preview, err := s.schedule.DryRun(userID, req)
		if err != nil {
			return "", err
		}
		var fits []string
		for _, id := range open {
			if placed(preview, id) {
				fits = append(fits, id)
			}
		}
		if len(fits) == 0 {
			return "", errNoTime
		}
		req.TaskIDs = fits
		plan, err := s.schedule.Apply(userID, req)
		if err != nil {
			return "", err
		}
		done := 0
		for _, id := range fits {
			if placed(plan, id) {
				done++
			}
		}
		if done == 0 {
			return "", errNoTime
		}
		message = fmt.Sprintf("Found time for %d of %d", done, len(open))
		if done == len(open) {
			message = "Found time for it"
			if done > 1 {
				message = fmt.Sprintf("Found time for all %d", done)
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
	if err := s.repo.MarkActed(n.ID, action); err != nil {
		log.Printf("notify: mark smart alert acted: %v", err)
	}
	if logID := n.Data.String("logId"); logID != "" && s.feedback != nil {
		if err := s.feedback(userID, logID, true); err != nil {
			log.Printf("notify: smart alert feedback: %v", err)
		}
	}
	return message, nil
}

// alertsDismissed records each newly dismissed smart alert the person never
// took a step on as a suggestion not kept, once per decision: alerts sent
// together share one decision, and a kept answer is left as it is.
func (s *Service) alertsDismissed(userID string, rows []models.Notification) {
	if s.dismissed == nil {
		return
	}
	seen := map[string]bool{}
	for _, n := range rows {
		logID := n.Data.String("logId")
		if logID == "" || seen[logID] || n.Data.String("acted") != "" {
			continue
		}
		seen[logID] = true
		if err := s.dismissed(userID, logID); err != nil {
			log.Printf("notify: smart alert dismissed feedback: %v", err)
		}
	}
}

// mutedAlertKinds counts, in code, the kinds of smart alert (due, unblocked,
// project, inbox, stale) the person dismissed at least three times in the
// last 14 days without ever taking a step on one of that kind. The alerts
// job leaves those kinds out; once fewer than three dismissals fall in the
// window they come back.
func mutedAlertKinds(rows []alertOutcome, now time.Time) map[string]bool {
	since := now.AddDate(0, 0, -alertMuteDays)
	dismissed := map[string]int{}
	acted := map[string]bool{}
	for _, r := range rows {
		if r.Acted {
			acted[r.Kind] = true
		} else if r.DismissedAt != nil && !r.DismissedAt.Before(since) {
			dismissed[r.Kind]++
		}
	}
	out := map[string]bool{}
	for kind, n := range dismissed {
		if n >= alertMuteDismissals && !acted[kind] {
			out[kind] = true
		}
	}
	return out
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
