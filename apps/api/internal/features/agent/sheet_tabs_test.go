package agent

import (
	"encoding/json"
	"strings"
	"testing"

	"timely-api/internal/features/sheet"
	"timely-api/internal/models"
)

func yearlyExpenses(t *testing.T) *models.Sheet {
	t.Helper()
	sh, err := sheet.BuildBuiltin("builtin:yearly-expenses", 2026, "LKR")
	if err != nil {
		t.Fatal(err)
	}
	sh.ID = "sht_test"
	return sh
}

func tabNamed(sh *models.Sheet, name string) models.SheetTab {
	for _, tab := range sh.Tabs {
		if tab.Name == name {
			return tab
		}
	}
	return models.SheetTab{}
}

// An October receipt must never land on Summary because the agent left the
// tab out or named it instead of passing its id.
func TestPickTabNeverFallsBackToTheFirstTab(t *testing.T) {
	sh := yearlyExpenses(t)
	october := tabNamed(sh, "October")
	for _, ref := range []string{"October", "october", " OCTOBER ", october.ID} {
		if got, err := pickTab(sh, ref); err != nil || got != october.ID {
			t.Fatalf("pickTab(%q) = %q, %v", ref, got, err)
		}
	}
	_, err := pickTab(sh, "")
	if err == nil || !strings.Contains(err.Error(), "14 tabs") || !strings.Contains(err.Error(), "October") {
		t.Fatalf("no tab on a workbook: %v", err)
	}
	if _, err := pickTab(sh, "Octobr"); err == nil || !strings.Contains(err.Error(), "Summary, Categories, January") {
		t.Fatalf("unknown tab: %v", err)
	}
	// Ids the agent already holds find their own tab.
	row := october.Rows[3].ID
	if got, err := pickTab(sh, "", row); err != nil || got != october.ID {
		t.Fatalf("row id: %q, %v", got, err)
	}
	if got, err := pickTab(sh, "", october.Columns[1].ID); err != nil || got != october.ID {
		t.Fatalf("column id: %q, %v", got, err)
	}
	// Column names are shared by every month, so they pick nothing.
	if _, err := pickTab(sh, "", "Item", "Unit price"); err == nil {
		t.Fatal("column names picked a tab")
	}
	one := &models.Sheet{Title: "List", Tabs: models.SheetTabs{{ID: "tab_only", Name: "List"}}}
	if got, err := pickTab(one, ""); err != nil || got != "tab_only" {
		t.Fatalf("one tab: %q, %v", got, err)
	}
	legacy := &models.Sheet{Title: "Old grid"}
	if got, err := pickTab(legacy, ""); err != nil || got != "" {
		t.Fatalf("primary grid: %q, %v", got, err)
	}
}

func TestColumnKeysTakeNamesLettersAndIDs(t *testing.T) {
	columns := tabNamed(yearlyExpenses(t), "October").Columns
	got, err := columnKeys(columns, map[string]string{"item": "Rice", "G": "450", columns[4].ID: "2", "Store / from": "Keells"})
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{columns[1].ID: "Rice", columns[6].ID: "450", columns[4].ID: "2", columns[3].ID: "Keells"}
	if len(got) != len(want) {
		t.Fatalf("got %v", got)
	}
	for id, value := range want {
		if got[id] != value {
			t.Fatalf("%s = %q, want %q", id, got[id], value)
		}
	}
	got, err = columnKeys(columns, map[string]string{"G Unit price (LKR)": "450", "Total (LKR)": "=E2*G2"})
	if err != nil || got[columns[6].ID] != "450" || got[columns[7].ID] != "=E2*G2" {
		t.Fatalf("markdown headings: %v, %v", got, err)
	}
	if _, err := columnKeys(columns, map[string]string{"Price": "1"}); err == nil || !strings.Contains(err.Error(), "Unit price") {
		t.Fatalf("unknown column: %v", err)
	}
}

// The edit tools used to return the whole workbook (about 500,000 characters
// for Yearly expenses), more than an agent's context takes.
func TestSheetResultsStaySmall(t *testing.T) {
	sh := yearlyExpenses(t)
	october := tabNamed(sh, "October")
	for name, payload := range map[string]map[string]any{
		"tab edit":    sheetResult(sh, october.ID),
		"whole sheet": sheetResult(sh, ""),
		"list entry":  {"sheet": sheetBrief(sh, false)},
	} {
		raw, _ := json.Marshal(payload)
		if len(raw) > 30000 {
			t.Fatalf("%s result is %d characters", name, len(raw))
		}
	}
	tabResult := sheetResult(sh, october.ID)
	if !strings.HasPrefix(tabResult["markdown"].(string), "## October (tabId "+october.ID) {
		t.Fatalf("tab markdown = %.80s", tabResult["markdown"])
	}
	raw, _ := json.Marshal(leanTab(october))
	if len(raw) > 20000 {
		t.Fatalf("one month's grid is %d characters", len(raw))
	}
	var back models.SheetTab
	if err := json.Unmarshal(raw, &back); err != nil || len(back.Rows) != len(october.Rows) || back.Rows[1].Cells[october.Columns[7].ID] != october.Rows[1].Cells[october.Columns[7].ID] {
		t.Fatal("lean tab lost rows or formulas")
	}
}

func TestMonthMismatchWarns(t *testing.T) {
	october := tabNamed(yearlyExpenses(t), "October")
	date := october.Columns[0].ID
	if got := monthMismatch(october, map[string]string{date: "2026-09-30"}); !strings.Contains(got, "September") {
		t.Fatalf("September date on October: %q", got)
	}
	if got := monthMismatch(october, map[string]string{date: "12 Oct 2026"}); got != "" {
		t.Fatalf("October date warned: %q", got)
	}
	summary := tabNamed(yearlyExpenses(t), "Summary")
	if got := monthMismatch(summary, map[string]string{date: "2026-09-30"}); got != "" {
		t.Fatalf("non-month tab warned: %q", got)
	}
}
