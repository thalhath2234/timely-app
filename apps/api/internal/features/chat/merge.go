package chat

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// A merged plan keeps, for each of its steps, the model's own step numbers
// (1-based) it came from, so errors sent back to the model name the steps it
// wrote.
type stepOrigins [][]int

// label names merged step i as the model numbered it: "Step 3", or
// "Steps 3–12" for a run merged into one.
func (o stepOrigins) label(i int) string {
	if i >= len(o) || len(o[i]) == 0 {
		return fmt.Sprintf("Step %d", i+1)
	}
	if first, last := o[i][0], o[i][len(o[i])-1]; first != last {
		return fmt.Sprintf("Steps %d–%d", first, last)
	}
	return fmt.Sprintf("Step %d", o[i][0])
}

// first is the model's zero-based index of merged step i's first part, for
// "$N" examples in errors.
func (o stepOrigins) first(i int) int {
	if i >= len(o) || len(o[i]) == 0 {
		return i
	}
	return o[i][0] - 1
}

func identityOrigins(n int) stepOrigins {
	o := make(stepOrigins, n)
	for i := range o {
		o[i] = []int{i + 1}
	}
	return o
}

type entryRowIn struct {
	SheetID string          `json:"sheetId"`
	TabID   string          `json:"tabId"`
	Cells   json.RawMessage `json:"cells"`
}

// mergeSheetEntries turns each run of consecutive add_sheet_row steps on the
// same sheet and tab into one add_sheet_entries step, so a request for many
// entries ("sample expenses for three months") is one change per tab: one
// review item, one save, one undo, instead of one per row. A run is left as
// it is when a step refers to one of its rows ("$4.row"), and references to
// steps after a run are renumbered.
func mergeSheetEntries(steps []Step) ([]Step, stepOrigins) {
	// Only a reference to an earlier step is one ("$5.00" in a later step's
	// cell is a price, and resolve rejects it anyway).
	referenced := map[int]bool{}
	for i, step := range steps {
		var value any
		if json.Unmarshal(step.Arguments, &value) == nil {
			walkRefs(value, func(n int) int {
				if n >= 0 && n < i {
					referenced[n] = true
				}
				return n
			})
		}
	}
	type run struct{ start, end int }
	var runs []run
	for i := 0; i < len(steps); {
		j := i + 1
		if key, ok := entryKey(steps[i]); ok {
			for j < len(steps) {
				next, ok := entryKey(steps[j])
				if !ok || next != key {
					break
				}
				j++
			}
		}
		clean := j-i > 1
		for k := i; k < j && clean; k++ {
			clean = !referenced[k]
		}
		if clean {
			runs = append(runs, run{i, j})
		}
		i = j
	}
	if len(runs) == 0 {
		return steps, identityOrigins(len(steps))
	}
	// Where each of the model's steps lands in the merged plan.
	index := make([]int, len(steps))
	at, next := 0, 0
	for i := 0; i < len(steps); {
		if next < len(runs) && runs[next].start == i {
			for k := runs[next].start; k < runs[next].end; k++ {
				index[k] = at
			}
			i = runs[next].end
			next++
		} else {
			index[i] = at
			i++
		}
		at++
	}
	renumbered := make([]Step, len(steps))
	for i, step := range steps {
		renumbered[i] = step
		var value any
		if json.Unmarshal(step.Arguments, &value) != nil {
			continue
		}
		changed := false
		value = walkRefs(value, func(n int) int {
			if n >= 0 && n < i && index[n] != n {
				changed = true
				return index[n]
			}
			return n
		})
		if changed {
			renumbered[i].Arguments = raw(value)
		}
	}
	steps = renumbered
	merged := make([]Step, 0, at)
	origins := make(stepOrigins, 0, at)
	next = 0
	for i := 0; i < len(steps); {
		if next < len(runs) && runs[next].start == i {
			r := runs[next]
			next++
			parts := []int{}
			for k := r.start; k < r.end; k++ {
				parts = append(parts, k+1)
			}
			merged = append(merged, entriesStep(steps[r.start:r.end]))
			origins = append(origins, parts)
			i = r.end
			continue
		}
		merged = append(merged, steps[i])
		origins = append(origins, []int{i + 1})
		i++
	}
	return merged, origins
}

// entryKey is the sheet and tab an add_sheet_row step writes to. Tabs match
// by id or name as written, ignoring case and spaces at the ends.
func entryKey(step Step) (string, bool) {
	if step.Tool != "add_sheet_row" {
		return "", false
	}
	var in entryRowIn
	if json.Unmarshal(step.Arguments, &in) != nil || in.SheetID == "" || len(in.Cells) == 0 {
		return "", false
	}
	return in.SheetID + "\x00" + strings.ToLower(strings.TrimSpace(in.TabID)), true
}

func entriesStep(run []Step) Step {
	var first entryRowIn
	_ = json.Unmarshal(run[0].Arguments, &first)
	entries := make([]map[string]json.RawMessage, len(run))
	for i, step := range run {
		var in entryRowIn
		_ = json.Unmarshal(step.Arguments, &in)
		entries[i] = map[string]json.RawMessage{"cells": in.Cells}
	}
	args := map[string]any{"sheetId": first.SheetID, "entries": entries}
	if first.TabID != "" {
		args["tabId"] = first.TabID
	}
	where := "one tab"
	if tab := strings.TrimSpace(first.TabID); tab != "" && !strings.HasPrefix(tab, "tab_") && !strings.HasPrefix(tab, "$") {
		where = tab
	}
	return Step{
		Tool:      "add_sheet_entries",
		Summary:   fmt.Sprintf("Add %d entries to %s", len(run), where),
		Arguments: raw(args),
		Status:    run[0].Status,
	}
}

// walkRefs calls fn with the step number of every "$N.path" reference in a
// decoded JSON value and writes back the number fn returns.
func walkRefs(value any, fn func(int) int) any {
	switch v := value.(type) {
	case string:
		if !strings.HasPrefix(v, "$") {
			return v
		}
		number, path, ok := strings.Cut(v[1:], ".")
		if !ok {
			return v
		}
		n, err := strconv.Atoi(number)
		if err != nil {
			return v
		}
		return "$" + strconv.Itoa(fn(n)) + "." + path
	case []any:
		for i := range v {
			v[i] = walkRefs(v[i], fn)
		}
		return v
	case map[string]any:
		for k := range v {
			v[k] = walkRefs(v[k], fn)
		}
		return v
	}
	return value
}
