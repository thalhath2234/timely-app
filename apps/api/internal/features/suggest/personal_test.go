package suggest

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/decide"
	"timely-api/internal/models"

	"github.com/google/uuid"
	"github.com/labstack/echo/v5"
)

func TestPresets(t *testing.T) {
	got := Presets([]string{"study", "nonsense"}, nil)
	if len(got) == 0 || len(got) > maxPresetLabels {
		t.Fatalf("%d labels", len(got))
	}
	names := map[string]bool{}
	for _, l := range got {
		names[l.Name] = true
	}
	if !names["Exam"] || !names["Deep work"] || names["Invoices"] {
		t.Fatalf("%v", names)
	}
	// Two uses take turns, so each one's own labels make the list.
	both := map[string]bool{}
	for _, l := range Presets([]string{"home", "business"}, nil) {
		both[l.Name] = true
	}
	if len(both) != maxPresetLabels || !both["Clients"] || !both["Home repair"] {
		t.Fatalf("%v", both)
	}
	if len(Presets([]string{"nonsense"}, nil)) != 0 {
		t.Fatal("unknown uses give labels")
	}
}

func TestLabelKey(t *testing.T) {
	if labelKey(" Bills ") != labelKey("bill") || labelKey("Bus") == labelKey("bu") {
		t.Fatal("plural folding")
	}
}

func TestPromptCandidatesFollowProjectState(t *testing.T) {
	calm := promptCandidates(projectState{Title: "Garden", Open: 1})
	for _, p := range calm {
		if p.Key == "overdue" || p.Key == "blocked" || p.Key == "breakdown" || p.Key == "find_time" || p.Key == "plan_week" {
			t.Fatalf("calm project offers %s", p.Key)
		}
	}
	busy := promptCandidates(projectState{Title: "Shop launch", Open: 5, Overdue: 2, Blocked: 1, Biggest: "Build checkout", BiggestMinutes: 240, NextDue: "Photos"})
	keys := map[string]string{}
	for _, p := range busy {
		keys[p.Key] = p.Text
	}
	for _, k := range []string{"plan_week", "overdue", "blocked", "breakdown", "find_time"} {
		if keys[k] == "" {
			t.Fatalf("busy project misses %s: %v", k, keys)
		}
	}
	if !strings.Contains(keys["breakdown"], "Build checkout") || !strings.Contains(keys["next"], "Shop launch") {
		t.Fatalf("%v", keys)
	}
}

// personalTables adds the tables the personal features read.
func personalTables(t *testing.T, w world) {
	t.Helper()
	must(t, w.db.Exec(`CREATE TABLE IF NOT EXISTS suggestion_prefs (user_id text PRIMARY KEY, use_case text NOT NULL DEFAULT '',
		dismissed_tips jsonb NOT NULL DEFAULT '[]', updated_at timestamptz NOT NULL DEFAULT now())`).Error)
	must(t, w.db.Exec(`CREATE TABLE IF NOT EXISTS configs (id text, user_id text PRIMARY KEY, task_views jsonb, working_hours jsonb)`).Error)
}

