package sheet

import (
	"regexp"
	"strconv"
	"strings"

	"timely-api/internal/models"
)

var (
	aggregateRange = regexp.MustCompile(`(?i)\b(SUM|AVERAGE|MIN|MAX|COUNT|COUNTA|PRODUCT)\(\s*\$?[A-Z]{1,3}\$?\d+\s*:\s*\$?([A-Z]{1,3})\$?(\d+)\s*\)`)
	cellReference  = regexp.MustCompile(`(:?)(\$?[A-Z]{1,3}\$?)(\d+)\b`)
)

// TabsOf returns a sheet's tabs without copying them. A sheet that still stores
// only the primary grid gets it presented as one "Expenses" tab, so callers can
// treat every sheet as a workbook. Unlike workbookTabs it never writes, so the
// tab id is the stable placeholder "primary".
func TabsOf(s models.Sheet) models.SheetTabs {
	if len(s.Tabs) > 0 {
		return s.Tabs
	}
	return models.SheetTabs{{ID: "primary", Name: "Expenses", Columns: s.Columns, Rows: s.Rows, Merges: s.Merges}}
}

// IsTotalsRow reports whether row (1-based number) aggregates the rows
// directly above it, e.g. =SUM(D1:D5) on row 6, in a column where added has a
// value, so placing added above the totals row gets that value counted.
func IsTotalsRow(columns models.SheetColumns, row, added models.SheetRow, number int) bool {
	for _, value := range row.Cells {
		if !strings.HasPrefix(value, "=") {
			continue
		}
		for _, match := range aggregateRange.FindAllStringSubmatch(value, -1) {
			end, err := strconv.Atoi(match[3])
			column := columnIndex(match[2])
			if err == nil && end == number-1 && column < len(columns) && added.Cells[columns[column].ID] != "" {
				return true
			}
		}
	}
	return false
}

// columnIndex turns spreadsheet letters into a zero-based index (A → 0).
func columnIndex(letters string) int {
	index := 0
	for _, r := range strings.ToUpper(letters) {
		index = index*26 + int(r-'A'+1)
	}
	return index - 1
}

func emptyRow(row models.SheetRow) bool {
	for _, value := range row.Cells {
		if value != "" {
			return false
		}
	}
	return len(row.Formats) == 0
}

// shiftTotalsFormula rewrites a totals row's formula after one row is inserted
// above it: references to its own row move down, and ranges ending on the row
// above now end on the inserted row.
func shiftTotalsFormula(value string, number int) string {
	if !strings.HasPrefix(value, "=") {
		return value
	}
	var b strings.Builder
	last := 0
	for _, m := range cellReference.FindAllStringSubmatchIndex(value, -1) {
		// Skip matches inside names such as LOG10.
		if c := value[m[0]]; c != ':' && m[0] > 0 {
			if p := value[m[0]-1]; p == '_' || p >= 'A' && p <= 'Z' || p >= 'a' && p <= 'z' || p >= '0' && p <= '9' {
				continue
			}
		}
		if m[1] < len(value) && value[m[1]] == '(' {
			continue // a function name such as LOG10(
		}
		row, err := strconv.Atoi(value[m[6]:m[7]])
		if err != nil {
			continue
		}
		rangeEnd := m[3] > m[2]
		switch {
		case row == number:
			row++
		case row == number-1 && rangeEnd:
			row++
		default:
			continue
		}
		b.WriteString(value[last:m[6]])
		b.WriteString(strconv.Itoa(row))
		last = m[7]
	}
	b.WriteString(value[last:])
	return b.String()
}

// AppendRow places added in tab and returns its row index. It reuses trailing
// grid padding without inserting/deleting rows or moving formulas. Internal
// gaps, notes, links and merged ranges belong to the existing layout.
// The one exception is a closing totals row (=SUM(D1:D5) right below its data):
// added goes above it and the total's range grows by one row, otherwise
// added would sit below the total and never be counted.
func AppendRow(tab *models.SheetTab, added models.SheetRow) int {
	last := -1
	for i, row := range tab.Rows {
		for _, value := range row.Cells {
			if value != "" {
				last = i
				break
			}
		}
		for _, format := range row.Formats {
			if format.Note != "" || format.Link != "" {
				last = i
				break
			}
		}
	}
	mergedFrom := -1
	for _, merge := range tab.Merges {
		last = max(last, merge.StartRow+merge.RowSpan-1)
		mergedFrom = max(mergedFrom, merge.StartRow+merge.RowSpan-1)
	}
	if last > 0 && mergedFrom < last && IsTotalsRow(tab.Columns, tab.Rows[last], added, last+1) {
		total := tab.Rows[last]
		cells := map[string]string{}
		for column, value := range total.Cells {
			cells[column] = shiftTotalsFormula(value, last+1)
		}
		total.Cells = cells
		rest := tab.Rows[last+1:]
		// Reuse one blank padding row below so the grid keeps its size.
		if len(rest) > 0 && emptyRow(rest[0]) {
			rest = rest[1:]
		}
		tab.Rows = append(tab.Rows[:last:last], append(models.SheetRows{added, total}, rest...)...)
		return last
	}
	next := last + 1
	if next < len(tab.Rows) {
		row := &tab.Rows[next]
		if row.Cells == nil {
			row.Cells = map[string]string{}
		}
		for column, value := range added.Cells {
			row.Cells[column] = value
		}
		return next
	}
	tab.Rows = append(tab.Rows, added)
	return len(tab.Rows) - 1
}
