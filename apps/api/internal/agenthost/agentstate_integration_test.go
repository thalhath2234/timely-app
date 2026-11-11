package agenthost_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/joho/godotenv"
	"github.com/pressly/goose/v3"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"timely-api/internal/agenthost"
	_ "timely-api/internal/database" // sets goose's embedded migrations
	"timely-api/internal/features/learning"
	"timely-api/internal/features/portability"
	"timely-api/internal/models"
)

// TestIntegrationRealWorkerAgentState is the backup round trip of an
// account's agent state (plan 6.5, phase 3; Q-3.4) with the real runtime's
// helpers and worker: an account with a learned skill, an About you entry, a
// waiting write and a chat session is backed up, and the backup restored
// into a fresh agent folder and a fresh database schema. The skill comes
// back off and marked restored; memory, the waiting write and the session
// come back; config, secrets and sign-ins do not. An outside app's restore
// leaves the home alone, and a restore a crash cut short between staging
// and the swap is settled at the next prepare.
//
// It needs the runtime (TIMELY_AGENT_TEST_RUNTIME, as TestIntegrationRealWorker)
// and PostgreSQL (CHAT_TEST_ENV, else the repo's .env; each run makes and
// drops its own schemas). The only model is a stub on 127.0.0.1.
//
//	make agent-go-integration
func TestIntegrationRealWorkerAgentState(t *testing.T) {
	value := strings.TrimSpace(os.Getenv("TIMELY_AGENT_TEST_RUNTIME"))
	if value == "" {
		t.Skip("set TIMELY_AGENT_TEST_RUNTIME to run the real agent worker")
	}
	if value == "dev" {
		value = ""
	}
	wd, _ := os.Getwd()
	rt, err := agenthost.ResolveRuntime(value, wd)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	const uid = "usr_agent_state_round_trip"
	const skill = "pantry-steps"
	const pendingID = "c0ffee01"
	const sessionText = "hello before the backup"
	model := newStub(t)

	// ---- the account that is backed up
	dbA := freshSchema(t)
	seedAccount(t, dbA, uid)
	supA, _ := realSupervisor(t, dbA, rt)
	w, err := supA.Ensure(ctx, uid)
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	chatTurn(t, ctx, w, uid, model, sessionText)
	if _, err := w.Request(ctx, "learning.memory", map[string]any{"target": "user", "action": "add", "content": "Shops on Saturdays."}); err != nil {
		t.Fatalf("learning.memory: %v", err)
	}
	home := w.Home()
	write(t, filepath.Join(home, "skills", "learned", skill, "SKILL.md"),
		"---\nname: "+skill+"\ndescription: Steps for the pantry list.\n---\n# Pantry\n\n1. Read the list.\n2. Sort it.\n")
	write(t, filepath.Join(home, "pending", "memory", pendingID+".json"), fmt.Sprintf(
		`{"id": %q, "subsystem": "memory", "action": "add", "summary": "add in user profile", "origin": "foreground", "created_at": %d, "payload": {"action": "add", "target": "user", "content": "Likes oat milk."}}`,
		pendingID, time.Now().Unix()))
	write(t, filepath.Join(home, ".env"), "OPENAI_API_KEY=sk-planted\n")
	write(t, filepath.Join(home, "mcp-tokens", "server.json"), `{"token": "planted"}`)
	if _, err := os.Stat(filepath.Join(home, "config.yaml")); err != nil {
		t.Fatalf("the home has no config.yaml to leave out: %v", err)
	}
	portA := portability.NewService(dbA, nil)
	portA.SetAgentState(supA)
	backup, err := portA.ExportAccount(ctx, uid)
	if err != nil {
		t.Fatal(err)
	}
	if backup.Agent == nil || len(backup.Warnings) != 0 {
		t.Fatalf("the backup has no agent state: warnings %q", backup.Warnings)
	}
	if err := supA.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}

	// ---- restored into a fresh agent folder and schema
	dbB := freshSchema(t)
	seedAccount(t, dbB, uid)
	supB, rootB := realSupervisor(t, dbB, rt)
	portB := portability.NewService(dbB, nil)
	portB.SetAgentState(supB)
	result, err := portB.Restore(uid, strictCopy(t, backup))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Warnings) != 0 {
		t.Fatalf("restore warnings %q", result.Warnings)
	}
	homeB := supB.Layout().Home(uid)
	if !strings.HasPrefix(homeB, rootB) {
		t.Fatalf("restored home %s is outside %s", homeB, rootB)
	}
	for _, rel := range []string{"skills/learned/" + skill + "/SKILL.md", "pending/memory/" + pendingID + ".json", "state.db", ".timely/restored.json"} {
		if _, err := os.Stat(filepath.Join(homeB, filepath.FromSlash(rel))); err != nil {
			t.Errorf("%s did not come back: %v", rel, err)
		}
	}
	if user := read(t, filepath.Join(homeB, "memories", "USER.md")); !strings.Contains(user, "Shops on Saturdays.") {
		t.Errorf("USER.md = %q", user)
	}
	if db := read(t, filepath.Join(homeB, "state.db")); !strings.Contains(db, sessionText) {
		t.Error("the chat session is not in the restored state.db")
	}
	for _, rel := range []string{"config.yaml", ".env", "mcp-tokens", "SOUL.md"} {
		if _, err := os.Stat(filepath.Join(homeB, rel)); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("%s came back", rel)
		}
	}
	var lists struct{ Disabled, Restored string }
	if err := dbB.Raw(`SELECT skills_disabled::text AS disabled, skills_restored::text AS restored FROM agent_learning_settings WHERE user_id = ?`, uid).Scan(&lists).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(lists.Disabled, skill) || !strings.Contains(lists.Restored, skill) {
		t.Fatalf("restored skill not off and marked: %+v", lists)
	}

	// The worker on the restored home sees the skill off and restored, the
	// About you entry and the waiting write.
	wB, err := supB.Ensure(ctx, uid)
	if err != nil {
		t.Fatalf("Ensure after restore: %v", err)
	}
	type skillRow struct {
		Name     string `json:"name"`
		Enabled  bool   `json:"enabled"`
		Restored bool   `json:"restored"`
	}
	var skills struct{ Skills []skillRow }
	listOf(t, ctx, wB, "skills", &skills)
	i := slices.IndexFunc(skills.Skills, func(s skillRow) bool { return s.Name == skill })
	if i < 0 || skills.Skills[i].Enabled || !skills.Skills[i].Restored {
		t.Fatalf("the worker lists %s as %+v", skill, skills.Skills)
	}
	var pending struct {
		Pending []struct {
			PendingID string `json:"pending_id"`
		}
	}
	listOf(t, ctx, wB, "pending", &pending)
	if len(pending.Pending) != 1 || pending.Pending[0].PendingID != pendingID {
		t.Fatalf("pending = %+v", pending)
	}
	var memory struct {
		User struct {
			Entries []string `json:"entries"`
		} `json:"user"`
	}
	listOf(t, ctx, wB, "memory", &memory)
	if !slices.Contains(memory.User.Entries, "Shops on Saturdays.") {
		t.Fatalf("About you = %q", memory.User.Entries)
	}
	if err := supB.Stop(ctx, uid, "test"); err != nil {
		t.Fatal(err)
	}

	// ---- an outside app's restore leaves the home alone
	before := treeDigest(t, rootB)
	mcpResult, err := portB.RestoreFromMCP(uid, strictCopy(t, backup))
	if err != nil {
		t.Fatal(err)
	}
	if after := treeDigest(t, rootB); after != before {
		t.Fatal("an outside app's restore changed the agent folder")
	}
	if len(mcpResult.Warnings) != 1 {
		t.Fatalf("MCP restore warnings %q", mcpResult.Warnings)
	}

	// ---- a crash between staging and the swap
	dropped, err := supB.StageRestore(ctx, uid, backup.Agent.Zip)
	if err != nil {
		t.Fatal(err)
	}
	committed, err := supB.StageRestore(ctx, uid, backup.Agent.Zip)
	if err != nil {
		t.Fatal(err)
	}
	// The Postgres restore of the second committed and wrote its marker;
	// the swap never happened.
	write(t, filepath.Join(committed.Dir, "COMMITTED"), "2026-11-11T12:00:00Z\n")
	write(t, filepath.Join(homeB, "memories", "USER.md"), "changed after the backup")
	if err := supB.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	supC := agenthost.New(agenthost.Config{Root: rootB, Runtime: rt, Logf: t.Logf})
	defer supC.Shutdown(context.Background())
	if _, err := supC.Prepare(ctx, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dropped.Dir); !errors.Is(err, os.ErrNotExist) {
		t.Error("a staged restore without COMMITTED survived prepare")
	}
	if _, err := os.Stat(committed.Dir); !errors.Is(err, os.ErrNotExist) {
		t.Error("a committed staged restore was not swapped in")
	}
	if user := read(t, filepath.Join(homeB, "memories", "USER.md")); !strings.Contains(user, "Shops on Saturdays.") {
		t.Errorf("after reconcile USER.md = %q", user)
	}
	if _, err := os.Stat(filepath.Join(homeB, "COMMITTED")); !errors.Is(err, os.ErrNotExist) {
		t.Error("the marker is in the home")
	}
}

