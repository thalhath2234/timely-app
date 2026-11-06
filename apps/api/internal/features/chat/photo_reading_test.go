package chat

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
)

// A failure says what the person can do: settings for a key or provider
// problem, nothing for one that would repeat, Try again otherwise. Clearing
// the error clears its action, so a later error never inherits it.
func TestFailureActions(t *testing.T) {
	if got := failureAction(NeedsSettings("key")); got != ActionSettings {
		t.Fatalf("settings failure = %q", got)
	}
	if got := failureAction(fmt.Errorf("wrapped: %w", Final("repeats"))); got != ActionNone {
		t.Fatalf("final failure = %q", got)
	}
	if got := failureAction(errors.New("network")); got != ActionRetry {
		t.Fatalf("plain error = %q", got)
	}
	c := Conversation{Error: "", ErrorAction: ActionSettings}
	if err := c.BeforeSave(nil); err != nil || c.ErrorAction != "" {
		t.Fatalf("cleared error kept action %q", c.ErrorAction)
	}
	c = Conversation{Error: "Anthropic didn't accept the API key", ErrorAction: ActionSettings}
	if _ = c.BeforeSave(nil); c.ErrorAction != ActionSettings {
		t.Fatal("action dropped while its error stands")
	}
}

// recheckRecorder answers an unbalanced receipt, then a balanced one, and
// records whether each call may be retried.
type recheckRecorder struct{ retriesOff []bool }

func (r *recheckRecorder) Complete(ctx context.Context, messages []WireMessage, _ []any, _ bool) (WireMessage, error) {
	r.retriesOff = append(r.retriesOff, RetriesOff(ctx))
	receipt := receiptFixture()
	if len(r.retriesOff) == 1 {
		receipt.Total = "999"
	}
	return WireMessage{Content: string(raw(imageExtraction{Receipt: &receipt}))}, nil
}

// The recheck re-sends the photos once, never twice: it is optional, so it is
// sent without client retries (GC14).
func TestReceiptRecheckIsSentWithoutRetries(t *testing.T) {
	p := &recheckRecorder{}
	s := &Service{provider: p}
	if _, err := s.extractReceipt(context.Background(), WireMessage{Role: "user", Sensitive: true, ImageURLs: []string{"data:image/jpeg;base64,x"}}, "2026-10-01"); err != nil {
		t.Fatal(err)
	}
	if len(p.retriesOff) != 2 || p.retriesOff[0] || !p.retriesOff[1] {
		t.Fatalf("retries off per call = %v, want [false true]", p.retriesOff)
	}
}

// A receipt with no printed date gets today's date and an issue saying so,
// so the person checks it (GC22).
func TestReceiptWithoutDateIsFlagged(t *testing.T) {
	p := &missingBagCompleter{t: t}
	s := &Service{provider: p}
	result, err := s.extractReceipt(context.Background(), WireMessage{Role: "user", Sensitive: true, ImageURLs: []string{"data:image/jpeg;base64,x"}}, "2026-11-01")
	if err != nil {
		t.Fatal(err)
	}
	if result.Receipt.Date != "2026-11-01" || !contains(result.Receipt.Issues, dateAssumed) {
		t.Fatalf("date %q issues %v", result.Receipt.Date, result.Receipt.Issues)
	}
	printed := &missingBagCompleter{t: t, date: "2026-09-30"}
	s.provider = printed
	result, _ = s.extractReceipt(context.Background(), WireMessage{Role: "user", Sensitive: true, ImageURLs: []string{"data:image/jpeg;base64,x"}}, "2026-11-01")
	if contains(result.Receipt.Issues, dateAssumed) {
		t.Fatal("a printed date was flagged as assumed")
	}
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// The text limit counts characters: 7,000 Japanese characters are 21,000
// bytes but well within it (GC21).
func TestExtractedTextLimitCountsCharacters(t *testing.T) {
	if tooLong(strings.Repeat("日", 7000)) {
		t.Fatal("7,000 characters refused")
	}
	if !tooLong(strings.Repeat("a", maxExtractedText+1)) {
		t.Fatal("over-long text accepted")
	}
}

type textOnly struct{ known bool }

func (textOnly) Complete(context.Context, []WireMessage, []any, bool) (WireMessage, error) {
	return WireMessage{}, errors.New("photos sent to a text-only model")
}

func (m textOnly) ReadsImages(context.Context) (bool, bool) { return false, m.known }

// Photos never go to a model its list says is text-only; a model the list
// does not know is tried (GC19).
func TestPhotosAreNotSentToTextOnlyModels(t *testing.T) {
	s := &Service{}
	c := &Conversation{ImageReview: &ImageReview{ImageIDs: []string{"img_1"}}}
	err := s.extractImages(WithCompleter(context.Background(), textOnly{known: true}), c)
	if err == nil || !strings.Contains(err.Error(), "can't read photos") {
		t.Fatalf("%v", err)
	}
	if !readsImages(WithCompleter(context.Background(), textOnly{known: false})) {
		t.Fatal("an unknown model was refused")
	}
}
