package chat

import (
	"encoding/json"
	"strings"
	"testing"
)

// A run that failed because no provider is chosen carries a stable code, so
// the apps can show a button to Settings → Agent instead of parsing words.
func TestFailedConversationCarriesTheNotChosenCode(t *testing.T) {
	raw, err := json.Marshal(Conversation{ID: "c1", Status: "failed", Error: NotChosenMessage})
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	if out["errorCode"] != ErrorCodeNotChosen || out["error"] != NotChosenMessage || out["id"] != "c1" {
		t.Fatalf("%s", raw)
	}
	raw, _ = json.Marshal(Conversation{ID: "c2", Status: "failed", Error: "Anthropic is overloaded right now (HTTP 529). Try again in a minute"})
	if strings.Contains(string(raw), "errorCode") {
		t.Fatalf("other failures carry no code: %s", raw)
	}
	// Pointers and slices of conversations use the same encoding.
	raw, _ = json.Marshal([]*Conversation{{ID: "c3", Error: NotChosenMessage}})
	if !strings.Contains(string(raw), `"errorCode":"provider_not_chosen"`) {
		t.Fatalf("%s", raw)
	}
}
