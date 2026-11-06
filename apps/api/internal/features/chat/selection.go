package chat

import (
	"encoding/json"
	"slices"

	"github.com/labstack/echo/v5"
)

// stepApproved marks the changes a partial approval applies now; the others
// stay "pending" for review.
const stepApproved = "approved"

// planSelection checks plan indexes sent by a client.
func planSelection(plan []Step, steps []int) ([]int, error) {
	for _, i := range steps {
		if i < 0 || i >= len(plan) {
			return nil, echo.NewHTTPError(400, "That change is not part of this proposal")
		}
	}
	return steps, nil
}

// stepRefs are the earlier steps a step builds on through "$N.path".
func stepRefs(plan []Step, i int) []int {
	var value any
	if json.Unmarshal(plan[i].Arguments, &value) != nil {
		return nil
	}
	var refs []int
	walkRefs(value, func(n int) int {
		if n >= 0 && n < i && !slices.Contains(refs, n) {
			refs = append(refs, n)
		}
		return n
	})
	return refs
}

// withDependencies adds every step the chosen ones build on, transitively.
func withDependencies(plan []Step, chosen []int) []int {
	seen := map[int]bool{}
	var visit func(int)
	visit = func(i int) {
		if seen[i] {
			return
		}
		seen[i] = true
		for _, ref := range stepRefs(plan, i) {
			visit(ref)
		}
	}
	for _, i := range chosen {
		visit(i)
	}
	return sortedKeys(seen)
}

// withDependents adds every step that builds on the chosen ones, transitively.
func withDependents(plan []Step, chosen []int) []int {
	seen := map[int]bool{}
	for _, i := range chosen {
		seen[i] = true
	}
	for i := range plan {
		if seen[i] {
			continue
		}
		for _, ref := range stepRefs(plan, i) {
			if seen[ref] {
				seen[i] = true
				break
			}
		}
	}
	return sortedKeys(seen)
}

func sortedKeys(set map[int]bool) []int {
	out := make([]int, 0, len(set))
	for i := range set {
		out = append(out, i)
	}
	slices.Sort(out)
	return out
}

// hasPending reports whether any change still waits to be applied.
func hasPending(plan []Step) bool {
	for _, step := range plan {
		if step.Status != "done" && step.Status != "discarded" {
			return true
		}
	}
	return false
}
