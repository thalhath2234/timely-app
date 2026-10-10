package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"timely-api/internal/features/decide"
	"timely-api/internal/models"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Jev (ADR 0012) answers small typed questions about a run: what kind of
// request a message is, which earlier chat already covers it, and whether a
// proposal does what was asked. Its answers only narrow the tools offered,
// add hints the model may ignore, point at another chat, or add notes to a
// review (which can only make a review more likely, never skip one). With
// smart suggestions off, or in a sensitive chat, nothing is asked and runs
// behave exactly as before.

// Decider asks Jev; *decide.Service implements it.
type Decider interface {
	Ask(ctx context.Context, userID string, req decide.Request) (decide.Answers, error)
}

// SetDecisions turns on Jev triage and proposal checks for runs.
func (s *Service) SetDecisions(d Decider) { s.decisions = d }

// jevOn reports whether Jev can answer for the account, so work done only to
// ask it (reading sheets) is skipped when it is off. A Decider without
// Status (a test fake) counts as on.
func (s *Service) jevOn(ctx context.Context, userID string) bool {
	if s.decisions == nil {
		return false
	}
	if st, ok := s.decisions.(interface {
		Status(context.Context, string) (bool, string)
	}); ok {
		on, _ := st.Status(ctx, userID)
		return on
	}
	return true
}

const (
	// The run waits for triage before its first model call, so it is short;
	// on timeout the run continues exactly as it would without Jev.
	triageBudget = 1500 * time.Millisecond
	// Checks run once per proposal, while the person waits for it anyway.
	reviewBudget = 3 * time.Second
	maxSimilar   = 20
)

// ChatRef points at another conversation of the same person.
type ChatRef struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// Read tools are grouped by the kind of request that needs them. Every run
// keeps the essentials; a request Jev cannot place gets every tool.
var (
	essentialTools = []string{"get_context", "search", "semantic_search", "get_task", "get_project", "get_workspace", "list_workspaces", "list_projects"}
	areaTools      = map[string][]string{
		"tasks":         {"list_tasks", "pick_tasks", "list_inbox", "get_today", "what_next", "get_agenda", "get_calendar", "get_free_time", "list_habits", "list_goals", "list_task_views"},
		"calendar":      {"get_calendar", "list_events", "get_event", "get_free_time", "get_capacity", "get_agenda", "get_today", "get_working_hours", "get_schedule_settings", "auto_schedule_preview", "undo_schedule_preview", "list_tasks"},
		"docs":          {"list_docs", "get_doc"},
		"sheets":        {"list_sheets", "get_sheet", "list_sheet_templates", "get_sheet_template"},
		"projects":      {"list_tasks", "pick_tasks", "list_docs", "list_sheets", "list_task_views"},
		"notifications": {"list_notifications", "unread_notification_count", "get_notification_settings", "list_tasks"},
	}
	latinLanguages = []decide.Option{
		{Name: "en", Description: "English"}, {Name: "es", Description: "Spanish"}, {Name: "fr", Description: "French"},
		{Name: "de", Description: "German"}, {Name: "pt", Description: "Portuguese"}, {Name: "it", Description: "Italian"},
		{Name: "other", Description: "Another language"},
	}
)

// triage is what Jev made of the person's latest message. Empty fields mean
// Jev was unsure or not asked.
type triage struct {
	area     string // a key of areaTools
	change   *bool  // asks for a change rather than only a question
	web      bool   // needs public information from the web
	unclear  bool   // too ambiguous to act on without asking first
	scope    string // one, future or all occurrences of a repeating item
	meeting  string // prepare, add or remind, for a message about a meeting
	language string
	similar  *ChatRef
}

// fresh reports whether the run starts on a new message from the person, the
// only time triage runs: a resumed lease or an automatic next batch keeps
// whatever the run already had.
func fresh(c *Conversation) bool {
	if len(c.Transcript) > 0 || len(c.Messages) == 0 || c.Sensitive || c.ImageReview != nil {
		return false
	}
	// A run resumed with "answer here" still starts on the person's message.
	last := c.Messages[len(c.Messages)-1]
	for i := len(c.Messages) - 1; i > 0 && last.Kind == "similar"; i-- {
		last = c.Messages[i-1]
	}
	return last.Role == "user" && last.Kind == ""
}

