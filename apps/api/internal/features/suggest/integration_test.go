package suggest

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"timely-api/internal/features/decide"
	"timely-api/internal/features/search"
	"timely-api/internal/models"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func integrationDB(t *testing.T) *gorm.DB {
	t.Helper()
	file := os.Getenv("CHAT_TEST_ENV")
	if file == "" {
		t.Skip("set CHAT_TEST_ENV via make test-chat-integration for isolated PostgreSQL tests")
	}
	env, err := godotenv.Read(file)
	if err != nil {
		t.Fatal(err)
	}
	u := &url.URL{Scheme: "postgres", Host: env["DB_HOST"] + ":" + env["DB_PORT"], Path: env["DB_NAME"], User: url.UserPassword(env["DB_USER"], env["DB_PASSWORD"])}
	q := url.Values{"sslmode": []string{env["DB_SSLMODE"]}}
	u.RawQuery = q.Encode()
	root, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal("test database unavailable")
	}
	schema := "suggest_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err = root.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { root.Exec("DROP SCHEMA " + schema + " CASCADE"); db, _ := root.DB(); db.Close() })
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB, _ := db.DB(); sqlDB.Close() })
	if err = db.AutoMigrate(&models.User{}, &models.Workspace{}, &models.Status{}, &models.Lable{}, &models.CustomField{},
		&models.Project{}, &models.Stage{}, &models.Task{}, &models.CustomFieldValue{}, &models.TaskActivity{},
		&models.RecurrenceRule{}, &models.Document{}, &models.SheetTemplate{}); err != nil {
		t.Fatal(err)
	}
	// Only the columns StaleWork reads; the full model pulls in events.
	if err = db.Exec(`CREATE TABLE scheduled_blocks (id text PRIMARY KEY, task_id text, user_id text, start_at timestamptz, end_at timestamptz)`).Error; err != nil {
		t.Fatal(err)
	}
	return db
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// jevStub answers by question id (a Twice copy answers like the first) and
// keeps every request's state and question ids.
type jevRequest struct {
	State     map[string]any             `json:"state"`
	Questions map[string]json.RawMessage `json:"questions"`
}

type jevStub struct {
	mu       sync.Mutex
	answers  map[string]any
	requests []jevRequest
}

func (j *jevStub) service(t *testing.T) *decide.Service {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var req jevRequest
		_ = json.Unmarshal(raw, &req)
		j.mu.Lock()
		j.requests = append(j.requests, req)
		j.mu.Unlock()
		out := map[string]any{}
		for id := range req.Questions {
			if a, ok := j.answers[strings.TrimSuffix(id, "__2")]; ok {
				out[id] = a
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "jev-1.13.0", "answers": out})
	}))
	t.Cleanup(srv.Close)
	client := decide.NewClient(nil)
	client.TypeSafeURL = srv.URL
	return decide.New(nil, func(context.Context, string) (decide.Keys, error) {
		return decide.Keys{Enabled: true, TypeSafe: "ts-test-key-123"}, nil
	}, client)
}

func (j *jevStub) asked(n int) map[string]json.RawMessage {
	j.mu.Lock()
	defer j.mu.Unlock()
	if n >= len(j.requests) {
		return nil
	}
	return j.requests[n].Questions
}

func yesNo(p float64) map[string]any { return map[string]any{"type": "noul", "noul": p} }
func choice(name string) map[string]any {
	return map[string]any{"type": "choice", "choice": name, "confidence": 0.95}
}

// nearby is a search that returns fixed hits for one kind.
type nearby struct {
	search.Service
	hits map[string][]search.Hit
}

func (n nearby) SemanticSearch(_ context.Context, _ string, _ string, _ int, kinds []string) ([]search.Hit, error) {
	if len(kinds) == 1 {
		return n.hits[kinds[0]], nil
	}
	return nil, nil
}

type world struct {
	db   *gorm.DB
	user string
	ws   string
}

func newWorld(t *testing.T) world {
	db := integrationDB(t)
	w := world{db: db, user: "usr_" + uuid.NewString(), ws: uuid.NewString()}
	must(t, db.Create(&models.User{ID: w.user, Email: w.user + "@test.local"}).Error)
	must(t, db.Create(&models.Workspace{ID: w.ws, Name: "Home", UserID: &w.user}).Error)
	return w
}

