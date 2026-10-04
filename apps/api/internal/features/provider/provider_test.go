package provider

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"timely-api/internal/features/chat"
)

// tools marks a call as a tool-calling turn that uses the JSON protocol.
var tools = []any{map[string]any{"type": "function", "function": map[string]any{"name": "get_context"}}}

func TestParseResponseMapsToolCalls(t *testing.T) {
	got, err := parseResponse("```json\n{\"content\":\"\",\"toolCalls\":[{\"name\":\"get_context\",\"arguments\":\"{\\\"a\\\":1}\"},{\"name\":\"\",\"arguments\":\"\"}]}\n```")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.ToolCalls) != 1 || got.ToolCalls[0].Function.Name != "get_context" || got.ToolCalls[0].Function.Arguments != `{"a":1}` || got.ToolCalls[0].ID != "call_1" || got.ToolCalls[0].Type != "function" {
		t.Fatalf("unexpected tool calls: %+v", got.ToolCalls)
	}
	if _, err := parseResponse("not json"); err == nil {
		t.Fatal("garbage must be rejected")
	}
}

// Seen from Sonnet: the protocol object JSON-encoded inside "content", which
// reached the chat as raw JSON instead of a proposal.
func TestParseResponseUnwrapsNestedProtocolObject(t *testing.T) {
	inner := `{"content":"","toolCalls":[{"name":"propose_changes","arguments":"{\"summary\":\"Retype columns\"}"}]}`
	outer, _ := json.Marshal(map[string]any{"content": inner, "toolCalls": []any{}})
	got, err := parseResponse(string(outer))
	if err != nil {
		t.Fatal(err)
	}
	if got.Content != "" || len(got.ToolCalls) != 1 || got.ToolCalls[0].Function.Name != "propose_changes" || got.ToolCalls[0].Function.Arguments != `{"summary":"Retype columns"}` {
		t.Fatalf("nested object not unwrapped: %+v", got)
	}

	twice, _ := json.Marshal(map[string]any{"content": string(outer), "toolCalls": []any{}})
	if got, err := parseResponse(string(twice)); err != nil || len(got.ToolCalls) != 1 {
		t.Fatalf("doubly nested object not unwrapped: %+v %v", got, err)
	}

	reply, _ := json.Marshal(map[string]any{"content": "Done.", "toolCalls": []any{}})
	nestedReply, _ := json.Marshal(map[string]any{"content": string(reply), "toolCalls": []any{}})
	if got, _ := parseResponse(string(nestedReply)); got.Content != "Done." || len(got.ToolCalls) != 0 {
		t.Fatalf("nested reply not unwrapped: %+v", got)
	}

	objectArgs := `{"content":"","toolCalls":[{"name":"propose_changes","arguments":{"summary":"Retype columns"}}]}`
	fenced := "```json\n" + objectArgs + "\n```"
	for _, content := range []string{objectArgs, fenced} {
		raw, _ := json.Marshal(map[string]any{"content": content, "toolCalls": []any{}})
		got, err := parseResponse(string(raw))
		if err != nil || len(got.ToolCalls) != 1 || got.ToolCalls[0].Function.Arguments != `{"summary":"Retype columns"}` {
			t.Fatalf("nested %q not unwrapped: %+v %v", content, got, err)
		}
	}

	// JSON the person asked for is content, not protocol.
	for _, content := range []string{`{"content":"x"}`, `{"content":"x","toolCalls":[],"extra":1}`, `{"total":4760}`, `[1,2]`} {
		raw, _ := json.Marshal(map[string]any{"content": content, "toolCalls": []any{}})
		if got, _ := parseResponse(string(raw)); got.Content != content {
			t.Fatalf("content %s was rewritten to %+v", content, got)
		}
	}
}

