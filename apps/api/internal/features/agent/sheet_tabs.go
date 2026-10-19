package agent

import (
	"fmt"
	"strconv"
	"strings"

	"timely-api/internal/features/sheet"
	"timely-api/internal/models"
)

// sheetMarkdownBudget keeps a whole-workbook markdown view small enough for
// an agent's context; past it, tabs are listed and read one at a time.
const sheetMarkdownBudget = 40000

// pickTab resolves an agent's tab reference. ref is a tab id or a tab name in
// any case. With no ref, the tab holding every id in owned (row or column ids
// the agent already has) is used, and a one-tab sheet needs nothing; otherwise
// a workbook with several tabs refuses rather than writing to the first tab.
// It returns "" for a sheet that only stores its primary grid, which the
// service addresses as the first tab.
func pickTab(sh *models.Sheet, ref string, owned ...string) (string, error) {
	tabs := sh.Tabs
	ref = strings.TrimSpace(ref)
	if len(tabs) == 0 {
		if ref == "" || strings.EqualFold(ref, strings.TrimSpace(sh.Title)) {
			return "", nil
		}
		return "", fmt.Errorf("tab not found: %s; this sheet has one tab, so leave tabId out", ref)
	}
	if ref != "" {
		for _, tab := range tabs {
			if tab.ID == ref {
				return tab.ID, nil
			}
		}
		for _, tab := range tabs {
			if strings.EqualFold(strings.TrimSpace(tab.Name), ref) {
				return tab.ID, nil
			}
		}
		return "", fmt.Errorf("tab not found: %s; this sheet's tabs are %s", ref, tabNames(tabs))
	}
	if len(tabs) == 1 {
		return tabs[0].ID, nil
	}
	if id := tabHolding(tabs, owned); id != "" {
		return id, nil
	}
	example := tabs[len(tabs)-1].Name
	if len(tabs) > 2 {
		example = tabs[2].Name
	}
	return "", fmt.Errorf("this sheet has %d tabs (%s); pass tabId with the tab's name or id, e.g. %q", len(tabs), tabNames(tabs), example)
}

// tabHolding finds the one tab that has every row or column id in ids.
func tabHolding(tabs models.SheetTabs, ids []string) string {
	var wanted []string
	for _, id := range ids {
		if id = strings.TrimSpace(id); id != "" {
			wanted = append(wanted, id)
		}
	}
	if len(wanted) == 0 {
		return ""
	}
	for _, tab := range tabs {
		has := map[string]bool{}
		for _, column := range tab.Columns {
			has[column.ID] = true
		}
		for _, row := range tab.Rows {
			has[row.ID] = true
		}
		all := true
		for _, id := range wanted {
			all = all && has[id]
		}
		if all {
			return tab.ID
		}
	}
	return ""
}

func tabNames(tabs models.SheetTabs) string {
	names := make([]string, len(tabs))
	for i, tab := range tabs {
		names[i] = tab.Name
	}
	return strings.Join(names, ", ")
}

// tabByID returns the workbook tab with id; "" is the first tab.
func tabByID(sh *models.Sheet, id string) (models.SheetTab, bool) {
	tabs := sheet.WorkbookTabs(sh)
	if len(tabs) == 0 {
		return models.SheetTab{}, false
	}
	if id == "" {
		return tabs[0], true
	}
	for _, tab := range tabs {
		if tab.ID == id {
			return tab, true
		}
	}
	return models.SheetTab{}, false
}

// rowIDAt turns a row number as get_sheet shows it (1 is the first data row)
// into the row's id.
func rowIDAt(tab models.SheetTab, number int) (string, error) {
	if number < 1 || number > len(tab.Rows) {
		return "", fmt.Errorf("row %d is outside %s, which has rows 1 to %d", number, tab.Name, len(tab.Rows))
	}
	return tab.Rows[number-1].ID, nil
}