// realSupervisor runs the real runtime on a fresh agent folder; accounts get
// the learning toolsets and their skills_disabled from db, and learning
// messages are recorded like the API does.
func realSupervisor(t *testing.T, db *gorm.DB, rt agenthost.Runtime) (*agenthost.Supervisor, string) {
	t.Helper()
	root := agentRoot(t)
	var learn *learning.Service
	sup := agenthost.New(agenthost.Config{
		Root:          root,
		Runtime:       rt,
		RenderAccount: true,
		HelloTimeout:  60 * time.Second,
		TimelyTools: func(context.Context) (string, json.RawMessage, error) {
			return "", json.RawMessage("[]"), nil
		},
		Account: func(ctx context.Context, uid string) (agenthost.AccountSpec, error) {
			p, err := learn.Prefs(ctx, uid)
			if err != nil {
				return agenthost.AccountSpec{}, err
			}
			raw, err := json.Marshal(map[string]any{
				"toolsets":        []string{"timely", "todo", "skills", "memory"},
				"learning":        map[string]bool{"memory": true, "user_profile": true},
				"curator":         map[string]bool{"enabled": false, "auto_archive": false},
				"skills_disabled": append([]string{}, p.SkillsDisabled...),
			})
			return agenthost.AccountSpec{Settings: raw}, err
		},
		Handler: func(w *agenthost.Worker, m agenthost.Message) {
			if learn.HandleWorker(w, m) {
				return
			}
			if m.Type == agenthost.TypeRunDone {
				runsDone <- m
			}
		},
		Logf: t.Logf,
	})
	learn = learning.NewService(db, sup)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = sup.Shutdown(ctx)
	})
	return sup, root
}

