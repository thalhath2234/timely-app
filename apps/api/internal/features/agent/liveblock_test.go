package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"timely-api/internal/features/doc"
	"timely-api/internal/models"
	"timely-api/internal/richtext"
)

// liveDocs is a doc service holding one doc, edited in place like the real one.
type liveDocs struct {
	doc.DocumentService
	d       *models.Document
	updates int
}

func (l *liveDocs) GetByID(_, id string) (*models.Document, error) {
	if id != l.d.ID {
		return nil, errors.New("not found")
	}
	read := *l.d
	return &read, nil
}

func (l *liveDocs) Update(_, id string, u doc.DocumentUpdate) (*models.Document, error) {
	if u.Content != nil {
		l.d.Content, l.d.PlainText = *u.Content, *u.PlainText
	}
	l.updates++
	return l.GetByID("", id)
}

// set saves the doc as the person's editor would.
func (l *liveDocs) set(markdown string) {
	l.d.Content, l.d.PlainText = richtext.FromMarkdown(markdown)
}

func (l *liveDocs) markdown() string { return richtext.ToMarkdown(l.d.Content) }

const liveTestProgram = "root = Panel(\"Late\", [list])\nlist = List([])"

func liveBlockArgs(block int) json.RawMessage {
	raw, _ := json.Marshal(map[string]any{"docId": "doc_1", "words": "overdue tasks", "block": block})
	return raw
}

// The AI takes a while to write a block; an edit saved meanwhile stays.
func TestLiveBlockKeepsEditsMadeWhileTheAIAnswers(t *testing.T) {
	docs := &liveDocs{d: &models.Document{ID: "doc_1", Title: "Plan"}}
	docs.set("v1")
	tools := NewCatalog(Deps{Docs: docs, LiveBlock: func(context.Context, string, string, string, string) (string, error) {
		docs.set("v1\n\nv2 edited while the AI answered")
		return liveTestProgram, nil
	}})
	if _, err := tools["add_live_block"].Call(context.Background(), "usr_1", liveBlockArgs(0)); err != nil {
		t.Fatal(err)
	}
	got := docs.markdown()
	if !strings.Contains(got, "v2 edited while the AI answered") || !strings.Contains(got, `Panel("Late"`) {
		t.Fatalf("the block is added to the doc as edited meanwhile:\n%s", got)
	}

	// Changing a block keeps edits elsewhere in the doc too.
	tools = NewCatalog(Deps{Docs: docs, LiveBlock: func(_ context.Context, _, _, current, _ string) (string, error) {
		docs.set(strings.Replace(docs.markdown(), "v1", "v1 edited again", 1))
		return strings.Replace(current, `"Late"`, `"Late work"`, 1), nil
	}})
	if _, err := tools["add_live_block"].Call(context.Background(), "usr_1", liveBlockArgs(1)); err != nil {
		t.Fatal(err)
	}
	got = docs.markdown()
	if !strings.Contains(got, "v1 edited again") || !strings.Contains(got, `Panel("Late work"`) || strings.Count(got, "```openui-lang") != 1 {
		t.Fatalf("block 1 is changed in the doc as edited meanwhile:\n%s", got)
	}
}

// A block edited while the AI rewrote it is not overwritten.
func TestLiveBlockRefusesABlockChangedWhileTheAIAnswers(t *testing.T) {
	docs := &liveDocs{d: &models.Document{ID: "doc_1", Title: "Plan"}}
	docs.set("Intro.\n\n```openui-lang\n" + liveTestProgram + "\n```")
	tools := NewCatalog(Deps{Docs: docs, LiveBlock: func(context.Context, string, string, string, string) (string, error) {
		docs.set("Intro.\n\n```openui-lang\nroot = Panel(\"Edited by hand\", [])\n```")
		return `root = Panel("From the AI", [])`, nil
	}})
	_, err := tools["add_live_block"].Call(context.Background(), "usr_1", liveBlockArgs(1))
	if err == nil || !strings.Contains(err.Error(), "changed while") {
		t.Fatalf("the change is refused: %v", err)
	}
	if got := docs.markdown(); docs.updates != 0 || !strings.Contains(got, "Edited by hand") {
		t.Fatalf("nothing is written:\n%s", got)
	}
}

// The chat agent asks for the program in Prepare, outside its transaction;
// the write then asks nothing and still uses the doc as it is by then.
func TestLiveBlockPrepareAsksOnceBeforeTheWrite(t *testing.T) {
	docs := &liveDocs{d: &models.Document{ID: "doc_1", Title: "Plan"}}
	docs.set("v1")
	asked := 0
	tools := NewCatalog(Deps{Docs: docs, LiveBlock: func(context.Context, string, string, string, string) (string, error) {
		asked++
		return liveTestProgram, nil
	}})
	tool := tools["add_live_block"]
	if tool.Prepare == nil || !Prepares("add_live_block") || Prepares("append_to_doc") {
		t.Fatal("only add_live_block has a Prepare step")
	}
	ctx, err := tool.Prepare(context.Background(), "usr_1", liveBlockArgs(0))
	if err != nil || asked != 1 || docs.updates != 0 {
		t.Fatalf("Prepare asks the AI once and writes nothing: %v asked=%d updates=%d", err, asked, docs.updates)
	}

	// Stopped after the AI answered: nothing is written.
	stopped, stop := context.WithCancel(ctx)
	stop()
	if _, err := tool.Call(stopped, "usr_1", liveBlockArgs(0)); !errors.Is(err, context.Canceled) || docs.updates != 0 {
		t.Fatalf("a stopped write saves nothing: %v updates=%d", err, docs.updates)
	}

	docs.set("v1\n\nv2")
	if _, err := tool.Call(ctx, "usr_1", liveBlockArgs(0)); err != nil {
		t.Fatal(err)
	}
	if got := docs.markdown(); asked != 1 || !strings.Contains(got, "v2") || !strings.Contains(got, `Panel("Late"`) {
		t.Fatalf("the write uses the prepared program on the latest doc: asked=%d\n%s", asked, got)
	}

	// A program prepared for other words is not used for these.
	other, _ := json.Marshal(map[string]any{"docId": "doc_1", "words": "done this week"})
	if _, err := tool.Call(ctx, "usr_1", other); err != nil || asked != 2 {
		t.Fatalf("other words are asked for: %v asked=%d", err, asked)
	}
}