// columnKeys maps cells keyed by column id, name (any case) or A1 letter to
// column ids.
func columnKeys(columns models.SheetColumns, cells map[string]string) (map[string]string, error) {
	ids := make(map[string]bool, len(columns))
	byName := make(map[string]string, len(columns))
	for _, column := range columns {
		ids[column.ID] = true
		byName[strings.ToLower(strings.TrimSpace(column.Name))] = column.ID
	}
	out := make(map[string]string, len(cells))
	for key, value := range cells {
		if ids[key] {
			out[key] = value
			continue
		}
		if id, ok := byName[strings.ToLower(strings.TrimSpace(key))]; ok {
			out[id] = value
			continue
		}
		// A heading copied from the markdown tables: "G Unit price (LKR)".
		if id, ok := byName[strings.ToLower(headingName(key))]; ok {
			out[id] = value
			continue
		}
		if index := letterIndex(key); index >= 0 && index < len(columns) {
			out[columns[index].ID] = value
			continue
		}
		names := make([]string, len(columns))
		for i, column := range columns {
			names[i] = column.Name
		}
		return nil, fmt.Errorf("unknown column: %s; the columns are %s", key, strings.Join(names, ", "))
	}
	return out, nil
}

// headingName strips what the markdown tables add to a column name: its
// letter in front and its unit after ("G Unit price (LKR)" → "Unit price").
func headingName(key string) string {
	key = strings.TrimSpace(key)
	if i := strings.LastIndex(key, " ("); i > 0 && strings.HasSuffix(key, ")") {
		key = strings.TrimSpace(key[:i])
	}
	if i := strings.IndexByte(key, ' '); i > 0 && letterIndex(key[:i]) >= 0 && strings.ToUpper(key[:i]) == key[:i] {
		key = strings.TrimSpace(key[i+1:])
	}
	return key
}

// rowNumberRef reads a rowId that is really a row number ("10"), which
// agents pass after reading the markdown tables. A row whose id is that
// number keeps its meaning.
func rowNumberRef(sh *models.Sheet, rowID string) (int, bool) {
	number, err := strconv.Atoi(strings.TrimSpace(rowID))
	if err != nil || number < 1 {
		return 0, false
	}
	for _, tab := range sheet.WorkbookTabs(sh) {
		for _, row := range tab.Rows {
			if row.ID == rowID {
				return 0, false
			}
		}
	}
	return number, true
}

// letterIndex reads A1 column letters (A → 0); anything else is -1.
func letterIndex(key string) int {
	key = strings.TrimSpace(key)
	if key == "" || len(key) > 3 {
		return -1
	}
	index := 0
	for _, r := range strings.ToUpper(key) {
		if r < 'A' || r > 'Z' {
			return -1
		}
		index = index*26 + int(r-'A'+1)
	}
	return index - 1
}

// sheetBrief is a sheet without its grid: what list_sheets and the edit tools
// return, so a workbook of month tabs does not flood an agent's context.
// withColumns adds each tab's columns.
func sheetBrief(sh *models.Sheet, withColumns bool) map[string]any {
	tabs := sheet.WorkbookTabs(sh)
	briefs := make([]map[string]any, len(tabs))
	for i, tab := range tabs {
		brief := map[string]any{"id": tab.ID, "name": tab.Name, "rowCount": len(tab.Rows), "columnCount": len(tab.Columns)}
		if len(sh.Tabs) == 0 {
			// A sheet stored before tabs has no stable tab id.
			brief["id"] = ""
		}
		if withColumns {
			brief["columns"] = tab.Columns
			if tab.FrozenRows > 0 || tab.FrozenCols > 0 {
				brief["frozenRows"], brief["frozenCols"] = tab.FrozenRows, tab.FrozenCols
			}
			if n := len(tab.ConditionalFormats); n > 0 {
				brief["colourRules"] = n
			}
		}
		briefs[i] = brief
	}
	return map[string]any{
		"id":          sh.ID,
		"title":       sh.Title,
		"icon":        sh.Icon,
		"workspaceId": sh.WorkspaceID,
		"projectId":   sh.ProjectID,
		"isFavorite":  sh.IsFavorite,
		"archivedAt":  sh.ArchivedAt,
		"createdAt":   sh.CreatedAt,
		"updatedAt":   sh.UpdatedAt,
		"tabs":        briefs,
	}
}

// leanTab is one tab's raw grid with empty cells left out (a missing cell is
// empty), for reading row ids, formats and colour rules.
func leanTab(tab models.SheetTab) models.SheetTab {
	rows := make(models.SheetRows, len(tab.Rows))
	for i, row := range tab.Rows {
		cells := make(map[string]string, len(row.Cells))
		for key, value := range row.Cells {
			if value != "" {
				cells[key] = value
			}
		}
		row.Cells = cells
		rows[i] = row
	}
	tab.Rows = rows
	return tab
}

