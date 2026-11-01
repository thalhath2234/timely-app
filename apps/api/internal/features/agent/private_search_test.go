package agent

import (
	"context"
	"strings"
	"testing"

	mcpauth "github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"timely-api/internal/features/decide"
	"timely-api/internal/features/search"
)

type emptySearch struct{ search.Service }

func (emptySearch) SemanticSearch(context.Context, string, string, int, []string) ([]search.Hit, error) {
	return nil, nil
}

func TestPrivateChatSemanticSearchMissSaysToUseFewerWords(t *testing.T) {
	s := &Server{Deps: Deps{Search: emptySearch{}}}
	req := &mcp.CallToolRequest{Extra: &mcp.RequestExtra{TokenInfo: &mcpauth.TokenInfo{UserID: "usr_1"}}}
	res, out, err := s.semanticSearch(decide.WithSensitive(context.Background()), req, semanticSearchIn{Query: "Dr. Alice Moore cardiology"})
	if err != nil {
		t.Fatal(err)
	}
	note, _ := out.(map[string]any)["note"].(string)
	text := res.Content[0].(*mcp.TextContent).Text
	if !strings.Contains(note, "one or two distinctive words") || !strings.Contains(text, "exact words only") {
		t.Fatalf("note %q text %q", note, text)
	}
	// Outside a private chat an empty result reads as before.
	_, out, _ = s.semanticSearch(context.Background(), req, semanticSearchIn{Query: "dentist"})
	if _, has := out.(map[string]any)["note"]; has {
		t.Fatal("a note was added outside a private chat")
	}
}
