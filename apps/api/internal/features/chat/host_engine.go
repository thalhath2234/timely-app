package chat

import (
	"context"
	"errors"
	"maps"
	"slices"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"timely-api/internal/agenthost"
	"timely-api/internal/features/agent"
)

// The agent engine's side of host cards (host.go): the gate's verdicts for
// host calls, the follower's fenced save of a card (approval.request), the
// end of a live wait (run.done approval_parked), a lost worker's card, the
// worker's host.ran and approval.auto, the live answer (HostAnswer), Undo
// (HostUndo) and the sweep that parks orphaned cards and expires parked ones.

// Defaults of the host card timers.
const (
	// defaultLiveWait is run.start.host_live_wait_s (Q-5.1: ten minutes).
	defaultLiveWait = 10 * time.Minute
	// defaultHostSweep is how often parked cards are checked for expiry.
	defaultHostSweep = 30 * time.Second
	// orphanAfter is how old a live card whose run this process does not
	// follow must be before the sweep parks it (the API restarted, or the
	// follower's process died).
	orphanAfter = 30 * time.Second
	// hostAnswerTimeout bounds approval.answer and checkpoint.restore.
	hostAnswerTimeout = 10 * time.Second
)

// hostPending is what a host verdict decided for one call, kept until the
// worker's approval.request (the card) or host.ran (the call finished).
type hostPending struct {
	card     HostCard
	grant    *HostGrant
	tool     string
	argsHash string
	verdict  string
}

// errHostWait refuses a follower save while the row waits on a host card:
// the row is not 'running' and no lease is held, so the save is kept for
// after the answer instead of failing the fence (which would stop the run).
var errHostWait = errors.New("the run waits on a host card")

// hostWaiting is the request the row's live card names ("" when none).
func (r *agentRun) hostWaiting() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.hostWait
}

// gateHost answers a gate.ask for a host or MCP call; false when the tool is
// neither (the caller keeps phase 2's block).
func (e *WorkerEngine) gateHost(r *agentRun, m agenthost.Message, ask gateAsk) bool {
	ctx, cancel := context.WithTimeout(r.ctx, 15*time.Second)
	defer cancel()
	st := e.hostState(ctx, r, ask)
	d, ok := decideHost(ctx, ask, st)
	if !ok {
		return false
	}
	reply := map[string]any{"verdict": d.verdict, "message": d.message}
	if d.verdict == "approve" {
		reply["card"] = d.card.wire()
	}
	if d.verdict == "allow" && d.by != "" {
		reply["by"] = d.by
	}
	if r.cards == nil {
		r.cards = map[string]hostPending{}
	}
	if d.verdict != "block" {
		r.cards[ask.ToolCallID] = hostPending{card: d.card, grant: d.grant, tool: ask.Tool, argsHash: ask.ArgsHash, verdict: d.verdict}
	}
	_ = r.worker.Reply(m, agenthost.TypeGateVerdict, reply)
	detail := map[string]any{"toolset": ask.Toolset, "mode": string(st.mode)}
	if ask.Inner {
		detail["inner"] = true
	}
	if d.card.CriticalItem != 0 {
		detail["critical_item"] = d.card.CriticalItem
	}
	switch d.verdict {
	case "allow":
		e.s.logHostEvent(nil, hostEvent(r.uid, r.cid, r.id, ask.ToolCallID, "", ask.Tool, ask.ArgsHash, eventAllowed, "", d.reason, nil, detail), e.opts.Logf)
	case "block":
		e.s.logHostEvent(nil, hostEvent(r.uid, r.cid, r.id, ask.ToolCallID, "", ask.Tool, ask.ArgsHash, eventDenied, "", "blocked: "+d.message, nil, detail), e.opts.Logf)
	}
	return true
}

