package chat

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"timely-api/internal/features/agent"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
)

func TestProposalAcceptsStringEncodedStepsAndArguments(t *testing.T) {
	catalog := agent.Catalog{"create_task": {Call: func(context.Context, string, json.RawMessage) (any, error) { return nil, nil }}}
	steps := `[{"tool":"create_task","summary":"Create Read","arguments":"{\"name\":\"Read\"}"}]`
	args := raw(map[string]any{"summary": "Create a task", "direct": "true", "steps": steps})
	p, _, err := (&Service{}).prepareProposal(context.Background(), catalog, "user", args, nil)
	if err != nil {
		t.Fatal(err)
	}
	var input map[string]string
	if len(p.Steps) != 1 || !p.Direct || json.Unmarshal(p.Steps[0].Arguments, &input) != nil || input["name"] != "Read" {
		t.Fatalf("string-encoded proposal decoded wrongly: %+v", p)
	}
}

func TestProposalRejectsDataChangedSinceTheModelReadIt(t *testing.T) {
	current := "with next steps"
	catalog := agent.Catalog{
		"get_doc": {Call: func(context.Context, string, json.RawMessage) (any, error) {
			return map[string]string{"markdown": current}, nil
		}},
		"update_doc": {Call: func(context.Context, string, json.RawMessage) (any, error) { return nil, nil }},
	}
	key, ok := snapshotRead("get_doc", json.RawMessage(`{"docId":"doc_1"}`))
	if !ok {
		t.Fatal("plain get_doc read was not tracked")
	}
	reads := map[string]string{key: hash(map[string]string{"markdown": "before the append"})}
	args := raw(map[string]any{"summary": "Shorten", "direct": false, "steps": []any{map[string]any{"tool": "update_doc", "summary": "Shorten", "arguments": map[string]any{"docId": "doc_1", "markdown": "short"}}}})
	if _, _, err := (&Service{}).prepareProposal(context.Background(), catalog, "user", args, reads); err == nil || !strings.Contains(err.Error(), "changed after you read it") {
		t.Fatalf("overwrote a concurrent edit: %v", err)
	}
	reads[key] = hash(map[string]string{"markdown": current})
	if _, _, err := (&Service{}).prepareProposal(context.Background(), catalog, "user", args, reads); err != nil {
		t.Fatalf("unchanged data rejected: %v", err)
	}
	if _, ok := snapshotRead("get_doc", json.RawMessage(`{"docId":"doc_1","extra":true}`)); ok {
		t.Fatal("reads with other arguments must not stand in for the snapshot")
	}
	if full, ok := snapshotRead("get_doc", json.RawMessage(`{"docId":"doc_1","full":true}`)); !ok || full != key {
		t.Fatal("a full get_doc read is the same snapshot as a plain one")
	}
	if _, ok := snapshotRead("get_doc", json.RawMessage(`{"docId":"doc_1","focus":"budget"}`)); ok {
		t.Fatal("a focused read may leave sections out")
	}
}

