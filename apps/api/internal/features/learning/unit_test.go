package learning

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"

	"timely-api/internal/agenthost"
	"timely-api/internal/agenthost/agenthosttest"
)

func TestMain(m *testing.M) { agenthosttest.Main(m) }

func TestEventFromWireChecksAndCaps(t *testing.T) {
	good := wireEvent{ID: "w-1", Kind: KindSkill, Status: StatusApplied, Action: "created", Subject: "bank-csv-import"}
	ev, err := eventFromWire(good)
	if err != nil || ev.WorkerEventID != "w-1" || string(ev.TaintedSources) != "[]" {
		t.Fatalf("good event: %+v %v", ev, err)
	}

	long := good
	long.Before = strings.Repeat("é", maxText+50)
	long.After = "ok\x00" + string([]byte{0xff}) + "!"
	ev, err = eventFromWire(long)
	if err != nil || len([]rune(ev.Before)) != maxText || ev.After != "ok�!" {
		t.Fatalf("caps: %d runes, after %q, %v", len([]rune(ev.Before)), ev.After, err)
	}

	tainted := good
	tainted.TaintedSources = json.RawMessage(`[{"kind":"web","tool":"web_extract","host":"example.com"}]`)
	if ev, err = eventFromWire(tainted); err != nil || !strings.Contains(string(ev.TaintedSources), "example.com") {
		t.Fatalf("tainted: %s %v", ev.TaintedSources, err)
	}

	for name, bad := range map[string]wireEvent{
		"no id":              {Kind: KindSkill, Status: StatusApplied},
		"unknown kind":       {ID: "w", Kind: "config", Status: StatusApplied},
		"status from Go":     {ID: "w", Kind: KindMemory, Status: StatusUndone},
		"staged, no pending": {ID: "w", Kind: KindMemory, Status: StatusStaged},
		"tainted not a list": {ID: "w", Kind: KindUser, Status: StatusApplied, TaintedSources: json.RawMessage(`{"kind":"web"}`)},
	} {
		if _, err := eventFromWire(bad); !errors.Is(err, errRefused) {
			t.Errorf("%s: %v, want refused", name, err)
		}
	}
	staged := wireEvent{ID: "w", Kind: KindMemory, Status: StatusStaged, PendingID: "p-1"}
	if _, err := eventFromWire(staged); err != nil {
		t.Fatalf("staged with pending: %v", err)
	}
}

func TestRecordRefusesAMessageForAnotherAccount(t *testing.T) {
	s := NewService(nil, nil) // never reaches the database
	m := agenthost.Message{Type: agenthost.TypeLearning, Account: "acct-b",
		Raw: json.RawMessage(`{"type":"learning","account":"acct-b","event":{"id":"w-1","kind":"skill","status":"applied"}}`)}
	if _, err := s.record(context.Background(), "acct-a", m); !errors.Is(err, errRefused) {
		t.Fatalf("record = %v, want refused", err)
	}
	m.Account = ""
	if _, err := s.record(context.Background(), "", m); !errors.Is(err, errRefused) {
		t.Fatalf("record without an account = %v, want refused", err)
	}
}

func TestMemoryUndoWritesTheBeforeTextBack(t *testing.T) {
	cases := []struct {
		before, after string
		want          map[string]any
	}{
		{"", "Likes short replies", map[string]any{"target": "user", "action": "remove", "content": "", "old": "Likes short replies"}},
		{"Lives in Pune", "", map[string]any{"target": "user", "action": "add", "content": "Lives in Pune", "old": ""}},
		{"Lives in Pune", "Lives in Kochi", map[string]any{"target": "user", "action": "replace", "content": "Lives in Pune", "old": "Lives in Kochi"}},
	}
	for _, c := range cases {
		got, ok := memoryUndo(Event{Kind: KindUser, Before: c.before, After: c.after})
		if !ok {
			t.Fatalf("%q -> %q: nothing to undo", c.before, c.after)
		}
		for k, v := range c.want {
			if got[k] != v {
				t.Fatalf("%q -> %q: %v, want %v", c.before, c.after, got, c.want)
			}
		}
	}
	if _, ok := memoryUndo(Event{Kind: KindMemory}); ok {
		t.Fatal("an event with no texts has something to undo")
	}
}

