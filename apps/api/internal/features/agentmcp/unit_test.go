package agentmcp

import (
	"context"
	"encoding/json"
	"errors"
	"net/netip"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/agent"
)

// fakeDNS answers from a table and can be changed between calls, as a real
// name can be.
type fakeDNS struct{ hosts map[string][]string }

func (f *fakeDNS) LookupNetIP(_ context.Context, _, host string) ([]netip.Addr, error) {
	list, ok := f.hosts[host]
	if !ok {
		return nil, errors.New("no such host")
	}
	var out []netip.Addr
	for _, a := range list {
		out = append(out, netip.MustParseAddr(a))
	}
	return out, nil
}

func decode(t *testing.T, s string) map[string]any {
	t.Helper()
	m, err := entryMap(json.RawMessage(s))
	if err != nil {
		t.Fatal(err)
	}
	return m
}

// The hash is the worker's mcp_entry_hash (config_render.py): these digests
// come from Python's json.dumps(sort_keys=True, separators=(",", ":")) on the
// same entries. If they drift, an approved command server is silently dropped
// (or, worse, a changed one is not).
func TestEntryHashMatchesThePythonWorker(t *testing.T) {
	for _, c := range []struct{ entry, want string }{
		{`{"command":"/usr/bin/env","args":["python3","-m","srv"],"env":{"TOKEN":"abc"}}`, "4b8aac7dabb6977e1939293fda09299007427d359a33b5b45cd1d5028b5fb38e"},
		{"{\"command\":\"npx\",\"args\":[\"-y\",\"@scope/pkg\",\"--name\",\"café ☃ \U0001F600\",\"quote\\\"back\\\\slash\\n\\t<>&\"],\"timeout\":30}", "23cef9b860720c74d8af890922c414f3fe1023aa0209fbfc06fee7dea8d6fcb8"},
		{`{"url":"https://mcp.example.com/mcp","auth":"oauth","oauth":{"client_id":"a","redirect_port":27890},"tools":{"exclude":["x","y"]},"enabled":true}`, "7fc00fdacf6692592006b9fa50d36b54cc206ba9ffa35055d11acf2a114cc630"},
	} {
		if got := entryHash(decode(t, c.entry)); got != c.want {
			t.Errorf("entryHash(%s) = %s, want %s", c.entry, got, c.want)
		}
	}
}

func TestAnyChangeToACommandEntryChangesItsHash(t *testing.T) {
	base := `{"command":"srv","args":["a"],"env":{"K":"v"}}`
	h := entryHash(decode(t, base))
	for _, changed := range []string{`{"command":"srv2","args":["a"],"env":{"K":"v"}}`, `{"command":"srv","args":["a","b"],"env":{"K":"v"}}`,
		`{"command":"srv","args":["a"],"env":{"K":"w"}}`, `{"command":"srv","args":["a"],"env":{"K":"v","L":"x"}}`} {
		if entryHash(decode(t, changed)) == h {
			t.Errorf("%s hashes like the approved entry", changed)
		}
	}
}

func TestRemoteAddressesMustBePublic(t *testing.T) {
	dns := &fakeDNS{hosts: map[string][]string{
		"mcp.example.test": {"93.184.216.34"}, "internal.example.test": {"10.0.0.7"}, "tail.example.test": {"100.101.102.103"},
		"meta.example.test": {"169.254.169.254"}, "mixed.example.test": {"93.184.216.34", "192.168.1.5"}, "v6.example.test": {"fd00::1"},
		"loop.example.test": {"127.0.0.1"}, "wrapped.example.test": {"::ffff:10.0.0.1"},
	}}
	ctx := context.Background()
	for host, ok := range map[string]bool{
		"mcp.example.test": true, "internal.example.test": false, "tail.example.test": false, "meta.example.test": false,
		"mixed.example.test": false, "v6.example.test": false, "loop.example.test": false, "wrapped.example.test": false,
		"unknown.example.test": false, "localhost": false, "nas": false, "printer.local": false, "x.localhost": false,
		"10.1.2.3": false, "100.64.0.1": false, "169.254.169.254": false, "127.0.0.1": false, "[::1]": false, "0.0.0.0": false,
		"93.184.216.34": true, "198.18.0.1": false, "240.0.0.1": false,
	} {
		got := publicProblem(ctx, dns, strings.Trim(host, "[]")) == ""
		if got != ok {
			t.Errorf("publicProblem(%s) public = %v, want %v", host, got, ok)
		}
	}
}