var runsDone = make(chan agenthost.Message, 16)

// chatTurn runs one chat turn on the stub model, so state.db has a session.
func chatTurn(t *testing.T, ctx context.Context, w *agenthost.Worker, uid string, model *stub, text string) {
	t.Helper()
	err := w.Send(agenthost.TypeRunStart, map[string]any{
		"run":             "run-backup",
		"conversation_id": "conv-backup",
		"session_key":     "timely:" + uid + ":conv-backup",
		"user_message":    text,
		"model": map[string]any{"provider": "custom", "model": "stub-model", "base_url": model.srv.URL + "/v1",
			"api_key": "sk-stub", "api_mode": "chat_completions"},
		"toolsets":        []string{},
		"flags":           map[string]any{},
		"budgets":         map[string]any{"max_iterations": 4},
		"tainted_sources": []any{},
	})
	if err != nil {
		t.Fatal(err)
	}
	for {
		select {
		case m := <-runsDone:
			if m.Run != "run-backup" {
				continue
			}
			var done struct {
				Completed bool   `json:"completed"`
				Error     string `json:"error"`
			}
			_ = m.Decode(&done)
			if !done.Completed || done.Error != "" {
				t.Fatalf("run.done = %s", m.Raw)
			}
			return
		case <-ctx.Done():
			t.Fatal("no run.done")
		}
	}
}

func listOf(t *testing.T, ctx context.Context, w *agenthost.Worker, what string, out any) {
	t.Helper()
	m, err := w.Request(ctx, "learning.list", map[string]any{"what": what})
	if err != nil {
		t.Fatalf("learning.list %s: %v", what, err)
	}
	var body struct {
		OK   bool            `json:"ok"`
		Data json.RawMessage `json:"data"`
	}
	if err := m.Decode(&body); err != nil || !body.OK {
		t.Fatalf("learning.list %s: %s", what, m.Raw)
	}
	if err := json.Unmarshal(body.Data, out); err != nil {
		t.Fatalf("learning.list %s: %v in %s", what, err, body.Data)
	}
}

