package provider

import (
	"strings"
	"testing"
)

func TestBoardProgramFindsTheProgram(t *testing.T) {
	program := "root = Panel(\"Late\", [list])\nlate = @Data({source: \"tasks\", overdue: true})\nlist = List(@Each(late.rows, \"t\", TaskRow(t.id, t.title)))"
	for _, answer := range []string{
		program,
		"```openui-lang\n" + program + "\n```",
		"Here is your card:\n\n```\n" + program + "\n```\nEnjoy!",
		"Sure.\n" + program,
	} {
		got, err := boardProgram(answer)
		if err != nil {
			t.Fatalf("%q: %v", answer, err)
		}
		if got != program {
			t.Fatalf("got %q", got)
		}
	}
	if _, err := boardProgram("root = Reply([c])"); err == nil {
		t.Error("want an error without a Panel root")
	}
	if _, err := boardProgram("root = Panel(\"x\", [])\n" + strings.Repeat("a = 1\n", 2000)); err == nil {
		t.Error("want an error for an oversized program")
	}
}

func TestDashboardCardMessages(t *testing.T) {
	req := dashboardCardRequest{Prompt: "overdue client work", Today: "2026-10-28"}
	messages := dashboardCardMessages(req, testVocab())
	if len(messages) != 2 || messages[0].Content != boardPrompt {
		t.Fatalf("messages = %+v", messages)
	}
	user := messages[1].Content
	for _, want := range []string{"Wednesday 2026-10-28", "Projects: Timely", "Words: overdue client work"} {
		if !strings.Contains(user, want) {
			t.Errorf("user message lacks %q:\n%s", want, user)
		}
	}

	req.Current = "root = Panel(\"Late\", [])"
	req.Prompt = "make it a chart"
	user = dashboardCardMessages(req, testVocab())[1].Content
	if !strings.Contains(user, "<program>\nroot = Panel(\"Late\", [])\n</program>") || !strings.Contains(user, "Change it: make it a chart") {
		t.Errorf("a change should carry the current program:\n%s", user)
	}
}

func TestBoardPromptIsEmbedded(t *testing.T) {
	if !strings.Contains(boardPrompt, "@Data(") || !strings.Contains(boardPrompt, "Panel(") {
		t.Fatal("board_prompt.txt is missing or stale; run make gen-genui-prompt")
	}
}
