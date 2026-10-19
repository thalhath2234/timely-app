package realtime

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
)

// The web app reaches the API through Next, which gzips responses unless told
// not to; a gzipped event stream is buffered and never reaches the browser.
func TestStreamAsksProxiesNotToCompress(t *testing.T) {
	rec := httptest.NewRecorder()
	events := make(chan Event)
	close(events)
	Stream(context.Background(), rec, Event{Type: "hello", Kind: "sheet", ID: "sht_1"}, events)
	if got := rec.Header().Get("Cache-Control"); !strings.Contains(got, "no-transform") {
		t.Fatalf("Cache-Control = %q, want no-transform", got)
	}
	if body := rec.Body.String(); !strings.HasPrefix(body, "event: hello\n") {
		t.Fatalf("stream should open with hello, got %q", body)
	}
}
