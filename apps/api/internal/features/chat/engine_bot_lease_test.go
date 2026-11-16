package chat

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A Run once of a browser step takes the browser lease, as a tick's browser
// call does at its gate, and lets it go when it ends. While a chat holds the
// browser the step does not run: no bot.run goes out and the card reads Not
// run with "Browser busy" on the Bot thread.
func TestIntegrationBotContinuationTakesTheBrowserLease(t *testing.T) {
	w, s := newBotDBWorld(t)
	createBot(t, s, testBot("bot_lease"))

	// A chat holds the browser: Run once runs nothing.
	w.kit.fixture("BUSY", parkRead, map[string]any{"fake": "done", "silent": true})
	runTick(t, w.a, "user-a", tickInput(testBot("bot_lease"), "bchk_lease1", "BUSY"))
	thread := botThreadOf(t, s, "bot_lease")
	h := thread.HostRequest
	w.a.lease.AcquireChat("user-a", "run_chat")
	n := len(w.kit.received("bot.run"))
	if code, body := answerCard(t, s, thread.ID, h.RequestID, hostOnce); code != 200 {
		t.Fatalf("run once: %d %s", code, body)
	}
	thread = waitThread(t, s, thread.ID, "not run", func(c Conversation) bool { return c.Status == "idle" && c.AgentRunID == "" })
	if c := lastHost(thread); c == nil || c.Outcome != hostNotRun {
		t.Fatalf("card %+v", c)
	}
	if last := lastMessage(thread); !strings.Contains(last.Content, "Browser busy") {
		t.Fatalf("reply %+v", last)
	}
	if len(w.kit.received("bot.run")) != n || len(w.kit.ran()) != 0 {
		t.Fatal("a browser step ran while a chat held the browser")
	}
	if h := w.a.lease.Holder("user-a"); h != ChatHolder("run_chat") {
		t.Fatalf("holder %+v", h)
	}
	w.a.lease.Release("user-a", ChatHolder("run_chat"))

	// The browser is free: the continuation holds it while it runs, and lets
	// it go after.
	w.kit.fixture("FREE", parkRead, map[string]any{"fake": "done", "silent": true})
	runTick(t, w.a, "user-a", tickInput(testBot("bot_lease"), "bchk_lease2", "FREE"))
	thread = botThreadOf(t, s, "bot_lease")
	h = thread.HostRequest
	if !h.pending() {
		t.Fatalf("no second card: %s", thread.Status)
	}
	w.kit.fixture("person approved", map[string]any{"fake": "until", "file": "go"}, parkRead, map[string]any{"fake": "done", "silent": true})
	if code, body := answerCard(t, s, thread.ID, h.RequestID, hostOnce); code != 200 {
		t.Fatalf("run once: %d %s", code, body)
	}
	want := BotHolder("bchk_lease2" + botContSep + h.RequestID)
	deadline := time.Now().Add(15 * time.Second)
	for w.a.lease.Holder("user-a") != want {
		if time.Now().After(deadline) {
			t.Fatalf("the continuation never took the browser: %+v", w.a.lease.Holder("user-a"))
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := os.WriteFile(filepath.Join(w.kit.dir, "go"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	thread = waitThread(t, s, thread.ID, "ran", func(c Conversation) bool { return c.Status == "idle" && c.AgentRunID == "" })
	if c := lastHost(thread); c == nil || c.Outcome != hostRan {
		t.Fatalf("card %+v", c)
	}
	deadline = time.Now().Add(5 * time.Second)
	for w.a.lease.Busy("user-a") {
		if time.Now().After(deadline) {
			t.Fatalf("the browser was kept: %+v", w.a.lease.Holder("user-a"))
		}
		time.Sleep(10 * time.Millisecond)
	}
}