func TestRenderKeepsSystemAndToolsOutOfTranscript(t *testing.T) {
	messages := []chat.WireMessage{
		{Role: "system", Content: "SYSTEM RULES"},
		{Role: "user", Content: "hello", ImageURLs: []string{"data:image/png;base64,QUJD"}},
		{Role: "assistant", ToolCalls: []chat.ToolCall{{ID: "call_1", Type: "function", Function: struct {
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
		}{Name: "get_context", Arguments: "{}"}}}},
		{Role: "tool", ToolCallID: "call_1", Content: `{"ok":true}`},
	}
	system, transcript, images := render(messages, []any{map[string]any{"type": "function"}}, true)
	if !strings.Contains(system, "SYSTEM RULES") || !strings.Contains(system, "Response protocol") || !strings.Contains(system, `"type":"function"`) || !strings.Contains(system, "Web search is enabled") {
		t.Fatalf("system prompt incomplete:\n%s", system)
	}
	if strings.Contains(transcript, "SYSTEM RULES") || !strings.Contains(transcript, "[tool result call_1]") || !strings.Contains(transcript, "get_context") || !strings.HasSuffix(strings.TrimSpace(transcript), "Respond now with the JSON object.") {
		t.Fatalf("transcript wrong:\n%s", transcript)
	}
	if len(images) != 1 {
		t.Fatal("image must be carried separately")
	}
	system, transcript, _ = render(messages, nil, false)
	if strings.Contains(system, "Web search is enabled") || strings.Contains(system, "Response protocol") || strings.Contains(transcript, "JSON object") {
		t.Fatal("tool-less calls must be plain text with no search hint")
	}
}

func TestPlainCallsReturnRawText(t *testing.T) {
	bin, argsFile := fakeCLI(t, "claude", `echo '{"type":"result","subtype":"success","is_error":false,"result":"{\"receipt\":null,\"description\":\"green square\"}"}'`)
	got, err := (&Claude{Bin: bin, Model: "sonnet"}).Complete(context.Background(), []chat.WireMessage{{Role: "system", Content: "Return JSON"}, {Role: "user", Content: "hi"}}, nil, false)
	if err != nil || got.Content != `{"receipt":null,"description":"green square"}` {
		t.Fatalf("%+v %v", got, err)
	}
	if args, _ := os.ReadFile(argsFile); strings.Contains(string(args), "--json-schema") {
		t.Fatal("plain calls must not force the tool-call schema")
	}
	bin, argsFile = fakeCLI(t, "codex", `echo '{"type":"item.completed","item":{"type":"agent_message","text":"{\"a\":1}"}}'`)
	got, err = (&Codex{Bin: bin, Model: "gpt-5.5"}).Complete(context.Background(), []chat.WireMessage{{Role: "user", Content: "hi"}}, nil, false)
	if err != nil || got.Content != `{"a":1}` {
		t.Fatalf("%+v %v", got, err)
	}
	if args, _ := os.ReadFile(argsFile); strings.Contains(string(args), "--output-schema") {
		t.Fatal("plain calls must not force the tool-call schema")
	}
}

// fakeCLI writes an executable that records its arguments and prints canned output.
func fakeCLI(t *testing.T, name, script string) (bin, argsFile string) {
	t.Helper()
	dir := t.TempDir()
	bin = filepath.Join(dir, name)
	argsFile = filepath.Join(dir, "args")
	body := "#!/bin/sh\nprintf '%s\\0' \"$@\" > " + argsFile + "\ncat > " + filepath.Join(dir, "stdin") + "\n" + script + "\n"
	if err := os.WriteFile(bin, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	return bin, argsFile
}

func TestClaudeCompleteUsesStructuredOutputAndDisablesTools(t *testing.T) {
	bin, argsFile := fakeCLI(t, "claude", `echo '{"type":"system","subtype":"init"}'
echo '{"type":"result","subtype":"success","is_error":false,"result":"{\"content\":\"OK\",\"toolCalls\":[]}","structured_output":{"content":"OK","toolCalls":[{"name":"get_context","arguments":"{}"}]}}'`)
	p := &Claude{Bin: bin, Model: "sonnet"}
	got, err := p.Complete(context.Background(), []chat.WireMessage{{Role: "system", Content: "rules"}, {Role: "user", Content: "hi", ImageURLs: []string{"data:image/png;base64,QUJD"}}}, tools, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.ToolCalls) != 1 || got.ToolCalls[0].Function.Name != "get_context" {
		t.Fatalf("structured output must win: %+v", got)
	}
	args, _ := os.ReadFile(argsFile)
	joined := string(args)
	for _, want := range []string{"--tools\x00\x00", "--strict-mcp-config", "--setting-sources\x00\x00", "--no-session-persistence", "--json-schema", "--input-format\x00stream-json", "--model\x00sonnet"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in %q", want, joined)
		}
	}
	if strings.Contains(joined, "WebSearch") {
		t.Fatal("search tool must be off by default")
	}
	stdin, _ := os.ReadFile(filepath.Join(filepath.Dir(bin), "stdin"))
	var msg struct {
		Message struct {
			Content []map[string]any `json:"content"`
		} `json:"message"`
	}
	if err := json.Unmarshal(stdin, &msg); err != nil || len(msg.Message.Content) != 2 || msg.Message.Content[1]["type"] != "image" {
		t.Fatalf("image must be sent as a content block: %s", stdin)
	}
}

