package chat

import (
	"context"
	"errors"
	"log"
	"slices"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/features/agent"
	"timely-api/internal/features/instance"
)

// The person's side of host cards: POST /chats/:id/host-approval (Run once,
// Allow for this chat, Deny), the step-up rule for host cards and Full
// Access (decisions 7 and 12), grants, and Undo this change.

var (
	errHostAnswered = echo.NewHTTPError(409, "This card was already answered")
	errHostStale    = echo.NewHTTPError(409, "This card changed. Read the new one first.")
	// errHostWaiting refuses Approve, Reject and discard on a host card's
	// row: it is not a proposal (decision 1).
	errHostWaiting = echo.NewHTTPError(409, "This chat is waiting for a host card, not a change review")
	// errHostLive refuses a message while a live card waits: a message
	// never answers a host card (flag 2).
	errHostLive     = echo.NewHTTPError(409, "Answer the card above first, or stop this reply")
	errPhoneLocked  = echo.NewHTTPError(403, "Unlock your phone to approve this")
	errDesktopOnly  = echo.NewHTTPError(403, "Approve this card in the desktop app")
	errFullAccess   = echo.NewHTTPError(403, "Turn on Full Access from the desktop app")
	errDesktopRule  = echo.NewHTTPError(403, "Change this from the desktop app")
	errUndoGone     = echo.NewHTTPError(409, "This change can't be undone any more")
	errNotGrantable = echo.NewHTTPError(409, "This card can't be allowed for the whole chat. Choose Run once or Deny.")
	errNoHostEngine = echo.NewHTTPError(409, "The assistant isn't running here")
	errHostOff      = echo.NewHTTPError(403, "This account can't use this computer any more")
	errMCPOff       = echo.NewHTTPError(403, "This MCP server is turned off")
	errHostExpired  = echo.NewHTTPError(409, "This card expired")
)

// hostEngine is an engine that runs host cards (WorkerEngine).
type hostEngine interface {
	Follows(uid, cid, runID string) bool
	HostAnswer(ctx context.Context, uid, cid, runID, requestID, choice, lease string) error
	HostUndo(ctx context.Context, uid, cid, checkpoint, dir string) ([]string, error)
	// HostAllowed says whether the account may use this computer now.
	HostAllowed(ctx context.Context, uid string) bool
}

// needsHostAccess is whether a card's call runs on this computer (a command
// MCP server, terminal, files, code, the browser) and so needs the account to
// be host-allowed when it is answered, not only when it was asked. A remote
// MCP tool does not; a command MCP server's tool does, and mcpTurnedOff
// covers it (its mode is off once the account is, and when the person turns
// the server off).
func needsHostAccess(h HostRequest) bool { return h.Card == nil || h.Card.Kind != cardMCP }

// mcpTurnedOff is whether a waiting MCP tool card's server is Off now: set so
// by the person, or because it runs a command on this computer and the
// account was turned off. Run once on it then closes denied.
func mcpTurnedOff(ctx context.Context, rules MCPRules, uid string, h HostRequest) bool {
	if rules == nil || h.Card == nil || h.Card.Kind != cardMCP {
		return false
	}
	return rules.Mode(ctx, uid, h.Card.Server) == mcpOff
}

// shellRequest reports a request from the desktop window: the shell token
// from this computer (instance.ShellRequest, decision 11).
var shellRequest = instance.ShellRequest

// device is the answering device as the request shows it: the desktop
// window only with the shell token; a "desktop" claim without it is a web
// browser.
func device(c *echo.Context, in *HostDevice) *HostDevice {
	d := HostDevice{Kind: "web"}
	if in != nil {
		d = *in
		d.Name = clip(dropNUL(strings.TrimSpace(d.Name)), 100)
	}
	d.Shell = shellRequest(c)
	switch {
	case d.Shell:
		d.Kind = "desktop"
	case d.Kind == "phone":
	default:
		d.Kind = "web"
	}
	if d.Kind != "phone" {
		d.Unlocked = false
	}
	return &d
}