// hostState reads what a host decision needs. The chat's mode, Full Access
// record, grants and taint are read from the stored row at each call, so a
// stricter mode applies from the next call (plan 5.5b).
func (e *WorkerEngine) hostState(ctx context.Context, r *agentRun, ask gateAsk) hostState {
	st := hostState{uid: r.uid, answerOnly: r.tools.answerOnly, sensitive: r.conv.Sensitive, noPersist: r.noPersist, mcp: e.opts.MCP,
		hosts: personHosts(r.conv.Messages)}
	st.hostAllowed = r.hostAllowed && e.opts.HostAllowed(ctx, r.uid)
	st.workingDir = e.workingDir(ctx, r.uid)
	row := r.conv
	var rows []Conversation
	if err := e.s.db.WithContext(ctx).Select("permission", "full_access", "host_grants", "tainted_sources", "sensitive").
		Where("id = ? AND user_id = ?", r.cid, r.uid).Limit(1).Find(&rows).Error; err == nil && len(rows) == 1 {
		row = rows[0]
	}
	st.sensitive = st.sensitive || row.Sensitive
	st.grants = row.HostGrants
	st.tainted = len(row.TaintedSources) > 0 || len(r.taint) > 0 || len(ask.Tainted) > 0
	st.mode = effectiveMode(row.Permission, row.FullAccess)
	return st
}

// effectiveMode is the mode host calls follow: Full Access without a
// step-up record acts as Auto (decision 7), an unknown mode as Supervised.
func effectiveMode(permission string, record FullAccessRecord) agent.Mode {
	mode, err := agent.ParseMode(permission)
	if err != nil {
		return agent.Supervised
	}
	if mode == agent.Full && !record.on() {
		return agent.Auto
	}
	return mode
}

// workingDir is the account's working folder: the one chosen in the
// desktop window, else its agent workspace (decision 10).
func (e *WorkerEngine) workingDir(ctx context.Context, uid string) string {
	if e.opts.HostWorkingDir != nil {
		if dir := strings.TrimSpace(e.opts.HostWorkingDir(ctx, uid)); dir != "" {
			return dir
		}
	}
	if e.sup != nil {
		return e.sup.Layout().Workspace(uid)
	}
	return ""
}

// hostToolsets are the host and MCP toolsets of a chat run (decision 9,
// PROTOCOL.md 12.2): the host toolsets for a host-allowed account, and
// mcp-<server> for every server that is not Off. A run that only answers,
// keeps nothing or belongs to a Sensitive chat gets none.
func (e *WorkerEngine) hostToolsets(ctx context.Context, c *Conversation, tools *toolRun, noPersist, hostAllowed bool) []string {
	if tools.answerOnly || noPersist || c.Sensitive {
		return nil
	}
	var out []string
	if hostAllowed {
		out = append(out, hostToolsets...)
	}
	if e.opts.MCP != nil {
		servers := e.opts.MCP.Servers(ctx, c.UserID)
		names := make([]string, 0, len(servers))
		for name, mode := range servers {
			if mode != mcpOff && name != "" {
				names = append(names, name)
			}
		}
		slices.Sort(names)
		for _, name := range names {
			out = append(out, "mcp-"+name)
		}
	}
	return out
}

// hostSave is the follower's fenced save while it holds the run: the row
// is 'running', names this run and carries its lease. It does not renew
// the lease (a card's save clears it).
func (e *WorkerEngine) hostSave(r *agentRun, fn func(*gorm.DB, *Conversation) error) error {
	r.mu.Lock()
	lease := r.lease
	r.mu.Unlock()
	var saved Conversation
	err := e.s.db.Transaction(func(tx *gorm.DB) error {
		if err := e.s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), r.uid, r.cid, &saved); err != nil {
			return err
		}
		if saved.Status != "running" || saved.Lease != lease || lease == "" || saved.AgentRunID != r.id {
			return context.Canceled
		}
		if err := fn(tx, &saved); err != nil {
			return err
		}
		saved.Revision++
		return tx.Save(&saved).Error
	})
	if err == nil {
		r.conv = saved
	}
	return err
}

