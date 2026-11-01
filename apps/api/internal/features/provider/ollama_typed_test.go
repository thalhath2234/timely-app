package provider

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync/atomic"
	"testing"
)

// internalService stands in for something on the server's network that is
// not Ollama: it answers with text that must never reach the person.
func internalService(t *testing.T, hits *atomic.Int32) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":"internal-secret-page: token=abc123 db_password=hunter2"}`))
	}))
	t.Cleanup(server.Close)
	return server
}

func TestTypedOllamaAddressNeverQuotesTheAnswer(t *testing.T) {
	var hits atomic.Int32
	server := internalService(t, &hits)
	spec := apiProviderByID("ollama")
	s := &Service{models: newCatalogue(), privateOllama: true}
	base := server.URL + "/secret"

	_, err := s.apiModelList(context.Background(), spec, base, "", 0)
	if err == nil || strings.Contains(err.Error(), "abc123") || !strings.Contains(err.Error(), "HTTP 403") {
		t.Fatalf("model list: %v", err)
	}
	completer, err := s.buildAPI(spec, APIKey{BaseURL: base}, "qwen3:8b")
	if err != nil {
		t.Fatal(err)
	}
	if err := testCompleter(context.Background(), completer); err == nil || strings.Contains(err.Error(), "abc123") || !strings.Contains(err.Error(), "HTTP 403") {
		t.Fatalf("chat: %v", err)
	}
	if hits.Load() == 0 {
		t.Fatal("a closed server may still reach a private address")
	}

	// The server's own Ollama address (OLLAMA_BASE_URL) keeps Ollama's words.
	s.ollamaURL = base
	if _, err := s.apiModelList(context.Background(), spec, base, "", 0); err == nil || !strings.Contains(err.Error(), "internal-secret-page") {
		t.Fatalf("listed address: %v", err)
	}
}

func TestTypedOllamaAddressFollowsNoRedirect(t *testing.T) {
	var hits atomic.Int32
	target := internalService(t, &hits)
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/secret"+r.URL.Path, http.StatusFound)
	}))
	defer redirector.Close()
	spec := apiProviderByID("ollama")
	s := &Service{models: newCatalogue(), privateOllama: true}

	_, err := s.apiModelList(context.Background(), spec, redirector.URL, "", 0)
	if err == nil || !strings.Contains(err.Error(), "HTTP 302") || strings.Contains(err.Error(), "abc123") {
		t.Fatalf("model list: %v", err)
	}
	completer, _ := s.buildAPI(spec, APIKey{BaseURL: redirector.URL}, "qwen3:8b")
	if err := testCompleter(context.Background(), completer); err == nil || !strings.Contains(err.Error(), "HTTP 302") {
		t.Fatalf("chat: %v", err)
	}
	if hits.Load() != 0 {
		t.Fatalf("the redirect was followed %d times", hits.Load())
	}
}

func TestTypedOllamaAddressStaysPublicOnAnOpenServer(t *testing.T) {
	var hits atomic.Int32
	server := internalService(t, &hits)
	spec := apiProviderByID("ollama")
	s := &Service{models: newCatalogue(), privateOllama: false}
	port := server.URL[strings.LastIndex(server.URL, ":"):]

	for _, base := range []string{server.URL + "/secret", "http://localhost" + port + "/secret"} {
		_, err := s.apiModelList(context.Background(), spec, base, "", 0)
		if !errors.Is(err, errPrivateAddress) || strings.Contains(err.Error(), "abc123") {
			t.Fatalf("%s: %v", base, err)
		}
		completer, _ := s.buildAPI(spec, APIKey{BaseURL: base}, "qwen3:8b")
		if err := testCompleter(context.Background(), completer); !errors.Is(err, errPrivateAddress) {
			t.Fatalf("%s chat: %v", base, err)
		}
	}
	if hits.Load() != 0 {
		t.Fatalf("an open server reached a private address %d times", hits.Load())
	}

	// The address the server lists for everyone still works.
	ollama := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/tags" {
			_, _ = w.Write([]byte(`{"models":[{"name":"qwen3:8b"}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"capabilities":["completion","tools"]}`))
	}))
	defer ollama.Close()
	s.ollamaURL = ollama.URL
	if list, err := s.apiModelList(context.Background(), spec, ollama.URL, "", 0); err != nil || len(list) != 1 {
		t.Fatalf("OLLAMA_BASE_URL: %v %v", list, err)
	}
}

func TestPublicAddr(t *testing.T) {
	for _, ip := range []string{"127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.20", "169.254.169.254", "100.100.100.100", "0.0.0.0", "0.1.2.3",
		"224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::1"} {
		if publicAddr(netip.MustParseAddr(ip)) {
			t.Errorf("%s counted as public", ip)
		}
	}
	for _, ip := range []string{"8.8.8.8", "1.1.1.1", "34.117.59.81", "2606:4700:4700::1111", "::ffff:8.8.8.8"} {
		if !publicAddr(netip.MustParseAddr(ip)) {
			t.Errorf("%s counted as private", ip)
		}
	}
}

// On a server open to sign-ups, Settings → Ollama → Another address cannot
// reach the server's own network, an address saved before cannot either, and
// the address the server lists keeps working.
func TestIntegrationOllamaTypedAddressOnAnOpenServer(t *testing.T) {
	db := integrationDB(t)
	t.Setenv("JWT_SECRET", "integration-secret")
	t.Setenv("ALLOW_REGISTRATION", "true")
	var hits atomic.Int32
	internal := internalService(t, &hits)
	ollama := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/tags" {
			_, _ = w.Write([]byte(`{"models":[{"name":"qwen3:8b"}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"capabilities":["completion","tools"]}`))
	}))
	defer ollama.Close()
	t.Setenv("OLLAMA_BASE_URL", ollama.URL)
	s := New(db, nil, nil)

	code, body := call(t, s, "user-b", http.MethodPost, "/agent/providers/ollama/key", map[string]string{"baseUrl": internal.URL + "/secret"})
	if code != 409 || body["message"] != errPrivateAddress.Error() {
		t.Fatalf("typed private address: %d %v", code, body)
	}
	var n int64
	db.Model(&APIKey{}).Where("user_id = ?", "user-b").Count(&n)
	if n != 0 {
		t.Fatal("a refused address must not be saved")
	}
	// An address saved before this check is refused when it is used.
	if err := db.Create(&APIKey{UserID: "user-b", Provider: "ollama", BaseURL: internal.URL + "/ok", Model: "qwen3:8b"}).Error; err != nil {
		t.Fatal(err)
	}
	completer, err := s.Completer(context.Background(), "user-b", "ollama", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := testCompleter(context.Background(), completer); !errors.Is(err, errPrivateAddress) {
		t.Fatalf("saved private address: %v", err)
	}
	// Opening Settings lists its models again.
	call(t, s, "user-b", http.MethodGet, "/agent/providers/ollama/models", nil)
	if hits.Load() != 0 {
		t.Fatalf("the internal service was reached %d times", hits.Load())
	}
	// The server's own Ollama address is still there for every account.
	if code, body := call(t, s, "user-b", http.MethodPost, "/agent/providers/ollama/key", map[string]string{"baseUrl": ollama.URL}); code != 200 {
		t.Fatalf("listed address: %d %v", code, body)
	}
}
