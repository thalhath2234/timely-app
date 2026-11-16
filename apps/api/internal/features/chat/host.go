package chat

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Host cards (phase 5, plan 3.5 and 5.5, work packages decisions 1 to 3):
// a host tool call (terminal, files, code, the browser, an MCP tool) that the
// person must OK. Unlike a question card, the row leaves 'running' for its
// own status, host_approval, with the card in host_request, so the claim
// never takes it, no lease is held while it waits, and Approve, Reject and
// discard refuse it. The worker's run waits live for up to ten minutes
// (phase live, the row still names the run); after that the run ends
// "approval_parked" and the card waits on its own (phase parked) for the
// account's approval timeout. Run once on a live card re-attaches the run
// (a fresh lease its follower adopts); on a parked card it queues a
// continuation turn whose run.start carries the approved call as
// pre_approved, which the claim clears.

// statusHostApproval is the row's status while a host card waits.
const statusHostApproval = "host_approval"

// Phases of a host card.
const (
	hostLive   = "live"
	hostParked = "parked"
)

// Choices on a host card (POST /chats/:id/host-approval).
const (
	hostOnce = "once" // Run once
	hostDeny = "deny" // Deny
	hostChat = "chat" // Allow for this chat
)

// How a host card closed (ClosedHost.Outcome), the apps' closed states:
// Ran, Allowed for this chat, Denied, Expired not run, Stopped before you
// answered.
const (
	hostRan     = "ran"
	hostAllowed = "allowed"
	hostDenied  = "denied"
	hostExpired = "expired"
	hostStopped = "stopped"
	// hostApproved is the interim state of a card the person answered Run
	// once or Allow for this chat: the call has not run yet. Only the
	// worker's host.ran (status ok) turns it into Ran or Allowed for this
	// chat; a Stop, a failed or refused continuation, or a turn that ends
	// without the call turns it into hostNotRun (review of the exit check:
	// a card must never say Ran for a call that did not).
	hostApproved = "approved"
	hostNotRun   = "notrun"
)

// Host card kinds (gate.verdict card.kind, PROTOCOL.md 12.3).
const (
	cardTerminal  = "terminal"
	cardFile      = "file"
	cardCode      = "code"
	cardBrowser   = "browser"
	cardMCP       = "mcp"
	cardMCPServer = "mcp_server"
)

// HostCard is what a host card shows, built by Go from the call's real
// arguments (never the model's own description of it). Command, Path and
// URL are plain text for the apps, never links: a tainted model may write
// them.
type HostCard struct {
	Kind         string   `json:"kind"`
	Title        string   `json:"title"`
	Command      string   `json:"command,omitempty"`
	Path         string   `json:"path,omitempty"`
	URL          string   `json:"url,omitempty"`
	Cwd          string   `json:"cwd,omitempty"`
	Server       string   `json:"server,omitempty"`
	EnvNames     []string `json:"envNames,omitempty"`
	Reason       string   `json:"reason"`
	CriticalItem int      `json:"criticalItem,omitempty"`
	Grantable    bool     `json:"grantable"`
	// SessionCwd is the terminal's recorded folder (a cd of an earlier call)
	// the call was judged in, as the worker's gate.ask said: a continuation
	// carries it so the call runs in that folder or asks again.
	SessionCwd string `json:"sessionCwd,omitempty"`
	// Session is the running command a process call is about (Hermes' session
	// id), and Stdin says the card's Command is text typed into it, not a
	// command line: the apps label it so and say it answers a running program.
	Session string `json:"session,omitempty"`
	Stdin   bool   `json:"stdin,omitempty"`
}

// wire is the card as gate.verdict carries it (snake case, PROTOCOL.md 12.3).
func (c HostCard) wire() map[string]any {
	out := map[string]any{"kind": c.Kind, "title": c.Title, "reason": c.Reason, "grantable": c.Grantable}
	for k, v := range map[string]string{"command": c.Command, "path": c.Path, "url": c.URL, "cwd": c.Cwd} {
		if v != "" {
			out[k] = v
		}
	}
	if c.CriticalItem != 0 {
		out["critical_item"] = c.CriticalItem
	}
	return out
}

// subject is the card's one-line description: the command, path, URL or
// tool it is about.
func (c HostCard) subject() string {
	for _, s := range []string{c.Command, c.Path, c.URL, c.Server} {
		if s = strings.TrimSpace(s); s != "" {
			return clip(firstLine(s), 200)
		}
	}
	return strings.TrimSuffix(c.Title, "?")
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return strings.TrimSpace(s[:i]) + " …"
	}
	return s
}