// latestRequest is the person's newest message and, when there is one, the
// message before it, for a follow-up like "do the same for Friday".
func latestRequest(c *Conversation) (string, string) {
	latest, earlier := "", ""
	for i := len(c.Messages) - 1; i >= 0; i-- {
		m := c.Messages[i]
		if m.Role != "user" || m.Kind != "" {
			continue
		}
		if latest == "" {
			latest = m.Content
			continue
		}
		earlier = m.Content
		break
	}
	return clip(latest, 4000), clip(earlier, 1000)
}

func clip(s string, n int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) > n {
		return string(r[:n])
	}
	return string(r)
}

func (s *Service) triage(ctx context.Context, c *Conversation) (triage, bool) {
	if s.decisions == nil || !fresh(c) {
		return triage{}, false
	}
	ctx, cancel := context.WithTimeout(ctx, triageBudget)
	defer cancel()
	latest, earlier := latestRequest(c)
	state := map[string]any{"message": latest}
	if earlier != "" {
		state["previousMessage"] = earlier
	}
	if len(c.Context) > 0 {
		attached := make([]string, 0, len(c.Context))
		for _, chip := range c.Context {
			attached = append(attached, clip(chip.Kind+": "+chip.Label, 200))
		}
		state["attached"] = attached
	}
	questions := map[string]decide.Question{
		"area": decide.Choice("What part of a planning app does this message to the app's assistant need?",
			decide.Option{Name: "tasks", Description: "Work, reminders, the Inbox, focus or what to do next."},
			decide.Option{Name: "calendar", Description: "Events, the calendar, scheduling, free time or working hours."},
			decide.Option{Name: "docs", Description: "Writing, reading or organising docs and notes."},
			decide.Option{Name: "sheets", Description: "Spreadsheets, budgets, tables, templates or receipts."},
			decide.Option{Name: "projects", Description: "Organising projects, workspaces, labels or stages."},
			decide.Option{Name: "notifications", Description: "Notifications the app already sent."},
			decide.Option{Name: "mixed", Description: "Several of these, or something else."}).Twice(),
		"change": decide.YesNo("Does the message ask the assistant to create, change, move or delete something?",
			"It asks for a change to the person's tasks, events, docs, sheets or projects.", "It only asks a question or for information."),
		"web": decide.YesNo("Does answering need public information from the web rather than the person's own data?",
			"It needs facts from the web, such as opening hours, prices or news.", "The person's own data, or general knowledge, is enough."),
		"unclear": decide.YesNo("Is the message too unclear to act on without asking the person a question first?",
			"It is too vague: it is unclear what should change or which item it means.", "It is clear enough to act on or answer."),
		"scope": decide.Choice("If the message changes a repeating event or task, which occurrences does it mean?",
			decide.Option{Name: "none", Description: "It does not change a repeating item, or it does not say."},
			decide.Option{Name: "one", Description: "Only one occurrence."},
			decide.Option{Name: "future", Description: "This occurrence and the ones after it."},
			decide.Option{Name: "all", Description: "Every occurrence, past ones included."}),
		"meeting": decide.Choice("If the message is about a meeting, appointment or other event, what does the person want done about it?",
			decide.Option{Name: "none", Description: "It is not about an event, or it does not say."},
			decide.Option{Name: "prepare", Description: "Block time before it to prepare."},
			decide.Option{Name: "add", Description: "Put the event itself on the calendar."},
			decide.Option{Name: "remind", Description: "Be reminded shortly before it."}),
	}
	// Scripts other than Latin are recognised without Jev (detectLanguage).
	if detectLanguage(latest) == "latin" {
		questions["language"] = decide.Choice("Which language is the message written in?", latinLanguages...)
	}
	var similar map[string]ChatRef
	if len(c.Messages) == 1 {
		similar = s.recentChats(ctx, c)
		if len(similar) > 0 {
			opts := []decide.Option{{Name: "none", Description: "None of these chats is about the same request."}}
			for name := range similar {
				opts = append(opts, decide.Option{Name: name})
			}
			questions["similar"] = decide.Choice("The person already has these chats with the assistant. Which one, if any, is about the same request as this message, so it could be continued there?", opts...).Twice()
			// With near-duplicate earlier chats the two option orders can pick
			// different ones; a confident "there is a match" keeps the first pick.
			questions["hasSimilar"] = decide.YesNo("Is one of the person's earlier chats about the same request as this message, so it could be continued there?",
				"Yes, an earlier chat is about the same request", "No, this is a new request")
		}
	}
	a, err := s.decisions.Ask(ctx, c.UserID, decide.Request{Feature: "chat_triage", State: state, Questions: questions})
	if err != nil {
		return triage{}, false
	}
	var t triage
	if area, ok := a.Choice("area", decide.Route); ok && area != "mixed" {
		t.area = area
	}
	if yes, ok := a.Yes("change", decide.Route); ok {
		t.change = &yes
	}
	if yes, ok := a.Yes("web", decide.Route); ok && yes {
		t.web = true
	}
	if yes, ok := a.Yes("unclear", decide.Route); ok && yes {
		t.unclear = true
	}
	if scope, ok := a.Choice("scope", decide.Route); ok && scope != "none" {
		t.scope = scope
	}
	if meeting, ok := a.Choice("meeting", decide.Route); ok && meeting != "none" {
		t.meeting = meeting
	}
	if lang, ok := a.Choice("language", decide.Route); ok {
		t.language = supportedLanguage(lang)
	}
	name, ok := a.Choice("similar", decide.Route)
	if !ok {
		if yes, sure := a.Yes("hasSimilar", decide.Route); sure && yes {
			if raw, found := a.Raw("similar"); found {
				name, ok = raw.Choice, true
			}
		}
	}
	if ok && name != "none" {
		if ref, found := similar[name]; found {
			t.similar = &ref
		}
	}
	return t, true
}

