package focus

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"timely-api/internal/features/decide"
	"timely-api/internal/models"
)

func day(t *testing.T, s string) time.Time {
	t.Helper()
	d, err := ParseDay(s)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func days(list ...string) map[string]bool {
	out := map[string]bool{}
	for _, d := range list {
		out[d] = true
	}
	return out
}

func TestStreak(t *testing.T) {
	today := day(t, "2026-03-02")
	tests := []struct {
		name string
		done map[string]bool
		want int
	}{
		{"nothing", days(), 0},
		{"only today", days("2026-03-02"), 1},
		{"today not done yet keeps yesterday's run", days("2026-03-01", "2026-02-28", "2026-02-27"), 3},
		{"today done extends the run", days("2026-03-02", "2026-03-01", "2026-02-28"), 3},
		{"a gap ends the run", days("2026-03-02", "2026-02-28"), 1},
		{"missed yesterday breaks it", days("2026-02-28", "2026-02-27"), 0},
		{"across a month end and a leap-free February", days("2026-03-01", "2026-02-28", "2026-02-27", "2026-02-26"), 4},
		{"future days do not count", days("2026-03-03"), 0},
	}
	for _, tt := range tests {
		if got := Streak(tt.done, today); got != tt.want {
			t.Errorf("%s: streak %d, want %d", tt.name, got, tt.want)
		}
	}
	// Across a daylight-saving change the date steps one day at a time.
	if got := Streak(days("2026-03-29", "2026-03-28", "2026-03-27"), day(t, "2026-03-29")); got != 3 {
		t.Errorf("dst streak %d", got)
	}
}

func TestStreakStartAndLast7(t *testing.T) {
	today := day(t, "2026-03-02")
	done := days("2026-03-01", "2026-02-28", "2026-02-24")
	if got := streakStart(done, today, Streak(done, today)); !got.Equal(day(t, "2026-02-28")) {
		t.Errorf("start %s", got)
	}
	got := Last7(days("2026-03-02", "2026-02-28", "2026-02-24", "2026-02-23"), today)
	want := []bool{true, false, false, false, true, false, true} // 02-24 .. 03-02
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("last7 %v, want %v", got, want)
		}
	}
}

func TestParseDayAndCleanName(t *testing.T) {
	for _, bad := range []string{"", "2026-1-5", "2026-02-30", "05/01/2026", "2026-01-05T00:00:00Z", "tomorrow"} {
		if _, err := ParseDay(bad); err == nil {
			t.Errorf("%q parsed", bad)
		}
	}
	if name, err := CleanName("  Read   20 pages ", "habit"); err != nil || name != "Read 20 pages" {
		t.Errorf("clean %q %v", name, err)
	}
	if _, err := CleanName("   ", "habit"); err == nil {
		t.Error("blank name accepted")
	}
	if _, err := CleanName(strings.Repeat("é", MaxNameLen), "goal"); err != nil {
		t.Errorf("80 characters refused: %v", err)
	}
	if _, err := CleanName(strings.Repeat("x", MaxNameLen+1), "goal"); err == nil {
		t.Error("81 characters accepted")
	}
}

func TestHashesChangeWithWords(t *testing.T) {
	a := []Goal{{ID: "goal_1", Title: "Get fit"}, {ID: "goal_2", Title: "Launch the shop"}}
	b := []Goal{{ID: "goal_2", Title: "Launch the shop"}, {ID: "goal_1", Title: "Get fit"}}
	c := []Goal{{ID: "goal_1", Title: "Get fitter"}, {ID: "goal_2", Title: "Launch the shop"}}
	if GoalsHash(a) == GoalsHash(b) || GoalsHash(a) == GoalsHash(c) || GoalsHash(a) != GoalsHash(append([]Goal(nil), a...)) {
		t.Error("goals hash does not follow order and titles")
	}
	if TaskHash("Run", "") == TaskHash("Run", "5k") || TaskHash("Ru", "n") == TaskHash("Run", "") {
		t.Error("task hash does not follow the words")
	}
}

// jevStub answers by question id and keeps every request.
type jevStub struct {
	mu       sync.Mutex
	answers  map[string]any
	requests []map[string]json.RawMessage
	states   []map[string]any
	fail     bool
}

