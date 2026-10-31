package sheet

import (
	"fmt"
	"math/rand"
	"strings"
	"testing"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"

	"timely-api/internal/models"
)

func TestSheetValuesRunTheAppsEngine(t *testing.T) {
	sh, err := BuildBuiltin("builtin:yearly-expenses", 2027, "LKR")
	if err != nil {
		t.Fatal(err)
	}
	jan := &sh.Tabs[2]
	col := map[string]string{}
	for _, column := range jan.Columns {
		col[column.Name] = column.ID
	}
	for _, entry := range []map[string]string{
		{col["Date"]: "2027-01-03", col["Item"]: "Rice 5kg", col["Category"]: "Groceries", col["Qty"]: "2", col["Unit price"]: "1250"},
		{col["Item"]: "Bus pass", col["Category"]: "Transport", col["Unit price"]: "3000"},
	} {
		AppendRow(jan, models.SheetRow{ID: "r", Cells: entry})
	}
	values, err := SheetValues(sh)
	if err != nil {
		t.Fatal(err)
	}
	if len(values) != 14 {
		t.Fatalf("%d tabs", len(values))
	}
	// Summary row 1 is January: Spent 2*1250 + 3000, 2 items, biggest 3000.
	january := values[0][0]
	if january[0] != "January" || january[1] != 5500.0 || january[5] != 2.0 || january[6] != 3000.0 {
		t.Fatalf("Summary January = %v", january)
	}
	if got := values[2][1][0]; got != "2027-01-03" {
		t.Fatalf("date cell = %#v", got)
	}
	if got := values[2][1][7]; got != 2500.0 {
		t.Fatalf("row 2 Total = %#v", got)
	}
	if got := values[2][3][7]; got != "" && got != nil {
		t.Fatalf("empty prepared row Total = %#v", got)
	}

	value, err := EvaluateFormula(sh, jan.ID, `SUMIF(C2:C,"groceries",H2:H)`)
	if err != nil || value != 2500.0 {
		t.Fatalf("SUMIF = %#v, %v", value, err)
	}
	value, err = EvaluateFormula(sh, "", `=January!H1/2`)
	if err != nil || value != 2750.0 {
		t.Fatalf("cross-tab = %#v, %v", value, err)
	}
	value, _ = EvaluateFormula(sh, "", `=1/0`)
	if m, ok := value.(map[string]any); !ok || m["error"] == nil {
		t.Fatalf("1/0 = %#v", value)
	}
	if _, err := EvaluateFormula(sh, "tab_nope", "=1"); err == nil {
		t.Fatal("unknown tab accepted")
	}
}

func TestSheetValuesStopsARunawayFormula(t *testing.T) {
	columns := models.SheetColumns{{ID: "a", Name: "A", Type: "formula"}}
	sh := &models.Sheet{Columns: columns, Rows: models.SheetRows{{ID: "r", Cells: map[string]string{"a": "=A1+1"}}}}
	values, err := SheetValues(sh)
	if err != nil {
		t.Fatal(err)
	}
	if m, ok := values[0][0][0].(map[string]any); !ok || m["error"] == nil {
		t.Fatalf("self reference = %#v", values[0][0][0])
	}
}

// Entries past a month's prepared rows get the Total formula filled down, so
// the month total (=SUM(H2:H)) and the Summary still count them.
func TestEntriesPastPreparedRowsKeepTheirTotal(t *testing.T) {
	sh, err := BuildBuiltin("builtin:yearly-expenses", 2027, "")
	if err != nil {
		t.Fatal(err)
	}
	dec := &sh.Tabs[13]
	col := map[string]string{}
	for _, column := range dec.Columns {
		col[column.Name] = column.ID
	}
	prepared := len(dec.Rows)
	want := 0.0
	for i := 1; i <= prepared+5; i++ {
		AppendRow(dec, models.SheetRow{ID: "r", Cells: map[string]string{col["Item"]: "Thing", col["Qty"]: "2", col["Unit price"]: "10"}})
		want += 20
	}
	if len(dec.Rows) <= prepared {
		t.Fatalf("grid did not grow: %d rows", len(dec.Rows))
	}
	last := dec.Rows[len(dec.Rows)-1].Cells[col["Total"]]
	if last != fmt.Sprintf(`=IF(G%d="","",IF(E%d="",1,E%d)*G%d)`, len(dec.Rows), len(dec.Rows), len(dec.Rows), len(dec.Rows)) {
		t.Fatalf("last row Total = %q", last)
	}
	values, err := SheetValues(sh)
	if err != nil {
		t.Fatal(err)
	}
	if got := values[0][11][1]; got != want {
		t.Fatalf("Summary December Spent = %v, want %v", got, want)
	}
}

