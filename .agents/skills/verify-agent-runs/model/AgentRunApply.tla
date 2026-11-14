---------------------------- MODULE AgentRunApply ----------------------------
(***************************************************************************)
(* A chat's runs, from the turn that records a proposal to the apply that  *)
(* writes the person's data: several chat pollers (three lanes per API     *)
(* process; the main checkout and every worktree poll the same             *)
(* `conversations` table) race to claim one conversation, while leases    *)
(* expire, processes crash, commits are lost on the wire, and the person   *)
(* presses Stop, Retry and Approve, changes the chat's permission mode, or *)
(* deletes the chat.                                                       *)
(*                                                                         *)
(* A plan turn runs on one of two engines (plan phase 2):                  *)
(*   classic  the lane that claimed the row runs the turn (plan()) under   *)
(*            keepLease, then ends it with finishTurn;                     *)
(*   agent    the lane hands the turn to the agent engine (Start), names   *)
(*            the run on the row and goes back to claiming. A follower in  *)
(*            the same API process then renews the lease and ends the turn *)
(*            with the same finishTurn. A lane that re-claims an expired   *)
(*            agent row calls Lost: re-attach, or fail with Try again.     *)
(* Either engine writes the person's data only through a proposal and the  *)
(* model-free apply (ADR 0007): a turn writes nothing itself.              *)
(*                                                                         *)
(* Phase 4 (Q-4.3): an agent run may wait on a question card. The follower *)
(* writes the card (Ask) and clears it when the worker's wait ends         *)
(* (CloseQuestion) through its fenced save; the row stays running, so the  *)
(* claim, the lease, Stop, Delete and Lost treat the wait as any live run. *)
(* The person's answer (Answer) is fenced on the run that asked.           *)
(*                                                                         *)
(* Phase 5 (Q-5.1): an agent run may wait on a host card. The follower     *)
(* writes it in a fenced save that moves the row to its own status,        *)
(* host_approval, with no lease (AskHost); the claim never takes it, and   *)
(* Approve and Reject refuse it. The worker waits live; when the wait ends *)
(* the run ends and the card parks (ParkHost, ParkOrphan). Run once on a   *)
(* live card re-attaches the run under a fresh lease (AnswerHostLive,      *)
(* DeliverHost); on a parked card it queues a continuation the claim       *)
(* takes off the row (AnswerHostParked, Claim). Stop and Delete deny a     *)
(* waiting card and stop the worker's run; the worker runs the approved    *)
(* call at most once (RunHostTool).                                        *)
(*                                                                         *)
(* Every action below is ONE database transaction (or one statement) in    *)
(* the code; the comment on each action names it. See ../SKILL.md for the *)
(* coverage record.                                                        *)
(*                                                                         *)
(* The boolean constants are guards in the code. run.sh derives each one   *)
(* from an anchor string in the Go source, so removing a guard in the code *)
(* removes it here.                                                        *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS
    Workers,        \* chat pollers: Service.work lanes across API processes
    NSteps,         \* steps in the proposal's Plan
    MaxLeases,      \* bound on claims (each claim mints a fresh lease id)
    MaxStops,       \* bound on Stop presses
    MaxRetries,     \* bound on Retry presses
    MaxCrashes,     \* bound on API process deaths
    MaxSends,       \* bound on new messages sent into the chat
    MaxSwitches,    \* bound on permission mode changes (PATCH /chats/:id)
    AllowDelete,    \* whether the person may delete the chat
    AllowAgent,     \* whether a plan turn may run on the agent engine
    Mode,           \* the chat's permission mode at the start: "supervised" | "auto"
    FromMessage,    \* TRUE: start from a new message (plan turn first);
                    \* FALSE: start from a proposal waiting for approval
    \* Guards in the code (TRUE = present). See run.sh / coverage.go.
    ClaimLocksRow,         \* work(): claim SELECT ... FOR UPDATE SKIP LOCKED
    StepFenced,            \* apply(): row.Status != "running" || row.Lease != c.Lease
    WritesInStepTx,        \* apply(): catalog := s.factory(tx); tools write through tx
    ApplySkipsDone,        \* apply(): if c.Plan[i].Status == "done" ... { continue }
    CheckpointFenced,      \* checkpoint(): latest.Lease != c.Lease || latest.Status != "running"
    CheckpointReadsLatest, \* checkpoint(): fn(tx, &latest); tx.Save(&latest)
    RetryKeepsDone,        \* retry(): only steps with Status != "done" go back to pending
    HoldsSupervised,       \* holdReason(): mode == agent.Supervised holds the proposal
    AnswerFenced,          \* questionOpen(): running, the row names the run that asked, same request
    MaxAsks,               \* bound on question cards the agent asks
    \* Phase 5 host cards.
    MaxHost,               \* bound on host cards the agent asks (0 or 1)
    HostAnswerFenced,      \* answerHost(): host_approval and the same request, else 409
    ClaimSkipsHostWait,    \* work(): the claim predicate takes queued or expired running rows only
    ApproveRefusesHost,    \* approve()/reject(): a host_approval row is not a proposal (409)
    ContinuationClearedAtClaim, \* work(): the claim takes the continuation off the row
    StopDeniesHost         \* stop(): closes a host card; WorkerEngine.Stop denies it before run.stop

Steps == 1..NSteps
NoLease == 0
NoRun == 0
\* Full Access lifts nothing more than Auto for Timely data in phase 2, so
\* it is modelled as "auto".
Modes == {"supervised", "auto"}

VARIABLES
    row,        \* the conversations row (absent once deleted)
    mem,        \* each lane's in-memory Conversation `c`
    pc,         \* each lane's place in Service.work
    cursor,     \* each lane's loop index in apply()
    fol,        \* the agent engine's live followers (WorkerEngine.loop), a set
    writes,     \* committed writes to the person's data, per plan step
    nextLease,  \* next fresh lease id (id("lease_") is random and unique)
    proposals,  \* proposals recorded so far (each records fresh steps)
    halted,     \* ghost: a Stop or discard has committed and no Approve since
    wroteWhileHalted, \* ghost: a step write committed while halted
    doneNotices,      \* ghost: "Done" notices published (notify txtPushComplete)
    unapproved,       \* ghost: the proposal was recorded in Supervised, no Approve since
    wroteUnapproved,  \* ghost: a step write committed while unapproved
    stops, retries, crashes, sends, switches,
    seen,       \* the run whose question card the person's screen shows (NoRun: none)
    seenEnded,  \* ghost: the row recorded the end of run `seen` (Stop, Delete, Lost, a failure)
    answeredEnded, \* ghost: an answer reached a run after seenEnded
    asks,       \* question cards asked so far
    \* Phase 5: the host card. The worker's side of it is wreq (its approval
    \* request: "none", "waiting", "approved" once Run once reached it, or
    \* "closed": denied, withdrawn, parked, its run gone) for the run wrun;
    \* wstopped are the runs the worker got run.stop for.
    wreq, wrun, wstopped,
    hostAsked,  \* host cards asked so far
    sent,       \* a live answer committed, its approval.answer not yet delivered: its lease (0: none)
    ran,        \* ghost: times the approved host call ran
    resolved,   \* ghost: times the card resolved (answered, expired, stopped)
    hostHalted, \* ghost: the person pressed Stop or deleted the chat after the card was asked
    ranAfterStop,  \* ghost: the approved call ran after hostHalted
    hostClaimed,   \* ghost: a claim took a host_approval row
    hostProposal   \* ghost: Approve or Reject acted on a host_approval row

\* The question-card variables, unchanged by every action that is not about
\* a card or a run's end.
qvars == <<seen, seenEnded, answeredEnded, asks>>

\* The host-card variables, unchanged by every action that is not about one.
hvars == <<wreq, wrun, wstopped, hostAsked, sent, ran, resolved, hostHalted, ranAfterStop,
           hostClaimed, hostProposal>>

vars == <<row, mem, pc, cursor, fol, writes, nextLease, proposals, halted,
          wroteWhileHalted, doneNotices, unapproved, wroteUnapproved,
          stops, retries, crashes, sends, switches, seen, seenEnded, answeredEnded, asks,
          wreq, wrun, wstopped, hostAsked, sent, ran, resolved, hostHalted, ranAfterStop,
          hostClaimed, hostProposal>>

\* Step statuses: "pending" | "done" | "failed" | "archived"
\* ("archived" stands for archivePlan, and for a chat with no plan yet: the
\*  plan is moved into history and Plan = [] so the steps never run.)
RowType == [status : {"approval", "queued", "running", "stopped", "failed", "idle", "host_approval"},
            phase  : {"apply", "plan"},
            lease  : 0..MaxLeases,
            expired: BOOLEAN,     \* lease_until < now
            plan   : [Steps -> {"pending", "done", "failed", "archived"}],
            deleted: BOOLEAN,
            mode   : Modes,       \* permission
            engine : {"classic", "agent"},  \* run_engine
            run    : 0..MaxLeases,          \* agent_run_id (NoRun = "")
            question : 0..MaxLeases,        \* question.run: the run whose card waits (NoRun = {})
            host   : 0..MaxLeases,          \* host_request.run: the run whose host card waits (NoRun = {})
            hphase : {"none", "live", "parked"}, \* host_request.phase
            cont   : BOOLEAN]               \* continuation: a parked card's approved call waits for a claim

\* A follower: the run it follows (named by the lease Start held), the lease
\* it renews (r.lease; Lost may move it), and the lane whose API process it
\* lives in. Its saves go through checkpoint() like a lane's, so they edit
\* the stored row; the CheckpointReadsLatest guard is exercised on lanes.
\* pre: the run's run.start carried a continuation's pre_approved call.
FollowerType == [run : 1..MaxLeases, lease : 0..MaxLeases, owner : SUBSET Workers, pre : BOOLEAN]

TypeOK ==
    /\ row \in RowType
    /\ pc \in [Workers -> {"idle", "claiming", "apply", "plan", "start", "lost", "fail"}]
    /\ cursor \in [Workers -> 1..(NSteps + 1)]
    /\ \A f \in fol : f \in FollowerType
    /\ writes \in [Steps -> Nat]
    /\ proposals \in 0..1
    /\ seen \in 0..MaxLeases
    /\ seenEnded \in BOOLEAN
    /\ asks \in 0..MaxAsks
    /\ wreq \in {"none", "waiting", "approved", "closed"}
    /\ hostAsked \in 0..MaxHost

NoPlan == [i \in Steps |-> "archived"]
Fresh == [i \in Steps |-> "pending"]

\* A proposal waiting for approval (finishTurn: Status = "approval").
Waiting == [status |-> "approval", phase |-> "apply", lease |-> NoLease,
            expired |-> FALSE, plan |-> Fresh, deleted |-> FALSE,
            mode |-> Mode, engine |-> "classic", run |-> NoRun, question |-> NoRun,
            host |-> NoRun, hphase |-> "none", cont |-> FALSE]
\* A new message, before any turn ran (create/send: queued, plan phase).
Asked == [Waiting EXCEPT !.status = "queued", !.phase = "plan", !.plan = NoPlan]

Init ==
    /\ row = IF FromMessage THEN Asked ELSE Waiting
    /\ mem = [w \in Workers |-> row]
    /\ pc = [w \in Workers |-> "idle"]
    /\ cursor = [w \in Workers |-> 1]
    /\ fol = {}
    /\ writes = [i \in Steps |-> 0]
    /\ nextLease = 1
    /\ proposals = IF row = Waiting THEN 1 ELSE 0
    /\ halted = FALSE
    /\ wroteWhileHalted = FALSE
    /\ doneNotices = 0
    /\ unapproved = (row = Waiting /\ Mode = "supervised")
    /\ wroteUnapproved = FALSE
    /\ stops = 0 /\ retries = 0 /\ crashes = 0 /\ sends = 0 /\ switches = 0
    /\ seen = NoRun /\ seenEnded = FALSE /\ answeredEnded = FALSE /\ asks = 0
    /\ wreq = "none" /\ wrun = NoRun /\ wstopped = {} /\ hostAsked = 0 /\ sent = NoLease
    /\ ran = 0 /\ resolved = 0 /\ hostHalted = FALSE /\ ranAfterStop = FALSE
    /\ hostClaimed = FALSE /\ hostProposal = FALSE

-----------------------------------------------------------------------------
(* Lane: claim (runner.go work, the claim Transaction)                       *)

Claimable(r) ==
    /\ ~r.deleted
    /\ \/ r.status = "queued"
       \/ r.status = "running" /\ r.expired
       \* Without the guard the claim also takes a waiting host card.
       \/ ~ClaimSkipsHostWait /\ r.status = "host_approval"

\* runEngine(): a fresh run picks its engine now (the chat's choice, else
\* the account's); apply, photo phases and Sensitive chats run classic. A
\* resumed lease keeps the engine and the agent run it had.
Engines(base) ==
    IF base.status = "queued" /\ base.phase = "plan" /\ AllowAgent
    THEN {"classic", "agent"} ELSE {"classic"}

\* A fresh claim takes the continuation off the row (the lane's copy keeps
\* it for Start's run.start pre_approved).
ClaimedRow(base, e) ==
    [base EXCEPT !.status = "running", !.lease = nextLease, !.expired = FALSE,
                 !.engine = IF base.status = "queued" THEN e ELSE base.engine,
                 !.run = IF base.status = "queued" THEN NoRun ELSE base.run,
                 !.cont = IF base.status = "queued" /\ ContinuationClearedAtClaim THEN FALSE ELSE base.cont]

\* After the claim commits, work() dispatches: Lost for a resumed agent run,
\* the agent engine's Start for an agent plan turn, else runClassic.
Dispatch(base, r) ==
    IF base.status = "running" /\ r.run # NoRun THEN "lost"
    ELSE IF r.engine = "agent" /\ r.phase = "plan" THEN "start"
    ELSE IF r.phase = "apply" THEN "apply" ELSE "plan"

\* The claim transaction is atomic only because the SELECT locks the row
\* (FOR UPDATE SKIP LOCKED) until tx.Save(&c) commits.
Claim(w) ==
    /\ ClaimLocksRow
    /\ pc[w] = "idle"
    /\ Claimable(row)
    /\ nextLease <= MaxLeases
    /\ \E e \in Engines(row) :
         LET r == ClaimedRow(row, e)
         IN /\ row' = r
            /\ mem' = [mem EXCEPT ![w] = [r EXCEPT !.cont = row.cont /\ row.status = "queued"]]
            /\ pc' = [pc EXCEPT ![w] = Dispatch(row, r)]
    /\ cursor' = [cursor EXCEPT ![w] = 1]
    /\ nextLease' = nextLease + 1
    /\ hostClaimed' = (hostClaimed \/ row.status = "host_approval")
    /\ UNCHANGED <<fol, writes, proposals, halted, wroteWhileHalted, doneNotices,
                   unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED <<wreq, wrun, wstopped, hostAsked, sent, ran, resolved, hostHalted, ranAfterStop, hostProposal>>

\* Without the row lock the claim is a read, then a whole-row tx.Save(&c)
\* of what was read.
ClaimRead(w) ==
    /\ ~ClaimLocksRow
    /\ pc[w] = "idle"
    /\ Claimable(row)
    /\ mem' = [mem EXCEPT ![w] = row]
    /\ pc' = [pc EXCEPT ![w] = "claiming"]
    /\ UNCHANGED <<row, cursor, fol, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED hvars

ClaimWrite(w) ==
    /\ pc[w] = "claiming"
    /\ ~row.deleted
    /\ nextLease <= MaxLeases
    /\ \E e \in Engines(mem[w]) :
         LET r == ClaimedRow(mem[w], e)
         IN /\ row' = r
            /\ mem' = [mem EXCEPT ![w] = [r EXCEPT !.cont = mem[w].cont /\ mem[w].status = "queued"]]
            /\ pc' = [pc EXCEPT ![w] = Dispatch(mem[w], r)]
    /\ cursor' = [cursor EXCEPT ![w] = 1]
    /\ nextLease' = nextLease + 1
    /\ hostClaimed' = (hostClaimed \/ mem[w].status = "host_approval")
    /\ UNCHANGED <<fol, writes, proposals, halted, wroteWhileHalted, doneNotices,
                   unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED <<wreq, wrun, wstopped, hostAsked, sent, ran, resolved, hostHalted, ranAfterStop, hostProposal>>

-----------------------------------------------------------------------------
(* Leases (keepLease, renewLease, and time passing)                          *)

\* lease_until passes: renewals missed (GC pause, slow DB, a step
\* transaction holding the row lock for minutes, a dead process).
Expire ==
    /\ ~row.deleted
    /\ row.status = "running"
    /\ ~row.expired
    /\ row' = [row EXCEPT !.expired = TRUE]
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED hvars

\* keepLease (runClassic): UPDATE ... WHERE id AND user_id AND lease = ? AND
\* status = 'running'. It does not look at lease_until, so a slow holder can
\* revive its lease.
Renew(w) ==
    /\ pc[w] \in {"apply", "plan", "fail"}
    /\ ~row.deleted
    /\ row.status = "running"
    /\ row.lease = mem[w].lease
    /\ row.expired
    /\ row' = [row EXCEPT !.expired = FALSE]
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED hvars

\* WorkerEngine.renew -> renewLease: the same UPDATE as keepLease, every 20 s,
\* with the follower's current lease (r.lease).
FollowerRenew(f) ==
    /\ f \in fol
    /\ ~row.deleted
    /\ row.status = "running"
    /\ row.lease = f.lease
    /\ row.expired
    /\ row' = [row EXCEPT !.expired = FALSE]
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED hvars

-----------------------------------------------------------------------------
(* Lane: one plan step (runner.go apply, the step Transaction)               *)

Fenced(r, l) == r.status = "running" /\ r.lease = l

\* archivePlan: the plan moves into history (Plan = []); its steps never run.
Archived(p) == [j \in Steps |-> IF p[j] = "done" THEN "done" ELSE "archived"]

\* Skip a step the lane's copy says is done (the `continue`).
SkipDone(w) ==
    /\ pc[w] = "apply"
    /\ cursor[w] \in Steps
    /\ ApplySkipsDone
    /\ mem[w].plan[cursor[w]] = "done"
    /\ cursor' = [cursor EXCEPT ![w] = @ + 1]
    /\ UNCHANGED <<row, mem, pc, fol, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED hvars

Write(i) == writes' = [writes EXCEPT ![i] = @ + 1]

\* The step transaction: lock the row, check the lease, compare snapshots,
\* call the write tool, mark the step done, save, commit. Outcomes:
\*   "ok"         commits; the lane adopts the stored row (*c = next)
\*   "commitLost" commits on the server, but the lane sees an error
\*                (context cancelled during COMMIT, connection drop)
\*   "toolError"  the tool fails; the transaction rolls back
\*   "serial"     40001/40P01/25P02; retrySerializable runs it again
\*   "stale"      a snapshot no longer matches: archivePlan, back to plan
StepTx(w) ==
    /\ pc[w] = "apply"
    /\ cursor[w] \in Steps
    /\ ~(ApplySkipsDone /\ mem[w].plan[cursor[w]] = "done")
    /\ LET i == cursor[w] IN
       IF row.deleted \/ (StepFenced /\ ~Fenced(row, mem[w].lease))
       THEN \* s.find fails or context.Canceled: nothing written
            /\ pc' = [pc EXCEPT ![w] = "fail"]
            /\ UNCHANGED <<row, mem, cursor, writes, wroteWhileHalted, wroteUnapproved>>
       ELSE \E o \in {"ok", "commitLost", "toolError", "serial", "stale"} :
         CASE o \in {"ok", "commitLost"} ->
                LET r == [row EXCEPT !.plan[i] = "done"] IN
                /\ row' = r
                /\ Write(i)
                /\ wroteWhileHalted' = (wroteWhileHalted \/ halted)
                /\ wroteUnapproved' = (wroteUnapproved \/ unapproved)
                /\ IF o = "ok"
                   THEN /\ mem' = [mem EXCEPT ![w] = r]
                        /\ cursor' = [cursor EXCEPT ![w] = @ + 1]
                        /\ pc' = pc
                   ELSE /\ pc' = [pc EXCEPT ![w] = "fail"]
                        /\ UNCHANGED <<mem, cursor>>
           [] o \in {"toolError", "serial"} ->
                \* Rolled back. A write made outside tx survives the rollback.
                /\ ~(WritesInStepTx /\ o = "serial")   \* a pure retry otherwise
                /\ IF WritesInStepTx THEN UNCHANGED writes ELSE Write(i)
                /\ wroteWhileHalted' = (wroteWhileHalted \/ (~WritesInStepTx /\ halted))
                /\ wroteUnapproved' = (wroteUnapproved \/ (~WritesInStepTx /\ unapproved))
                /\ pc' = IF o = "serial" THEN pc ELSE [pc EXCEPT ![w] = "fail"]
                /\ UNCHANGED <<row, mem, cursor>>
           [] o = "stale" ->
                LET r == [row EXCEPT !.plan = Archived(row.plan),
                                     !.phase = "plan", !.status = "queued"] IN
                /\ row' = r
                /\ mem' = [mem EXCEPT ![w] = r]
                /\ pc' = [pc EXCEPT ![w] = "idle"]   \* apply returns nil
                /\ UNCHANGED <<cursor, writes, wroteWhileHalted, wroteUnapproved>>
    /\ UNCHANGED <<fol, nextLease, proposals, halted, doneNotices, unapproved,
                   stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED hvars

-----------------------------------------------------------------------------
(* Checkpoints (service.go checkpoint)                                       *)

\* The row the checkpoint's fn edits and saves: the stored row, or (without
\* the guard) the caller's copy.
Base(copy) == IF CheckpointReadsLatest THEN row ELSE copy

\* A checkpoint under lease l commits.
Allowed(l) ==
    /\ ~row.deleted
    /\ (CheckpointFenced => Fenced(row, l))

\* Plan loop finished: the final checkpoint publishes "Done".
\* (A batch continuation, or a leftover steer after the proposal, goes to
\* queued/plan instead; not modelled: it is FinishApply then a Send.)
FinishApply(w) ==
    /\ pc[w] = "apply"
    /\ cursor[w] = NSteps + 1
    /\ IF Allowed(mem[w].lease)
       THEN /\ row' = [Base(mem[w]) EXCEPT !.status = "idle", !.expired = FALSE]
            /\ doneNotices' = doneNotices + 1
       ELSE UNCHANGED <<row, doneNotices>>
    /\ pc' = [pc EXCEPT ![w] = "idle"]
    /\ UNCHANGED <<mem, cursor, fol, writes, nextLease, proposals, halted, wroteWhileHalted,
                   unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED hvars

FirstNotDone(p) == CHOOSE i \in Steps : p[i] # "done" /\ \A j \in 1..(i - 1) : p[j] = "done"

\* work(): after an error, the failure checkpoint names the first step that
\* is not done and sets Status = "failed".
FailRun(w) ==
    /\ pc[w] = "fail"
    /\ IF Allowed(mem[w].lease)
       THEN LET b == Base(mem[w]) IN
            row' = [b EXCEPT !.status = "failed", !.expired = FALSE,
                    !.plan = IF b.phase = "apply" /\ \E i \in Steps : b.plan[i] # "done"
                             THEN [b.plan EXCEPT ![FirstNotDone(b.plan)] = "failed"]
                             ELSE b.plan]
       ELSE UNCHANGED row
    /\ pc' = [pc EXCEPT ![w] = "idle"]
    /\ UNCHANGED <<mem, cursor, fol, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED hvars

-----------------------------------------------------------------------------
(* The end of a turn (toolcall.go finishTurn), on either engine              *)

\* proposalStatus / holdReason: Supervised holds every proposal for Approve.
\* Otherwise a proposal may still be held (Sensitive, tainted, review notes,
\* a recurring series, the critical list, a tool's own floor, no Undo), or
\* apply at once: queued in the apply phase, shown as applied with Undo.
\* The decision reads the row the checkpoint edits (`proposalStatus(row,
\* ...)`), so a stricter mode chosen mid-run holds this proposal.
Statuses(base) ==
    IF HoldsSupervised /\ base.mode = "supervised"
    THEN {"approval"} ELSE {"approval", "queued"}

\* finishTurn's checkpoint under lease l, editing `base`: the model's reply,
\* or the proposal with fresh steps (one per behaviour, so step writes stay
\* comparable). endRun clears the agent run. A turn writes no Timely data
\* itself: its tool calls are reads (toolCall refuses write tools).
EndTurn(l, base) ==
    IF ~Allowed(l)
    THEN UNCHANGED <<row, proposals, unapproved>>
    ELSE \/ /\ row' = [base EXCEPT !.status = "idle", !.expired = FALSE, !.run = NoRun,
                                     !.question = NoRun]
            /\ UNCHANGED <<proposals, unapproved>>
         \/ /\ proposals = 0
            /\ \E s \in Statuses(base) :
                 row' = [base EXCEPT !.status = s, !.phase = "apply", !.plan = Fresh,
                                     !.expired = FALSE, !.run = NoRun, !.question = NoRun]
            /\ proposals' = proposals + 1
            \* Ghost: recorded while the stored row says Supervised.
            /\ unapproved' = (row.mode = "supervised")

\* Classic: plan() runs the model loop in this lane under keepLease, then
\* finishTurn (or the failure checkpoint after an error).
PlanRun(w) ==
    /\ pc[w] = "plan"
    /\ EndTurn(mem[w].lease, Base(mem[w]))
    /\ pc' = [pc EXCEPT ![w] = "idle"]
    /\ UNCHANGED <<mem, cursor, fol, writes, nextLease, halted, wroteWhileHalted,
                   doneNotices, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED hvars

-----------------------------------------------------------------------------
(* The agent engine (engine.go, engine_agent.go)                             *)

\* startAgentRun -> WorkerEngine.Start: the provider and runtime checks, then
\* one fenced checkpoint that names the run on the row (agent_run_id,
\* agent_instance) before run.start goes to the worker; the follower takes
\* the lane's lease (r.lease = c.Lease) and the lane goes back to claiming.
\* Any failure (runtime unavailable, provider unusable, the fence refused,
\* run.start not sent and the run cleared) goes to the failure checkpoint.
StartRun(w) ==
    /\ pc[w] = "start"
    /\ \/ /\ Allowed(mem[w].lease)
          /\ LET r == [Base(mem[w]) EXCEPT !.run = mem[w].lease, !.expired = FALSE]
             IN /\ row' = r
                /\ fol' = fol \cup {[run |-> mem[w].lease, lease |-> mem[w].lease,
                                     owner |-> {w}, pre |-> mem[w].cont]}
          /\ pc' = [pc EXCEPT ![w] = "idle"]
       \/ /\ pc' = [pc EXCEPT ![w] = "fail"]
          /\ UNCHANGED <<row, fol>>
    /\ UNCHANGED <<mem, cursor, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED hvars

\* lostAgentRun -> WorkerEngine.Lost, for a re-claimed agent row (c carries
\* the new lease). When this process still follows the run named on the row,
\* the follower adopts the new lease (re-attach) and the lane goes back to
\* claiming. Otherwise clearRun (a fenced checkpoint that clears the run)
\* and the failure checkpoint: Try again. The agent engine runs in one API
\* process per schema (Available refuses a worktree without DB_SCHEMA), so
\* a live follower of the run is always this process's, and Lost re-attaches
\* it (r != nil, same instance, worker not exited); clearRun is for a run no
\* follower follows any more.
Lost(w) ==
    /\ pc[w] = "lost"
    /\ \/ \E f \in fol :
            /\ f.run = mem[w].run
            /\ fol' = (fol \ {f}) \cup {[f EXCEPT !.lease = mem[w].lease]}
            /\ pc' = [pc EXCEPT ![w] = "idle"]
            /\ UNCHANGED <<row, seenEnded>>
       \/ /\ ~\E f \in fol : f.run = mem[w].run
          /\ IF Allowed(mem[w].lease)
             THEN \* clearRun also closes a waiting question card
                  /\ row' = [Base(mem[w]) EXCEPT !.run = NoRun, !.expired = FALSE,
                                                 !.question = NoRun]
                  /\ seenEnded' = (seenEnded \/ (mem[w].run # NoRun /\ mem[w].run = seen))
             ELSE UNCHANGED <<row, seenEnded>>
          /\ pc' = [pc EXCEPT ![w] = "fail"]
          /\ UNCHANGED fol
    /\ UNCHANGED <<mem, cursor, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED <<seen, answeredEnded, asks>>
    /\ UNCHANGED hvars

\* The follower ends the run: run.done -> finishTurn under r.lease (a reply
\* or a proposal), or e.stopped / e.fail (Stop the worker saw first, a
\* worker that exited, a refused run.start) through the same fenced save.
\* A refused fence (Stop, Delete, a lease another lane took) writes nothing
\* and the follower stops its worker run.
FollowerEnd(f) ==
    /\ f \in fol
    /\ fol' = fol \ {f}
    /\ LET b == row IN
       \/ /\ EndTurn(f.lease, b)
          /\ UNCHANGED seenEnded
       \/ /\ \E s \in {"failed", "stopped"} :
               IF Allowed(f.lease)
               THEN \* endRun closes a waiting question card
                    /\ row' = [b EXCEPT !.status = s, !.expired = FALSE, !.run = NoRun,
                                        !.question = NoRun]
                    /\ seenEnded' = (seenEnded \/ f.run = seen)
               ELSE UNCHANGED <<row, seenEnded>>
          /\ UNCHANGED <<proposals, unapproved>>
    /\ UNCHANGED <<mem, pc, cursor, writes, nextLease, halted, wroteWhileHalted,
                   doneNotices, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED <<seen, answeredEnded, asks>>
    \* The worker's run is over: a request it waited on is gone with it.
    /\ wreq' = IF wrun = f.run /\ wreq \in {"waiting", "approved"} THEN "closed" ELSE wreq
    /\ UNCHANGED <<wrun, wstopped, hostAsked, sent, ran, resolved, hostHalted, ranAfterStop,
                   hostClaimed, hostProposal>>

-----------------------------------------------------------------------------
(* Question cards (phase 4, Q-4.3; question.go, engine_agent.go)             *)

\* WorkerEngine.ask -> flush: the worker's clarify.request. The card goes on
\* the row (question.run = the run) in the follower's fenced save under its
\* current lease, with one push; the person's screen shows it.
Ask(f) ==
    /\ f \in fol
    /\ asks < MaxAsks
    /\ Allowed(f.lease)
    /\ row.question = NoRun
    /\ row' = [row EXCEPT !.question = f.run, !.expired = FALSE]
    /\ seen' = f.run
    \* A run Ask names is live (its lease is fresh), so nothing has ended it.
    /\ seenEnded' = FALSE
    /\ asks' = asks + 1
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches,
                   answeredEnded>>
    /\ UNCHANGED hvars

\* WorkerEngine.closeAsked: the worker's clarify.closed (timed out, or
\* cancelled). A card still on the row closes in the follower's fenced save;
\* a fenced save writes nothing.
CloseQuestion(f) ==
    /\ f \in fol
    /\ row.question = f.run
    /\ Allowed(f.lease)
    /\ row' = [row EXCEPT !.question = NoRun, !.expired = FALSE]
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED hvars

