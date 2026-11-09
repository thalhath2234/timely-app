package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	"timely-api/internal/features/agent"
	"timely-api/internal/features/decide"
	"timely-api/internal/models"

	"gorm.io/gorm"
)

type proposal struct {
	Summary   string `json:"summary"`
	Direct    bool   `json:"direct"`
	Steps     []Step `json:"steps"`
	Reply     string `json:"reply,omitempty"`
	Remaining string `json:"remaining,omitempty"`
	Language  string `json:"language,omitempty"`
}

// Some models send steps, or a step's arguments, as a JSON-encoded string
// instead of an array or object. Decode that one extra layer instead of
// rejecting an otherwise valid proposal.
func lenientProposal(args json.RawMessage) json.RawMessage {
	var top map[string]json.RawMessage
	if json.Unmarshal(args, &top) != nil {
		return args
	}
	for _, key := range []string{"steps", "direct"} {
		if value, ok := unwrapJSONString(top[key]); ok {
			top[key] = value
		}
	}
	var steps []map[string]json.RawMessage
	if json.Unmarshal(top["steps"], &steps) == nil {
		for _, step := range steps {
			if value, ok := unwrapJSONString(step["arguments"]); ok {
				step["arguments"] = value
			}
		}
		top["steps"] = raw(steps)
	}
	return raw(top)
}

func unwrapJSONString(value json.RawMessage) (json.RawMessage, bool) {
	var text string
	if len(value) == 0 || value[0] != '"' || json.Unmarshal(value, &text) != nil {
		return nil, false
	}
	text = strings.TrimSpace(text)
	if text == "" || !json.Valid([]byte(text)) {
		return nil, false
	}
	return json.RawMessage(text), true
}

// The objects a proposal snapshots, keyed by the read tool and its ID field.
var snapshotFields = map[string]string{"get_task": "taskId", "get_project": "projectId", "get_workspace": "workspaceId", "get_event": "eventId", "get_doc": "docId", "get_sheet": "sheetId", "get_sheet_template": "templateId", "get_bot": "bot"}

func readKey(tool string, args json.RawMessage) string {
	var value map[string]any
	if json.Unmarshal(args, &value) != nil {
		return ""
	}
	return tool + string(raw(value))
}

// snapshotRead returns the key of a plain get_* read, so the version the model
// actually saw can be compared with the data when it proposes changes.
func snapshotRead(tool string, args json.RawMessage) (string, bool) {
	field, ok := snapshotFields[tool]
	if !ok {
		return "", false
	}
	var input map[string]any
	if json.Unmarshal(args, &input) != nil {
		return "", false
	}
	// get_doc with full=true returns the whole doc, the same as a plain read;
	// a focused read may leave sections out, so it is not a snapshot.
	if tool == "get_doc" && input["full"] == true && input["focus"] == nil {
		delete(input, "full")
	}
	if len(input) != 1 {
		return "", false
	}
	value, _ := input[field].(string)
	if value == "" {
		return "", false
	}
	return readKey(tool, raw(map[string]string{field: value})), true
}

// recordRead notes the hash of what a read tool returned, keyed like
// snapshotRead. A get_doc with a focus may leave sections out, so it is not a
// snapshot itself; the doc is read again plainly (a plain get_doc never asks
// Jev) and that version is recorded, so a later edit to the doc still stops a
// proposal built on the focused read.
func recordRead(ctx context.Context, catalog agent.Catalog, uid, tool string, args json.RawMessage, result any, reads map[string]string) {
	if key, ok := snapshotRead(tool, args); ok {
		reads[key] = hash(result)
		return
	}
	docID, ok := focusedDocRead(tool, args)
	if !ok || catalog["get_doc"].Call == nil {
		return
	}
	plain := raw(map[string]string{"docId": docID})
	if whole, err := catalog["get_doc"].Call(ctx, uid, plain); err == nil {
		reads[readKey("get_doc", plain)] = hash(whole)
	}
}

// focusedDocRead returns the doc a get_doc with a focus read.
func focusedDocRead(tool string, args json.RawMessage) (string, bool) {
	if tool != "get_doc" {
		return "", false
	}
	var input map[string]any
	if json.Unmarshal(args, &input) != nil || input["focus"] == nil {
		return "", false
	}
	for key := range input {
		if key != "docId" && key != "focus" && key != "full" {
			return "", false
		}
	}
	docID, _ := input["docId"].(string)
	return docID, docID != ""
}

