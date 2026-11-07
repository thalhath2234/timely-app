package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"timely-api/internal/features/chat"
)

// fakeMessages answers the Messages API with reply(n, body) for the nth call
// (from 0) and records every request body.
func fakeMessages(t *testing.T, reply func(n int, body map[string]any, w http.ResponseWriter)) (*httptest.Server, func() []map[string]any) {
	t.Helper()
	var mu sync.Mutex
	var bodies []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		mu.Lock()
		n := len(bodies)
		bodies = append(bodies, body)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		reply(n, body, w)
	}))
	t.Cleanup(server.Close)
	return server, func() []map[string]any {
		mu.Lock()
		defer mu.Unlock()
		return append([]map[string]any(nil), bodies...)
	}
}

func message(stop, text string) string {
	return `{"id":"m","type":"message","role":"assistant","model":"test-model","stop_reason":"` + stop + `","content":[{"type":"text","text":"` + text + `"}],"usage":{"input_tokens":1,"output_tokens":1}}`
}

func hello() []chat.WireMessage { return []chat.WireMessage{{Role: "user", Content: "hi"}} }

func TestAnthropicFinishesAPausedTurn(t *testing.T) {
	server, bodies := fakeMessages(t, func(n int, _ map[string]any, w http.ResponseWriter) {
		if n == 0 {
			_, _ = w.Write([]byte(message("pause_turn", "Searching. ")))
			return
		}
		_, _ = w.Write([]byte(message("end_turn", "Found it.")))
	})
	p := &Anthropic{Key: "k", Model: "test-model", Base: server.URL, Client: server.Client()}
	got, err := p.Complete(context.Background(), hello(), nil, false)
	if err != nil || got.Content != "Searching. Found it." {
		t.Fatalf("%q %v", got.Content, err)
	}
	sent := bodies()
	if len(sent) != 2 {
		t.Fatalf("want the paused turn sent back once, got %d calls", len(sent))
	}
	turns := sent[1]["messages"].([]any)
	if last := turns[len(turns)-1].(map[string]any); last["role"] != "assistant" {
		t.Fatalf("the paused turn must go back as the assistant's: %v", turns)
	}

	// A turn that keeps pausing ends with a message, not a loop.
	server, bodies = fakeMessages(t, func(_ int, _ map[string]any, w http.ResponseWriter) {
		_, _ = w.Write([]byte(message("pause_turn", "Still searching. ")))
	})
	p = &Anthropic{Key: "k", Model: "test-model", Base: server.URL, Client: server.Client()}
	if _, err := p.Complete(context.Background(), hello(), nil, false); err == nil || !strings.Contains(err.Error(), "too many steps") {
		t.Fatalf("%v", err)
	}
	if n := len(bodies()); n != 1+maxContinues {
		t.Fatalf("want %d calls, got %d", 1+maxContinues, n)
	}
}

func TestAnthropicNamesWhyAnAnswerStopped(t *testing.T) {
	for stop, want := range map[string]error{"max_tokens": chat.ErrAnswerTooLong, "model_context_window_exceeded": chat.ErrInputTooLong} {
		server, _ := fakeMessages(t, func(_ int, _ map[string]any, w http.ResponseWriter) {
			_, _ = w.Write([]byte(message(stop, "Partial")))
		})
		p := &Anthropic{Key: "k", Model: "test-model", Base: server.URL, Client: server.Client()}
		if _, err := p.Complete(context.Background(), hello(), nil, false); !errors.Is(err, want) {
			t.Errorf("%s: %v", stop, err)
		}
	}
}