// Deleting an entry row moves the rows below up with their formulas fixed,
// as the apps do; before, the Totals below read the next row's numbers.
func TestDeleteFromTabKeepsFormulasOnTheirCells(t *testing.T) {
	sh, err := BuildBuiltin("builtin:yearly-expenses", 2027, "")
	if err != nil {
		t.Fatal(err)
	}
	jan := &sh.Tabs[2]
	col := map[string]string{}
	for _, column := range jan.Columns {
		col[column.Name] = column.ID
	}
	for i, price := range []string{"100", "200", "300", "400"} {
		AppendRow(jan, models.SheetRow{ID: fmt.Sprint("r", i), Cells: map[string]string{col["Item"]: "Thing", col["Qty"]: "2", col["Unit price"]: price}})
	}
	// Rows 3 and 4 (index 2 and 3; 100 is row 2) hold 200 and 300.
	tabs, err := deleteFromTab(sh.Tabs, jan.ID, "row", []int{3, 2, 3})
	if err != nil {
		t.Fatal(err)
	}
	sh.Tabs = tabs
	jan = &sh.Tabs[2]
	if got := jan.Rows[2].Cells[col["Total"]]; got != `=IF(G3="","",IF(E3="",1,E3)*G3)` {
		t.Fatalf("moved-up Total = %q", got)
	}
	values, err := SheetValues(sh)
	if err != nil {
		t.Fatal(err)
	}
	if got := values[0][0][1]; got != 1000.0 {
		t.Fatalf("Summary January Spent = %v, want 1000 (2×100 + 2×400)", got)
	}
	// Deleting a column fixes the formulas right of it; ones that read it get #REF!.
	tabs, err = deleteFromTab(sh.Tabs, jan.ID, "col", []int{5}) // Unit
	if err != nil {
		t.Fatal(err)
	}
	total := tabs[2].Rows[1].Cells[col["Total"]]
	if total != `=IF(F2="","",IF(E2="",1,E2)*F2)` {
		t.Fatalf("Total after deleting Unit = %q", total)
	}
	if _, ok := tabs[2].Rows[1].Cells[col["Unit"]]; ok || len(tabs[2].Columns) != len(jan.Columns)-1 {
		t.Fatal("Unit column kept")
	}
}

// One tab worked out alone, with the tabs its formulas reach, shows the same
// values as the whole workbook.
func TestTabValuesMatchTheWholeWorkbook(t *testing.T) {
	yearly, err := BuildBuiltin("builtin:yearly-expenses", 2027, "LKR")
	if err != nil {
		t.Fatal(err)
	}
	oct := &yearly.Tabs[11]
	col := map[string]string{}
	for _, column := range oct.Columns {
		col[column.Name] = column.ID
	}
	AppendRow(oct, models.SheetRow{ID: "r", Cells: map[string]string{
		col["Date"]: "2027-10-03", col["Item"]: "Rice 5kg", col["Category"]: "Groceries", col["Qty"]: "2", col["Unit price"]: "1250"}})

	cell := func(id, value string) models.SheetRow {
		return models.SheetRow{ID: id, Cells: map[string]string{"a": value}}
	}
	columns := models.SheetColumns{{ID: "a", Name: "A", Type: "text"}}
	tab := func(id, name string, rows ...models.SheetRow) models.SheetTab {
		return models.SheetTab{ID: id, Name: name, Columns: columns, Rows: rows}
	}
	refs := &models.Sheet{Tabs: models.SheetTabs{
		tab("main", "Main", cell("1", "='Sam''s Rates'!A1*2"), cell("2", "=totals!A1"), cell("3", "=A1+A2")),
		tab("rates", "Sam's Rates", cell("1", "21")),
		tab("totals", "Totals", cell("1", "=Base!A1+1")),
		tab("base", "Base", cell("1", "100")),
		tab("unused", "Unused", cell("1", "=Main!A3")),
	}}

	for _, sh := range []*models.Sheet{yearly, refs} {
		whole, err := SheetValues(sh)
		if err != nil {
			t.Fatal(err)
		}
		for i, tab := range WorkbookTabs(sh) {
			one, err := TabValues(sh, tab.ID)
			if err != nil {
				t.Fatalf("%s: %v", tab.Name, err)
			}
			if got, want := fmt.Sprint(one), fmt.Sprint(whole[i]); got != want {
				t.Errorf("%s alone = %s, in the workbook %s", tab.Name, got, want)
			}
		}
	}
	main, _ := TabValues(refs, "main")
	if main[2][0] != 143.0 {
		t.Fatalf("Main!A3 = %v, want 42+101", main[2][0])
	}
	if _, err := TabValues(refs, "missing"); err == nil {
		t.Fatal("an unknown tab must fail")
	}
}

