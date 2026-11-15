package chat

import (
	"context"
	"testing"

	"timely-api/internal/features/agent"
)

// Phase 5, review round 7: a read-only line Auto's allowlist accepts is a
// read for item 6, like read_file. Every terminal result taints the chat, so
// without this only the first command in a chat ran without a card.
func TestAutoRunsReadOnlyLinesAfterOutsideContent(t *testing.T) {
	ctx := context.Background()
	for _, local := range []bool{true, false} {
		st := baseState(agent.Auto)
		st.tainted, st.taintedLocal = true, local
		for _, c := range []string{"ls", "cat notes.md", "git status", "ls -la | grep notes"} {
			d, _ := decideHost(ctx, askOf("terminal", map[string]any{"command": c}), st)
			if d.verdict != "allow" || d.by != "auto" {
				t.Errorf("%q after outside content (local %v): %s (%s)", c, local, d.verdict, d.reason)
			}
		}
		// what is off the list is held as before
		for _, c := range []string{"touch x", "echo hi > notes.md", "cat .env", "cat /etc/passwd"} {
			d, _ := decideHost(ctx, askOf("terminal", map[string]any{"command": c}), st)
			if d.verdict != "approve" {
				t.Errorf("%q after outside content (local %v): %s, want a card", c, local, d.verdict)
			}
		}
		// Supervised is unchanged: it asks, and item 6 holds
		sup := st
		sup.mode = agent.Supervised
		d, _ := decideHost(ctx, askOf("terminal", map[string]any{"command": "ls"}), sup)
		if d.verdict != "approve" || d.card.CriticalItem != agent.CriticalTainted {
			t.Errorf("supervised ls after outside content: %s item %d", d.verdict, d.card.CriticalItem)
		}
	}
}
