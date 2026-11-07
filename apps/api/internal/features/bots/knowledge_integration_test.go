package bots

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	"timely-api/internal/models"
)

// workspace gives userID a workspace for docs and sheets, once.
func knowledgeWorkspace(e *engine, userID string) string {
	e.t.Helper()
	id := "ws_" + userID
	var n int64
	must(e.t, e.db.Model(&models.Workspace{}).Where("id = ?", id).Count(&n).Error)
	if n == 0 {
		must(e.t, e.db.Create(&models.Workspace{ID: id, Name: "Home", UserID: &userID}).Error)
	}
	return id
}

// doc saves a doc for userID whose words start with a properties block.
func (e *engine) doc(userID, id, title, props, body string) {
	e.t.Helper()
	content := models.JSONMap{"type": "doc", "content": []any{
		map[string]any{"type": "frontmatter", "content": []any{map[string]any{"type": "text", "text": props}}},
		map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": body}}},
	}}
	must(e.t, e.db.Create(&models.Document{ID: id, Title: title, Content: content, PlainText: props + "\n" + body,
		WorkspaceID: knowledgeWorkspace(e, userID), UserID: userID}).Error)
}

// sheet saves a one-tab sheet for userID: columns by name, rows of cells
// in column order.
func (e *engine) sheet(userID, id, title string, columns []string, rows ...[]string) {
	e.t.Helper()
	cols := make(models.SheetColumns, len(columns))
	for i, name := range columns {
		cols[i] = models.SheetColumn{ID: fmt.Sprintf("c%d", i), Name: name, Width: 100, Type: "text"}
	}
	var rs models.SheetRows
	for i, r := range rows {
		cells := map[string]string{}
		for j, v := range r {
			cells[fmt.Sprintf("c%d", j)] = v
		}
		rs = append(rs, models.SheetRow{ID: fmt.Sprintf("r%d", i), Cells: cells})
	}
	must(e.t, e.db.Create(&models.Sheet{ID: id, Title: title, Columns: cols, Rows: rs, Merges: models.SheetMerges{}, Tabs: models.SheetTabs{},
		WorkspaceID: knowledgeWorkspace(e, userID), UserID: userID}).Error)
}

func inputErr(t *testing.T, err error, want string) {
	t.Helper()
	var bad *InputError
	if !errors.As(err, &bad) || bad.Message != want {
		t.Fatalf("want %q, got %v", want, err)
	}
}

