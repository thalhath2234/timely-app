package chat

import (
	"github.com/labstack/echo/v5"
	"strings"
	"testing"
)

// Phase 5, review round 5: the account's Full Access default (set from the
// desktop window) gives a new chat Full Access only on a request that could
// turn it on; any other device gets an Auto chat, as naming Full Access does
// not work there either.
func TestIntegrationNewChatFullAccessDefaultNeedsTheStepUp(t *testing.T) {
	db := integrationDB(t)
	s := New(db, createCatalog, nil)
	s.SetAgentEngine(&fakeEngine{})
	asDesktopWindow(t)
	if code, body := serve(t, s, "PATCH", "/agent/chat-settings", `{"chatPermission":"full"}`); code != 200 {
		t.Fatalf("the desktop window sets the default: %d %s", code, body)
	}
	code, body := serve(t, s, "POST", "/chats", `{"content":"tidy my home folder","client":"web"}`)
	if code != 201 || !strings.Contains(string(body), `"permission":"full"`) || !strings.Contains(string(body), `"shell":true`) {
		t.Fatalf("the desktop window's new chat takes Full Access: %d %s", code, body)
	}
	shellRequest = func(*echo.Context) bool { return false }
	code, body = serve(t, s, "POST", "/chats", `{"content":"tidy my home folder","client":"web"}`)
	if code != 201 || !strings.Contains(string(body), `"permission":"auto"`) || strings.Contains(string(body), `"shell":true`) {
		t.Fatalf("a browser's new chat must not get Full Access: %d %s", code, body)
	}
	if code, _ := serve(t, s, "POST", "/chats", `{"content":"x","client":"web","permission":"full"}`); code != 403 {
		t.Fatalf("naming Full Access from a browser: %d", code)
	}
}
