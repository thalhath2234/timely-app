package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"timely-api/internal/agenthost"
	"timely-api/internal/features/bots"
)

// TestIntegrationAgentEngineRealWorkerBotTick runs agent Bot ticks through
// the real Python worker (bot.run, PROTOCOL.md section 13) on the stub model
// (the agentqa shim, 127.0.0.1 only): the Pixel tick is silent while the
// phone is out of stock and reports once when it is in stock (its notepad
// write reaching this Bot's notes), and a browser read of a granted site runs
// alone while a read of a site the Bot was not granted parks on its Bot
// thread. browser_exec is not offered to a tick at all (Hermes offers it only
// next to terminal), so the model's call to it runs nothing and parks nothing.
//
// It runs under make agent-go-realworker (TIMELY_AGENT_TEST_RUNTIME and
// CHAT_TEST_ENV). HOME for the worker is the account's own, and the "real"
// home (HERMES_REAL_HOME), the agent folder and the browser profile are a
// throwaway sandbox under $HOME/.cache/p6-sandbox; every process the worker
// starts is logged by the exec trap. The browser's sites are .example names
// and the read itself is faked in the worker (botBrowserBoot), so no browser
// starts and nothing reaches the network.
func TestIntegrationAgentEngineRealWorkerBotTick(t *testing.T) {
	rt := realRuntime(t)
	if runtime.GOOS == "windows" {
		t.Skip("POSIX sandbox")
	}
	sb := newP6Sandbox(t)
	rec := recordModel(t, startShim(t, rt))
	settings, _ := json.Marshal(map[string]any{
		"toolsets": []string{"timely", "todo", "skills", "web"}, "learning": map[string]bool{"memory": false, "user_profile": false},
		"curator": false, "timezone": "UTC", "host_allowed": false,
		"web": map[string]string{"search_backend": "timely", "extract_backend": "timely"},
	})
	readLog := filepath.Join(sb.root, "browser-reads.jsonl")
	cfg := agenthost.Config{
		Root:          filepath.Join(sb.root, "agent"),
		Runtime:       botBrowserRuntime(t, rt, sb, readLog),
		RenderAccount: true,
		HelloTimeout:  90 * time.Second,
		Env:           agenthost.EnvConfig{Path: os.Getenv("PATH"), RealHome: sb.home},
		Account: func(context.Context, string) (agenthost.AccountSpec, error) {
			return agenthost.AccountSpec{Settings: settings}, nil
		},
	}
	db := integrationDB(t)
	if err := db.AutoMigrate(&bots.Bot{}, &bots.Watch{}, &bots.Note{}); err != nil {
		t.Fatal(err)
	}
	s := New(db, engineCatalog, nil)
	w := newBotWorldWith(t, s, nil, cfg, bots.NewNotesStore(db), func(o *WorkerEngineOptions) { o.Model = stubModelAt(rec) })

	b := testBot("bot_pixel")
	b.Tools = bots.AgentTools{BrowserSites: []string{"pixel.example"}}
	b.Egress = []string{"ungranted.example"}
	createBot(t, s, b)
	tick := func(check, prompt string, data map[string]bots.Reading) bots.AgentResult {
		t.Helper()
		in := tickInput(b, check, prompt)
		in.Tools.Egress = []string(b.Egress)
		in.Readings = data
		in.Deadline = time.Now().Add(3 * time.Minute)
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
		defer cancel()
		res, err := w.a.Run(ctx, "user-a", in)
		if err != nil {
			t.Fatalf("tick %s: %v", check, err)
		}
		return res
	}
	price := func(p float64, avail string) map[string]bots.Reading {
		return map[string]bots.Reading{"wch_pixel": {Kind: "price", Price: &p, Currency: "INR", Availability: avail, At: time.Now().UTC()}}
	}
	const pixel = "Pixel 10 Pro under ₹90,000. Alert when the price is below ₹90,000 and it can be bought (in stock). Stay silent otherwise."

	// 1. Out of stock: silent, nothing reported.
	res := tick("bchk_px_oos", pixel+"\nSCRIPT "+mustJSON([]any{map[string]any{"text": "[SILENT]"}}), price(109999, "OutOfStock"))
	if res.ErrorClass != "" || !res.Silent || len(res.Reports) != 0 {
		t.Fatalf("out of stock: %+v", res)
	}

	// 2. In stock: one report, and the note lands in this Bot's notepad.
	report := map[string]any{"title": "Pixel 10 Pro is in stock under ₹90,000", "body": "₹89,999 and it can be bought.", "urgency": "normal"}
	script := []any{
		map[string]any{"calls": []any{[]any{"bot_note_set", map[string]any{"key": "last_price", "value": "89999"}}, []any{"bot_report", report}}},
		map[string]any{"text": "Pixel 10 Pro is at ₹89,999 and in stock."},
	}
	res = tick("bchk_px_in", pixel+"\nSCRIPT "+mustJSON(script), price(89999, "InStock"))
	if res.ErrorClass != "" || res.Silent || len(res.Reports) != 1 || res.Reports[0].Title != report["title"] {
		t.Fatalf("in stock: %+v", res)
	}
	if v, ok, err := bots.NewNotesStore(db).Get(context.Background(), "user-a", "bot_pixel", "last_price"); err != nil || !ok || v != "89999" {
		t.Fatalf("note %q %v %v", v, ok, err)
	}

	// 3. The browser: a granted site's read runs alone (Go allows it, no
	// card); a read of a site the Bot may reach but was not granted the
	// browser for parks on its thread; a script (bot_browser_exec) never runs
	// in a tick: it parks too, and with the thread's card taken it is not
	// asked.
	script = []any{
		map[string]any{"calls": []any{[]any{"bot_browser_read", map[string]any{"url": "https://pixel.example/p"}}}},
		map[string]any{"calls": []any{[]any{"bot_browser_read", map[string]any{"url": "https://ungranted.example/q"}}}},
		map[string]any{"calls": []any{[]any{"bot_browser_exec", map[string]any{"code": "print('BOTEXECMARK')"}}}},
		map[string]any{"text": "[SILENT]"},
	}
	res = tick("bchk_px_browser", pixel+"\nSCRIPT "+mustJSON(script), nil)
	if res.ErrorClass != "" {
		t.Fatalf("browser tick: %+v", res)
	}
	var reads []bots.ToolTrace
	execs := 0
	for _, tr := range res.Trace {
		if tr.Tool == "bot_browser_read" {
			reads = append(reads, tr)
		}
		if tr.Tool == "bot_browser_exec" {
			execs++
			if tr.Outcome == "ok" {
				t.Fatalf("bot_browser_exec ran: %+v", res.Trace)
			}
		}
	}
	if execs != 1 {
		t.Fatalf("bot_browser_exec traced %d times, want 1 (trace %+v)", execs, res.Trace)
	}
	if len(reads) != 2 || reads[0].Outcome != "ok" || reads[0].Host != "pixel.example" || reads[1].Outcome != "parked" {
		t.Fatalf("browser reads %+v (trace %+v)", reads, res.Trace)
	}
	// The granted read ran once, on the worker's browser read (faked here so
	// no browser starts), and the parked one never reached it.
	if raw, _ := os.ReadFile(readLog); strings.Count(string(raw), "\n") != 1 || !strings.Contains(string(raw), "https://pixel.example/p") {
		t.Fatalf("browser reads that ran: %q", raw)
	}
	thread := botThreadOf(t, s, "bot_pixel")
	h := thread.HostRequest
	if thread.Status != statusHostApproval || h.Tool != "bot_browser_read" || h.Card == nil || h.Card.URL != "https://ungranted.example/q" || h.Run != "brun_bchk_px_browser" {
		t.Fatalf("thread %s card %+v", thread.Status, h)
	}
	var cards int64
	s.db.Model(&AgentHostEvent{}).Where("conversation_id = ? AND kind = ?", thread.ID, eventRequested).Count(&cards)
	if cards != 1 {
		t.Fatalf("%d cards asked, want 1 (the ungranted read)", cards)
	}
	for _, r := range sb.records() {
		if strings.Contains(r.Cmd, "BOTEXECMARK") {
			t.Fatalf("a process ran the browser_exec code: %+v", r)
		}
	}
}

