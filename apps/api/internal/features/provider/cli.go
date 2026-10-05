package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"timely-api/internal/features/chat"
)

// A CLI provider is driven as a pure model: it receives the whole transcript
// and the tool catalogue in one prompt and must answer with this JSON shape.
// Tool arguments are a JSON-encoded string because strict output schemas do
// not allow free-form objects.
const responseSchema = `{"type":"object","properties":{"content":{"type":"string"},"toolCalls":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"arguments":{"type":"string"}},"required":["name","arguments"],"additionalProperties":false}}},"required":["content","toolCalls"],"additionalProperties":false}`

const protocol = `

## Response protocol
You are running inside Timely as a model, not as a coding agent. You have no shell, file, or code tools; the only actions available are the Timely tools listed below, which Timely executes for you.
Respond with a single JSON object: {"content": string, "toolCalls": [{"name": string, "arguments": string}]}.
- To call tools, put them in toolCalls with "arguments" as a JSON-encoded object string and leave "content" empty. Timely runs them and sends the results back in the next turn.
- The Timely tools are not installed as native tools: calling one directly fails with "No such tool available". That failure means nothing about Timely; request the same tool through toolCalls instead and never tell the person a tool is unavailable.
- To answer the person, put the reply in "content" and leave toolCalls empty.
- Call propose_changes alone, after all read tools have finished.
- Never output anything except the JSON object.`

const callTimeout = 4 * time.Minute

type cliResponse struct {
	Content   string `json:"content"`
	ToolCalls []struct {
		Name      string  `json:"name"`
		Arguments cliArgs `json:"arguments"`
	} `json:"toolCalls"`
}

// cliArgs is the JSON-encoded arguments string the protocol asks for. A nested
// protocol object (see nestedResponse) isn't held to the response schema, so
// it may carry the arguments as a plain object; that is kept as raw JSON.
type cliArgs string

func (a *cliArgs) UnmarshalJSON(b []byte) error {
	var s string
	if json.Unmarshal(b, &s) == nil {
		*a = cliArgs(s)
		return nil
	}
	*a = cliArgs(b)
	return nil
}

func stripFence(text string) string {
	text = strings.TrimSpace(text)
	text = strings.TrimPrefix(text, "```json")
	text = strings.TrimPrefix(text, "```")
	text = strings.TrimSuffix(text, "```")
	return strings.TrimSpace(text)
}

// parseResponse turns the protocol JSON into the runner's wire shape.
func parseResponse(text string) (chat.WireMessage, error) {
	var parsed cliResponse
	if err := json.Unmarshal([]byte(stripFence(text)), &parsed); err != nil {
		return chat.WireMessage{}, fmt.Errorf("The AI provider returned an unreadable answer; try again")
	}
	// Models sometimes put the whole protocol object, JSON-encoded, in
	// "content" and leave toolCalls empty; shown as-is, the person sees raw JSON
	// instead of the proposal.
	for len(parsed.ToolCalls) == 0 {
		inner, ok := nestedResponse(parsed.Content)
		if !ok {
			break
		}
		parsed = inner
	}
	out := chat.WireMessage{Role: "assistant", Content: parsed.Content}
	for i, call := range parsed.ToolCalls {
		if strings.TrimSpace(call.Name) == "" {
			continue
		}
		args := strings.TrimSpace(string(call.Arguments))
		if args == "" {
			args = "{}"
		}
		var tc chat.ToolCall
		tc.ID = fmt.Sprintf("call_%d", i+1)
		tc.Type = "function"
		tc.Function.Name = call.Name
		tc.Function.Arguments = args
		out.ToolCalls = append(out.ToolCalls, tc)
	}
	return out, nil
}

