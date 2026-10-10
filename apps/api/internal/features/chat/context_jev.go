package chat

import (
	"context"
	"fmt"

	"timely-api/internal/features/decide"
)

// Attached context (ADR 0012): a chat carries up to eight context chips, and
// some hold long content (selected text, a sheet filter, a task view's ids).
// When a new message has several attached items and at least one long one,
// one Jev call asks, per long chip, whether this message needs it. A chip Jev
// is sure is not needed keeps its kind and label and a short preview, with a
// note that it is attached but probably not needed, so the model reads less.
// No chip is ever dropped, unsaved drafts are always sent whole, and with Jev
// off, unsure or a sensitive chat, every chip is sent as before.

const (
	// Chips shorter than this cost little, so they are never asked about.
	chipLongBytes = 300
	chipPreview   = 160
)

// unneededChips returns the indexes of the chips Jev is sure the latest
// message does not need. It runs only where triage runs (a new message).
func (s *Service) unneededChips(ctx context.Context, c *Conversation) map[int]bool {
	if s.decisions == nil || !fresh(c) || len(c.Context) < 2 {
		return nil
	}
	latest, earlier := latestRequest(c)
	if latest == "" {
		return nil
	}
	attached := []map[string]any{}
	questions := map[string]decide.Question{}
	asked := map[string]int{}
	for i, chip := range c.Context {
		item := map[string]any{"number": i + 1, "kind": clip(chip.Kind, 30), "label": clip(chip.Label, 200)}
		if trimmable(chip) {
			item["content"] = clip(chip.Value, 600)
			id := fmt.Sprintf("chip%d", i+1)
			asked[id] = i
			questions[id] = decide.YesNo(fmt.Sprintf("Does the person's message need attached item number %d (its content, not just its name) to be answered or done?", i+1),
				"Yes: the message is about it or needs what it contains.", "No: the message is about something else.")
		}
		attached = append(attached, item)
	}
	if len(questions) == 0 {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, triageBudget)
	defer cancel()
	state := map[string]any{"message": latest, "attached": attached}
	if earlier != "" {
		state["previousMessage"] = earlier
	}
	a, err := s.decisions.Ask(ctx, c.UserID, decide.Request{Feature: "chat_context", State: state, Questions: questions})
	if err != nil {
		return nil
	}
	out := map[int]bool{}
	for id, i := range asked {
		if yes, ok := a.Yes(id, decide.Route); ok && !yes {
			out[i] = true
		}
	}
	return out
}

// trimmable reports whether a chip is long enough to ask about. Unsaved
// drafts are never shortened: the model cannot read them back.
func trimmable(chip ContextChip) bool {
	return chip.Kind != "draft" && len(chip.Value) > chipLongBytes
}

// promptChips is the attached context the model reads, with unneeded long
// chips shortened to a preview.
func promptChips(chips []ContextChip, unneeded map[int]bool) any {
	if len(unneeded) == 0 {
		return chips
	}
	out := make([]map[string]string, len(chips))
	for i, chip := range chips {
		out[i] = map[string]string{"kind": chip.Kind, "label": chip.Label, "value": chip.Value}
		if unneeded[i] && trimmable(chip) {
			out[i]["value"] = clip(chip.Value, chipPreview) + "…"
			out[i]["note"] = fmt.Sprintf("Attached but probably not needed for this message; only the start of its %d characters is shown. Ask the person if you need the rest.", len([]rune(chip.Value)))
		}
	}
	return out
}
