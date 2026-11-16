package chat

import (
	"context"
	"testing"
	"time"

	"timely-api/internal/features/bots"
)

// StopBot (the Bot paused or deleted) ends its live tick bots.ClassStopped,
// never a failure; the worker's own "stopped" for any other reason keeps its
// old mapping.
func TestBotAgentStopBotEndsStopped(t *testing.T) {
	w := newBotWorld(t, nil)
	w.kit.fixture("HANG", map[string]any{"fake": "hang"})
	done := make(chan bots.AgentResult, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		res, err := w.a.Run(ctx, "user-a", tickInput(testBot("bot_hang"), "bchk_hang", "HANG"))
		if err != nil {
			t.Errorf("run: %v", err)
		}
		done <- res
	}()
	deadline := time.Now().Add(15 * time.Second)
	for len(w.kit.received("bot.run")) == 0 {
		if time.Now().After(deadline) {
			t.Fatal("no bot.run")
		}
		time.Sleep(10 * time.Millisecond)
	}
	w.a.StopBot("user-b", "bot_hang") // another person's Bot of that id: untouched
	w.a.StopBot("user-a", "bot_other")
	time.Sleep(100 * time.Millisecond)
	select {
	case res := <-done:
		t.Fatalf("stopped by another Bot's stop: %+v", res)
	default:
	}
	w.a.StopBot("user-a", "bot_hang")
	select {
	case res := <-done:
		if res.ErrorClass != bots.ClassStopped {
			t.Fatalf("result %+v", res)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("the tick did not end")
	}
	if stops := w.kit.received("run.stop"); len(stops) != 1 || str(stops[0], "reason") != botStopReason {
		t.Fatalf("stops %+v", stops)
	}
	if got := botClass("stopped", false); got != bots.ClassUnreachable {
		t.Fatalf("another stop maps to %q", got)
	}
}