// nestedResponse reports whether content is itself a protocol object: exactly
// the "content" and "toolCalls" keys. A reply that merely contains JSON the
// person asked for doesn't have that shape and is left alone.
func nestedResponse(content string) (cliResponse, bool) {
	content = stripFence(content)
	if !strings.HasPrefix(content, "{") {
		return cliResponse{}, false
	}
	var keys map[string]json.RawMessage
	if json.Unmarshal([]byte(content), &keys) != nil || len(keys) != 2 || keys["content"] == nil || keys["toolCalls"] == nil {
		return cliResponse{}, false
	}
	var inner cliResponse
	if json.Unmarshal([]byte(content), &inner) != nil {
		return cliResponse{}, false
	}
	return inner, true
}

// render splits the wire transcript into the system prompt and the user-facing
// transcript. Tool specs go into the system prompt so every turn sees the same
// catalogue; images are returned separately for provider-specific attachment.
// Calls without tools (image extraction, receipt edits, search answers) expect
// the model's raw text, so they skip the tool-call protocol entirely.
func render(messages []chat.WireMessage, tools []any, search bool) (system, transcript string, images []string) {
	var sys strings.Builder
	var body strings.Builder
	for _, m := range messages {
		switch m.Role {
		case "system":
			sys.WriteString(m.Content)
			sys.WriteString("\n")
		case "assistant":
			body.WriteString("[assistant]\n")
			if len(m.ToolCalls) > 0 {
				calls := make([]map[string]string, 0, len(m.ToolCalls))
				for _, call := range m.ToolCalls {
					calls = append(calls, map[string]string{"id": call.ID, "name": call.Function.Name, "arguments": call.Function.Arguments})
				}
				encoded, _ := json.Marshal(calls)
				body.WriteString("Tool calls: ")
				body.Write(encoded)
				body.WriteString("\n")
			}
			if strings.TrimSpace(m.Content) != "" {
				body.WriteString(m.Content)
				body.WriteString("\n")
			}
		case "tool":
			body.WriteString("[tool result ")
			body.WriteString(m.ToolCallID)
			body.WriteString("]\n")
			body.WriteString(m.Content)
			body.WriteString("\n")
		default:
			body.WriteString("[user]\n")
			body.WriteString(m.Content)
			body.WriteString("\n")
			images = append(images, m.ImageURLs...)
		}
		body.WriteString("\n")
	}
	if len(tools) > 0 {
		encoded, _ := json.Marshal(tools)
		sys.WriteString("\nTimely tools available to call (OpenAI function schemas):\n")
		sys.Write(encoded)
		sys.WriteString("\n")
		sys.WriteString(protocol)
		if search {
			sys.WriteString("\nWeb search is enabled for this request: use your web search tool when it helps and include source links in content.")
		}
		body.WriteString("Respond now with the JSON object.")
	} else {
		sys.WriteString("\nYou are running inside Timely as a model with no shell, file, or code tools. Reply with exactly what the instructions above ask for and nothing else.")
		if search {
			sys.WriteString("\nWeb search is enabled: use your web search tool and include source links in the answer.")
		}
		body.WriteString("Respond now.")
	}
	return sys.String(), body.String(), images
}

// Tool locates one CLI and caches its version and login state briefly so the
// settings screen can poll without spawning processes on every request.
type Tool struct {
	Name   string   // "claude" or "codex"
	EnvVar string   // explicit path override, e.g. CLAUDE_BIN
	Extra  []string // extra directories searched after PATH

	mu       sync.Mutex
	checked  time.Time
	snapshot Status
}

type Status struct {
	Found     bool   `json:"found"`
	Path      string `json:"path,omitempty"`
	Version   string `json:"version,omitempty"`
	LoggedIn  bool   `json:"loggedIn"`
	Account   string `json:"account,omitempty"`
	Error     string `json:"error,omitempty"`
	CheckedAt string `json:"checkedAt,omitempty"`
}

var home, _ = os.UserHomeDir()

