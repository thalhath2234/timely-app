package provider

import (
	"strings"
	"testing"

	"timely-api/internal/features/sheet"
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
	messages := dashboardCardMessages(req, testVocab(), nil)
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
	user = dashboardCardMessages(req, testVocab(), nil)[1].Content
	if !strings.Contains(user, "<program>\nroot = Panel(\"Late\", [])\n</program>") || !strings.Contains(user, "Change it: make it a chart") {
		t.Errorf("a change should carry the current program:\n%s", user)
	}
	if strings.Contains(user, "live block") {
		t.Errorf("a dashboard card is not told it sits in a doc:\n%s", user)
	}

	req.Place = "doc"
	if user = dashboardCardMessages(req, testVocab(), nil)[1].Content; !strings.Contains(user, "live block in a doc") || !strings.Contains(user, "leave the size out") {
		t.Errorf("a live block is told it takes the doc's width:\n%s", user)
	}
}

func TestDashboardCardMessagesListSheets(t *testing.T) {
	req := dashboardCardRequest{Prompt: "spending per category", Today: "2026-10-28", Place: "doc"}
	tab := func(name string, rows int, columns ...string) sheet.CellsTab {
		out := sheet.CellsTab{Name: name, Rows: rows}
		for _, column := range columns {
			name, numbers := strings.CutSuffix(column, "#")
			out.Columns = append(out.Columns, struct {
				Name    string `json:"name"`
				Numbers bool   `json:"numbers"`
			}{name, numbers})
		}
		return out
	}
	sheets := []sheetBrief{
		{Title: "Budget 2026", Tabs: []sheet.CellsTab{tab("October", 24, "Date", "Category", "Amount#"), tab("Empty", 0)}},
		{Title: "  ", Tabs: []sheet.CellsTab{tab("Sheet 1", 3, "A#")}},
		{Title: "Blank", Tabs: []sheet.CellsTab{tab("Sheet 1", 0, "A")}},
	}
	user := dashboardCardMessages(req, testVocab(), sheets)[1].Content
	want := "The person's sheets, for @Cells (each tab with its columns; # marks columns of numbers):\n- \"Budget 2026\"\n  - tab \"October\", 24 rows: Date, Category, Amount #\n"
	if !strings.Contains(user, want) {
		t.Errorf("user message lacks the sheets:\n%s", user)
	}
	for _, skip := range []string{"Empty", "Blank", "Sheet 1"} {
		if strings.Contains(user, skip) {
			t.Errorf("an empty tab, an empty sheet or a sheet with no name is left out (%s):\n%s", skip, user)
		}
	}
	if user = dashboardCardMessages(req, testVocab(), nil)[1].Content; strings.Contains(user, "sheets") {
		t.Errorf("no sheets, no sheets line:\n%s", user)
	}
}

func TestBoardPromptIsEmbedded(t *testing.T) {
	if !strings.Contains(boardPrompt, "@Data(") || !strings.Contains(boardPrompt, "Panel(") {
		t.Fatal("board_prompt.txt is missing or stale; run make gen-genui-prompt")
	}
}