// docMarkdownTools are the writes whose markdown may hold the [section kept
// out ...] lines of a focused get_doc.
var docMarkdownTools = map[string]bool{"create_doc": true, "update_doc": true, "append_to_doc": true}

// prepareProposal validates a proposal, snapshots what it edits, and rehearses
// it. reads maps snapshotRead keys to the hash of what the model read; when
// the data changed since that read, the model must read it again, otherwise
// the proposal would silently overwrite the newer edit.
func (s *Service) prepareProposal(ctx context.Context, catalog agent.Catalog, uid string, args json.RawMessage, reads map[string]string) (proposal, []Snapshot, error) {
	var p proposal
	if err := json.Unmarshal(lenientProposal(args), &p); err != nil {
		return p, nil, fmt.Errorf("Proposal must be JSON with summary, direct, and steps: %w", err)
	}
	if len(p.Steps) < 1 || len(p.Steps) > 30 {
		return p, nil, fmt.Errorf("A proposal must contain 1–30 changes. For more, submit the first 30 and describe the rest in remaining; Timely continues automatically")
	}
	// At the limit the model must say whether more follows ("none" when not),
	// or a large request would silently stop after the first batch.
	if len(p.Steps) == 30 && strings.TrimSpace(p.Remaining) == "" {
		return p, nil, fmt.Errorf("This proposal has the maximum 30 changes. Set remaining to what is still left of the request, or to \"none\" if these 30 changes complete it")
	}
	p.Reply, p.Remaining = blankIfNone(p.Reply), remainingWork(p.Remaining)
	if strings.TrimSpace(p.Summary) == "" {
		// Never show an empty proposal message; the step summaries are required.
		parts := []string{}
		for _, step := range p.Steps {
			parts = append(parts, strings.TrimSpace(step.Summary))
		}
		p.Summary = strings.Join(parts, " ")
	}
	replacements := map[string]bool{}
	for i := range p.Steps {
		step := &p.Steps[i]
		if !isWriteTool(step.Tool) || catalog[step.Tool].Call == nil {
			return p, nil, fmt.Errorf("Step %d has unavailable tool %q; use an exact write tool name", i+1, step.Tool)
		}
		var input map[string]any
		if err := json.Unmarshal(step.Arguments, &input); err != nil || input == nil || strings.TrimSpace(step.Summary) == "" {
			return p, nil, fmt.Errorf("Step %d requires a summary and arguments object", i+1)
		}
		// The person reviews (and Jev checks) the doc as it will be written,
		// not the placeholder lines of a focused read.
		if markdown, ok := input["markdown"].(string); ok && docMarkdownTools[step.Tool] {
			full, err := agent.RestoreSections(ctx, catalog, uid, markdown)
			if err != nil {
				return p, nil, fmt.Errorf("Step %d (%s): %w", i+1, step.Tool, err)
			}
			if full != markdown {
				input["markdown"] = full
				step.Arguments = raw(input)
			}
		}
		if step.Tool == "update_sheet" {
			sheetID, _ := input["sheetId"].(string)
			for _, field := range []string{"rows", "columns", "tabs"} {
				if _, present := input[field]; !present {
					continue
				}
				key := sheetID + ":" + field
				if replacements[key] {
					return p, nil, fmt.Errorf("Multiple update_sheet steps replace %s on the same sheet. This does not append data. Combine the complete final %s into one update, preserving all intended values and correcting formula row references", field, field)
				}
				replacements[key] = true
			}
		}
		if step.Tool == "auto_schedule_apply" {
			if input["from"] == nil || input["from"] == "" {
				input["from"] = time.Now().UTC().Format(time.RFC3339)
			}
			if input["to"] == nil || input["to"] == "" {
				input["to"] = time.Now().UTC().AddDate(0, 0, 14).Format(time.RFC3339)
			}
			step.Arguments = raw(input)
		}
		if schema := catalog[step.Tool].Parameters; schema != nil {
			resolved, err := schema.Resolve(nil)
			if err != nil {
				return p, nil, err
			}
			if err := resolved.Validate(input); err != nil {
				return p, nil, fmt.Errorf("Step %d (%s) has invalid arguments: %w", i+1, step.Tool, err)
			}
		}
		step.Status = "pending"
		step.Result = nil
		step.Before = nil
		step.Preview = nil // only the runner reads one (previewSteps)
		step.Undo = false  // only an undo plan's own steps (undo.go)
		step.Error = ""
	}
	origins := identityOrigins(len(p.Steps))
	if catalog["add_sheet_entries"].Call != nil {
		p.Steps, origins = mergeSheetEntries(p.Steps)
	}
	s.estimateWork(ctx, uid, p.Steps)
	snapshots, err := s.snapshots(ctx, s.db, catalog, uid, p.Steps)
	if err != nil {
		return p, nil, err
	}
	for _, snap := range snapshots {
		if seen, ok := reads[readKey(snap.Tool, snap.Arguments)]; ok && seen != snap.Hash {
			return p, nil, fmt.Errorf("The object read with %s %s changed after you read it (it was edited meanwhile). Call %s again and rebuild the complete proposal from the current data so the newer edit is kept", snap.Tool, string(snap.Arguments), snap.Tool)
		}
	}
	if err := s.rehearseAs(ctx, uid, p.Steps, origins); err != nil {
		return p, nil, err
	}
	return p, snapshots, nil
}

