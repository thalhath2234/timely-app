package decide

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"
)

// An answer that does not fit its question is dropped: a choice outside the
// options, a wrong type, a score off the levels, a confidence or yes/no
// probability outside 0..1. A choice that only differs in case reads as
// the option.
func TestAnswersMustFitTheirQuestion(t *testing.T) {
	p := plan{
		kinds:   map[string]string{"kind": typeChoice, "field": typeChoice, "role": typeChoice, "big": typeScore, "low": typeScore, "sure": typeScore, "typed": typeScore, "ok": typeScore, "yn": typeNoul},
		pairs:   map[string][]string{"kind": {"kind"}, "field": {"field"}, "role": {"role"}, "big": {"big"}, "low": {"low"}, "sure": {"sure"}, "typed": {"typed"}, "ok": {"ok"}, "yn": {"yn"}},
		levels:  map[string]int{"big": 6, "low": 6, "sure": 6, "typed": 6, "ok": 6},
		options: map[string][]string{"kind": {"deep", "admin"}, "field": {"yes", "no", "unknown"}, "role": {"none", "deadline", "start"}},
	}
	got, err := p.read([]byte(`{"answers":{
		"kind":{"type":"choice","choice":"meeting","confidence":0.9},
		"field":{"type":"choice","choice":"Yes","confidence":0.9},
		"role":{"type":"choice","choice":"due","confidence":0.9},
		"big":{"type":"score","score":42,"confidence":0.9},
		"low":{"type":"score","score":-3,"confidence":0.9},
		"sure":{"type":"score","score":2,"confidence":7},
		"typed":{"type":"choice","choice":"banana","confidence":0.99},
		"ok":{"type":"score","score":5.4,"confidence":0.8},
		"yn":{"type":"noul","noul":1.5}}}`))
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"kind", "role", "big", "low", "sure", "typed", "yn"} {
		if a, ok := got[id]; ok {
			t.Errorf("%s: an answer that does not fit was kept: %+v", id, a)
		}
	}
	if got["field"].Choice != "yes" {
		t.Errorf("'Yes' should read as the option 'yes', got %+v", got["field"])
	}
	if got["ok"].Level != 5 {
		t.Errorf("5.4 rounds to the top level, got %+v", got["ok"])
	}

	if _, err := p.read([]byte(`{"answers":{"kind":{"type":"choice","choice":"meeting","confidence":0.9}}}`)); !errors.Is(err, errNoAnswers) {
		t.Fatalf("an answer with nothing usable is a failed call, got %v", err)
	}
}

// What the person reads never carries the provider's own text: keys, org
// names, HTML or a blank line after a trailing newline.
func TestReasonNeverEchoesProviderText(t *testing.T) {
	refused := &StatusError{Provider: ProviderTypeSafe, Code: 401, Message: "Invalid key ts-standin-livegjt-0001 for org acme"}
	cases := map[string]struct {
		err  error
		want string
	}{
		"refused key":   {errors.Join(ErrOff, refused), "TypeSafe refused your key"},
		"html outage":   {errors.Join(ErrOff, &StatusError{Provider: ProviderOpenRouter, Code: 503, Message: "<html>Bad gateway</html>\n"}), "OpenRouter is unavailable"},
		"last provider": {errors.Join(ErrOff, errors.Join(refused, &StatusError{Provider: ProviderOpenRouter, Code: 402, Message: "Insufficient credits"})), "OpenRouter says your account is out of credit"},
		"timeout":       {errors.Join(ErrOff, context.DeadlineExceeded), "took too long"},
		"busy":          {ErrBusy, "busy with other requests"},
		"too big":       {&TooBigError{"decide: state for today is 37395 bytes; trim it below 32000"}, "too much to read"},
		"unreadable":    {errors.Join(ErrOff, errUnreadable), "could not read"},
		"refused saved": {ErrKeyRefused, "Replace it in Settings"},
		"cooling":       {errors.Join(ErrOff, ErrCooling, &StatusError{Provider: ProviderTypeSafe, Code: 429}), "limiting requests"},
	}
	for name, c := range cases {
		got := Reason(c.err)
		if !strings.Contains(got, c.want) {
			t.Errorf("%s: %q does not say %q", name, got, c.want)
		}
		for _, leak := range []string{"standin", "acme", "<", "decide:", "answered", "\n"} {
			if strings.Contains(got, leak) {
				t.Errorf("%s: %q leaks %q", name, got, leak)
			}
		}
	}
	if Reason(ErrOff) != "" {
		t.Fatal("plain off says nothing")
	}
}

