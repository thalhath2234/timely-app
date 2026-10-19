package agent

import (
	"context"
	"regexp"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func promptClient(t *testing.T) *mcp.ClientSession {
	t.Helper()
	ctx := context.Background()
	server, clientSide := mcp.NewInMemoryTransports()
	session, err := New(Deps{}).Connect(ctx, server, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { session.Close() })
	client, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil).Connect(ctx, clientSide, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { client.Close() })
	return client
}

func promptText(t *testing.T, client *mcp.ClientSession, name string, args map[string]string) string {
	t.Helper()
	got, err := client.GetPrompt(context.Background(), &mcp.GetPromptParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("%s %v: %v", name, args, err)
	}
	if len(got.Messages) != 1 || got.Messages[0].Role != "user" {
		t.Fatalf("%s: want one user message, got %+v", name, got.Messages)
	}
	return got.Messages[0].Content.(*mcp.TextContent).Text
}

// Every tool a prompt tells the model to call exists.
func TestPromptsNameRealTools(t *testing.T) {
	client := promptClient(t)
	listed, err := client.ListPrompts(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, p := range listed.Prompts {
		names = append(names, p.Name)
	}
	if strings.Join(names, " ") != "plan_my_day triage_inbox weekly_review" {
		t.Fatalf("prompts %v", names)
	}
	catalog := NewCatalog(Deps{})
	toolName := regexp.MustCompile(`\b[a-z]+(?:_[a-z]+)+\b`)
	for _, name := range names {
		text := promptText(t, client, name, nil)
		for _, tool := range toolName.FindAllString(text, -1) {
			if _, ok := catalog[tool]; !ok {
				t.Errorf("%s names %s, which is not a tool", name, tool)
			}
		}
	}
}

func TestPromptDates(t *testing.T) {
	client := promptClient(t)
	if text := promptText(t, client, "plan_my_day", map[string]string{"date": "2026-10-21"}); !strings.Contains(text, "get_agenda with from=2026-10-21") || !strings.Contains(text, "Wednesday") {
		t.Fatalf("plan_my_day for the given day: %s", text)
	}
	text := promptText(t, client, "weekly_review", map[string]string{"weekStart": "2026-10-12"})
	if !strings.Contains(text, "list_focus_sessions with from=2026-10-12 and to=2026-10-18") || !strings.Contains(text, "to=2026-10-19") {
		t.Fatalf("weekly_review covers Monday to Sunday: %s", text)
	}
	if !strings.Contains(promptText(t, client, "weekly_review", nil), "Review my week from ") {
		t.Fatal("weekly_review defaults to this week")
	}
	if _, err := client.GetPrompt(context.Background(), &mcp.GetPromptParams{Name: "plan_my_day", Arguments: map[string]string{"date": "tomorrow"}}); err == nil {
		t.Fatal("a date that is not YYYY-MM-DD was accepted")
	}
}
