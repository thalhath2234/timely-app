package provider

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"timely-api/internal/features/chat"
)

// Claude drives the Claude Code CLI headlessly with every built-in tool off,
// no settings, hooks or MCP servers, and structured JSON output. The person's
// own `claude` login (subscription) is used; nothing is stored by Timely.
type Claude struct {
	Bin   string
	Model string
}

func (p *Claude) Complete(ctx context.Context, messages []chat.WireMessage, tools []any, search bool) (chat.WireMessage, error) {
	system, transcript, images := render(messages, tools, search)
	ctx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()

	// Images and text travel as one stream-json user message; the CLI exits
	// once stdin closes and the final "result" event carries the answer.
	content := []any{map[string]any{"type": "text", "text": transcript}}
	for _, url := range images {
		mediaType, data, ok := splitDataURL(url)
		if !ok {
			continue
		}
		content = append(content, map[string]any{"type": "image", "source": map[string]any{"type": "base64", "media_type": mediaType, "data": data}})
	}
	input, _ := json.Marshal(map[string]any{"type": "user", "message": map[string]any{"role": "user", "content": content}})

	args := []string{"-p", "--model", p.Model, "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence", "--disable-slash-commands",
		"--system-prompt", system, "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"}
	structured := len(tools) > 0
	if structured {
		args = append(args, "--json-schema", responseSchema)
	}
	if search {
		args = append(args, "--tools", "WebSearch", "--allowedTools", "WebSearch")
	} else {
		args = append(args, "--tools", "")
	}
	cmd := exec.CommandContext(ctx, p.Bin, args...)
	cmd.Dir = scratchDir()
	cmd.Env = append(os.Environ(), "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1")
	cmd.Stdin = bytes.NewReader(append(input, '\n'))
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	runErr := cmd.Run()
	if ctx.Err() != nil {
		return chat.WireMessage{}, fmt.Errorf("Claude took too long to respond. Please try again; completed changes are saved")
	}

	var result struct {
		Type             string          `json:"type"`
		Subtype          string          `json:"subtype"`
		IsError          bool            `json:"is_error"`
		Result           string          `json:"result"`
		StructuredOutput json.RawMessage `json:"structured_output"`
	}
	found := false
	scanner := bufio.NewScanner(&stdout)
	scanner.Buffer(make([]byte, 0, 1<<20), 32<<20)
	for scanner.Scan() {
		line := scanner.Bytes()
		if !bytes.Contains(line, []byte(`"type":"result"`)) {
			continue
		}
		if json.Unmarshal(line, &result) == nil && result.Type == "result" {
			found = true
		}
	}
	if !found {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" && runErr != nil {
			msg = runErr.Error()
		}
		if msg == "" {
			msg = strings.TrimSpace(stdout.String())
		}
		return chat.WireMessage{}, friendly("Claude", msg)
	}
	if result.IsError || (result.Subtype != "success" && result.Subtype != "") {
		msg := strings.TrimSpace(result.Result)
		if msg == "" {
			msg = result.Subtype
		}
		return chat.WireMessage{}, friendly("Claude", msg)
	}
	if !structured {
		return chat.WireMessage{Role: "assistant", Content: result.Result}, nil
	}
	if len(result.StructuredOutput) > 0 && string(result.StructuredOutput) != "null" {
		return parseResponse(string(result.StructuredOutput))
	}
	return parseResponse(result.Result)
}

func splitDataURL(url string) (mediaType, data string, ok bool) {
	if !strings.HasPrefix(url, "data:") {
		return "", "", false
	}
	comma := strings.IndexByte(url, ',')
	if comma < 0 {
		return "", "", false
	}
	meta := url[len("data:"):comma]
	if !strings.HasSuffix(meta, ";base64") {
		return "", "", false
	}
	return strings.TrimSuffix(meta, ";base64"), url[comma+1:], true
}
