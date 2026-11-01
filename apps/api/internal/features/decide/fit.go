package decide

import (
	"encoding/json"
	"unicode/utf8"
)

// fitFloor is the shortest a field is cut to: a title's first words still
// say what it is about.
const fitFloor = 24

// Fit shortens the named text fields of items until state's JSON fits in
// MaxStateBytes, cutting the field that takes the most encoded bytes first.
// Items are maps held inside state (or state itself), so cutting them cuts
// the state. Fields are cut by characters, but measured as JSON, where an
// "&" or "<" takes six bytes. It reports whether the state now fits.
func Fit(state any, items []map[string]any, fields ...string) bool {
	for {
		raw, err := json.Marshal(state)
		if err != nil {
			return false
		}
		if len(raw) <= MaxStateBytes {
			return true
		}
		var item map[string]any
		field, size := "", 0
		for _, it := range items {
			for _, f := range fields {
				s, ok := it[f].(string)
				if !ok || utf8.RuneCountInString(s) <= fitFloor {
					continue
				}
				if b, _ := json.Marshal(s); len(b) > size {
					item, field, size = it, f, len(b)
				}
			}
		}
		if item == nil {
			return false
		}
		r := []rune(item[field].(string))
		item[field] = string(r[:max(fitFloor, len(r)*3/4)])
	}
}
