package chat

import (
	"context"
	"encoding/json"
	"strings"
)

// Doc drafts in a proposal [55, 56]: what a create_doc, update_doc or
// append_to_doc step would write, and for edits the doc's text as it is now,
// so the review can ask whether the draft covers the request and whether it
// contradicts what the doc already says.

const (
	maxDocDrafts  = 3 // steps per proposal whose text is sent; keeps the state small
	docDraftLimit = 2500
)

type docDraft struct {
	draft    string
	existing string // empty for a new doc
}

func (s *Service) docDrafts(ctx context.Context, uid string, steps []Step) map[int]docDraft {
	out := map[int]docDraft{}
	var get func(context.Context, string, json.RawMessage) (any, error)
	if s.factory != nil && s.db != nil {
		get = s.factory(s.db.WithContext(ctx))["get_doc"].Call
	}
	for i, step := range steps {
		if len(out) == maxDocDrafts {
			break
		}
		var in struct {
			DocID    string  `json:"docId"`
			Markdown *string `json:"markdown"`
		}
		if json.Unmarshal(step.Arguments, &in) != nil || in.Markdown == nil || strings.TrimSpace(*in.Markdown) == "" {
			continue
		}
		d := docDraft{draft: clip(*in.Markdown, docDraftLimit)}
		switch step.Tool {
		case "create_doc":
		case "update_doc", "append_to_doc":
			if get == nil || in.DocID == "" || strings.HasPrefix(in.DocID, "$") {
				break
			}
			result, err := get(ctx, uid, raw(map[string]string{"docId": in.DocID}))
			if err != nil {
				break
			}
			// plainText is left out when the doc holds big data blocks.
			var current struct {
				PlainText string `json:"plainText"`
				Markdown  string `json:"markdown"`
			}
			if json.Unmarshal(raw(result), &current) == nil {
				text := current.PlainText
				if text == "" {
					text = current.Markdown
				}
				d.existing = clip(strings.TrimSpace(text), docDraftLimit)
			}
		default:
			continue
		}
		out[i] = d
	}
	return out
}
