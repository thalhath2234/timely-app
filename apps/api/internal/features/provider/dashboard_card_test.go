package provider

import (
	"fmt"
	"strings"
	"testing"

	"timely-api/internal/features/sheet"
	"timely-api/internal/richtext"
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
	messages := dashboardCardMessages(req, testVocab(), nil, nil)
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
	user = dashboardCardMessages(req, testVocab(), nil, nil)[1].Content
	if !strings.Contains(user, "<program>\nroot = Panel(\"Late\", [])\n</program>") || !strings.Contains(user, "Change it: make it a chart") {
		t.Errorf("a change should carry the current program:\n%s", user)
	}
	if strings.Contains(user, "live block") {
		t.Errorf("a dashboard card is not told it sits in a doc:\n%s", user)
	}

	req.Place = "doc"
	if user = dashboardCardMessages(req, testVocab(), nil, nil)[1].Content; !strings.Contains(user, "live block in a doc") || !strings.Contains(user, "leave the size out") {
		t.Errorf("a live block is told it takes the doc's width:\n%s", user)
	}
}

func TestDashboardCardMessagesListSheets(t *testing.T) {
	req := dashboardCardRequest{Prompt: "spending per category", Today: "2026-10-28", Place: "doc"}
	tab := func(name string, rows int, columns ...string) sheet.CellsTab {
		out := sheet.CellsTab{Name: name, Rows: rows}
		// "Category=Groceries|Rent" lists a column's values.
		for _, column := range columns {
			column, values, _ := strings.Cut(column, "=")
			name, numbers := strings.CutSuffix(column, "#")
			each := sheet.CellsColumn{Name: name, Numbers: numbers}
			if values != "" {
				each.Values = strings.Split(values, "|")
			}
			out.Columns = append(out.Columns, each)
		}
		return out
	}
	sheets := []sheetBrief{
		{Title: "Budget 2026", Tabs: []sheet.CellsTab{tab("October", 24, "Date", `Category=Groceries|Bills, "home"`, "Amount#"), tab("Empty", 0)}},
		{Title: "  ", Tabs: []sheet.CellsTab{tab("Sheet 1", 3, "A#")}},
		{Title: "Blank", Tabs: []sheet.CellsTab{tab("Sheet 1", 0, "A")}},
	}
	user := dashboardCardMessages(req, testVocab(), sheets, nil)[1].Content
	want := "The person's sheets, for @Cells (each tab with its columns; # marks columns of numbers; [...] lists the values a column of text holds, written as is must write them):\n- \"Budget 2026\"\n  - tab \"October\", 24 rows: Date, Category [\"Groceries\", \"Bills, \\\"home\\\"\"], Amount #\n"
	if !strings.Contains(user, want) {
		t.Errorf("user message lacks the sheets:\n%s", user)
	}
	for _, skip := range []string{"Empty", "Blank", "Sheet 1"} {
		if strings.Contains(user, skip) {
			t.Errorf("an empty tab, an empty sheet or a sheet with no name is left out (%s):\n%s", skip, user)
		}
	}
	if user = dashboardCardMessages(req, testVocab(), nil, nil)[1].Content; strings.Contains(user, "sheets") {
		t.Errorf("no sheets, no sheets line:\n%s", user)
	}
}

func TestDashboardCardMessagesListChecklists(t *testing.T) {
	req := dashboardCardRequest{Prompt: "my shopping list", Today: "2026-10-30"}
	items := []richtext.ChecklistItem{{Item: 0, Text: "Onion"}, {Item: 1, Text: "Milk", Done: true}, {Item: 2, Text: "Eggs, a dozen"}}
	for i := 3; i < dashboardCardItems+5; i++ {
		items = append(items, richtext.ChecklistItem{Item: i, Text: fmt.Sprintf("Item %d", i)})
	}
	user := dashboardCardMessages(req, testVocab(), nil, []checklistBrief{{Title: "Shopping list", Items: items}})[1].Content
	want := "The person's checklists, for @Checklist (each doc with its tick-box items; [x] marks a ticked one):\n- \"Shopping list\", 17 items, 1 ticked: \"Onion\", [x] \"Milk\", \"Eggs, a dozen\", \"Item 3\""
	if !strings.Contains(user, want) || !strings.Contains(user, "\"Item 11\", … 5 more\n") || strings.Contains(user, "Item 12") {
		t.Errorf("user message lacks the checklists:\n%s", user)
	}
	if user = dashboardCardMessages(req, testVocab(), nil, nil)[1].Content; strings.Contains(user, "checklists") {
		t.Errorf("no checklists, no checklists line:\n%s", user)
	}
}

func TestBoardPromptIsEmbedded(t *testing.T) {
	if !strings.Contains(boardPrompt, "@Data(") || !strings.Contains(boardPrompt, "Panel(") {
		t.Fatal("board_prompt.txt is missing or stale; run make gen-genui-prompt")
	}
}