// hostApproval is POST /chats/:id/host-approval {revision, requestId,
// choice: once|deny|chat, device}.
func (s *Service) hostApproval(c *echo.Context) error {
	var in struct {
		Revision  int         `json:"revision"`
		RequestID string      `json:"requestId"`
		Choice    string      `json:"choice"`
		Device    *HostDevice `json:"device"`
	}
	if err := c.Bind(&in); err != nil || in.RequestID == "" || len(in.RequestID) > 200 || !slices.Contains([]string{hostOnce, hostDeny, hostChat}, in.Choice) {
		return echo.NewHTTPError(400, "Invalid answer")
	}
	uid := user(c)
	if uid == "" {
		return echo.NewHTTPError(401, "Sign in to use chat")
	}
	dev := device(c, in.Device)
	if in.Choice != hostDeny {
		// Deny never needs a step-up; Run once and Allow for this chat do
		// (decision 12).
		prefs, err := chatSettings(s.db, uid)
		if err != nil {
			return err
		}
		if dev.Kind == "phone" && !dev.Unlocked {
			return errPhoneLocked
		}
		if prefs.HostApprovalRule == hostRuleDesktop && !dev.Shell {
			return errDesktopOnly
		}
	}
	row, err := s.answerHost(c.Request().Context(), uid, c.Param("id"), in.RequestID, in.Choice, dev, "")
	if err != nil {
		return err
	}
	s.fillImages(&row)
	return c.JSON(200, row)
}

