package chat

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"timely-api/internal/features/decide"
	"timely-api/internal/models"
)

// jevBy answers each question with answer(id, instructions); nil leaves it
// unanswered. The second order of a Twice question ("m1__2") gets the same
// answer. It also records each request body.
func jevBy(t *testing.T, answer func(id, instructions string) any) (*decide.Service, *[]string) {
	t.Helper()
	var mu sync.Mutex
	bodies := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req struct {
			Questions map[string]struct {
				Instructions string `json:"instructions"`
			} `json:"questions"`
		}
		_ = json.Unmarshal(body, &req)
		out := map[string]any{}
		for id, q := range req.Questions {
			if a := answer(strings.TrimSuffix(id, "__2"), q.Instructions); a != nil {
				out[id] = a
			}
		}
		mu.Lock()
		bodies = append(bodies, string(body))
		mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"answers": out})
	}))
	t.Cleanup(srv.Close)
	client := decide.NewClient(nil)
	client.TypeSafeURL = srv.URL
	keys := func(context.Context, string) (decide.Keys, error) {
		return decide.Keys{Enabled: true, TypeSafe: "ts-test-key"}, nil
	}
	return decide.New(nil, keys, client), &bodies
}

func TestSheetChangeInWords(t *testing.T) {
	before := models.Sheet{Tabs: models.SheetTabs{{ID: "t", Name: "Budget",
		Columns: models.SheetColumns{{ID: "a", Name: "Item", Type: "text"}, {ID: "b", Name: "Cost", Type: "text"}, {ID: "c", Name: "Notes", Type: "text"}},
		Rows:    models.SheetRows{{ID: "r1", Cells: map[string]string{"a": "Rent", "b": "900"}}, {ID: "r2", Cells: map[string]string{"a": "Food", "b": "300"}}}}}}
	after := models.SheetTabs{{ID: "t", Name: "Budget",
		Columns: models.SheetColumns{{ID: "a", Name: "Item", Type: "text"}, {ID: "b", Name: "Amount", Type: "currency"}, {ID: "d", Name: "Due", Type: "date"}},
		Rows:    models.SheetRows{{ID: "r1", Cells: map[string]string{"a": "Rent", "b": "950"}}, {ID: "r3", Cells: map[string]string{"a": "Gym", "b": "40"}}}}}
	got := sheetChange(before, raw(map[string]any{"sheetId": "s", "tabs": after}))
	for _, want := range []string{"tab “Budget”", "adds columns “Due”", "removes columns “Notes”", "renames “Cost” to “Amount”", "“Amount” from text to currency", "adds 1 row", "removes 1 row", "edits 1 row"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in %q", want, got)
		}
	}
	if sheetChange(before, raw(map[string]any{"sheetId": "s", "tabs": before.Tabs})) != "" {
		t.Fatal("an unchanged sheet described a change")
	}
}

func TestIncludedHintsOnlyWhenTheyReconcile(t *testing.T) {
	r := receiptFixture()
	r.Tax, r.Total = "30", "300" // prices already include the 30 tax
	if hints := includedHints("en", r); len(hints) != 1 || !strings.Contains(hints[0], "Tax included") {
		t.Fatal(hints)
	}
	r.Total = "333" // reconciles neither way
	if hints := includedHints("en", r); len(hints) != 0 {
		t.Fatal(hints)
	}
	if hints := includedHints("en", receiptFixture()); len(hints) != 0 {
		t.Fatal("a balanced receipt got a hint", hints)
	}
}

func householdSheet(uid string) models.Sheet {
	cols := models.SheetColumns{{ID: "m", Name: "Merchant", Type: "text"}, {ID: "d", Name: "Date", Type: "date"}, {ID: "cur", Name: "Currency", Type: "text"}, {ID: "tot", Name: "Total", Type: "currency"}, {ID: "cat", Name: "Category", Type: "text"}}
	return models.Sheet{ID: "household", Title: "Household", UserID: uid, WorkspaceID: "workspace", Tabs: models.SheetTabs{{ID: "spend", Name: "Spending", Columns: cols, Rows: models.SheetRows{
		{ID: "x1", Cells: map[string]string{"m": "Bus", "d": "2026-09-20", "cur": "JPY", "tot": "220", "cat": "Transport"}},
		{ID: "x2", Cells: map[string]string{"m": "CORNER SHOP #12", "d": "2026-09-28", "cur": "JPY", "tot": "330", "cat": "groceries"}},
		{ID: "x3", Cells: map[string]string{"m": "Market", "d": "2026-09-25", "cur": "JPY", "tot": "1200", "cat": "Groceries"}},
	}}}}
}