// askHost handles approval.request: the card goes on the row in one fenced
// save (status host_approval, no lease), with the run's activity and taint
// and one push. The follower then stops renewing and saving until the
// answer re-attaches it. A second card of the same run waits in memory for
// the first to be answered.
func (e *WorkerEngine) askHost(r *agentRun, ev workerEvent) {
	p := ev.Payload
	if p.RequestID == "" {
		e.opts.Logf("agent engine: run %s sent an approval.request without request_id", r.id)
		return
	}
	if waiting := r.hostWaiting(); waiting != "" {
		if waiting != p.RequestID {
			r.hostQueue = append(r.hostQueue, ev)
		}
		return
	}
	e.writeHostCard(r, ev)
}

// writeHostCard saves the card of an approval.request.
func (e *WorkerEngine) writeHostCard(r *agentRun, ev workerEvent) {
	p := ev.Payload
	pend, known := r.cards[p.ToolCallID]
	tool, argsHash := p.Tool, p.ArgsHash
	if tool == "" {
		tool = pend.tool
	}
	if argsHash == "" {
		argsHash = pend.argsHash
	}
	card := pend.card
	if !known {
		// Hermes asked for a call Go did not card (it should not happen: the
		// worker denies those). Show what Hermes says, and grant nothing.
		card = HostCard{Kind: cardTerminal, Title: "Run this?", Command: clip(firstNonEmpty(p.Command, p.Description, tool), 4000), Reason: "The assistant asks to run this"}
	}
	grant := pend.grant
	if p.HermesFlag {
		// Go let this call run by its mode alone, and Hermes' own check
		// flagged it: the person decides, once, and nothing grants it.
		card.Reason = "Hermes' own safety check flagged this: " + firstNonEmpty(clip(p.Description, 200), "a dangerous command or a protected file")
		if card.CriticalItem == 0 {
			card.CriticalItem = agent.CriticalDeleting
		}
		card.Grantable, grant = false, nil
	}
	now := time.Now().UTC()
	wait := e.opts.LiveWait
	if p.LiveWaitS > 0 {
		wait = time.Duration(p.LiveWaitS) * time.Second
	}
	until := now.Add(wait)
	req := HostRequest{RequestID: clip(dropNUL(p.RequestID), 200), Run: r.id, Phase: hostLive, Tool: clip(tool, 200), ToolCallID: clip(p.ToolCallID, 200),
		ArgsHash: clip(argsHash, 100), Card: &card, AskedAt: &now, LiveUntil: &until, Grant: grant}
	activity := r.live.activity()
	taint := r.taint
	r.taint = nil
	err := e.hostSave(r, func(tx *gorm.DB, row *Conversation) error {
		row.Activity = activity
		r.tools.save(row, r.id)
		mergeTaint(row, taint)
		row.Status = statusHostApproval
		row.HostRequest = req
		row.Lease, row.LeaseUntil = "", nil
		ev := hostEvent(r.uid, r.cid, r.id, req.ToolCallID, req.RequestID, req.Tool, req.ArgsHash, eventRequested, "", card.Reason, nil,
			map[string]any{"kind": card.Kind, "critical_item": card.CriticalItem})
		if err := tx.Create(&ev).Error; err != nil {
			return err
		}
		return notify(tx, row, tr(row.Language, txtPushHost))
	})
	if err == nil {
		r.mu.Lock()
		r.hostWait, r.lease = req.RequestID, ""
		if r.requestCall == nil {
			r.requestCall = map[string]string{}
		}
		r.requestCall[req.RequestID] = req.ToolCallID
		r.mu.Unlock()
		r.dirty = false
		return
	}
	r.taint = append(taint, r.taint...)
	if !fenced(err) {
		e.opts.Logf("agent engine: saving run %s's host card: %v", r.id, err)
	} else {
		e.stopWorkerRun(r, "fenced")
	}
	// Nobody can see this card: the call is denied rather than left waiting.
	go func() { _ = e.sendHostAnswer(r, req.RequestID, hostDeny) }()
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// sendHostAnswer sends approval.answer; nil only when the worker took it.
func (e *WorkerEngine) sendHostAnswer(r *agentRun, requestID, choice string) error {
	wire := hostOnce
	if choice == hostDeny {
		wire = hostDeny
	}
	ctx, cancel := context.WithTimeout(context.Background(), hostAnswerTimeout)
	defer cancel()
	reply, err := r.worker.Request(ctx, agenthost.TypeApprovalAnswer, map[string]any{"run": r.id, "request_id": requestID, "choice": wire})
	if err != nil {
		return err
	}
	var ack struct {
		OK bool `json:"ok"`
	}
	if err := reply.Decode(&ack); err != nil || !ack.OK {
		return errNotFollowing
	}
	return nil
}

// Follows reports whether this process follows the run (a live answer can
// re-attach it here).
func (e *WorkerEngine) Follows(uid, cid, runID string) bool {
	e.mu.Lock()
	r := e.runs[runID]
	e.mu.Unlock()
	return r != nil && r.uid == uid && r.cid == cid && !exited(r.worker)
}

// HostAllowed says whether the account may use this computer now (the
// desktop window's list, TIMELY_AGENT_HOST_ACCOUNTS).
func (e *WorkerEngine) HostAllowed(ctx context.Context, uid string) bool {
	return e.opts.HostAllowed(ctx, uid)
}

// HostAnswer passes the person's answer to a live host card once the fenced
// answer committed (Service.answerHost): the run adopts the fresh lease the
// answer wrote (the re-attach), then approval.answer goes to the worker. An
// error means the worker did not take it (the wait ended there, or no
// worker of this process runs it); the caller then applies the answer as a
// parked one.
func (e *WorkerEngine) HostAnswer(ctx context.Context, uid, cid, runID, requestID, choice, lease string) error {
	e.mu.Lock()
	r := e.runs[runID]
	e.mu.Unlock()
	if r == nil || r.uid != uid || r.cid != cid {
		return errRunElsewhere
	}
	r.mu.Lock()
	if r.answered == nil {
		r.answered = map[string]string{}
	}
	r.answered[requestID] = choice
	if r.hostWait == requestID {
		r.hostWait = ""
	}
	if lease != "" {
		r.lease = lease
	}
	if call := r.requestCall[requestID]; call != "" && choice != hostDeny {
		if r.answeredCalls == nil {
			r.answeredCalls = map[string]string{}
		}
		r.answeredCalls[call] = choice
	}
	r.mu.Unlock()
	if err := e.sendHostAnswer(r, requestID, choice); err != nil {
		return err
	}
	// The follower writes the next card of the run, if one waits, and
	// what it held back during the wait.
	r.queue.push(runItem{end: "reattached"})
	return nil
}

// reattached runs on the follower after a live answer re-attached the run.
func (e *WorkerEngine) reattached(r *agentRun) {
	if r.hostWaiting() != "" {
		return
	}
	for len(r.hostQueue) > 0 && r.hostWaiting() == "" {
		next := r.hostQueue[0]
		r.hostQueue = r.hostQueue[1:]
		e.writeHostCard(r, next)
	}
	ran := r.ranLater
	r.ranLater = nil
	for _, ev := range ran {
		e.settleRan(r, ev)
	}
	r.dirty = true
}

// runParked is run.done's parked call (approval_parked).
type runParked struct {
	RequestID  string `json:"request_id"`
	Tool       string `json:"tool"`
	ArgsHash   string `json:"args_hash"`
	ToolCallID string `json:"tool_call_id"`
}

// parkFor is how long a parked card waits for the account (its approval
// timeout, 10 to 60 minutes).
func (e *WorkerEngine) parkFor(ctx context.Context, uid string) time.Duration {
	if e.opts.ParkFor != nil {
		if d := e.opts.ParkFor(ctx, uid); d > 0 {
			return d
		}
	}
	prefs, err := chatSettings(e.s.db.WithContext(ctx), uid)
	if err != nil || prefs.HostApprovalTimeoutMinutes < minHostTimeoutMinutes || prefs.HostApprovalTimeoutMinutes > maxHostTimeoutMinutes {
		return defaultHostTimeoutMinutes * time.Minute
	}
	return time.Duration(prefs.HostApprovalTimeoutMinutes) * time.Minute
}

// parkCard turns the row's live card into a parked one: the run is over,
// so the row names none and the card waits on its own until expires.
func parkCard(row *Conversation, now time.Time, wait time.Duration) {
	expires := now.Add(wait)
	row.HostRequest.Phase = hostParked
	row.HostRequest.ExpiresAt = &expires
	row.AgentRunID, row.AgentInstance = "", ""
	row.Activity = ChatActivity{}
	row.RunReads = RunReads{}
	row.Lease, row.LeaseUntil = "", nil
	closeQuestion(row, nil, outcomeStopped)
}

// parkRun ends a run whose live wait ended (run.done approval_parked,
// decision 2). The card on the row parks; a card the person answered while
// the worker was parking it (the row is running under the answer's lease)
// becomes what the answer asked for: a continuation for Run once, Not run
// for Deny; a card whose save failed is written parked now.
func (e *WorkerEngine) parkRun(r *agentRun, d runDone) {
	e.keepRunTaint(r)
	taint := r.taint
	r.mu.Lock()
	lease := r.lease
	answered := maps.Clone(r.answered)
	r.mu.Unlock()
	parked := runParked{}
	if d.Parked != nil {
		parked = *d.Parked
	}
	final := strings.TrimSpace(d.Final)
	ctx := context.Background()
	wait := e.parkFor(ctx, r.uid)
	now := time.Now().UTC()
	err := e.s.db.Transaction(func(tx *gorm.DB) error {
		var row Conversation
		if err := e.s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), r.uid, r.cid, &row); err != nil {
			return err
		}
		mergeTaint(&row, taint)
		mergeTaint(&row, r.tools.bots.taint())
		reply := func() {
			if final != "" {
				row.Messages = append(row.Messages, message("assistant", final))
				markEngine(&row, len(row.Messages)-1, r.id)
			}
		}
		switch {
		case row.Status == statusHostApproval && row.AgentRunID == r.id && row.HostRequest.pending():
			parkCard(&row, now, wait)
			reply()
		case row.Status == "running" && row.AgentRunID == r.id && lease != "" && row.Lease == lease:
			choice := answered[parked.RequestID]
			pend := r.cards[parked.ToolCallID]
			card := pend.card
			req := HostRequest{RequestID: parked.RequestID, Run: r.id, Phase: hostParked, Tool: firstNonEmpty(parked.Tool, pend.tool),
				ToolCallID: parked.ToolCallID, ArgsHash: firstNonEmpty(parked.ArgsHash, pend.argsHash), Card: &card, AskedAt: &now}
			r.tools.keepCards = true // the approved card stays: its continuation runs the call
			endRun(&row, r.tools)
			row.Lease, row.LeaseUntil = "", nil
			reply()
			switch choice {
			case hostOnce, hostChat:
				// Run once reached the worker after its wait ended: the
				// approved call runs in a continuation turn.
				row.Status, row.Phase, row.Error = "queued", "plan", ""
				row.Continuation = continuationFor(req)
			case hostDeny:
				row.Status = "idle"
				row.Messages = append(row.Messages, notRun(&row, &card, req.Tool))
			default:
				if parked.RequestID == "" {
					return errUnchanged
				}
				// The card never reached the row: it waits parked now.
				row.Status = statusHostApproval
				row.HostRequest = req
				row.HostRequest.Grant = pend.grant
				parkCard(&row, now, wait)
				if err := notify(tx, &row, tr(row.Language, txtPushHost)); err != nil {
					return err
				}
			}
		default:
			return errUnchanged
		}
		row.Revision++
		return tx.Save(&row).Error
	})
	if err != nil && !errors.Is(err, errUnchanged) && !errors.Is(err, gorm.ErrRecordNotFound) && !fenced(err) {
		e.opts.Logf("agent engine: parking run %s: %v", r.id, err)
	}
}

