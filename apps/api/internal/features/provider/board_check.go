package provider

import (
	_ "embed"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/dop251/goja"
)

// The apps' own drawing of described cards (packages/contract/src/boardCheck.ts),
// bundled by `make gen-board-check`. The Describe AI's check_block tool runs
// a draft through it with the person's data and reads back what every block
// shows, drawn by the same code the dashboard and docs use.
//
//go:embed board/board-check.js
var boardCheckSource string

var boardCheckProgram = sync.OnceValues(func() (*goja.Program, error) {
	return goja.Compile("board-check.js", boardCheckSource, true)
})

// boardCheckTimeout stops a program that loops; the drawing takes well
// under a second on a large account.
const boardCheckTimeout = 10 * time.Second

// boardCheck is what a draft shows and what is wrong with it.
type boardCheck struct {
	Problems []string `json:"problems"`
	Shows    []string `json:"shows"`
}

type boardCheckRequest struct {
	Program  string          `json:"program"`
	Data     json.RawMessage `json:"data"`
	Now      string          `json:"now"`
	TimeZone string          `json:"timeZone,omitempty"`
}

// checkBoard draws program from data (the apps' DashboardData as JSON) as
// the apps would at now in zone, an IANA name or empty for the server's.
func checkBoard(program string, data json.RawMessage, now time.Time, zone string) (boardCheck, error) {
	compiled, err := boardCheckProgram()
	if err != nil {
		return boardCheck{}, err
	}
	if len(data) == 0 {
		data = json.RawMessage("{}")
	}
	input, err := json.Marshal(boardCheckRequest{Program: program, Data: data, Now: now.UTC().Format(time.RFC3339), TimeZone: zone})
	if err != nil {
		return boardCheck{}, err
	}
	vm := goja.New()
	timer := time.AfterFunc(boardCheckTimeout, func() { vm.Interrupt("the card took too long to draw") })
	defer timer.Stop()
	if err := vm.Set("hostZoneParts", zoneParts); err != nil {
		return boardCheck{}, err
	}
	if _, err := vm.RunProgram(compiled); err != nil {
		return boardCheck{}, err
	}
	check, ok := goja.AssertFunction(vm.Get("BoardCheck").ToObject(vm).Get("check"))
	if !ok {
		return boardCheck{}, errors.New("the board check has no check function")
	}
	result, err := check(goja.Undefined(), vm.ToValue(string(input)))
	if err != nil {
		return boardCheck{}, err
	}
	var out boardCheck
	err = json.Unmarshal([]byte(result.String()), &out)
	return out, err
}

var zones sync.Map // IANA name → *time.Location, or nil when unknown

// zoneParts gives the board check an instant's date and time in a zone,
// which the VM, having no Intl, can't work out: [year, month, day, hour,
// minute, second, weekday], or null for a zone Go doesn't know.
func zoneParts(ms float64, zone string) any {
	cached, ok := zones.Load(zone)
	if !ok {
		loc, err := time.LoadLocation(zone)
		if err != nil || zone == "" || zone == "Local" {
			loc = nil
		}
		cached, _ = zones.LoadOrStore(zone, loc)
	}
	loc, _ := cached.(*time.Location)
	if loc == nil {
		return nil
	}
	t := time.UnixMilli(int64(ms)).In(loc)
	return []any{t.Year(), int(t.Month()), t.Day(), t.Hour(), t.Minute(), t.Second(), int(t.Weekday())}
}