func TestReplyErrorsBecomeHTTPStatuses(t *testing.T) {
	cases := map[error]int{
		&agenthost.ReplyError{Code: "not_found", Message: "no such skill"}: http.StatusNotFound,
		&agenthost.ReplyError{Code: "bad_message", Message: "x"}:           http.StatusBadRequest,
		&agenthost.ReplyError{Code: "unsupported", Message: "x"}:           http.StatusNotImplemented,
		&agenthost.ReplyError{Code: "locked", Message: "x"}:                http.StatusConflict,
		&agenthost.ReplyError{Code: "boom", Message: "x"}:                  http.StatusBadGateway,
		context.DeadlineExceeded:                                           http.StatusGatewayTimeout,
		agenthost.ErrWorkerExited:                                          http.StatusServiceUnavailable,
	}
	for err, want := range cases {
		var he *echo.HTTPError
		if !errors.As(replyError(err), &he) || he.Code != want {
			t.Errorf("%v -> %v, want %d", err, replyError(err), want)
		}
	}
}

// A worker crash inside a request names a Python exception; the person
// sees plain words instead.
func TestAnInternalWorkerErrorIsShownInPlainWords(t *testing.T) {
	var he *echo.HTTPError
	err := replyError(&agenthost.ReplyError{Code: "internal", Message: "KeyError: 'operations'"})
	if !errors.As(err, &he) || he.Code != http.StatusBadGateway || he.Message != "Something went wrong in Timely's assistant. Try again." {
		t.Fatalf("%v", err)
	}
}

type stubWorker struct{ reply agenthost.Message }

func (s stubWorker) Request(context.Context, string, any) (agenthost.Message, error) {
	return s.reply, nil
}

func TestAskWorkerReadsTheResult(t *testing.T) {
	ok := stubWorker{agenthost.Message{Type: agenthost.TypeLearningResult, Raw: json.RawMessage(`{"type":"learning.result","ok":true,"data":{"n":1}}`)}}
	if data, err := askWorker(context.Background(), ok, "learning.list", nil); err != nil || string(data) != `{"n":1}` {
		t.Fatalf("ok: %s %v", data, err)
	}
	refused := stubWorker{agenthost.Message{Type: agenthost.TypeLearningResult, Raw: json.RawMessage(`{"type":"learning.result","ok":false,"code":"not_found","data":{"message":"no such skill"}}`)}}
	var he *echo.HTTPError
	if _, err := askWorker(context.Background(), refused, "learning.skill", nil); !errors.As(err, &he) || he.Code != http.StatusNotFound || !strings.Contains(he.Message, "no such skill") {
		t.Fatalf("ok false: %v", err)
	}
	other := stubWorker{agenthost.Message{Type: "ack", Raw: json.RawMessage(`{"type":"ack"}`)}}
	if _, err := askWorker(context.Background(), other, "learning.skill", nil); !errors.As(err, &he) || he.Code != http.StatusBadGateway {
		t.Fatalf("wrong type: %v", err)
	}
}

func TestSkillNamesNeverReachOutsideTheSkillsFolder(t *testing.T) {
	for _, name := range []string{"bank-csv-import", "notes_2", "a.b"} {
		if !validName(name) {
			t.Errorf("%q refused", name)
		}
	}
	for _, name := range []string{"", "..", "a/b", "../x", ".hidden", "a..b", strings.Repeat("a", 129), "a b"} {
		if validName(name) {
			t.Errorf("%q accepted", name)
		}
	}
}

// A restored skill whose name Timely cannot store would stay on: the
// restore fails instead.
func TestMarkRestoredRefusesANameItCannotKeepOff(t *testing.T) {
	for _, name := range []string{"Pantry steps", "notes-steps # mine", "../x", ""} {
		if err := MarkRestored(nil, "u1", []string{"fine", name}); err == nil {
			t.Errorf("MarkRestored accepted %q", name)
		}
	}
}