// candidates lists the install directories searched after PATH, per OS.
// The UI never adds to this list (ADR 0009); CLAUDE_BIN / CODEX_BIN cover
// unusual locations.
func (t *Tool) candidates() []string {
	var dirs []string
	switch runtime.GOOS {
	case "windows":
		profile := os.Getenv("USERPROFILE")
		if profile == "" {
			profile = home
		}
		for _, dir := range []string{
			filepath.Join(os.Getenv("APPDATA"), "npm"),
			filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "claude"),
			filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "codex"),
			filepath.Join(profile, ".claude", "local"),
			filepath.Join(profile, ".local", "bin"),
			filepath.Join(os.Getenv("ProgramFiles"), "nodejs"),
		} {
			if !strings.HasPrefix(dir, string(filepath.Separator)) && filepath.VolumeName(dir) != "" {
				dirs = append(dirs, dir)
			}
		}
	case "darwin":
		dirs = []string{
			"/opt/homebrew/bin", "/usr/local/bin",
			filepath.Join(home, ".claude", "local"),
			filepath.Join(home, ".codex", "bin"),
			filepath.Join(home, "Library", "pnpm"),
			filepath.Join(home, ".npm-global", "bin"),
			filepath.Join(home, ".volta", "bin"),
			filepath.Join(home, ".bun", "bin"),
			filepath.Join(home, ".local", "bin"),
		}
		if matches, _ := filepath.Glob(filepath.Join(home, ".nvm", "versions", "node", "*", "bin")); len(matches) > 0 {
			dirs = append(dirs, matches...)
		}
	default:
		dirs = []string{
			filepath.Join(home, ".local", "bin"),
			filepath.Join(home, ".claude", "local"),
			filepath.Join(home, ".codex", "bin"),
			filepath.Join(home, ".npm-global", "bin"),
			filepath.Join(home, ".local", "share", "pnpm"),
			filepath.Join(home, ".volta", "bin"),
			filepath.Join(home, ".bun", "bin"),
			"/usr/local/bin", "/opt/homebrew/bin", "/usr/bin",
		}
		if matches, _ := filepath.Glob(filepath.Join(home, ".nvm", "versions", "node", "*", "bin")); len(matches) > 0 {
			dirs = append(dirs, matches...)
		}
	}
	return append(dirs, t.Extra...)
}

// binaryNames are the file names tried in each candidate directory. npm on
// Windows installs CLIs as .cmd shims next to an extensionless script.
func (t *Tool) binaryNames() []string {
	if runtime.GOOS == "windows" {
		return []string{t.Name + ".exe", t.Name + ".cmd", t.Name + ".bat"}
	}
	return []string{t.Name}
}

func executable(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return runtime.GOOS == "windows" || info.Mode()&0o111 != 0
}

// Locate honours the env override first, then PATH, then common install
// directories. The UI never supplies a path (see ADR 0009).
func (t *Tool) Locate() string {
	if override := strings.TrimSpace(os.Getenv(t.EnvVar)); override != "" {
		if info, err := os.Stat(override); err == nil && !info.IsDir() {
			return override
		}
		return ""
	}
	if path, err := exec.LookPath(t.Name); err == nil {
		return path
	}
	for _, dir := range t.candidates() {
		for _, name := range t.binaryNames() {
			if path := filepath.Join(dir, name); executable(path) {
				return path
			}
		}
	}
	return ""
}

