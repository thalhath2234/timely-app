package sheet

import (
	"errors"
	"regexp"
	"strings"
	"unicode"

	"timely-api/internal/models"
)

// The same rules as packages/contract/src/sheetRefs.ts: a tab can be written
// bare (January!A1) unless its name has spaces or looks like a cell or a
// boolean, then it is quoted ('Jan 2026'!A1, with ' doubled).
var (
	bareTabName   = regexp.MustCompile(`^[\p{L}_][\p{L}\p{N}_.]*$`)
	unquotedTab   = regexp.MustCompile(`^[\p{L}_][\p{L}\p{N}_.]*!`)
	cellLikeName  = regexp.MustCompile(`^[A-Za-z]{1,3}\d+$`)
	booleanTabRef = regexp.MustCompile(`(?i)^(TRUE|FALSE)$`)
)

func tabPrefix(name string) string {
	if bareTabName.MatchString(name) && !cellLikeName.MatchString(name) && !booleanTabRef.MatchString(name) {
		return name + "!"
	}
	return "'" + strings.ReplaceAll(name, "'", "''") + "'!"
}

func sameTab(a, b string) bool {
	return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}

func formulaWordChar(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || strings.ContainsRune("_.$'", r)
}

// renameTabInFormula points `Old!A1` and `'Old name'!A1` references at the
// renamed tab, leaving text in quotes alone.
func renameTabInFormula(value, oldName, newName string) string {
	if !strings.HasPrefix(strings.TrimSpace(value), "=") || oldName == newName {
		return value
	}
	runes := []rune(value)
	var out strings.Builder
	changed := false
	for i := 0; i < len(runes); {
		r := runes[i]
		if r == '"' {
			j := i + 1
			for j < len(runes) {
				if runes[j] == '"' {
					if j+1 < len(runes) && runes[j+1] == '"' {
						j += 2
						continue
					}
					j++
					break
				}
				j++
			}
			out.WriteString(string(runes[i:j]))
			i = j
			continue
		}
		if i > 0 && formulaWordChar(runes[i-1]) {
			out.WriteRune(r)
			i++
			continue
		}
		name, next := readTabPrefix(runes, i)
		if next < 0 {
			out.WriteRune(r)
			i++
			continue
		}
		if sameTab(name, oldName) {
			out.WriteString(tabPrefix(newName))
			changed = true
		} else {
			out.WriteString(string(runes[i:next]))
		}
		i = next
	}
	if !changed {
		return value
	}
	return out.String()
}

// readTabPrefix reads a tab prefix at i and returns its name and the index
// after the "!", or -1 when there is none.
func readTabPrefix(runes []rune, i int) (string, int) {
	if runes[i] == '\'' {
		var name strings.Builder
		j := i + 1
		for j < len(runes) {
			if runes[j] == '\'' {
				if j+1 < len(runes) && runes[j+1] == '\'' {
					name.WriteRune('\'')
					j += 2
					continue
				}
				break
			}
			name.WriteRune(runes[j])
			j++
		}
		if j+1 < len(runes) && runes[j] == '\'' && runes[j+1] == '!' && name.Len() > 0 {
			return name.String(), j + 2
		}
		return "", -1
	}
	match := unquotedTab.FindString(string(runes[i:]))
	if match == "" {
		return "", -1
	}
	length := len([]rune(match))
	return string(runes[i : i+length-1]), i + length
}

// renameTabRefs rewrites every formula in the workbook that reads the
// renamed tab, as the apps do when a person renames one.
func renameTabRefs(tabs models.SheetTabs, oldName, newName string) {
	if oldName == newName {
		return
	}
	for t := range tabs {
		for r := range tabs[t].Rows {
			row := &tabs[t].Rows[r]
			var cells map[string]string
			for key, value := range row.Cells {
				next := renameTabInFormula(value, oldName, newName)
				if next == value {
					continue
				}
				if cells == nil {
					cells = make(map[string]string, len(row.Cells))
					for k, v := range row.Cells {
						cells[k] = v
					}
				}
				cells[key] = next
			}
			if cells != nil {
				row.Cells = cells
			}
		}
	}
}

// renameTab renames tabs[idx] and rewrites the formulas that read it. A name
// another tab already has is refused: saving would add " (2)" to one of them
// and the rewritten formulas would read the wrong tab.
func renameTab(tabs models.SheetTabs, idx int, name string) error {
	for i, tab := range tabs {
		if i != idx && sameTab(tab.Name, name) {
			return errors.New("another tab is already called " + tab.Name)
		}
	}
	renameTabRefs(tabs, tabs[idx].Name, name)
	tabs[idx].Name = name
	return nil
}
