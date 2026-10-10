package suggest

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"timely-api/internal/features/decide"
	"timely-api/internal/features/notify"
	"timely-api/internal/models"
)

// Smart alerts and the morning briefing [86–89]. Code finds the candidates
// (stale Work, an Inbox that waits, Work due soon with no time, Work a
// finished task unblocked, a project due this week) and counts every date;
// Jev decides which deserve an alert, which are about the same thing, and
// the best next step.

const (
	maxAlertCandidates = 10
	inboxWaitDays      = 3
	minInboxWaiting    = 3
	dueSoonDays        = 3
	unblockedDays      = 3
	projectDueDays     = 7
	maxAlertItems      = 5
)

type alertCandidate struct {
	key       string
	kind      string // stale, inbox, due, unblocked, project
	title     string
	facts     string // code-made, shown to Jev and in the alert
	detail    string // description, for Jev only
	action    string // the step code expects when Jev is unsure
	items     []notify.AlertItem
	project   string
	projectID string // a project alert's own project
	inProject string // the project the Work belongs to, or the alert's own
}

var alertActions = []decide.Option{
	{Name: notify.AlertReview, Description: "Review: look at it and decide whether it is still needed, or what to do with it"},
	{Name: notify.AlertClarify, Description: "Clarify: rewrite or sort it so the next step is clear"},
	{Name: notify.AlertFocus, Description: "Focus: start on it today by adding it to today's Focus"},
	{Name: notify.AlertReschedule, Description: "Reschedule: find time for it on the calendar"},
}

var actionPhrase = map[string]string{
	notify.AlertReview:     "take a look and decide what to do with it",
	notify.AlertClarify:    "make the next step clear",
	notify.AlertFocus:      "add it to today's Focus",
	notify.AlertReschedule: "find time for it",
}

var actionPhrasePlural = map[string]string{
	notify.AlertReview:     "take a look and decide what to do with them",
	notify.AlertClarify:    "make the next steps clear",
	notify.AlertFocus:      "add them to today's Focus",
	notify.AlertReschedule: "find time for them",
}

