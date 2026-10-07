package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"timely-api/internal/features/agent"

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
var snapshotFields = map[string]string{"get_task": "taskId", "get_project": "projectId", "get_workspace": "workspaceId", "get_event": "eventId", "get_doc": "docId", "get_sheet": "sheetId", "get_sheet_template": "templateId"}

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
	if json.Unmarshal(args, &input) != nil || len(input) != 1 {
		return "", false
	}
	value, _ := input[field].(string)
	if value == "" {
		return "", false
	}
	return readKey(tool, raw(map[string]string{field: value})), true
}

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
	p.Reply, p.Remaining = blankIfNone(p.Reply), blankIfNone(p.Remaining)
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
		step.Error = ""
	}
	snapshots, err := s.snapshots(ctx, s.db, catalog, uid, p.Steps)
	if err != nil {
		return p, nil, err
	}
	for _, snap := range snapshots {
		if seen, ok := reads[readKey(snap.Tool, snap.Arguments)]; ok && seen != snap.Hash {
			return p, nil, fmt.Errorf("The object read with %s %s changed after you read it (it was edited meanwhile). Call %s again and rebuild the complete proposal from the current data so the newer edit is kept", snap.Tool, string(snap.Arguments), snap.Tool)
		}
	}
	if err := s.rehearse(ctx, uid, p.Steps); err != nil {
		return p, nil, err
	}
	return p, snapshots, nil
}

var errRehearsal = errors.New("rehearsal rolled back")

// rehearse runs the whole plan inside a transaction that is always rolled
// back, so domain errors (a missing workspace, a reference to an object an
// earlier step consumes, a missing confirm flag) reach the model before the
// person reviews the proposal instead of failing halfway through applying it.
func (s *Service) rehearse(ctx context.Context, uid string, steps []Step) error {
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
				return fmt.Errorf("Step %d (%s) has an invalid reference: %w", i+1, trial[i].Tool, err)
			}
			result, err := catalog[trial[i].Tool].Call(ctx, uid, raw(value))
			if err != nil {
				return fmt.Errorf("Step %d (%s) would fail: %w", i+1, trial[i].Tool, err)
			}
			trial[i].Result = raw(result)
			trial[i].Status = "done"
			if _, err := s.snapshots(ctx, tx, catalog, uid, trial); err != nil {
				return fmt.Errorf("After step %d (%s) runs, %w. If an earlier step replaces or removes that object, reference its result instead (for example \"$%d.task.id\")", i+1, trial[i].Tool, err, i)
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