// A request refused for its thinking blocks is retried without them once,
// and the later turns of the same run leave those blocks out at once.
func TestAnthropicRemembersRefusedThinkingForTheRun(t *testing.T) {
	server, bodies := fakeMessages(t, func(_ int, body map[string]any, w http.ResponseWriter) {
		raw, _ := json.Marshal(body["messages"])
		if strings.Contains(string(raw), "old-sig") {
			w.WriteHeader(400)
			_, _ = w.Write([]byte(`{"type":"error","error":{"type":"invalid_request_error","message":"Invalid signature in thinking block"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"id":"m","type":"message","role":"assistant","model":"test-model","stop_reason":"end_turn","content":[{"type":"thinking","thinking":"","signature":"new-sig"},{"type":"text","text":"Done."}],"usage":{"input_tokens":1,"output_tokens":1}}`))
	})
	history := transcript()
	history[2].ThinkingBlocks = []json.RawMessage{json.RawMessage(`{"type":"thinking","thinking":"","signature":"old-sig"}`)}
	p := &Anthropic{Key: "k", Model: "test-model", Base: server.URL, Client: server.Client()}
	reply, err := p.Complete(context.Background(), history, nil, false)
	if err != nil || len(bodies()) != 2 {
		t.Fatalf("first turn: %v, %d calls", err, len(bodies()))
	}
	// The next turn of the run carries the new reply's block, which is sent.
	history = append(history, reply, chat.WireMessage{Role: "user", Content: "And then?"})
	if _, err := p.Complete(context.Background(), history, nil, false); err != nil {
		t.Fatal(err)
	}
	sent := bodies()
	if len(sent) != 3 {
		t.Fatalf("the next turn must make one call, got %d in all", len(sent))
	}
	raw, _ := json.Marshal(sent[2]["messages"])
	if strings.Contains(string(raw), "old-sig") || !strings.Contains(string(raw), "new-sig") {
		t.Fatalf("refused blocks are left out, new ones kept: %s", raw)
	}
}

func TestAnthropicDoesNotWaitOutALongRetryAfter(t *testing.T) {
	server, bodies := fakeMessages(t, func(_ int, _ map[string]any, w http.ResponseWriter) {
		w.Header().Set("retry-after", "90")
		w.WriteHeader(429)
		_, _ = w.Write([]byte(`{"type":"error","error":{"type":"rate_limit_error","message":"Number of requests has exceeded your rate limit"}}`))
	})
	p := &Anthropic{Key: "k", Model: "test-model", Base: server.URL, Client: server.Client()}
	_, err := p.Complete(context.Background(), hello(), nil, false)
	if err == nil || !strings.Contains(err.Error(), "Try again in about 90 seconds") || !strings.Contains(err.Error(), "rate limit") {
		t.Fatalf("%v", err)
	}
	if n := len(bodies()); n != 1 {
		t.Fatalf("a 90 second retry-after must not be waited for: %d calls", n)
	}

	// A short wait is still retried once.
	server, bodies = fakeMessages(t, func(n int, _ map[string]any, w http.ResponseWriter) {
		if n == 0 {
			w.Header().Set("retry-after-ms", "10")
			w.WriteHeader(429)
			_, _ = w.Write([]byte(`{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}`))
			return
		}
		_, _ = w.Write([]byte(message("end_turn", "OK")))
	})
	p = &Anthropic{Key: "k", Model: "test-model", Base: server.URL, Client: server.Client()}
	if got, err := p.Complete(context.Background(), hello(), nil, false); err != nil || got.Content != "OK" || len(bodies()) != 2 {
		t.Fatalf("%v %v %d", got, err, len(bodies()))
	}
}

func TestAnthropicErrorsSayWhatToDo(t *testing.T) {
	cases := []struct {
		name  string
		reply func(w http.ResponseWriter)
		want  string
	}{
		{"overloaded", func(w http.ResponseWriter) {
			w.Header().Set("retry-after-ms", "1")
			w.WriteHeader(529)
			_, _ = w.Write([]byte(`{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`))
		}, "Anthropic is overloaded right now (HTTP 529). Try again in a minute"},
		{"server error", func(w http.ResponseWriter) {
			w.Header().Set("retry-after-ms", "1")
			w.WriteHeader(500)
			_, _ = w.Write([]byte(`{"type":"error","error":{"type":"api_error","message":"Internal server error"}}`))
		}, "Anthropic is unavailable right now (HTTP 500). Try again in a minute"},
		{"unreadable answer", func(w http.ResponseWriter) {
			_, _ = w.Write([]byte(`{"id":"m","type":"message","content":[{"type":"te`))
		}, "Anthropic's answer was cut off. Try again"},
	}
	for _, c := range cases {
		server, _ := fakeMessages(t, func(_ int, _ map[string]any, w http.ResponseWriter) { c.reply(w) })
		p := &Anthropic{Key: "k", Model: "test-model", Base: server.URL, Client: server.Client()}
		if _, err := p.Complete(context.Background(), hello(), nil, false); err == nil || err.Error() != c.want {
			t.Errorf("%s: %v", c.name, err)
		}
	}
}

func TestEffortOfFollowsDatedIDs(t *testing.T) {
	c := newCatalogue()
	c.effort["model-a"] = true
	c.effort["model-b-20261001"] = false
	for model, want := range map[string][2]bool{
		"model-a":          {true, true},
		"model-a-20261101": {true, true},
		"model-a-latest":   {true, true},
		"model-b":          {false, true},
		"model-a-mini":     {false, false},
		"model-c":          {false, false},
	} {
		if ok, known := c.effortOf(model); ok != want[0] || known != want[1] {
			t.Errorf("%s: got %v %v, want %v", model, ok, known, want)
		}
	}
}

// After a restart the effort table is empty; the first call to a model reads
// the list once instead of sending it without effort.
func TestEffortForReadsTheListWhenItHasNotSeenTheModel(t *testing.T) {
	lists := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lists++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"type":"model","id":"model-a","display_name":"A","created_at":"2026-09-01T00:00:00Z","capabilities":{"effort":{"supported":true,"low":{"supported":true}}}}],"has_more":false}`))
	}))
	defer server.Close()
	s := &Service{models: newCatalogue(), anthropicURL: server.URL}
	spec := apiProviderByID("anthropic")
	if !s.effortFor(spec, server.URL, "k", "model-a-20261101") {
		t.Fatal("a dated id of a listed model takes its effort")
	}
	if !s.effortFor(spec, server.URL, "k", "model-a") || lists != 1 {
		t.Fatalf("the list is read once: %d", lists)
	}
	if s.effortFor(spec, server.URL, "k", "model-unlisted") {
		t.Fatal("an unlisted model gets no effort")
	}
}

// Turns of one role join into one message, and a text turn after text
// starts on a line of its own, so the person's last word (often a URL)
// does not run into the notice after it.
func TestAnthropicJoinsTurnsOnTheirOwnLine(t *testing.T) {
	_, out := anthropicMessages([]chat.WireMessage{
		{Role: "user", Content: "Watch https://books.example/a"},
		{Role: "user", Content: "System notice (not written by the user): it is Saturday"},
		{Role: "user", Content: "\nAlready on its own line"},
	}, false, false, nil)
	if len(out) != 1 || len(out[0].Content) != 3 {
		t.Fatalf("got %d messages", len(out))
	}
	var texts []string
	for _, b := range out[0].Content {
		texts = append(texts, b.OfText.Text)
	}
	if strings.Join(texts, "") != "Watch https://books.example/a\n\nSystem notice (not written by the user): it is Saturday\nAlready on its own line" {
		t.Errorf("joined text %q", texts)
	}
}