func (w world) task(t *testing.T, name string, edit func(*models.Task)) models.Task {
	t.Helper()
	task := models.Task{ID: "tsk_" + uuid.NewString(), Name: name, UserID: &w.user, WorkspaceID: &w.ws, Kind: models.KindTask}
	if edit != nil {
		edit(&task)
	}
	must(t, w.db.Create(&task).Error)
	return task
}

func ptr(s string) *string { return &s }

func TestIntegrationTaskHintsMapsAnswersToIDs(t *testing.T) {
	w := newWorld(t)
	todo := models.Status{ID: "tst_todo", Name: "To do", WorkspaceID: w.ws}
	waiting := models.Status{ID: "tst_wait", Name: "Waiting", WorkspaceID: w.ws}
	must(t, w.db.Create(&todo).Error)
	must(t, w.db.Create(&waiting).Error)
	project := models.Project{ID: "pr_1", Title: "Kitchen", WorkspaceID: &w.ws, DoesHaveStages: true}
	must(t, w.db.Create(&project).Error)
	must(t, w.db.Create(&models.Stage{ID: "stg_plan", Name: "Plan", Order: 1, ProjectID: &project.ID}).Error)
	must(t, w.db.Create(&models.Stage{ID: "stg_build", Name: "Build", Order: 2, ProjectID: &project.ID}).Error)
	room := models.CustomField{ID: "cf_room", Name: "Room", WorkspaceID: w.ws, Type: models.CustomFieldTypeSelect,
		Options: models.Options{Options: []models.Option{{ID: "o_k", Value: "Kitchen"}, {ID: "o_b", Value: "Bath"}}}}
	paid := models.CustomField{ID: "cf_paid", Name: "Paid", WorkspaceID: w.ws, Type: models.CustomFieldTypeBoolean}
	must(t, w.db.Create(&room).Error)
	must(t, w.db.Create(&paid).Error)
	quote := w.task(t, "Get the quote from Sam", func(task *models.Task) { task.ProjectID = &project.ID })
	main := w.task(t, "Install kitchen sink", func(task *models.Task) {
		task.ProjectID = &project.ID
		task.StatusID = &todo.ID
		task.Description = "Waiting on Sam's quote before we can book the plumber. Kitchen. Already paid the deposit."
		task.Checklist = models.Checklist{{ID: "c1", Title: "Book plumber"}}
	})
	// A task that already waits on this one can never be suggested as its blocker.
	loop := w.task(t, "Order cabinets", func(task *models.Task) { task.ProjectID = &project.ID; task.BlockedByID = &main.ID })
	must(t, w.db.Create(&models.TaskActivity{ID: "act_1", TaskID: main.ID, UserID: w.user, Action: "commented", Message: "Still no quote", CreatedAt: time.Now().Format(time.RFC3339)}).Error)

	jev := &jevStub{answers: map[string]any{
		"status": choice("Waiting"), "stage": choice("Build"),
		"field1": choice("Kitchen"), "field2": choice("yes"),
		"blocker": choice("t1"), "outcome": yesNo(0.1), "gap": yesNo(0.85),
	}}
	s := New(w.db, jev.service(t), nearby{hits: map[string][]search.Hit{"task": {{ID: main.ID}, {ID: loop.ID}, {ID: quote.ID}}}})
	out, err := s.TaskHints(context.Background(), w.user, main.ID)
	must(t, err)
	if out.StatusID != waiting.ID || out.StageID != "stg_build" || out.BlockedBy == nil || out.BlockedBy.ID != quote.ID || !out.VagueOutcome || !out.ChecklistGap {
		t.Fatalf("%+v", out)
	}
	if len(out.Fields) != 2 || out.Fields[0].FieldID != "cf_room" || out.Fields[0].OptionIDs[0] != "o_k" || out.Fields[1].Value != "true" {
		t.Fatalf("fields %+v", out.Fields)
	}
	asked := jev.asked(0)
	if _, ok := asked["left"]; ok {
		t.Fatal("asked done-but-not on an open task")
	}

	// Done with an unchecked item: counted in code; Jev asked whether work is left.
	must(t, w.db.Model(&models.Task{}).Where("id = ?", main.ID).Update("completed_at", time.Now()).Error)
	jev.answers = map[string]any{"left": yesNo(0.95)}
	out, err = s.TaskHints(context.Background(), w.user, main.ID)
	must(t, err)
	if !out.NotDone || out.OpenChecklist != 1 || out.BlockedBy != nil {
		t.Fatalf("done: %+v", out)
	}

	// Someone else's task is not found.
	if _, err := s.TaskHints(context.Background(), "usr_other", main.ID); err == nil {
		t.Fatal("read another account's task")
	}
}