// SetEstimates lets proposals estimate new Work in one batch (smart
// suggestions); a 0 means no estimate for that item.
func (s *Service) SetEstimates(fn func(ctx context.Context, userID string, names, descriptions []string) []int) {
	s.estimates = fn
}

// literalName resolves a "$N.task.name" (or "$N.name") reference to the name
// an earlier create_task step gives in its own arguments, or returns ref when
// it names anything else.
func literalName(steps []Step, index int, ref string) string {
	parts := strings.Split(strings.TrimPrefix(ref, "$"), ".")
	if len(parts) < 2 || parts[len(parts)-1] != "name" || len(parts) > 3 || (len(parts) == 3 && parts[1] != "task") {
		return ref
	}
	n, err := strconv.Atoi(parts[0])
	if err != nil || n < 0 || n >= index || steps[n].Tool != "create_task" {
		return ref
	}
	var in map[string]any
	if json.Unmarshal(steps[n].Arguments, &in) != nil {
		return ref
	}
	if name, ok := in["name"].(string); ok && !strings.HasPrefix(name, "$") {
		return name
	}
	return ref
}

// estimateWork writes a length into every create_task step for Work that has
// none, before the rehearsal: create_task would otherwise ask for its own
// estimate one step at a time inside the rehearsal's transaction, and again
// on apply. With the minutes in the arguments the review shows the length
// that is applied. A failed estimate writes the usual 30 minutes.
func (s *Service) estimateWork(ctx context.Context, uid string, steps []Step) {
	if s.estimates == nil || decide.IsSensitive(ctx) || !s.jevOn(ctx, uid) {
		return
	}
	var at []int
	var names, descriptions []string
	for i, step := range steps {
		if step.Tool != "create_task" {
			continue
		}
		var in map[string]any
		if json.Unmarshal(step.Arguments, &in) != nil || in["duration"] != nil {
			continue
		}
		kind, _ := in["kind"].(string)
		if k, err := models.NormalizeKind(kind); err != nil || k != models.KindTask {
			continue
		}
		name, _ := in["name"].(string)
		if strings.HasPrefix(name, "$") {
			// "$0.task.name" names an earlier create_task's literal name, so
			// it joins the batch instead of estimating alone in the rehearsal.
			name = literalName(steps, i, name)
		}
		if strings.TrimSpace(name) == "" || strings.HasPrefix(name, "$") {
			continue
		}
		description, _ := in["description"].(string)
		at = append(at, i)
		names = append(names, name)
		descriptions = append(descriptions, description)
	}
	if len(at) == 0 {
		return
	}
	minutes := s.estimates(ctx, uid, names, descriptions)
	for j, i := range at {
		var in map[string]any
		if json.Unmarshal(steps[i].Arguments, &in) != nil {
			continue
		}
		in["duration"] = 30
		if j < len(minutes) && minutes[j] > 0 {
			in["duration"] = minutes[j]
		}
		steps[i].Arguments = raw(in)
	}
}

var errRehearsal = errors.New("rehearsal rolled back")

// rehearse runs the whole plan inside a transaction that is always rolled
// back, so domain errors (a missing workspace, a reference to an object an
// earlier step consumes, a missing confirm flag) reach the model before the
// person reviews the proposal instead of failing halfway through applying it.
func (s *Service) rehearse(ctx context.Context, uid string, steps []Step) error {
	return s.rehearseAs(ctx, uid, steps, identityOrigins(len(steps)))
}