func TestProposalRejectsADocEditedAfterAFocusedRead(t *testing.T) {
	current := "# Handbook\n\n## Travel\n\nFlights\n\n## Budget\n\nOld budget"
	plainReads := 0
	catalog := agent.Catalog{
		"get_doc": {Call: func(_ context.Context, _ string, args json.RawMessage) (any, error) {
			var in map[string]any
			_ = json.Unmarshal(args, &in)
			if in["focus"] != nil {
				// A focused read shows only part of the doc.
				return map[string]string{"markdown": "## Travel\n\nFlights\n\n[section kept out doc_1#000000000000: Budget, 3 lines]"}, nil
			}
			plainReads++
			return map[string]string{"markdown": current}, nil
		}},
		"update_doc": {Call: func(context.Context, string, json.RawMessage) (any, error) { return nil, nil }},
	}
	reads := map[string]string{}
	focused := json.RawMessage(`{"docId":"doc_1","focus":"flights"}`)
	result, _ := catalog["get_doc"].Call(context.Background(), "user", focused)
	recordRead(context.Background(), catalog, "user", "get_doc", focused, result, reads)
	if plainReads != 1 || len(reads) != 1 {
		t.Fatalf("a focused read must record the plain doc: %d reads, %v", plainReads, reads)
	}
	args := raw(map[string]any{"summary": "Edit travel", "direct": false, "steps": []any{map[string]any{"tool": "update_doc", "summary": "Edit travel", "arguments": map[string]any{"docId": "doc_1", "markdown": "## Travel\n\nTrains"}}}})
	if _, _, err := (&Service{}).prepareProposal(context.Background(), catalog, "user", args, reads); err != nil {
		t.Fatalf("unchanged doc rejected: %v", err)
	}
	// Someone edits the doc after the focused read.
	current = strings.Replace(current, "Old budget", "New budget", 1)
	if _, _, err := (&Service{}).prepareProposal(context.Background(), catalog, "user", args, reads); err == nil || !strings.Contains(err.Error(), "changed after you read it") {
		t.Fatalf("a focused read let the proposal overwrite a newer edit: %v", err)
	}
	// full=true with a focus is recorded the same way; other reads are not.
	for _, call := range []struct {
		tool, args string
		want       bool
	}{
		{"get_doc", `{"docId":"doc_1","focus":"budget","full":true}`, true},
		{"get_doc", `{"docId":"doc_1","focus":"budget","extra":1}`, false},
		{"get_doc", `{"focus":"budget"}`, false},
		{"get_task", `{"taskId":"t","focus":"x"}`, false},
	} {
		if _, ok := focusedDocRead(call.tool, json.RawMessage(call.args)); ok != call.want {
			t.Fatalf("focusedDocRead(%s %s) = %v", call.tool, call.args, ok)
		}
	}
}

func TestProposalShowsKeptOutSectionsInFull(t *testing.T) {
	doc := "# Handbook\n\nIntro\n\n## Travel\n\nFlights\n\n## Budget\n\nThe budget is 500.\n"
	budget := "## Budget\n\nThe budget is 500.\n"
	sum := sha256.Sum256([]byte(budget))
	placeholder := fmt.Sprintf("[section kept out doc_1#%s: Budget, 3 lines; call get_doc with full=true to read it]", hex.EncodeToString(sum[:])[:12])
	catalog := agent.Catalog{
		"get_doc": {Call: func(context.Context, string, json.RawMessage) (any, error) {
			return map[string]any{"markdown": doc}, nil
		}},
		"update_doc":    {Call: func(context.Context, string, json.RawMessage) (any, error) { return nil, nil }},
		"append_to_doc": {Call: func(context.Context, string, json.RawMessage) (any, error) { return nil, nil }},
		"create_doc":    {Call: func(context.Context, string, json.RawMessage) (any, error) { return nil, nil }},
	}
	for _, tool := range []string{"update_doc", "append_to_doc", "create_doc"} {
		arguments := map[string]any{"markdown": "## Travel\n\nTrains\n\n" + placeholder}
		if tool == "create_doc" {
			arguments["title"] = "Copy"
		} else {
			arguments["docId"] = "doc_1"
		}
		args := raw(map[string]any{"summary": "Edit", "direct": false, "steps": []any{map[string]any{"tool": tool, "summary": "Edit", "arguments": arguments}}})
		p, _, err := (&Service{}).prepareProposal(context.Background(), catalog, "user", args, nil)
		if err != nil {
			t.Fatalf("%s: %v", tool, err)
		}
		var in map[string]any
		_ = json.Unmarshal(p.Steps[0].Arguments, &in)
		markdown, _ := in["markdown"].(string)
		if strings.Contains(markdown, "section kept out") || !strings.Contains(markdown, "The budget is 500.") || !strings.Contains(markdown, "Trains") {
			t.Fatalf("%s: review shows a placeholder:\n%s", tool, markdown)
		}
	}
	// A reformatted placeholder sends the model back instead of saving a stub.
	args := raw(map[string]any{"summary": "Edit", "direct": false, "steps": []any{map[string]any{"tool": "update_doc", "summary": "Edit", "arguments": map[string]any{"docId": "doc_1", "markdown": "- " + placeholder}}}})
	if _, _, err := (&Service{}).prepareProposal(context.Background(), catalog, "user", args, nil); err == nil || !strings.Contains(err.Error(), "exactly as get_doc returned it") {
		t.Fatalf("reformatted placeholder accepted: %v", err)
	}
}

