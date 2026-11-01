package suggest

import (
	"fmt"
	"testing"
)

// Sixty-six close label pairs filled every question, so the options "Paid"
// and "paid " were never asked about.
func TestCleanupPairsKeepRoomForEveryList(t *testing.T) {
	labels := taxonomyGroup{kind: "label", noun: "label"}
	for c := 'A'; c <= 'L'; c++ {
		labels.items = append(labels.items, CleanupItem{ID: string(c), Name: fmt.Sprintf("Client %c", c)})
	}
	statuses := taxonomyGroup{kind: "status", noun: "status", items: []CleanupItem{
		{ID: "s1", Name: "To do"}, {ID: "s2", Name: "Todo"}, {ID: "s3", Name: "Done"},
	}}
	paid := taxonomyGroup{kind: "option", noun: "option", fieldID: "cf", fieldName: "Payment", items: []CleanupItem{
		{ID: "o1", Name: "Unpaid"}, {ID: "o2", Name: "Paid"}, {ID: "o3", Name: "paid "},
	}}
	pairs := cleanupPairs([]taxonomyGroup{labels, statuses, paid})
	if len(pairs) != maxPairs {
		t.Fatalf("%d pairs", len(pairs))
	}
	// The exact duplicate comes first, then the lists take turns.
	if first := pairs[0]; first.group != 2 || first.a.ID != "o2" || first.b.ID != "o3" {
		t.Fatalf("first pair %+v", first)
	}
	if pairs[1].group != 0 || pairs[2].group != 1 || pairs[3].group != 2 {
		t.Fatalf("turns %d %d %d", pairs[1].group, pairs[2].group, pairs[3].group)
	}
	asked := map[string]bool{}
	for _, p := range pairs {
		asked[p.a.ID+"+"+p.b.ID] = true
	}
	if !asked["s1+s2"] || !asked["o1+o2"] {
		t.Fatal("a status or option pair was crowded out")
	}

	if !sameName(" Paid", "paid  ") || sameName("Paid", "Unpaid") || sameName(" ", "") {
		t.Fatal("sameName")
	}
}