// The same, on random workbooks whose formulas reach other tabs by every
// reference form the engine reads, and on chains of tabs up to six hops
// long.
func TestTabValuesMatchTheWholeWorkbookOnRandomWorkbooks(t *testing.T) {
	rng := rand.New(rand.NewSource(60))
	var workbooks []*models.Sheet
	for range 150 {
		workbooks = append(workbooks, randomWorkbook(rng))
	}
	for w := range 30 {
		workbooks = append(workbooks, chainWorkbook(rng, 1+w%6))
	}
	for w, sh := range workbooks {
		whole, err := SheetValues(sh)
		if err != nil {
			t.Fatal(err)
		}
		for i, tab := range sh.Tabs {
			for _, row := range whole[i] {
				for _, value := range row {
					if m, ok := value.(map[string]any); ok && m["error"] != "#VALUE!" {
						t.Fatalf("workbook %d: %s on %s; the generator must only write formulas that work out in the whole workbook\n%s", w, m["error"], tab.Name, workbookCells(sh))
					}
				}
			}
			one, err := TabValues(sh, tab.ID)
			if err != nil {
				t.Fatalf("workbook %d, %s: %v", w, tab.Name, err)
			}
			if got, want := fmt.Sprint(one), fmt.Sprint(whole[i]); got != want {
				t.Errorf("workbook %d: %s alone = %s, in the workbook %s\n%s", w, tab.Name, got, want, workbookCells(sh))
			}
		}
	}
}

// chainTabNames holds no name inside another, ignoring case and the padding
// the engine trims, so a formula can only reach the tab it names.
func chainTabNames() []string {
	return []string{"Sam's Rates", "jan 2026", "Q1.v2", "net_pay", "Q10", "İzmir", "Café", "Οδός", "Main", "  Ledger "}
}

// randomWorkbook fills 3 to 6 small tabs, named so that some names hold
// others (Q1, Q10, Q1.v2), with numbers and formulas. Cells are ranked by a
// shuffle and a formula only reads cells ranked after its own, and ranges
// only tabs whose cells all are, so there are no reference cycles.
func randomWorkbook(rng *rand.Rand) *models.Sheet {
	names := append(chainTabNames(), "Q1")
	rng.Shuffle(len(names), func(i, j int) { names[i], names[j] = names[j], names[i] })
	type cell struct{ tab, row, col int }
	var cells []cell
	sh := &models.Sheet{}
	for i, name := range names[:3+rng.Intn(4)] {
		tab := randomTab(rng, i, name)
		for row := range tab.Rows {
			for col := range tab.Columns {
				cells = append(cells, cell{i, row, col})
			}
		}
		sh.Tabs = append(sh.Tabs, tab)
	}
	rng.Shuffle(len(cells), func(i, j int) { cells[i], cells[j] = cells[j], cells[i] })
	firstRank := make([]int, len(sh.Tabs))
	for i := range firstRank {
		firstRank[i] = len(cells)
	}
	for rank, c := range cells {
		firstRank[c.tab] = min(firstRank[c.tab], rank)
	}

	var term func(rank int, wrap bool) string
	term = func(rank int, wrap bool) string {
		var whole []int
		for tab, first := range firstRank {
			if first > rank {
				whole = append(whole, tab)
			}
		}
		switch n := rng.Intn(6); {
		case n == 0 && wrap:
			return "IFERROR(" + term(rank, false) + ",-1)"
		case n <= 2 && len(whole) > 0:
			return randomPick(rng, "SUM", "COUNTA", "ROWS", "COLUMNS") + "(" + randomRangeRef(rng, sh.Tabs[whole[rng.Intn(len(whole))]]) + ")"
		}
		target := cells[rank+1+rng.Intn(len(cells)-rank-1)]
		if target.tab == cells[rank].tab && rng.Intn(2) == 0 {
			return randomCellRef(rng, target.row, target.col)
		}
		return randomTabPrefix(rng, sh.Tabs[target.tab].Name) + randomCellRef(rng, target.row, target.col)
	}
	for rank, c := range cells {
		value := fmt.Sprint(rng.Intn(100))
		switch {
		case rank+1 < len(cells) && rng.Intn(10) < 7:
			terms := make([]string, 1+rng.Intn(3))
			for i := range terms {
				terms[i] = term(rank, true)
			}
			value = strings.Repeat(" ", rank%3) + "=" + strings.Join(terms, "+")
		case rng.Intn(8) == 0:
			value = randomPick(rng, "", "note")
		}
		sh.Tabs[c.tab].Rows[c.row].Cells[fmt.Sprint("c", c.col)] = value
	}
	return sh
}