func TestClaudeCompleteEnablesSearchToolOnlyWhenAsked(t *testing.T) {
	bin, argsFile := fakeCLI(t, "claude", `echo '{"type":"result","subtype":"success","is_error":false,"result":"{\"content\":\"x\",\"toolCalls\":[]}"}'`)
	p := &Claude{Bin: bin, Model: "opus"}
	if _, err := p.Complete(context.Background(), []chat.WireMessage{{Role: "user", Content: "hi"}}, tools, true); err != nil {
		t.Fatal(err)
	}
	args, _ := os.ReadFile(argsFile)
	if !strings.Contains(string(args), "--tools\x00WebSearch\x00--allowedTools\x00WebSearch") {
		t.Fatalf("search must enable only WebSearch: %s", args)
	}
}

func TestClaudeCompleteSurfacesErrors(t *testing.T) {
	bin, _ := fakeCLI(t, "claude", `echo '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Not logged in · Please run /login"}'`)
	p := &Claude{Bin: bin, Model: "sonnet"}
	_, err := p.Complete(context.Background(), []chat.WireMessage{{Role: "user", Content: "hi"}}, nil, false)
	if err == nil || !strings.Contains(err.Error(), "not signed in") {
		t.Fatalf("login failure must be explained: %v", err)
	}
	bin, _ = fakeCLI(t, "claude", `echo "boom" >&2; exit 1`)
	p = &Claude{Bin: bin, Model: "sonnet"}
	_, err = p.Complete(context.Background(), []chat.WireMessage{{Role: "user", Content: "hi"}}, nil, false)
	if err == nil || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("stderr must be surfaced: %v", err)
	}
}

func TestCodexCompleteReadsAgentMessageAndSandboxes(t *testing.T) {
	bin, argsFile := fakeCLI(t, "codex", `echo '{"type":"thread.started"}'
echo '{"type":"item.completed","item":{"type":"agent_message","text":"{\"content\":\"Done\",\"toolCalls\":[]}"}}'
echo '{"type":"turn.completed"}'`)
	p := &Codex{Bin: bin, Model: "gpt-5.5"}
	got, err := p.Complete(context.Background(), []chat.WireMessage{{Role: "system", Content: "rules"}, {Role: "user", Content: "hi", ImageURLs: []string{"data:image/png;base64,QUJD"}}}, tools, true)
	if err != nil || got.Content != "Done" {
		t.Fatalf("%+v %v", got, err)
	}
	args, _ := os.ReadFile(argsFile)
	joined := string(args)
	for _, want := range []string{"exec", "--ephemeral", "-s\x00read-only", "--disable\x00shell_tool", `web_search="live"`, "--output-schema", "--json", "-m\x00gpt-5.5", "-i\x00"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in %q", want, args)
		}
	}
	stdin, _ := os.ReadFile(filepath.Join(filepath.Dir(bin), "stdin"))
	if !strings.Contains(string(stdin), "rules") || !strings.Contains(string(stdin), "[user]") {
		t.Fatalf("prompt must arrive on stdin: %s", stdin)
	}
}