\* answerQuestion (POST /chats/:id/answer, and send/steer while a card
\* waits): under the row lock, questionOpen checks the card the screen shows
\* still waits on the live run the row names; the card closes in the same
\* transaction, then clarify.answer goes to that run. Without the fence the
\* answer goes to the run the card named, whatever happened since.
Answer ==
    /\ ~row.deleted
    /\ seen # NoRun
    /\ AnswerFenced => (row.status = "running" /\ row.run # NoRun /\ row.question = row.run
                         /\ row.question = seen)
    /\ row' = [row EXCEPT !.question = NoRun]
    /\ answeredEnded' = (answeredEnded \/ seenEnded)
    /\ seen' = NoRun
    /\ seenEnded' = FALSE
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches,
                   asks>>
    /\ UNCHANGED hvars

-----------------------------------------------------------------------------
(* Process deaths                                                            *)

\* The API process of lane w dies (or shuts down) mid-run: the lane and any
\* follower in that process stop; their lease is left to expire.
Crash(w) ==
    /\ pc[w] # "idle"
    /\ crashes < MaxCrashes
    /\ pc' = [pc EXCEPT ![w] = "idle"]
    /\ fol' = {f \in fol : w \notin f.owner}
    /\ crashes' = crashes + 1
    /\ UNCHANGED <<row, mem, cursor, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, sends, switches>>
    /\ UNCHANGED qvars
    /\ wreq' = IF \E f \in fol : w \in f.owner /\ f.run = wrun THEN "closed" ELSE wreq
    /\ UNCHANGED <<wrun, wstopped, hostAsked, sent, ran, resolved, hostHalted, ranAfterStop,
                   hostClaimed, hostProposal>>