// call runs a handler as the given account.
func call(t *testing.T, h echo.HandlerFunc, userID, method, target string, body any) (*httptest.ResponseRecorder, error) {
	t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(method, target, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.Set("userID", userID)
	return rec, h(c)
}

func TestIntegrationStarterLeavesTakenNamesOut(t *testing.T) {
	w := newWorld(t)
	personalTables(t, w)
	other := uuid.NewString()
	must(t, w.db.Create(&models.Workspace{ID: other, Name: "Theirs"}).Error)
	must(t, w.db.Create(&models.Lable{ID: "lbl_u", Name: "urgent", WorkspaceID: other}).Error)
	must(t, w.db.Create(&models.Lable{ID: "lbl_b", Name: "Bill", WorkspaceID: w.ws}).Error)

	answers := map[string]any{}
	for i := 1; i <= 26; i++ {
		answers[fmt.Sprintf("l%d", i)] = yesNo(0.9)
	}
	answers["l2"] = yesNo(0.97) // Quick win, once Urgent is left out
	answers["l3"] = yesNo(0.1)  // Deep work: a clear no
	jev := &jevStub{answers: answers}
	s := New(w.db, jev.service(t), nil)

	// No use case and almost no work: nothing to go on, so no call.
	out, err := s.Starter(context.Background(), w.user, w.ws)
	must(t, err)
	if !out.Available || len(out.Labels) != 0 || len(jev.requests) != 0 {
		t.Fatalf("%+v, %d calls", out, len(jev.requests))
	}

	must(t, s.saveUseCase(context.Background(), w.user, "Running a bakery"))
	out, err = s.Starter(context.Background(), w.user, w.ws)
	must(t, err)
	asked := jev.asked(0)
	if len(asked) != 26 {
		t.Fatalf("asked %d", len(asked))
	}
	for _, q := range asked {
		if strings.Contains(string(q), `\"Urgent\"`) || strings.Contains(string(q), `\"Bills\"`) {
			t.Fatalf("asked about a taken name: %s", q)
		}
	}
	if jev.requests[0].State["usesTimelyFor"] != "Running a bakery" {
		t.Fatalf("state %v", jev.requests[0].State)
	}
	if len(out.Labels) != maxStarterShown || out.Labels[0].Name != "Quick win" {
		t.Fatalf("%+v", out.Labels)
	}
	for _, l := range out.Labels {
		if l.Name == "Deep work" {
			t.Fatal("kept a clear no")
		}
	}
	if _, err := s.Starter(context.Background(), "usr_other", w.ws); err == nil {
		t.Fatal("read another account's workspace")
	}
}

func TestIntegrationApplyStarterSkipsTakenNames(t *testing.T) {
	w := newWorld(t)
	other := uuid.NewString()
	must(t, w.db.Create(&models.Workspace{ID: other, Name: "Theirs"}).Error)
	must(t, w.db.Create(&models.Lable{ID: "lbl_u", Name: "Urgent", WorkspaceID: other}).Error)
	s := New(w.db, (&jevStub{}).service(t), nil)

	rec, err := call(t, s.applyStarter, w.user, http.MethodPost, "/suggestions/starter/apply", map[string]any{
		"workspaceId": w.ws,
		"labels":      []map[string]string{{"name": "Urgent", "color": "#E5484D"}, {"name": "Deep work", "color": "javascript:"}},
	})
	must(t, err)
	var out struct {
		Created []models.Lable `json:"created"`
		Skipped []string       `json:"skipped"`
	}
	must(t, json.Unmarshal(rec.Body.Bytes(), &out))
	if len(out.Created) != 1 || out.Created[0].Name != "Deep work" || out.Created[0].Color != "#6E56CF" || out.Created[0].WorkspaceID != w.ws {
		t.Fatalf("%+v", out.Created)
	}
	if len(out.Skipped) != 1 || out.Skipped[0] != "Urgent" {
		t.Fatalf("%v", out.Skipped)
	}
	if _, err := call(t, s.applyStarter, w.user, http.MethodPost, "/", map[string]any{
		"workspaceId": other, "labels": []map[string]string{{"name": "Mine", "color": "#000000"}},
	}); err == nil {
		t.Fatal("added a label to another account's workspace")
	}
}

func TestIntegrationTipForScreenDismissAndLearnedRaise(t *testing.T) {
	w := newWorld(t)
	personalTables(t, w)
	must(t, w.db.AutoMigrate(&decide.DecisionLog{}))
	yesterday := time.Now().AddDate(0, 0, -2).Format("2006-01-02")
	w.task(t, "File VAT return", func(task *models.Task) { task.Deadline = &yesterday })
	w.task(t, "Book venue", nil)

	jev := &jevStub{answers: map[string]any{"tip": choice("today_overdue")}}
	s := New(w.db, jev.serviceDB(t, w.db), nil)
	ctx := context.Background()

	out, err := s.TipFor(ctx, w.user, "today", "UTC", false)
	must(t, err)
	if out.Tip == nil || out.Tip.Key != "today_overdue" || !strings.Contains(out.Tip.Text, "1 task is past the deadline. Ask the assistant to move it") {
		t.Fatalf("%+v", out.Tip)
	}

	// Phone: the web-only tasks tip is never offered.
	_, err = s.TipFor(ctx, w.user, "tasks", "UTC", true)
	must(t, err)
	for _, req := range jev.requests[1:] {
		if strings.Contains(string(req.Questions["tip"]), "tasks_views") {
			t.Fatal("offered a web-only tip on the phone")
		}
	}

	// A dismissed tip never comes back.
	_, err = call(t, s.dismissTip, w.user, http.MethodPost, "/", map[string]any{"key": "today_overdue", "logId": out.LogID})
	must(t, err)
	if p := s.personal(ctx, w.user); len(p.DismissedTips) != 1 || p.DismissedTips[0] != "today_overdue" {
		t.Fatalf("%+v", p)
	}
	out, err = s.TipFor(ctx, w.user, "today", "UTC", false)
	must(t, err)
	if out.Tip != nil {
		t.Fatalf("dismissed tip came back: %+v", out.Tip)
	}

	// Dismissing again changes nothing.
	_, err = call(t, s.dismissTip, w.user, http.MethodPost, "/", map[string]any{"key": "today_overdue"})
	must(t, err)
	if p := s.personal(ctx, w.user); len(p.DismissedTips) != 1 {
		t.Fatalf("%+v", p)
	}

	// Tips never learn: many dismissals would otherwise switch them off.
	now := time.Now()
	no := false
	seed := func(feature string) {
		for i := 0; i < 10; i++ {
			must(t, w.db.Create(&decide.DecisionLog{ID: uuid.NewString(), UserID: w.user, Feature: feature, OK: true, Accepted: &no, CreatedAt: now, DecidedAt: &now}).Error)
		}
	}
	seed("screen_tip")
	jev.answers = map[string]any{"tip": map[string]any{"type": "choice", "choice": "today_focus", "confidence": 0.5}}
	d := jev.serviceDB(t, w.db)
	s = New(w.db, d, nil)
	out, err = s.TipFor(ctx, w.user, "today", "UTC", false)
	must(t, err)
	if out.Tip == nil || out.Tip.Key != "today_focus" {
		t.Fatalf("tips were raised: %+v", out.Tip)
	}

	// Learned defaults: after the person turned down most starter labels, a
	// yes at 0.8 (confidence 0.6, enough for Flag) is no longer enough.
	must(t, s.saveUseCase(ctx, w.user, "Running a bakery"))
	jev.answers = map[string]any{"l1": yesNo(0.8)}
	seed("starter_labels")
	starter, err := s.Starter(ctx, w.user, w.ws)
	must(t, err)
	if len(starter.Labels) != 0 {
		t.Fatalf("raised minimum let %+v through", starter.Labels)
	}
	learned, err := d.LearnedFor(w.user)
	must(t, err)
	raised := map[string]float64{}
	for _, l := range learned {
		raised[l.Feature] = l.Raise
	}
	if raised["starter_labels"] == 0 || raised["screen_tip"] != 0 {
		t.Fatalf("%+v", learned)
	}
	must(t, d.ResetLearned(w.user, "starter_labels"))
	starter, err = s.Starter(ctx, w.user, w.ws)
	must(t, err)
	if len(starter.Labels) != 1 || starter.Labels[0].Name != "Urgent" {
		t.Fatalf("after reset: %+v", starter.Labels)
	}
}

func TestIntegrationPresetsLeaveTakenNamesOut(t *testing.T) {
	w := newWorld(t)
	must(t, w.db.Create(&models.Lable{ID: "lbl_q", Name: "quick wins", WorkspaceID: w.ws}).Error)
	s := New(w.db, (&jevStub{}).service(t), nil)
	rec, err := call(t, s.starterPresets, w.user, http.MethodGet, "/suggestions/starter/presets?uses=home", nil)
	must(t, err)
	if strings.Contains(rec.Body.String(), "Quick win") || !strings.Contains(rec.Body.String(), "Errand") {
		t.Fatalf("%s", rec.Body.String())
	}
}

func TestIntegrationPromptsFitTheProject(t *testing.T) {
	w := newWorld(t)
	shop := models.Project{ID: "pr_shop", Title: "Shop launch", WorkspaceID: &w.ws}
	must(t, w.db.Create(&shop).Error)
	theirs := models.Project{ID: "pr_theirs", Title: "Not yours"}
	must(t, w.db.Create(&theirs).Error)
	late := time.Now().AddDate(0, 0, -3).Format("2006-01-02")
	soon := time.Now().AddDate(0, 0, 2).Format("2006-01-02")
	w.task(t, "Order boxes", func(task *models.Task) { task.ProjectID = &shop.ID; task.Deadline = &late })
	w.task(t, "Build checkout", func(task *models.Task) { task.ProjectID = &shop.ID; task.Duration = 240 })
	w.task(t, "Product photos", func(task *models.Task) { task.ProjectID = &shop.ID; task.Deadline = &soon })

	// next p1, status p2, plan_week p3, overdue p4, breakdown p5, find_time p6.
	jev := &jevStub{answers: map[string]any{"p1": score(0), "p4": score(3), "p5": score(2)}}
	s := New(w.db, jev.service(t), nil)
	out, err := s.Prompts(context.Background(), w.user, theirs.ID, "UTC", time.Now())
	must(t, err)
	if out.Project != "Shop launch" {
		t.Fatalf("project %q", out.Project)
	}
	var keys []string
	for _, p := range out.Prompts {
		keys = append(keys, p.Key)
	}
	if strings.Join(keys, ",") != "overdue,breakdown,next,status" {
		t.Fatalf("prompts %v", keys)
	}
	if !strings.Contains(out.Prompts[1].Text, "Build checkout") {
		t.Fatalf("%+v", out.Prompts[1])
	}
	examples, _ := json.Marshal(jev.requests[0].State["examples"])
	if !strings.Contains(string(examples), "Find time before it's due for “Product photos”") {
		t.Fatalf("find time was not offered: %s", examples)
	}
}
