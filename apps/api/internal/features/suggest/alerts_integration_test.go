package suggest

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/notify"
	"timely-api/internal/models"
)

func TestIntegrationAlertsGroupAndPickSteps(t *testing.T) {
	w := newWorld(t)
	now := time.Now()
	day := now.Format("2006-01-02")
	project := models.Project{ID: "pr_kitchen", Title: "Kitchen", WorkspaceID: &w.ws, Deadline: ptr(now.AddDate(0, 0, 5).Format("2006-01-02"))}
	must(t, w.db.Create(&project).Error)
	invoice := w.task(t, "Pay the plumber's invoice", func(task *models.Task) {
		task.Deadline = ptr(now.AddDate(0, 0, 1).Format("2006-01-02"))
		task.ProjectID = &project.ID
	})
	quote := w.task(t, "Get the quote", nil)
	must(t, w.db.Model(&models.Task{}).Where("id = ?", quote.ID).Update("completed_at", now.Add(-20*time.Hour)).Error)
	plumber := w.task(t, "Book the plumber", func(task *models.Task) { task.BlockedByID = &quote.ID; task.ProjectID = &project.ID })
	// Booked work is not "due with no time".
	booked := w.task(t, "Order tiles", func(task *models.Task) { task.Deadline = ptr(day) })
	must(t, w.db.Exec("INSERT INTO scheduled_blocks (id, task_id, user_id, start_at, end_at) VALUES ('blk_t', ?, ?, ?, ?)", booked.ID, w.user, now.Add(time.Hour), now.Add(2*time.Hour)).Error)
	var inbox []models.Task
	for _, name := range []string{"idea: herb garden", "call about the boiler", "receipt from the hardware shop"} {
		item := w.task(t, name, func(task *models.Task) { task.Kind = models.KindInbox })
		must(t, w.db.Model(&models.Task{}).Where("id = ?", item.ID).UpdateColumn("created_at", now.AddDate(0, 0, -5)).Error)
		inbox = append(inbox, item)
	}

	// c1 due invoice, c2 unblocked plumber, c3 project, c4 inbox.
	// A yes/no answer's confidence is |2p-1|, so p 0.82 clears Prefill (0.6).
	jev := &jevStub{answers: map[string]any{
		"alert_c1": yesNo(0.9), "alert_c2": yesNo(0.1), "alert_c3": yesNo(0.82), "alert_c4": yesNo(0.85),
		"action_c1": choice("reschedule"),
		// The project and the invoice share a project, so code joins them.
		"group_c3": choice("none"), "group_c1": choice("none"), "group_c4": choice("none"),
	}}
	s := New(w.db, jev.service(t), nil)
	out := s.Alerts(context.Background(), w.user, now, nil, nil)
	if len(out) != 2 {
		t.Fatalf("%+v", out)
	}
	due, box := out[0], out[1]
	if due.Key != "due:"+invoice.ID || due.Action != notify.AlertReschedule || due.Kind != "due" || due.ProjectID != project.ID {
		t.Fatalf("due %+v", due)
	}
	if len(due.Items) != 2 || due.Items[0].ID != invoice.ID || due.Items[1].ID != plumber.ID {
		t.Fatalf("grouped items %+v", due.Items)
	}
	if !strings.Contains(due.Body, "Related: Project “Kitchen” is due in 5 days") || !strings.HasSuffix(due.Body, "Suggested: find time for them.") {
		t.Fatalf("body %q", due.Body)
	}
	// Jev gave no step, so the code's step for an Inbox stands.
	if box.Kind != "inbox" || box.Action != notify.AlertClarify || len(box.Items) != 3 || box.Title != "3 items waiting in your Inbox" {
		t.Fatalf("inbox %+v", box)
	}
	var state struct {
		Candidates []struct{ About, Project string } `json:"candidates"`
	}
	must(t, json.Unmarshal(mustJSON(t, jev.requests[0].State), &state))
	if len(state.Candidates) != 4 || state.Candidates[0].Project != "Kitchen" || strings.Contains(state.Candidates[0].About, "tiles") {
		t.Fatalf("candidates %+v", state.Candidates)
	}

	// Work alerted about this week is left out.
	s.Alerts(context.Background(), w.user, now, map[string]bool{inbox[0].ID: true, invoice.ID: true}, nil)
	asked := jev.asked(1)
	// Only the unblocked plumber is left: one candidate, so no group question.
	if _, ok := asked["alert_c1"]; !ok || len(asked) != 2 {
		t.Fatalf("skip: asked %d questions", len(asked))
	}
}