\* The API process that runs a follower dies while its lanes are idle.
FollowerCrash(f) ==
    /\ f \in fol
    /\ crashes < MaxCrashes
    /\ fol' = fol \ {f}
    /\ crashes' = crashes + 1
    /\ UNCHANGED <<row, mem, pc, cursor, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, sends, switches>>
    /\ UNCHANGED qvars
    /\ wreq' = IF wrun = f.run THEN "closed" ELSE wreq
    /\ UNCHANGED <<wrun, wstopped, hostAsked, sent, ran, resolved, hostHalted, ranAfterStop,
                   hostClaimed, hostProposal>>

-----------------------------------------------------------------------------
(* The person (service.go change()/save(): lock the row, edit, save)         *)

\* approve(): a host card's row is not a proposal (ApproveRefusesHost: 409).
Approve ==
    /\ ~row.deleted
    /\ \/ row.status = "approval"
       \/ ~ApproveRefusesHost /\ row.status = "host_approval"
    /\ row' = [row EXCEPT !.phase = "apply", !.status = "queued"]
    /\ halted' = FALSE
    /\ unapproved' = FALSE
    /\ hostProposal' = (hostProposal \/ row.status = "host_approval")
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, wroteWhileHalted,
                   doneNotices, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED <<wreq, wrun, wstopped, hostAsked, sent, ran, resolved, hostHalted, ranAfterStop, hostClaimed>>

