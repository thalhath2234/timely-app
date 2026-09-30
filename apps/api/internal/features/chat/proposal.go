package chat

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"timely-api/internal/features/agent"
)

type proposal struct {
	Summary string `json:"summary"`
	Direct  bool   `json:"direct"`
	Steps   []Step `json:"steps"`
}

func (s *Service) prepareProposal(ctx context.Context, catalog agent.Catalog, uid string, args json.RawMessage) (proposal, []Snapshot, error) {
	var p proposal
	if err := json.Unmarshal(args, &p); err != nil {
		return p, nil, fmt.Errorf("Proposal must be JSON with summary, direct, and steps: %w", err)
	}
	if len(p.Steps) < 1 || len(p.Steps) > 30 {
		return p, nil, fmt.Errorf("A proposal must contain 1–30 changes")
	}
	replacements := map[string]bool{}
	for i := range p.Steps {
		step := &p.Steps[i]
		if !writeTools[step.Tool] || catalog[step.Tool].Call == nil {
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
	return p, snapshots, err
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
