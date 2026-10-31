package agent

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"timely-api/internal/features/doc"
	"timely-api/internal/richtext"
)

// Live blocks are described dashboard cards inside a doc: an OpenUI Lang
// program in an ```openui-lang fence that the apps draw from the person's
// live data each time the doc shows (packages/contract/src/genuiBoard.ts).
// The agent passes words; the account's AI provider writes the program with
// the same instructions as the apps' Describe dialog, so the agent never
// learns the language and every block is one the apps can draw.

const liveBlockMaxWords = 500

var liveFenceRe = regexp.MustCompile("(?ms)^```+openui-lang[ \t]*\n(.*?)\n?```+[ \t]*$")

type addLiveBlockIn struct {
	DocID string `json:"docId"`
	Words string `json:"words" jsonschema:"what the block shows, or the change to make, in the person's words, e.g. open Client work tasks with a chart of what was done each day"`
	Block int    `json:"block,omitempty" jsonschema:"changes the doc's Nth live block (1 is the first) with these words instead of adding a new one"`
}

func (s *Server) addLiveBlock(ctx context.Context, req *mcp.CallToolRequest, in addLiveBlockIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	words := strings.TrimSpace(in.Words)
	if words == "" {
		return fail(errors.New("words is empty: say what the block shows"))
	}
	if len(words) > liveBlockMaxWords {
		words = words[:liveBlockMaxWords]
	}
	if s.LiveBlock == nil {
		return fail(errors.New("live blocks are not available here"))
	}
	current, err := s.Docs.GetByID(uid, in.DocID)
	if err != nil {
		return fail(err)
	}
	markdown := richtext.ToMarkdown(current.Content)
	blocks := liveFenceRe.FindAllStringSubmatchIndex(markdown, -1)
	switch {
	case in.Block != 0 && len(blocks) == 0:
		return fail(errors.New("the doc has no live blocks yet: leave block out to add one"))
	case in.Block < 0 || in.Block > len(blocks):
		return fail(fmt.Errorf("block must be from 1 to %d, the doc's live blocks in order", len(blocks)))
	}
	existing := ""
	if in.Block > 0 {
		at := blocks[in.Block-1]
		existing = markdown[at[2]:at[3]]
	}
	today, err := s.today(ctx, uid, "")
	if err != nil {
		return fail(err)
	}
	program, err := s.LiveBlock(ctx, uid, words, existing, today.Date())
	if err != nil {
		return fail(err)
	}
	fence := "```openui-lang\n" + strings.TrimSpace(program) + "\n```"
	verb := "added"
	if in.Block > 0 {
		at := blocks[in.Block-1]
		markdown = markdown[:at[0]] + fence + markdown[at[1]:]
		verb = "changed"
	} else {
		if markdown != "" {
			markdown += "\n\n"
		}
		markdown += fence
	}
	rich, plain := md(markdown)
	d, err := s.Docs.Update(uid, in.DocID, doc.DocumentUpdate{Content: &rich, PlainText: &plain, Snapshot: true})
	if err != nil {
		return fail(err)
	}
	return reply(fmt.Sprintf("%s a live block in %s; it reads the person's data each time the doc opens", verb, d.Title), docPayload(d))
}
