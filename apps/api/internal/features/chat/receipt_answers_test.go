package chat

import (
	"context"
	"strings"
	"testing"
)

func lidlDraft() ReceiptDraft {
	r := ReceiptDraft{Merchant: "Lidl", Date: "2026-10-30", Currency: "EUR", Total: "3.00", TaxIncluded: true,
		Items: []ReceiptItem{{Description: "Milk 1L", Amount: "1.00"}, {Description: "Bread", Amount: "2.00"}}}
	normalizeReceipt(&r)
	return r
}

func TestReviseDraftKeepsTheDraftWhenTheAnswerIsNotAFullDraft(t *testing.T) {
	full := `{"merchant":"Lidl","date":"2026-10-30","currency":"EUR","total":"3.50","taxIncluded":true,"items":[{"description":"Milk 1L","amount":"1.00"},{"description":"Bread","amount":"2.50"}],"issues":[]}`
	for _, tc := range []struct {
		name, answer, total string
		items               int
		changed             bool
	}{
		{"patch", `{"total":"3.50"}`, "3.50", 2, true},
		{"number patch", `{"total": 3.50}`, "3.50", 2, true},
		{"extraction wrapper", `{"text":"Lidl receipt","receipt":` + full + `}`, "3.50", 2, true},
		{"empty object", `{}`, "3.00", 2, false},
		{"full draft in a fence", "```json\n" + full + "\n```", "3.50", 2, true},
		{"same draft", string(raw(lidlDraft())), "3.00", 2, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			draft, changed, err := reviseDraft(lidlDraft(), tc.answer)
			if err != nil {
				t.Fatal(err)
			}
			if draft.Merchant != "Lidl" || draft.Currency != "EUR" || len(draft.Items) != tc.items || draft.Total != tc.total || changed != tc.changed {
				t.Fatalf("merchant %q currency %q items %d total %q changed %v", draft.Merchant, draft.Currency, len(draft.Items), draft.Total, changed)
			}
		})
	}
	for _, answer := range []string{"null", "", "I can't change that.", `{"receipt":null}`, `{"items":"none"}`} {
		if _, _, err := reviseDraft(lidlDraft(), answer); err != errRevise {
			t.Fatalf("%q: err = %v, want the couldn't-revise error", answer, err)
		}
	}
}

func TestReviseDraftRecomputesChecksForChangedValues(t *testing.T) {
	r := lidlDraft()
	r.Total = "3.5O"
	r.Issues = append(r.Issues, "Is the bread a discount?")
	normalizeReceipt(&r)
	draft, _, err := reviseDraft(r, `{"total":"3.00"}`)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(draft.Issues, "|") != "Is the bread a discount?" {
		t.Fatalf("issues = %q: the stale total check should go, the open question stay", draft.Issues)
	}
}

func TestReceiptAnswersAreReadLeniently(t *testing.T) {
	answer := `{"text":"Lidl","receipt":{"merchant":"Lidl","date":"2026-10-30","currency":"EUR","total":3.00,"taxIncluded":"true","items":[{"description":"Milk","quantity":1,"unitPrice":1.00,"amount":1.00},{"description":"Bread","amount":"2.00"}],"issues":"Check the date"}}`
	for name, content := range map[string]string{
		"numbers and strings": answer,
		"upper-case fence":    "```JSON\n" + answer + "\n```",
		"prose before":        "Here is the JSON:\n" + answer,
		"prose after":         answer + "\n\nLet me know if you need anything else!",
		"braces in prose":     "Result {as requested}:\n" + answer,
	} {
		t.Run(name, func(t *testing.T) {
			s := &Service{provider: &scripted{responses: []WireMessage{{Content: content}}}}
			got, err := s.readReceipt(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			r := got.Receipt
			if r == nil || r.Total != "3.00" || !r.TaxIncluded || len(r.Items) != 2 || r.Items[0].Quantity != "1" || r.Items[0].Amount != "1.00" || len(r.Issues) != 1 {
				t.Fatalf("receipt = %+v", r)
			}
		})
	}
}

func TestUnreadableExtractionAnswerIsNotBlamedOnThePhoto(t *testing.T) {
	for _, content := range []string{"Sorry, I can't help with that.", `{"text":"cut off`, `{"receipt":{"items":"none"}}`} {
		s := &Service{provider: &scripted{responses: []WireMessage{{Content: content}}}}
		_, err := s.readReceipt(context.Background(), nil)
		if err == nil || strings.Contains(err.Error(), "photo") && strings.Contains(err.Error(), "clearer") {
			t.Fatalf("%q: err = %v", content, err)
		}
		if !strings.Contains(err.Error(), "Try again") {
			t.Fatalf("%q: err = %v, want a retry hint", content, err)
		}
	}
}

func TestFirstJSONObject(t *testing.T) {
	for in, want := range map[string]string{
		`{"a":1}`:                     `{"a":1}`,
		"```json\n{\"a\":\"}\"}\n```": `{"a":"}"}`,
		`x {not json} then {"a":{"b":2}} {"c":3}`: `{"a":{"b":2}}`,
		`{"a":1,}`:      "",
		`{"a":[{"b":1}`: "",
		`null`:          "",
	} {
		if got := string(firstJSONObject(in)); got != want {
			t.Fatalf("%q: got %q, want %q", in, got, want)
		}
	}
}

func TestIntegrationReviseAnswerInTheWrongShapeKeepsTheDraft(t *testing.T) {
	db := integrationDB(t)
	for _, tc := range []struct {
		name, answer, total, message string
		failed                       bool
	}{
		{"patch", `{"total":"3.50"}`, "3.50", "I've revised the receipt draft", false},
		{"nothing changed", `{}`, "3.00", "The receipt draft is unchanged", false},
		{"null", `null`, "3.00", "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := New(db, fakeSheetCatalog, &scripted{responses: []WireMessage{{Content: tc.answer}}})
			c := runFixture(t, db, nil)
			r := lidlDraft()
			c.Phase = "receipt_edit"
			c.Messages = []Message{message("user", "Read my receipt"), message("user", "total is 3.50")}
			c.ImageReview = &ImageReview{Status: "extracting", ReceiptID: "r", Receipt: &r}
			if err := db.Save(&c).Error; err != nil {
				t.Fatal(err)
			}
			err := s.editReceipt(context.Background(), &c)
			if tc.failed != (err != nil) {
				t.Fatalf("err = %v", err)
			}
			var row Conversation
			if err := db.First(&row, "id = ?", c.ID).Error; err != nil {
				t.Fatal(err)
			}
			got := row.ImageReview.Receipt
			if got.Merchant != "Lidl" || len(got.Items) != 2 || got.Total != tc.total {
				t.Fatalf("draft = %+v", got)
			}
			if last := row.Messages[len(row.Messages)-1]; tc.message != "" && !strings.Contains(last.Content, tc.message) {
				t.Fatalf("message = %q", last.Content)
			}
		})
	}
}