func TestCodexCompleteReportsTurnFailure(t *testing.T) {
	bin, _ := fakeCLI(t, "codex", `echo '{"type":"turn.failed","error":{"message":"usage limit reached"}}'`)
	p := &Codex{Bin: bin, Model: "gpt-5.5"}
	_, err := p.Complete(context.Background(), []chat.WireMessage{{Role: "user", Content: "hi"}}, nil, false)
	if err == nil || !strings.Contains(err.Error(), "usage limit") {
		t.Fatalf("limit must be explained: %v", err)
	}
}

func TestEncryptRoundTripAndHint(t *testing.T) {
	t.Setenv("JWT_SECRET", "unit-secret")
	s := New(nil, nil, nil)
	sealed, err := s.encrypt("sk-or-v1-abcdef1234")
	if err != nil || sealed == "" || strings.Contains(sealed, "abcdef") {
		t.Fatalf("%q %v", sealed, err)
	}
	plain, err := s.decrypt(sealed)
	if err != nil || plain != "sk-or-v1-abcdef1234" {
		t.Fatalf("%q %v", plain, err)
	}
	if hint("sk-or-v1-abcdef1234") != "…1234" {
		t.Fatal(hint("sk-or-v1-abcdef1234"))
	}
	other := New(nil, nil, nil)
	other.key[0] ^= 1
	if _, err := other.decrypt(sealed); err == nil {
		t.Fatal("a different server secret must not decrypt")
	}
}

func TestCodexConfiguredModelReadsTopLevelOnly(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CODEX_HOME", dir)
	if err := os.WriteFile(filepath.Join(dir, "config.toml"), []byte("model_reasoning_effort = \"high\"\nmodel = \"gpt-5.6-sol\"\n[profiles.x]\nmodel = \"other\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := codexConfiguredModel(); got != "gpt-5.6-sol" {
		t.Fatal(got)
	}
	if err := os.WriteFile(filepath.Join(dir, "models_cache.json"), []byte(`{"models":[{"slug":"a","display_name":"A","visibility":"list","input_modalities":["text","image"]},{"slug":"hidden","display_name":"H","visibility":"hide"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	list, err := codexCachedModels()
	if err != nil || len(list) != 1 || list[0].ID != "a" || !list[0].Vision || !list[0].Default {
		t.Fatalf("%+v %v", list, err)
	}
}

func TestLocateHonoursEnvOverrideAndRejectsMissing(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "claude")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\necho 1.0.0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CLAUDE_BIN", bin)
	tool := &Tool{Name: "claude", EnvVar: "CLAUDE_BIN"}
	if tool.Locate() != bin {
		t.Fatal("env override must win")
	}
	t.Setenv("CLAUDE_BIN", filepath.Join(dir, "missing"))
	if tool.Locate() != "" {
		t.Fatal("a missing override must not fall back to PATH")
	}
}

func TestCheckReportsLoginState(t *testing.T) {
	bin, _ := fakeCLI(t, "claude", `case "$1" in --version) echo "2.1.0 (Claude Code)";; auth) echo '{"loggedIn":true,"email":"a@b.c","subscriptionType":"max"}';; esac`)
	t.Setenv("CLAUDE_BIN", bin)
	tool := &Tool{Name: "claude", EnvVar: "CLAUDE_BIN"}
	status := tool.Check(context.Background(), 0)
	if !status.Found || !status.LoggedIn || status.Version != "2.1.0 (Claude Code)" || status.Account != "a@b.c · max" || status.Error != "" {
		t.Fatalf("%+v", status)
	}
	bin, _ = fakeCLI(t, "codex", `case "$1" in --version) echo "codex-cli 0.1";; login) echo "Not logged in" >&2; exit 1;; esac`)
	t.Setenv("CODEX_BIN", bin)
	tool = &Tool{Name: "codex", EnvVar: "CODEX_BIN"}
	status = tool.Check(context.Background(), 0)
	if !status.Found || status.LoggedIn || !strings.Contains(status.Error, "codex login") {
		t.Fatalf("%+v", status)
	}
	bin, _ = fakeCLI(t, "codex", `case "$1" in --version) echo "codex-cli 0.1";; login) echo "Logged in using ChatGPT" >&2;; esac`)
	t.Setenv("CODEX_BIN", bin)
	tool = &Tool{Name: "codex", EnvVar: "CODEX_BIN"}
	status = tool.Check(context.Background(), 0)
	if !status.LoggedIn || status.Account != "Logged in using ChatGPT" {
		t.Fatalf("stderr login report must count: %+v", status)
	}
}

func TestClaudeCompleteRunsNativeToolAttemptsTheCLIRejected(t *testing.T) {
	// The model called get_context as a native tool (rejected by the CLI with
	// "No such tool available"), then apologised in the structured output
	// without listing any toolCalls. The attempt is honoured instead.
	bin, _ := fakeCLI(t, "claude", `echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"get_context","input":{"arguments":"{}"}}]}}'