// botBrowserBoot wraps probe_boot.py (the exec trap) for the bot test: names
// under .example resolve to a public address (as in the worker's own bot
// contract tests), so the worker's private-address floor lets them through to
// Go, and the bot's browser read is replaced, once its module loads, by one
// that logs the URL and returns a page: no browser starts and nothing reaches
// the network. Everything else is the real boot path.
const botBrowserBoot = `import importlib.abc, importlib.machinery, json, socket, sys
CONTRACT, LOG = %q, %q
sys.path.insert(0, CONTRACT)
_orig = socket.getaddrinfo
def _fake(host, port=None, *args, **kwargs):
    if isinstance(host, str) and host.rstrip(".").endswith(".example"):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port or 443))]
    return _orig(host, port, *args, **kwargs)
socket.getaddrinfo = _fake
TARGET = "timely_agent.plugins.timely_bot.browser"
class _Finder(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path, target=None):
        if name != TARGET:
            return None
        spec = importlib.machinery.PathFinder.find_spec(name, path)
        if spec is None or spec.loader is None:
            return spec
        inner = spec.loader
        class _Loader(importlib.abc.Loader):
            def create_module(self, spec):
                return inner.create_module(spec)
            def exec_module(self, module):
                inner.exec_module(module)
                def read(url, mode, bot, task_id=None, exec_fn=None):
                    bot.note_host(module.runctx.norm_host(url))
                    with open(LOG, "a") as f:
                        f.write(json.dumps({"url": url}) + "\n")
                    return {"title": "Pixel", "url": url, "mode": mode, "text": "In stock"}
                module.read = read
        spec.loader = _Loader()
        return spec
sys.meta_path.insert(0, _Finder())
import probe_boot
sys.exit(probe_boot.main(sys.argv[1:]))
`