// answerHost is the fenced answer (decision 3; a non-empty why is the reason a
// deny was made by the system and not by the person: the account was turned
// off): it commits only while the
// row waits on this card. A live card whose run this process follows is
// re-attached (the row runs again under a fresh lease the run adopts) and
// the answer then goes to the worker; a parked card (or a live one nobody
// here follows) queues the continuation for Run once, or closes Not run.
func (s *Service) answerHost(ctx context.Context, uid, cid, requestID, choice string, dev *HostDevice, why string) (Conversation, error) {
	he, _ := s.engine.(hostEngine)
	var row Conversation
	var asked HostRequest
	var live bool
	var lease, staleRun string
	// revoked: the account lost host access while the card waited, so the
	// answer closes it denied (Q-5.2: each account is turned on and off
	// separately). expired: a parked card past its hour.
	var revoked, expired, mcpOff bool
	var refused HostRequest // a command server's card closed without an OK
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), uid, cid, &row); err != nil {
			return err
		}
		h := row.HostRequest
		if row.Status != statusHostApproval || !h.pending() {
			return errHostAnswered
		}
		if h.RequestID != requestID {
			return errHostStale
		}
		if choice == hostChat && (h.Grant == nil || h.Card == nil || !h.Card.Grantable) {
			return errNotGrantable // the apps hide the button; the server holds the line
		}
		if choice != hostDeny && h.Phase == hostParked && h.ExpiresAt != nil && time.Now().After(*h.ExpiresAt) {
			// The sweep has not closed it yet (it runs every 30 s): a parked
			// card never runs after its hour.
			expired = true
			ev := hostEvent(uid, cid, h.Run, h.ToolCallID, h.RequestID, h.Tool, h.ArgsHash, eventExpired, "", "answered after the card's time", nil, nil)
			if err := tx.Create(&ev).Error; err != nil {
				return err
			}
			closeHostCard(&row, hostExpired, nil)
			refused = h
			row.Messages = append(row.Messages, notRun(&row, h.Card, h.Tool))
			row.Status, row.Revision = "idle", row.Revision+1
			staleRun = row.AgentRunID
			row.AgentRunID, row.AgentInstance, row.Lease, row.LeaseUntil = "", "", "", nil
			row.Activity = ChatActivity{}
			return tx.Save(&row).Error
		}
		if choice != hostDeny && needsHostAccess(h) && he != nil && !he.HostAllowed(ctx, uid) {
			// The account was turned off after the card was asked: nothing
			// runs on this computer for it, whatever the card says.
			choice, revoked = hostDeny, true
			why = "the account can't use this computer any more"
		} else if choice != hostDeny && mcpTurnedOff(ctx, s.mcp, uid, h) {
			choice, mcpOff = hostDeny, true
			why = "the MCP server is turned off"
		}
		asked = h
		live = h.Phase == hostLive && row.AgentRunID != "" && row.AgentRunID == h.Run && he != nil && he.Follows(uid, cid, h.Run)
		// Run once and Allow for this chat close the card as approved, not as
		// ran: the call has not run yet, and may never (Stop, a refused
		// continuation). The worker's host.ran settles it.
		outcome := map[string]string{hostOnce: hostApproved, hostChat: hostApproved, hostDeny: hostDenied}[choice]
		kind := eventApproved
		if choice == hostDeny {
			kind = eventDenied
		}
		reason := h.Phase
		if why != "" {
			reason = why
		}
		ev := hostEvent(uid, cid, h.Run, h.ToolCallID, h.RequestID, h.Tool, h.ArgsHash, kind, choice, reason, dev, nil)
		if err := tx.Create(&ev).Error; err != nil {
			return err
		}
		if choice == hostDeny {
			closeHostCard(&row, outcome, dev)
			refused = h
		} else {
			closeHostCardAs(&row, outcome, dev, choice)
		}
		if choice == hostChat && h.Grant != nil && row.HostGrants.match(h.Grant.Match) == nil {
			g := *h.Grant
			now := time.Now().UTC()
			g.At = &now
			row.HostGrants = append(row.HostGrants, g)
		}
		row.Error, row.ErrorAction = "", ""
		if live {
			// The re-attach: the run's follower adopts this lease (HostAnswer).
			lease = id("lease_")
			until := time.Now().UTC().Add(3 * time.Minute)
			row.Status, row.Lease, row.LeaseUntil = "running", lease, &until
		} else {
			staleRun = row.AgentRunID
			row.AgentRunID, row.AgentInstance = "", ""
			row.Activity = ChatActivity{}
			row.Lease, row.LeaseUntil = "", nil
			switch {
			case choice == hostDeny:
				row.Status = "idle"
				row.Messages = append(row.Messages, notRun(&row, h.Card, h.Tool))
			case h.Tool == cardMCPServer:
				row.Status = "idle" // the server is approved below
			default:
				row.Status, row.Phase = "queued", "plan"
				row.Continuation = continuationFor(h)
			}
		}
		row.Revision++
		return tx.Save(&row).Error
	})
	if err != nil {
		return row, err
	}
	s.refuseServerCard(ctx, uid, refused)
	if staleRun != "" && s.engine != nil {
		// A live card nobody here follows: its run (if any is left) ends.
		s.engine.Stop(uid, cid, staleRun)
	}
	if expired {
		return row, errHostExpired
	}
	if !live && asked.Tool == cardMCPServer && choice != hostDeny {
		s.approveServer(ctx, uid, cid, asked)
	}
	if live {
		// The answer is committed, so it is sent whatever happens to the
		// person's request.
		if err := he.HostAnswer(context.WithoutCancel(ctx), uid, cid, asked.Run, requestID, choice, lease); err != nil {
			if !errors.Is(err, errHostAnswerUnknown) {
				// The worker no longer waits (its live wait ended, or it is
				// gone): the answer is applied as a parked one.
				s.hostAnswerNotTaken(uid, cid, asked, choice, lease)
			}
			// With no ack in time the worker may still take the answer and
			// run the call, so no continuation is queued: the run stops, the
			// card reads approved and not run, and a late host.ran settles it.
			s.engine.Stop(uid, cid, asked.Run)
		}
	}
	var latest Conversation
	if err := s.find(s.db, uid, cid, &latest); err == nil {
		row = latest
	}
	if revoked {
		return row, errHostOff // the card closed denied; the person's Run once did not run it
	}
	if mcpOff {
		return row, errMCPOff
	}
	return row, nil
}

// hostAnswerNotTaken applies a live answer the worker did not take, fenced
// on the lease the answer wrote: the follower's own handling of the parked
// run.done may have done it first.
func (s *Service) hostAnswerNotTaken(uid, cid string, asked HostRequest, choice, lease string) {
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var row Conversation
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), uid, cid, &row); err != nil {
			return err
		}
		if row.Status != "running" || row.Lease != lease || row.AgentRunID != asked.Run {
			return errUnchanged
		}
		row.AgentRunID, row.AgentInstance = "", ""
		row.Activity = ChatActivity{}
		row.RunReads = RunReads{}
		row.Lease, row.LeaseUntil = "", nil
		if choice == hostDeny {
			row.Status = "idle"
			row.Messages = append(row.Messages, notRun(&row, asked.Card, asked.Tool))
		} else {
			row.Status, row.Phase = "queued", "plan"
			row.Continuation = continuationFor(asked)
		}
		row.Revision++
		return tx.Save(&row).Error
	})
	if err != nil && !errors.Is(err, errUnchanged) && !errors.Is(err, gorm.ErrRecordNotFound) {
		log.Printf("chat host answer: applying an answer the worker did not take: %v", err)
	}
}