func TestIntegrationStaleWorkSkipsRepeatingScheduledAndRecent(t *testing.T) {
	w := newWorld(t)
	now := time.Now()
	old := now.AddDate(0, 0, -40).Format("2006-01-02")
	stale := func(name string) models.Task {
		task := w.task(t, name, nil)
		must(t, w.db.Model(&models.Task{}).Where("id = ?", task.ID).UpdateColumns(map[string]any{"created_at": old, "updated_at": old}).Error)
		return task
	}
	idle := stale("Renew passport")
	older := stale("Fix the fence")
	must(t, w.db.Model(&models.Task{}).Where("id = ?", older.ID).UpdateColumns(map[string]any{"created_at": now.AddDate(0, 0, -60).Format("2006-01-02"), "updated_at": now.AddDate(0, 0, -60).Format("2006-01-02")}).Error)
	repeating := stale("Water plants")
	must(t, w.db.Create(&models.RecurrenceRule{ID: "rr_1", OwnerType: "task", OwnerID: repeating.ID, UserID: w.user, RRule: "FREQ=WEEKLY", Dtstart: now}).Error)
	booked := stale("Dentist")
	must(t, w.db.Exec("INSERT INTO scheduled_blocks (id, task_id, user_id, start_at, end_at) VALUES ('blk_1', ?, ?, ?, ?)", booked.ID, w.user, now.Add(24*time.Hour), now.Add(25*time.Hour)).Error)
	commented := stale("Call bank")
	must(t, w.db.Create(&models.TaskActivity{ID: "act_c", TaskID: commented.ID, UserID: w.user, Action: "commented", Message: "called", CreatedAt: now.AddDate(0, 0, -2).Format(time.RFC3339)}).Error)
	w.task(t, "New thing", nil)

	jev := &jevStub{answers: map[string]any{"task1": choice("obsolete"), "task2": choice("actionable")}}
	s := New(w.db, jev.service(t), nil)
	out, err := s.StaleWork(context.Background(), w.user, now)
	must(t, err)
	if len(out.Tasks) != 2 || out.Tasks[0].ID != older.ID || out.Tasks[1].ID != idle.ID {
		t.Fatalf("%+v", out.Tasks)
	}
	if out.Tasks[0].Verdict != "obsolete" || out.Tasks[1].Verdict != "actionable" || out.Tasks[0].IdleDays < 59 {
		t.Fatalf("%+v", out.Tasks)
	}
}