\* stop(): ends the run, clears the lease, the agent run, a waiting card and
\* a continuation; the engine's Stop then denies a live host card and sends
\* run.stop (modelled with the commit). StopDeniesHost: stop() acts on a
\* host_approval row and the engine denies its card; without it a Stop on a
\* waiting host card changes nothing, though the person pressed it.
StopActs == {"queued", "running", "approval"} \cup (IF StopDeniesHost THEN {"host_approval"} ELSE {})
Stop ==
    /\ ~row.deleted
    /\ stops < MaxStops
    /\ row.status \in {"queued", "running", "approval", "host_approval"}
    /\ IF row.status \in StopActs
       THEN /\ row' = [row EXCEPT !.status = "stopped", !.lease = NoLease, !.expired = FALSE,
                                  !.run = NoRun, !.question = NoRun, !.host = NoRun,
                                  !.hphase = "none", !.cont = FALSE]
            /\ halted' = TRUE
            /\ seenEnded' = (seenEnded \/ (row.run # NoRun /\ row.run = seen))
            /\ wstopped' = IF row.run # NoRun THEN wstopped \cup {row.run} ELSE wstopped
            /\ wreq' = IF StopDeniesHost /\ row.run # NoRun /\ wrun = row.run /\ wreq = "waiting"
                       THEN "closed" ELSE wreq
            /\ resolved' = IF row.status = "host_approval" THEN resolved + 1 ELSE resolved
       ELSE UNCHANGED <<row, halted, seenEnded, wstopped, wreq, resolved>>
    /\ stops' = stops + 1
    /\ hostHalted' = (hostHalted \/ hostAsked > 0)
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, retries, crashes, sends, switches>>
    /\ UNCHANGED <<seen, answeredEnded, asks>>
    /\ UNCHANGED <<wrun, hostAsked, sent, ran, ranAfterStop, hostClaimed, hostProposal>>