// botBrowserRuntime is rt started through botBrowserBoot, with the exec trap.
func botBrowserRuntime(t *testing.T, rt agenthost.Runtime, sb p5Sandbox, readLog string) agenthost.Runtime {
	t.Helper()
	contract := filepath.Join(agentTests(rt), "contract")
	if _, err := os.Stat(filepath.Join(contract, "probe_boot.py")); err != nil {
		t.Skipf("no probe_boot.py next to runtime %v", rt.Args)
	}
	wrapper := filepath.Join(sb.root, "bot_boot.py")
	if err := os.WriteFile(wrapper, []byte(fmt.Sprintf(botBrowserBoot, contract, readLog)), 0o600); err != nil {
		t.Fatal(err)
	}
	return agenthost.Runtime{Program: rt.Program, Args: []string{"-I", wrapper, "--exec-trap", sb.trapLog}}
}

func mustJSON(v any) string {
	raw, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(raw)
}

// newP6Sandbox is a throwaway "real" home (HERMES_REAL_HOME, where the
// browser profile would be), agent folder and exec trap log under
// $HOME/.cache/p6-sandbox, removed after the test.
func newP6Sandbox(t *testing.T) p5Sandbox {
	t.Helper()
	userHome, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	base := filepath.Join(userHome, ".cache", "p6-sandbox")
	if err := os.MkdirAll(base, 0o700); err != nil {
		t.Fatal(err)
	}
	root, err := os.MkdirTemp(base, "gotest-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if strings.HasPrefix(root, base+string(filepath.Separator)) && os.Getenv("TIMELY_AGENT_KEEP") == "" {
			_ = os.RemoveAll(root)
		}
	})
	sb := p5Sandbox{root: root, home: filepath.Join(root, "home"), work: filepath.Join(root, "work"), trapLog: filepath.Join(root, "exec-trap.jsonl")}
	for _, dir := range []string{sb.home, sb.work} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	return sb
}
