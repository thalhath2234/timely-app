package agent

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"testing"

	mcpauth "github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"timely-api/internal/features/bots"
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

// Chat proposes bots for review and they start on once approved, so its
// descriptions say so; MCP keeps the start-paused text. Both refuse alert
// settings by schema.
func TestBotToolsDescribeChatAndMCPApart(t *testing.T) {
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
	mcpText := map[string]string{}
	for _, tool := range listed.Tools {
		mcpText[tool.Name] = tool.Description
	}
	catalog := NewCatalog(Deps{})
	for _, name := range []string{"create_bot", "update_bot"} {
		if mcpText[name] == "" || catalog[name].Description == mcpText[name] {
			t.Errorf("%s: chat and MCP share the description %q", name, mcpText[name])
		}
	}
	if !strings.Contains(mcpText["create_bot"], "starts paused") || strings.Contains(catalog["create_bot"].Description, "starts paused") {
		t.Errorf("create_bot descriptions: MCP %q, chat %q", mcpText["create_bot"], catalog["create_bot"].Description)
	}
	if !strings.Contains(catalog["create_bot"].Description, "preview_bot") || strings.Contains(catalog["update_bot"].Description, "pauses it") {
		t.Errorf("chat descriptions: %q / %q", catalog["create_bot"].Description, catalog["update_bot"].Description)
	}
	if catalog["get_bot"].Description != mcpText["get_bot"] {
		t.Error("get_bot reads the same on both")
	}
	_, err = catalog["create_bot"].Call(ctx, "usr_1", json.RawMessage(`{"name":"Dip","urgent":true,"watches":[{"kind":"price","source":"crypto","symbol":"BTC"}]}`))
	if err == nil || !strings.Contains(err.Error(), "urgent") {
		t.Errorf("chat create_bot with urgent: %v, want a schema refusal naming urgent", err)
	}
	for name, args := range map[string]string{
		"get_bot": `{"bot":"x"}`, "ask_bot": `{"bot":"x"}`,
		"preview_bot": `{"watches":[{"kind":"price","source":"crypto","symbol":"BTC"}]}`,
	} {
		if _, err := catalog[name].Call(ctx, "usr_1", json.RawMessage(args)); err == nil || !strings.Contains(err.Error(), "not available") {
			t.Errorf("%s without bots: %v", name, err)
		}
	}
}

// Chat calls carry no API key, and an MCP call may carry no extra token
// data, so the outside app's name is simply empty then.
func TestAPIKeyNameWithoutExtra(t *testing.T) {
	for _, req := range []*mcp.CallToolRequest{
		nil,
		{},
		{Extra: &mcp.RequestExtra{}},
		{Extra: &mcp.RequestExtra{TokenInfo: &mcpauth.TokenInfo{UserID: "usr_1"}}},
		{Extra: &mcp.RequestExtra{TokenInfo: &mcpauth.TokenInfo{UserID: "usr_1", Extra: map[string]any{"keyName": 7}}}},
	} {
		if got := apiKeyName(req); got != "" {
			t.Errorf("apiKeyName(%+v) = %q", req, got)
		}
	}
	req := &mcp.CallToolRequest{Extra: &mcp.RequestExtra{TokenInfo: &mcpauth.TokenInfo{UserID: "usr_1", Extra: map[string]any{"keyName": "Claude Code"}}}}
	if got := apiKeyName(req); got != "Claude Code" {
		t.Errorf("apiKeyName = %q", got)
	}
}

func TestEveryWords(t *testing.T) {
	for minutes, want := range map[int]string{1: "minute", 30: "30 minutes", 60: "hour", 90: "90 minutes", 360: "6 hours", 1440: "day", 2880: "2 days"} {
		if got := everyWords(minutes); got != want {
			t.Errorf("everyWords(%d) = %q, want %q", minutes, got, want)
		}
	}
}

// list_bots gives the board's numbers but not the account's links (filter
// words and Bot ids) or the AI status the handler fills.
func TestListBotsSummaryLeavesOutLinks(t *testing.T) {
	sum := bots.ListSummary{ChecksToday: 3, AllPaused: true, PassedToday: 2, AIChecksToday: 1,
		Links: []bots.LinkView{{ID: "blk_1"}}, AI: bots.AIStatus{Ready: true}}
	raw, err := json.Marshal(summaryReply(sum))
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"links", "ai"} {
		if _, ok := got[key]; ok {
			t.Errorf("list_bots summary carries %s: %s", key, raw)
		}
	}
	if got["checksToday"] != float64(3) || got["allPaused"] != true || got["passedToday"] != float64(2) || got["aiChecksToday"] != float64(1) {
		t.Errorf("summary %s", raw)
	}
}