\* retry(): the agent run it had is over. A Retry of an apply whose every
\* step is done finishes the apply (no step left to write); one with steps
\* left goes back to approval. A Retry that plans again is the person asking
\* anew (in Auto its proposal may apply without Approve), so it ends the halt.
Retry ==
    /\ ~row.deleted
    /\ retries < MaxRetries
    /\ row.status \in {"failed", "stopped"}
    /\ IF row.phase = "apply" /\ \A i \in Steps : row.plan[i] = "done"
       THEN /\ row' = [row EXCEPT !.status = "queued", !.run = NoRun, !.question = NoRun,
                                    !.host = NoRun, !.hphase = "none", !.cont = FALSE]
            /\ UNCHANGED halted
       ELSE IF row.phase = "apply" /\ \E i \in Steps : row.plan[i] # "archived"
       THEN /\ row' = [row EXCEPT !.status = "approval", !.run = NoRun, !.question = NoRun,
                       !.host = NoRun, !.hphase = "none", !.cont = FALSE,
                       !.plan = [i \in Steps |->
                                   IF RetryKeepsDone /\ row.plan[i] = "done"
                                   THEN "done" ELSE "pending"]]
            /\ UNCHANGED halted
       ELSE /\ row' = [row EXCEPT !.status = "queued", !.phase = "plan", !.run = NoRun,
                                    !.question = NoRun, !.host = NoRun, !.hphase = "none", !.cont = FALSE]
            /\ halted' = FALSE
    /\ retries' = retries + 1
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED hvars