// HostRequest is the host card the row waits on (Conversation.HostRequest),
// zero ({}) when none waits. Run is the agent run that asked; it stays on
// the card after parking, when the row no longer names it.
type HostRequest struct {
	RequestID  string     `json:"requestId,omitempty"`
	Run        string     `json:"run,omitempty"`
	Phase      string     `json:"phase,omitempty"`
	Tool       string     `json:"tool,omitempty"`
	ToolCallID string     `json:"toolCallId,omitempty"`
	ArgsHash   string     `json:"argsHash,omitempty"`
	Card       *HostCard  `json:"card,omitempty"`
	AskedAt    *time.Time `json:"askedAt,omitempty"`
	LiveUntil  *time.Time `json:"liveUntil,omitempty"`
	ExpiresAt  *time.Time `json:"expiresAt,omitempty"`
	// FollowedAt is when the process that follows the run last said so while
	// the live card waits (the follower holds no lease then, so this is its
	// heartbeat): another API process on the same tables parks the card only
	// when this has gone stale.
	FollowedAt *time.Time `json:"followedAt,omitempty"`
	// Grant is what "Allow for this chat" adds (nil: not grantable).
	Grant *HostGrant `json:"grant,omitempty"`
}

func (h HostRequest) pending() bool { return h.RequestID != "" }

// lastFollowed is the newest sign that a process follows the live card's run:
// its heartbeat, else when the card was asked.
func (h HostRequest) lastFollowed() time.Time {
	var last time.Time
	for _, t := range []*time.Time{h.AskedAt, h.FollowedAt} {
		if t != nil && t.After(last) {
			last = *t
		}
	}
	return last
}

// HostGrant is one "Allow for this chat" (decision 8): Go answers allow to a
// later call of the same kind in this chat. Key names it in DELETE
// /chats/:id/host-grants/:key; Match is the kind key the gate compares.
type HostGrant struct {
	Kind  string     `json:"kind"`
	Key   string     `json:"key"`
	Match string     `json:"match"`
	Label string     `json:"label"`
	At    *time.Time `json:"at,omitempty"`
}

// HostGrants is stored as a JSON array, never null.
type HostGrants []HostGrant

func (g HostGrants) MarshalJSON() ([]byte, error) {
	if g == nil {
		return []byte("[]"), nil
	}
	return json.Marshal([]HostGrant(g))
}

// HostContinuation is a parked card's approved call waiting for the claim
// that starts its continuation turn (decision 3); zero when none waits.
type HostContinuation struct {
	Tool       string `json:"tool,omitempty"`
	ArgsHash   string `json:"argsHash,omitempty"`
	ToolCallID string `json:"toolCallId,omitempty"`
	RequestID  string `json:"requestId,omitempty"`
	Text       string `json:"text,omitempty"`
	// Cwd is the card's SessionCwd: the folder the approved call was judged in.
	Cwd string `json:"cwd,omitempty"`
}

func (h HostContinuation) pending() bool { return h.Tool != "" }

// HostDevice is the device an answer or a step-up came from. Shell is set
// by the server for a request from the desktop window (the shell token);
// Unlocked is the phone's own claim that it ran device unlock.
type HostDevice struct {
	Kind     string `json:"kind,omitempty"`
	Name     string `json:"name,omitempty"`
	Unlocked bool   `json:"unlocked,omitempty"`
	Shell    bool   `json:"shell,omitempty"`
}

// FullAccessRecord is the step-up that turned Full Access on (decision 7);
// zero when none. A chat on 'full' without one acts as Auto.
type FullAccessRecord struct {
	At     *time.Time  `json:"at,omitempty"`
	Device *HostDevice `json:"device,omitempty"`
}

func (f FullAccessRecord) on() bool { return f.At != nil }

// ClosedHost is a "host" message's card once it closed, or (Auto) a host
// call that ran without a card and left a checkpoint "Undo this change"
// can restore.
type ClosedHost struct {
	RequestID  string      `json:"requestId,omitempty"`
	ToolCallID string      `json:"toolCallId,omitempty"`
	Tool       string      `json:"tool"`
	Card       *HostCard   `json:"card,omitempty"`
	Outcome    string      `json:"outcome"`
	Device     *HostDevice `json:"device,omitempty"`
	// Choice is what the person answered (once, chat) on a card that asked;
	// it says what an approved card becomes when its call runs.
	Choice string `json:"choice,omitempty"`
	// ArgsHash names the call the card asked for, so a continuation turn's
	// host.ran (a new call id) finds it.
	ArgsHash string `json:"argsHash,omitempty"`
	// Auto marks a call that ran without a card (Auto, Full Access or a
	// grant): the message exists for its checkpoint.
	Auto bool `json:"auto,omitempty"`
	// Checkpoint and CheckpointDir are Hermes' filesystem checkpoint taken
	// before the call changed files (host.ran); UndoneAt is set once "Undo
	// this change" restored it.
	Checkpoint    string     `json:"checkpoint,omitempty"`
	CheckpointDir string     `json:"checkpointDir,omitempty"`
	UndoneAt      *time.Time `json:"undoneAt,omitempty"`
}

