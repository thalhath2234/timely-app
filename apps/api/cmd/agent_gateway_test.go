package main

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"timely-api/internal/agenthost"
	"timely-api/internal/features/agent"
	"timely-api/internal/features/auth"
	"timely-api/internal/features/chat"
	"timely-api/internal/features/provider"
	"timely-api/internal/routes"
)

// nonLoopbackIP is the first up, non-loopback unicast address of this host
// (IPv4 first), the kind API_BIND serves on (a LAN or Tailscale address).
func nonLoopbackIP(t *testing.T) net.IP {
	t.Helper()
	ifaces, err := net.Interfaces()
	if err != nil {
		t.Skipf("no interfaces: %v", err)
	}
	var v6 net.IP
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, a := range addrs {
			n, ok := a.(*net.IPNet)
			if !ok || n.IP.IsLoopback() || n.IP.IsLinkLocalUnicast() || !n.IP.IsGlobalUnicast() {
				continue
			}
			if v4 := n.IP.To4(); v4 != nil {
				return v4
			}
			if v6 == nil {
				v6 = n.IP
			}
		}
	}
	if v6 == nil {
		t.Skip("this host has no non-loopback unicast address to listen on")
	}
	return v6
}

// The router main.go builds, served the way listenAll serves it on a
// non-loopback API_BIND address, never answers the gateway's paths; the
// gateway itself is not reachable on that address at all, and on 127.0.0.1
// it wants its key.
func TestGatewayIsNotServedOnTheAPIAddresses(t *testing.T) {
	t.Setenv("CHAT_LOCAL_CLI", "")
	providers := provider.New(nil, nil, nil)
	g, err := providers.StartAgentGateway()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = g.Close(context.Background()) })
	router := newRouter(routes.Handlers{
		Providers: providers,
		Chat:      chat.New(nil, func(*gorm.DB) agent.Catalog { return nil }, nil),
	})

	ip := nonLoopbackIP(t)
	ln, err := net.Listen("tcp", net.JoinHostPort(ip.String(), "0"))
	if err != nil {
		t.Skipf("cannot listen on %s: %v", ip, err)
	}
	srv := &http.Server{Handler: router, ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })
	api := "http://" + ln.Addr().String()

	// A signed-in caller (a valid session token) gets 404: no such route. A
	// caller with a gateway-style key or nothing never gets past sign-in
	// (every path outside the public routes is behind it), so 401.
	session := signedSession(t)
	for _, req := range []struct{ method, path string }{
		{"POST", "/v1/chat/completions"},
		{"POST", "/internal/agent/v1/chat/completions"},
		{"GET", "/v1/models"},
	} {
		for _, auth := range []struct {
			header string
			want   int
		}{{"Bearer " + session, http.StatusNotFound}, {"Bearer tgw-guess", http.StatusUnauthorized}, {"", http.StatusUnauthorized}} {
			r, _ := http.NewRequest(req.method, api+req.path, strings.NewReader(`{"model":"sonnet","messages":[{"role":"user","content":"hi"}]}`))
			r.Header.Set("Content-Type", "application/json")
			if auth.header != "" {
				r.Header.Set("Authorization", auth.header)
			}
			resp, err := http.DefaultClient.Do(r)
			if err != nil {
				t.Fatalf("%s %s: %v", req.method, req.path, err)
			}
			resp.Body.Close()
			if resp.StatusCode != auth.want {
				t.Errorf("the API on %s answered %s %s (%.12s) with %d, not %d", ip, req.method, req.path, auth.header, resp.StatusCode, auth.want)
			}
		}
	}

	base, err := url.Parse(g.BaseURL())
	if err != nil || base.Hostname() != "127.0.0.1" {
		t.Fatalf("gateway base %q", g.BaseURL())
	}
	if conn, err := net.DialTimeout("tcp", net.JoinHostPort(ip.String(), base.Port()), 2*time.Second); err == nil {
		conn.Close()
		t.Fatalf("the gateway's port %s answers on %s", base.Port(), ip)
	}

	resp, err := http.Post(g.BaseURL()+"/chat/completions", "application/json", strings.NewReader(`{"model":"sonnet","messages":[{"role":"user","content":"hi"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("the gateway on 127.0.0.1 answered %d without a key, not 401", resp.StatusCode)
	}
}

// signedSession is an access token this API accepts (JWT_SECRET set for the
// test; routes.Handlers.Sessions is nil, so any session id is active).
func signedSession(t *testing.T) string {
	t.Helper()
	secret := "gateway-test-secret-" + strings.Repeat("x", 32)
	t.Setenv("JWT_SECRET", secret)
	now := time.Now()
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, &auth.JWTClaims{UserID: "usr_gateway", SessionID: "ses_gateway",
		RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)), IssuedAt: jwt.NewNumericDate(now)}}).SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}
	return token
}

// useGatewayFakeCLIs points CLAUDE_BIN and CODEX_BIN at the provider
// package's fake CLIs.
func useGatewayFakeCLIs(t *testing.T) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the fake CLIs are /bin/sh scripts, which Windows cannot run")
	}
	bins, err := filepath.Abs(filepath.Join("..", "internal", "features", "provider", "testdata", "fakecli"))
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("CLAUDE_BIN", filepath.Join(bins, "claude"))
	t.Setenv("CODEX_BIN", filepath.Join(bins, "codex"))
	t.Setenv("FAKECLI_DIR", t.TempDir())
	t.Setenv("CHAT_LOCAL_CLI", "")
}

// The phase 4 exit (Go): with the gateway up and Claude Code and Codex
// connected, both CLI providers get the gateway's model, a chat on either is
// Available on the agent engine, and an account whose chat provider is
// either reports engineAvailable. Without the gateway the same chats stay
// classic and say why.
func TestIntegrationGatewayExitCLIChatsRunOnTheNewEngine(t *testing.T) {
	useGatewayFakeCLIs(t)
	db, uid := agentToolsDB(t)
	connected := time.Now().UTC()
	if err := db.Create(&provider.Settings{UserID: uid, DefaultProvider: provider.ClaudeCLI, ClaudeModel: "sonnet", CodexModel: "gpt-5.5",
		ClaudeConnectedAt: &connected, CodexConnectedAt: &connected}).Error; err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	// A runtime that exists (this test binary): Available checks only that,
	// and no worker is started.
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	engineFor := func(providers *provider.Service) (*chat.Service, *chat.WorkerEngine) {
		chatService := chat.New(db, func(*gorm.DB) agent.Catalog { return nil }, nil)
		// As newAgentEngine wires it.
		engine := chat.NewWorkerEngine(chatService, chat.WorkerEngineOptions{
			Model: func(ctx context.Context, uid, providerID, model string) (any, error) {
				return providers.AgentModel(ctx, uid, providerID, model)
			},
			Unsupported: func(err error) bool { return errors.Is(err, provider.ErrAgentEngineUnsupported) },
		})
		sup := agenthost.New(agenthost.Config{Root: filepath.Join(t.TempDir(), "agent"), Runtime: agenthost.Runtime{Program: exe}, Logf: t.Logf})
		t.Cleanup(func() { _ = sup.Shutdown(context.Background()) })
		engine.Attach(sup)
		chatService.SetAgentEngine(engine)
		return chatService, engine
	}

	providers := provider.New(db, nil, nil)
	g, err := providers.StartAgentGateway()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = g.Close(context.Background()) })
	chatService, engine := engineFor(providers)
	for p, model := range map[string]string{provider.ClaudeCLI: "sonnet", provider.CodexCLI: "gpt-5.5"} {
		m, err := providers.AgentModel(ctx, uid, p, "")
		if err != nil {
			t.Fatalf("%s: %v", p, err)
		}
		if m.Provider != "custom" || m.BaseURL != g.BaseURL() || m.Model != model || !strings.HasPrefix(m.APIKey, "tgw-") {
			t.Fatalf("%s: not the gateway: %v", p, m)
		}
		if err := engine.Available(ctx, uid, &chat.Conversation{UserID: uid, Provider: p, Phase: "plan"}); err != nil {
			t.Errorf("a %s chat is not Available: %v", p, err)
		}
		if err := db.Model(&provider.Settings{}).Where("user_id = ?", uid).Update("default_provider", p).Error; err != nil {
			t.Fatal(err)
		}
		if got := chatSettings(t, chatService, uid); got["engineAvailable"] != true {
			t.Errorf("an account on %s: %v", p, got)
		}
	}

	// The control: without the gateway, the same chats stay classic.
	_, classic := engineFor(provider.New(db, nil, nil))
	for _, p := range []string{provider.ClaudeCLI, provider.CodexCLI} {
		err := classic.Available(ctx, uid, &chat.Conversation{UserID: uid, Provider: p, Phase: "plan"})
		if err == nil || !strings.Contains(err.Error(), "model gateway is not running") {
			t.Errorf("%s without the gateway: %v", p, err)
		}
	}
}

// chatSettings is GET /agent/chat-settings for uid.
func chatSettings(t *testing.T, s *chat.Service, uid string) map[string]any {
	t.Helper()
	e := echo.New()
	g := e.Group("")
	g.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error { c.Set("userID", uid); return next(c) }
	})
	s.Routes(g)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest("GET", "/agent/chat-settings", nil))
	var out map[string]any
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &out) != nil {
		t.Fatalf("chat settings: %d %s", rec.Code, rec.Body.String())
	}
	return out
}
