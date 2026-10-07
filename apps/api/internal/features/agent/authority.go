package agent

import (
	"fmt"
	"sync"
)

// Access is what the in-app chat agent may do with a tool. Every registerTool
// call declares one, so a tool cannot exist without a decision about its
// authority (ADR 0007): chat sees only what is declared Read or Write, and the
// zero value is rejected at registration.
type Access int

const (
	// MCPOnly tools are served to external MCP clients but never offered to chat.
	MCPOnly Access = iota + 1
	// Read tools run immediately during a chat turn.
	Read
	// Write tools change data. Chat only runs them through an Agent proposal,
	// which is either applied directly or held for approval (see Approval).
	Write
)

// Approval says when a single directly applied call needs the person to review
// it as an Agent proposal. Several steps in one plan are always reviewed.
type Approval int

const (
	// Applies is the zero value: a clear single call executes immediately.
	Applies Approval = iota
	// Reviewed calls always need approval (deletions, recurring-series changes,
	// bulk edits, settings, calendar-wide changes).
	Reviewed
	// ReviewedWhen calls need approval depending on their arguments.
	ReviewedWhen
)

// Authority is one tool's policy: its Access, its Approval, and what the
// review shows as the "before" of a change. Build it from reads, writes or
// mcpOnly with the methods below, next to the tool's registration.
type Authority struct {
	Access   Access
	Approval Approval
	// reviewWhen decides ReviewedWhen from the call's arguments.
	reviewWhen func(args map[string]any) bool
	// Showing names a read tool whose result is the "before" of this tool's
	// change. It is called with no arguments, or with the step's own arguments
	// when ShowingStepArguments is set.
	Showing              string
	ShowingStepArguments bool
}

var (
	reads   = Authority{Access: Read}
	writes  = Authority{Access: Write}
	mcpOnly = Authority{Access: MCPOnly}
)

// reviewed always needs an Agent proposal.
func (a Authority) reviewed() Authority {
	a.Approval = Reviewed
	return a
}

// reviewedWhen needs an Agent proposal when reviews returns true for the
// call's arguments (nil when they are missing or not an object).
func (a Authority) reviewedWhen(reviews func(args map[string]any) bool) Authority {
	a.Approval, a.reviewWhen = ReviewedWhen, reviews
	return a
}

// showing records that the review of this tool displays the current result of
// the named read tool, called with no arguments.
func (a Authority) showing(readTool string) Authority {
	a.Showing = readTool
	return a
}

// showingFor is showing, but the read tool is called with the step's own
// arguments (a preview of exactly what the step would do).
func (a Authority) showingFor(readTool string) Authority {
	a.Showing, a.ShowingStepArguments = readTool, true
	return a
}

// NeedsProposal reports whether a single directly applied call with these
// arguments must be reviewed as an Agent proposal.
func (a Authority) NeedsProposal(args map[string]any) bool {
	switch a.Approval {
	case Reviewed:
		return true
	case ReviewedWhen:
		return a.reviewWhen(args)
	}
	return false
}

// hasAny matches calls that set any of the named arguments, even to null.
func hasAny(keys ...string) func(map[string]any) bool {
	return func(args map[string]any) bool {
		for _, k := range keys {
			if _, ok := args[k]; ok {
				return true
			}
		}
		return false
	}
}

func (a Authority) validate(name string) {
	switch {
	case a.Access < MCPOnly || a.Access > Write:
		panic(fmt.Sprintf("agent tool %s declares no authority", name))
	case a.Access == Read && (a.Approval != Applies || a.Showing != ""):
		panic(fmt.Sprintf("agent tool %s is read-only, so it cannot need review", name))
	case a.Approval == ReviewedWhen && a.reviewWhen == nil:
		panic(fmt.Sprintf("agent tool %s needs review by arguments but declares no rule", name))
	}
}

var authorities = sync.OnceValue(func() Catalog { return NewCatalog(Deps{}) })

// AuthorityOf returns the declared authority of a tool by name, independent of
// any handler dependencies. Unknown names report false.
func AuthorityOf(name string) (Authority, bool) {
	t, ok := authorities()[name]
	return t.Authority, ok
}

// Argument rules for the ReviewedWhen tools (ADR 0007).

// A single clear cell edit executes immediately; several cells are a bulk edit.
func otherThanOneCell(args map[string]any) bool {
	cells, _ := args["cells"].(map[string]any)
	return len(cells) != 1
}

// A sheet created from a template arrives populated.
func fromTemplate(args map[string]any) bool {
	return args["templateId"] != nil && args["templateId"] != ""
}

// An empty id marks every unread notification as read.
func allNotifications(args map[string]any) bool {
	id, _ := args["id"].(string)
	return id == ""
}
