package provider

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"timely-api/internal/features/chat"
)

// gatewayFake records what the gateway hands the Completer and answers with
// reply.
type gatewayFake struct {
	messages []chat.WireMessage
	tools    []any
	reply    chat.WireMessage
	err      error
}

func (f *gatewayFake) Complete(_ context.Context, m []chat.WireMessage, tools []any, _ bool) (chat.WireMessage, error) {
	f.messages, f.tools = m, tools
	return f.reply, f.err
}

func startTestGateway(t *testing.T, fake *gatewayFake) (*Gateway, string) {
	t.Helper()
	g, err := newGateway(func(_ context.Context, uid, provider, model string) (chat.Completer, error) {
		if uid != "user-a" || provider != ClaudeCLI || model != "sonnet" {
			return nil, errors.New("wrong grant")
		}
		return fake, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = g.Close(context.Background()) })
	if !strings.HasPrefix(g.BaseURL(), "http://127.0.0.1:") {
		t.Fatalf("gateway listens on %s, not loopback", g.BaseURL())
	}
	return g, g.grant("user-a", ClaudeCLI, "sonnet")
}

func gatewayPost(t *testing.T, g *Gateway, key, body string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest("POST", g.BaseURL()+"/chat/completions", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

const gatewayRequest = `{"model":"sonnet","messages":[
 {"role":"system","content":"You are Timely."},
 {"role":"user","content":[{"type":"text","text":"Add Buy milk"}]},
 {"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"list_tasks","arguments":"{}"}}]},
 {"role":"tool","tool_call_id":"call_1","content":"{\"tasks\":[]}"}],
 "tools":[{"type":"function","function":{"name":"propose_changes","description":"d","parameters":{"type":"object"}}}]%s}`

// A tool call comes back in OpenAI's shape, and the Completer gets the
// conversation and tools as the classic engine passes them.
func TestGatewayRelaysAToolCall(t *testing.T) {
	fake := &gatewayFake{}
	fake.reply.Role = "assistant"
	fake.reply.ToolCalls = []chat.ToolCall{{ID: "call_2"}}
	fake.reply.ToolCalls[0].Function.Name, fake.reply.ToolCalls[0].Function.Arguments = "propose_changes", `{"summary":"Add"}`
	g, key := startTestGateway(t, fake)
	resp := gatewayPost(t, g, key, strings.Replace(gatewayRequest, "%s", "", 1))
	var out struct {
		Choices []struct {
			Message struct {
				ToolCalls []chat.ToolCall `json:"tool_calls"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || resp.StatusCode != 200 {
		t.Fatalf("%d %v", resp.StatusCode, err)
	}
	if len(out.Choices) != 1 || out.Choices[0].FinishReason != "tool_calls" || out.Choices[0].Message.ToolCalls[0].Function.Name != "propose_changes" ||
		out.Choices[0].Message.ToolCalls[0].Function.Arguments != `{"summary":"Add"}` {
		t.Fatalf("response %+v", out)
	}
	m := fake.messages
	if len(m) != 4 || m[0].Role != "system" || m[1].Content != "Add Buy milk" || m[2].ToolCalls[0].Function.Name != "list_tasks" || m[3].ToolCallID != "call_1" {
		t.Fatalf("completer messages %+v", m)
	}
	if len(fake.tools) != 1 {
		t.Fatalf("completer tools %v", fake.tools)
	}
}

// stream=true gets server-sent events: the text, then [DONE].
func TestGatewayStreamsTheAnswer(t *testing.T) {
	fake := &gatewayFake{reply: chat.WireMessage{Role: "assistant", Content: "Done."}}
	g, key := startTestGateway(t, fake)
	resp := gatewayPost(t, g, key, strings.Replace(gatewayRequest, "%s", `,"stream":true`, 1))
	if resp.StatusCode != 200 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("%d %s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	var text, finish string
	done := false
	sc := bufio.NewScanner(resp.Body)
	for sc.Scan() {
		data, ok := strings.CutPrefix(sc.Text(), "data: ")
		if !ok {
			continue
		}
		if data == "[DONE]" {
			done = true
			break
		}
		var ev struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			t.Fatal(err)
		}
		text += ev.Choices[0].Delta.Content
		if ev.Choices[0].FinishReason != nil {
			finish = *ev.Choices[0].FinishReason
		}
	}
	if text != "Done." || finish != "stop" || !done {
		t.Fatalf("stream text %q finish %q done %v", text, finish, done)
	}
}

// Without the account's secret, or for another model, nothing runs.
func TestGatewayRefusesOtherCallers(t *testing.T) {
	fake := &gatewayFake{reply: chat.WireMessage{Role: "assistant", Content: "x"}}
	g, key := startTestGateway(t, fake)
	if resp := gatewayPost(t, g, "tgw-wrong", strings.Replace(gatewayRequest, "%s", "", 1)); resp.StatusCode != 401 {
		t.Fatalf("wrong key: %d", resp.StatusCode)
	}
	if resp := gatewayPost(t, g, key, strings.Replace(strings.Replace(gatewayRequest, "%s", "", 1), `"sonnet"`, `"opus"`, 1)); resp.StatusCode != 400 {
		t.Fatalf("another model: %d", resp.StatusCode)
	}
	if fake.messages != nil {
		t.Fatal("a refused call reached the CLI")
	}
	if again := g.grant("user-a", ClaudeCLI, "sonnet"); again != key {
		t.Fatal("the same account and model got a second secret")
	}
	if other := g.grant("user-b", ClaudeCLI, "sonnet"); other == key {
		t.Fatal("two accounts share a secret")
	}
	req, _ := http.NewRequest("GET", g.BaseURL()+"/models", nil)
	req.Header.Set("Authorization", "Bearer "+key)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var list struct {
		Data []struct {
			ID            string `json:"id"`
			ContextLength int    `json:"context_length"`
		} `json:"data"`
	}
	if json.NewDecoder(resp.Body).Decode(&list) != nil || len(list.Data) != 1 || list.Data[0].ID != "sonnet" || list.Data[0].ContextLength == 0 {
		t.Fatalf("models %+v", list)
	}
}