\* send(): a new message when no run is busy. archivePlan moves the plan into
\* history; the new request starts in the plan phase. Like a Retry that
\* plans again, it is the person asking anew. A message never answers a host
\* card: on a live one it is refused (409); a parked one closes with it.
Send ==
    /\ ~row.deleted
    /\ sends < MaxSends
    /\ row.status \notin {"queued", "running"}
    /\ ~(row.status = "host_approval" /\ row.hphase = "live")
    /\ row' = [row EXCEPT !.plan = Archived(row.plan), !.phase = "plan",
                           !.status = "queued", !.host = NoRun, !.hphase = "none"]
    /\ halted' = FALSE
    /\ sends' = sends + 1
    /\ resolved' = IF row.status = "host_approval" THEN resolved + 1 ELSE resolved
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED <<wreq, wrun, wstopped, hostAsked, sent, ran, hostHalted, ranAfterStop, hostClaimed, hostProposal>>

\* reject(): discard the proposal waiting for approval; a host card's row is
\* refused (ApproveRefusesHost).
Reject ==
    /\ ~row.deleted
    /\ \/ row.status = "approval"
       \/ ~ApproveRefusesHost /\ row.status = "host_approval"
    /\ row' = [row EXCEPT !.plan = Archived(row.plan), !.phase = "plan",
                           !.status = "idle"]
    /\ halted' = TRUE
    /\ hostProposal' = (hostProposal \/ row.status = "host_approval")
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED <<wreq, wrun, wstopped, hostAsked, sent, ran, resolved, hostHalted, ranAfterStop, hostClaimed>>

\* receipts.go discardReview(): no busy check, so it can land mid-apply of a
\* receipt plan. Like Stop, it clears the lease; the plan is archived. A
\* receipt or image review is a photo chat, which always runs classic
\* (runEngine's assumption anchor), so never a row of an agent run.
DiscardReview ==
    /\ ~row.deleted
    /\ row.engine = "classic"
    /\ row' = [row EXCEPT !.plan = Archived(row.plan), !.phase = "plan",
                           !.status = "idle", !.lease = NoLease, !.expired = FALSE]
    /\ halted' = TRUE
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED hvars