func TestRemoteEntryShape(t *testing.T) {
	dns := &fakeDNS{hosts: map[string][]string{"mcp.example.test": {"93.184.216.34"}}}
	ctx := context.Background()
	for _, bad := range []string{"", "ftp://mcp.example.test/", "mcp.example.test", "https://user:pw@mcp.example.test/mcp", "https://mcp.example.test/mcp#frag", "https:///x", "javascript:alert(1)"} {
		if _, err := checkRemote(ctx, dns, map[string]any{"url": bad}); !errors.Is(err, ErrInvalid) {
			t.Errorf("%q: err = %v, want ErrInvalid", bad, err)
		}
	}
	if _, err := checkRemote(ctx, dns, map[string]any{"url": "http://mcp.example.test/mcp", "auth": "oauth"}); !errors.Is(err, ErrInvalid) {
		t.Errorf("a sign-in over plain http: %v", err)
	}
	if p, err := checkRemote(ctx, dns, map[string]any{"url": "http://mcp.example.test:8080/mcp"}); err != nil || p != "" {
		t.Errorf("plain http without sign-in on another port: %q %v", p, err)
	}
	if p, _ := checkRemote(ctx, dns, map[string]any{"url": "https://100.64.0.1/mcp"}); p == "" {
		t.Error("a Tailscale address passed")
	}
}

func TestEntryWhitelist(t *testing.T) {
	for _, bad := range []string{
		`{}`, `{"url":"https://a.example/mcp","headers":{"Authorization":"x"}}`, `{"url":"https://a.example/mcp","command":"x"}`,
		`{"command":"x","cwd":"/"}`, `{"command":"x","args":"not a list"}`, `{"command":"x","args":[1]}`, `{"command":"x\nrm"}`,
		`{"command":"x","env":{"bad name":"v"}}`, `{"url":"https://a.example/mcp","auth":"basic"}`, `{"url":"https://a.example/mcp","oauth":{"evil":1}}`,
		`{"url":"https://a.example/mcp","timeout":"soon"}`, `{"url":"https://a.example/mcp","enabled":"yes"}`,
	} {
		if _, err := cleanEntry(decode(t, bad)); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s accepted (%v)", bad, err)
		}
	}
	for _, good := range []string{`{"url":"https://a.example/mcp"}`, `{"url":"https://a.example/mcp","auth":"oauth","oauth":{"client_id":"x","redirect_port":27890},"tools":{"include":["a"]},"timeout":30}`,
		`{"command":"srv","args":["a"],"env":{"K":"${K}"}}`} {
		if _, err := cleanEntry(decode(t, good)); err != nil {
			t.Errorf("%s refused: %v", good, err)
		}
	}
}

func TestFillReplacesReferencesAndReportsMissing(t *testing.T) {
	entry := decode(t, `{"url":"https://x.example","oauth":{"client_id":"${ID}","client_secret":"${SECRET}"},"tools":{"include":["${OTHER}"]}}`)
	got, missing := fill(entry, map[string]string{"ID": "abc", "SECRET": "s3"})
	m := got.(map[string]any)
	if m["oauth"].(map[string]any)["client_secret"] != "s3" || m["oauth"].(map[string]any)["client_id"] != "abc" {
		t.Fatalf("filled = %v", m)
	}
	if len(missing) != 1 || missing[0] != "OTHER" {
		t.Fatalf("missing = %v", missing)
	}
	if entry["oauth"].(map[string]any)["client_secret"] != "${SECRET}" {
		t.Fatal("fill changed its input")
	}
}

func TestClassifyFromNamesAndAnnotations(t *testing.T) {
	yes, no := true, false
	for _, c := range []struct {
		tool string
		ann  Annotations
		want string
	}{
		{"send_email", Annotations{}, ClassSend}, {"sendMessage", Annotations{}, ClassSend}, {"reply-to-thread", Annotations{}, ClassSend},
		{"forward_mail", Annotations{}, ClassSend}, {"post_status", Annotations{}, ClassSend}, {"publish_page", Annotations{}, ClassSend},
		{"share_file", Annotations{}, ClassSend}, {"invite_user", Annotations{}, ClassSend}, {"upload_asset", Annotations{}, ClassSend},
		{"create_comment", Annotations{}, ClassSend}, {"get_and_send", Annotations{}, ClassSend},
		// a server cannot hide a send behind a read-only hint
		{"send_message", Annotations{ReadOnly: &yes}, ClassSend},
		{"create_payment", Annotations{}, ClassPay}, {"refund_charge", Annotations{}, ClassPay}, {"transfer_funds", Annotations{}, ClassPay},
		{"place_order", Annotations{}, ClassPay}, {"update_settings", Annotations{}, ClassConfig}, {"create_webhook", Annotations{}, ClassConfig},
		{"rotate_token", Annotations{}, ClassConfig},
		{"get_message", Annotations{}, ClassRead}, {"list_comments", Annotations{}, ClassRead}, {"search_orders", Annotations{}, ClassRead},
		{"get_settings", Annotations{}, ClassRead}, {"search_web", Annotations{OpenWorld: &yes}, ClassRead},
		{"lookup", Annotations{ReadOnly: &yes}, ClassRead}, {"anything", Annotations{ReadOnly: &yes}, ClassRead},
		{"create_note", Annotations{}, ClassWrite}, {"delete_note", Annotations{Destructive: &yes}, ClassWrite},
		{"get_thing", Annotations{Destructive: &yes}, ClassWrite},
		{"sync", Annotations{OpenWorld: &yes, ReadOnly: &no}, ClassSend}, {"update_page", Annotations{}, ClassWrite},
		{"", Annotations{}, ClassWrite},
	} {
		if got := Class(c.tool, c.ann); got != c.want {
			t.Errorf("Class(%q) = %s, want %s", c.tool, got, c.want)
		}
	}
}

