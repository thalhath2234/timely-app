package realtime

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Stream writes a server-sent event stream: hello first, then every event
// until the request ends or the subscription closes, with a keepalive
// comment every 25 seconds so proxies keep the connection open.
func Stream(ctx context.Context, w http.ResponseWriter, hello Event, events <-chan Event) {
	w.Header().Set("Content-Type", "text/event-stream")
	// no-transform keeps the web app's proxy (Next) from gzipping the stream,
	// which buffers it: browsers ask for gzip and then see no events at all.
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	if err := writeSSE(w, hello); err != nil {
		return
	}

	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-events:
			if !ok {
				return
			}
			if err := writeSSE(w, ev); err != nil {
				return
			}
		case <-ticker.C:
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
			flushWriter(w)
		}
	}
}

func writeSSE(w http.ResponseWriter, event Event) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.Type, payload); err != nil {
		return err
	}
	flushWriter(w)
	return nil
}

func flushWriter(w http.ResponseWriter) {
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
		return
	}
	_ = http.NewResponseController(w).Flush()
}
