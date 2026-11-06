package chat

import (
	"strings"
	"testing"
)

// Context chips are limited in characters, as the apps clip them (GC32).
func TestContextChipLimitsCountCharacters(t *testing.T) {
	ok := sendInput{Content: "hi", Context: []ContextChip{{Kind: "selection", Label: strings.Repeat("日", 70), Value: strings.Repeat("日", 4001)}}}
	if err := validateInput(ok); err != nil {
		t.Fatalf("a Japanese chip within the limits was refused: %v", err)
	}
	long := sendInput{Content: "hi", Context: []ContextChip{{Kind: "selection", Label: "x", Value: strings.Repeat("日", 12001)}}}
	if err := validateInput(long); err == nil {
		t.Fatal("a chip over 12,000 characters was accepted")
	}
}

// Amounts are masked before Jev in every digit script, and amounts written
// into shop and item names too; plain numbers in names stay (GC25).
func TestAmountsAreMaskedInEveryScriptAndInNames(t *testing.T) {
	got := anyNumber.ReplaceAllString("the total is １２.５０ and ١٢٫٥٠, not 12.50", "#")
	if got != "the total is # and #, not #" {
		t.Fatalf("masked %q", got)
	}
	r := receiptFixture()
	r.Merchant = "Shop 12.99"
	r.Items = []ReceiptItem{{Description: "Coffee 4.50", Amount: "4.50"}, {Description: "7-Eleven bag", Amount: "0.10"}, {Description: "Tea ３．２０", Amount: "3.20"}}
	facts := string(raw(receiptFacts(r)))
	for _, leak := range []string{"12.99", "4.50", "３．２０"} {
		if strings.Contains(facts, leak) {
			t.Fatalf("amount %q sent: %s", leak, facts)
		}
	}
	if !strings.Contains(facts, "7-Eleven bag") || !strings.Contains(facts, "Shop #") {
		t.Fatalf("names changed too much: %s", facts)
	}
}

// A revise answer that changes nothing keeps the draft: it may resolve an
// issue, never add one that would hold up Apply (GC29).
func TestUnchangedReviseKeepsIssuesItDidNotResolve(t *testing.T) {
	current := receiptFixture()
	current.Issues = []string{"Date may be 2026-09-28"}
	answer := receiptFixture()
	answer.Issues = []string{"Date may be 2026-09-28", "Clarify whether tax is right", "Which sheet?"}
	draft, changed, err := reviseDraft(current, string(raw(answer)))
	if err != nil || changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	kept := keepIssues(current, draft.Issues)
	if len(kept.Issues) != 1 || kept.Issues[0] != "Date may be 2026-09-28" {
		t.Fatalf("issues = %v", kept.Issues)
	}
	answer.Issues = []string{}
	draft, _, _ = reviseDraft(current, string(raw(answer)))
	if kept = keepIssues(current, draft.Issues); len(kept.Issues) != 0 {
		t.Fatalf("a resolved issue stayed: %v", kept.Issues)
	}
}
