package chat

import (
	"context"
	"strings"
	"testing"

	"timely-api/internal/features/agent"
)

// The app that sent the latest message reaches the tools through the run's
// context and the model through one line of the system prompt.
func TestRunCarriesTheClient(t *testing.T) {
	s := &Service{}
	for client, want := range map[string]string{"phone": "phone", "web": "web", "": "web", "watch": "web"} {
		ctx, _, _ := s.zoned(context.Background(), &Conversation{Client: client})
		if got := agent.ClientFrom(ctx); got != want {
			t.Errorf("client %q: tools see %q, want %q", client, got, want)
		}
	}
	if !strings.Contains(clientNote("phone"), "phone's own views") || !strings.Contains(clientNote(""), "web or desktop") {
		t.Fatalf("notes: %q / %q", clientNote("phone"), clientNote(""))
	}
}