func TestLocalizeTimesUsesOneZoneAndKeepsTheInstant(t *testing.T) {
	tokyo, _ := time.LoadLocation("Asia/Tokyo")
	in := map[string]any{
		"start":   "2026-10-06T15:00:00Z",
		"end":     "2026-10-07T01:00:00+09:00",
		"created": "2026-10-02T11:50:34.123456Z",
		"id":      "evt_1@2026-10-06T10:00:00Z",
		"date":    "2026-10-30",
		"count":   json.Number("3"),
		"items":   []any{map[string]any{"at": "2026-10-06T10:00:00Z"}},
	}
	out := localizeTimes(in, tokyo).(map[string]any)
	if out["start"] != "2026-10-07T00:00:00+09:00" || out["end"] != "2026-10-07T01:00:00+09:00" {
		t.Fatalf("times not localized: %v %v", out["start"], out["end"])
	}
	created, _ := time.Parse(time.RFC3339Nano, out["created"].(string))
	if !created.Equal(time.Date(2026, 10, 2, 11, 50, 34, 123456000, time.UTC)) {
		t.Fatal("instant changed")
	}
	if out["id"] != "evt_1@2026-10-06T10:00:00Z" || out["date"] != "2026-10-30" || fmt.Sprint(out["count"]) != "3" {
		t.Fatalf("non-time values changed: %v", out)
	}
	if out["items"].([]any)[0].(map[string]any)["at"] != "2026-10-06T19:00:00+09:00" {
		t.Fatal("nested times not localized")
	}
}

func TestTimeContextListsWeekdaysInThePersonsZone(t *testing.T) {
	tokyo, _ := time.LoadLocation("Asia/Tokyo")
	now := time.Date(2026, 10, 2, 11, 47, 0, 0, time.UTC) // 20:47 Friday in Tokyo
	text := timeContext(now, tokyo, "device")
	for _, want := range []string{"Asia/Tokyo (from their device", "Friday, 2026-10-02 20:47", "Sat 2026-10-03", "Thu 2026-10-08", "Saturday 2026-10-31"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q in %s", want, text)
		}
	}
	// Late evening UTC is already the next day in Tokyo.
	if text := timeContext(time.Date(2026, 10, 2, 20, 0, 0, 0, time.UTC), tokyo, "saved"); !strings.Contains(text, "Saturday, 2026-10-03") {
		t.Fatalf("local date not used: %s", text)
	}
	if text := timeContext(now, time.UTC, "default"); !strings.Contains(text, "unknown") {
		t.Fatal("unknown zone not disclosed")
	}
}

func TestApplyRetriesSerializationFailures(t *testing.T) {
	calls := 0
	err := retrySerializable(context.Background(), func() error {
		calls++
		if calls < 3 {
			return &pgconn.PgError{Code: "40001"}
		}
		return nil
	})
	if err != nil || calls != 3 {
		t.Fatalf("calls=%d err=%v", calls, err)
	}
	calls = 0
	other := errors.New("task has no workspace for labels")
	if err := retrySerializable(context.Background(), func() error { calls++; return other }); !errors.Is(err, other) || calls != 1 {
		t.Fatal("non-serialization errors must not be retried")
	}
	calls = 0
	err = retrySerializable(context.Background(), func() error { calls++; return fmt.Errorf("ERROR: could not serialize access (SQLSTATE 40001)") })
	if calls != 5 || err == nil || strings.Contains(err.Error(), "SQLSTATE") {
		t.Fatalf("persistent conflict: calls=%d err=%v", calls, err)
	}
}

// scripted plays back model responses and records what each call received.
type scripted struct {
	mu        sync.Mutex
	responses []WireMessage
	seen      [][]WireMessage
}

func (s *scripted) Complete(_ context.Context, messages []WireMessage, _ []any, _ bool) (WireMessage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seen = append(s.seen, append([]WireMessage{}, messages...))
	if len(s.responses) == 0 {
		return WireMessage{}, errors.New("script exhausted")
	}
	next := s.responses[0]
	s.responses = s.responses[1:]
	return next, nil
}

func call(name string, args any) WireMessage {
	var tc ToolCall
	tc.ID, tc.Type = "call_"+name, "function"
	tc.Function.Name, tc.Function.Arguments = name, string(raw(args))
	return WireMessage{Role: "assistant", ToolCalls: []ToolCall{tc}}
}