// recentChats are the person's other chats from the last 30 days, keyed by a
// unique title Jev can choose.
func (s *Service) recentChats(ctx context.Context, c *Conversation) map[string]ChatRef {
	var rows []Conversation
	if s.db.WithContext(ctx).Select("id", "title").
		Where("user_id = ? AND id <> ? AND sensitive = false AND updated_at > ?", c.UserID, c.ID, time.Now().AddDate(0, 0, -30)).
		Order("updated_at DESC").Limit(maxSimilar).Find(&rows).Error != nil {
		return nil
	}
	out := map[string]ChatRef{}
	for _, row := range rows {
		name := clip(row.Title, 80)
		if name == "" || strings.EqualFold(name, "none") {
			continue
		}
		for n := 2; ; n++ {
			if _, taken := out[name]; !taken {
				break
			}
			name = fmt.Sprintf("%s (%d)", clip(row.Title, 74), n)
		}
		out[name] = ChatRef{ID: row.ID, Title: row.Title}
	}
	return out
}

// hint is the triage as a notice the model reads before the conversation. It
// is advice from a small classifier, not the person's words.
func (t triage) hint(webSearch bool) string {
	parts := []string{}
	if t.change != nil && !*t.change {
		parts = append(parts, "it reads as a question: answer it, and propose changes only if the person asks for them")
	}
	if t.unclear {
		parts = append(parts, "it may be too unclear to act on: if it is, ask one short question before proposing anything")
	}
	if t.web && !webSearch {
		parts = append(parts, "it may need public information from the web, and web search is off: if Timely data cannot answer it, say that turning on web search would help")
	}
	switch t.scope {
	case "one":
		parts = append(parts, "if it changes a repeating item, the person most likely means only one occurrence")
	case "future":
		parts = append(parts, "if it changes a repeating item, the person most likely means this and future occurrences")
	case "all":
		parts = append(parts, "if it changes a repeating item, the person most likely means the whole series")
	}
	switch t.meeting {
	case "prepare":
		parts = append(parts, "about an event, the person most likely wants time blocked before it to prepare (a task with a time block), not the event added again")
	case "add":
		parts = append(parts, "about an event, the person most likely wants the event itself added to the calendar")
	case "remind":
		parts = append(parts, "about an event, the person most likely wants a reminder shortly before it, not a time block")
	}
	if len(parts) == 0 {
		return ""
	}
	return "System notice (not written by the user): a quick classifier read the latest message as follows; it can be wrong, so follow the person's own words: " + strings.Join(parts, "; ") + "."
}

// tools narrows the read tools offered to the ones the request's area needs.
// The rest stay callable by name: the run offers everything again as soon as
// the model asks for one that was left out.
func (t triage) tools(name string) bool {
	if t.area == "" {
		return true
	}
	for _, tool := range essentialTools {
		if tool == name {
			return true
		}
	}
	for _, tool := range areaTools[t.area] {
		if tool == name {
			return true
		}
	}
	return false
}