func TestClassifyReturnsTheHostActionThePermissionModesJudge(t *testing.T) {
	s := &Service{tools: map[string][]ToolInfo{}}
	ctx := context.Background()
	scope := agent.HostScope{}
	for tool, want := range map[string]struct {
		kind     string
		critical bool
	}{
		"send_message": {agent.HostSend, true}, "pay_invoice": {agent.HostPay, true}, "update_settings": {agent.HostConfig, true},
		"list_notes": {agent.HostFetch, false}, "create_note": {agent.HostInput, false},
	} {
		a := s.Classify(ctx, "u", "srv", tool)
		_, _, critical := agent.CriticalHost(a, scope)
		if a.Kind != want.kind || critical != want.critical {
			t.Errorf("%s: kind %s critical %v, want %s %v", tool, a.Kind, critical, want.kind, want.critical)
		}
	}
	// a write is critical once the chat has read outside content (Auto holds it)
	if _, _, critical := agent.CriticalHost(s.Classify(ctx, "u", "srv", "create_note"), agent.HostScope{Tainted: true}); !critical {
		t.Error("a write after outside content is not held")
	}
	// the last probe's hints count when the gate has none
	yes := true
	s.tools[toolsKey("u", "srv")] = []ToolInfo{{Name: "refresh", Annotations: Annotations{ReadOnly: &yes}}}
	if got := s.Classify(ctx, "u", "srv", "refresh").Kind; got != agent.HostFetch {
		t.Errorf("a probed read-only tool classified as %s", got)
	}
}

func TestASignInStateWorksOnceAndOnlyBeforeItExpires(t *testing.T) {
	now := time.Now()
	g := newSignIns(func() time.Time { return now })
	_ = g.add("st1", pendingSignIn{uid: "u1", name: "notes", expires: now.Add(signInTTL)})
	if p, ok := g.take("st1"); !ok || p.uid != "u1" || p.name != "notes" {
		t.Fatalf("take = %+v %v", p, ok)
	}
	if _, ok := g.take("st1"); ok {
		t.Fatal("a state worked twice")
	}
	_ = g.add("st2", pendingSignIn{uid: "u1", name: "notes", expires: now.Add(signInTTL)})
	now = now.Add(signInTTL + time.Second)
	if _, ok := g.take("st2"); ok {
		t.Fatal("an expired state worked")
	}
	if _, ok := g.take("never-issued"); ok {
		t.Fatal("an unknown state worked")
	}
	for i := 0; i < maxSignIns; i++ {
		if err := g.add("s"+string(rune('a'+i)), pendingSignIn{uid: "u1", name: "n", expires: now.Add(signInTTL)}); err != nil {
			t.Fatal(err)
		}
	}
	if err := g.add("one-too-many", pendingSignIn{uid: "u1", name: "n", expires: now.Add(signInTTL)}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("no cap on waiting sign-ins: %v", err)
	}
	if err := g.add("another-account", pendingSignIn{uid: "u2", name: "n", expires: now.Add(signInTTL)}); err != nil {
		t.Fatalf("one account's sign-ins counted against another: %v", err)
	}
}

func TestRedirectURI(t *testing.T) {
	for in, want := range map[string]string{
		"https://timely.example.test/api-proxy/": "https://timely.example.test/api-proxy/agent/mcp/oauth/callback",
		"http://192.168.1.4:8080":                "http://192.168.1.4:8080/agent/mcp/oauth/callback",
	} {
		if got, err := RedirectURI(in); err != nil || got != want {
			t.Errorf("RedirectURI(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, bad := range []string{"", "javascript:alert(1)", "https://u:p@x.test", "https://x.test/?a=1", "https://x.test/#f", "/relative"} {
		if _, err := RedirectURI(bad); err == nil {
			t.Errorf("RedirectURI(%q) accepted", bad)
		}
	}
}

func TestStemIsTheNameForEveryNameWeAllow(t *testing.T) {
	for _, n := range []string{"linear", "hugging_face", "n8n-official", "My_Server-2"} {
		if !nameRe.MatchString(n) || stem(n) != n {
			t.Errorf("%s: stem %q", n, stem(n))
		}
	}
	for _, bad := range []string{"", "a b", "../x", "a/b", "-x", strings.Repeat("a", 49)} {
		if nameRe.MatchString(bad) {
			t.Errorf("%q passes as a name", bad)
		}
	}
}
