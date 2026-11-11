package chat

import (
	"context"
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/agent"
)

// workerNoticePrefixes reads egress.NOTICE_PREFIXES from the worker's
// source: how the exfiltration rule finds Timely's paragraphs in a stored
// user message.
func workerNoticePrefixes(t *testing.T) []string {
	t.Helper()
	src, err := os.ReadFile("../../../../agent/timely_agent/plugins/timely_gate/egress.py")
	if err != nil {
		t.Fatal(err)
	}
	block := regexp.MustCompile(`(?s)NOTICE_PREFIXES = \((.*?)\n\)`).FindSubmatch(src)
	if block == nil {
		t.Fatal("egress.py has no NOTICE_PREFIXES")
	}
	out := []string{}
	for _, m := range regexp.MustCompile(`"((?:[^"\\]|\\.)*)"`).FindAllSubmatch(block[1], -1) {
		out = append(out, string(m[1]))
	}
	return out
}

// Every paragraph Timely adds to a turn's message or a history seed starts
// with a prefix the worker's exfiltration rule knows, so it reads them as
// the person's data in stored turns (run.start.private_context covers the
// current one).
func TestTurnNoticesStartWithAWorkerPrefix(t *testing.T) {
	prefixes := workerNoticePrefixes(t)
	known := func(text string) bool {
		for _, p := range prefixes {
			if strings.HasPrefix(text, p) {
				return true
			}
		}
		return false
	}
	catalog := agent.Catalog{"get_context": agent.Tool{Name: "get_context", Call: func(context.Context, string, json.RawMessage) (any, error) {
		return map[string]any{"workspaces": []string{"Work"}}, nil
	}}}
	s := &Service{}
	archive := message("assistant", "Previous changes")
	archive.Kind = "archive"
	archive.Steps = []Step{{Tool: "create_task", Summary: "Buy milk", Status: "done"}}
	cut := message("assistant", "Drafting")
	cut.Cut = true
	done := message("assistant", "Applied")
	done.Kind = "receipt"
	done.Continue = "the rest"
	parts := []string{
		imageNotice(&ImageReview{Text: "Receipt"}),
		chipsNotice(nil, nil),
		s.currentContext(context.Background(), catalog, "u1", time.UTC),
		s.tagNotice(context.Background(), "u1", []string{"bot_1"}),
		continueNotice("the rest", nil),
	}
	parts = append(parts, sinceLastTurn([]Message{message("user", "Plan"), notice("Done."), archive, cut, done, message("user", "More")})...)
	for _, m := range historySeed([]Message{message("user", "Plan"), notice("Done."), message("assistant", "Here.")}) {
		if m["content"] != "Plan" && m["content"] != "Here." {
			parts = append(parts, m["content"])
		}
	}
	for _, part := range parts {
		if part == "Plan" || part == "More" {
			continue // the person's own words
		}
		if !known(part) {
			t.Errorf("Timely paragraph %.80q starts with no prefix the worker knows (%q)", part, prefixes)
		}
	}
}
