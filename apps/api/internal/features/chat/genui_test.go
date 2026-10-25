package chat

import (
	"strings"
	"testing"
)

func TestReplyCardsOnlyForAppsThatDrawThem(t *testing.T) {
	if got := replyCards(false); got != "" {
		t.Fatalf("an app without reply cards got %q", got)
	}
	on := replyCards(true)
	for _, want := range []string{"```openui-lang", "root = Reply(", "TaskRow(taskId: string", "propose_changes"} {
		if !strings.Contains(on, want) {
			t.Errorf("reply-card prompt is missing %q", want)
		}
	}
}
