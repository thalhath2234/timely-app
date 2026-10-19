package agent

import (
	"context"
	"errors"
	"fmt"
	"time"

	"timely-api/internal/features/suggest"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Smart suggestions the apps show (features/suggest). Both need the account's
// smart suggestions on; available=false says they are off.

func (s *Server) registerSuggest(server *mcp.Server) {
	registerTool(s, server, &mcp.Tool{Name: "get_today_suggestions", Description: "Today's smart suggestions, as on Today: focus picks with their reasons and goal, the next free gap with the Work that fits it, and how many top tasks move each goal. available=false means smart suggestions are off."}, reads, s.getTodaySuggestions)
	registerTool(s, server, &mcp.Tool{Name: "list_stale_work", Description: "Open Work with no edits, comments or upcoming blocks for three weeks, oldest first, with idle days and a verdict when one is clear (actionable, clarify, blocked or obsolete). available=false means smart suggestions are off."}, reads, s.listStaleWork)
}

func (s *Server) suggestions() (*suggest.Service, error) {
	if s.Suggest == nil {
		return nil, errors.New("smart suggestions are not available")
	}
	return s.Suggest, nil
}

type todaySuggestionsIn struct {
	Timezone string `json:"timezone,omitempty"`
}

func (s *Server) getTodaySuggestions(ctx context.Context, req *mcp.CallToolRequest, in todaySuggestionsIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	svc, err := s.suggestions()
	if err != nil {
		return fail(err)
	}
	out, err := svc.Today(ctx, uid, zone(ctx, in.Timezone), time.Now())
	if err != nil {
		return fail(err)
	}
	if !out.Available {
		return reply("smart suggestions are off", out)
	}
	return reply(fmt.Sprintf("%d focus picks", len(out.Focus)), out)
}

func (s *Server) listStaleWork(ctx context.Context, req *mcp.CallToolRequest, _ emptyIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	svc, err := s.suggestions()
	if err != nil {
		return fail(err)
	}
	out, err := svc.StaleWork(ctx, uid, time.Now())
	if err != nil {
		return fail(err)
	}
	if !out.Available {
		return reply("smart suggestions are off", out)
	}
	return reply(fmt.Sprintf("%d stale tasks", len(out.Tasks)), out)
}
