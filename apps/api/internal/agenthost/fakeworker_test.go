package agenthost

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// The tests run the test binary itself as a fake worker: TestMain sees the
// marker argument and speaks the Go side of the protocol (doc.go) instead of
// running tests. Its mode is an argument too, because the supervisor builds
// the worker's environment from scratch.
const fakeMarker = "agenthost-fake-worker"

func TestMain(m *testing.M) {
	if len(os.Args) >= 4 && os.Args[1] == fakeMarker {
		switch os.Args[3] {
		case "prepare", "render-account":
			os.Exit(fakeHelper(os.Args[2], os.Args[3], os.Args[4:]))
		}
		os.Exit(fakeWorker(os.Args[2]))
	}
	os.Exit(m.Run())
}

// fakeHelper plays boot.py prepare and render-account.
func fakeHelper(mode, command string, args []string) int {
	agentDir := ""
	for i := 0; i+1 < len(args); i++ {
		if args[i] == "--agent-dir" {
			agentDir = args[i+1]
		}
	}
	input, _ := io.ReadAll(os.Stdin)
	answer := map[string]any{"ok": true}
	switch {
	case mode == "render-fails" && command == "render-account":
		fmt.Fprintln(os.Stderr, "Traceback: bad settings")
		fmt.Println(`{"ok": false, "error": "ValueError: bad settings"}`)
		return 1
	case command == "prepare":
		answer["seed_skills_dir"] = filepath.Join(agentDir, "seed", "skills")
		answer["env_secret_seen"] = os.Getenv("JWT_SECRET") != ""
	default:
		sum := sha256.Sum256(input)
		answer["config_sha256"] = "cfg-" + hex.EncodeToString(sum[:8])
	}
	fmt.Fprintln(os.Stderr, "fake helper:", command)
	out, _ := json.Marshal(answer)
	fmt.Println(string(out))
	return 0
}

func fakeRuntime(t *testing.T, mode string) Runtime {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return Runtime{Program: exe, Args: []string{fakeMarker, mode}}
}

