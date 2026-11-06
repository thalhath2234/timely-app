package agent

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"timely-api/internal/features/bots"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Bots (features/bots, ADR 0021). Every tool is MCP-only until chat gets a
// proposal card for Bots, and each call is OriginMCP: a Bot made or changed
// here is paused, and no tool turns one on or sets its alerts.

func (s *Server) registerBots(server *mcp.Server) {
	limits := fmt.Sprintf("Up to %d bots, each with 1 to %d watches and up to %d rules per watch. Checks run at most every %d minutes for pages and feeds, %d minutes for prices and %d hours for shop prices.",
		bots.MaxBots, bots.MaxWatches, bots.MaxRulesPerWatch,
		int(bots.MinPageEvery/time.Minute), int(bots.MinPriceEvery/time.Minute), int(bots.MinProductEvery/time.Hour))
	registerTool(s, server, &mcp.Tool{Name: "list_bots", Description: "The person's bots: status, schedule, health and each watch with its rules and a short summary of its last reading."}, mcpOnlyReads, s.listBots)
	registerTool(s, server, &mcp.Tool{Name: "list_bot_findings", Description: "What the bots found, newest first: the findings board. bot (id or name) keeps one bot's; since is RFC 3339; limit is at most 100 (default 50)."}, mcpOnlyReads, s.listBotFindings)
	registerTool(s, server, &mcp.Tool{Name: "create_bot", Description: "Make a bot that watches pages, feeds or prices and alerts the person when a rule comes true. It starts paused: the person turns it on and sets its alerts in Timely. Nothing is fetched now. " + limits + " intervalMinutes 0 picks a default. Rules left out get a default (any change on a page, new items on a feed, a 5% move on a price)."}, mcpOnly, s.createBot)
	registerTool(s, server, &mcp.Tool{Name: "update_bot", Description: "Change a bot (id or name). watches, when given, is the full list: keep a watch's id to keep it, leave the id out to add one, and a watch left out is removed. A watch sent without rules keeps its rules. Changing what an active bot watches or its rules pauses it until the person turns it on in Timely. " + limits}, mcpOnly, s.updateBot)
	registerTool(s, server, &mcp.Tool{Name: "pause_bot", Description: "Pause a bot (id or name). Only the person can turn it back on, in Timely."}, mcpOnly, s.pauseBot)
	registerTool(s, server, &mcp.Tool{Name: "run_bot_now", Description: "Check an active bot (id or name) as soon as its minimum interval allows, and say when. A paused bot is refused."}, mcpOnly, s.runBotNow)
}

func (s *Server) bots() (*bots.Service, error) {
	if s.Bots == nil {
		return nil, errors.New("bots are not available")
	}
	return s.Bots, nil
}

// botErr words a missing Bot so the model knows where to look.
func botErr(err error, bot string) error {
	if errors.Is(err, bots.ErrNotFound) {
		return fmt.Errorf("no bot named %q; call list_bots for the names", bot)
	}
	return err
}

// botRuleIn mirrors bots.Rule without its id, every field optional but kind.
type botRuleIn struct {
	Kind         string   `json:"kind" jsonschema:"any_change, above, below, move_pct (prices); words_appear, words_disappear (page text); new_item (feeds)"`
	Threshold    *float64 `json:"threshold,omitempty" jsonschema:"the price for above and below"`
	Percent      *float64 `json:"percent,omitempty" jsonschema:"the move in percent for move_pct"`
	Direction    string   `json:"direction,omitempty" jsonschema:"up, down or any (move_pct)"`
	StepPercent  *float64 `json:"stepPercent,omitempty" jsonschema:"above/below: fire again after a further move this big, default 5"`
	ResetPercent *float64 `json:"resetPercent,omitempty" jsonschema:"above/below: re-arm once back past the line by this much, default 0.5"`
	Words        []string `json:"words,omitempty" jsonschema:"words for words_appear and words_disappear, or to filter new_item"`
}

type botWatchIn struct {
	ID       string      `json:"id,omitempty" jsonschema:"update_bot: the id of a watch to keep"`
	Kind     string      `json:"kind" jsonschema:"page, feed or price"`
	URL      string      `json:"url,omitempty" jsonschema:"page and feed: the public web address"`
	Read     string      `json:"read,omitempty" jsonschema:"page: text (default), selector or product_price"`
	Selector string      `json:"selector,omitempty" jsonschema:"page with read=selector: a CSS selector"`
	Source   string      `json:"source,omitempty" jsonschema:"price: coinbase for crypto or finnhub for stocks"`
	Symbol   string      `json:"symbol,omitempty" jsonschema:"price: the ticker or coin, like AAPL or BTC"`
	Currency string      `json:"currency,omitempty" jsonschema:"price: the quote currency, like USD"`
	Rules    []botRuleIn `json:"rules,omitempty" jsonschema:"when to alert; left out gets a default"`
}