echo '{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","is_error":true,"content":"<tool_use_error>Error: No such tool available: get_context</tool_use_error>"}]}}'
echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_2","name":"get_task","input":{"taskId":"tsk_1"}}]}}'
echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_3","name":"StructuredOutput","input":{"content":"I could not reach your workspace","toolCalls":[]}}]}}'
echo '{"type":"result","subtype":"success","is_error":false,"result":"{\"content\":\"I could not reach your workspace\",\"toolCalls\":[]}","structured_output":{"content":"I could not reach your workspace","toolCalls":[]}}'`)
	specs := []any{
		map[string]any{"type": "function", "function": map[string]any{"name": "get_context"}},
		map[string]any{"type": "function", "function": map[string]any{"name": "get_task"}},
	}
	got, err := (&Claude{Bin: bin, Model: "sonnet"}).Complete(context.Background(), []chat.WireMessage{{Role: "user", Content: "hi"}}, specs, false)
	if err != nil {
		t.Fatal(err)
	}
	if got.Content != "" || len(got.ToolCalls) != 2 {
		t.Fatalf("native attempts must become tool calls: %+v", got)
	}
	if got.ToolCalls[0].Function.Name != "get_context" || got.ToolCalls[0].Function.Arguments != "{}" {
		t.Fatalf("protocol-shaped input must unwrap: %+v", got.ToolCalls[0])
	}
	if got.ToolCalls[1].Function.Name != "get_task" || got.ToolCalls[1].Function.Arguments != `{"taskId":"tsk_1"}` {
		t.Fatalf("plain input must pass through: %+v", got.ToolCalls[1])
	}

	// A structured answer that does list toolCalls wins over the attempts.
	bin, _ = fakeCLI(t, "claude", `echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"get_context","input":{"arguments":"{}"}}]}}'
echo '{"type":"result","subtype":"success","is_error":false,"result":"{}","structured_output":{"content":"","toolCalls":[{"name":"get_task","arguments":"{\"taskId\":\"tsk_2\"}"}]}}'`)
	got, err = (&Claude{Bin: bin, Model: "sonnet"}).Complete(context.Background(), []chat.WireMessage{{Role: "user", Content: "hi"}}, specs, false)
	if err != nil || len(got.ToolCalls) != 1 || got.ToolCalls[0].Function.Name != "get_task" {
		t.Fatalf("structured toolCalls must win: %+v %v", got, err)
	}

	// Native calls to tools Timely never offered (or the schema tool) are ignored.
	bin, _ = fakeCLI(t, "claude", `echo '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"ls"}}]}}'
echo '{"type":"result","subtype":"success","is_error":false,"result":"{}","structured_output":{"content":"Hello","toolCalls":[]}}'`)
	got, err = (&Claude{Bin: bin, Model: "sonnet"}).Complete(context.Background(), []chat.WireMessage{{Role: "user", Content: "hi"}}, specs, false)
	if err != nil || len(got.ToolCalls) != 0 || got.Content != "Hello" {
		t.Fatalf("unknown native tools must not be run: %+v %v", got, err)
	}
}
