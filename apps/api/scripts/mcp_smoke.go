//go:build ignore

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"os"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type roundTripper struct {
	base  http.RoundTripper
	token string
}

func (r roundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	req = req.Clone(req.Context())
	req.Header.Set("Authorization", "Bearer "+r.token)
	base := r.base
	if base == nil {
		base = http.DefaultTransport
	}
	return base.RoundTrip(req)
}

func main() {
	ctx := context.Background()
	email := getenv("TIMELY_EMAIL", "thalhathva2@gmail.com")
	password := getenv("TIMELY_PASSWORD", "12341234")
	base := getenv("TIMELY_API", "http://localhost:8080")

	jar, err := cookiejar.New(nil)
	if err != nil {
		fatal(err)
	}
	httpClient := &http.Client{Jar: jar, Timeout: 20 * time.Second}

	loginBody, _ := json.Marshal(map[string]string{"email": email, "password": password})
	resp, err := httpClient.Post(base+"/login", "application/json", bytes.NewReader(loginBody))
	if err != nil {
		fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode >= 300 {
		fatal(fmt.Errorf("login %d: %s", resp.StatusCode, body))
	}

	keyReq, _ := json.Marshal(map[string]string{"name": "mcp-smoke"})
	resp, err = httpClient.Post(base+"/api-keys", "application/json", bytes.NewReader(keyReq))
	if err != nil {
		fatal(err)
	}
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode >= 300 {
		fatal(fmt.Errorf("create key %d: %s", resp.StatusCode, body))
	}
	var created struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal(body, &created); err != nil || created.Key == "" {
		fatal(fmt.Errorf("no key in response: %s", body))
	}
	fmt.Println("created API key prefix", created.Key[:7])

	client := mcp.NewClient(&mcp.Implementation{Name: "timely-smoke", Version: "1.0.0"}, nil)
	transport := &mcp.StreamableClientTransport{
		Endpoint: base + "/mcp",
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
			Transport: roundTripper{token: created.Key},
		},
		DisableStandaloneSSE: true,
	}
	session, err := client.Connect(ctx, transport, nil)
	if err != nil {
		fatal(err)
	}
	defer session.Close()

	call := func(name string, args any) json.RawMessage {
		res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
		if err != nil {
			fatal(fmt.Errorf("%s: %w", name, err))
		}
		if res.IsError {
			fatal(fmt.Errorf("%s error: %+v", name, res.Content))
		}
		fmt.Println("ok", name)
		raw, _ := json.Marshal(res.StructuredContent)
		return raw
	}

	ctxRaw := call("get_context", map[string]any{})
	var ctxOut struct {
		Workspaces []struct {
			ID string `json:"id"`
		} `json:"workspaces"`
	}
	_ = json.Unmarshal(ctxRaw, &ctxOut)
	if len(ctxOut.Workspaces) == 0 {
		createdWS := call("create_workspace", map[string]any{"name": "Personal"})
		var wsWrap struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(createdWS, &wsWrap); err != nil || wsWrap.ID == "" {
			fatal(fmt.Errorf("create_workspace missing id: %s", createdWS))
		}
		ctxOut.Workspaces = append(ctxOut.Workspaces, struct {
			ID string `json:"id"`
		}{ID: wsWrap.ID})
	}
	ws := ctxOut.Workspaces[0].ID

	createdTask := call("create_task", map[string]any{
		"name":        "MCP smoke task",
		"workspaceId": ws,
		"description": "Created by smoke test",
	})
	var taskWrap struct {
		Task struct {
			ID string `json:"id"`
		} `json:"task"`
	}
	if err := json.Unmarshal(createdTask, &taskWrap); err != nil || taskWrap.Task.ID == "" {
		fatal(fmt.Errorf("create_task missing id: %s", createdTask))
	}
	taskID := taskWrap.Task.ID

	call("list_tasks", map[string]any{"text": "MCP smoke"})
	start := time.Now().Add(2 * time.Hour).Truncate(time.Minute).UTC().Format(time.RFC3339)
	call("schedule_task", map[string]any{
		"taskId":          taskID,
		"start":           start,
		"durationMinutes": 30,
		"replace":         true,
	})
	call("create_doc", map[string]any{
		"title":       "MCP smoke doc",
		"workspaceId": ws,
		"markdown":    "# Smoke\n\nHello from Hermes MCP.",
	})
	call("get_agenda", map[string]any{})
	call("delete_task", map[string]any{"taskId": taskID})
	fmt.Println("smoke passed")
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
