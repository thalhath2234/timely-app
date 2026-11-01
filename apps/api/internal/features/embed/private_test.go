package embed

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"timely-api/internal/features/decide"
)

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestQueryNeverEmbedsAPrivateChatsSearch(t *testing.T) {
	sent := 0
	i := &indexer{
		http:    &http.Client{Transport: roundTrip(func(*http.Request) (*http.Response, error) { sent++; return nil, errors.New("offline") })},
		resolve: func(string) (string, string) { return "sk-or-test", "" },
	}
	if _, err := i.Query(decide.WithSensitive(context.Background()), "user", "Dr. Alice Moore cardiology", 10, nil); !errors.Is(err, ErrDisabled) {
		t.Fatalf("err = %v, want ErrDisabled", err)
	}
	if sent != 0 {
		t.Fatalf("%d embedding requests sent for a private chat", sent)
	}
	// An ordinary search still goes out.
	if _, err := i.Query(context.Background(), "user", "dentist", 10, nil); err == nil || sent != 1 {
		t.Fatalf("ordinary search: err %v, %d requests", err, sent)
	}
}