func TestErrorMessageIsOneShortLine(t *testing.T) {
	msg := errorMessage([]byte(strings.Repeat("a", 199) + "é"))
	if !utf8.ValidString(msg) || utf8.RuneCountInString(msg) != 200 {
		t.Fatalf("cut inside a character: %q", msg)
	}
	if got := errorMessage([]byte("<html><body><h1>Bad gateway</h1></body></html>\n")); got != "Bad gateway" {
		t.Fatalf("markup and line breaks: %q", got)
	}
}

// The key check says when TypeSafe is down or slow instead of calling the
// key bad, and never shows the raw Go error or the endpoint.
func TestKeyCheckReason(t *testing.T) {
	for code, want := range map[int]string{401: "did not accept", 403: "did not accept", 402: "out of credit", 529: "could not check this key right now", 429: "could not check this key right now"} {
		ts := &fakeJev{status: code}
		_, c := newTest(t, Keys{}, ts, &fakeJev{})
		got := KeyCheckReason(Check(context.Background(), c, Keys{TypeSafe: "ts-key-123"}))
		if !strings.Contains(got, want) {
			t.Errorf("%d: %q", code, got)
		}
	}
	slow := &fakeJev{delay: time.Second, answer: yesAnswer(0.9)}
	_, c := newTest(t, Keys{}, slow, &fakeJev{})
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	got := KeyCheckReason(Check(ctx, c, Keys{TypeSafe: "ts-key-123"}))
	if !strings.Contains(got, "took too long") || strings.Contains(got, "http") {
		t.Fatalf("timeout: %q", got)
	}
}

// A fifth call while four are out waits for its time budget and then says
// the account is busy, not "off".
func TestBusySlotSaysBusy(t *testing.T) {
	ts := &fakeJev{delay: 600 * time.Millisecond, answer: yesAnswer(0.9)}
	s, _ := newTest(t, Keys{Enabled: true, TypeSafe: "ts-key-123"}, ts, &fakeJev{})
	var wg sync.WaitGroup
	for i := 0; i < perUserCalls; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := oneYesNo()
			req.State = strings.Repeat("x", i+1)
			_, _ = s.Ask(context.Background(), "u1", req)
		}()
	}
	for ts.hits.Load() < perUserCalls {
		time.Sleep(10 * time.Millisecond)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	_, err := s.Ask(ctx, "u1", oneYesNo())
	wg.Wait()
	if !errors.Is(err, ErrBusy) || !errors.Is(err, ErrOff) || Failed(err) {
		t.Fatalf("want busy (off, not failed), got %v", err)
	}
	if !strings.Contains(Reason(err), "busy") {
		t.Fatalf("reason %q", Reason(err))
	}
}

// A hung TypeSafe gets half the budget, so OpenRouter still answers in
// time; after that TypeSafe rests and each suggestion costs one call.
func TestSlowTypeSafeLeavesTimeForOpenRouter(t *testing.T) {
	ts, or := &fakeJev{delay: 2 * time.Second, answer: yesAnswer(0.9)}, &fakeJev{answer: yesAnswer(0.9)}
	s, c := newTest(t, Keys{Enabled: true, TypeSafe: "ts-key-123", OpenRouter: "or-key-123"}, ts, or)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	a, err := s.Ask(ctx, "u1", oneYesNo())
	if err != nil || a.Provider != ProviderOpenRouter {
		t.Fatalf("want OpenRouter's answer in time, got %q %v", a.Provider, err)
	}
	req := oneYesNo()
	req.State = "Buy bread"
	if _, err := s.Ask(context.Background(), "u1", req); err != nil {
		t.Fatal(err)
	}
	if ts.hits.Load() != 1 || or.hits.Load() != 2 {
		t.Fatalf("TypeSafe should rest after it hung: ts=%d or=%d", ts.hits.Load(), or.hits.Load())
	}
	// Settings → Test still asks TypeSafe.
	ctx2, cancel2 := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel2()
	_, _ = CheckWith(context.WithValue(ctx2, UserKey, "u1"), c, Keys{TypeSafe: "ts-key-123", OpenRouter: "or-key-123"})
	if ts.hits.Load() != 2 {
		t.Fatalf("Test must ask TypeSafe even while it rests: ts=%d", ts.hits.Load())
	}
}

func TestTypeSafeOutageRests(t *testing.T) {
	ts, or := &fakeJev{status: 503}, &fakeJev{answer: yesAnswer(0.9)}
	s, _ := newTest(t, Keys{Enabled: true, TypeSafe: "ts-key-123", OpenRouter: "or-key-123"}, ts, or)
	for i, state := range []string{"a", "b", "c"} {
		req := oneYesNo()
		req.State = state
		if _, err := s.Ask(context.Background(), "u1", req); err != nil {
			t.Fatalf("%d: %v", i, err)
		}
	}
	if ts.hits.Load() != 1 || or.hits.Load() != 3 {
		t.Fatalf("a 503 should be remembered: ts=%d or=%d", ts.hits.Load(), or.hits.Load())
	}
}