func TestIntegrationBriefRanksByProbability(t *testing.T) {
	w := newWorld(t)
	jev := &jevStub{answers: map[string]any{"i1": yesNo(0.8), "i2": yesNo(0.3), "i3": yesNo(0.95)}}
	s := New(w.db, jev.service(t), nil)
	got := s.Brief(context.Background(), w.user, []notify.BriefItem{
		{Name: "Pay rent", Note: "overdue by 2 days"}, {Name: "Water plants", Note: "planned at 18:00"}, {Name: "Board meeting", Note: "at 10:00"},
	})
	if len(got) != 2 || got[0] != 2 || got[1] != 0 {
		t.Fatalf("%v", got)
	}
}

func TestIntegrationHighlightsThemesReasonsAndTips(t *testing.T) {
	w := newWorld(t)
	now := time.Now()
	waiting := models.Status{ID: "tst_wait", Name: "Waiting", WorkspaceID: w.ws}
	must(t, w.db.Create(&waiting).Error)
	quote := w.task(t, "Get the quote", nil)
	w.task(t, "Book the plumber", func(task *models.Task) { task.BlockedByID = &quote.ID })
	w.task(t, "Visa letter", func(task *models.Task) { task.StatusID = &waiting.ID })
	report := w.task(t, "Write the annual report", func(task *models.Task) { task.Duration = 60 })
	must(t, w.db.Exec("INSERT INTO scheduled_blocks (id, task_id, user_id, start_at, end_at) VALUES ('blk_a', ?, ?, ?, ?), ('blk_b', ?, ?, ?, ?)",
		report.ID, w.user, now.Add(-50*time.Hour), now.Add(-48*time.Hour), report.ID, w.user, now.Add(-26*time.Hour), now.Add(-25*time.Hour)).Error)

	jev := &jevStub{answers: map[string]any{
		"b1": choice("person"), "b2": choice("person"), "m1": choice("too_big"),
		"f1": score(1), "f2": score(2), "f3": score(2), "f4": score(3),
		"t1": yesNo(0.85), "t3": yesNo(0.95), "t5": yesNo(0.82), "t6": yesNo(0.2),
	}}
	s := New(w.db, jev.service(t), nil)
	out, err := s.Highlights(context.Background(), w.user, []Fact{
		{ID: "done_week", Text: "You finished 4 tasks this week, 2 fewer than last week."},
		{ID: "overdue", Text: "3 tasks are overdue."},
		{ID: "overdue", Text: "duplicate id is dropped"},
		{ID: "server:blockers", Text: "a client cannot fake a server fact"},
	}, now)
	must(t, err)
	if !out.Available || len(out.Blockers) != 1 || out.Blockers[0].Key != "person" || out.Blockers[0].Count != 2 {
		t.Fatalf("blockers %+v", out.Blockers)
	}
	if len(out.Missed) != 1 || out.Missed[0].Label != "Bigger than planned" || out.Missed[0].Tasks[0].ID != report.ID {
		t.Fatalf("missed %+v", out.Missed)
	}
	// f1 done_week, f2 overdue, f3 server:blockers, f4 server:missed; ties keep fact order.
	if len(out.Highlights) != 3 || out.Highlights[0].ID != "server:missed" || out.Highlights[1].ID != "overdue" || out.Highlights[2].ID != "server:blockers" {
		t.Fatalf("highlights %+v", out.Highlights)
	}
	if !strings.HasPrefix(out.Highlights[2].Text, "2 open tasks are blocked; the most common reason: waiting on someone (2)") {
		t.Fatalf("server fact %q", out.Highlights[2].Text)
	}
	if len(out.Tips) != 2 || out.Tips[0].Key != "follow_up" || out.Tips[1].Key != "split" {
		t.Fatalf("tips %+v", out.Tips)
	}
	var reasons struct {
		Blocked []struct {
			Facts []string `json:"facts"`
		} `json:"blocked"`
	}
	must(t, json.Unmarshal(mustJSON(t, jev.requests[0].State), &reasons))
	if len(reasons.Blocked) != 2 {
		t.Fatalf("blocked state %+v", reasons)
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	raw, err := json.Marshal(v)
	must(t, err)
	return raw
}