// hostOutcomeText is a closed card's thread text (history seeds read it).
func hostOutcomeText(card *HostCard, tool, outcome string) string {
	what := tool
	if card != nil {
		what = card.subject()
	}
	switch outcome {
	case hostRan:
		if tool == cardMCPServer && card != nil && card.Server != "" {
			return "Host card: the person approved adding the MCP server " + card.Server
		}
		return "Host card: the person chose Run once for " + what
	case hostAllowed:
		return "Host card: the person allowed " + what + " for this chat"
	case hostDenied:
		return "Host card: the person denied " + what
	case hostExpired:
		return "Host card expired, not run: " + what
	case hostApproved:
		return "Host card: the person approved " + what + ", it has not run yet"
	case hostNotRun:
		return "Host card: the person approved " + what + ", but it did not run"
	}
	return "Host card closed before the person answered, not run: " + what
}

// closeHostCard moves the row's host card into the thread with how it
// closed and clears it (status is the caller's). It returns the message id
// ("" when no card waited).
func closeHostCard(row *Conversation, outcome string, device *HostDevice) string {
	return closeHostCardAs(row, outcome, device, "")
}

// closeHostCardAs is closeHostCard for an answered card: choice (once, chat)
// is kept on the closed card.
func closeHostCardAs(row *Conversation, outcome string, device *HostDevice, choice string) string {
	h := row.HostRequest
	if !h.pending() {
		return ""
	}
	m := message("assistant", hostOutcomeText(h.Card, h.Tool, outcome))
	m.Kind = "host"
	m.Host = &ClosedHost{RequestID: h.RequestID, ToolCallID: h.ToolCallID, Tool: h.Tool, Card: h.Card, Outcome: outcome, Device: device,
		Choice: choice, ArgsHash: h.ArgsHash}
	if h.Run != "" {
		m.AgentRun = h.Run
	}
	row.Messages = append(row.Messages, m)
	row.HostRequest = HostRequest{}
	return m.ID
}

// settleHostCard moves an approved card to how its call ended. ran is true
// when the call started (host.ran ok, error or timeout): Ran, or Allowed for
// this chat after that choice; otherwise it did not run.
func settleHostCard(m *Message, ran bool) {
	if m.Kind != "host" || m.Host == nil {
		return
	}
	to := hostNotRun
	if ran {
		to = hostRan
		if m.Host.Choice == hostChat {
			to = hostAllowed
		}
	}
	m.Host.Outcome = to
	m.Content = hostOutcomeText(m.Host.Card, m.Host.Tool, to)
}

// settleHostCards turns the approved cards of a run (by the run that asked,
// or by the request a continuation carries) that never saw their call run
// into "not run". It reports whether it changed any.
func settleHostCards(row *Conversation, runID, requestID string) bool {
	changed := false
	for i := range row.Messages {
		m := &row.Messages[i]
		if m.Kind != "host" || m.Host == nil || m.Host.Outcome != hostApproved {
			continue
		}
		if (runID != "" && m.AgentRun == runID) || (requestID != "" && m.Host.RequestID == requestID) {
			settleHostCard(m, false)
			changed = true
		}
	}
	return changed
}

// settleLostContinuation closes the approved card of a continuation that
// never got to run its call (the continuation turn parked on a new card
// first) as "not run", with the notice, so the lost approval is visible.
func settleLostContinuation(row *Conversation, requestID string) {
	if requestID == "" {
		return
	}
	for i := range row.Messages {
		m := &row.Messages[i]
		if m.Kind != "host" || m.Host == nil || m.Host.Outcome != hostApproved || m.Host.RequestID != requestID {
			continue
		}
		settleHostCard(m, false)
		row.Messages = append(row.Messages, notRun(row, m.Host.Card, m.Host.Tool))
		return
	}
}

// settleAllHostCards is settleHostCards for every approved card of a chat
// that has no run any more (Retry).
func settleAllHostCards(row *Conversation) {
	for i := range row.Messages {
		if m := &row.Messages[i]; m.Kind == "host" && m.Host != nil && m.Host.Outcome == hostApproved {
			settleHostCard(m, false)
		}
	}
}

