package suggest

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"timely-api/internal/features/decide"
)

func TestFitCommentsKeepsTheNewest(t *testing.T) {
	got := fitComments([]string{strings.Repeat("a", 500), strings.Repeat("b", 500), strings.Repeat("c", 500)}, 600)
	if len(got) != 2 || got[0] != strings.Repeat("b", 100) || got[1] != strings.Repeat("c", 500) {
		t.Fatalf("%d comments, %q…", len(got), got[0][:5])
	}
	if got := fitComments([]string{"one", "two"}, 600); len(got) != 2 || got[0] != "one" {
		t.Fatalf("short comments changed: %q", got)
	}
	if got := fitComments(nil, 600); len(got) != 0 {
		t.Fatalf("%q", got)
	}
}

// Every task at the code's own limits, in a script of wide characters, is
// far past what Jev takes; the oldest items go until the state fits, from
// both lists.
func TestReasonsRequestFitsTheStateLimit(t *testing.T) {
	note := func(prefix string, i int) workNote {
		wide := func(n int) string { return strings.Repeat("語", n) }
		return workNote{ID: fmt.Sprintf("%s%d", prefix, i), Name: wide(200), Description: wide(300),
			Facts: []string{"waits on the task “" + wide(120) + "”"}, Comments: []string{wide(500), wide(500), wide(500)}}
	}
	var blocked, missed []workNote
	for i := 0; i < maxBlocked; i++ {
		blocked = append(blocked, note("b", i))
	}
	for i := 0; i < maxMissed; i++ {
		missed = append(missed, note("m", i))
	}
	b, m, state, questions := reasonsRequest(blocked, missed)
	raw, _ := json.Marshal(state)
	if len(raw) > decide.MaxStateBytes {
		t.Fatalf("state is %d bytes", len(raw))
	}
	if len(b) == 0 || len(m) == 0 || len(b) == maxBlocked || len(questions) != len(b)+len(m) {
		t.Fatalf("asked %d blocked, %d missed, %d questions", len(b), len(m), len(questions))
	}
	// The newest of each list are the ones kept.
	if b[0].ID != "b0" || m[0].ID != "m0" || b[len(b)-1].ID != fmt.Sprintf("b%d", len(b)-1) {
		t.Fatalf("kept %s… and %s…", b[0].ID, m[0].ID)
	}
	if _, ok := questions[fmt.Sprintf("b%d", len(b)+1)]; ok {
		t.Fatal("a question for a dropped item")
	}

	// Plain text at the same limits fits whole once comments are capped.
	ascii := func(prefix string, i int) workNote {
		return workNote{ID: fmt.Sprintf("%s%d", prefix, i), Name: strings.Repeat("x", 200), Description: strings.Repeat("x", 300),
			Facts: []string{"waits on the task “" + strings.Repeat("x", 120) + "”"}, Comments: []string{strings.Repeat("x", 500), strings.Repeat("x", 500), strings.Repeat("x", 500)}}
	}
	blocked, missed = nil, nil
	for i := 0; i < maxBlocked; i++ {
		blocked = append(blocked, ascii("b", i))
	}
	for i := 0; i < maxMissed; i++ {
		missed = append(missed, ascii("m", i))
	}
	if b, m, _, _ := reasonsRequest(blocked, missed); len(b) != maxBlocked || len(m) != maxMissed {
		t.Fatalf("plain text dropped items: %d blocked, %d missed", len(b), len(m))
	}
}
