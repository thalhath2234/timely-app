package suggest

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"timely-api/internal/features/decide"
)

func TestNamesCategory(t *testing.T) {
	for header, want := range map[string]bool{
		"Category": true, "Expense categories": true, "Shop name": true, "City": true, "Status": true,
		"Payment method": true, "Notes": false, "Description": false, "Name": false, "Amount": false,
	} {
		if got := namesCategory(header); got != want {
			t.Errorf("%q: got %v", header, got)
		}
	}
}

func TestCellFitAsksOnlyForCategoryEntries(t *testing.T) {
	jev := &jevStub{answers: map[string]any{"fit": choice("misfit")}}
	s := New(nil, jev.service(t), nil)
	ctx := context.Background()
	values := []string{"Groceries", "Rent 2026", "Transport", ""}
	skip := []CellFitInput{
		{Column: "Amount", Type: "currency", Value: "Paris", Values: values},   // typed column: code checks
		{Column: "Notes", Type: "text", Value: "Paris", Values: values},        // free text header
		{Column: "Category", Type: "text", Value: "groceries", Values: values}, // already in the column
		{Column: "Category", Type: "text", Value: "12.50", Values: values},     // only a number
		{Column: "Category", Type: "text", Value: "=A1", Values: values},       // a formula
		{Column: "Category", Type: "text", Value: "Paris", Values: []string{"Rent"}},
	}
	for _, in := range skip {
		out, err := s.CellFit(ctx, "u1", in)
		if err != nil || !out.Available || out.Misfit {
			t.Fatalf("%+v: %+v %v", in, out, err)
		}
	}
	if len(jev.requests) != 0 {
		t.Fatalf("asked %d times for entries code settles", len(jev.requests))
	}

	out, err := s.CellFit(ctx, "u1", CellFitInput{Column: "Category", Type: "text", Value: "Paris 75001", Values: values})
	if err != nil || !out.Misfit || out.Hint != "This may not fit the Category column." {
		t.Fatalf("%+v %v", out, err)
	}
	if len(jev.requests) != 1 || len(jev.requests[0].Questions) != 2 {
		t.Fatalf("want one call asking twice, got %+v", jev.requests)
	}
	state, _ := json.Marshal(jev.requests[0].State)
	if strings.Contains(string(state), "2026") || strings.Contains(string(state), "75001") || !strings.Contains(string(state), "Rent #") {
		t.Fatalf("numbers not masked: %s", state)
	}

	// A select column counts whatever its header, and its options are examples.
	jev.answers["fit"] = choice("fits")
	out, _ = s.CellFit(ctx, "u1", CellFitInput{Column: "Done?", Type: "select", Value: "Later", Options: []string{"Open", "Closed"}})
	if out.Misfit || len(jev.requests) != 2 {
		t.Fatalf("%+v after %d calls", out, len(jev.requests))
	}

	// Below Flag confidence there is no hint.
	jev.answers["fit"] = map[string]any{"type": "choice", "choice": "misfit", "confidence": 0.4}
	out, _ = s.CellFit(ctx, "u1", CellFitInput{Column: "City", Type: "text", Value: "Banana", Values: []string{"Paris", "Rome"}})
	if out.Misfit {
		t.Fatalf("low confidence still hinted: %+v", out)
	}

	off := New(nil, decide.New(nil, func(context.Context, string) (decide.Keys, error) { return decide.Keys{}, nil }, decide.NewClient(nil)), nil)
	if out, _ := off.CellFit(ctx, "u1", CellFitInput{Column: "Category", Type: "text", Value: "Paris", Values: values}); out.Available || out.Misfit {
		t.Fatal("suggestions off still answered")
	}
}

func TestCellFitHandler(t *testing.T) {
	jev := &jevStub{answers: map[string]any{"fit": choice("misfit")}}
	s := New(nil, jev.service(t), nil)
	rec, err := call(t, s.cellFit, "u1", "POST", "/suggestions/cell-fit", map[string]any{
		"column": "Merchant", "type": "text", "value": "Groceries", "values": []string{"Tesco", "Aldi", "Lidl"},
	})
	if err != nil || rec.Code != 200 {
		t.Fatal(rec.Code, err)
	}
	var out CellFit
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if !out.Available || !out.Misfit || out.Hint != "This may not fit the Merchant column." {
		t.Fatalf("%s", rec.Body.String())
	}
}