// parkLost parks a live card whose worker exited (decision 2: nothing ran,
// so the card stays answerable). false when the row waits on no card of
// this run.
func (e *WorkerEngine) parkLost(r *agentRun) bool {
	if r.hostWaiting() == "" {
		return false
	}
	return e.s.parkOrphan(context.Background(), r.uid, r.cid, r.id, e.parkFor(context.Background(), r.uid), "the worker stopped", e.opts.Logf) == nil
}

// parkOrphan parks the live card of run on the row, fenced on the run.
func (s *Service) parkOrphan(ctx context.Context, uid, cid, run string, wait time.Duration, why string, logf func(string, ...any)) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row Conversation
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), uid, cid, &row); err != nil {
			return err
		}
		h := row.HostRequest
		if row.Status != statusHostApproval || h.Phase != hostLive || row.AgentRunID != run || run == "" {
			return errUnchanged
		}
		parkCard(&row, time.Now().UTC(), wait)
		ev := hostEvent(uid, cid, run, h.ToolCallID, h.RequestID, h.Tool, h.ArgsHash, eventParked, "", why, nil, nil)
		if err := tx.Create(&ev).Error; err != nil {
			return err
		}
		row.Revision++
		return tx.Save(&row).Error
	})
}

// hostRan handles host.ran: the call finished (or never started). It is
// logged, and it settles the card the person approved for it: Ran or Allowed
// for this chat only when the call started, "not run" when it did not (a
// fence, a Hermes cancellation, a Stop). A checkpoint Hermes took before the
// call changed files goes on the call's closed card, or on a message of its
// own for a call that ran without one, so "Undo this change" can restore it.
func (e *WorkerEngine) hostRan(r *agentRun, ev workerEvent) {
	p := ev.Payload
	detail := map[string]any{"status": p.Status}
	if p.Checkpoint != "" {
		detail["checkpoint"], detail["checkpoint_dir"] = p.Checkpoint, p.CheckpointDir
	}
	e.s.logHostEvent(nil, hostEvent(r.uid, r.cid, r.id, p.ToolCallID, "", p.Tool, p.ArgsHash, eventRan, "", "", nil, detail), e.opts.Logf)
	e.settleRan(r, ev)
}

