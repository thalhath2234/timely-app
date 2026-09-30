package provider

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"timely-api/internal/features/chat"
)

// Codex drives the Codex CLI non-interactively: shell and image-viewing tools
// off, read-only sandbox in an empty scratch directory, ephemeral session, and
// a strict output schema. The person's own `codex login` is used.
type Codex struct {
	Bin   string
	Model string
}

func (p *Codex) Complete(ctx context.Context, messages []chat.WireMessage, tools []any, search bool) (chat.WireMessage, error) {
	system, transcript, images := render(messages, tools, search)
	ctx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()

	work, err := os.MkdirTemp(scratchDir(), "codex-")
	if err != nil {
		return chat.WireMessage{}, err
	}
	defer os.RemoveAll(work)
	schemaPath := filepath.Join(work, "schema.json")
	if err := os.WriteFile(schemaPath, []byte(responseSchema), 0o600); err != nil {
		return chat.WireMessage{}, err
	}
	webSearch := "disabled"
	if search {
		webSearch = "live"
	}
	args := []string{"exec", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "-C", work, "-m", p.Model,
		"--disable", "shell_tool", "--disable", "view_image", "-c", "web_search=" + tomlString(webSearch), "--json"}
	structured := len(tools) > 0
	if structured {
		args = append(args, "--output-schema", schemaPath)
	}
	for i, url := range images {
		_, data, ok := splitDataURL(url)
		if !ok {
			continue
		}
		raw, err := base64.StdEncoding.DecodeString(data)
		if err != nil {
			continue
		}
		path := filepath.Join(work, fmt.Sprintf("image-%d", i+1))
		if err := os.WriteFile(path, raw, 0o600); err != nil {
			return chat.WireMessage{}, err
		}
		args = append(args, "-i", path)
	}
	// The prompt arrives on stdin so long transcripts never hit argv limits.
	prompt := system + "\n\n## Conversation\n\n" + transcript
	cmd := exec.CommandContext(ctx, p.Bin, args...)
	cmd.Dir = work
	cmd.Env = os.Environ()
	cmd.Stdin = strings.NewReader(prompt)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	runErr := cmd.Run()
	if ctx.Err() != nil {
		return chat.WireMessage{}, fmt.Errorf("Codex took too long to respond. Please try again; completed changes are saved")
	}

	var last string
	var failure string
	scanner := bufio.NewScanner(&stdout)
	scanner.Buffer(make([]byte, 0, 1<<20), 32<<20)
	for scanner.Scan() {
		var event struct {
			Type  string `json:"type"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
			Message string `json:"message"`
			Item    struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"item"`
		}
		if json.Unmarshal(scanner.Bytes(), &event) != nil {
			continue
		}
		switch event.Type {
		case "item.completed":
			if event.Item.Type == "agent_message" {
				last = event.Item.Text
			}
		case "turn.failed":
			if event.Error != nil {
				failure = event.Error.Message
			}
		case "error":
			if failure == "" {
				failure = event.Message
			}
		}
	}
	if strings.TrimSpace(last) == "" {
		msg := failure
		if msg == "" {
			msg = strings.TrimSpace(stderr.String())
		}
		if msg == "" && runErr != nil {
			msg = runErr.Error()
		}
		if msg == "" {
			msg = "no answer was produced"
		}
		return chat.WireMessage{}, friendly("Codex", msg)
	}
	if !structured {
		return chat.WireMessage{Role: "assistant", Content: last}, nil
	}
	return parseResponse(last)
}

// tomlString quotes a TOML string for a -c override.
func tomlString(value string) string { return `"` + value + `"` }