// chatOnlyBotFields are what chat proposes for review and an outside app
// never sets: judging, knowledge, links and briefs.
var chatOnlyBotFields = []string{"passesTo", "judgeMode", "kind", "sources", "knowledge", "briefTime", "briefAi", "briefOnly"}

// Chat's create_bot and update_bot take judging, knowledge, links and
// briefs; the MCP schemas take none of them.
func TestBotToolSchemasChatOnlyFields(t *testing.T) {
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
	for _, tool := range listed.Tools {
		if tool.Name != "create_bot" && tool.Name != "update_bot" {
			continue
		}
		raw, _ := json.Marshal(tool.InputSchema)
		var schema map[string]any
		if err := json.Unmarshal(raw, &schema); err != nil {
			t.Fatal(err)
		}
		// Watches and rules have a kind of their own, so only the top level.
		props, _ := schema["properties"].(map[string]any)
		for _, field := range chatOnlyBotFields {
			if props[field] != nil {
				t.Errorf("MCP %s takes %q", tool.Name, field)
			}
		}
		if strings.Contains(tool.Description, "passesTo") || strings.Contains(tool.Description, "judgeMode") {
			t.Errorf("MCP %s describes chat-only fields: %q", tool.Name, tool.Description)
		}
	}

	catalog := NewCatalog(Deps{})
	for _, name := range []string{"create_bot", "update_bot"} {
		raw, _ := json.Marshal(catalog[name].Parameters)
		var schema map[string]any
		if err := json.Unmarshal(raw, &schema); err != nil {
			t.Fatal(err)
		}
		props, _ := schema["properties"].(map[string]any)
		for _, field := range chatOnlyBotFields {
			if props[field] == nil {
				t.Errorf("chat %s does not take %s", name, field)
			}
		}
		for _, field := range []string{"urgent", "desktop", "phone", "status"} {
			if props[field] != nil {
				t.Errorf("chat %s takes %s", name, field)
			}
		}
		if extra, ok := schema["additionalProperties"]; !ok || extra == true {
			t.Errorf("chat %s accepts unknown fields", name)
		}
	}
	if !strings.Contains(catalog["create_bot"].Description, "judgeMode ai") || !strings.Contains(catalog["update_bot"].Description, "full lists") {
		t.Errorf("chat descriptions: %q / %q", catalog["create_bot"].Description, catalog["update_bot"].Description)
	}

	// A link's filter holds at most a few words; knowledge null clears, and
	// a knowledge left out is not a clear.
	var in updateBotChatIn
	if err := json.Unmarshal([]byte(`{"bot":"x","knowledge":null,"passesTo":[{"bot":"Price check","filter":["2TB NVMe"]}]}`), &in); err != nil {
		t.Fatal(err)
	}
	if !in.clearKnowledge || in.Knowledge != nil || in.Bot != "x" || in.PassesTo == nil || (*in.PassesTo)[0].Bot != "Price check" {
		t.Errorf("knowledge null: %+v", in)
	}
	in = updateBotChatIn{}
	if err := json.Unmarshal([]byte(`{"bot":"x","knowledge":{"kind":"sheet","id":"sht_1"}}`), &in); err != nil {
		t.Fatal(err)
	}
	if in.clearKnowledge || in.Knowledge == nil || in.Knowledge.ID != "sht_1" {
		t.Errorf("knowledge set: %+v", in)
	}
	in = updateBotChatIn{}
	if err := json.Unmarshal([]byte(`{"bot":"x","name":"Y"}`), &in); err != nil {
		t.Fatal(err)
	}
	if in.clearKnowledge || in.Knowledge != nil || in.Name == nil || *in.Name != "Y" {
		t.Errorf("knowledge left out: %+v", in)
	}
	if got := linkInputs([]botLinkIn{{Bot: "B", Filter: []string{"NVMe"}}}); len(got) != 1 || got[0].BotID != "B" || got[0].Filter[0] != "NVMe" || got[0].Enabled != nil {
		t.Errorf("linkInputs %+v", got)
	}
}