// reviewNotes asks whether every step was requested and whether something
// requested is missing. A note puts the proposal in front of the person even
// when it could have applied directly. A batch of a larger request is not
// asked what is missing: the rest comes in the next batches.
func (s *Service) reviewNotes(ctx context.Context, c *Conversation, p proposal) []string {
	steps := p.Steps
	if s.decisions == nil || c.Sensitive || len(steps) == 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, reviewBudget)
	defer cancel()
	latest, earlier := latestRequest(c)
	if latest == "" {
		return nil
	}
	listed := make([]map[string]string, len(steps))
	questions := map[string]decide.Question{}
	changes := map[int]string{}
	drafts := map[int]docDraft{}
	if s.jevOn(ctx, c.UserID) {
		changes = s.sheetChanges(ctx, c.UserID, steps)
		drafts = s.docDrafts(ctx, c.UserID, steps)
	}
	if p.Remaining == "" && !continuing(c) {
		questions["missing"] = decide.YesNo("Did the person ask for something that none of the proposed changes does?",
			"Something the person asked for is not covered by any change.", "The changes cover everything the person asked for.")
	}
	for i, step := range steps {
		listed[i] = map[string]string{"number": fmt.Sprint(i + 1), "change": clip(step.Summary, 300)}
		questions[fmt.Sprintf("asked%d", i+1)] = decide.YesNo(fmt.Sprintf("Did the person ask for change number %d, directly or as a necessary part of what they asked?", i+1),
			"The person asked for it, or it is needed to do what they asked.", "The person did not ask for it.")
		if d, ok := drafts[i]; ok {
			listed[i]["docText"] = d.draft
			questions[fmt.Sprintf("draft%d", i+1)] = decide.YesNo(fmt.Sprintf("Does the docText of change number %d leave out something the person asked the doc to contain, or break an instruction they gave about it (length, format, sections, tone, language)?", i+1),
				"Yes: something asked for is missing, or an instruction is not followed.", "No: it covers what was asked and follows the instructions.")
			if d.existing != "" {
				listed[i]["docNow"] = d.existing
				questions[fmt.Sprintf("contra%d", i+1)] = decide.YesNo(fmt.Sprintf("Does the docText of change number %d state something that contradicts what docNow already says, in a part the person did not ask to change?", i+1),
					"Yes: it contradicts something the doc already says.", "No: nothing it says conflicts with the rest of the doc.")
			}
		}
		if text := changes[i]; text != "" {
			listed[i]["sheetChanges"] = text
			questions[fmt.Sprintf("sheet%d", i+1)] = decide.YesNo(fmt.Sprintf("Does change number %d remove or alter anything in the sheet (a column, rows or values) that the person did not ask to remove or alter?", i+1),
				"Yes: its sheetChanges remove or alter something the person did not ask about.", "No: every listed column and row change is something the person asked for.")
		}
	}
	state := map[string]any{"request": latest, "changes": listed}
	if earlier != "" {
		state["previousMessage"] = earlier
	}
	fitReview(state, listed, questions, decide.MaxStateBytes)
	a, err := s.decisions.Ask(ctx, c.UserID, decide.Request{Feature: "chat_review", State: state, Questions: questions})
	if err != nil {
		return nil
	}
	notes := []string{}
	for i, step := range steps {
		if yes, ok := a.Yes(fmt.Sprintf("asked%d", i+1), decide.Route); ok && !yes {
			notes = append(notes, tr(c.Language, txtNoteNotAsked)+" "+clip(step.Summary, 200))
			continue
		}
		if yes, ok := a.Yes(fmt.Sprintf("sheet%d", i+1), decide.Route); ok && yes {
			notes = append(notes, tr(c.Language, txtNoteSheetChange)+" "+changes[i])
		}
		if yes, ok := a.Yes(fmt.Sprintf("draft%d", i+1), decide.Route); ok && yes {
			notes = append(notes, tr(c.Language, txtNoteDraftMisses)+" "+clip(step.Summary, 200))
		}
		if yes, ok := a.Yes(fmt.Sprintf("contra%d", i+1), decide.Route); ok && yes {
			notes = append(notes, tr(c.Language, txtNoteContradiction)+" "+clip(step.Summary, 200))
		}
	}
	if yes, ok := a.Yes("missing", decide.Route); ok && yes {
		notes = append(notes, tr(c.Language, txtNoteMissing))
	}
	return notes
}

