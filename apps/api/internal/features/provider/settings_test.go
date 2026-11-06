package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/labstack/echo/v5"
	"timely-api/internal/features/chat"
)

// OWNER-2: the not-chosen answer is a 409 with a stable code the apps turn
// into a button to Settings → Agent, also when an echo handler returns it.
func TestNotChosenAnswersWithItsCode(t *testing.T) {
	e := echo.New()
	e.GET("/", func(c *echo.Context) error { return errNotChosen })
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	var body map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if rec.Code != http.StatusConflict || body["code"] != chat.ErrorCodeNotChosen || body["message"] != chat.NotChosenMessage {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	if !errors.Is(error(notChosenError{}), errNotChosen) {
		t.Fatal("errors.Is must match the typed error")
	}
}

// R10: key wording reads right for every provider name.
func TestAPIKeyNameReads(t *testing.T) {
	for id, want := range map[string]string{
		"openai":       "an OpenAI API key",
		"anthropic":    "an Anthropic API key",
		"deepseek":     "a DeepSeek API key",
		"xai":          "an xAI Grok API key",
		"nvidia":       "an NVIDIA NIM API key",
		"opencode-zen": "an OpenCode Zen API key",
		"gemini":       "a Google Gemini API key",
	} {
		if got := apiKeyName(apiProviderByID(id)); got != want {
			t.Errorf("%s: %q, want %q", id, got, want)
		}
	}
}

// R10: a test call that hangs ends with a message that says so.
func TestTestCompleterNamesAHang(t *testing.T) {
	hang := completerFunc(func(ctx context.Context) (chat.WireMessage, error) {
		<-ctx.Done()
		return chat.WireMessage{}, ctx.Err()
	})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := testCompleter(ctx, hang); err == nil || !strings.Contains(err.Error(), "did not answer the test request") {
		t.Fatalf("%v", err)
	}
}

type completerFunc func(ctx context.Context) (chat.WireMessage, error)

func (f completerFunc) Complete(ctx context.Context, _ []chat.WireMessage, _ []any, _ bool) (chat.WireMessage, error) {
	return f(ctx)
}

func TestVerifiedChecksExpire(t *testing.T) {
	var v verifiedChecks
	key := verifiedKey("user-a", "anthropic", "sealed", "", "model-a")
	if v.ok(key) {
		t.Fatal("nothing is verified yet")
	}
	v.mark(key)
	if !v.ok(key) || v.ok(verifiedKey("user-a", "anthropic", "sealed", "", "model-b")) || v.ok(verifiedKey("user-b", "anthropic", "sealed", "", "model-a")) {
		t.Fatal("only the same account, key, endpoint and model are verified")
	}
	v.at[key] = time.Now().Add(-verifiedFor)
	if v.ok(key) {
		t.Fatal("a check older than verifiedFor is asked again")
	}
}

// RV-settings-4: an answer cut off on the way from a typed Ollama address is
// sent again, as any dropped connection is, and still never quoted.
func TestTypedOllamaRetriesACutOffAnswer(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			_, _ = w.Write([]byte(`{"message":{"role":"assistant","content":"O`))
			return
		}
		_, _ = w.Write([]byte(`{"message":{"role":"assistant","content":"OK"},"done":true}`))
	}))
	defer server.Close()
	s := &Service{models: newCatalogue(), privateOllama: true}
	completer, err := s.buildAPI(apiProviderByID("ollama"), APIKey{BaseURL: server.URL + "/typed"}, "model-a")
	if err != nil {
		t.Fatal(err)
	}
	if c, ok := completer.(*Ollama); !ok || !c.Typed {
		t.Fatalf("want a typed Ollama, got %#v", completer)
	}
	if err := testCompleter(context.Background(), completer); err != nil || calls.Load() != 2 {
		t.Fatalf("%v after %d calls", err, calls.Load())
	}
	// Not JSON at all is not a dropped connection: one call, and the words
	// say what is wrong without repeating the answer.
	calls.Store(10)
	garbage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = w.Write([]byte(`<html>secret-admin-page</html>`))
	}))
	defer garbage.Close()
	completer, _ = s.buildAPI(apiProviderByID("ollama"), APIKey{BaseURL: garbage.URL}, "model-a")
	err = testCompleter(context.Background(), completer)
	if err == nil || strings.Contains(err.Error(), "secret") || !strings.Contains(err.Error(), "did not answer like an Ollama server") || calls.Load() != 11 {
		t.Fatalf("%v after %d calls", err, calls.Load()-10)
	}
}

// RV-settings-4: on an open server the example address is a public one.
func TestResolveBaseExampleFitsTheServer(t *testing.T) {
	spec := apiProviderByID("ollama")
	closed := &Service{privateOllama: true}
	if _, err := closed.resolveBase(spec, "ftp://box", ""); err == nil || !strings.Contains(err.Error(), "192.168.") {
		t.Fatalf("closed: %v", err)
	}
	open := &Service{privateOllama: false}
	if _, err := open.resolveBase(spec, "ftp://box", ""); err == nil || strings.Contains(err.Error(), "192.168.") || !strings.Contains(err.Error(), "https://") {
		t.Fatalf("open: %v", err)
	}
}
