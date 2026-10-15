package sheet

import (
	_ "embed"
	"encoding/json"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/dop251/goja"

	"timely-api/internal/models"
)

// The apps' own formula engine (packages/contract/src/sheetEngine.ts), bundled
// by `make gen-sheet-engine`. Running it here gives agents the values a person
// sees, with no second engine to keep in step.
//
//go:embed engine/sheet-engine.js
var engineSource string

var engineProgram = sync.OnceValues(func() (*goja.Program, error) {
	return goja.Compile("sheet-engine.js", engineSource, true)
})

// engineTimeout stops a runaway workbook; the apps cap formula depth too.
const engineTimeout = 10 * time.Second

// CellValue is a worked-out cell: a float64, string, bool, nil when empty, or
// map{"error": "#DIV/0!"}.
type CellValue = any

type engineRequest struct {
	Tabs    models.SheetTabs `json:"tabs"`
	Formula *string          `json:"formula,omitempty"`
	TabID   string           `json:"tabId,omitempty"`
}

func runEngine(request engineRequest, out any) error {
	return callEngine("evaluate", request, out)
}

// callEngine runs one of the bundle's exported functions, which take and
// return JSON.
func callEngine(name string, request any, out any) error {
	program, err := engineProgram()
	if err != nil {
		return err
	}
	input, err := json.Marshal(request)
	if err != nil {
		return err
	}
	vm := goja.New()
	timer := time.AfterFunc(engineTimeout, func() { vm.Interrupt("the sheet took too long to work out") })
	defer timer.Stop()
	if _, err := vm.RunProgram(program); err != nil {
		return err
	}
	evaluate, ok := goja.AssertFunction(vm.Get("SheetEngine").ToObject(vm).Get(name))
	if !ok {
		return errors.New("sheet engine has no " + name + " function")
	}
	result, err := evaluate(goja.Undefined(), vm.ToValue(string(input)))
	if err != nil {
		return err
	}
	return json.Unmarshal([]byte(result.String()), out)
}

// SheetValues works out every cell of every tab, indexed [tab][row][column]
// in the order of WorkbookTabs(sh).
func SheetValues(sh *models.Sheet) ([][][]CellValue, error) {
	var out struct {
		Tabs [][][]CellValue `json:"tabs"`
	}
	err := runEngine(engineRequest{Tabs: WorkbookTabs(sh)}, &out)
	return out.Tabs, err
}

// EvaluateFormula works out formula on one tab (an empty id is the first tab)
// without saving it, as if it were typed in a cell past the tab's last row
// and column.
func EvaluateFormula(sh *models.Sheet, tabID, formula string) (CellValue, error) {
	tabs := WorkbookTabs(sh)
	if _, err := findTab(tabs, tabID); err != nil {
		return nil, err
	}
	var out struct {
		Value CellValue `json:"value"`
	}
	err := runEngine(engineRequest{Tabs: tabs, Formula: &formula, TabID: tabID}, &out)
	return out.Value, err
}

// WorkbookTabs returns the sheet's tabs, wrapping a sheet that only stores its
// primary grid as one tab.
func WorkbookTabs(sh *models.Sheet) models.SheetTabs {
	return workbookTabs(sh)
}

// structureChange is one insert or delete as the apps describe it: at is the
// first 0-based row or column, count how many.
type structureChange struct {
	Kind  string `json:"kind"`
	Axis  string `json:"axis"`
	At    int    `json:"at"`
	Count int    `json:"count"`
}

// deleteFromTab removes rows (axis "row") or columns ("col") of one tab, given
// by 0-based index, with the apps' own logic: formulas on every tab keep
// pointing at the same cells (=IF(G7...) on the row below a deleted row 6
// becomes =IF(G6...)), references to deleted cells become #REF!, and merges,
// frozen panes and colour rules follow.
func deleteFromTab(tabs models.SheetTabs, tabID, axis string, indexes []int) (models.SheetTabs, error) {
	sorted := append([]int{}, indexes...)
	sort.Sort(sort.Reverse(sort.IntSlice(sorted)))
	// Bottom block first, so the blocks above keep their positions.
	var changes []structureChange
	for _, index := range sorted {
		if n := len(changes); n > 0 && changes[n-1].At == index+1 {
			changes[n-1].At, changes[n-1].Count = index, changes[n-1].Count+1
			continue
		} else if n > 0 && changes[n-1].At <= index {
			continue // a repeated index
		}
		changes = append(changes, structureChange{Kind: "delete", Axis: axis, At: index, Count: 1})
	}
	request := struct {
		Tabs    models.SheetTabs  `json:"tabs"`
		TabID   string            `json:"tabId"`
		Changes []structureChange `json:"changes"`
	}{Tabs: make(models.SheetTabs, len(tabs)), TabID: tabID, Changes: changes}
	for i, tab := range tabs {
		if tab.Columns == nil {
			tab.Columns = models.SheetColumns{}
		}
		if tab.Rows == nil {
			tab.Rows = models.SheetRows{}
		}
		request.Tabs[i] = tab
	}
	var out struct {
		Tabs models.SheetTabs `json:"tabs"`
	}
	if err := callEngine("restructure", request, &out); err != nil {
		return nil, err
	}
	if len(out.Tabs) != len(tabs) {
		return nil, errors.New("sheet engine lost tabs")
	}
	return out.Tabs, nil
}
