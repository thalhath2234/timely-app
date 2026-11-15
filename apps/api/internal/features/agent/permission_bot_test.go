package agent

import "testing"

func TestClassifyBotTool(t *testing.T) {
	for tool, want := range map[string]BotToolClass{
		"bot_note_get": BotToolOwn, "bot_note_set": BotToolOwn, "bot_note_delete": BotToolOwn, "bot_report": BotToolOwn,
		"skill_view": BotToolOwn, "skills_list": BotToolOwn, "memory": BotToolOwn,
		"web_search": BotToolWebSearch, "web_extract": BotToolWebExtract,
		"bot_browser_read": BotToolBrowserRead,
		"browser_exec":     BotToolBrowserAct, "browser_cdp": BotToolBrowserAct, "browser_dialog": BotToolBrowserAct, "browser_click": BotToolBrowserAct,
		"browser_vault": BotToolNever, "terminal": BotToolNever, "process": BotToolNever, "execute_code": BotToolNever,
		"read_file": BotToolNever, "write_file": BotToolNever, "patch": BotToolNever, "session_search": BotToolNever,
		"cronjob_manage": BotToolNever, "create_bot": BotToolNever, "clarify": BotToolNever, "delegate_task": BotToolNever,
		"send_message": BotToolNever, "messaging_telegram": BotToolNever, " Terminal ": BotToolNever,
		"": BotToolUnknown, "something_new": BotToolUnknown, "mcp_mail_send": BotToolUnknown,
	} {
		if got := ClassifyBotTool(tool); got != want {
			t.Errorf("%q: class %d, want %d", tool, got, want)
		}
	}
}

func TestBotHost(t *testing.T) {
	for raw, want := range map[string]string{
		"https://www.Example.com/a?b=c": "example.com",
		"http://example.com:8080/x":     "example.com",
		"example.com":                   "example.com",
		"www.example.com/path":          "example.com",
		"https://example.com./":         "example.com",
		"https://good.com@evil.test/":   "evil.test",
		"https://evil.test\\@good.com/": "",
		"javascript:alert(1)":           "",
		"file:///etc/passwd":            "",
		"chrome://settings":             "",
		"ftp://example.com/":            "",
		"data:text/html,<b>x</b>":       "",
		"":                              "",
		"  https://example.com  ":       "example.com",
		"https://exa mple.com/":         "",
		"HTTPS://EXAMPLE.COM":           "example.com",
	} {
		if got := BotHost(raw); got != want {
			t.Errorf("BotHost(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestBotGateModes(t *testing.T) {
	hosts := BotHosts{
		Read: []string{"https://prices.example/item"}, Browser: []string{"shop.example.com"},
		Egress: []string{"api.example.net"}, Search: []string{"found.example"},
	}
	type c struct {
		name      string
		in        BotGateIn
		supAuto   string
		fullOK    string
		fullLifts bool
	}
	cases := []c{
		{"own tool", BotGateIn{Tool: "bot_report"}, BotAllow, BotAllow, false},
		{"search", BotGateIn{Tool: "web_search"}, BotAllow, BotAllow, false},
		{"search tainted", BotGateIn{Tool: "web_search", Tainted: true}, BotBlock, BotAllow, true},
		{"extract read host", BotGateIn{Tool: "web_extract", URLs: []string{"https://prices.example/x"}}, BotAllow, BotAllow, false},
		{"extract egress host", BotGateIn{Tool: "web_extract", URLs: []string{"https://api.example.net/"}}, BotAllow, BotAllow, false},
		{"extract search host", BotGateIn{Tool: "web_extract", URLs: []string{"https://found.example/"}}, BotAllow, BotAllow, false},
		{"extract search host tainted", BotGateIn{Tool: "web_extract", URLs: []string{"https://found.example/"}, Tainted: true}, BotBlock, BotAllow, true},
		{"extract other host", BotGateIn{Tool: "web_extract", URLs: []string{"https://elsewhere.example/"}}, BotBlock, BotAllow, true},
		{"browser read granted", BotGateIn{Tool: "bot_browser_read", URLs: []string{"https://shop.example.com/a"}}, BotAllow, BotAllow, false},
		{"browser read not granted", BotGateIn{Tool: "bot_browser_read", URLs: []string{"https://prices.example/item"}}, BotApprove, BotAllow, true},
		{"browser read acts", BotGateIn{Tool: "bot_browser_read", URLs: []string{"https://shop.example.com/a"}, Acts: true}, BotApprove, BotAllow, true},
		{"browser script", BotGateIn{Tool: "browser_exec", URLs: []string{"https://shop.example.com/a"}}, BotApprove, BotAllow, true},
		{"browser dialog", BotGateIn{Tool: "browser_dialog"}, BotApprove, BotAllow, true},
		{"terminal", BotGateIn{Tool: "terminal"}, BotBlock, BotBlock, false},
		{"vault", BotGateIn{Tool: "browser_vault"}, BotBlock, BotBlock, false},
		{"unknown", BotGateIn{Tool: "nope"}, BotBlock, BotBlock, false},
	}
	for _, tc := range cases {
		for _, mode := range []Mode{Supervised, Auto} {
			in := tc.in
			in.Mode, in.Hosts = mode, hosts
			out := BotGate(in)
			if out.Verdict != tc.supAuto || out.Lifted {
				t.Errorf("%s in %s: %+v, want %s", tc.name, mode, out, tc.supAuto)
			}
			if out.Verdict == BotBlock && out.Message == "" || out.Verdict != BotBlock && out.Reason == "" {
				t.Errorf("%s in %s: no message or reason: %+v", tc.name, mode, out)
			}
		}
		in := tc.in
		in.Mode, in.Hosts = Full, hosts
		out := BotGate(in)
		if out.Verdict != tc.fullOK || out.Lifted != tc.fullLifts {
			t.Errorf("%s in Full: %+v, want %s lifted=%v", tc.name, out, tc.fullOK, tc.fullLifts)
		}
	}
}

func TestBotMode(t *testing.T) {
	for _, c := range []struct {
		perm string
		ok   bool
		want Mode
	}{
		{"supervised", false, Supervised}, {"auto", true, Auto}, {"AUTO", false, Auto},
		{"full", true, Full}, {"full", false, Auto},
		{"", true, Supervised}, {"bogus", true, Supervised},
	} {
		if got := BotMode(c.perm, c.ok); got != c.want {
			t.Errorf("BotMode(%q,%v) = %q, want %q", c.perm, c.ok, got, c.want)
		}
	}
}

func TestBotHostsExactMatch(t *testing.T) {
	h := BotHosts{Browser: []string{"https://shop.example.com/x"}}
	for raw, want := range map[string]bool{
		"https://shop.example.com/y":     true,
		"https://www.shop.example.com/":  true,
		"https://example.com/":           false,
		"https://a.shop.example.com/":    false,
		"https://shop.example.com.evil/": false,
		"https://evilshop.example.com/":  false,
	} {
		if got := h.Granted(raw); got != want {
			t.Errorf("Granted(%q) = %v, want %v", raw, got, want)
		}
	}
}
