package sheet

import (
	_ "embed"
	"encoding/json"
	"errors"
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
	evaluate, ok := goja.AssertFunction(vm.Get("SheetEngine").ToObject(vm).Get("evaluate"))
	if !ok {
		return errors.New("sheet engine has no evaluate function")
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