// fakeWorker modes:
//
//	ok                 answers everything
//	silent             never answers hello
//	badselftest        ready with self_test.ok=false
//	refuse-hello       answers hello with an account-less error (bad config hash)
//	env-refused        sends an account-less error and exits 5 before hello
//	render-fails       its render-account step fails
//	wrongaccount       ready stamped with another account
//	oldprotocol        ready with protocol 99
//	garbage            prints a traceback on stdout
//	crash-on-start     exits 3 before reading anything
//	crash-after-ready  exits 4 right after ready
//	deaf               ready, then ignores pings
//	rogue              ready, then answers echo for another account
//	stubborn           ignores shutdown, stdin EOF and SIGTERM
//	spawn-child        ready, with a sleeping child in its process group
//	sleeper            sleeps (the child)
func fakeWorker(mode string) int {
	switch mode {
	case "sleeper":
		time.Sleep(time.Hour)
		return 0
	case "crash-on-start":
		fmt.Fprintln(os.Stderr, "boom: cannot import hermes")
		return 3
	case "garbage":
		fmt.Println("Traceback (most recent call last):")
		time.Sleep(time.Hour)
		return 0
	case "stubborn":
		signal.Ignore(syscall.SIGTERM)
	case "env-refused":
		fmt.Println(`{"type":"error","code":"refused","message":"worker environment refused: JWT_SECRET must not be in the worker environment"}`)
		return 5
	}

	var mu sync.Mutex
	enc := json.NewEncoder(os.Stdout)
	account := ""
	send := func(m map[string]any) {
		mu.Lock()
		defer mu.Unlock()
		if _, ok := m["account"]; !ok {
			m["account"] = account
		}
		_ = enc.Encode(m)
	}
	busy := map[string]any{}
	var child *exec.Cmd
	var firstHello map[string]any // what the supervisor sent; later hellos are test probes
	live := map[string]bool{}     // runs started and not done, like the real worker's

	in := bufio.NewScanner(os.Stdin)
	in.Buffer(make([]byte, 1<<20), 64<<20)
	for in.Scan() {
		var m map[string]any
		if err := json.Unmarshal(in.Bytes(), &m); err != nil {
			fmt.Fprintln(os.Stderr, "fake worker: bad line:", err)
			return 9
		}
		typ, _ := m["type"].(string)
		id, _ := m["id"].(string)
		if account == "" {
			account, _ = m["account"].(string)
		}
		switch typ {
		case "hello":
			if mode == "silent" {
				continue
			}
			if mode == "refuse-hello" {
				fmt.Printf("{\"type\":\"error\",\"id\":%q,\"code\":\"config_mismatch\",\"message\":\"config.yaml does not match settings_hash\"}\n", id)
				account = ""
				continue
			}
			if firstHello == nil {
				firstHello = m
			}
			wd, _ := os.Getwd()
			ready := map[string]any{
				"type": "ready", "id": id, "hermes_tag": "v0.23.0",
				"tools": []string{"terminal", "web_search"}, "plugins_loaded": []string{"timely_gate"},
				"self_test": map[string]any{"ok": true}, "hello": firstHello, "env": os.Environ(), "cwd": wd,
			}
			switch mode {
			case "badselftest":
				ready["self_test"] = map[string]any{"ok": false, "checks": []map[string]any{
					{"name": "plugins", "ok": true},
					{"name": "timely_gate", "ok": false, "detail": "plugin not loaded"},
				}}
			case "wrongaccount":
				ready["account"] = "someone-else"
			case "oldprotocol":
				ready["protocol"] = 99
			case "spawn-child":
				exe, _ := os.Executable()
				child = exec.Command(exe, fakeMarker, "sleeper")
				child.Stderr = os.Stderr
				if err := child.Start(); err != nil {
					fmt.Fprintln(os.Stderr, "fake worker: child:", err)
					return 8
				}
				ready["child"] = child.Process.Pid
			}
			fmt.Fprintln(os.Stderr, "fake worker: ready for", mode)
			send(ready)
			if mode == "crash-after-ready" {
				return 4
			}
		case "ping":
			if mode == "deaf" {
				continue
			}
			send(map[string]any{"type": "pong", "id": id, "busy": busy})
		case "echo":
			reply := map[string]any{"type": "echo.reply", "id": id, "payload": m["payload"]}
			if mode == "rogue" {
				reply["account"] = "someone-else"
			}
			send(reply)
		case "fail-me":
			send(map[string]any{"type": "error", "id": id, "message": "nope"})
		case "set-busy":
			busy, _ = m["busy"].(map[string]any)
			send(map[string]any{"type": "heartbeat", "busy": busy})
			send(map[string]any{"type": "ack", "id": id})
		case "log-me":
			send(map[string]any{"type": "log", "level": "info", "text": "hello from the worker"})
		case "run.start":
			run, _ := m["run"].(string)
			if live[run] { // the real worker's answer to a second start of a live run
				send(map[string]any{"type": "error", "id": id, "run": run, "code": "duplicate_run", "message": "run is already running"})
				continue
			}
			if strings.HasPrefix(run, "refuse-") { // like the real worker's busy answer
				send(map[string]any{"type": "error", "id": id, "run": run, "code": "busy", "message": "this conversation already has a live run"})
				continue
			}
			live[run] = true
			if strings.HasPrefix(run, "hang-") { // a long turn: one event, then nothing until run.stop
				send(map[string]any{"type": "event", "run": run, "kind": "delta", "payload": map[string]any{"text": "thinking"}})
				continue
			}
			send(map[string]any{"type": "event", "run": run, "kind": "delta", "payload": map[string]any{"text": "Hi"}})
			send(map[string]any{"type": "tool.call", "id": "w-" + run, "run": run, "name": "get_context", "args": map[string]any{}})
		case "gate.verdict":
			send(map[string]any{"type": "event", "run": strings.TrimPrefix(id, "w-gate-"), "kind": "status",
				"payload": map[string]any{"verdict": m["verdict"]}})
		case "ask-gate":
			send(map[string]any{"type": "gate.ask", "id": "w-gate-" + fmt.Sprint(m["run"]), "run": m["run"], "tool": "terminal"})
		case "tool.result":
			run := strings.TrimPrefix(id, "w-")
			if r, _ := m["result"].(string); strings.HasPrefix(r, "Error:") {
				send(map[string]any{"type": "event", "run": run, "kind": "tool.completed", "payload": map[string]any{"result": r}})
				continue
			}
			delete(live, run)
			send(map[string]any{"type": "run.done", "run": run, "completed": true, "final_response": fmt.Sprint(m["result"])})
		case "approval.answer": // the real worker refuses a choice other than once or deny
			send(map[string]any{"type": "error", "id": id, "run": m["run"], "code": "bad_message", "message": "choice must be once or deny"})
		case "run.stop":
			run, _ := m["run"].(string)
			delete(live, run)
			send(map[string]any{"type": "run.done", "run": run, "interrupted": true})
		case "shutdown":
			if mode == "stubborn" {
				continue
			}
			return 0
		}
	}
	// stdin closed: the lifeline.
	if mode == "stubborn" {
		time.Sleep(time.Hour)
	}
	return 0
}