// started is whether a host.ran status says the call started. "interrupted"
// is an error after a Stop: the call started and the Stop cut it short.
func started(status string) bool {
	return status == "ok" || status == "error" || status == "timeout" || status == "interrupted"
}

// approvedCard finds the approved card a host.ran belongs to: by tool call
// id for a live answer, by request, tool and arguments for a continuation.
// When ran is true the call started, so a card a Stop already closed as
// "not run" (host.ran arrived after it) matches too: host.ran is the truth.
func (r *agentRun) approvedCard(row *Conversation, p struct{ tool, call, hash string }, ran bool) int {
	for i := len(row.Messages) - 1; i >= 0; i-- {
		m := &row.Messages[i]
		if m.Kind != "host" || m.Host == nil || !(m.Host.Outcome == hostApproved || (ran && m.Host.Outcome == hostNotRun && m.AgentRun == r.id)) {
			continue
		}
		if p.call != "" && m.Host.ToolCallID == p.call {
			return i
		}
		if r.cont != nil && m.Host.RequestID == r.cont.RequestID && p.tool == r.cont.Tool && p.hash == r.cont.ArgsHash {
			return i
		}
	}
	return -1
}

// settleRan writes what a host.ran changes on the row: the approved card's
// outcome and the checkpoint. A wait on another card holds it back (the row
// is not saveable then); reattached replays it.
func (e *WorkerEngine) settleRan(r *agentRun, ev workerEvent) {
	p := ev.Payload
	r.mu.Lock()
	_, answered := r.answeredCalls[p.ToolCallID]
	r.mu.Unlock()
	checkpoint := p.Checkpoint != "" && p.Status == "ok"
	if !checkpoint && !answered && r.cont == nil {
		return // a call that needs no card settled and left no checkpoint
	}
	key := struct{ tool, call, hash string }{p.Tool, p.ToolCallID, p.ArgsHash}
	if r.hostWaiting() != "" {
		// The row is another card's now and not the follower's to save: the
		// approved card settles in place, under the row's lock (a Stop while
		// that card waits must not turn a call that ran into "not run"); the
		// checkpoint waits for the re-attach.
		e.settleWaiting(r, key, started(p.Status))
		if checkpoint {
			r.ranLater = append(r.ranLater, ev)
		}
		return
	}
	pend := r.cards[p.ToolCallID]
	err := e.save(r, func(tx *gorm.DB, row *Conversation) error {
		i := r.approvedCard(row, key, started(p.Status))
		if i >= 0 {
			settleHostCard(&row.Messages[i], started(p.Status))
		}
		if !checkpoint {
			return nil
		}
		for j := len(row.Messages) - 1; j >= 0; j-- {
			if m := &row.Messages[j]; m.Kind == "host" && m.Host != nil && p.ToolCallID != "" && m.Host.ToolCallID == p.ToolCallID {
				m.Host.Checkpoint, m.Host.CheckpointDir = clip(p.Checkpoint, 200), clip(p.CheckpointDir, 2000)
				return nil
			}
		}
		if i >= 0 { // a continuation's call has its own id: the card it settled carries the checkpoint
			m := &row.Messages[i]
			m.Host.Checkpoint, m.Host.CheckpointDir = clip(p.Checkpoint, 200), clip(p.CheckpointDir, 2000)
			return nil
		}
		card := pend.card
		if card.Title == "" {
			card = HostCard{Kind: cardFile, Title: "Change this file?", Path: clip(p.CheckpointDir, 1000)}
		}
		m := message("assistant", "Changed on this computer: "+card.subject())
		m.Kind = "host"
		m.Host = &ClosedHost{ToolCallID: clip(p.ToolCallID, 200), Tool: clip(p.Tool, 200), Card: &card, Outcome: hostRan, Auto: true,
			Checkpoint: clip(p.Checkpoint, 200), CheckpointDir: clip(p.CheckpointDir, 2000)}
		m.Engine, m.AgentRun = engineAgent, r.id
		row.Messages = append(row.Messages, m)
		return nil
	})
	if err != nil && fenced(err) {
		// A Stop (or Delete) took the row first: the follower may not save,
		// but the call's own report still decides its card. Settle it under
		// the row's lock, as a wait on another card does.
		e.settleWaiting(r, key, started(p.Status))
		return
	}
	if err != nil {
		e.opts.Logf("agent engine: recording run %s's host call: %v", r.id, err)
	}
}

