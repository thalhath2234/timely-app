package agent

import (
	"context"
	"encoding/json"
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

// liveProgram is a live block's program as the AI wrote it, with what it was
// written from.
type liveProgram struct {
	uid, docID, words string
	block             int
	// existing is the block's program the words change; "" for a new block.
	existing, program string
}

type liveProgramKey struct{}

func (s *Server) addLiveBlock(ctx context.Context, req *mcp.CallToolRequest, in addLiveBlockIn) (*mcp.CallToolResult, any, error) {
	uid, err := userID(req)
	if err != nil {
		return fail(err)
	}
	written, ok := ctx.Value(liveProgramKey{}).(liveProgram)
	if !ok || written.uid != uid || written.docID != in.DocID || written.block != in.Block || written.words != liveWords(in.Words) {
		if written, err = s.writeLiveProgram(ctx, uid, in); err != nil {
			return fail(err)
		}
	}
	// Stopped or abandoned while the AI answered: write nothing.
	if err := ctx.Err(); err != nil {
		return fail(err)
	}
	// The doc may have been edited while the AI answered, so the block goes
	// into the doc as it is now, never into the copy read before.
	current, err := s.Docs.GetByID(uid, in.DocID)
	if err != nil {
		return fail(err)
	}
	markdown := richtext.ToMarkdown(current.Content)
	fence := "```openui-lang\n" + strings.TrimSpace(written.program) + "\n```"
	verb := "added"
	if in.Block > 0 {
		blocks := liveFenceRe.FindAllStringSubmatchIndex(markdown, -1)
		if in.Block > len(blocks) || markdown[blocks[in.Block-1][2]:blocks[in.Block-1][3]] != written.existing {
			return fail(fmt.Errorf("live block %d changed while its new version was being written, so nothing was saved: read the doc and try again", in.Block))
		}
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

// prepareLiveBlock is add_live_block's Prepare: the AI writes the program
// before the write's transaction opens, and the write then only splices it in.
func (s *Server) prepareLiveBlock(ctx context.Context, uid string, args json.RawMessage) (context.Context, error) {
	if uid == "" {
		return nil, errors.New("not authenticated")
	}
	var in addLiveBlockIn
	if err := json.Unmarshal(args, &in); err != nil {
		return nil, err
	}
	written, err := s.writeLiveProgram(ctx, uid, in)
	if err != nil {
		return nil, err
	}
	return context.WithValue(ctx, liveProgramKey{}, written), nil
}

// writeLiveProgram has the AI write the program for in: a new block, or a
// change to the doc's Nth block as it reads now.
func (s *Server) writeLiveProgram(ctx context.Context, uid string, in addLiveBlockIn) (liveProgram, error) {
	words := liveWords(in.Words)
	if words == "" {
		return liveProgram{}, errors.New("words is empty: say what the block shows")
	}
	if s.LiveBlock == nil {
		return liveProgram{}, errors.New("live blocks are not available here")
	}
	current, err := s.Docs.GetByID(uid, in.DocID)
	if err != nil {
		return liveProgram{}, err
	}
	markdown := richtext.ToMarkdown(current.Content)
	blocks := liveFenceRe.FindAllStringSubmatchIndex(markdown, -1)
	switch {
	case in.Block != 0 && len(blocks) == 0:
		return liveProgram{}, errors.New("the doc has no live blocks yet: leave block out to add one")
	case in.Block < 0 || in.Block > len(blocks):
		return liveProgram{}, fmt.Errorf("block must be from 1 to %d, the doc's live blocks in order", len(blocks))
	}
	existing := ""
	if in.Block > 0 {
		at := blocks[in.Block-1]
		existing = markdown[at[2]:at[3]]
	}
	today, err := s.today(ctx, uid, "")
	if err != nil {
		return liveProgram{}, err
	}
	program, err := s.LiveBlock(ctx, uid, words, existing, today.Date())
	if err != nil {
		return liveProgram{}, err
	}
	return liveProgram{uid: uid, docID: in.DocID, words: words, block: in.Block, existing: existing, program: program}, nil
}

// liveWords is the words as the AI gets them.
func liveWords(words string) string {
	words = strings.TrimSpace(words)
	if len(words) > liveBlockMaxWords {
		words = words[:liveBlockMaxWords]
	}
	return words
}
