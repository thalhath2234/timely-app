package suggest

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"timely-api/internal/features/decide"
	"timely-api/internal/models"
)

// The 51st item of a checklist was never asked about: every read sent the
// same first fifty, which Jev had already read as things kept in the doc.
func TestIntegrationDocChecklistAsksLaterItemsNext(t *testing.T) {
	w := newWorld(t)
	must(t, w.db.AutoMigrate(&decide.DecisionLog{}))
	doc := models.Document{ID: "doc_groceries", Title: "Groceries", WorkspaceID: w.ws, UserID: w.user, CreatedAt: "2026-10-01T09:00:00Z"}
	must(t, w.db.Create(&doc).Error)
	var names []string
	for i := 1; i <= maxChecklistAsk; i++ {
		names = append(names, fmt.Sprintf("Grocery item %d", i))
	}
	bank := "Call the bank about the mortgage"
	names = append(names, bank)

	jev := &jevStub{answers: map[string]any{}}
	for i := 1; i <= maxChecklistAsk; i++ {
		jev.answers[fmt.Sprintf("i%d", i)] = yesNo(0.05)
	}
	s := New(w.db, jev.serviceDB(t, w.db), nil)
	ctx := context.Background()
	out, err := s.DocChecklist(ctx, w.user, doc.ID, names, "")
	must(t, err)
	if len(out.Offer) != 0 || len(jev.asked(0)) != maxChecklistAsk {
		t.Fatalf("first read %+v, asked %d", out, len(jev.asked(0)))
	}

	// The next read asks the item it has not read first.
	jev.answers["i1"] = yesNo(0.95)
	out, err = s.DocChecklist(ctx, w.user, doc.ID, names, "")
	must(t, err)
	if len(out.Offer) != 1 || out.Offer[0] != bank {
		t.Fatalf("second read %+v", out)
	}
	items, _ := jev.requests[1].State["items"].([]any)
	first, _ := json.Marshal(items[0])
	if len(items) != maxChecklistAsk || string(first) != `{"item":"i1","text":"`+bank+`"}` {
		t.Fatalf("second read asked %s first of %d", first, len(items))
	}

	// A list that fits one call is read in its own order.
	short := []string{"Milk", "Eggs", "Renew the passport"}
	_, err = s.DocChecklist(ctx, w.user, "doc_groceries", short, "")
	must(t, err)
	items, _ = jev.requests[2].State["items"].([]any)
	if first, _ = json.Marshal(items[0]); string(first) != `{"item":"i1","text":"Milk"}` {
		t.Fatalf("short list asked %s first", first)
	}
}