// settleWaiting settles the approved card of a host.ran that arrived while
// another card waits on the row.
func (e *WorkerEngine) settleWaiting(r *agentRun, key struct{ tool, call, hash string }, ran bool) {
	err := e.s.db.Transaction(func(tx *gorm.DB) error {
		var row Conversation
		if err := e.s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), r.uid, r.cid, &row); err != nil {
			return err
		}
		i := r.approvedCard(&row, key, ran)
		if i < 0 {
			return errUnchanged
		}
		settleHostCard(&row.Messages[i], ran)
		row.Revision++
		return tx.Save(&row).Error
	})
	if err != nil && !errors.Is(err, errUnchanged) && !errors.Is(err, gorm.ErrRecordNotFound) {
		e.opts.Logf("agent engine: settling run %s's approved card: %v", r.id, err)
	}
}

// HostUndo restores the checkpoint a host call left (checkpoint.restore,
// PROTOCOL.md 12.6): the files it changed come back. It needs the
// account's worker, which it starts when none runs.
func (e *WorkerEngine) HostUndo(ctx context.Context, uid, cid, checkpoint, dir string) ([]string, error) {
	if e.sup == nil {
		return nil, errNoEngine
	}
	ensureCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	w, err := e.sup.Ensure(ensureCtx, uid)
	cancel()
	if err != nil {
		return nil, err
	}
	ctx, cancel = context.WithTimeout(ctx, 2*hostAnswerTimeout)
	defer cancel()
	reply, err := w.Request(ctx, "checkpoint.restore", map[string]any{"checkpoint": checkpoint, "working_dir": dir})
	if err != nil {
		return nil, err
	}
	var out struct {
		OK       bool     `json:"ok"`
		Restored []string `json:"restored"`
		Error    string   `json:"error"`
	}
	if err := reply.Decode(&out); err != nil {
		return nil, err
	}
	if !out.OK {
		return nil, errCheckpointGone
	}
	if out.Restored == nil {
		out.Restored = []string{}
	}
	return out.Restored, nil
}