// get_bot gives a Bot's judging, knowledge, links (with the target's name)
// and brief settings, and nothing a check changes, such as today's passes.
func TestSettingsOfCarriesAIAndLinks(t *testing.T) {
	d := bots.Detail{
		View: bots.View{ID: "bot_a", Name: "Deals", Kind: bots.KindWatch, JudgeMode: bots.JudgeAI, BriefOnly: true,
			Knowledge: &bots.KnowledgeView{Kind: "sheet", ID: "sht_1", Title: "Wishlist", Missing: true}, Sources: []string{}},
		Links: []bots.LinkView{
			{ID: "blk_1", Kind: bots.LinkPass, FromBotID: "bot_a", ToBotID: "bot_b", Filter: []string{"NVMe"}, Enabled: true, PassedToday: 3},
			{ID: "blk_2", Kind: bots.LinkPass, FromBotID: "bot_c", ToBotID: "bot_a", Enabled: true},
			{ID: "blk_3", Kind: bots.LinkBrief, FromBotID: "bot_a", ToBotID: "bot_m", Enabled: true},
		},
	}
	got := settingsOf(d, map[string]string{"bot_b": "Price check", "bot_c": "Feed", "bot_m": "Morning"})
	raw, _ := json.Marshal(got)
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"kind", "judgeMode", "knowledge", "passesTo", "sources", "briefTime", "briefAi", "briefOnly"} {
		if _, ok := m[key]; !ok {
			t.Errorf("get_bot leaves out %s: %s", key, raw)
		}
	}
	if strings.Contains(string(raw), "passedToday") || strings.Contains(string(raw), "missing") || strings.Contains(string(raw), "blk_") {
		t.Errorf("get_bot carries what a check changes, or link ids: %s", raw)
	}
	if l := got.PassesTo; len(l) != 1 || l[0].Bot != "Price check" || l[0].BotID != "bot_b" || !l[0].Enabled || len(l[0].Filter) != 1 || l[0].Filter[0] != "NVMe" {
		t.Errorf("passesTo %+v: only the links from this bot, by name", got.PassesTo)
	}
	if got.Knowledge == nil || *got.Knowledge != (botKnowledgeOut{Kind: "sheet", ID: "sht_1", Title: "Wishlist"}) || !got.BriefOnly || got.JudgeMode != bots.JudgeAI {
		t.Errorf("settings %+v", got)
	}

	brief := settingsOf(bots.Detail{View: bots.View{ID: "bot_m", Name: "Morning", Kind: bots.KindBrief, BriefTime: "08:00", BriefAI: true,
		Sources: []string{"bot_a", "bot_b"}}}, map[string]string{"bot_a": "Deals", "bot_b": "Price check"})
	if len(brief.Sources) != 2 || brief.Sources[1] != (botSourceOut{BotID: "bot_b", Name: "Price check"}) || brief.BriefTime != "08:00" || !brief.BriefAI || brief.PassesTo == nil {
		t.Errorf("brief settings %+v", brief)
	}
}

// list_bots names the newest alert in the rules' words, never the title an
// AI judge wrote.
func TestBotReplyUsesRulesTitle(t *testing.T) {
	v := bots.View{ID: "bot_a", Kind: bots.KindWatch, JudgeMode: bots.JudgeAI, AIChecksToday: 4,
		LatestAlert: &bots.AlertBrief{ID: "bal_1", Title: "HACKED", RulesTitle: "Deals: price fell 10%"}}
	got := botReply(v)
	if got.LatestAlert == nil || got.LatestAlert.Title != "Deals: price fell 10%" || got.Kind != bots.KindWatch || got.AIChecksToday != 4 || got.JudgeMode != bots.JudgeAI {
		t.Errorf("botReply %+v", got)
	}
}

// A shop watch's stock reaches the model both ways: onlyInStock on the way
// in, availability in list_bots on the way out.
func TestBotToolsCarryStock(t *testing.T) {
	no := false
	got := watchInputs([]botWatchIn{{Kind: "page", URL: "https://shop.example/p", Read: "product_price",
		Rules: []botRuleIn{{Kind: "below", Threshold: &[]float64{90000}[0], OnlyInStock: &no}, {Kind: "in_stock"}}}})
	if r := got[0].Rules; len(r) != 2 || r[0].OnlyInStock == nil || *r[0].OnlyInStock || r[1].Kind != bots.RuleInStock || r[1].OnlyInStock != nil {
		t.Errorf("rules %+v", r)
	}
	v := bots.View{ID: "bot_p", Watches: []bots.WatchView{{ID: "bwt_p", Kind: bots.WatchPage, Read: bots.ReadProductPrice, Availability: "out_of_stock"}}}
	if w := botReply(v).Watches[0]; w.Availability != "out_of_stock" {
		t.Errorf("watch %+v", w)
	}
	if !strings.Contains(stockRules, "onlyInStock") || !strings.Contains(stockRules, "in_stock") {
		t.Errorf("stockRules %q", stockRules)
	}
}
