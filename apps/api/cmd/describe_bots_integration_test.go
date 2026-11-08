package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"timely-api/internal/features/chat"
	"timely-api/internal/features/embed"
	"timely-api/internal/features/provider"
	"timely-api/internal/jobs"
	"timely-api/internal/models"
)

// Describe draws a bot's price history: the person's bots with a price are
// listed by name and id (never another account's, never a bot without a
// price), and check_block flags a PriceHistory that names a bot by name or by
// an id the person does not have, through the same boardData main wires.
func TestIntegrationDescribeDrawsPriceHistory(t *testing.T) {
	db, uid := agentToolsDB(t)
	other := "usr_agent_other"
	if err := db.Create(&models.User{ID: other, Email: "other@example.invalid", Password: "not-a-real-hash"}).Error; err != nil {
		t.Fatal(err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if err := db.Exec(query, args...).Error; err != nil {
			t.Fatal(err)
		}
	}
	bot := func(id, user, name, status string) {
		t.Helper()
		if status == "active" {
			exec(`INSERT INTO bots (id, user_id, name, interval_seconds, next_check_at) VALUES (?, ?, ?, 900, now())`, id, user, name)
			return
		}
		exec(`INSERT INTO bots (id, user_id, name, interval_seconds, status, pause_reason) VALUES (?, ?, ?, 900, 'paused', 'person')`, id, user, name)
	}
	bot("bot_sony", uid, "Sony WH-1000XM6", "active")
	exec(`INSERT INTO bot_watches (id, bot_id, user_id, kind, url, read_mode) VALUES ('bwt_sony', 'bot_sony', ?, 'page', 'https://www.amazon.in/dp/B0F', 'product_price')`, uid)
	bot("bot_coin", uid, "BTC dip", "paused")
	exec(`INSERT INTO bot_watches (id, bot_id, user_id, position, kind, url, read_mode) VALUES ('bwt_coin_news', 'bot_coin', ?, 0, 'page', 'https://news.example.com/btc', 'text')`, uid)
	exec(`INSERT INTO bot_watches (id, bot_id, user_id, position, kind, source, symbol) VALUES ('bwt_coin', 'bot_coin', ?, 1, 'price', 'coinbase', 'BTC-USD')`, uid)
	bot("bot_blog", uid, "Blog news", "active")
	exec(`INSERT INTO bot_watches (id, bot_id, user_id, kind, url, read_mode) VALUES ('bwt_blog', 'bot_blog', ?, 'page', 'https://blog.example.com/', 'text')`, uid)
	bot("bot_theirs", other, "Their coin", "active")
	exec(`INSERT INTO bot_watches (id, bot_id, user_id, kind, source, symbol) VALUES ('bwt_theirs', 'bot_theirs', ?, 'price', 'coinbase', 'ETH-USD')`, other)

	// boardData is scoped to the account it is asked for.
	data, err := boardData(db)(context.Background(), uid)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(data)
	if strings.Contains(string(raw), "bot_theirs") || strings.Contains(string(raw), "Their coin") {
		t.Fatalf("boardData for one account holds another's bot: %s", raw)
	}
	var board struct {
		Bots []struct {
			ID     string `json:"id"`
			Name   string `json:"name"`
			Prices []struct {
				ID    string `json:"id"`
				Label string `json:"label"`
			} `json:"prices"`
		} `json:"bots"`
	}
	if err := json.Unmarshal(raw, &board); err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, b := range board.Bots {
		labels := []string{}
		for _, p := range b.Prices {
			labels = append(labels, p.ID+"="+p.Label)
		}
		got[b.ID] = b.Name + ": " + strings.Join(labels, ",")
	}
	want := map[string]string{
		"bot_sony": "Sony WH-1000XM6: bwt_sony=amazon.in",
		"bot_coin": "BTC dip: bwt_coin=BTC-USD",
		"bot_blog": "Blog news: ",
	}
	if len(got) != len(want) {
		t.Fatalf("bots = %v", got)
	}
	for id, line := range want {
		if got[id] != line {
			t.Errorf("bot %s = %q, want %q", id, got[id], line)
		}
	}
	if !strings.Contains(string(raw), `"prices":[]`) {
		t.Errorf("a bot without a price has an empty list, not null: %s", raw)
	}

	// A fake Describe: a draft naming a bot by name, another account's bot
	// and a bot without a price; then one with a real id; then the answer.
	prov := provider.New(db, embed.New(db), jobs.NewQueue(db))
	prov.SetBoardData(boardData(db))
	wrong := `root = Panel("Prices", [a, b, c])
a = PriceHistory("Sony WH-1000XM6")
b = PriceHistory("bot_theirs")
c = PriceHistory("bot_blog")`
	right := `root = Panel("Sony WH-1000XM6", [chart])
chart = PriceHistory("bot_sony")`
	model := &botChatModel{}
	model.script(
		toolCall("check_block", map[string]any{"program": wrong}),
		toolCall("check_block", map[string]any{"program": right}),
		chat.WireMessage{Role: "assistant", Content: "```\n" + right + "\n```"},
	)
	ctx := chat.WithCompleter(context.Background(), model)
	program, err := prov.LiveBlock(ctx, uid, "the Sony headphones price over the last month", "", "2026-11-08")
	if err != nil {
		t.Fatal(err)
	}
	if program != right {
		t.Fatalf("program = %q", program)
	}
	seen, tools := model.calls(0)
	if len(seen) != 3 {
		t.Fatalf("model calls = %d", len(seen))
	}
	if !hasName(tools[0], "check_block") {
		t.Fatalf("check_block is offered: %v", tools[0])
	}
	user := seen[0][1].Content
	// Latest edited first: the coin bot was made last.
	line := "\n- Bots with a price, for PriceHistory (name, then id): \"BTC dip\" bot_coin, \"Sony WH-1000XM6\" bot_sony\n"
	if strings.Count(user, "Bots with a price") != 1 || !strings.Contains(user, line) {
		t.Fatalf("the user message lists the price bots by name and id:\n%s", user)
	}
	for _, never := range []string{"Blog news", "bot_blog", "Their coin", "bot_theirs"} {
		if strings.Contains(user, never) {
			t.Errorf("the user message names %q:\n%s", never, user)
		}
	}
	checked := func(call int) map[string]any {
		t.Helper()
		messages := seen[call]
		var out map[string]any
		if err := json.Unmarshal([]byte(messages[len(messages)-1].Content), &out); err != nil {
			t.Fatalf("check_block result: %v", err)
		}
		return out
	}
	problems, _ := json.Marshal(checked(1)["problems"])
	for _, want := range []string{
		`“Sony WH-1000XM6” is not a bot id`,
		`No bot has the id “bot_theirs”`,
		`“Blog news” watches no price`,
	} {
		if !strings.Contains(string(problems), want) {
			t.Errorf("check_block lacks %q: %s", want, problems)
		}
	}
	if clean := checked(2)["problems"]; clean != nil && len(clean.([]any)) > 0 {
		t.Errorf("a real price bot's id draws clean: %v", clean)
	}

	// No bot with a price: no line at all.
	exec(`DELETE FROM bots WHERE user_id = ?`, uid)
	model = &botChatModel{}
	// Answered twice: a draft check_block finds problems in is sent back once.
	empty := chat.WireMessage{Role: "assistant", Content: "```\nroot = Panel(\"Empty\", [])\n```"}
	model.script(empty, empty)
	if _, err := prov.LiveBlock(chat.WithCompleter(context.Background(), model), uid, "my bots", "", "2026-11-08"); err != nil {
		t.Fatal(err)
	}
	seen, _ = model.calls(0)
	if user := seen[0][1].Content; strings.Contains(user, "Bots with a price") {
		t.Errorf("no price bots, no line:\n%s", user)
	}
}