// approveServer records the person's OK of a command MCP server (a
// mcp_server card): its entry hash is approved, or a notice says why not.
func (s *Service) approveServer(ctx context.Context, uid, cid string, asked HostRequest) {
	text := "Added " + asked.cardServer() + ". The assistant can use it from its next reply."
	switch {
	case s.mcp == nil:
		text = "MCP servers are not available here."
	default:
		if err := s.mcp.ApproveStdio(context.WithoutCancel(ctx), uid, asked.cardServer(), asked.ArgsHash); err != nil {
			text = "Not added: " + asked.cardServer() + " changed after this card was shown, or it can't run here. Check it in Settings → Agent → MCP servers."
			log.Printf("chat host answer: approving MCP server: %v", err)
		}
	}
	_ = s.db.Transaction(func(tx *gorm.DB) error {
		var row Conversation
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), uid, cid, &row); err != nil {
			return err
		}
		row.Messages = append(row.Messages, notice(text))
		row.Revision++
		return tx.Save(&row).Error
	})
}

// refuseServerCard tells the MCP rules that a command server's host card was
// closed without an OK (denied, stopped, expired, its chat deleted), so
// Settings says "not added" and offers Ask again instead of "waiting".
func (s *Service) refuseServerCard(ctx context.Context, uid string, h HostRequest) {
	if h.Tool != cardMCPServer || s.mcp == nil || !h.pending() {
		return
	}
	if err := s.mcp.RefuseStdio(context.WithoutCancel(ctx), uid, h.cardServer(), h.ArgsHash); err != nil {
		log.Printf("chat host answer: recording an MCP server card that was not approved: %v", err)
	}
}

func (h HostRequest) cardServer() string {
	if h.Card != nil {
		return h.Card.Server
	}
	return ""
}

// SetMCP gives the chat service the MCP rules (command server approval).
func (s *Service) SetMCP(m MCPRules) { s.mcp = m }

// RaiseServerCard opens a host card for a command MCP server the person
// added or changed (agentmcp's OnStdioPending): a new chat "Add an MCP
// server" whose card waits parked for Run once, which approves exactly
// this entry (hash).
func (s *Service) RaiseServerCard(ctx context.Context, uid, name, command string, args, envNames []string, hash string) error {
	now := time.Now().UTC()
	prefs, _ := chatSettings(s.db.WithContext(ctx), uid)
	wait := time.Duration(prefs.HostApprovalTimeoutMinutes) * time.Minute
	if wait <= 0 {
		wait = defaultHostTimeoutMinutes * time.Minute
	}
	expires := now.Add(wait)
	line := strings.TrimSpace(command + " " + strings.Join(args, " "))
	card := HostCard{Kind: cardMCPServer, Title: "Add this MCP server?", Server: clip(name, 200), Command: clip(line, 4000), EnvNames: envNames,
		Reason: "Runs this command on this computer whenever the assistant connects to " + clip(name, 200), CriticalItem: agent.CriticalSettings}
	req := HostRequest{RequestID: id("mcp_"), Phase: hostParked, Tool: cardMCPServer, ArgsHash: clip(hash, 200), Card: &card,
		AskedAt: &now, ExpiresAt: &expires}
	row := Conversation{ID: id("chat_"), UserID: uid, Title: "Add an MCP server", Status: statusHostApproval, Phase: "plan", Permission: string(agent.Supervised),
		Context: []ContextChip{}, Messages: []Message{notice("You added the MCP server " + clip(name, 200) + ". It runs a command on this computer, so it needs your OK.")},
		Plan: []Step{}, Snapshots: []Snapshot{}, Transcript: []WireMessage{}, HostRequest: req, HostGrants: HostGrants{}}
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		ev := hostEvent(uid, row.ID, "", "", req.RequestID, cardMCPServer, hash, eventRequested, "", card.Reason, nil, map[string]any{"server": name})
		if err := tx.Create(&ev).Error; err != nil {
			return err
		}
		return notify(tx, &row, tr(row.Language, txtPushHost))
	})
}