func TestIntegrationReceiptHints(t *testing.T) {
	db := integrationDB(t)
	if err := db.Create(&models.Workspace{ID: "workspace", Name: "Personal"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(ptr(householdSheet("user-a"))).Error; err != nil {
		t.Fatal(err)
	}
	jev, bodies := jevBy(t, func(id, _ string) any {
		switch id {
		case "category":
			return choice("Groceries", 0.9)
		case "refund":
			return yesNo(0.05)
		case "same1":
			return yesNo(0.95)
		case "destination":
			return choice("t1", 0.85)
		}
		return nil
	})
	s := New(db, fakeSheetCatalog, nil)
	s.SetDecisions(jev)
	c := runFixture(t, db, nil)
	r := receiptFixture()
	r.Category = "Food"
	r.Items[0].Category = "Food"
	r.Items[1].Category = "Drinks"
	hints, suggested := s.receiptHints(context.Background(), &c, &r, true)
	if r.Category != "Groceries" || r.Items[0].Category != "Groceries" || r.Items[1].Category != "Drinks" {
		t.Fatalf("category not pre-filled from the person's list: %+v", r)
	}
	joined := strings.Join(hints, "\n")
	if !strings.Contains(joined, "Category set to") || !strings.Contains(joined, "CORNER SHOP #12 on 2026-09-28") || strings.Contains(joined, "refund") {
		t.Fatal(hints)
	}
	if suggested == nil || suggested.SheetID != "household" || suggested.ExpenseTabID != "spend" || suggested.WorkspaceID != "workspace" {
		t.Fatalf("destination not suggested: %+v", suggested)
	}
	for _, leak := range []string{"330", "300", "base64"} {
		if strings.Contains((*bodies)[0], `"`+leak+`"`) {
			t.Fatalf("amount or image sent to Jev: %s", (*bodies)[0])
		}
	}

	// A correction the person typed keeps their category; a known category
	// is checked for fit instead.
	typed := receiptFixture()
	typed.Category = "Transport"
	jev2, _ := jevBy(t, func(id, _ string) any {
		if id == "fits" {
			return yesNo(0.02)
		}
		return nil
	})
	s.SetDecisions(jev2)
	hints, _ = s.receiptHints(context.Background(), &c, &typed, false)
	if typed.Category != "Transport" || len(hints) != 1 || !strings.Contains(hints[0], "“Transport” may not be") {
		t.Fatal(typed.Category, hints)
	}

	// Off: nothing asked, nothing changed.
	s.SetDecisions(nil)
	off := receiptFixture()
	if hints, suggested := s.receiptHints(context.Background(), &c, &off, true); hints != nil || suggested != nil || off.Category != "" {
		t.Fatal("suggestions off changed the receipt")
	}
}

func ptr[T any](v T) *T { return &v }

type failingCompleter struct{ t *testing.T }

func (f failingCompleter) Complete(context.Context, []WireMessage, []any, bool) (WireMessage, error) {
	f.t.Error("the model was called for a message that changes nothing")
	return WireMessage{}, errors.New("unexpected call")
}

func TestIntegrationReceiptMessageThatChangesNothingSkipsTheModel(t *testing.T) {
	db := integrationDB(t)
	jev, _ := jevBy(t, func(id, _ string) any {
		if id == "change" {
			return yesNo(0.03)
		}
		return nil
	})
	s := New(db, fakeSheetCatalog, failingCompleter{t})
	s.SetDecisions(jev)
	c := runFixture(t, db, nil)
	r := receiptFixture()
	c.Phase = "receipt_edit"
	c.Messages = []Message{message("user", "Read my receipt"), message("user", "thanks, looks good")}
	c.ImageReview = &ImageReview{Status: "extracting", ReceiptID: "r", Receipt: &r}
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.editReceipt(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	last := c.Messages[len(c.Messages)-1]
	if c.Status != "idle" || c.Phase != "review" || c.ImageReview.Status != "review" || !strings.Contains(last.Content, "doesn't look like a change") {
		t.Fatalf("status %s phase %s message %q", c.Status, c.Phase, last.Content)
	}
	if c.ImageReview.Receipt.Total != "330" {
		t.Fatal("draft changed")
	}
}

func TestIntegrationReceiptColumnsMatchExistingNames(t *testing.T) {
	db := integrationDB(t)
	if err := db.Create(&models.Workspace{ID: "workspace", Name: "Personal"}).Error; err != nil {
		t.Fatal(err)
	}
	sh := models.Sheet{ID: "sheet", Title: "Spending", UserID: "user-a", WorkspaceID: "workspace", Tabs: models.SheetTabs{{ID: "expenses", Name: "Expenses",
		Columns: models.SheetColumns{{ID: "shop", Name: "Shop", Type: "text"}, {ID: "when", Name: "Date", Type: "date"}, {ID: "paid", Name: "Paid with", Type: "text"}, {ID: "sum", Name: "Grand total", Type: "number"}},
		Rows:    models.SheetRows{{ID: "old", Cells: map[string]string{"shop": "Bakery", "when": "2026-09-01", "paid": "Card", "sum": "5"}}}}}}
	if err := db.Create(&sh).Error; err != nil {
		t.Fatal(err)
	}
	// Option names are k1.. in column order of the unmatched columns: Shop,
	// Paid with, Grand total.
	jev, _ := jevBy(t, func(id, instructions string) any {
		switch {
		case strings.Contains(instructions, "receipt's “Merchant”"):
			return choice("k1", 0.95)
		case strings.Contains(instructions, "receipt's “Total”"):
			return choice("k3", 0.95)
		case strings.Contains(instructions, "receipt's “Tax”"):
			return choice("k1", 0.95) // already taken by Merchant: ignored
		}
		return choice("none", 0.95)
	})
	s := New(db, fakeSheetCatalog, nil)
	s.SetDecisions(jev)
	d := &ReceiptDestination{SheetID: sh.ID, ExpenseTabID: "expenses"}
	matches := s.receiptColumnMatches(context.Background(), "user-a", d)
	if matches[columnKey("expenses", "Merchant")] != "shop" || matches[columnKey("expenses", "Total")] != "sum" || matches[columnKey("expenses", "Tax")] != "" {
		t.Fatalf("matches %v", matches)
	}
	c := runFixture(t, db, nil)
	r := receiptFixture()
	c.ImageReview = &ImageReview{Status: "review", ReceiptID: "receipt-one", Receipt: &r, Destination: d, Columns: matches}
	if err := s.buildReceiptProposal(context.Background(), db, &c); err != nil {
		t.Fatal(err)
	}
	var input struct {
		Tabs models.SheetTabs `json:"tabs"`
	}
	if err := json.Unmarshal(c.Plan[0].Arguments, &input); err != nil {
		t.Fatal(err)
	}
	tab := input.Tabs[0]
	added := tab.Rows[len(tab.Rows)-1]
	if added.Cells["shop"] != "Corner Shop" || added.Cells["sum"] != "330" {
		t.Fatalf("receipt not written to the matched columns: %v", added.Cells)
	}
	for _, col := range tab.Columns {
		if col.Name == "Merchant" || col.Name == "Total" {
			t.Fatalf("added a %s column next to the matched one", col.Name)
		}
	}
	if !strings.Contains(c.Plan[0].Summary, "Merchant in “Shop”") {
		t.Fatal(c.Plan[0].Summary)
	}
}

func TestIntegrationReviewNotesFlagSheetChanges(t *testing.T) {
	db := integrationDB(t)
	if err := db.Create(&models.Workspace{ID: "workspace", Name: "Personal"}).Error; err != nil {
		t.Fatal(err)
	}
	sh := householdSheet("user-a")
	if err := db.Create(&sh).Error; err != nil {
		t.Fatal(err)
	}
	next := sh.Tabs
	next[0].Columns = next[0].Columns[:4] // drops Category
	jev, bodies := jevBy(t, func(id, _ string) any {
		switch id {
		case "asked1":
			return yesNo(0.9)
		case "missing":
			return yesNo(0.05)
		case "sheet1":
			return yesNo(0.95)
		}
		return nil
	})
	s := New(db, fakeSheetCatalog, nil)
	s.SetDecisions(jev)
	c := runFixture(t, db, nil)
	c.Messages = []Message{message("user", "Add a Notes column to my household sheet")}
	p := proposal{Steps: []Step{{Tool: "update_sheet", Summary: "Update the household sheet", Arguments: raw(map[string]any{"sheetId": sh.ID, "tabs": next})}}}
	notes := s.reviewNotes(context.Background(), &c, p)
	if len(notes) != 1 || !strings.Contains(notes[0], "removes columns “Category”") {
		t.Fatal(notes)
	}
	if !strings.Contains((*bodies)[0], "sheetChanges") {
		t.Fatal("sheet changes not described to Jev")
	}
}
