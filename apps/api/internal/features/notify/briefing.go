package notify

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"timely-api/internal/features/calendar"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
)

// BriefItem is something the morning briefing could name [89]. Note holds
// the facts code worked out ("event at 14:00", "past its deadline by 3
// days"), so the picker never reads raw dates.
type BriefItem struct {
	Name        string
	Note        string
	Description string
}

// Briefer picks which items the morning briefing names, most important
// first, as indexes into items; none when unsure. Smart suggestions supply it.
type Briefer func(ctx context.Context, userID string, items []BriefItem) []int

// SetBriefing connects smart suggestions to the morning briefing.
func (s *Service) SetBriefing(fn Briefer) { s.briefing = fn }

const (
	maxBriefItems     = 12
	maxBriefNamed     = 3
	briefingBudget    = 10 * time.Second
	briefingNameRunes = 60
	// briefingFallback is when a queued push sends the briefing as it is,
	// should the background send never finish (a restart, a failed push):
	// past the model's budget and the push's own timeout.
	briefingFallback = briefingBudget + 20*time.Second
)

// briefLater names the day's top items in a new morning briefing, then
// sends it. It runs in the background so the jobs behind the digest never
// wait on the model, and is false when there is nothing to ask or smart
// suggestions are off (the caller sends the briefing as it is).
func (s *Service) briefLater(ctx context.Context, ntf *models.Notification, today *calendar.TodayResponse, settings models.NotificationSettings) bool {
	if s.briefing == nil || today == nil || !s.smartOn(ctx, ntf.UserID) {
		return false
	}
	items := briefItems(today)
	if len(items) == 0 {
		return false
	}
	// A queued push is the fallback; HandlePush skips it once the briefing
	// is delivered. In quiet hours it waits for their end, and the send
	// below then joins it (same dedupe key).
	now := time.Now().In(settings.Location(s.repo.WorkingHoursTimezone(ntf.UserID)))
	runAt := now.Add(briefingFallback)
	if settings.InQuietHours(now) {
		runAt = settings.QuietEnd(now)
	}
	if _, err := s.queue.Enqueue(jobs.Enqueue{UserID: ntf.UserID, Kind: models.JobSendPush, DedupeKey: "push:" + ntf.ID,
		RunAt: runAt, Payload: models.JobPayload{"notificationId": ntf.ID}}); err != nil {
		return false
	}
	s.triageWait.Add(1)
	go func() {
		defer s.triageWait.Done()
		// The budget covers the wait for a slot too, so a backlog of triage
		// calls never holds the briefing back; it then goes out as it is.
		ctx, cancel := context.WithTimeout(context.Background(), briefingBudget)
		defer cancel()
		var picks []int
		select {
		case s.triageSlots <- struct{}{}:
			picks = s.briefing(ctx, ntf.UserID, items)
			<-s.triageSlots
		case <-ctx.Done():
		}
		names := make([]string, 0, maxBriefNamed)
		for _, i := range picks {
			if i >= 0 && i < len(items) && len(names) < maxBriefNamed {
				names = append(names, clipRunes(items[i].Name, briefingNameRunes))
			}
		}
		if len(names) > 0 {
			ntf.Body = "Top today: " + joinNames(names) + ". " + ntf.Body
			if err := s.repo.SetBody(ntf.ID, ntf.Body); err != nil {
				log.Printf("notify: save briefing: %v", err)
			}
		}
		if err := s.deliver(context.Background(), ntf, settings); err != nil {
			log.Printf("notify: deliver briefing: %v", err)
		}
	}()
	return true
}

// briefItems lists today's candidates: Focus, events and planned Work on
// the calendar, Overdue Work and Unscheduled Work due within two days.
func briefItems(today *calendar.TodayResponse) []BriefItem {
	loc := time.Local
	if today.Timezone != "" {
		if l, err := time.LoadLocation(today.Timezone); err == nil {
			loc = l
		}
	}
	day, _ := time.ParseInLocation("2006-01-02", today.Date, loc)
	var out []BriefItem
	seen := map[string]bool{}
	add := func(key, name, note, description string) {
		if len(out) >= maxBriefItems || seen[key] || strings.TrimSpace(name) == "" {
			return
		}
		seen[key] = true
		out = append(out, BriefItem{Name: name, Note: note, Description: clipRunes(strings.TrimSpace(description), 200)})
	}
	for _, t := range today.TodayFocus {
		add("task:"+t.ID, t.Name, "in today's Focus, priority "+priorityWord(t.PriorityLevel), t.Description)
	}
	for _, t := range today.Overdue {
		note := "past its deadline"
		if t.Deadline != nil {
			if d, err := time.ParseInLocation("2006-01-02", models.NormalizeDate(*t.Deadline), loc); err == nil && !day.IsZero() {
				note = fmt.Sprintf("past its deadline by %s", plural(DaysBetween(d, day), "day"))
			}
		}
		add("task:"+t.ID, t.Name, note+", priority "+priorityWord(t.PriorityLevel), t.Description)
	}
	for _, it := range today.Items {
		if it.CompletedAt != nil {
			continue
		}
		when := "all day"
		if !it.AllDay {
			when = "at " + it.Start.In(loc).Format("15:04")
		}
		switch {
		case it.EventID != "" || it.Kind == "event":
			add("event:"+it.ID, it.Title+" "+when, "calendar event "+when, "")
		case it.TaskID != "":
			add("task:"+it.TaskID, it.Title, "planned on the calendar "+when, "")
		}
	}
	for _, t := range today.Unscheduled {
		if t.Deadline == nil || day.IsZero() {
			continue
		}
		d, err := time.ParseInLocation("2006-01-02", models.NormalizeDate(*t.Deadline), loc)
		if err != nil {
			continue
		}
		switch days := DaysBetween(day, d); {
		case days == 0:
			add("task:"+t.ID, t.Name, "due today and not on the calendar", t.Description)
		case days == 1:
			add("task:"+t.ID, t.Name, "due tomorrow and not on the calendar", t.Description)
		case days == 2:
			add("task:"+t.ID, t.Name, "due in 2 days and not on the calendar", t.Description)
		}
	}
	return out
}

// DaysBetween counts the calendar days from from's date to to's date, both
// read in to's timezone, so midnight and DST changes never shift the count.
func DaysBetween(from, to time.Time) int {
	from = from.In(to.Location())
	a := time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, time.UTC)
	b := time.Date(to.Year(), to.Month(), to.Day(), 0, 0, 0, 0, time.UTC)
	return int(b.Sub(a).Hours() / 24)
}

func priorityWord(p *string) string {
	if p == nil || *p == "" {
		return "none"
	}
	return strings.ToLower(models.NormalizePriority(*p))
}

func plural(n int, word string) string {
	if n == 1 {
		return "1 " + word
	}
	return fmt.Sprintf("%d %ss", n, word)
}

func joinNames(names []string) string {
	switch len(names) {
	case 0:
		return ""
	case 1:
		return names[0]
	}
	return strings.Join(names[:len(names)-1], ", ") + " and " + names[len(names)-1]
}

func clipRunes(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return strings.TrimSpace(string(r[:n-1])) + "…"
	}
	return s
}