\* configure() (PATCH /chats/:id {permission}): any time, even mid-run. It
\* changes only the mode: a looser mode approves nothing already waiting.
SetPermission ==
    /\ ~row.deleted
    /\ switches < MaxSwitches
    /\ row' = [row EXCEPT !.mode = IF @ = "supervised" THEN "auto" ELSE "supervised"]
    /\ switches' = switches + 1
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends>>
    /\ UNCHANGED qvars
    /\ UNCHANGED hvars

\* steer() (POST /chats/:id/steer) locks the row and adds a message only while
\* an agent run is live; it touches no field modelled here, so it is a
\* stutter step, listed so the action table names every route.
Steer ==
    /\ ~row.deleted
    /\ row.status = "running"
    /\ row.run # NoRun
    /\ UNCHANGED vars

\* remove(): the row is deleted; every later find() fails. The engine's Stop
\* then denies a live host card and stops its run (StopDeniesHost).
Delete ==
    /\ AllowDelete
    /\ ~row.deleted
    /\ row' = [row EXCEPT !.deleted = TRUE]
    /\ seenEnded' = (seenEnded \/ (row.run # NoRun /\ row.run = seen))
    /\ wstopped' = IF row.run # NoRun THEN wstopped \cup {row.run} ELSE wstopped
    /\ wreq' = IF StopDeniesHost /\ row.run # NoRun /\ wrun = row.run /\ wreq = "waiting"
               THEN "closed" ELSE wreq
    /\ hostHalted' = (hostHalted \/ hostAsked > 0)
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED <<seen, answeredEnded, asks>>
    /\ UNCHANGED <<wrun, hostAsked, sent, ran, resolved, ranAfterStop, hostClaimed, hostProposal>>

\* restoreQuestion: the answer committed (Answer) but the worker did not reply
\* to clarify.answer, so under the row lock the card goes back on the row, for
\* the person to answer again, only while the row still names the same running
\* run and no card took its place. Stop, Delete, Lost and a failure clear the
\* run from the row, so the card never comes back for a run they ended.
ReopenQuestion ==
    /\ ~row.deleted
    /\ asks > 0
    /\ seen = NoRun
    /\ row.status = "running" /\ row.run # NoRun /\ row.question = NoRun
    /\ row' = [row EXCEPT !.question = row.run]
    /\ seen' = row.run
    /\ seenEnded' = FALSE
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches,
                   answeredEnded, asks>>
    /\ UNCHANGED hvars

-----------------------------------------------------------------------------
(* Host cards (phase 5; host_engine.go, host_answer.go, service.go)          *)

HostWait(r) == ~r.deleted /\ r.status = "host_approval" /\ r.host # NoRun

\* WorkerEngine.askHost -> writeHostCard -> hostSave: the worker's
\* approval.request. Fenced on the running row naming the run under its
\* lease, the row goes to host_approval with the card, and no lease.
AskHost(f) ==
    /\ f \in fol
    /\ hostAsked < MaxHost
    /\ ~row.deleted
    /\ row.status = "running" /\ row.lease = f.lease /\ row.run = f.run
    /\ row' = [row EXCEPT !.status = "host_approval", !.host = f.run, !.hphase = "live",
                          !.lease = NoLease, !.expired = FALSE]
    /\ wreq' = "waiting" /\ wrun' = f.run
    /\ hostAsked' = hostAsked + 1
    /\ fol' = (fol \ {f}) \cup {[f EXCEPT !.lease = NoLease]}
    /\ UNCHANGED <<mem, pc, cursor, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED <<wstopped, sent, ran, resolved, hostHalted, ranAfterStop, hostClaimed, hostProposal>>

\* The live wait ends unanswered (or the worker exits during it): the worker
\* withdraws the request and ends the run (run.done approval_parked), and
\* the follower's parkRun / parkLost parks the card; the row names no run.
\* A live answer that re-attached the run but did not reach the worker (the
\* row runs under the answer's lease) becomes the continuation instead.
ParkHost(f) ==
    /\ f \in fol
    /\ f.run = wrun /\ wreq = "waiting"
    /\ wreq' = "closed"
    /\ fol' = fol \ {f}
    /\ IF HostWait(row) /\ row.run = f.run
       THEN row' = [row EXCEPT !.hphase = "parked", !.run = NoRun]
       ELSE IF ~row.deleted /\ row.status = "running" /\ row.run = f.run /\ f.lease # NoLease /\ row.lease = f.lease
       THEN row' = [row EXCEPT !.status = "queued", !.phase = "plan", !.run = NoRun, !.lease = NoLease,
                               !.expired = FALSE, !.cont = TRUE]
       ELSE UNCHANGED row
    /\ UNCHANGED <<mem, pc, cursor, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED <<wrun, wstopped, hostAsked, sent, ran, resolved, hostHalted, ranAfterStop, hostClaimed, hostProposal>>

\* sweepHost -> parkOrphan: a live card whose run no process follows (the
\* API restarted, the follower's process died) parks.
ParkOrphan ==
    /\ HostWait(row) /\ row.hphase = "live"
    /\ ~\E f \in fol : f.run = row.run
    /\ row' = [row EXCEPT !.hphase = "parked", !.run = NoRun]
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED hvars

\* The person's answer, Run once (POST /chats/:id/host-approval ->
\* answerHost), to the card they saw (run wrun). HostAnswerFenced: under the
\* row lock the row still waits on that card, else 409. A live card whose
\* run this process follows is re-attached: the row runs again under a
\* fresh lease the follower adopts (HostAnswer); approval.answer goes out
\* after the commit (DeliverHost). Anything else is a parked answer: the
\* continuation is queued.
HostAnswerOK ==
    HostAnswerFenced => (HostWait(row) /\ row.host = wrun)

AnswerHostLive ==
    /\ hostAsked > 0 /\ resolved < 2 /\ sent = NoLease
    /\ ~row.deleted
    /\ nextLease <= MaxLeases
    /\ HostAnswerOK
    /\ (HostAnswerFenced => row.hphase = "live" /\ row.run = row.host)
    /\ \E f \in fol :
         /\ f.run = wrun
         /\ row' = [row EXCEPT !.status = "running", !.lease = nextLease, !.expired = FALSE,
                               !.run = wrun, !.host = NoRun, !.hphase = "none"]
         /\ fol' = (fol \ {f}) \cup {[f EXCEPT !.lease = nextLease]}
    /\ sent' = nextLease
    /\ nextLease' = nextLease + 1
    /\ resolved' = resolved + 1
    /\ UNCHANGED <<mem, pc, cursor, writes, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED <<wreq, wrun, wstopped, hostAsked, ran, hostHalted, ranAfterStop, hostClaimed, hostProposal>>