// Alerts returns today's smart alerts, most worth it first.
func (s *Service) Alerts(ctx context.Context, userID string, now time.Time, skip map[string]bool) []notify.Alert {
	if on, _ := s.decide.Status(ctx, userID); !on {
		return nil
	}
	cands := s.alertCandidates(ctx, userID, now, skip)
	if len(cands) == 0 {
		return nil
	}
	list := make([]map[string]any, 0, len(cands))
	questions := map[string]decide.Question{}
	for i, c := range cands {
		key := fmt.Sprintf("c%d", i+1)
		item := map[string]any{"candidate": key, "about": c.title, "facts": c.facts}
		if c.detail != "" {
			item["description"] = c.detail
		}
		if c.project != "" {
			item["project"] = c.project
		}
		list = append(list, item)
		questions["alert_"+key] = decide.YesNo(fmt.Sprintf("Is candidate %s worth interrupting the person with an alert today, rather than waiting until they next look at their list?", key),
			"Yes: it is time-sensitive, easy to forget or blocks other work, and acting today matters",
			"No: it can wait until the person looks at their list")
		questions["action_"+key] = decide.Choice(fmt.Sprintf("What is the best next step for candidate %s?", key), alertActions...)
		if len(cands) > 1 {
			opts := []decide.Option{{Name: "none", Description: "None of the other candidates"}}
			for j, other := range cands {
				if j != i {
					opts = append(opts, decide.Option{Name: fmt.Sprintf("c%d", j+1), Description: clip(other.title, 120)})
				}
			}
			questions["group_"+key] = decide.Choice(fmt.Sprintf("Which other candidate is about the same project or issue as candidate %s, so the two make one alert?", key), opts...)
		}
	}
	state := map[string]any{"today": now.Format("Monday 2 January 2006"), "candidates": list}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "smart_alerts", State: state, Questions: questions})
	if err != nil {
		return nil
	}
	type picked struct {
		i    int
		prob float64
	}
	var chosen []picked
	for i := range cands {
		key := fmt.Sprintf("alert_c%d", i+1)
		// Jev's yes runs cautious here (a due-tomorrow invoice scores about
		// 0.77), so Flag rather than Prefill.
		if yes, ok := a.Yes(key, decide.Flag); ok && yes {
			raw, _ := a.Raw(key)
			chosen = append(chosen, picked{i, raw.Yes})
		}
	}
	sort.SliceStable(chosen, func(x, y int) bool { return chosen[x].prob > chosen[y].prob })
	in := map[int]bool{}
	for _, p := range chosen {
		in[p.i] = true
	}
	// Alerts about the same project or issue become one [87].
	parent := make([]int, len(cands))
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(i int) int {
		if parent[i] != i {
			parent[i] = find(parent[i])
		}
		return parent[i]
	}
	for _, p := range chosen {
		pick, ok := a.Choice(fmt.Sprintf("group_c%d", p.i+1), decide.Route)
		var j int
		if !ok || pick == "none" {
			continue
		}
		if _, err := fmt.Sscanf(pick, "c%d", &j); err == nil && j >= 1 && j <= len(cands) && in[j-1] && j-1 != p.i {
			parent[find(j-1)] = find(p.i)
		}
	}
	// Alerts about Work in the same project are joined in code.
	byProject := map[string]int{}
	for _, p := range chosen {
		if pid := cands[p.i].inProject; pid != "" {
			if first, ok := byProject[pid]; ok {
				parent[find(p.i)] = find(first)
			} else {
				byProject[pid] = p.i
			}
		}
	}
	groups := map[int][]int{}
	var order []int
	for _, p := range chosen {
		r := find(p.i)
		if _, ok := groups[r]; !ok {
			order = append(order, r)
		}
		groups[r] = append(groups[r], p.i)
	}
	var out []notify.Alert
	for _, r := range order {
		members := groups[r]
		lead := cands[members[0]]
		action := lead.action
		if v, ok := a.Choice(fmt.Sprintf("action_c%d", members[0]+1), decide.Flag); ok {
			action = v
		}
		alert := notify.Alert{Key: lead.key, Kind: lead.kind, ProjectID: lead.projectID, Title: lead.title, Action: action}
		seen := map[string]bool{}
		var others []string
		for n, m := range members {
			for _, it := range cands[m].items {
				if !seen[it.ID] && len(alert.Items) < maxAlertItems {
					seen[it.ID] = true
					alert.Items = append(alert.Items, it)
				}
			}
			if n > 0 {
				others = append(others, cands[m].title)
			}
			if alert.ProjectID == "" && cands[m].projectID != "" {
				alert.ProjectID = cands[m].projectID
			}
		}
		body := lead.facts
		if len(others) > 0 {
			body += " Related: " + strings.Join(others, "; ") + "."
		}
		phrase := actionPhrase[action]
		if len(alert.Items) > 1 {
			phrase = actionPhrasePlural[action]
		}
		alert.Body = body + " Suggested: " + phrase + "."
		out = append(out, alert)
	}
	return out
}