// fitReview trims a review's state until it fits Jev's limit, which a large
// proposal can pass (30 steps, doc drafts, and CJK text at three bytes a
// character): over the limit the whole check would be dropped. Doc draft
// checks go first, from the last step back, then long texts are cut on
// character boundaries, the steps' texts before the request's.
func fitReview(state map[string]any, listed []map[string]string, questions map[string]decide.Question, limit int) {
	fits := func() bool {
		b, err := json.Marshal(state)
		return err == nil && len(b) <= limit
	}
	if fits() {
		return
	}
	for i := len(listed) - 1; i >= 0; i-- {
		if _, ok := listed[i]["docText"]; !ok {
			continue
		}
		delete(listed[i], "docText")
		delete(listed[i], "docNow")
		delete(questions, fmt.Sprintf("draft%d", i+1))
		delete(questions, fmt.Sprintf("contra%d", i+1))
		if fits() {
			return
		}
	}
	for _, n := range []int{150, 80, 40} {
		for _, step := range listed {
			for k, v := range step {
				if k != "number" {
					step[k] = clip(v, n)
				}
			}
		}
		if fits() {
			return
		}
	}
	for _, n := range []int{2000, 1000, 500} {
		state["request"] = clip(state["request"].(string), n)
		if earlier, ok := state["previousMessage"].(string); ok {
			state["previousMessage"] = clip(earlier, n/4)
		}
		if fits() {
			return
		}
	}
}

// continuing reports whether the run is a later batch of the person's latest
// request.
func continuing(c *Conversation) bool {
	for i := len(c.Messages) - 1; i >= 0; i-- {
		m := c.Messages[i]
		if m.Role == "user" && m.Kind == "" {
			return false
		}
		if m.Continue != "" {
			return true
		}
	}
	return false
}

// openPointer is the "similar" message still waiting for the person's choice:
// the chat's last message, while the run waits.
func openPointer(c *Conversation) *Message {
	if c.Status != "choose" || len(c.Messages) == 0 {
		return nil
	}
	m := &c.Messages[len(c.Messages)-1]
	if m.Kind != "similar" || m.Chat == nil || m.Choice != "" {
		return nil
	}
	return m
}

// similar answers a "You already have a chat about this" pointer. "stay" runs
// the request in this chat after all; "move" sends the person's message to
// the earlier chat, which runs it, and deletes this one.
func (s *Service) similar(c *echo.Context) error {
	var in struct {
		Action string `json:"action"`
	}
	if err := c.Bind(&in); err != nil || (in.Action != "move" && in.Action != "stay") {
		return echo.NewHTTPError(400, "Choose move or stay")
	}
	if in.Action == "stay" {
		return s.change(c, func(tx *gorm.DB, row *Conversation) error {
			pointer := openPointer(row)
			if pointer == nil {
				return echo.NewHTTPError(409, "This chat is not waiting for that choice")
			}
			pointer.Choice = "stay"
			row.Status, row.Phase = "queued", "plan"
			return nil
		})
	}
	var target Conversation
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var row Conversation
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), user(c), c.Param("id"), &row); err != nil {
			return err
		}
		pointer := openPointer(&row)
		if pointer == nil {
			return echo.NewHTTPError(409, "This chat is not waiting for that choice")
		}
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), row.UserID, pointer.Chat.ID, &target); err != nil {
			return err
		}
		if busy(&target) {
			return echo.NewHTTPError(409, "That chat is still working. Wait for it, or answer here")
		}
		if len(target.Messages) > 150 {
			return echo.NewHTTPError(400, "That chat is full. Answer here instead")
		}
		// The same steps as sending a message there (see send).
		target.ForceReview = target.Status == "approval" || target.Sensitive
		archivePlan(&target)
		for _, m := range row.Messages {
			if m.Role == "user" && m.Kind == "" {
				noteLanguage(&target, m.Content)
				moved := message("user", m.Content)
				moved.RequestID = m.RequestID
				target.Messages = append(target.Messages, moved)
			}
		}
		for _, chip := range row.Context {
			if len(target.Context) < 8 && !hasChip(target.Context, chip) {
				target.Context = append(target.Context, chip)
			}
		}
		if row.Timezone != "" {
			target.Timezone = row.Timezone
		}
		// The request was written with this chat's web search switch and
		// model; it runs with them there too.
		target.WebSearch = row.WebSearch
		if row.ChosenProvider != "" {
			target.ChosenProvider, target.ChosenModel = row.ChosenProvider, row.ChosenModel
		}
		target.Status, target.Phase = "queued", "plan"
		target.Error, target.Unread = "", false
		target.Revision++
		if err := tx.Save(&target).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ? AND entity_type = 'chat' AND entity_id = ?", row.UserID, row.ID).Delete(&models.Notification{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND user_id = ?", row.ID, row.UserID).Delete(&Conversation{}).Error
	})
	if err != nil {
		return err
	}
	s.fillImages(&target)
	return c.JSON(200, target)
}

func hasChip(chips []ContextChip, chip ContextChip) bool {
	for _, c := range chips {
		if c == chip {
			return true
		}
	}
	return false
}
