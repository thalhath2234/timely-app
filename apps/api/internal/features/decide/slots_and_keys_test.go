package decide

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// With four calls in flight, smart search waited for a slot and started its
// call with under a second of its budget left; the call could only time out.
func TestCallThatWaitedTooLongForASlotIsNotStarted(t *testing.T) {
	block := make(chan struct{})
	var late atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		if strings.Contains(string(raw), "smart search") {
			late.Add(1)
			_, _ = w.Write([]byte(`{"answers":{"q":{"type":"noul","noul":0.9}}}`))
			return
		}
		<-block
		w.WriteHeader(503)
	}))
	defer srv.Close()
	c := NewClient(nil)
	c.TypeSafeURL = srv.URL
	s := New(nil, func(context.Context, string) (Keys, error) { return Keys{Enabled: true, TypeSafe: "ts-key-123"}, nil }, c)

	var wg sync.WaitGroup
	for i := range perUserCalls {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := oneYesNo()
			req.State = strings.Repeat("x", i+1) // four different requests
			_, _ = s.Ask(context.Background(), "u1", req)
		}()
	}
	time.Sleep(100 * time.Millisecond) // every slot is taken

	ctx, cancel := context.WithTimeout(context.Background(), minCallTime+200*time.Millisecond)
	defer cancel()
	time.AfterFunc(400*time.Millisecond, func() { close(block) }) // free with under a second left
	req := oneYesNo()
	req.State = "smart search"
	if _, err := s.Ask(ctx, "u1", req); !errors.Is(err, ErrOff) {
		t.Fatalf("err = %v, want the call left out", err)
	}
	wg.Wait()
	if late.Load() != 0 {
		t.Fatal("a call was started that had too little time left to answer")
	}

	// With time to spare, the same wait ends in a call.
	ctx2, cancel2 := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel2()
	if _, err := s.Ask(ctx2, "u1", req); err != nil || late.Load() != 1 {
		t.Fatalf("err = %v, calls = %d", err, late.Load())
	}
}

// A provider that quoted the refused key put it in the server log and in the
// Settings test's message.
func TestProviderErrorsNeverRepeatAKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		w.WriteHeader(500)
		_, _ = w.Write([]byte(`{"error":{"message":"bad key ` + key + ` echoed by provider; see Bearer abcdefgh12345678 and sk-or-standin-livegs-0001"}}`))
	}))
	defer srv.Close()
	c := NewClient(nil)
	c.TypeSafeURL = srv.URL
	c.OpenRouterURL = srv.URL
	_, _, err := c.Call(context.Background(), Keys{TypeSafe: "ts-key-123456", OpenRouter: "or-key-abcdef98765"}, wire{State: "x"})
	if err == nil {
		t.Fatal("want the refusal")
	}
	for _, secret := range []string{"ts-key-123456", "or-key-abcdef98765", "abcdefgh12345678", "sk-or-standin-livegs-0001"} {
		if strings.Contains(err.Error(), secret) {
			t.Fatalf("error repeats %q: %v", secret, err)
		}
	}
	if !strings.Contains(err.Error(), "echoed by provider") {
		t.Fatalf("the rest of the message is kept: %v", err)
	}
}

// The embedding model check's 409 repeated OpenRouter's text, and with it a
// quoted key, to Settings.
func TestHideKeys(t *testing.T) {
	got := HideKeys("openrouter embed: bad key or-live-key-0001 (also sk-or-v1-abcdef0123456789)", "or-live-key-0001")
	if strings.Contains(got, "or-live-key-0001") || strings.Contains(got, "sk-or-v1-abcdef0123456789") || !strings.Contains(got, "openrouter embed: bad key") {
		t.Fatalf("got %q", got)
	}
}
