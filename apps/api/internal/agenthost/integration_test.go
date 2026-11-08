package agenthost

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestIntegrationRealWorkerHandshake runs the real Python worker
// (apps/agent/timely_agent/boot.py) through prepare -> render-account ->
// spawn -> hello -> ready -> shutdown. It is skipped unless TIMELY_AGENT_TEST_RUNTIME names the runtime,
// in any form TIMELY_AGENT_RUNTIME accepts ("dev" means the dev default:
// apps/agent found above this package). The agent home goes under
// $HOME/.cache/timely-agent-test, never ~/.hermes. No model is called.
//
//	TIMELY_AGENT_TEST_RUNTIME=dev go test ./internal/agenthost -run TestIntegrationRealWorker -count=1 -v
func TestIntegrationRealWorkerHandshake(t *testing.T) {
	value := strings.TrimSpace(os.Getenv("TIMELY_AGENT_TEST_RUNTIME"))
	if value == "" {
		t.Skip("set TIMELY_AGENT_TEST_RUNTIME to run the real agent worker")
	}
	if value == "dev" {
		value = ""
	}
	wd, _ := os.Getwd()
	rt, err := ResolveRuntime(value, wd)
	if err != nil {
		t.Fatal(err)
	}
	log := newTestLog(t)
	exits := make(chan ExitInfo, 4)
	sup := New(Config{
		Root:          testRoot(t),
		Runtime:       rt,
		RenderAccount: true,
		HelloTimeout:  60 * time.Second, // a cold first import is slower than the 20 s default
		Logf:          log.logf,
		OnExit:        func(e ExitInfo) { exits <- e },
	})
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	w, err := sup.Ensure(ctx, "integration-account")
	if err != nil {
		_ = sup.Shutdown(ctx)
		t.Fatalf("Ensure: %v", err)
	}
	ready := w.Ready()
	t.Logf("ready: hermes %s, %d tools, plugins %v", ready.HermesTag, len(ready.Tools), ready.PluginsLoaded)
	if !ready.SelfTest.OK || ready.HermesTag == "" {
		t.Errorf("ready = %+v", ready)
	}
	home := w.Home()
	if !strings.HasPrefix(home, sup.Layout().Accounts()+string(filepath.Separator)) {
		t.Errorf("home %s outside the test root", home)
	}
	if err := sup.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case exit := <-exits:
		if exit.Crashed || exit.Reason != "shutdown" {
			t.Errorf("exit %+v", exit)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("no exit after shutdown")
	}
	waitGone(t, w.PID())
}
