package search

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"timely-api/internal/features/decide"
	"timely-api/internal/features/embed"
)

// capturingJev keeps the body of the last call and answers nothing.
func capturingJev(t *testing.T, body *string) Decider {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		*body = string(raw)
		_, _ = w.Write([]byte(`{"model":"jev-1.13.0","answers":{}}`))
	}))
	t.Cleanup(srv.Close)
	client := decide.NewClient(nil)
	client.TypeSafeURL = srv.URL
	keys := decide.Keys{Enabled: true, TypeSafe: "ts-test-key-123"}
	return decide.New(nil, func(context.Context, string) (decide.Keys, error) { return keys, nil }, client)
}

var receiptDigits = regexp.MustCompile(`54\.20|4421|12\.99`)

// Related and smart search sent a sheet's cells, receipt amounts and card
// digits included, while the receipt flow masks them.
func TestSheetNumbersAreMaskedForJev(t *testing.T) {
	cells := "Expenses Merchant: Tesco · Amount: 54.20 · Card: 4421 · Lidl 12.99"
	var body string
	idx := nearIndexer{near: []embed.Hit{
		{Kind: "sheet", EntityID: "s1", Title: "Grocery budget", Content: cells},
		{Kind: "doc", EntityID: "d1", Title: "Plan", Content: "Spend 54.20 on the 3 bags"},
	}}
	if _, err := NewSmart(nil, idx, capturingJev(t, &body)).Related(context.Background(), "u1", "doc", "d9"); err != nil {
		t.Fatal(err)
	}
	if body == "" {
		t.Fatal("no call was made")
	}
	sheet := body[strings.Index(body, "Grocery budget"):]
	sheet = sheet[:strings.Index(sheet, "}")]
	if receiptDigits.MatchString(sheet) || !strings.Contains(sheet, "Tesco") {
		t.Fatalf("sheet candidate sent as %s", sheet)
	}
	if !strings.Contains(body, "Spend 54.20") {
		t.Fatal("a doc's text is not a sheet's cells and keeps its numbers")
	}

	body = ""
	search := fixedHits{hits: []Hit{{Kind: "sheet", ID: "s1", Title: "Grocery budget", Snippet: cells}}}
	if _, err := NewSmart(search, nil, capturingJev(t, &body)).Search(context.Background(), "u1", "groceries", nil); err != nil {
		t.Fatal(err)
	}
	if body == "" || receiptDigits.MatchString(body) {
		t.Fatalf("smart search sent the sheet's numbers: %s", body)
	}
}

func TestHitText(t *testing.T) {
	if got := hitText("sheet", "Amount: 1,234.56 · Card: 4421 · Qty 3", 200); got != "Amount: # · Card: # · Qty #" {
		t.Fatalf("got %q", got)
	}
	if got := hitText("task", "Call 555 1234", 200); got != "Call 555 1234" {
		t.Fatalf("got %q", got)
	}
}