var errCheckpointGone = errors.New("the checkpoint is gone")

// sweepHost denies the cards of accounts that lost host access, expires parked cards past their time and parks live cards whose
// run no process of this API follows. It runs every HostSweepEvery.
func (e *WorkerEngine) sweepHost(ctx context.Context) {
	var rows []Conversation
	if err := e.s.db.WithContext(ctx).Select("id", "user_id", "agent_run_id", "host_request").
		Where("status = ?", statusHostApproval).Limit(500).Find(&rows).Error; err != nil {
		if ctx.Err() == nil {
			e.opts.Logf("agent engine: host card sweep: %v", err)
		}
		return
	}
	now := time.Now().UTC()
	for _, row := range rows {
		h := row.HostRequest
		switch {
		case needsHostAccess(h) && !e.opts.HostAllowed(ctx, row.UserID):
			// Turning an account off denies its waiting cards (Q-5.2); the
			// worker of a live one gets the deny.
			if _, err := e.s.answerHostWhy(ctx, row.UserID, row.ID, h.RequestID, hostDeny, nil, "the account can't use this computer any more"); err != nil && !errors.Is(err, errUnchanged) && !errors.Is(err, errHostAnswered) && !errors.Is(err, errHostStale) {
				e.opts.Logf("agent engine: denying a host card of an account that was turned off: %v", err)
			}
		case h.Phase == hostParked && h.ExpiresAt != nil && now.After(*h.ExpiresAt):
			if err := e.s.expireHost(ctx, row.UserID, row.ID, h.RequestID); err != nil && !errors.Is(err, errUnchanged) {
				e.opts.Logf("agent engine: expiring a host card: %v", err)
			}
		case h.Phase == hostLive && !e.Follows(row.UserID, row.ID, row.AgentRunID) && h.AskedAt != nil && now.Sub(*h.AskedAt) > e.opts.OrphanAfter:
			if err := e.s.parkOrphan(ctx, row.UserID, row.ID, row.AgentRunID, e.parkFor(ctx, row.UserID), "no process follows the run", e.opts.Logf); err != nil && !errors.Is(err, errUnchanged) {
				e.opts.Logf("agent engine: parking an orphaned host card: %v", err)
			}
		}
	}
}