func TestIntegrationProjectInsights(t *testing.T) {
	w := newWorld(t)
	now := time.Now()
	brief := models.JSONMap{"type": "doc", "content": []any{
		map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": "New kitchen by spring."}}},
		map[string]any{"type": "bulletList", "content": []any{
			map[string]any{"type": "listItem", "content": []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": "Pick tiles"}}}}},
			map[string]any{"type": "listItem", "content": []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": "Replace the sink"}}}}},
		}},
	}}
	kitchen := models.Project{ID: "pr_k", Title: "Kitchen remodel", Description: "New kitchen by spring.\nPick tiles\nReplace the sink", DescriptionRich: brief, WorkspaceID: &w.ws, Deadline: ptr(now.AddDate(0, 0, 10).Format("2006-01-02"))}
	garden := models.Project{ID: "pr_g", Title: "Garden", WorkspaceID: &w.ws}
	reno := models.Project{ID: "pr_r", Title: "Kitchen renovation", WorkspaceID: &w.ws}
	for _, p := range []*models.Project{&kitchen, &garden, &reno} {
		must(t, w.db.Create(p).Error)
	}
	tiles := w.task(t, "Choose tiles", func(task *models.Task) { task.ProjectID = &kitchen.ID })
	hedge := w.task(t, "Trim the hedge", func(task *models.Task) {
		task.ProjectID = &kitchen.ID
		task.Deadline = ptr(now.AddDate(0, 0, -3).Format("2006-01-02"))
	})
	w.task(t, "Measure walls", func(task *models.Task) {
		task.ProjectID = &kitchen.ID
		task.CompletedAt = ptr(now.Add(-48 * time.Hour).Format(time.RFC3339))
	})
	w.task(t, "Wait for tiles", func(task *models.Task) { task.ProjectID = &kitchen.ID; task.BlockedByID = &tiles.ID })

	jev := &jevStub{answers: map[string]any{
		"health": choice("blocked"), "outcome": yesNo(0.9), "next": yesNo(0.2),
		"req1": yesNo(0.9), "req2": yesNo(0.1),
		"fit1": yesNo(0.95), "fit2": yesNo(0.02), "fit3": yesNo(0.9),
		"overlap1": yesNo(0.95), "move1": choice("Garden"),
	}}
	s := New(w.db, jev.service(t), nearby{hits: map[string][]search.Hit{"project": {{ID: kitchen.ID}, {ID: reno.ID}}}})
	out, err := s.ProjectInsights(context.Background(), w.user, kitchen.ID, now)
	must(t, err)
	f := out.Facts
	if f.Open != 3 || f.Done != 1 || f.DoneRecent != 1 || f.Overdue != 1 || f.Blocked != 1 || f.DaysLeft == nil || *f.DaysLeft != 10 {
		t.Fatalf("facts %+v", f)
	}
	if out.Health != "blocked" || out.NoOutcome || !out.NoNextAction || out.NoBrief {
		t.Fatalf("%+v", out)
	}
	if len(out.Uncovered) != 1 || out.Uncovered[0] != "Replace the sink" {
		t.Fatalf("uncovered %v", out.Uncovered)
	}
	if len(out.Misfiled) != 1 || out.Misfiled[0].TaskID != hedge.ID || out.Misfiled[0].MoveTo != garden.ID {
		t.Fatalf("misfiled %+v", out.Misfiled)
	}
	if len(out.Overlaps) != 1 || out.Overlaps[0].ID != reno.ID {
		t.Fatalf("overlaps %+v", out.Overlaps)
	}
	if _, err := s.ProjectInsights(context.Background(), "usr_other", kitchen.ID, now); err == nil {
		t.Fatal("read another account's project")
	}
}

func TestIntegrationCleanupKeepsTheMoreUsedSide(t *testing.T) {
	w := newWorld(t)
	for _, l := range []models.Lable{{ID: "lbl_bug", Name: "Bug"}, {ID: "lbl_bugs", Name: "bugs"}, {ID: "lbl_home", Name: "Home"}} {
		l.WorkspaceID = w.ws
		must(t, w.db.Create(&l).Error)
	}
	w.task(t, "a", func(task *models.Task) { task.LabelIDs = models.LabelInputs{{Id: "lbl_bugs"}} })
	w.task(t, "b", func(task *models.Task) { task.LabelIDs = models.LabelInputs{{Id: "lbl_bugs"}, {Id: "lbl_home"}} })
	w.task(t, "c", func(task *models.Task) { task.LabelIDs = models.LabelInputs{{Id: "lbl_bug"}} })

	// Bug/bugs is the similar pair and goes first; three labels are few
	// enough that every other pair is asked too.
	jev := &jevStub{answers: map[string]any{"pair1": yesNo(0.97), "pair2": yesNo(0.03), "pair3": yesNo(0.6)}}
	s := New(w.db, jev.service(t), nil)
	out, err := s.CleanupSuggestions(context.Background(), w.user, w.ws)
	must(t, err)
	if len(jev.asked(0)) != 3 {
		t.Fatalf("asked %v", jev.asked(0))
	}
	if len(out.Merges) != 1 || out.Merges[0].From.ID != "lbl_bug" || out.Merges[0].Into.ID != "lbl_bugs" || out.Merges[0].Into.Uses != 2 {
		t.Fatalf("%+v", out.Merges)
	}
	if _, err := s.CleanupSuggestions(context.Background(), "usr_other", w.ws); err == nil {
		t.Fatal("read another account's workspace")
	}
}

func TestIntegrationProjectStart(t *testing.T) {
	w := newWorld(t)
	trip := models.Project{ID: "pr_trip", Title: "Lisbon trip 2026", WorkspaceID: &w.ws}
	empty := models.Project{ID: "pr_empty", Title: "Empty", WorkspaceID: &w.ws}
	must(t, w.db.Create(&trip).Error)
	must(t, w.db.Create(&empty).Error)
	w.task(t, "Book flights", func(task *models.Task) { task.ProjectID = &trip.ID })
	w.task(t, "Pack", func(task *models.Task) { task.ProjectID = &trip.ID })
	must(t, w.db.Create(&models.Document{ID: "doc_t", Title: "Trip brief", WorkspaceID: w.ws, UserID: w.user, IsTemplate: true}).Error)
	must(t, w.db.Create(&models.Document{ID: "doc_n", Title: "Notes", WorkspaceID: w.ws, UserID: w.user}).Error)

	jev := &jevStub{answers: map[string]any{"copy": choice("p1"), "doc": choice("d1")}}
	s := New(w.db, jev.service(t), nil)
	out, err := s.ProjectStart(context.Background(), w.user, "Porto trip", w.ws)
	must(t, err)
	if out.CopyProjectID != trip.ID || out.DocTemplateID != "doc_t" || out.SheetTemplateID != "" {
		t.Fatalf("%+v", out)
	}
	// Only projects with something to copy are offered, and only template docs.
	asked := jev.asked(0)
	var copyQ, docQ struct {
		Criteria map[string]any `json:"criteria"`
	}
	_ = json.Unmarshal(asked["copy"], &copyQ)
	_ = json.Unmarshal(asked["doc"], &docQ)
	if len(copyQ.Criteria) != 2 || len(docQ.Criteria) != 2 {
		t.Fatalf("copy %s doc %s", asked["copy"], asked["doc"])
	}
}

func para(text string) map[string]any {
	return map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": text}}}
}

func docContent(nodes ...map[string]any) models.JSONMap {
	content := make([]any, len(nodes))
	for i, n := range nodes {
		content[i] = n
	}
	return models.JSONMap{"type": "doc", "content": content}
}

func frontmatter(text string) map[string]any {
	return map[string]any{"type": "frontmatter", "content": []any{map[string]any{"type": "text", "text": text}}}
}

func TestIntegrationDocHints(t *testing.T) {
	w := newWorld(t)
	now := time.Now()
	trip := models.Project{ID: "pr_trip", Title: "Lisbon trip", WorkspaceID: &w.ws}
	must(t, w.db.Create(&trip).Error)
	travel := models.Document{ID: "doc_travel", Title: "Travel", PlainText: "All my trips", WorkspaceID: w.ws, UserID: w.user}
	must(t, w.db.Create(&travel).Error)
	child := models.Document{ID: "doc_child", Title: "Old child", PlainText: "x", WorkspaceID: w.ws, UserID: w.user}
	for i, fm := range []string{"status: draft\ntype: plan", "status: done\ntype: plan", "status: draft"} {
		must(t, w.db.Create(&models.Document{ID: fmt.Sprintf("doc_p%d", i), Title: "Props", WorkspaceID: w.ws, UserID: w.user, Content: docContent(frontmatter(fm))}).Error)
	}
	w.task(t, "Book flights", nil)
	text := "Notes on the Lisbon weekend and what is left to sort out before we go."
	doc := models.Document{ID: "doc_notes", Title: "Lisbon notes", WorkspaceID: w.ws, UserID: w.user, PlainText: text, Content: docContent(
		para(text),
		map[string]any{"type": "heading", "content": []any{map[string]any{"type": "text", "text": "Things to do"}}},
		map[string]any{"type": "bulletList", "content": []any{
			map[string]any{"type": "listItem", "content": []any{para("Book flights")}},
			map[string]any{"type": "listItem", "content": []any{para("Renew the passport")}},
		}},
		map[string]any{"type": "taskList", "content": []any{
			map[string]any{"type": "taskItem", "attrs": map[string]any{"checked": true}, "content": []any{para("Pick the dates")}},
		}},
		map[string]any{"type": "codeBlock", "content": []any{map[string]any{"type": "text", "text": "echo not a task"}}},
	)}
	must(t, w.db.Create(&doc).Error)
	child.ParentID = &doc.ID
	must(t, w.db.Create(&child).Error)
	// Left alone for months, so it is asked whether it is outdated.
	must(t, w.db.Exec("UPDATE documents SET updated_at = ? WHERE id = ?", now.AddDate(0, -3, 0).Format(time.RFC3339), doc.ID).Error)

	jev := &jevStub{answers: map[string]any{
		"project": choice("p1"), "parent": choice("d1"), "prop1": choice("v1"),
		"outdated": yesNo(0.9), "w1": yesNo(0.95), "w2": yesNo(0.2),
	}}
	// The doc's own sub-page is never offered as its parent.
	s := New(w.db, jev.service(t), nearby{hits: map[string][]search.Hit{"doc": {{ID: child.ID}, {ID: doc.ID}, {ID: travel.ID}}}})
	out, err := s.DocHints(context.Background(), w.user, doc.ID, now)
	must(t, err)
	if out.Project == nil || out.Project.ID != trip.ID || out.Parent == nil || out.Parent.ID != travel.ID || !out.Outdated {
		t.Fatalf("%+v", out)
	}
	if len(out.Properties) != 1 || out.Properties[0].Key != "status" || out.Properties[0].Value != "draft" {
		t.Fatalf("properties %+v", out.Properties)
	}
	if len(out.Work) != 1 || out.Work[0] != text {
		t.Fatalf("work %v", out.Work)
	}
	asked := jev.asked(0)
	// The person's docs have their own "type" values, so those are asked
	// instead of the generic kinds.
	if _, ok := asked["type"]; ok {
		t.Fatal("asked a generic type though the person uses a type property")
	}
	if _, ok := asked["prop2"]; !ok {
		t.Fatalf("type values not asked: %v", asked)
	}
	// Book flights is open Work already; the checked item, the heading and
	// the code are not candidates.
	if _, ok := asked["w3"]; ok {
		t.Fatalf("asked %v", asked)
	}
	var parentQ struct {
		Criteria map[string]any `json:"criteria"`
	}
	_ = json.Unmarshal(asked["parent"], &parentQ)
	if len(parentQ.Criteria) != 2 {
		t.Fatalf("parent options %s", asked["parent"])
	}
	if _, err := s.DocHints(context.Background(), "usr_other", doc.ID, now); err == nil {
		t.Fatal("read another account's doc")
	}
}

func TestIntegrationDocHintsNearEmptyAsksOnlyForATemplate(t *testing.T) {
	w := newWorld(t)
	must(t, w.db.Create(&models.Document{ID: "doc_tpl", Title: "Meeting notes", PlainText: "Attendees\nAgenda\nActions", WorkspaceID: w.ws, UserID: w.user, IsTemplate: true}).Error)
	must(t, w.db.Create(&models.Document{ID: "doc_new", Title: "Standup 9 Oct", WorkspaceID: w.ws, UserID: w.user}).Error)
	jev := &jevStub{answers: map[string]any{"template": choice("t1")}}
	s := New(w.db, jev.service(t), nil)
	out, err := s.DocHints(context.Background(), w.user, "doc_new", time.Now())
	must(t, err)
	if out.Template == nil || out.Template.ID != "doc_tpl" || len(jev.asked(0)) != 1 {
		t.Fatalf("%+v asked %v", out, jev.asked(0))
	}
	// A template itself gets no hints.
	out, err = s.DocHints(context.Background(), w.user, "doc_tpl", time.Now())
	must(t, err)
	if !out.Available || out.Template != nil || len(jev.requests) != 1 {
		t.Fatalf("%+v", out)
	}
}

// mentionSearch returns fixed hits for a mixed-kind search.
type mentionSearch struct {
	search.Service
	hits []search.Hit
}

func (m mentionSearch) SemanticSearch(context.Context, string, string, int, []string) ([]search.Hit, error) {
	return m.hits, nil
}

func TestIntegrationMentionAndImportFormat(t *testing.T) {
	w := newWorld(t)
	jev := &jevStub{answers: map[string]any{"target": choice("i2"), "l1": choice("heading"), "l2": choice("bullet")}}
	s := New(w.db, jev.service(t), mentionSearch{hits: []search.Hit{
		{Kind: "doc", ID: "doc_self", Title: "This doc"},
		{Kind: "project", ID: "pr_1", Title: "Kitchen remodel"},
		{Kind: "task", ID: "tsk_1", Title: "Pick kitchen tiles"},
		{Kind: "task", ID: "tsk_1", Title: "Pick kitchen tiles"},
	}})
	m, err := s.Mention(context.Background(), w.user, "the  tiles", "doc_self")
	must(t, err)
	if len(m.Options) != 2 || m.Match == nil || m.Match.ID != "tsk_1" || m.Match.Kind != "task" {
		t.Fatalf("%+v", m)
	}
	f := s.ImportFormat(context.Background(), w.user, []string{"Groceries", "Milk", "", "Eggs"})
	if !f.Available || len(f.Kinds) != 4 || f.Kinds[0] != "heading" || f.Kinds[1] != "bullet" || f.Kinds[2] != "paragraph" || f.Kinds[3] != "paragraph" {
		t.Fatalf("%+v", f)
	}
}