func planFixture(t *testing.T, db *gorm.DB) Conversation {
	t.Helper()
	c := runFixture(t, db, nil)
	c.Phase = "plan"
	c.Messages = []Message{message("user", "Capture: start a podcast")}
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	return c
}

func TestIntegrationEmptyReplyIsRetriedAndDirectWritesAreRedirected(t *testing.T) {
	db := integrationDB(t)
	model := &scripted{responses: []WireMessage{
		{Role: "assistant"},
		call("capture_inbox_item", map[string]string{"name": "Start a podcast"}),
		{Role: "assistant", Content: "Proposed."},
	}}
	s := New(db, func(*gorm.DB) agent.Catalog {
		return agent.Catalog{"capture_inbox_item": {Call: func(context.Context, string, json.RawMessage) (any, error) {
			t.Fatal("a write tool ran without a proposal")
			return nil, nil
		}}}
	}, model)
	c := planFixture(t, db)
	if err := s.plan(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	if c.Status != "idle" || c.Messages[len(c.Messages)-1].Content != "Proposed." {
		t.Fatalf("run did not finish with the reply: %s %+v", c.Status, c.Messages)
	}
	if last := model.seen[1][len(model.seen[1])-1]; !strings.Contains(last.Content, "your last reply was empty") {
		t.Fatalf("empty reply was not nudged: %+v", last)
	}
	if last := model.seen[2][len(model.seen[2])-1]; last.Role != "tool" || !strings.Contains(last.Content, "never called directly") || !strings.Contains(last.Content, "propose_changes") {
		t.Fatalf("direct write was not redirected to a proposal: %+v", last)
	}
}

func TestIntegrationRehearsalReportsTheFailingStepAndRollsBack(t *testing.T) {
	db := integrationDB(t)
	s := New(db, nil, nil)
	s.SetRehearsal(func(tx *gorm.DB) agent.Catalog {
		return agent.Catalog{
			"get_task": {Call: func(context.Context, string, json.RawMessage) (any, error) {
				return map[string]string{"id": "tsk_1"}, nil
			}},
			"create_label": {Call: func(context.Context, string, json.RawMessage) (any, error) {
				item := testItem{ID: id("label_"), Value: "errand"}
				return map[string]string{"id": item.ID}, tx.Create(&item).Error
			}},
			"set_task_labels": {Call: func(context.Context, string, json.RawMessage) (any, error) {
				return nil, errors.New("task has no workspace for labels")
			}},
		}
	})
	steps := []Step{
		{Tool: "create_label", Summary: "Create errand", Arguments: raw(map[string]string{"name": "errand"})},
		{Tool: "set_task_labels", Summary: "Tag reminder", Arguments: raw(map[string]any{"taskId": "tsk_1", "labelIds": []string{"$0.id"}})},
	}
	err := s.rehearse(context.Background(), "user-a", steps)
	if err == nil || !strings.Contains(err.Error(), "Step 2 (set_task_labels) would fail: task has no workspace for labels") {
		t.Fatalf("rehearsal error: %v", err)
	}
	var count int64
	db.Model(&testItem{}).Count(&count)
	if count != 0 {
		t.Fatalf("rehearsal wrote %d rows", count)
	}
	if steps[0].Status != "" || steps[0].Result != nil {
		t.Fatal("rehearsal changed the proposal's steps")
	}
}

func TestIntegrationDeviceTimezoneReachesTools(t *testing.T) {
	db := integrationDB(t)
	var seen string
	model := &scripted{responses: []WireMessage{call("get_context", map[string]any{}), {Role: "assistant", Content: "Done."}}}
	s := New(db, func(*gorm.DB) agent.Catalog {
		return agent.Catalog{"get_context": {Call: func(ctx context.Context, _ string, _ json.RawMessage) (any, error) {
			seen = agent.TimezoneFrom(ctx)
			return map[string]string{"now": "2026-10-02T11:47:00Z"}, nil
		}}}
	}, model)
	c := planFixture(t, db)
	c.Timezone = "Asia/Tokyo"
	db.Save(&c)
	if err := s.plan(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	if seen != "Asia/Tokyo" {
		t.Fatalf("tool saw timezone %q", seen)
	}
	if !strings.Contains(model.seen[0][0].Content, "Asia/Tokyo (from their device") {
		t.Fatal("system prompt lacks the device timezone")
	}
	if tool := model.seen[1][len(model.seen[1])-1]; !strings.Contains(tool.Content, "2026-10-02T20:47:00+09:00") {
		t.Fatalf("tool result not localized: %s", tool.Content)
	}
}

func TestLanguageDetectionAndTranslatedNotices(t *testing.T) {
	for text, want := range map[string]string{
		"明日の午後3時に歯医者のリマインダーを設定して":   "ja",
		"帮我把这个任务标记为完成":              "zh",
		"내일 회의를 잡아줘":                "ko",
		"Удали задачу про отчёт":    "ru",
		"Add a task for Monday":     "latin",
		"Marca la tarea como hecha": "latin",
		"Timelyで iPhone のタスクを作って":   "ja",
		"12:30": "",
	} {
		if got := detectLanguage(text); got != want {
			t.Errorf("%q detected as %q, want %q", text, got, want)
		}
	}
	c := Conversation{}
	noteLanguage(&c, "明日の予定は？")
	if c.Language != "ja" || tr(c.Language, txtDone) != "完了しました。変更は保存されています。" {
		t.Fatalf("Japanese conversation: %q", c.Language)
	}
	noteLanguage(&c, "Thanks, now in English please")
	if c.Language != "en" {
		t.Fatalf("switch back to a Latin script kept %q", c.Language)
	}
	c.Language = supportedLanguage("es-MX")
	noteLanguage(&c, "Gracias")
	if c.Language != "es" || tr("es", txtStopped) != "Detenido. Los cambios completados se conservan." {
		t.Fatalf("declared Spanish was not kept: %q", c.Language)
	}
	if supportedLanguage("tlh") != "" || tr("tlh", txtDone) != "Done — your changes are saved." {
		t.Fatal("unsupported languages must fall back to English")
	}
	for language, table := range texts {
		for key := range texts["en"] {
			if table[key] == "" {
				t.Errorf("%s lacks %s", language, key)
			}
		}
	}
}

func TestPendingBatchContinuesOnlyTheLatestProposal(t *testing.T) {
	user := message("user", "Create 40 tasks")
	first := message("assistant", "Batch 1")
	first.Proposal, first.Remaining = true, "chapters 31-40"
	more := notice("continuing")
	more.Continue = "chapters 31-40"
	last := message("assistant", "Batch 2")
	last.Proposal = true
	c := Conversation{Messages: []Message{user, first}}
	if pendingBatch(&c) != "chapters 31-40" {
		t.Fatal("first batch did not continue")
	}
	c.Messages = []Message{user, first, more, last}
	if got := pendingBatch(&c); got != "" {
		t.Fatalf("finished request continued with %q", got)
	}
	c.Messages = []Message{user}
	for i := 0; i < maxBatches; i++ {
		p := message("assistant", "batch")
		p.Proposal, p.Remaining = true, "more"
		n := notice("continuing")
		n.Continue = "more"
		c.Messages = append(c.Messages, p, n)
	}
	if pendingBatch(&c) != "" {
		t.Fatal("continuation is unbounded")
	}
}

func TestReviewedChangesShowCurrentState(t *testing.T) {
	catalog := agent.Catalog{"undo_schedule_preview": {Call: func(context.Context, string, json.RawMessage) (any, error) {
		return map[string]any{"canUndo": true}, nil
	}}}
	steps := []Step{{Tool: "undo_schedule", Arguments: raw(map[string]string{})}}
	snaps, err := (&Service{}).snapshots(context.Background(), nil, catalog, "user", steps)
	if err != nil || len(snaps) != 1 || !strings.Contains(string(steps[0].Before), "canUndo") {
		t.Fatalf("undo review lacks the blocks it restores: %v %s", err, steps[0].Before)
	}
	if !needsApproval(steps, true) {
		t.Fatal("undoing the schedule must be reviewed")
	}
}

func TestIntegrationBatchedProposalContinuesAndRepliesToTheQuestion(t *testing.T) {
	db := integrationDB(t)
	model := &scripted{responses: []WireMessage{call("propose_changes", map[string]any{
		"summary": "Create Read chapter 1", "direct": true, "language": "ja",
		"reply": "Tomorrow is Saturday, October 3.", "remaining": "Read chapter 2",
		"steps": []any{map[string]any{"tool": "create_task", "summary": "Create chapter 1", "arguments": map[string]any{"name": "Read chapter 1"}}},
	})}}
	created := 0
	s := New(db, func(*gorm.DB) agent.Catalog {
		return agent.Catalog{"create_task": {Call: func(context.Context, string, json.RawMessage) (any, error) {
			created++
			return map[string]any{"task": map[string]string{"id": "tsk_" + fmt.Sprint(created)}}, nil
		}}}
	}, model)
	c := planFixture(t, db)
	if err := s.plan(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	if c.Language != "ja" || c.Messages[len(c.Messages)-1].Content != "Tomorrow is Saturday, October 3." {
		t.Fatalf("reply or language missing: %q %+v", c.Language, c.Messages)
	}
	c.Status = "running"
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.apply(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	last := c.Messages[len(c.Messages)-1]
	if created != 1 || c.Status != "queued" || c.Phase != "plan" || last.Continue != "Read chapter 2" || last.Content != tr("ja", txtContinuing) {
		t.Fatalf("batch did not continue: status=%s phase=%s last=%+v", c.Status, c.Phase, last)
	}
	model.responses = []WireMessage{{Role: "assistant", Content: "All done."}}
	c.Status = "running"
	if err := db.Save(&c).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.plan(context.Background(), &c); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, m := range model.seen[1] {
		found = found || strings.Contains(m.Content, "Remaining: Read chapter 2")
	}
	if !found {
		t.Fatal("next batch was not told what remains")
	}
}

func TestFullProposalMustSayWhatRemains(t *testing.T) {
	catalog := agent.Catalog{"create_task": {Call: func(context.Context, string, json.RawMessage) (any, error) { return nil, nil }}}
	steps := []any{}
	for i := 0; i < 30; i++ {
		steps = append(steps, map[string]any{"tool": "create_task", "summary": "Create", "arguments": map[string]any{"name": fmt.Sprint(i)}})
	}
	propose := func(remaining string) (proposal, error) {
		p, _, err := (&Service{}).prepareProposal(context.Background(), catalog, "user", raw(map[string]any{"summary": "Batch", "direct": false, "steps": steps, "remaining": remaining}), nil)
		return p, err
	}
	if _, err := propose(""); err == nil || !strings.Contains(err.Error(), "maximum 30 changes") {
		t.Fatalf("a full batch without remaining was accepted: %v", err)
	}
	if p, err := propose("none"); err != nil || p.Remaining != "" {
		t.Fatalf("complete batch: %v %q", err, p.Remaining)
	}
	if p, _, err := (&Service{}).prepareProposal(context.Background(), catalog, "user", raw(map[string]any{"summary": " ", "direct": true, "steps": steps[:2]}), nil); err != nil || p.Summary != "Create Create" {
		t.Fatalf("empty summary not filled from steps: %q %v", p.Summary, err)
	}
	if p, err := propose("Workout days 31-35"); err != nil || p.Remaining != "Workout days 31-35" {
		t.Fatalf("partial batch: %v %q", err, p.Remaining)
	}
}

// With no saved Working hours and no device zone, the run carries no timezone,
// so tools fall through to the server-local fallback of task.DayLocation
// instead of an explicit UTC.
func TestZonedLeavesTimezoneEmptyWithoutSavedOrDeviceZone(t *testing.T) {
	s := &Service{}
	ctx, loc, source := s.zoned(context.Background(), &Conversation{})
	if got := agent.TimezoneFrom(ctx); got != "" || source != "default" || loc != time.Local {
		t.Fatalf("zone=%q source=%s loc=%v, want no zone, default, the server's zone", got, source, loc)
	}
	ctx, loc, source = s.zoned(context.Background(), &Conversation{Timezone: "Asia/Tokyo"})
	if got := agent.TimezoneFrom(ctx); got != "Asia/Tokyo" || source != "device" || loc.String() != "Asia/Tokyo" {
		t.Fatalf("zone=%q source=%s loc=%v, want the device zone", got, source, loc)
	}
}