// chainWorkbook is hops+1 tabs where every cell of a tab but the last reads a
// cell of the next tab, so each value on the first tab needs every tab and
// the walk can only find a tab through the one before it.
func chainWorkbook(rng *rand.Rand, hops int) *models.Sheet {
	names := chainTabNames()
	rng.Shuffle(len(names), func(i, j int) { names[i], names[j] = names[j], names[i] })
	sh := &models.Sheet{}
	for i, name := range names[:hops+1] {
		sh.Tabs = append(sh.Tabs, randomTab(rng, i, name))
	}
	for i, tab := range sh.Tabs {
		for _, row := range tab.Rows {
			for col := range tab.Columns {
				value := fmt.Sprint(rng.Intn(100))
				if i < hops {
					next := sh.Tabs[i+1]
					value = strings.Repeat(" ", col%2) + "=" + randomTabPrefix(rng, next.Name) + randomCellRef(rng, rng.Intn(len(next.Rows)), rng.Intn(len(next.Columns)))
					if rng.Intn(2) == 0 {
						value += "+SUM(" + randomRangeRef(rng, next) + ")"
					}
				}
				row.Cells[fmt.Sprint("c", col)] = value
			}
		}
	}
	return sh
}

func randomTab(rng *rand.Rand, index int, name string) models.SheetTab {
	tab := models.SheetTab{ID: fmt.Sprint("tab", index), Name: name}
	for col := range 1 + rng.Intn(3) {
		tab.Columns = append(tab.Columns, models.SheetColumn{ID: fmt.Sprint("c", col), Name: columnLetter(col), Type: "text"})
	}
	for row := range 1 + rng.Intn(4) {
		tab.Rows = append(tab.Rows, models.SheetRow{ID: fmt.Sprint("r", row), Cells: map[string]string{}})
	}
	return tab
}

func randomPick(rng *rand.Rand, options ...string) string {
	return options[rng.Intn(len(options))]
}

func randomCellRef(rng *rand.Rand, row, col int) string {
	return randomPick(rng, "", "$") + columnLetter(col) + randomPick(rng, "", "$") + fmt.Sprint(row+1)
}

// randomTabPrefix writes name as the engine reads it: trimmed or not, in any
// case, quoted, or bare with a $ inside when it can be. The engine's own case
// mapping lowers İzmir to i̇zmir, which only fits in quotes.
func randomTabPrefix(rng *rand.Rand, name string) string {
	name = randomPick(rng, name, strings.TrimSpace(name))
	name = randomPick(rng, name, cases.Upper(language.Und).String(name), cases.Lower(language.Und).String(name))
	if !bareTabName.MatchString(name) || rng.Intn(3) == 0 {
		return "'" + strings.ReplaceAll(name, "'", "''") + "'!"
	}
	if rng.Intn(2) == 0 {
		runes := []rune(name)
		at := 1 + rng.Intn(len(runes)-1)
		name = string(runes[:at]) + "$" + string(runes[at:])
	}
	return name + "!"
}

func randomRangeRef(rng *rand.Rand, tab models.SheetTab) string {
	rows, cols := len(tab.Rows), len(tab.Columns)
	row, col := rng.Intn(rows+1), rng.Intn(cols+1)
	row2, col2 := rng.Intn(rows+1), rng.Intn(cols+1)
	prefix := func() string { return randomTabPrefix(rng, tab.Name) }
	switch rng.Intn(6) {
	case 0:
		return prefix() + randomCellRef(rng, row, col) + ":" + prefix() + randomCellRef(rng, row2, col2)
	case 1:
		return prefix() + randomPick(rng, "", "$") + columnLetter(col) + ":" + randomPick(rng, "", "$") + columnLetter(col2)
	case 2:
		return prefix() + randomPick(rng, "", "$") + fmt.Sprint(row+1) + ":" + randomPick(rng, "", "$") + fmt.Sprint(row2+1)
	case 3:
		return prefix() + randomCellRef(rng, row, col) + ":" + randomPick(rng, "", "$") + columnLetter(col2)
	case 4:
		return prefix() + randomCellRef(rng, row, col) + ":" + randomPick(rng, "", "$") + fmt.Sprint(row2+1)
	default:
		return prefix() + randomCellRef(rng, row, col) + ":" + randomCellRef(rng, row2, col2)
	}
}