// workbookMarkdown shows every tab as a table, until the budget runs out;
// the tabs past it are named so they can be read one at a time.
func workbookMarkdown(sh *models.Sheet) string {
	if len(sh.Tabs) == 0 {
		return sheetMarkdown(sh)
	}
	var b strings.Builder
	var left []string
	for _, tab := range sh.Tabs {
		if len(tab.Columns) == 0 {
			continue
		}
		part := tabMarkdown(tab)
		if len(left) > 0 || (b.Len() > 0 && b.Len()+len(part) > sheetMarkdownBudget) {
			left = append(left, fmt.Sprintf("%s (tabId %s)", tab.Name, tab.ID))
			continue
		}
		b.WriteString(part)
		b.WriteString("\n\n")
	}
	if len(left) > 0 {
		fmt.Fprintf(&b, "Not shown to keep this short: %s. Read one with get_sheet or get_sheet_values and its tabId.", strings.Join(left, ", "))
	}
	return strings.TrimSpace(b.String())
}

func tabMarkdown(tab models.SheetTab) string {
	var b strings.Builder
	fmt.Fprintf(&b, "## %s (tabId %s)\n", tab.Name, tab.ID)
	if tab.FrozenRows > 0 || tab.FrozenCols > 0 {
		fmt.Fprintf(&b, "Frozen rows: %d, columns: %d.\n", tab.FrozenRows, tab.FrozenCols)
	}
	if n := len(tab.ConditionalFormats); n > 0 {
		fmt.Fprintf(&b, "%d colour rules.\n", n)
	}
	b.WriteString("\n")
	b.WriteString(gridMarkdown(tab.Columns, tab.Rows))
	return b.String()
}

// sheetResult is what the edit tools return: the sheet without its grid, and
// the tab they changed as markdown with its columns. An empty tabID (a whole
// sheet edit) shows the workbook.
func sheetResult(sh *models.Sheet, tabID string) map[string]any {
	if sh == nil {
		return nil
	}
	out := map[string]any{"sheet": sheetBrief(sh, false)}
	if tabID == "" && len(sh.Tabs) > 1 {
		out["markdown"] = workbookMarkdown(sh)
		return out
	}
	tab, ok := tabByID(sh, tabID)
	if !ok {
		out["markdown"] = workbookMarkdown(sh)
		return out
	}
	out["tab"] = map[string]any{"id": tab.ID, "name": tab.Name, "columns": tab.Columns, "rowCount": len(tab.Rows)}
	if len(sh.Tabs) == 0 {
		out["tab"].(map[string]any)["id"] = ""
		out["markdown"] = sheetMarkdown(sh)
	} else {
		out["markdown"] = tabMarkdown(tab)
	}
	return out
}

// rowValues works out one row the way the apps show it, keyed by column
// name, so an agent can check a Total without another read.
func rowValues(sh *models.Sheet, tabID string, index int) map[string]any {
	values, err := sheet.TabValues(sh, tabID)
	if err != nil || index < 0 || index >= len(values) {
		return nil
	}
	tab, ok := tabByID(sh, tabID)
	if !ok {
		return nil
	}
	out := map[string]any{}
	for c, column := range tab.Columns {
		if c < len(values[index]) {
			if value := values[index][c]; value != nil && value != "" {
				out[column.Name] = value
			}
		}
	}
	return out
}

// templateSheet reads a template's grid like a sheet's.
func templateSheet(t *models.SheetTemplate) *models.Sheet {
	return &models.Sheet{ID: t.ID, Title: t.Name, Columns: t.Columns, Rows: t.Rows, Merges: t.Merges, Tabs: t.Tabs}
}

// templateBrief is a template without its grid; a template saved from a
// Yearly expenses workbook is as big as the workbook.
func templateBrief(t *models.SheetTemplate) map[string]any {
	return map[string]any{
		"id":            t.ID,
		"name":          t.Name,
		"icon":          t.Icon,
		"sourceSheetId": t.SourceSheetID,
		"createdAt":     t.CreatedAt,
		"updatedAt":     t.UpdatedAt,
		"tabs":          sheetBrief(templateSheet(t), false)["tabs"],
	}
}