func (j *jevStub) service(t *testing.T) *decide.Service {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var req struct {
			State     map[string]any             `json:"state"`
			Questions map[string]json.RawMessage `json:"questions"`
		}
		_ = json.Unmarshal(raw, &req)
		j.mu.Lock()
		j.requests = append(j.requests, req.Questions)
		j.states = append(j.states, req.State)
		fail := j.fail
		j.mu.Unlock()
		if fail {
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = w.Write([]byte(`{"error":{"message":"bad request"}}`))
			return
		}
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

func choice(name string, confidence float64) map[string]any {
	return map[string]any{"type": "choice", "choice": name, "confidence": confidence}
}

func TestTagTasksReadsGoalsAtPrefill(t *testing.T) {
	goals := []Goal{{ID: "goal_fit", Title: "Get fit"}, {ID: "goal_shop", Title: "Launch the shop"}}
	tasks := make([]models.Task, 23) // two batches: 20 and 3
	for i := range tasks {
		tasks[i] = models.Task{ID: "tsk_" + string(rune('a'+i)), Name: "Task " + string(rune('a'+i))}
	}
	jev := &jevStub{answers: map[string]any{
		"goal_t1": choice("g1", 0.9),   // Get fit
		"goal_t2": choice("g2", 0.9),   // Launch the shop
		"goal_t3": choice("g2", 0.3),   // unsure
		"goal_t4": choice("none", 0.9), // none
		"goal_t5": choice("g9", 0.9),   // not a goal
	}}
	picks, err := TagTasks(context.Background(), jev.service(t), "usr_1", goals, tasks, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(jev.requests) != 2 || len(jev.requests[0])+len(jev.requests[1]) != 23 {
		t.Fatalf("asked %d calls", len(jev.requests))
	}
	// Each batch numbers its tasks from t1, so both batches' t1 is Get fit.
	if picks[tasks[0].ID] != 0 || picks[tasks[20].ID] != 0 || picks[tasks[1].ID] != 1 || picks[tasks[21].ID] != 1 {
		t.Fatalf("picks %v", picks)
	}
	// Unsure and "none" are answers: stored as no goal.
	for _, i := range []int{2, 3, 22} {
		if p, ok := picks[tasks[i].ID]; !ok || p != -1 {
			t.Errorf("task %d: %d %v", i, p, ok)
		}
	}
	// No answer, or a goal that was never offered: asked again next time.
	for _, i := range []int{4, 5, 19} {
		if p, ok := picks[tasks[i].ID]; ok {
			t.Errorf("task %d has no answer but was kept as %d", i, p)
		}
	}
	goalsState, _ := json.Marshal(jev.states[0]["goals"])
	if string(goalsState) != `["Get fit","Launch the shop"]` {
		t.Errorf("state goals %s", goalsState)
	}
}

func TestTagTasksFailureLeavesBatchOut(t *testing.T) {
	jev := &jevStub{fail: true}
	picks, err := TagTasks(context.Background(), jev.service(t), "usr_1", []Goal{{ID: "g", Title: "Get fit"}}, []models.Task{{ID: "tsk_1", Name: "Run"}}, nil)
	if err == nil || len(picks) != 0 {
		t.Fatalf("picks %v err %v", picks, err)
	}
	// A quick refusal reads as what it is, never as "took too long", even
	// though the ask's own budget is over by the time the line is written.
	if msg := decide.Reason(err); msg == "" || strings.Contains(msg, "too long") || strings.Contains(msg, "bad request") {
		t.Errorf("failure %q", msg)
	}
}

// Questions left out of an answer are asked again next time instead of
// being stored as "no goal".
func TestTagTasksKeepsOnlyAnsweredTasks(t *testing.T) {
	jev := &jevStub{answers: map[string]any{"goal_t1": map[string]any{"type": "choice", "choice": "g1", "confidence": 0.95}}}
	tasks := []models.Task{{ID: "tsk_1", Name: "Run 5k"}, {ID: "tsk_2", Name: "Stretch"}}
	picks, err := TagTasks(context.Background(), jev.service(t), "usr_1", []Goal{{ID: "g", Title: "Get fit"}}, tasks, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(picks) != 1 || picks["tsk_1"] != 0 {
		t.Fatalf("want only the answered task, got %v", picks)
	}
}

type offDecider struct{}

func (offDecider) Status(context.Context, string) (bool, string) { return false, "" }
func (offDecider) Ask(context.Context, string, decide.Request) (decide.Answers, error) {
	return decide.Answers{}, decide.ErrOff
}

func TestProgressOffIsUnavailable(t *testing.T) {
	// With suggestions off nothing is read or asked, so no database is needed.
	out, err := NewStore(nil).Progress(context.Background(), offDecider{}, "usr_1")
	if err != nil || out.Available || out.Goals == nil || len(out.Goals) != 0 {
		t.Fatalf("%+v %v", out, err)
	}
	out, err = NewStore(nil).Progress(context.Background(), nil, "usr_1")
	if err != nil || out.Available {
		t.Fatalf("nil decider: %+v %v", out, err)
	}
}