// A Bot names one of the person's docs or sheets by id: it is checked on
// save, shown by title, cleared by a PATCH's null and left alone when the
// PATCH leaves it out. Another account's doc, one in the bin and outside
// apps are refused.
func TestIntegrationBotKnowledgeSaves(t *testing.T) {
	e := newEngine(t)
	ctx := context.Background()
	e.doc(e.user, "doc_gifts", "Gift ideas", "status: open", "A good pen")
	e.sheet(e.user, "sht_wish", "Wishlist", []string{"Item", "Most I'll pay"}, []string{"SSD 2TB", "80"})
	other := addUser(t, e.db)
	e.doc(other, "doc_theirs", "Theirs", "", "Not yours")
	e.doc(e.user, "doc_binned", "Binned", "", "Old")
	must(t, e.db.Exec(`UPDATE documents SET archived_at = '2026-11-01T00:00:00Z' WHERE id = 'doc_binned'`).Error)

	in := pageInput("Gifts", "https://example.com/gifts")
	in.JudgeMode = JudgeAI
	in.Knowledge = &KnowledgeInput{Kind: "doc", ID: "doc_gifts"}
	v := e.create(in)
	if v.Knowledge == nil || *v.Knowledge != (KnowledgeView{Kind: "doc", ID: "doc_gifts", Title: "Gift ideas"}) {
		t.Fatalf("created with %+v", v.Knowledge)
	}
	if b := e.bot(v.ID); b.KnowledgeKind != "doc" || b.KnowledgeID != "doc_gifts" {
		t.Fatalf("saved %q %q", b.KnowledgeKind, b.KnowledgeID)
	}

	for _, c := range []struct {
		in   KnowledgeInput
		want string
	}{
		{KnowledgeInput{Kind: "doc", ID: "doc_theirs"}, "That doc or sheet is not in Timely any more"},
		{KnowledgeInput{Kind: "doc", ID: "doc_binned"}, "That doc or sheet is not in Timely any more"},
		{KnowledgeInput{Kind: "sheet", ID: "doc_gifts"}, "That doc or sheet is not in Timely any more"},
		{KnowledgeInput{Kind: "task", ID: "doc_gifts"}, "Pick a doc or a sheet"},
		{KnowledgeInput{Kind: "doc"}, "Pick a doc or a sheet"},
	} {
		_, err := e.s.Update(ctx, e.user, v.ID, Patch{Knowledge: &c.in}, OriginApp)
		inputErr(t, err, c.want)
		bad := pageInput(fmt.Sprintf("Refused %s %s", c.in.Kind, c.in.ID), "https://example.com/r")
		bad.Knowledge = &c.in
		_, err = e.s.Create(ctx, e.user, bad, OriginApp)
		inputErr(t, err, c.want)
	}

	path := "/bots/" + v.ID
	code, out := call(t, e.s, e.user, http.MethodPatch, path, map[string]any{"knowledge": map[string]any{"kind": "sheet", "id": "sht_wish"}})
	if k, _ := out["knowledge"].(map[string]any); code != http.StatusOK || k["kind"] != "sheet" || k["title"] != "Wishlist" || k["missing"] != false {
		t.Fatalf("PATCH sheet: %d %v", code, out)
	}
	code, out = call(t, e.s, e.user, http.MethodPatch, path, map[string]any{"description": "Under my limit"})
	if k, _ := out["knowledge"].(map[string]any); code != http.StatusOK || k["id"] != "sht_wish" {
		t.Fatalf("a PATCH without knowledge changed it: %d %v", code, out)
	}
	code, out = call(t, e.s, e.user, http.MethodPatch, path, map[string]any{"knowledge": "sheet"})
	if code != http.StatusBadRequest || out["message"] != "Pick a doc or a sheet" {
		t.Fatalf("PATCH with a bad knowledge: %d %v", code, out)
	}
	code, out = call(t, e.s, e.user, http.MethodPatch, path, map[string]any{"knowledge": nil})
	if code != http.StatusOK || out["knowledge"] != nil {
		t.Fatalf("PATCH null: %d %v", code, out)
	}
	if b := e.bot(v.ID); b.KnowledgeKind != "" || b.KnowledgeID != "" {
		t.Fatalf("cleared to %q %q", b.KnowledgeKind, b.KnowledgeID)
	}
	code, out = call(t, e.s, e.user, http.MethodGet, "/bots", nil)
	if bs, _ := out["bots"].([]any); code != http.StatusOK || len(bs) != 1 || bs[0].(map[string]any)["knowledge"] != nil {
		t.Fatalf("list: %d %v", code, out)
	}

	// Outside apps cannot add, change or clear what a judge reads.
	mcp := pageInput("From an app", "https://example.com/app")
	mcp.Knowledge = &KnowledgeInput{Kind: "doc", ID: "doc_gifts"}
	_, err := e.s.Create(ctx, e.user, mcp, OriginMCP)
	inputErr(t, err, "Judging, knowledge, links and briefs are set up in Timely")
	_, err = e.s.Store().Update(ctx, e.user, v.ID, Patch{Knowledge: &KnowledgeInput{Kind: "doc", ID: "doc_gifts"}}, OriginMCP, e.now)
	inputErr(t, err, "Judging, knowledge, links and briefs are set up in Timely")
	_, err = e.s.Store().Update(ctx, e.user, v.ID, Patch{ClearKnowledge: true}, OriginMCP, e.now)
	inputErr(t, err, "Judging, knowledge, links and briefs are set up in Timely")
}

