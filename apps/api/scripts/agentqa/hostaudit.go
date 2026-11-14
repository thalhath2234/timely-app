package main

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"
)

// The phase 5 exit audit over a live API's schema (work packages decision 16
// and the plan's exit line): every host call that ran has an approved or
// allowed event before it, once, and no chat waiting on a host card holds a
// lease. It reads agent_host_events and agent_conversations through the DSN
// of the API's schema (search_path set), writes nothing, and is run after
// each end-to-end pass:
//
//	agentqa -audit-host -dsn "$TIMELY_PARITY_DSN"
//
// The chat package's real-worker suite applies the same rule to its own
// database as it finishes (engine_phase5_realworker_test.go).

// HostEvent is one agent_host_events row.
type HostEvent struct {
	ConversationID string
	ToolCallID     string
	Tool           string
	ArgsHash       string
	Kind           string
	Reason         string
	Status         string // detail.status of a ran event: ok, error, blocked, interrupted
	At             time.Time
}

// AuditHostEvents returns one line per violation. Events must be oldest
// first. A ran event whose status is "blocked" never started and needs no
// approval; a continuation run has a new call id, so its allowed event
// ("continuation of an approved parked card") names the original tool and
// arguments instead.
func AuditHostEvents(evs []HostEvent) []string {
	used := map[int]bool{}
	var out []string
	for i, e := range evs {
		if e.Kind != "ran" || e.Status == "blocked" {
			continue
		}
		covered := -1
		for j := 0; j < i; j++ {
			p := evs[j]
			if used[j] || p.ConversationID != e.ConversationID || (p.Kind != "approved" && p.Kind != "allowed") {
				continue
			}
			byCall := e.ToolCallID != "" && p.ToolCallID == e.ToolCallID
			byContinuation := p.Kind == "allowed" && strings.HasPrefix(p.Reason, "continuation") && p.Tool == e.Tool && p.ArgsHash != "" && p.ArgsHash == e.ArgsHash
			if byCall || byContinuation {
				covered = j
				break
			}
		}
		if covered < 0 {
			out = append(out, fmt.Sprintf("chat %s: %s call %s ran (status %q) with no approved or allowed event before it", e.ConversationID, e.Tool, e.ToolCallID, e.Status))
			continue
		}
		used[covered] = true
	}
	return out
}

// HostLaneRow is the part of an agent_conversations row the lane check reads.
type HostLaneRow struct {
	ID, Status, Lease string
	LeaseUntil        sql.NullTime
}

// AuditHostLanes flags a chat waiting on a host card that holds a lease.
func AuditHostLanes(rows []HostLaneRow) []string {
	var out []string
	for _, r := range rows {
		if r.Status == "host_approval" && (r.Lease != "" || r.LeaseUntil.Valid) {
			out = append(out, fmt.Sprintf("chat %s waits on a host card and holds lease %q", r.ID, r.Lease))
		}
	}
	return out
}

// HostAuditReport is what an audit found.
type HostAuditReport struct {
	Events     int
	ByKind     map[string]int
	Ran        int // ran events that started (not blocked)
	Waiting    int // chats now waiting on a host card
	Violations []string
}

func (r HostAuditReport) String() string {
	kinds := make([]string, 0, len(r.ByKind))
	for k := range r.ByKind {
		kinds = append(kinds, k)
	}
	sort.Strings(kinds)
	var b strings.Builder
	fmt.Fprintf(&b, "%d host events, %d calls ran, %d chats waiting on a card\n", r.Events, r.Ran, r.Waiting)
	for _, k := range kinds {
		fmt.Fprintf(&b, "  %-9s %d\n", k, r.ByKind[k])
	}
	if len(r.Violations) == 0 {
		b.WriteString("PASS: zero unapproved host executions, no lease held by a card\n")
	}
	for _, v := range r.Violations {
		b.WriteString("VIOLATION: " + v + "\n")
	}
	return b.String()
}

// AuditHostSchema reads the schema db points at and audits it.
func AuditHostSchema(ctx context.Context, db *sql.DB) (HostAuditReport, error) {
	rows, err := db.QueryContext(ctx, `SELECT conversation_id, tool_call_id, tool, args_hash, kind, reason, COALESCE(detail->>'status', ''), created_at
		FROM agent_host_events ORDER BY created_at, id`)
	if err != nil {
		return HostAuditReport{}, err
	}
	defer rows.Close()
	rep := HostAuditReport{ByKind: map[string]int{}}
	var evs []HostEvent
	for rows.Next() {
		var e HostEvent
		if err := rows.Scan(&e.ConversationID, &e.ToolCallID, &e.Tool, &e.ArgsHash, &e.Kind, &e.Reason, &e.Status, &e.At); err != nil {
			return rep, err
		}
		evs = append(evs, e)
		rep.ByKind[e.Kind]++
		if e.Kind == "ran" && e.Status != "blocked" {
			rep.Ran++
		}
	}
	if err := rows.Err(); err != nil {
		return rep, err
	}
	rep.Events = len(evs)
	rep.Violations = AuditHostEvents(evs)
	lanes, err := db.QueryContext(ctx, `SELECT id, status, COALESCE(lease, ''), lease_until FROM agent_conversations WHERE status = 'host_approval'`)
	if err != nil {
		return rep, err
	}
	defer lanes.Close()
	var held []HostLaneRow
	for lanes.Next() {
		var r HostLaneRow
		if err := lanes.Scan(&r.ID, &r.Status, &r.Lease, &r.LeaseUntil); err != nil {
			return rep, err
		}
		held = append(held, r)
	}
	rep.Waiting = len(held)
	rep.Violations = append(rep.Violations, AuditHostLanes(held)...)
	return rep, lanes.Err()
}