// expireHost closes a parked card past its time: "Expired, not run".
func (s *Service) expireHost(ctx context.Context, uid, cid, requestID string) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row Conversation
		if err := s.find(tx.Clauses(clause.Locking{Strength: "UPDATE"}), uid, cid, &row); err != nil {
			return err
		}
		h := row.HostRequest
		if row.Status != statusHostApproval || h.Phase != hostParked || h.RequestID != requestID || h.ExpiresAt == nil || time.Now().Before(*h.ExpiresAt) {
			return errUnchanged
		}
		ev := hostEvent(uid, cid, h.Run, h.ToolCallID, h.RequestID, h.Tool, h.ArgsHash, eventExpired, "", "the card waited past its time", nil, nil)
		if err := tx.Create(&ev).Error; err != nil {
			return err
		}
		closeHostCard(&row, hostExpired, nil)
		row.Messages = append(row.Messages, notRun(&row, h.Card, h.Tool))
		row.Status = "idle"
		row.Revision++
		return tx.Save(&row).Error
	})
}

// sweepLoop runs sweepHost until ctx ends.
func (e *WorkerEngine) sweepLoop(ctx context.Context) {
	defer e.sweeping.Done()
	t := time.NewTicker(e.opts.HostSweepEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			e.sweepHost(ctx)
		}
	}
}

// SetMCP gives the engine the account's MCP rules (the gate's modes and
// classes, the servers a run offers).
func (e *WorkerEngine) SetMCP(m MCPRules) { e.opts.MCP = m }