// settleApprovedNotRun is settleAllHostCards with a notice for each card it
// closes: a chat that parks with no run live and none queued (the sweep of an
// orphaned card) can run no approved call any more.
func settleApprovedNotRun(row *Conversation) {
	var gone []Message
	for i := range row.Messages {
		if m := &row.Messages[i]; m.Kind == "host" && m.Host != nil && m.Host.Outcome == hostApproved {
			settleHostCard(m, false)
			gone = append(gone, notRun(row, m.Host.Card, m.Host.Tool))
		}
	}
	row.Messages = append(row.Messages, gone...)
}

// notRun is the notice for a host call that will not run.
func notRun(row *Conversation, card *HostCard, tool string) Message {
	what := tool
	if card != nil {
		what = card.subject()
	}
	return notice(fmt.Sprintf(tr(row.Language, txtNotRun), what))
}

// continuationFor is the continuation a parked card's Run once queues.
func continuationFor(h HostRequest) HostContinuation {
	what := h.Tool
	if h.Card != nil {
		what = h.Card.subject()
	}
	cwd := ""
	if h.Card != nil {
		cwd = h.Card.SessionCwd
	}
	return HostContinuation{Tool: h.Tool, ArgsHash: h.ArgsHash, ToolCallID: h.ToolCallID, RequestID: h.RequestID, Cwd: cwd,
		Text: fmt.Sprintf("You asked to run %s (%s). The person approved it: run exactly that call now, with the same arguments, then continue.", what, h.Tool)}
}

// AgentHostEvent is one row of agent_host_events (decision 16): every host
// decision, answer, park, expiry, mapped second approval, finished call and
// undo, so each call that ran has its approval or allow before it.
type AgentHostEvent struct {
	ID             string          `gorm:"primaryKey;type:uuid" json:"id"`
	UserID         string          `gorm:"not null" json:"-"`
	ConversationID string          `gorm:"not null" json:"conversationId"`
	RunID          string          `gorm:"not null;default:''" json:"runId"`
	ToolCallID     string          `gorm:"not null;default:''" json:"toolCallId"`
	RequestID      string          `gorm:"not null;default:''" json:"requestId"`
	Tool           string          `gorm:"not null;default:''" json:"tool"`
	ArgsHash       string          `gorm:"not null;default:''" json:"argsHash"`
	Kind           string          `gorm:"not null" json:"kind"`
	Choice         string          `gorm:"not null;default:''" json:"choice"`
	Reason         string          `gorm:"not null;default:''" json:"reason"`
	Device         json.RawMessage `gorm:"type:jsonb;not null;default:'{}'" json:"device"`
	Detail         json.RawMessage `gorm:"type:jsonb;not null;default:'{}'" json:"detail"`
	CreatedAt      time.Time       `gorm:"not null" json:"createdAt"`
}

func (AgentHostEvent) TableName() string { return "agent_host_events" }

// Host event kinds (the table's CHECK).
const (
	eventRequested = "requested"
	eventApproved  = "approved"
	eventAllowed   = "allowed"
	eventDenied    = "denied"
	eventParked    = "parked"
	eventExpired   = "expired"
	eventAuto      = "auto"
	eventRan       = "ran"
	eventUndone    = "undone"
)

// hostEvent builds one event row; device and detail may be nil.
func hostEvent(uid, cid, run, toolCallID, requestID, tool, argsHash, kind, choice, reason string, device *HostDevice, detail map[string]any) AgentHostEvent {
	dev, det := json.RawMessage("{}"), json.RawMessage("{}")
	if device != nil {
		dev, _ = json.Marshal(device)
	}
	if detail != nil {
		det, _ = json.Marshal(detail)
	}
	return AgentHostEvent{ID: uuid.NewString(), UserID: uid, ConversationID: cid, RunID: run, ToolCallID: clip(toolCallID, 200),
		RequestID: clip(requestID, 200), Tool: clip(tool, 200), ArgsHash: clip(argsHash, 100), Kind: kind, Choice: choice,
		Reason: clip(reason, 500), Device: dev, Detail: det, CreatedAt: time.Now().UTC()}
}

// logHostEvent writes an event outside any transaction; a failure is logged,
// never fatal (the decision it records already happened).
func (s *Service) logHostEvent(db *gorm.DB, ev AgentHostEvent, logf func(string, ...any)) {
	if db == nil {
		db = s.db
	}
	if err := db.Create(&ev).Error; err != nil && logf != nil {
		logf("agent engine: host event %s: %v", ev.Kind, err)
	}
}
