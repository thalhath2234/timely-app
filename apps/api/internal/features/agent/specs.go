package agent

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
)

// ToolSpec is one Timely tool as the agent engine's worker registers it
// (hello.timely_tools, plan 5.2): the same name, description and parameters
// the classic engine offers the model, plus whether its result carries
// third-party text.
type ToolSpec struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Parameters  any    `json:"parameters"`
	Outside     bool   `json:"outside"`
}

// ChatReadSpecs is every Read tool of the catalog, sorted by name. Write
// tools reach the agent only inside propose_changes, and MCP-only tools never
// reach it (ADR 0007), so neither appears here.
func ChatReadSpecs(c Catalog) []ToolSpec {
	names := make([]string, 0, len(c))
	for name, t := range c {
		if t.Authority.Access == Read {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	out := make([]ToolSpec, 0, len(names))
	for _, name := range names {
		t := c[name]
		out = append(out, ToolSpec{Name: name, Description: t.Description, Parameters: t.Parameters, Outside: OutsideTool(name)})
	}
	return out
}

// SpecsVersion is the sha256 of the specs' canonical JSON: object keys
// sorted at every depth, in the order the specs are given. The worker
// compares it with the version it registered and is restarted (when idle)
// on a change.
func SpecsVersion(specs []ToolSpec) string {
	raw, err := json.Marshal(specs)
	if err != nil {
		return ""
	}
	// A round trip through generic values sorts the keys of any map or
	// custom-marshalled schema, so equal specs always hash alike.
	var generic any
	if err := json.Unmarshal(raw, &generic); err != nil {
		return ""
	}
	canonical, err := json.Marshal(generic)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:])
}
