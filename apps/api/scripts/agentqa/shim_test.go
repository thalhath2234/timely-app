package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// The shim leaves Hermes' learning-pass prompt as it is, so the stub plays
// the REVIEW list of the conversation's directive (a phrase-table entry)
// instead of replaying the turn's SCRIPT.
func TestShimPlaysTheReviewListInTheLearningPass(t *testing.T) {
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 not installed")
	}
	tests, err := filepath.Abs("../../../agent/tests")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(tests, "stub_openai.py")); err != nil {
		t.Skip("apps/agent/tests/stub_openai.py not found")
	}
	dir := t.TempDir()
	phrases := filepath.Join(dir, "phrases.json")
	directive := `SCRIPT [{"calls": [["todo_list", {}]]}, {"text": "Sorted."}] REVIEW [{"calls": [["skill_manage", {"action": "create", "name": "aisle-sort"}]]}, {"text": "Saved."}]`
	if err := os.WriteFile(phrases, []byte(`{"Sort my groceries by aisle": `+jsonString(directive)+`}`), 0o644); err != nil {
		t.Fatal(err)
	}
	script := `
import json, sys
sys.path[:0] = [sys.argv[1], sys.argv[2]]
import ollama_shim, stub_openai
ollama_shim.PHRASES = sys.argv[3]
body = {"messages": [
    {"role": "system", "content": "You are Timely."},
    {"role": "user", "content": "Sort my groceries by aisle"},
    {"role": "assistant", "content": None, "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "todo_list", "arguments": "{}"}}]},
    {"role": "tool", "tool_call_id": "c1", "content": "ok"},
    {"role": "assistant", "content": "Sorted."},
    {"role": "user", "content": "Review the conversation above. Other tools will be denied at runtime."},
]}
msg, _, _ = stub_openai.decide(ollama_shim.cut_body(body))
print(json.dumps(msg))
ollama_shim.LOG = sys.argv[4]
ollama_shim.log_request("/v1/chat/completions", body)
logged = [json.loads(line) for line in open(sys.argv[4])]
print("LOGGED", len(logged), logged[0]["messages"][-1]["role"], logged[0]["messages"][2]["tool_calls"])
`
	wd, _ := os.Getwd()
	out, err := exec.Command(python, "-I", "-c", script, wd, tests, phrases, filepath.Join(dir, "requests.jsonl")).CombinedOutput()
	if err != nil {
		t.Fatalf("python: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), `"skill_manage"`) || !strings.Contains(string(out), "aisle-sort") {
		t.Fatalf("the learning pass did not play the REVIEW list: %s", out)
	}
	// TIMELY_SHIM_LOG keeps what the model saw, tool calls included.
	if !strings.Contains(string(out), `LOGGED 1 user ['todo_list']`) {
		t.Fatalf("request log: %s", out)
	}
}

// Host tool shorthands (phase 5) become the CALL directive they stand for, whether they sit in a
// message or in a phrase-table entry, and a continuation turn with no directive of its own gets
// the conversation's newest one, so an approved parked call comes back with the same arguments.
// Prose that merely holds the word is left alone.
func TestShimTurnsHostShorthandsIntoCalls(t *testing.T) {
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 not installed")
	}
	tests, err := filepath.Abs("../../../agent/tests")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(tests, "stub_openai.py")); err != nil {
		t.Skip("apps/agent/tests/stub_openai.py not found")
	}
	dir := t.TempDir()
	phrases := filepath.Join(dir, "phrases.json")
	if err := os.WriteFile(phrases, []byte(`{"List my workspace": "TERMINAL ls -la"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	script := `
import json, sys
sys.path[:0] = [sys.argv[1], sys.argv[2]]
import ollama_shim
ollama_shim.PHRASES = sys.argv[3]
print(ollama_shim.cut("Timely notice.\nTERMINAL echo hi && ls\nmore"))
print(ollama_shim.cut("READ_FILE /work/a.txt"))
print(ollama_shim.cut("WRITE_FILE /work/hello.txt :: hi there"))
print(ollama_shim.cut('MCP_TOOL fake echo {"text": "x"}'))
print(ollama_shim.cut("MCP_TOOL fake ping"))
print(ollama_shim.cut("Tell me about the MCP_TOOL idea and TERMINAL access"))
body = {"messages": [
    {"role": "user", "content": "List my workspace"},
    {"role": "assistant", "content": None, "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "terminal", "arguments": "{}"}}]},
    {"role": "tool", "tool_call_id": "c1", "content": "Paused: waiting for the person's approval"},
    {"role": "user", "content": "You asked to run ls -la (terminal). The person approved it: run exactly that call now."},
]}
out = ollama_shim.cut_body(body)["messages"]
print(out[0]["content"], "|", out[3]["content"])
`
	wd, _ := os.Getwd()
	out, err := exec.Command(python, "-I", "-c", script, wd, tests, phrases).CombinedOutput()
	if err != nil {
		t.Fatalf("python: %v\n%s", err, out)
	}
	want := []string{
		`CALL terminal {"command": "echo hi && ls"}`,
		`CALL read_file {"path": "/work/a.txt"}`,
		`CALL write_file {"path": "/work/hello.txt", "content": "hi there"}`,
		`CALL mcp__fake__echo {"text": "x"}`,
		`CALL mcp__fake__ping {}`,
		`Tell me about the MCP_TOOL idea and TERMINAL access`,
		`CALL terminal {"command": "ls -la"} | CALL terminal {"command": "ls -la"}`,
	}
	got := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(got) != len(want) {
		t.Fatalf("got %d lines, want %d:\n%s", len(got), len(want), out)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("line %d: got %q, want %q", i, got[i], want[i])
		}
	}
}

func jsonString(s string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
}