// treeDigest hashes every path, size and file content under root.
func treeDigest(t *testing.T, root string) string {
	t.Helper()
	h := sha256.New()
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		fmt.Fprintf(h, "%s|%v\n", rel, d.IsDir())
		if d.Type().IsRegular() {
			f, err := os.Open(path)
			if err != nil {
				return err
			}
			defer f.Close()
			_, err = io.Copy(h, f)
			return err
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(h.Sum(nil))
}

func strictCopy(t *testing.T, backup *portability.Backup) *portability.Backup {
	t.Helper()
	raw, err := json.Marshal(backup)
	if err != nil {
		t.Fatal(err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var out portability.Backup
	if err := decoder.Decode(&out); err != nil {
		t.Fatal(err)
	}
	return &out
}

// agentRoot is a fresh agent folder under $HOME/.cache/timely-agent-test,
// never ~/.hermes (the tmpfs /tmp is small).
func agentRoot(t *testing.T) string {
	t.Helper()
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(home, ".cache", "timely-agent-test")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	made, err := os.MkdirTemp(dir, "agentstate-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(made) })
	return filepath.Join(made, "agent")
}

// freshSchema runs the whole goose chain in a new schema of its own.
func freshSchema(t *testing.T) *gorm.DB {
	t.Helper()
	file := os.Getenv("CHAT_TEST_ENV")
	if file == "" {
		if wd, err := os.Getwd(); err == nil {
			file = filepath.Join(wd, "..", "..", "..", "..", ".env")
		}
	}
	env, err := godotenv.Read(file)
	if err != nil {
		t.Skip("set CHAT_TEST_ENV (make test-chat-integration's .env) for the backup round trip")
	}
	u := &url.URL{Scheme: "postgres", Host: env["DB_HOST"] + ":" + env["DB_PORT"], Path: env["DB_NAME"], User: url.UserPassword(env["DB_USER"], env["DB_PASSWORD"])}
	q := url.Values{"sslmode": []string{env["DB_SSLMODE"]}}
	u.RawQuery = q.Encode()
	root, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Skip("test database unavailable")
	}
	schema := "agentstate_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Skipf("test database unavailable: %v", err)
	}
	t.Cleanup(func() { root.Exec("DROP SCHEMA " + schema + " CASCADE"); sqlDB, _ := root.DB(); sqlDB.Close() })
	q.Set("search_path", schema+",public")
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { sqlDB.Close() })
	goose.SetTableName(schema + ".goose_db_version")
	t.Cleanup(func() { goose.SetTableName("goose_db_version") })
	if err := goose.Up(sqlDB, "."); err != nil {
		t.Fatal(err)
	}
	return db
}

func seedAccount(t *testing.T, db *gorm.DB, uid string) {
	t.Helper()
	rows := []any{
		&models.User{ID: uid, Email: uid + "@example.invalid", Password: "not-a-real-hash"},
		&models.Config{ID: "cfg_" + uid, UserID: uid, TaskViews: models.DefaultTaskViews(), ActiveTaskViewId: "view_task_list"},
		&models.Workspace{ID: "ws_" + uid, Name: "Home", UserID: &[]string{uid}[0]},
	}
	for _, row := range rows {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
}

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func read(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// stub is an OpenAI-compatible chat completions server on 127.0.0.1 that
// answers "Stub reply: <last user message>", streamed or not.
type stub struct{ srv *httptest.Server }

func newStub(t *testing.T) *stub {
	t.Helper()
	s := &stub{srv: httptest.NewServer(http.HandlerFunc(serveStub))}
	t.Cleanup(s.srv.Close)
	return s
}

func serveStub(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet && strings.HasSuffix(strings.TrimRight(r.URL.Path, "/"), "/models") {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"object":"list","data":[{"id":"stub-model","object":"model","context_length":128000}]}`)
		return
	}
	if r.Method != http.MethodPost || !strings.HasSuffix(r.URL.Path, "/chat/completions") {
		http.NotFound(w, r)
		return
	}
	var body struct {
		Stream   bool `json:"stream"`
		Messages []struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		} `json:"messages"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	last := ""
	for _, m := range body.Messages {
		if m.Role == "user" {
			var text string
			if json.Unmarshal(m.Content, &text) == nil {
				last = text
			}
		}
	}
	reply := "Stub reply: " + last
	usage := map[string]int{"prompt_tokens": 100, "completion_tokens": 5, "total_tokens": 105}
	if !body.Stream {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "c1", "object": "chat.completion", "created": time.Now().Unix(), "model": "stub-model",
			"usage": usage, "choices": []any{map[string]any{"index": 0, "finish_reason": "stop", "message": map[string]any{"role": "assistant", "content": reply}}}})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	flusher, _ := w.(http.Flusher)
	send := func(chunk map[string]any) {
		chunk["id"], chunk["object"], chunk["created"], chunk["model"] = "c1", "chat.completion.chunk", time.Now().Unix(), "stub-model"
		data, _ := json.Marshal(chunk)
		_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
		if flusher != nil {
			flusher.Flush()
		}
	}
	send(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"role": "assistant", "content": reply}, "finish_reason": nil}}})
	send(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": "stop"}}})
	send(map[string]any{"choices": []any{}, "usage": usage})
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
	if flusher != nil {
		flusher.Flush()
	}
}