func watchInputs(in []botWatchIn) []bots.WatchInput {
	out := make([]bots.WatchInput, len(in))
	for i, w := range in {
		out[i] = bots.WatchInput{ID: w.ID, Kind: w.Kind, URL: w.URL, Read: w.Read, Selector: w.Selector, Source: w.Source, Symbol: w.Symbol, Currency: w.Currency}
		if w.Rules == nil {
			continue // nil keeps a kept watch's rules; [] asks for the defaults
		}
		out[i].Rules = make([]bots.Rule, len(w.Rules))
		for j, r := range w.Rules {
			out[i].Rules[j] = bots.Rule{Kind: r.Kind, Threshold: r.Threshold, Percent: r.Percent, Direction: r.Direction, Words: r.Words}
			if r.StepPercent != nil {
				out[i].Rules[j].StepPercent = *r.StepPercent
			}
			if r.ResetPercent != nil {
				out[i].Rules[j].ResetPercent = *r.ResetPercent
			}
		}
	}
	return out
}

func (s *Server) listBots(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	svc, err := s.bots()
	if err != nil {
		return fail(err)
	}
	views, err := svc.List(ctx, uid)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%d bots", len(views)), map[string]any{"bots": views})
}

type listBotFindingsIn struct {
	Bot   string `json:"bot,omitempty" jsonschema:"bot id or name; all bots when left out"`
	Since string `json:"since,omitempty" jsonschema:"RFC 3339; only findings from then on"`
	Limit int    `json:"limit,omitempty" jsonschema:"at most 100, default 50"`
}

func (s *Server) listBotFindings(ctx context.Context, req *mcp.CallToolRequest, in listBotFindingsIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	svc, err := s.bots()
	if err != nil {
		return fail(err)
	}
	q := bots.FindingQuery{BotID: in.Bot, Limit: in.Limit}
	if raw := strings.TrimSpace(in.Since); raw != "" {
		if q.Since, err = time.Parse(time.RFC3339, raw); err != nil {
			return fail(errors.New("give since like 2026-11-07T09:00:00Z"))
		}
	}
	items, err := svc.Findings(ctx, uid, q)
	if err != nil {
		return fail(botErr(err, in.Bot))
	}
	return reply(fmt.Sprintf("%d findings", len(items)), map[string]any{"items": items})
}

type createBotIn struct {
	Name            string       `json:"name" jsonschema:"unique, up to 80 characters"`
	Description     string       `json:"description,omitempty" jsonschema:"what the bot is for, up to 2000 characters"`
	IntervalMinutes int          `json:"intervalMinutes,omitempty" jsonschema:"minutes between checks; 0 picks a default"`
	Watches         []botWatchIn `json:"watches" jsonschema:"1 to 5 watches"`
}

func (s *Server) createBot(ctx context.Context, req *mcp.CallToolRequest, in createBotIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	svc, err := s.bots()
	if err != nil {
		return fail(err)
	}
	v, err := svc.Create(ctx, uid, bots.Input{Name: in.Name, Description: in.Description, IntervalMinutes: in.IntervalMinutes, Watches: watchInputs(in.Watches)}, bots.OriginMCP)
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("Created %s. It starts paused; the person turns it on in Timely.", v.Name), v)
}

type updateBotIn struct {
	Bot             string        `json:"bot" jsonschema:"bot id or name"`
	Name            *string       `json:"name,omitempty"`
	Description     *string       `json:"description,omitempty"`
	IntervalMinutes *int          `json:"intervalMinutes,omitempty" jsonschema:"minutes between checks; 0 picks a default"`
	Watches         *[]botWatchIn `json:"watches,omitempty" jsonschema:"the full list of watches"`
}

func (s *Server) updateBot(ctx context.Context, req *mcp.CallToolRequest, in updateBotIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	svc, err := s.bots()
	if err != nil {
		return fail(err)
	}
	p := bots.Patch{Name: in.Name, Description: in.Description, IntervalMinutes: in.IntervalMinutes}
	wasActive := false
	if in.Watches != nil {
		ws := watchInputs(*in.Watches)
		p.Watches = &ws
		before, err := svc.Get(ctx, uid, in.Bot)
		if err != nil {
			return fail(botErr(err, in.Bot))
		}
		wasActive = before.Status == bots.StatusActive
	}
	v, err := svc.Update(ctx, uid, in.Bot, p, bots.OriginMCP)
	if err != nil {
		return fail(botErr(err, in.Bot))
	}
	text := "Updated " + v.Name + "."
	if wasActive && v.Status == bots.StatusPaused {
		text += " Changing what it watches paused it; the person turns it on in Timely."
	}
	return reply(text, v)
}

type botIn struct {
	Bot string `json:"bot" jsonschema:"bot id or name"`
}

func (s *Server) pauseBot(ctx context.Context, req *mcp.CallToolRequest, in botIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	svc, err := s.bots()
	if err != nil {
		return fail(err)
	}
	v, err := svc.Pause(ctx, uid, in.Bot, bots.PauseMCP)
	if err != nil {
		return fail(botErr(err, in.Bot))
	}
	return reply("Paused "+v.Name+". Only the person can turn it back on, in Timely.", v)
}

func (s *Server) runBotNow(ctx context.Context, req *mcp.CallToolRequest, in botIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	svc, err := s.bots()
	if err != nil {
		return fail(err)
	}
	res, err := svc.RunNow(ctx, uid, in.Bot, bots.OriginMCP)
	if err != nil {
		return fail(botErr(err, in.Bot))
	}
	return reply(res.Line, res)
}