// The judge reads the doc or sheet as data, each time it is called: a
// doc's words without its properties block, a sheet's first tab as
// tab-separated lines under its column names, clipped to 2,000 characters.
// A rules Bot never reads it, and one that is gone, in the bin or not the
// person's is shown missing and left out.
func TestIntegrationBotKnowledgeReachesTheJudge(t *testing.T) {
	e := newEngine(t)
	fj := &fakeJudge{}
	e.s.SetJudge(fj)
	fj.set(Verdict{Alert: true, Title: "Under your limit", Why: "Below 80", Urgency: UrgencyHigh}, nil)
	var reads atomic.Int64
	e.s.knowledgeRead = func(Bot) { reads.Add(1) }
	e.doc(e.user, "doc_rules", "Buying rules", "status: active", "Only buy SSDs under 80 dollars")
	e.sheet(e.user, "sht_wish", "Wishlist", []string{"Item", "Most I'll pay", "Note"},
		[]string{"SSD 2TB", "80", "line\tone"}, []string{"", "", ""}, []string{"Monitor", "=B1*2"})
	amount := "100.00"
	e.coinbase(&amount)
	move := Rule{Kind: RuleMovePct, Percent: f64(1), Direction: DirAny}

	// A rules Bot with knowledge never reads it.
	rules := btcBot("Rules reader", move)
	rules.Knowledge = &KnowledgeInput{Kind: "doc", ID: "doc_rules"}
	rv := e.create(rules)
	must(t, e.run(rv.ID))
	amount = "102.00"
	e.again(rv.ID)
	if c := e.lastCheck(rv.ID); c.Outcome != outFired || reads.Load() != 0 || len(fj.calls()) != 0 {
		t.Fatalf("a rules bot: outcome %s, %d reads, %d judge calls", c.Outcome, reads.Load(), len(fj.calls()))
	}

	ai := btcBot("Doc reader", move)
	ai.JudgeMode = JudgeAI
	ai.Knowledge = &KnowledgeInput{Kind: "doc", ID: "doc_rules"}
	v := e.create(ai)
	must(t, e.run(v.ID)) // baseline: nothing to judge, nothing read
	if reads.Load() != 0 {
		t.Fatal("a baseline read the knowledge")
	}
	amount = "104.50"
	e.again(v.ID)
	calls := fj.calls()
	if len(calls) != 1 || reads.Load() != 1 {
		t.Fatalf("%d judge calls, %d reads", len(calls), reads.Load())
	}
	if k := calls[0].Knowledge; k == nil || *k != (JudgeKnowledge{Kind: "doc", Title: "Buying rules", Text: "Only buy SSDs under 80 dollars"}) {
		t.Fatalf("doc knowledge %+v", k)
	}

	// The sheet: header, rows with something in them, worked-out values.
	_, err := e.s.Update(context.Background(), e.user, v.ID, Patch{Knowledge: &KnowledgeInput{Kind: "sheet", ID: "sht_wish"}}, OriginApp)
	must(t, err)
	amount = "110.00"
	e.again(v.ID)
	want := "Item\tMost I'll pay\tNote\nSSD 2TB\t80\tline one\nMonitor\t160"
	if k := fj.calls()[1].Knowledge; k == nil || k.Kind != "sheet" || k.Title != "Wishlist" || k.Text != want {
		t.Fatalf("sheet knowledge %+v", k)
	}

	// A long sheet is clipped to 2,000 characters.
	long := make([][]string, 150)
	for i := range long {
		long[i] = []string{fmt.Sprintf("Item %03d with a long name", i), "99"}
	}
	e.sheet(e.user, "sht_long", "Long", []string{"Item", "Price"}, long...)
	must(t, e.db.Exec(`UPDATE bots SET knowledge_kind = 'sheet', knowledge_id = 'sht_long' WHERE id = ?`, v.ID).Error)
	amount = "120.00"
	e.again(v.ID)
	k := fj.calls()[2].Knowledge
	if k == nil || utf8.RuneCountInString(k.Text) > maxKnowledgeText || !strings.HasPrefix(k.Text, "Item\tPrice\nItem 000") || !strings.HasSuffix(k.Text, "…") {
		t.Fatalf("long sheet: %d runes", utf8.RuneCountInString(k.Text))
	}

	// An unavailable judge keeps the input for the re-judge, without the
	// person's words or the knowledge: the re-judge reads both again from
	// the Bot as it is then. (A new day: the Bot has sent its 3 alerts.)
	e.now = e.now.Add(24 * time.Hour)
	fj.set(Verdict{}, errors.New("timeout"))
	amount = "130.00"
	e.again(v.ID)
	a := e.alertRow(e.lastCheck(v.ID).ID)
	var job JudgeJob
	if err := json.Unmarshal(a.AIInput, &job); err != nil {
		t.Fatalf("alert %+v: %v", a, err)
	}
	if job.Input.Knowledge != nil || job.Input.Description != "" || job.Input.Lessons != nil || len(job.Input.Changes) == 0 {
		t.Fatalf("stored input %+v", job.Input)
	}
	// Edited and its sheet put in the bin meanwhile: the re-judge sends the
	// new words and no sheet.
	must(t, e.db.Exec(`UPDATE bots SET description = 'Only real bargains now' WHERE id = ?`, v.ID).Error)
	must(t, e.db.Exec(`UPDATE sheets SET archived_at = now() WHERE id = 'sht_long'`).Error)
	fj.set(Verdict{Alert: true, Title: "x", Why: "y", Urgency: UrgencyNormal}, nil)
	must(t, e.s.HandleRejudge(context.Background(), e.rejudgeJob(a.ID)))
	if in := fj.calls()[len(fj.calls())-1]; in.Knowledge != nil || in.Description != "Only real bargains now" || len(in.Changes) == 0 {
		t.Fatalf("re-judge input %+v", in)
	}

	// Rewritten by SQL to another account's doc, it is not read, and the
	// Bot shows it missing.
	other := addUser(t, e.db)
	e.doc(other, "doc_theirs", "Their secrets", "", "Their private words")
	must(t, e.db.Exec(`UPDATE bots SET knowledge_kind = 'doc', knowledge_id = 'doc_theirs' WHERE id = ?`, v.ID).Error)
	amount = "140.00"
	e.again(v.ID)
	if n := len(fj.calls()); fj.calls()[n-1].Knowledge != nil {
		t.Fatalf("read another account's doc: %+v", fj.calls()[n-1].Knowledge)
	}
	d, err := e.s.Get(context.Background(), e.user, v.ID)
	must(t, err)
	if d.Knowledge == nil || !d.Knowledge.Missing || d.Knowledge.Title != "" {
		t.Fatalf("another account's doc shows %+v", d.Knowledge)
	}

	// In the bin, or deleted: missing, and the judge runs without it.
	must(t, e.db.Exec(`UPDATE bots SET knowledge_id = 'doc_rules' WHERE id = ?`, v.ID).Error)
	must(t, e.db.Exec(`UPDATE documents SET archived_at = '2026-11-05T00:00:00Z' WHERE id = 'doc_rules'`).Error)
	amount = "150.00"
	e.again(v.ID)
	n := len(fj.calls())
	if fj.calls()[n-1].Knowledge != nil {
		t.Fatal("read a doc in the bin")
	}
	if c := e.lastCheck(v.ID); c.Outcome != outFired {
		t.Fatalf("the judge did not run without its doc: %s", c.Outcome)
	}
	must(t, e.db.Exec(`DELETE FROM documents WHERE id = 'doc_rules'`).Error)
	amount = "160.00"
	e.again(v.ID)
	if len(fj.calls()) != n+1 || fj.calls()[n].Knowledge != nil {
		t.Fatal("a deleted doc was read, or the judge was not asked")
	}
	list, err := e.s.List(context.Background(), e.user)
	must(t, err)
	for _, b := range list.Bots {
		if b.ID == v.ID && (b.Knowledge == nil || !b.Knowledge.Missing || b.Knowledge.ID != "doc_rules") {
			t.Fatalf("a deleted doc shows %+v", b.Knowledge)
		}
	}
}
