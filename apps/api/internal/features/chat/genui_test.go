package chat

import (
	"strings"
	"testing"
)

func TestReplyCardsOnlyForAppsThatDrawThem(t *testing.T) {
	if got := replyCards(false, []Message{{Role: "assistant", Content: "Plain"}}); got != "" {
		t.Fatalf("an app without reply cards got %q", got)
	}
	carded := []Message{{Role: "user", Content: "Today?"}, {Role: "assistant", Content: "Here.\n\n```openui-lang\nroot = Reply([])\n```"}}
	if got := replyCards(false, carded); !strings.Contains(got, "plain text") || strings.Contains(got, "root = Reply(") {
		t.Fatalf("an app without reply cards in a conversation that had them got %q", got)
	}
	on := replyCards(true, carded)
	for _, want := range []string{"```openui-lang", "root = Reply(", "TaskRow(taskId: string", "propose_changes"} {
		if !strings.Contains(on, want) {
			t.Errorf("reply-card prompt is missing %q", want)
		}
	}
}
