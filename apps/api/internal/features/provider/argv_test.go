package provider

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"timely-api/internal/features/agent"
	"timely-api/internal/features/chat"
)

// promptFileScript copies the file named by --system-prompt-file while the
// fake CLI runs, so the test can compare it after Complete has removed it.
func promptFileScript(dir string) string {
	return `prev=
for a in "$@"; do
  if [ "$prev" = "--system-prompt-file" ]; then
    printf '%s' "$a" > ` + filepath.Join(dir, "prompt-path") + `
    cp "$a" ` + filepath.Join(dir, "prompt-copy") + `
  fi
  prev=$a
done
`
}

func readArgs(t *testing.T, argsFile string) []string {
	t.Helper()
	raw, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatalf("the fake CLI did not run: %v", err)
	}
	return strings.Split(strings.TrimSuffix(string(raw), "\x00"), "\x00")
}

// checkPromptFile asserts the CLI got the system prompt as a file holding
// exactly the rendered prompt, and that the file is gone now.
func checkPromptFile(t *testing.T, bin, argsFile, system string) {
	t.Helper()
	dir := filepath.Dir(bin)
	args := readArgs(t, argsFile)
	for i, a := range args {
		if a == "--system-prompt" {
			t.Fatal("the system prompt must not travel on argv")
		}
		if a == system {
			t.Fatalf("argument %d is the whole system prompt", i)
		}
	}
	path, err := os.ReadFile(filepath.Join(dir, "prompt-path"))
	if err != nil {
		t.Fatalf("no --system-prompt-file argument in %q", args)
	}
	if filepath.Dir(string(path)) != scratchDir() {
		t.Errorf("prompt file %s is outside the scratch directory %s", path, scratchDir())
	}
	copied, err := os.ReadFile(filepath.Join(dir, "prompt-copy"))
	if err != nil {
		t.Fatalf("the prompt file was unreadable while the CLI ran: %v", err)
	}
	if string(copied) != system {
		t.Fatalf("prompt file holds %d bytes, want the %d-byte rendered system prompt", len(copied), len(system))
	}
	if _, err := os.Stat(string(path)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("prompt file %s still exists after Complete returned: %v", path, err)
	}
}

func TestClaudeCompletePassesSystemPromptAsFile(t *testing.T) {
	messages := []chat.WireMessage{{Role: "system", Content: "rules\nwith 'quotes' and $dollars"}, {Role: "user", Content: "hi"}}
	system, _, _ := render(messages, tools, false)

	bin, argsFile := fakeCLIAt(t, "claude", func(dir string) string {
		return promptFileScript(dir) + `echo '{"type":"result","subtype":"success","is_error":false,"result":"{\"content\":\"OK\",\"toolCalls\":[]}"}'`
	})
	got, err := (&Claude{Bin: bin, Model: "sonnet"}).Complete(context.Background(), messages, tools, false)
	if err != nil || got.Content != "OK" {
		t.Fatalf("%+v %v", got, err)
	}
	checkPromptFile(t, bin, argsFile, system)
}

func TestClaudeCompleteRemovesSystemPromptFileOnTimeout(t *testing.T) {
	messages := []chat.WireMessage{{Role: "system", Content: "rules"}, {Role: "user", Content: "hi"}}
	system, _, _ := render(messages, nil, false)

	bin, argsFile := fakeCLIAt(t, "claude", func(dir string) string {
		// exec, so the context's kill reaches the sleeping process itself and
		// no child keeps stdout open past the deadline.
		return promptFileScript(dir) + "exec sleep 30"
	})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	start := time.Now()
	_, err := (&Claude{Bin: bin, Model: "sonnet"}).Complete(ctx, messages, nil, false)
	if err == nil || !strings.Contains(err.Error(), "took too long") {
		t.Fatalf("a timed-out call must say so: %v", err)
	}
	if time.Since(start) > 20*time.Second {
		t.Fatal("Complete waited for the CLI instead of stopping it at the deadline")
	}
	checkPromptFile(t, bin, argsFile, system)
}

