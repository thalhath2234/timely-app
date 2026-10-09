package decide

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// fakeJev plays one endpoint. answer builds the response from the request.
type fakeJev struct {
	status int
	hits   atomic.Int32
	last   map[string]any
	raw    []byte
	auth   string
	answer func(req map[string]any) map[string]any
}

func (f *fakeJev) server(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.hits.Add(1)
		f.auth = r.Header.Get("Authorization")
		f.raw, _ = io.ReadAll(r.Body)
		f.last = map[string]any{}
		_ = json.Unmarshal(f.raw, &f.last)
		if f.status != 0 && f.status != 200 {
			w.WriteHeader(f.status)
			_, _ = w.Write([]byte(`{"error":{"message":"nope"}}`))
			return
		}
		out := map[string]any{"model": "jev-1.13.0", "usage": map[string]int{"input_tokens": 10, "output_tokens": 0}}
		if f.answer != nil {
			out["answers"] = f.answer(f.last)
		} else {
			out["answers"] = map[string]any{}
		}
		_ = json.NewEncoder(w).Encode(out)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func newTest(t *testing.T, keys Keys, ts, or *fakeJev) (*Service, *Client) {
	t.Helper()
	c := NewClient(nil)
	c.TypeSafeURL = ts.server(t).URL
	c.OpenRouterURL = or.server(t).URL
	s := New(nil, func(context.Context, string) (Keys, error) { return keys, nil }, c)
	s.rand = func(n int) []int { // identity: keep the caller's order
		out := make([]int, n)
		for i := range out {
			out[i] = i
		}
		return out
	}
	return s, c
}

func yesAnswer(p float64) func(map[string]any) map[string]any {
	return func(req map[string]any) map[string]any {
		out := map[string]any{}
		for id := range req["questions"].(map[string]any) {
			out[id] = map[string]any{"type": "noul", "noul": p}
		}
		return out
	}
}

func oneYesNo() Request {
	return Request{Feature: "test", State: "Buy milk", Questions: map[string]Question{"q": YesNo("Is it shopping?", "yes", "no")}}
}

func TestOffMakesNoCall(t *testing.T) {
	for name, keys := range map[string]Keys{
		"no keys":    {Enabled: true},
		"switch off": {Enabled: false, TypeSafe: "ts-key-123", OpenRouter: "or-key-123"},
	} {
		t.Run(name, func(t *testing.T) {
			ts, or := &fakeJev{}, &fakeJev{}
			s, _ := newTest(t, keys, ts, or)
			if _, err := s.Ask(context.Background(), "u1", oneYesNo()); !errors.Is(err, ErrOff) {
				t.Fatalf("want ErrOff, got %v", err)
			}
			if ok, _ := s.Status(context.Background(), "u1"); ok {
				t.Fatal("status says available")
			}
			if ts.hits.Load()+or.hits.Load() != 0 {
				t.Fatal("a request left the server while off")
			}
		})
	}
	var nilService *Service
	if _, err := nilService.Ask(context.Background(), "u1", oneYesNo()); !errors.Is(err, ErrOff) {
		t.Fatalf("nil service: want ErrOff, got %v", err)
	}
}

func TestTypeSafeFirst(t *testing.T) {
	ts, or := &fakeJev{answer: yesAnswer(0.9)}, &fakeJev{answer: yesAnswer(0.1)}
	s, _ := newTest(t, Keys{Enabled: true, TypeSafe: "ts-key-123", OpenRouter: "or-key-123"}, ts, or)
	a, err := s.Ask(context.Background(), "u1", oneYesNo())
	if err != nil {
		t.Fatal(err)
	}
	if a.Provider != ProviderTypeSafe || or.hits.Load() != 0 {
		t.Fatalf("provider %q, openrouter hits %d", a.Provider, or.hits.Load())
	}
	if ts.auth != "Bearer ts-key-123" || ts.last["model"] != typeSafeModel {
		t.Fatalf("auth %q model %v", ts.auth, ts.last["model"])
	}
	if yes, ok := a.Yes("q", Route); !ok || !yes {
		t.Fatalf("want confident yes, got %v %v", yes, ok)
	}
	if _, has := ts.last["provider"]; has {
		t.Fatal("TypeSafe body carries OpenRouter routing fields")
	}
}

func TestFallbackToOpenRouter(t *testing.T) {
	for _, code := range []int{401, 429, 500, 529} {
		ts, or := &fakeJev{status: code}, &fakeJev{answer: yesAnswer(0.2)}
		s, c := newTest(t, Keys{Enabled: true, TypeSafe: "ts-key-123", OpenRouter: "or-key-123"}, ts, or)
		var rejected string
		c.Rejected = func(uid string) { rejected = uid }
		a, err := s.Ask(context.Background(), "u1", oneYesNo())
		if err != nil {
			t.Fatalf("%d: %v", code, err)
		}
		if a.Provider != ProviderOpenRouter || or.auth != "Bearer or-key-123" || or.last["model"] != routerModel {
			t.Fatalf("%d: provider %q auth %q model %v", code, a.Provider, or.auth, or.last["model"])
		}
		if or.last["model"] != "typesafe/jev-1.13" || or.last["state"] == nil || or.last["questions"] == nil {
			t.Fatalf("%d: OpenRouter body must match its Decisions API: %v", code, or.last)
		}
		if (code == 401) != (rejected == "u1") {
			t.Fatalf("%d: rejected hook got %q", code, rejected)
		}
	}
}

func TestBadRequestDoesNotFallBack(t *testing.T) {
	ts, or := &fakeJev{status: 422}, &fakeJev{answer: yesAnswer(0.2)}
	s, _ := newTest(t, Keys{Enabled: true, TypeSafe: "ts-key-123", OpenRouter: "or-key-123"}, ts, or)
	if _, err := s.Ask(context.Background(), "u1", oneYesNo()); !errors.Is(err, ErrOff) {
		t.Fatalf("want ErrOff, got %v", err)
	}
	if or.hits.Load() != 0 {
		t.Fatal("a 422 from TypeSafe went on to OpenRouter")
	}
}

func TestOpenRouterOnly(t *testing.T) {
	ts, or := &fakeJev{}, &fakeJev{answer: yesAnswer(0.9)}
	s, _ := newTest(t, Keys{Enabled: true, OpenRouter: "or-key-123"}, ts, or)
	if ok, p := s.Status(context.Background(), "u1"); !ok || p != ProviderOpenRouter {
		t.Fatalf("status %v %q", ok, p)
	}
	if _, err := s.Ask(context.Background(), "u1", oneYesNo()); err != nil {
		t.Fatal(err)
	}
	if ts.hits.Load() != 0 || or.hits.Load() != 1 {
		t.Fatalf("hits ts=%d or=%d", ts.hits.Load(), or.hits.Load())
	}
}

func TestChoiceOrderAndTwice(t *testing.T) {
	agree := true
	ts := &fakeJev{answer: func(req map[string]any) map[string]any {
		second := "home"
		if !agree {
			second = "work"
		}
		return map[string]any{
			"ws":    map[string]any{"type": "choice", "choice": "home", "confidence": 0.9},
			"ws__2": map[string]any{"type": "choice", "choice": second, "confidence": 0.7},
		}
	}}
	s, _ := newTest(t, Keys{Enabled: true, TypeSafe: "ts-key-123"}, ts, &fakeJev{})
	req := Request{Feature: "test", State: "Fix the sink", Questions: map[string]Question{
		"ws": Choice("Which workspace?", Option{Name: "work"}, Option{Name: "home", Description: "Chores"}, Option{Name: "club"}).Twice(),
	}}
	a, err := s.Ask(context.Background(), "u1", req)
	if err != nil {
		t.Fatal(err)
	}
	// Options go out in the order given (identity shuffle here), then reversed.
	if !bytes.Contains(ts.raw, []byte(`"criteria":{"work":null,"home":"Chores","club":null}`)) ||
		!bytes.Contains(ts.raw, []byte(`"criteria":{"club":null,"home":"Chores","work":null}`)) {
		t.Fatalf("criteria order not kept: %s", ts.raw)
	}
	if got, ok := a.Choice("ws", Prefill); !ok || got != "home" {
		t.Fatalf("agreeing orders: got %q %v", got, ok)
	}
	if raw, _ := a.Raw("ws"); raw.Confidence != 0.7 {
		t.Fatalf("confidence should be the lower of the two, got %v", raw.Confidence)
	}
	agree = false
	req.State = "Fix the sink again" // skip the cache
	a, err = s.Ask(context.Background(), "u1", req)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := a.Choice("ws", Flag); ok {
		t.Fatal("disagreeing orders must not give an answer")
	}
}

func TestScoreAndYesNoConfidence(t *testing.T) {
	ts := &fakeJev{answer: func(map[string]any) map[string]any {
		return map[string]any{
			"effort": map[string]any{"type": "score", "score": 1.6, "confidence": 0.65},
			"high":   map[string]any{"type": "score", "score": 9.0, "confidence": 0.9},
			"unsure": map[string]any{"type": "noul", "noul": 0.6},
		}
	}}
	s, _ := newTest(t, Keys{Enabled: true, TypeSafe: "ts-key-123"}, ts, &fakeJev{})
	a, err := s.Ask(context.Background(), "u1", Request{Feature: "test", State: "x", Questions: map[string]Question{
		"effort": Score("How much?", "small", "medium", "large"),
		"high":   Score("How much?", "small", "large"),
		"unsure": YesNo("Is it?", "yes", "no"),
	}})
	if err != nil {
		t.Fatal(err)
	}
	if l, ok := a.Level("effort", Prefill); !ok || l != 2 {
		t.Fatalf("1.6 should round to level 2, got %d %v", l, ok)
	}
	if l, _ := a.Level("high", Prefill); l != 1 {
		t.Fatalf("score past the top must clamp to the last level, got %d", l)
	}
	if _, ok := a.Yes("unsure", Flag); ok {
		t.Fatal("p=0.6 has confidence 0.2 and must not pass a 0.5 threshold")
	}
	if _, ok := a.Choice("effort", 0); ok {
		t.Fatal("a score answer must not read as a choice")
	}
}

func TestCacheAndLimits(t *testing.T) {
	ts := &fakeJev{answer: yesAnswer(0.9)}
	s, _ := newTest(t, Keys{Enabled: true, TypeSafe: "ts-key-123"}, ts, &fakeJev{})
	for i := 0; i < 3; i++ {
		if _, err := s.Ask(context.Background(), "u1", oneYesNo()); err != nil {
			t.Fatal(err)
		}
	}
	if ts.hits.Load() != 1 {
		t.Fatalf("identical questions should be cached, got %d calls", ts.hits.Load())
	}
	if _, err := s.Ask(context.Background(), "u2", oneYesNo()); err != nil || ts.hits.Load() != 2 {
		t.Fatalf("another account must not share the cache: %v, %d calls", err, ts.hits.Load())
	}
	big := Request{Feature: "test", State: strings.Repeat("x", maxStateBytes+10), Questions: oneYesNo().Questions}
	if _, err := s.Ask(context.Background(), "u1", big); err == nil || errors.Is(err, ErrOff) {
		t.Fatalf("oversized state must be a programming error, got %v", err)
	}
	one := Request{Feature: "test", State: "x", Questions: map[string]Question{"c": Choice("Which?", Option{Name: "only"})}}
	if _, err := s.Ask(context.Background(), "u1", one); err == nil {
		t.Fatal("a choice with one option must be refused")
	}
}

func TestCheck(t *testing.T) {
	ts := &fakeJev{answer: yesAnswer(0.9)}
	_, c := newTest(t, Keys{}, ts, &fakeJev{})
	if err := Check(context.Background(), c, Keys{TypeSafe: "ts-key-123"}); err != nil {
		t.Fatal(err)
	}
	bad := &fakeJev{status: 401}
	_, c = newTest(t, Keys{}, bad, &fakeJev{})
	if err := Check(context.Background(), c, Keys{TypeSafe: "ts-key-123"}); err == nil {
		t.Fatal("a refused key must fail the check")
	}

	// The Settings test follows the usual order and names who answered.
	or := &fakeJev{answer: yesAnswer(0.9)}
	_, c = newTest(t, Keys{}, &fakeJev{status: 503}, or)
	provider, err := CheckWith(context.Background(), c, Keys{TypeSafe: "ts-key-123", OpenRouter: "or-key-123"})
	if err != nil || provider != ProviderOpenRouter {
		t.Fatalf("provider %q err %v", provider, err)
	}
	if _, isMap := or.last["state"].(map[string]any); !isMap {
		t.Fatalf("Jev's state must be an object, got %T", or.last["state"])
	}
}

func TestPrivateAsksOpenRouterForZeroRetention(t *testing.T) {
	ts, or := &fakeJev{status: 529}, &fakeJev{answer: yesAnswer(0.9)}
	s, _ := newTest(t, Keys{Enabled: true, TypeSafe: "ts-key-123", OpenRouter: "or-key-123"}, ts, or)
	req := oneYesNo()
	req.Private = true
	if _, err := s.Ask(context.Background(), "u1", req); err != nil {
		t.Fatal(err)
	}
	if _, sent := ts.last["provider"]; sent {
		t.Fatalf("TypeSafe got OpenRouter routing: %s", ts.raw)
	}
	provider, _ := or.last["provider"].(map[string]any)
	if provider["zdr"] != true {
		t.Fatalf("private call not limited to zero-retention endpoints: %s", or.raw)
	}
	req.Private = false
	req.State = "Buy bread" // a new request, not the cached one
	if _, err := s.Ask(context.Background(), "u1", req); err != nil {
		t.Fatal(err)
	}
	if _, sent := or.last["provider"]; sent {
		t.Fatalf("an ordinary call sent routing: %s", or.raw)
	}
}