// rehearseAs rehearses a plan whose steps may merge several of the model's
// (mergeSheetEntries); errors name the steps as the model numbered them.
func (s *Service) rehearseAs(ctx context.Context, uid string, steps []Step, origins stepOrigins) error {
	if s.rehearsal == nil {
		return nil
	}
	trial := make([]Step, len(steps))
	copy(trial, steps)
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		catalog := s.rehearsal(tx)
		for i := range trial {
			var value any
			if err := json.Unmarshal(trial[i].Arguments, &value); err != nil {
				return err
			}
			value, err := resolve(value, trial, i)
			if err != nil {
				return fmt.Errorf("%s (%s) has an invalid reference: %w", origins.label(i), trial[i].Tool, err)
			}
			result, err := catalog[trial[i].Tool].Call(ctx, uid, raw(value))
			if err != nil {
				return fmt.Errorf("%s (%s) would fail: %w", origins.label(i), trial[i].Tool, err)
			}
			trial[i].Result = raw(result)
			trial[i].Status = "done"
			if _, err := s.snapshots(ctx, tx, catalog, uid, trial); err != nil {
				return fmt.Errorf("After %s (%s) runs, %w. If an earlier step replaces or removes that object, reference its result instead (for example \"$%d.task.id\")", strings.ToLower(origins.label(i)[:1])+origins.label(i)[1:], trial[i].Tool, err, origins.first(i))
			}
		}
		return errRehearsal
	})
	if errors.Is(err, errRehearsal) {
		return nil
	}
	return err
}
func recurringEdit(steps []Step) bool {
	for _, step := range steps {
		if !strings.HasPrefix(step.Tool, "update_") {
			continue
		}
		var before map[string]any
		_ = json.Unmarshal(step.Before, &before)
		if task, ok := before["task"].(map[string]any); ok {
			before = task
		}
		if before["recurrence"] != nil {
			return true
		}
	}
	return false
}

// blankIfNone treats placeholder answers as empty.
func blankIfNone(text string) string {
	switch strings.ToLower(strings.Trim(strings.TrimSpace(text), ".")) {
	case "", "none", "n/a", "na", "null", "nothing", "-":
		return ""
	}
	return strings.TrimSpace(text)
}

var (
	// remainingClause splits a remaining into its clauses: "None – this
	// completes the request." is two.
	remainingClause = regexp.MustCompile(`\s*(?:[,;:]|\s[-–—]\s)\s*`)
	// requestDone is a clause that says the request is finished.
	requestDone = regexp.MustCompile(`^(?:(?:all )?(?:done|complete|completed|finished)|that'?s (?:all|everything)|that is (?:all|everything)|(?:this|these|that)(?: (?:proposal|batch|plan|changes?))? (?:completes?|finish(?:es)?|covers?) (?:the|this|your)(?: (?:whole|entire|full))? (?:request|task|job|plan|list)|(?:the |your )?(?:request|task|job|work|plan) is (?:now )?(?:done|complete|completed|finished))$`)
)

// nothingLeftWords are the words that may follow no, nothing or none in a
// clause that says nothing is left ("No further changes needed", "Nothing
// else remains"). A clause with any other word names work.
var nothingLeftWords = map[string]bool{
	"more": true, "further": true, "other": true, "additional": true, "else": true,
	"change": true, "changes": true, "step": true, "steps": true, "work": true, "task": true, "tasks": true,
	"item": true, "items": true, "action": true, "actions": true, "update": true, "updates": true, "edits": true,
	"is": true, "are": true, "left": true, "needed": true, "required": true, "remain": true, "remains": true, "remaining": true,
	"pending": true, "necessary": true, "to": true, "do": true, "make": true, "apply": true, "be": true, "made": true, "applied": true,
}

// remainingWork is what a proposal's remaining leaves for the next batch:
// empty when it only says that nothing is left. Each batch costs another
// model run, so "No further changes needed." must not start one; but work
// that is left must never be dropped, so every clause has to say nothing is
// left ("Complete the remaining renames" and "None of the Friday tasks are
// moved yet" name work).
func remainingWork(text string) string {
	text = blankIfNone(text)
	for _, clause := range remainingClause.Split(strings.ToLower(strings.Trim(text, " .!")), -1) {
		if !saysNothingLeft(clause) {
			return text
		}
	}
	return ""
}

func saysNothingLeft(clause string) bool {
	if requestDone.MatchString(clause) {
		return true
	}
	words := strings.Fields(clause)
	if len(words) == 0 || (words[0] != "no" && words[0] != "nothing" && words[0] != "none") {
		return false
	}
	for _, word := range words[1:] {
		if !nothingLeftWords[word] {
			return false
		}
	}
	return true
}