// TestCLIProvidersKeepArgvSmall renders the largest prompt the agent can
// build today and fails if any CLI provider puts more than 120 KB into one
// argument. Linux refuses a single argument over 128 KB (MAX_ARG_STRLEN) and
// Windows a whole command line over 32,767 characters.
func TestCLIProvidersKeepArgvSmall(t *testing.T) {
	const limit = 120 << 10
	messages, specs := largestAgentPrompt(t)
	system, _, _ := render(messages, specs, true)
	t.Logf("largest rendered system prompt: %d bytes", len(system))

	providers := []struct {
		name   string
		output string
		call   func(bin string) (chat.WireMessage, error)
	}{
		{"claude", `echo '{"type":"result","subtype":"success","is_error":false,"result":"{\"content\":\"OK\",\"toolCalls\":[]}"}'`, func(bin string) (chat.WireMessage, error) {
			return (&Claude{Bin: bin, Model: "sonnet"}).Complete(context.Background(), messages, specs, true)
		}},
		{"codex", `echo '{"type":"item.completed","item":{"type":"agent_message","text":"{\"content\":\"OK\",\"toolCalls\":[]}"}}'`, func(bin string) (chat.WireMessage, error) {
			return (&Codex{Bin: bin, Model: "gpt-5.5"}).Complete(context.Background(), messages, specs, true)
		}},
	}
	for _, p := range providers {
		t.Run(p.name, func(t *testing.T) {
			bin, argsFile := fakeCLIAt(t, p.name, func(dir string) string { return promptFileScript(dir) + p.output })
			got, err := p.call(bin)
			if err != nil || got.Content != "OK" {
				t.Fatalf("%+v %v", got, err)
			}
			for i, a := range readArgs(t, argsFile) {
				if len(a) > limit {
					t.Errorf("argument %d is %d bytes, over the %d-byte budget", i, len(a), limit)
				}
				if strings.Contains(a, system) {
					t.Errorf("argument %d carries the whole system prompt", i)
				}
			}
			if p.name == "claude" {
				checkPromptFile(t, bin, argsFile, system)
			}
		})
	}
}

// largestAgentPrompt builds the biggest configuration the chat runner can
// produce today: every catalog tool offered both as a read spec and as a
// write schema, plus propose_changes, web_search and resolve_target, the reply
// card (genui) prompt and the search and target hints. The runner's own
// instruction text is unexported, so a stand-in of similar size takes its place.
func largestAgentPrompt(t *testing.T) ([]chat.WireMessage, []any) {
	t.Helper()
	catalog := agent.NewCatalog(agent.Deps{})
	names := make([]string, 0, len(catalog))
	for name := range catalog {
		names = append(names, name)
	}
	sort.Strings(names)
	spec := func(name, desc string, params any) any {
		return map[string]any{"type": "function", "function": map[string]any{"name": name, "description": desc, "parameters": params}}
	}
	specs := []any{}
	writes := []agent.Tool{}
	for _, name := range names {
		tool := catalog[name]
		specs = append(specs, spec(name, tool.Description, tool.Parameters))
		writes = append(writes, tool)
	}
	object := func(props map[string]any, required ...string) map[string]any {
		return map[string]any{"type": "object", "properties": props, "required": required}
	}
	str := map[string]any{"type": "string"}
	specs = append(specs,
		spec("propose_changes", "Submit the entire ordered plan. Arguments are JSON objects matching the write schemas.", object(map[string]any{
			"summary": str, "direct": map[string]any{"type": "boolean"}, "reply": str, "remaining": str, "language": str,
			"steps": map[string]any{"type": "array", "minItems": 1, "maxItems": 30, "items": object(map[string]any{"tool": str, "summary": str, "arguments": map[string]any{"type": "object"}}, "tool", "summary", "arguments")},
		}, "summary", "steps", "direct", "reply", "remaining", "language")),
		spec("web_search", "Research a public question. Returns an answer with source links.", object(map[string]any{"query": str}, "query")),
		spec("resolve_target", "Shortlist the existing items a change may be about when its name could match several.", object(map[string]any{
			"kind": map[string]any{"type": "string", "enum": []string{"task", "event", "doc", "sheet", "project"}}, "name": str,
		}, "kind", "name")),
	)
	genui, err := os.ReadFile(filepath.Join("..", "chat", "genui_prompt.txt"))
	if err != nil {
		t.Fatalf("reading the reply card prompt: %v", err)
	}
	encoded, err := json.Marshal(writes)
	if err != nil {
		t.Fatal(err)
	}
	instruction := strings.Repeat("You are Timely's in-app assistant. Help the signed-in person organize their own work.\n", 130)
	system := instruction + "\n\n" + string(genui) +
		"\nWhen a change names an existing item in words that may match more than one, call resolve_target." +
		"\nWeb search is on in this chat." +
		"\nWrite tool schemas:\n" + string(encoded)
	// The budget check only means something with a prompt over the 128 KB
	// argument limit, so pad a smaller one rather than depend on catalog size.
	const floor = 200 << 10
	if len(system) < floor {
		system += "\n" + strings.Repeat("x", floor-len(system)-1)
	}
	return []chat.WireMessage{{Role: "system", Content: system, Cache: true}, {Role: "user", Content: "Plan my week"}}, specs
}
