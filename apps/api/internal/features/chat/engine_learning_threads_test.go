package chat

import (
	"context"
	"slices"
	"testing"
)

// Past-chat search never returns a Bot thread or a new-Bot draft: they carry
// alert and page text without the taint "Do this in chat" adds.
func TestIntegrationSearchAllowLeavesOutBotThreadsAndDrafts(t *testing.T) {
	h := newEngineHarness(t)
	ctx := context.Background()
	h.e.opts.Learning = func(context.Context, string) (LearningPrefs, error) { return LearningPrefs{true, true}, nil }
	mk := func(id, kind string, chips []ContextChip) {
		t.Helper()
		c := &Conversation{ID: id, UserID: "user-a", Kind: kind, Context: chips, Messages: []Message{message("user", "hi")}}
		if err := h.s.db.WithContext(ctx).Create(c).Error; err != nil {
			t.Fatal(err)
		}
	}
	mk("conv_search_chat", KindChat, nil)
	mk("conv_search_thread", KindBotThread, nil)
	mk("conv_search_draft", KindChat, []ContextChip{{Kind: "bot_draft"}})

	c := &Conversation{UserID: "user-a", Messages: []Message{message("user", "hi")}}
	got := h.e.runSetup(ctx, c, &toolRun{}, false)
	if !slices.Contains(got.searchAllow, "conv_search_chat") {
		t.Fatalf("a normal chat is missing from searchAllow: %v", got.searchAllow)
	}
	for _, id := range []string{"conv_search_thread", "conv_search_draft"} {
		if slices.Contains(got.searchAllow, id) {
			t.Fatalf("%s must not be in searchAllow: %v", id, got.searchAllow)
		}
	}
}