AnswerHostParked ==
    /\ hostAsked > 0 /\ resolved < 2
    /\ ~row.deleted
    /\ HostAnswerOK
    /\ (HostAnswerFenced => row.hphase = "parked" \/ ~\E f \in fol : f.run = row.run)
    /\ row' = [row EXCEPT !.status = "queued", !.phase = "plan", !.run = NoRun, !.lease = NoLease,
                          !.expired = FALSE, !.host = NoRun, !.hphase = "none", !.cont = TRUE]
    /\ resolved' = resolved + 1
    \* A live run nobody here follows is stopped (WorkerEngine.Stop).
    /\ wstopped' = IF row.run # NoRun THEN wstopped \cup {row.run} ELSE wstopped
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED <<wreq, wrun, hostAsked, sent, ran, hostHalted, ranAfterStop, hostClaimed, hostProposal>>

\* HostAnswer's approval.answer once reaches the worker. A request still
\* waiting, of a run not stopped, is approved; otherwise the worker refuses
\* it and hostAnswerNotTaken, fenced on the answer's lease, queues the
\* continuation (and the run is stopped).
DeliverHost ==
    /\ sent # NoLease
    /\ sent' = NoLease
    /\ IF wreq = "waiting" /\ wrun \notin wstopped
       THEN /\ wreq' = "approved"
            /\ UNCHANGED <<row, wstopped>>
       ELSE /\ IF ~row.deleted /\ row.status = "running" /\ row.lease = sent /\ row.run = wrun
               THEN row' = [row EXCEPT !.status = "queued", !.phase = "plan", !.run = NoRun,
                                       !.lease = NoLease, !.expired = FALSE, !.cont = TRUE]
               ELSE UNCHANGED row
            /\ wstopped' = wstopped \cup {wrun}
            /\ UNCHANGED wreq
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED <<wrun, hostAsked, ran, resolved, hostHalted, ranAfterStop, hostClaimed, hostProposal>>

\* sweepHost -> expireHost: a parked card past the account's timeout closes,
\* "Expired, not run".
ExpireHost ==
    /\ HostWait(row) /\ row.hphase = "parked"
    /\ row' = [row EXCEPT !.status = "idle", !.host = NoRun, !.hphase = "none"]
    /\ resolved' = resolved + 1
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED <<wreq, wrun, wstopped, hostAsked, sent, ran, hostHalted, ranAfterStop, hostClaimed, hostProposal>>

\* The worker runs the approved call: Run once reached its waiting request,
\* or the run's run.start carried it as pre_approved (once). The worker's
\* gate refuses any call of a run it got run.stop for (rule 1, R6).
RunHostTool(f) ==
    /\ f \in fol
    /\ f.run \notin wstopped
    /\ \/ /\ wreq = "approved" /\ wrun = f.run
          /\ wreq' = "closed"
          /\ UNCHANGED fol
       \/ /\ f.pre
          /\ fol' = (fol \ {f}) \cup {[f EXCEPT !.pre = FALSE]}
          /\ UNCHANGED wreq
    /\ ran' = ran + 1
    /\ ranAfterStop' = (ranAfterStop \/ hostHalted)
    /\ UNCHANGED <<row, mem, pc, cursor, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars
    /\ UNCHANGED <<wrun, wstopped, hostAsked, sent, resolved, hostHalted, hostClaimed, hostProposal>>

-----------------------------------------------------------------------------

Next ==
    \/ \E w \in Workers :
         \/ Claim(w) \/ ClaimRead(w) \/ ClaimWrite(w) \/ Renew(w)
         \/ SkipDone(w) \/ StepTx(w) \/ FinishApply(w) \/ FailRun(w)
         \/ PlanRun(w) \/ StartRun(w) \/ Lost(w) \/ Crash(w)
    \/ \E f \in fol : FollowerRenew(f) \/ FollowerEnd(f) \/ FollowerCrash(f)
                     \/ Ask(f) \/ CloseQuestion(f)
                     \/ AskHost(f) \/ ParkHost(f) \/ RunHostTool(f)
    \/ Expire \/ Approve \/ Stop \/ Retry \/ Send \/ Reject \/ DiscardReview
    \/ SetPermission \/ Steer \/ Delete \/ Answer \/ ReopenQuestion
    \/ ParkOrphan \/ AnswerHostLive \/ AnswerHostParked \/ DeliverHost \/ ExpireHost

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* Properties                                                                *)

\* Each step of the proposal changes the person's data at most once.
AtMostOnce == \A i \in Steps : writes[i] <= 1

\* The stored plan says "done" exactly for the steps whose write committed,
\* so Retry and a resumed lease skip precisely the completed changes.
DoneMatchesWrites ==
    ~row.deleted => \A i \in Steps : (row.plan[i] = "done") <=> (writes[i] = 1)

\* After Stop (or a discard) commits, no step write commits until the person
\* approves again (or asks anew).
StopHolds == ~wroteWhileHalted

\* "Done" is published once, and only when every step is done.
OneDoneNotice == doneNotices <= 1
DoneMeansComplete ==
    (~row.deleted /\ row.status = "idle" /\ row.phase = "apply")
        => \A i \in Steps : row.plan[i] = "done"

\* A proposal recorded while the chat is Supervised never changes the
\* person's data before the person approves it (plan 5.5b).
SupervisedHolds == ~wroteUnapproved

\* No answer to a question card reaches a run after Stop, Delete or Lost
\* (or a failure) ended it (phase 4 decision 2).
NoAnswerAfterEnd == ~answeredEnded

\* Phase 5 host cards.
\* A host card resolves at most once (answered, expired, stopped).
HostResolvesOnce == resolved <= 1

\* No host call runs after the person pressed Stop (or deleted the chat)
\* once the card was asked.
NoHostToolAfterStop == ~ranAfterStop

\* A host card's row is never applied, approved or rejected as a proposal.
HostNotAProposal == ~hostProposal /\ (row.status = "host_approval" => row.phase = "plan")

\* A host card's row is never claimed and holds no lease while it waits;
\* at most one follower holds the row's lease (one re-attach per answer).
NoLeaseOnHostWait ==
    /\ ~hostClaimed
    /\ (row.status = "host_approval" => row.lease = NoLease)
    /\ \A f1, f2 \in fol : (f1.lease = f2.lease /\ f1.lease # NoLease) => f1 = f2

\* The approved call runs at most once.
ContinuationOnce == ran <= 1

Symm == Permutations(Workers)
=============================================================================