// deleteGrant is DELETE /chats/:id/host-grants/:key: the chat's grant goes
// (Remove on the permission sheet).
func (s *Service) deleteGrant(c *echo.Context) error {
	key := c.Param("key")
	return s.change(c, func(tx *gorm.DB, row *Conversation) error {
		i := slices.IndexFunc(row.HostGrants, func(g HostGrant) bool { return g.Key == key })
		if i < 0 {
			return echo.NewHTTPError(404, "This chat has no such permission")
		}
		row.HostGrants = slices.Delete(row.HostGrants, i, i+1)
		if row.HostGrants == nil {
			row.HostGrants = HostGrants{}
		}
		return nil
	})
}

// hostUndo is POST /chats/:id/host-undo {checkpointId}: "Undo this change"
// restores the checkpoint a host call left (the worker's
// checkpoint.restore).
func (s *Service) hostUndo(c *echo.Context) error {
	var in struct {
		CheckpointID string `json:"checkpointId"`
	}
	if err := c.Bind(&in); err != nil || in.CheckpointID == "" || len(in.CheckpointID) > 200 {
		return echo.NewHTTPError(400, "Invalid request")
	}
	uid, cid := user(c), c.Param("id")
	// Claim the undo under the row's lock before the worker restores, so two
	// devices asking at once restore the checkpoint once: the first marks it
	// undone, the second finds it so and is refused. A failed restore puts
	// the mark back.
	var h ClosedHost
	var undoneRun string
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var latest Conversation
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), uid, cid, &latest); err != nil {
			return err
		}
		i := slices.IndexFunc(latest.Messages, func(m Message) bool {
			return m.Host != nil && m.Host.Checkpoint == in.CheckpointID
		})
		if i < 0 || latest.Messages[i].Host.UndoneAt != nil {
			return errUndoGone
		}
		now := time.Now().UTC()
		latest.Messages[i].Host.UndoneAt = &now
		h, undoneRun = *latest.Messages[i].Host, latest.Messages[i].AgentRun
		latest.Revision++
		return tx.Save(&latest).Error
	})
	if err != nil {
		return err
	}
	unclaim := func() {
		_ = s.db.Transaction(func(tx *gorm.DB) error {
			var latest Conversation
			if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), uid, cid, &latest); err != nil {
				return err
			}
			for j := range latest.Messages {
				if m := &latest.Messages[j]; m.Host != nil && m.Host.Checkpoint == in.CheckpointID {
					m.Host.UndoneAt = nil
				}
			}
			latest.Revision++
			return tx.Save(&latest).Error
		})
	}
	he, ok := s.engine.(hostEngine)
	if !ok {
		unclaim()
		return errNoHostEngine
	}
	restored, err := he.HostUndo(c.Request().Context(), uid, cid, h.Checkpoint, h.CheckpointDir)
	if errors.Is(err, errCheckpointGone) {
		unclaim()
		return errUndoGone
	}
	if err != nil {
		unclaim()
		return echo.NewHTTPError(503, "Undo did not reach the assistant. Try again.")
	}
	ev := hostEvent(uid, cid, undoneRun, h.ToolCallID, h.RequestID, h.Tool, "", eventUndone, "", "", device(c, nil),
		map[string]any{"checkpoint": h.Checkpoint, "restored": restored})
	err = s.db.Transaction(func(tx *gorm.DB) error {
		var latest Conversation
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), uid, cid, &latest); err != nil {
			return err
		}
		latest.Messages = append(latest.Messages, notice("Undid the change to "+clip(strings.Join(restored, ", "), 400)))
		latest.Revision++
		if err := tx.Create(&ev).Error; err != nil {
			return err
		}
		return tx.Save(&latest).Error
	})
	if err != nil {
		return err
	}
	return c.JSON(200, map[string]any{"restored": restored})
}

// fullAccessStepUp is the step-up that turns Full Access on (decision 7):
// the desktop window, or, when the account allows Full Access on any of
// its devices, a phone that ran device unlock. It returns the record.
func (s *Service) fullAccessStepUp(c *echo.Context, uid string, in *HostDevice) (FullAccessRecord, error) {
	prefs, err := chatSettings(s.db, uid)
	if err != nil {
		return FullAccessRecord{}, err
	}
	dev := device(c, in)
	if !dev.Shell && !(prefs.FullAccessAllowedOn == allowedOnDevices && dev.Kind == "phone" && dev.Unlocked) {
		return FullAccessRecord{}, errFullAccess
	}
	now := time.Now().UTC()
	return FullAccessRecord{At: &now, Device: dev}, nil
}
