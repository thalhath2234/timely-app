package agent

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// An outside app can describe what a Bot watches, never how it alerts or
// whether it runs (ADR 0021), so those fields are not in the input schemas.
func TestBotToolSchemasLeaveOutAlertSettings(t *testing.T) {
	ctx := context.Background()
	server, clientSide := mcp.NewInMemoryTransports()
	session, err := New(Deps{}).Connect(ctx, server, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	client, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil).Connect(ctx, clientSide, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	listed, err := client.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	schemas := map[string]map[string]any{}
	for _, tool := range listed.Tools {
		raw, err := json.Marshal(tool.InputSchema)
		if err != nil {
			t.Fatal(err)
		}
		var schema map[string]any
		if err := json.Unmarshal(raw, &schema); err != nil {
			t.Fatal(err)
		}
		schemas[tool.Name] = schema
	}
	forbidden := []string{"urgent", "desktop", "phone", "status", "judgeMode"}
	for _, name := range []string{"create_bot", "update_bot"} {
		schema, ok := schemas[name]
		if !ok {
			t.Fatalf("%s is not served", name)
		}
		for _, prop := range propertyNames(schema) {
			if slices.Contains(forbidden, prop) {
				t.Errorf("%s takes %q", name, prop)
			}
		}
		if extra, ok := schema["additionalProperties"]; !ok || extra == true {
			t.Errorf("%s accepts unknown fields (additionalProperties %v)", name, extra)
		}
	}
	if !slices.Contains(propertyNames(schemas["create_bot"]), "watches") {
		t.Error("create_bot takes no watches")
	}
	for _, name := range []string{"pause_bot", "run_bot_now"} {
		props, _ := schemas[name]["properties"].(map[string]any)
		if len(props) != 1 || props["bot"] == nil {
			t.Errorf("%s takes %v, want only bot", name, props)
		}
	}

	// The SDK checks arguments against the schema before the handler runs.
	res, err := client.CallTool(ctx, &mcp.CallToolParams{Name: "create_bot", Arguments: map[string]any{
		"name": "Dip", "urgent": true, "watches": []any{map[string]any{"kind": "price", "source": "coinbase", "symbol": "BTC"}},
	}})
	text := ""
	if err != nil {
		text = err.Error()
	} else if res.IsError {
		raw, _ := json.Marshal(res.Content)
		text = string(raw)
	}
	if !strings.Contains(text, "urgent") {
		t.Errorf("create_bot with urgent answered %q, want a schema refusal naming urgent", text)
	}
}

// propertyNames lists every property name in a schema, nested ones too.
func propertyNames(schema any) []string {
	var out []string
	var walk func(v any)
	walk = func(v any) {
		switch v := v.(type) {
		case map[string]any:
			if props, ok := v["properties"].(map[string]any); ok {
				for name := range props {
					out = append(out, name)
				}
			}
			for _, child := range v {
				walk(child)
			}
		case []any:
			for _, child := range v {
				walk(child)
			}
		}
	}
	walk(schema)
	return out
}

// Rules left out keep a kept watch's rules, and [] asks for the defaults, so
// the conversion must keep nil and empty apart.
func TestWatchInputsKeepRulesNilApart(t *testing.T) {
	step := 3.0
	got := watchInputs([]botWatchIn{
		{ID: "bwt_1", Kind: "page", URL: "https://example.com/"},
		{Kind: "feed", URL: "https://example.com/feed", Rules: []botRuleIn{}},
		{Kind: "price", Source: "coinbase", Symbol: "BTC", Rules: []botRuleIn{{Kind: "below", StepPercent: &step}}},
	})
	if len(got) != 3 || got[0].ID != "bwt_1" || got[0].Rules != nil {
		t.Fatalf("first watch %+v, want its id and nil rules", got[0])
	}
	if got[1].Rules == nil || len(got[1].Rules) != 0 {
		t.Errorf("an empty rule list became %#v", got[1].Rules)
	}
	if r := got[2].Rules; len(r) != 1 || r[0].Kind != "below" || r[0].StepPercent != 3 || r[0].ResetPercent != 0 || r[0].ID != "" {
		t.Errorf("price rules %+v", r)
	}
}
