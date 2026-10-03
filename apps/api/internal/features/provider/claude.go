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

	stream := readStream(&stdout, toolNames(tools))
	if !stream.found {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" && runErr != nil {
			msg = runErr.Error()
		}
		if msg == "" {
			msg = strings.TrimSpace(stdout.String())
		}
		return chat.WireMessage{}, friendly("Claude", msg)
	}
	result := stream.result
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
	var parsed chat.WireMessage
	var err error
	if len(result.StructuredOutput) > 0 && string(result.StructuredOutput) != "null" {
		parsed, err = parseResponse(string(result.StructuredOutput))
	} else {
		parsed, err = parseResponse(result.Result)
	}
	if err != nil {
		return parsed, err
	}
	if len(parsed.ToolCalls) == 0 && len(stream.attempts) > 0 {
		// The model asked for Timely tools as native tool calls, which the CLI
		// rejects, and then gave up instead of using toolCalls. Run what it
		// asked for; the next turn carries the results it wanted.
		return chat.WireMessage{Role: "assistant", ToolCalls: stream.attempts}, nil
	}
	return parsed, nil
}

// claudeStream is what Complete needs from the CLI's stream-json output: the
// final result event and any native tool_use blocks that named a Timely tool.
type claudeStream struct {
	found    bool
	result   claudeResult
	attempts []chat.ToolCall
}

type claudeResult struct {
	Type             string          `json:"type"`
	Subtype          string          `json:"subtype"`
	IsError          bool            `json:"is_error"`
	Result           string          `json:"result"`
	StructuredOutput json.RawMessage `json:"structured_output"`
}

// readStream scans the stream-json lines. Even with every built-in tool off,
// the model sometimes calls a Timely tool directly instead of listing it in
// toolCalls; the CLI answers "No such tool available" and the model may then
// tell the person the tool is unavailable. Those attempts are collected so
// Complete can honour them. Both argument shapes are accepted: the protocol's
// {"arguments": "<json>"} and the plain argument object.
func readStream(stdout *bytes.Buffer, known map[string]bool) claudeStream {
	var out claudeStream
	seen := map[string]bool{}
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 1<<20), 32<<20)
	for scanner.Scan() {
		line := scanner.Bytes()
		if bytes.Contains(line, []byte(`"type":"result"`)) {
			var result claudeResult
			if json.Unmarshal(line, &result) == nil && result.Type == "result" {
				out.found, out.result = true, result
			}
			continue
		}
		if !bytes.Contains(line, []byte(`"tool_use"`)) {
			continue
		}
		var event struct {
			Type    string `json:"type"`
			Message struct {
				Content []struct {
					Type  string          `json:"type"`
					Name  string          `json:"name"`
					Input json.RawMessage `json:"input"`
				} `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal(line, &event) != nil || event.Type != "assistant" {
			continue
		}
		for _, block := range event.Message.Content {
			if block.Type != "tool_use" || !known[block.Name] {
				continue
			}
			args := nativeArguments(block.Input)
			if seen[block.Name+args] {
				continue
			}
			seen[block.Name+args] = true
			var tc chat.ToolCall
			tc.ID = fmt.Sprintf("call_%d", len(out.attempts)+1)
			tc.Type = "function"
			tc.Function.Name = block.Name
			tc.Function.Arguments = args
			out.attempts = append(out.attempts, tc)
		}
	}
	return out
}

func nativeArguments(input json.RawMessage) string {
	var wrapped struct {
		Arguments *string `json:"arguments"`
	}
	if json.Unmarshal(input, &wrapped) == nil && wrapped.Arguments != nil {
		var probe map[string]any
		if json.Unmarshal(input, &probe) == nil && len(probe) == 1 {
			if args := strings.TrimSpace(*wrapped.Arguments); args != "" && json.Valid([]byte(args)) {
				return args
			}
			return "{}"
		}
	}
	if len(input) > 0 && json.Valid(input) && bytes.HasPrefix(bytes.TrimSpace(input), []byte("{")) {
		return string(input)
	}
	return "{}"
}

// toolNames lists the function names in the OpenAI-style specs the runner sends.
func toolNames(tools []any) map[string]bool {
	names := map[string]bool{}
	for _, t := range tools {
		spec, _ := t.(map[string]any)
		fn, _ := spec["function"].(map[string]any)
		if name, _ := fn["name"].(string); name != "" {
			names[name] = true
		}
	}
	return names
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