// alertCandidates finds what could deserve an alert, in code. Work alerted
// about in the last week (skip) is left out.
func (s *Service) alertCandidates(ctx context.Context, userID string, now time.Time, skip map[string]bool) []alertCandidate {
	var out []alertCandidate
	add := func(c alertCandidate) {
		for _, it := range c.items {
			if skip[it.ID] {
				return
			}
		}
		if len(out) < maxAlertCandidates && len(c.items) > 0 {
			out = append(out, c)
		}
	}
	day := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	projects := s.projectTitles(ctx, userID)

	// Work due within three days that has no time on the calendar.
	var due []models.Task
	s.db.WithContext(ctx).Select("id", "name", "description", "deadline", "project_id").
		Where("user_id = ? AND kind = ? AND completed_at IS NULL AND deadline IS NOT NULL AND deadline >= ? AND deadline <= ?",
			userID, models.KindTask, day.Format("2006-01-02"), day.AddDate(0, 0, dueSoonDays).Format("2006-01-02")).
		Where("NOT EXISTS (SELECT 1 FROM scheduled_blocks b WHERE b.task_id = tasks.id AND b.end_at > ?)", now).
		Order("deadline").Limit(4).Find(&due)
	for _, t := range due {
		d, err := time.ParseInLocation("2006-01-02", models.NormalizeDate(*t.Deadline), now.Location())
		if err != nil {
			continue
		}
		when := dueWords(int(d.Sub(day).Hours() / 24))
		add(alertCandidate{key: "due:" + t.ID, kind: "due", title: fmt.Sprintf("“%s” is due %s", clip(t.Name, 80), when),
			facts: fmt.Sprintf("It is due %s and has no time on your calendar.", when), detail: clip(t.Description, 300),
			action: notify.AlertReschedule, items: []notify.AlertItem{{ID: t.ID, Name: t.Name}}, project: projects[deref(t.ProjectID)], inProject: deref(t.ProjectID)})
	}

	// Work a recently finished task was blocking.
	var unblocked []struct {
		ID, Name, Description, Blocker string
		ProjectID                      *string
		DoneAt                         time.Time
	}
	s.db.WithContext(ctx).Raw(`SELECT t.id, t.name, t.description, b.name AS blocker, t.project_id, b.completed_at AS done_at
		FROM tasks t JOIN tasks b ON b.id = t.blocked_by_id
		WHERE t.user_id = ? AND t.kind = ? AND t.completed_at IS NULL AND b.completed_at >= ?
		ORDER BY b.completed_at DESC LIMIT 3`, userID, models.KindTask, now.AddDate(0, 0, -unblockedDays)).Scan(&unblocked)
	for _, t := range unblocked {
		add(alertCandidate{key: "unblocked:" + t.ID, kind: "unblocked", title: fmt.Sprintf("“%s” is ready to start", clip(t.Name, 80)),
			facts:  fmt.Sprintf("It was waiting on “%s”, which was finished %s.", clip(t.Blocker, 80), agoWords(now, t.DoneAt)),
			detail: clip(t.Description, 300), action: notify.AlertFocus, items: []notify.AlertItem{{ID: t.ID, Name: t.Name}}, project: projects[deref(t.ProjectID)], inProject: deref(t.ProjectID)})
	}

	// Projects due within a week that still have open Work.
	var due7 []struct {
		ID, Title string
		Deadline  string
		Open      int
	}
	s.db.WithContext(ctx).Raw(`SELECT p.id, p.title, p.deadline::text AS deadline, COUNT(t.id) AS open
		FROM projects p JOIN workspaces w ON w.id = p.workspace_id
		JOIN tasks t ON t.project_id = p.id AND t.completed_at IS NULL AND t.kind = ?
		WHERE w.user_id = ? AND p.deadline IS NOT NULL AND p.deadline >= ? AND p.deadline <= ?
		GROUP BY p.id, p.title, p.deadline ORDER BY p.deadline LIMIT 2`, models.KindTask, userID,
		day.Format("2006-01-02"), day.AddDate(0, 0, projectDueDays).Format("2006-01-02")).Scan(&due7)
	for _, p := range due7 {
		d, err := time.ParseInLocation("2006-01-02", models.NormalizeDate(p.Deadline), now.Location())
		if err != nil {
			continue
		}
		var open []models.Task
		s.db.WithContext(ctx).Select("id", "name").Where("project_id = ? AND user_id = ? AND completed_at IS NULL AND kind = ?", p.ID, userID, models.KindTask).
			Order("deadline NULLS LAST").Limit(maxAlertItems).Find(&open)
		items := make([]notify.AlertItem, 0, len(open))
		for _, t := range open {
			items = append(items, notify.AlertItem{ID: t.ID, Name: t.Name})
		}
		when := dueWords(int(d.Sub(day).Hours() / 24))
		add(alertCandidate{key: "project:" + p.ID, kind: "project", title: fmt.Sprintf("Project “%s” is due %s", clip(p.Title, 80), when),
			facts: fmt.Sprintf("It is due %s with %s still open.", when, countWords(p.Open, "task")), action: notify.AlertReview, items: items, project: p.Title, projectID: p.ID, inProject: p.ID})
	}

	// An Inbox that has waited for days.
	var inbox []models.Task
	s.db.WithContext(ctx).Select("id", "name").
		Where("user_id = ? AND kind = ? AND completed_at IS NULL AND created_at <= ?", userID, models.KindInbox, day.AddDate(0, 0, -inboxWaitDays).Format("2006-01-02")).
		Order("created_at").Limit(20).Find(&inbox)
	if len(inbox) >= minInboxWaiting {
		items := make([]notify.AlertItem, 0, maxAlertItems)
		for _, t := range inbox {
			if len(items) < maxAlertItems {
				items = append(items, notify.AlertItem{ID: t.ID, Name: t.Name})
			}
		}
		add(alertCandidate{key: "inbox", kind: "inbox", title: fmt.Sprintf("%s waiting in your Inbox", countWords(len(inbox), "item")),
			facts: fmt.Sprintf("%s have waited in your Inbox for %d days or more.", countWords(len(inbox), "item"), inboxWaitDays), action: notify.AlertClarify, items: items})
	}

	// Work with no activity for weeks.
	if stale, err := s.staleTasks(ctx, userID, now); err == nil {
		for i, st := range stale {
			if i == 3 {
				break
			}
			add(alertCandidate{key: "stale:" + st.task.ID, kind: "stale", title: fmt.Sprintf("“%s” has been idle for %d days", clip(st.task.Name, 80), st.days),
				facts:  fmt.Sprintf("Nothing has happened on it for %d days and it has no time planned.", st.days),
				detail: clip(st.task.Description, 300), action: notify.AlertReview, items: []notify.AlertItem{{ID: st.task.ID, Name: st.task.Name}}, project: projects[deref(st.task.ProjectID)], inProject: deref(st.task.ProjectID)})
		}
	}
	return out
}

