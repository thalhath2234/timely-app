package chat

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"timely-api/internal/features/agent"
)

// Each tool declares its own authority where it is registered (agent.Authority):
// chat can read what is declared Read, change what is declared Write through an
// Agent proposal, and never sees the rest. A new tool therefore gains no in-app
// authority until its registration says so, and the approval rules of ADR 0007
// live next to the tools they apply to rather than in name matching here.

func isReadTool(name string) bool {
	a, ok := agent.AuthorityOf(name)
	return ok && a.Access == agent.Read
}

func isWriteTool(name string) bool {
	a, ok := agent.AuthorityOf(name)
	return ok && a.Access == agent.Write
}

// needsApproval reports whether a plan must be reviewed before it runs. Only a
// single step the model did not require review for may apply directly, and
// then only when its tool's declared authority allows it for these arguments.
// A tool without a declaration is always reviewed.
func needsApproval(steps []Step, direct bool) bool {
	if !direct || len(steps) != 1 {
		return true
	}
	s := steps[0]
	var args map[string]any
	_ = json.Unmarshal(s.Arguments, &args)
	authority, ok := agent.AuthorityOf(s.Tool)
	return !ok || authority.NeedsProposal(args)
}

// $0.id (or $0.task.id) references a prior step's actual result, never an ID
// invented by the model. Resolve structured values without string substitution.
func resolve(value any, steps []Step, index int) (any, error) {
	switch v := value.(type) {
	case string:
		if !strings.HasPrefix(v, "$") {
			return v, nil
		}
		parts := strings.Split(v[1:], ".")
		if len(parts) < 2 {
			return v, nil
		}
		n, err := strconv.Atoi(parts[0])
		if err != nil {
			return v, nil
		}
		if n < 0 || n >= index || steps[n].Status != "done" {
			return nil, fmt.Errorf("reference %s must target a completed earlier step", v)
		}
		var out any
		if err = json.Unmarshal(steps[n].Result, &out); err != nil {
			return nil, err
		}
		for _, p := range parts[1:] {
			switch x := out.(type) {
			case map[string]any:
				out = x[p]
			case []any:
				j, e := strconv.Atoi(p)
				if e != nil || j < 0 || j >= len(x) {
					return nil, fmt.Errorf("invalid reference %s", v)
				}
				out = x[j]
			default:
				return nil, fmt.Errorf("invalid reference %s", v)
			}
		}
		if out == nil {
			return nil, fmt.Errorf("missing reference %s", v)
		}
		return out, nil
	case map[string]any:
		out := map[string]any{}
		for k, x := range v {
			r, e := resolve(x, steps, index)
			if e != nil {
				return nil, e
			}
			out[k] = r
		}
		return out, nil
	case []any:
		out := make([]any, len(v))
		for i, x := range v {
			r, e := resolve(x, steps, index)
			if e != nil {
				return nil, e
			}
			out[i] = r
		}
		return out, nil
	default:
		return v, nil
	}
}