// Check refreshes the cached status when older than maxAge.
func (t *Tool) Check(ctx context.Context, maxAge time.Duration) Status {
	t.mu.Lock()
	defer t.mu.Unlock()
	if time.Since(t.checked) < maxAge && t.snapshot.CheckedAt != "" {
		return t.snapshot
	}
	status := Status{CheckedAt: time.Now().UTC().Format(time.RFC3339)}
	path := t.Locate()
	if path == "" {
		status.Error = "Not found on the server. Install the CLI for the user that runs the Timely API, or set " + t.EnvVar + " in the server .env"
		t.checked, t.snapshot = time.Now(), status
		return status
	}
	status.Found, status.Path = true, path
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if out, err := run(ctx, path, nil, "", "--version"); err == nil {
		status.Version = firstLine(out)
	} else {
		status.Error = "Could not run " + t.Name + ": " + err.Error()
	}
	if t.Name == "claude" {
		out, err := run(ctx, path, nil, "", "auth", "status", "--json")
		var auth struct {
			LoggedIn         bool   `json:"loggedIn"`
			Email            string `json:"email"`
			SubscriptionType string `json:"subscriptionType"`
			AuthMethod       string `json:"authMethod"`
		}
		if err == nil && json.Unmarshal([]byte(out), &auth) == nil {
			status.LoggedIn = auth.LoggedIn
			status.Account = strings.TrimSpace(strings.Join([]string{auth.Email, auth.SubscriptionType}, " · "))
			status.Account = strings.Trim(status.Account, " ·")
		}
		if !status.LoggedIn {
			status.Error = "Not signed in. Run `claude auth login` in a terminal on the server, then Connect again"
		}
	} else {
		// Codex prints its login state on stderr; run folds stderr into the
		// error only on failure, so read both streams here.
		out, err := runCombined(ctx, path, "login", "status")
		status.LoggedIn = err == nil && strings.Contains(strings.ToLower(out), "logged in") && !strings.Contains(strings.ToLower(out), "not logged in")
		if status.LoggedIn {
			status.Account = strings.TrimSpace(firstLine(out))
		} else {
			status.Error = "Not signed in. Run `codex login` in a terminal on the server, then Connect again"
		}
	}
	t.checked, t.snapshot = time.Now(), status
	return status
}

func (t *Tool) Invalidate() {
	t.mu.Lock()
	t.checked = time.Time{}
	t.mu.Unlock()
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}

// run executes a CLI with stdin and returns stdout; stderr is folded into the
// error. The child never inherits the API's working directory.
func run(ctx context.Context, bin string, env []string, stdin string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Dir = scratchDir()
	cmd.Env = append(os.Environ(), env...)
	cmd.Stdin = strings.NewReader(stdin)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	if err != nil {
		if ctx.Err() != nil {
			return stdout.String(), ctx.Err()
		}
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = strings.TrimSpace(stdout.String())
		}
		if len(msg) > 600 {
			msg = msg[len(msg)-600:]
		}
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return stdout.String(), fmt.Errorf("%s (exit %d)", msg, exit.ExitCode())
		}
		return stdout.String(), fmt.Errorf("%s: %v", msg, err)
	}
	return stdout.String(), nil
}

// runCombined returns stdout and stderr together for CLIs that report on stderr.
func runCombined(ctx context.Context, bin string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Dir = scratchDir()
	out, err := cmd.CombinedOutput()
	return string(out), err
}

var scratch struct {
	sync.Once
	dir string
}

// scratchDir is an empty directory the CLIs run in, so the file tools that
// cannot be disabled (Codex) see nothing of the server.
func scratchDir() string {
	scratch.Do(func() {
		dir := filepath.Join(os.TempDir(), "timely-agent-cli")
		_ = os.MkdirAll(dir, 0o700)
		scratch.dir = dir
	})
	return scratch.dir
}

// friendly maps common CLI failures to guidance that names the fix.
func friendly(tool, raw string) error {
	lower := strings.ToLower(raw)
	has := func(needles ...string) bool {
		for _, n := range needles {
			if strings.Contains(lower, n) {
				return true
			}
		}
		return false
	}
	switch {
	case has("not logged in", "please run /login", "not authenticated", "invalid api key", "unauthorized", "401"):
		return fmt.Errorf("%s is not signed in on the server. Run the login command in a terminal, then reconnect it in Settings → Agent", tool)
	case has("rate limit", "usage limit", "limit reached", "429", "quota", "overloaded"):
		return fmt.Errorf("%s has hit its usage limit. Wait for it to reset or pick another provider in Settings → Agent", tool)
	case strings.Contains(lower, "model") && has("not found", "invalid", "not available", "does not exist", "not supported", "unknown", "404", "no access"):
		return fmt.Errorf("%s rejected the selected model: %s. Choose another model in Settings → Agent", tool, firstLine(raw))
	}
	return fmt.Errorf("%s failed: %s", tool, firstLine(raw))
}