// projectTitles maps the person's project ids to titles.
func (s *Service) projectTitles(ctx context.Context, userID string) map[string]string {
	var rows []struct{ ID, Title string }
	s.db.WithContext(ctx).Raw(`SELECT p.id, p.title FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE w.user_id = ?`, userID).Scan(&rows)
	out := make(map[string]string, len(rows))
	for _, r := range rows {
		out[r.ID] = r.Title
	}
	return out
}

// Brief picks which of the morning briefing's candidates to name, most
// important first [89].
func (s *Service) Brief(ctx context.Context, userID string, items []notify.BriefItem) []int {
	if on, _ := s.decide.Status(ctx, userID); !on || len(items) == 0 {
		return nil
	}
	list := make([]map[string]any, 0, len(items))
	questions := map[string]decide.Question{}
	for i, it := range items {
		key := fmt.Sprintf("i%d", i+1)
		entry := map[string]any{"item": key, "name": clip(it.Name, 160), "facts": it.Note}
		if it.Description != "" {
			entry["description"] = it.Description
		}
		list = append(list, entry)
		questions[key] = decide.YesNo(fmt.Sprintf("Should a short morning briefing name item %s as one of the day's two or three most important things?", key),
			"Yes: it is among the most important or time-sensitive things today", "No: it can go unnamed in a short briefing")
	}
	a, err := s.decide.Ask(ctx, userID, decide.Request{Feature: "briefing", State: map[string]any{"items": list}, Questions: questions})
	if err != nil {
		return nil
	}
	type ranked struct {
		i    int
		prob float64
	}
	var picks []ranked
	for i := range items {
		key := fmt.Sprintf("i%d", i+1)
		if yes, ok := a.Yes(key, decide.Flag); ok && yes {
			raw, _ := a.Raw(key)
			picks = append(picks, ranked{i, raw.Yes})
		}
	}
	sort.SliceStable(picks, func(x, y int) bool { return picks[x].prob > picks[y].prob })
	out := make([]int, 0, len(picks))
	for _, p := range picks {
		out = append(out, p.i)
	}
	return out
}

func dueWords(days int) string {
	switch {
	case days <= 0:
		return "today"
	case days == 1:
		return "tomorrow"
	}
	return fmt.Sprintf("in %d days", days)
}

func agoWords(now, at time.Time) string {
	days := int(now.Sub(at).Hours() / 24)
	switch {
	case days <= 0:
		return "today"
	case days == 1:
		return "yesterday"
	}
	return fmt.Sprintf("%d days ago", days)
}

func countWords(n int, word string) string {
	if n == 1 {
		return "1 " + word
	}
	return fmt.Sprintf("%d %ss", n, word)
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