func columnLetter(col int) string {
	return string(rune('A' + col))
}

func workbookCells(sh *models.Sheet) string {
	var b strings.Builder
	for _, tab := range sh.Tabs {
		for row, cells := range tab.Rows {
			for col := range tab.Columns {
				fmt.Fprintf(&b, "%s!%s%d %s\n", tab.Name, columnLetter(col), row+1, cells.Cells[fmt.Sprint("c", col)])
			}
		}
	}
	return b.String()
}

func TestCellsBriefsNameColumnsAsTheAppsFindThem(t *testing.T) {
	expenses, err := BuildBuiltin("builtin:yearly-expenses", 2027, "LKR")
	if err != nil {
		t.Fatal(err)
	}
	jan := &expenses.Tabs[2]
	col := map[string]string{}
	for _, column := range jan.Columns {
		col[column.Name] = column.ID
	}
	AppendRow(jan, models.SheetRow{ID: "r", Cells: map[string]string{col["Date"]: "2027-01-03", col["Item"]: "Rice 5kg", col["Category"]: "Groceries", col["Qty"]: "2", col["Unit price"]: "1250"}})

	// Letters over the columns and the names typed in row 1, a hidden column and a totals row.
	typed := models.Sheet{ID: "s2", Title: "Runs", Tabs: models.SheetTabs{{
		ID:   "t1",
		Name: "Week",
		Columns: models.SheetColumns{
			{ID: "a", Name: "A", Type: "text"},
			{ID: "b", Name: "B", Type: "text"},
			{ID: "c", Name: "C", Type: "text", Hidden: true},
		},
		Rows: models.SheetRows{
			{ID: "1", Cells: map[string]string{"a": "Day", "b": "Km", "c": "Note"}},
			{ID: "2", Cells: map[string]string{"a": "Mon", "b": "5", "c": "easy"}},
			{ID: "3", Cells: map[string]string{"a": "Tue", "b": "7.5"}},
			{ID: "4", Cells: map[string]string{"a": "", "b": "=SUM(B2:B3)"}},
		},
	}}}

	briefs, err := CellsBriefs([]models.Sheet{*expenses, typed})
	if err != nil {
		t.Fatal(err)
	}
	if len(briefs) != 2 {
		t.Fatalf("%d sheets", len(briefs))
	}
	columns := func(tab CellsTab) string {
		names := make([]string, len(tab.Columns))
		for i, column := range tab.Columns {
			names[i] = column.Name
			if column.Numbers {
				names[i] += "#"
			}
		}
		return strings.Join(names, ", ")
	}
	var january *CellsTab
	for i := range briefs[0] {
		if briefs[0][i].Name == "January" {
			january = &briefs[0][i]
		}
	}
	if january == nil || january.Rows != 1 || columns(*january) != "Date, Item, Category, Store / from, Qty#, Unit, Unit price#, Total#" {
		t.Fatalf("January = %+v (want one entry: the month total row on top is left out)", january)
	}
	week := briefs[1][0]
	if week.Name != "Week" || week.Rows != 2 || columns(week) != "Day, Km#" {
		t.Fatalf("Week = %d rows, %s (want the names in row 1, no hidden column, no totals row)", week.Rows, columns(week))
	}

	// A program's `is` must name a value as the sheet writes it ("October",
	// not "Oct"), so columns of a few short values list them.
	values := func(tab CellsTab, name string) string {
		for _, column := range tab.Columns {
			if column.Name == name {
				return strings.Join(column.Values, "|")
			}
		}
		return "no column " + name
	}
	summary := briefs[0][0]
	months := "January|February|March|April|May|June|July|August|September|October|November|December"
	if summary.Name != "Summary" || summary.Rows != 12 || values(summary, "Month") != months {
		t.Fatalf("Summary = %d rows, Month %s (want the twelve months; Year total and Monthly average are totals rows)", summary.Rows, values(summary, "Month"))
	}
	if got := values(summary, "Notes"); got != "" {
		t.Errorf("Summary Notes = %q (nothing typed outside the totals rows)", got)
	}
	if got := values(*january, "Category"); got != "Groceries" {
		t.Errorf("January Category = %q", got)
	}
	if got := values(*january, "Qty"); got != "" {
		t.Errorf("a column of numbers lists no values: %q", got)
	}
	if got := values(week, "Day"); got != "Mon|Tue" {
		t.Errorf("Week Day = %q", got)
	}
}
