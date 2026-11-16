package chat

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"timely-api/internal/features/bots"
)

// defaultModel is an account whose default AI provider is claude/sonnet.
type defaultModel struct{}

func (defaultModel) Resolve(context.Context, string) (string, string, error) { return "claude", "sonnet", nil }
func (defaultModel) Completer(context.Context, string, string, string) (Completer, error) {
	return nil, errors.New("no completer in this test")
}

// A Bot that names no model runs on the account default, and the result says
// which model that was, with the worker's tokens.
func TestBotAgentResultNamesTheModelThatRan(t *testing.T) {
	s := New(nil, engineCatalog, nil)
	s.SetCompleters(defaultModel{})
	w := newBotWorld(t, s)
	b := testBot("bot_default")
	b.ModelProvider, b.Model = "", ""
	res := runTick(t, w.a, "user-a", tickInput(b, "bchk_default", "x"))
	if res.Model != (bots.ModelChoice{Provider: "claude", Model: "sonnet"}) {
		t.Fatalf("model %+v", res.Model)
	}
	if res.Usage.InputTokens != 3 || res.Usage.OutputTokens != 2 {
		t.Fatalf("usage %+v", res.Usage)
	}
	// The Bot's own model is the one that ran when it names one.
	own := runTick(t, w.a, "user-a", tickInput(testBot("bot_own"), "bchk_own", "x"))
	if own.Model != (bots.ModelChoice{Provider: "openrouter", Model: "stub-model"}) {
		t.Fatalf("own model %+v", own.Model)
	}
}

// bot.done's usage (the worker's run_bot.usage_of) maps to the tick's tokens.
func TestBotDoneUsageMapsToTokens(t *testing.T) {
	var d botDone
	raw := `{"response":"ok","silent":true,"usage":{"input_tokens":1200,"output_tokens":80,"iterations":3,"model":"m","estimated_cost_usd":null}}`
	if err := json.Unmarshal([]byte(raw), &d); err != nil {
		t.Fatal(err)
	}
	res := d.result(&botTick{}, false)
	if res.Usage != (bots.Usage{InputTokens: 1200, OutputTokens: 80, Calls: 3}) {
		t.Fatalf("usage %+v", res.Usage)
	}
}

// Each readings entry carries the url of its Read (PROTOCOL.md 13.1), or a
// price Read's source and ticker when it has no page.
func TestBotDataReadingsCarryTheirRead(t *testing.T) {
	price := 89999.0
	in := bots.RunInput{Readings: map[string]bots.Reading{
		"w_page":  {Kind: bots.ReadingText, Text: "Pixel"},
		"w_price": {Kind: bots.ReadingPrice, Price: &price, Currency: "USD"},
		"w_gone":  {Kind: bots.ReadingText, Text: "x"},
	}}
	addrs := map[string]readAddr{
		"w_page":  {url: "https://store.example.com/pixel"},
		"w_price": {source: "coinbase", symbol: "BTC-USD"},
	}
	list, _ := botData(in, addrs)["readings"].([]map[string]any)
	if len(list) != 3 {
		t.Fatalf("readings %+v", list)
	}
	for _, item := range list {
		switch item["watch_id"] {
		case "w_page":
			if item["url"] != "https://store.example.com/pixel" {
				t.Fatalf("page %+v", item)
			}
		case "w_price":
			if item["source"] != "coinbase" || item["ticker"] != "BTC-USD" || item["symbol"] != "USD" || item["url"] != nil {
				t.Fatalf("price %+v", item)
			}
		case "w_gone":
			if _, ok := item["url"]; ok {
				t.Fatalf("a Read not found has a url: %+v", item)
			}
		}
	}
}