// After a 429 or 5xx from the last provider, the account waits (for the
// Retry-After when given) instead of calling again on every reload.
func TestCoolDownAfterRateLimit(t *testing.T) {
	ts := &fakeJev{status: 429, header: map[string]string{"Retry-After": "30"}}
	s, _ := newTest(t, Keys{Enabled: true, TypeSafe: "ts-key-123"}, ts, &fakeJev{})
	if _, err := s.Ask(context.Background(), "u1", oneYesNo()); !Failed(err) {
		t.Fatalf("want a failed call, got %v", err)
	}
	req := oneYesNo()
	req.State = "Reloaded"
	_, err := s.Ask(context.Background(), "u1", req)
	if ts.hits.Load() != 1 {
		t.Fatalf("a reload during the wait called again: %d calls", ts.hits.Load())
	}
	if !Failed(err) || !strings.Contains(Reason(err), "limiting requests") {
		t.Fatalf("the wait should read as the rate limit and count as failed: %v / %q", err, Reason(err))
	}
	s.mu.Lock()
	wait := time.Until(s.cool["u1"].until)
	s.mu.Unlock()
	if wait < 25*time.Second || wait > 31*time.Second {
		t.Fatalf("Retry-After 30 not honoured: %s", wait)
	}
	if _, err := s.Ask(context.Background(), "u2", req); ts.hits.Load() != 2 || err == nil {
		t.Fatal("another account must not wait")
	}
}

// Two identical requests at once (a double submit) share one call.
func TestIdenticalRequestsShareOneCall(t *testing.T) {
	ts := &fakeJev{delay: 200 * time.Millisecond, answer: yesAnswer(0.9)}
	s, _ := newTest(t, Keys{Enabled: true, TypeSafe: "ts-key-123"}, ts, &fakeJev{})
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = s.Ask(context.Background(), "u1", oneYesNo())
		}()
	}
	wg.Wait()
	if errs[0] != nil || errs[1] != nil || ts.hits.Load() != 1 {
		t.Fatalf("want one shared call, got %d calls (%v)", ts.hits.Load(), errs)
	}
}

// Work for a sensitive chat goes out private whichever helper asks.
func TestSensitiveContextIsPrivate(t *testing.T) {
	ts, or := &fakeJev{status: 529}, &fakeJev{answer: yesAnswer(0.9)}
	s, _ := newTest(t, Keys{Enabled: true, TypeSafe: "ts-key-123", OpenRouter: "or-key-123"}, ts, or)
	if _, err := s.Ask(WithSensitive(context.Background()), "u1", oneYesNo()); err != nil {
		t.Fatal(err)
	}
	if p, _ := or.last["provider"].(map[string]any); p["zdr"] != true {
		t.Fatalf("a sensitive chat's call was not private: %s", or.raw)
	}
}

func TestUnusableSavedKeySaysWhy(t *testing.T) {
	for keys, want := range map[Keys]error{
		{Enabled: true, TypeSafeRefused: true}:                          ErrKeyRefused,
		{Enabled: true, TypeSafeUnreadable: true}:                       ErrKeyUnreadable,
		{Enabled: false, TypeSafeRefused: true}:                         ErrOff,
		{Enabled: true}:                                                 ErrOff,
		{Enabled: true, TypeSafeRefused: true, OpenRouter: "or-key-12"}: nil,
	} {
		s, _ := newTest(t, keys, &fakeJev{}, &fakeJev{answer: yesAnswer(0.9)})
		_, err := s.Ask(context.Background(), "u1", oneYesNo())
		if err != want {
			t.Errorf("%+v: got %v, want %v", keys, err, want)
		}
		if Failed(err) {
			t.Errorf("%+v: nothing went out, so it is not a failed call", keys)
		}
	}
}

// A request the provider refuses every time is not tried again later.
func TestFailedSkipsPermanentRefusals(t *testing.T) {
	for code, want := range map[int]bool{400: false, 413: false, 422: false, 500: true, 402: true} {
		s, _ := newTest(t, Keys{Enabled: true, TypeSafe: "ts-key-123"}, &fakeJev{status: code}, &fakeJev{})
		_, err := s.Ask(context.Background(), "u1", oneYesNo())
		if Failed(err) != want {
			t.Errorf("%d: Failed = %v, want %v (%v)", code, !want, want, err)
		}
	}
}
