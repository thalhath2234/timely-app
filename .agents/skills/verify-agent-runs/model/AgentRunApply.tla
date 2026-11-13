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
    MaxAsks                \* bound on question cards the agent asks

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
    asks        \* question cards asked so far

\* The question-card variables, unchanged by every action that is not about
\* a card or a run's end.
qvars == <<seen, seenEnded, answeredEnded, asks>>

vars == <<row, mem, pc, cursor, fol, writes, nextLease, proposals, halted,
          wroteWhileHalted, doneNotices, unapproved, wroteUnapproved,
          stops, retries, crashes, sends, switches, seen, seenEnded, answeredEnded, asks>>

\* Step statuses: "pending" | "done" | "failed" | "archived"
\* ("archived" stands for archivePlan, and for a chat with no plan yet: the
\*  plan is moved into history and Plan = [] so the steps never run.)
RowType == [status : {"approval", "queued", "running", "stopped", "failed", "idle"},
            phase  : {"apply", "plan"},
            lease  : 0..MaxLeases,
            expired: BOOLEAN,     \* lease_until < now
            plan   : [Steps -> {"pending", "done", "failed", "archived"}],
            deleted: BOOLEAN,
            mode   : Modes,       \* permission
            engine : {"classic", "agent"},  \* run_engine
            run    : 0..MaxLeases,          \* agent_run_id (NoRun = "")
            question : 0..MaxLeases]        \* question.run: the run whose card waits (NoRun = {})

\* A follower: the run it follows (named by the lease Start held), the lease
\* it renews (r.lease; Lost may move it), and the lane whose API process it
\* lives in. Its saves go through checkpoint() like a lane's, so they edit
\* the stored row; the CheckpointReadsLatest guard is exercised on lanes.
FollowerType == [run : 1..MaxLeases, lease : 1..MaxLeases, owner : SUBSET Workers]

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

NoPlan == [i \in Steps |-> "archived"]
Fresh == [i \in Steps |-> "pending"]

\* A proposal waiting for approval (finishTurn: Status = "approval").
Waiting == [status |-> "approval", phase |-> "apply", lease |-> NoLease,
            expired |-> FALSE, plan |-> Fresh, deleted |-> FALSE,
            mode |-> Mode, engine |-> "classic", run |-> NoRun, question |-> NoRun]
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

-----------------------------------------------------------------------------
(* Lane: claim (runner.go work, the claim Transaction)                       *)

Claimable(r) ==
    /\ ~r.deleted
    /\ \/ r.status = "queued"
       \/ r.status = "running" /\ r.expired

\* runEngine(): a fresh run picks its engine now (the chat's choice, else
\* the account's); apply, photo phases and Sensitive chats run classic. A
\* resumed lease keeps the engine and the agent run it had.
Engines(base) ==
    IF base.status = "queued" /\ base.phase = "plan" /\ AllowAgent
    THEN {"classic", "agent"} ELSE {"classic"}

ClaimedRow(base, e) ==
    [base EXCEPT !.status = "running", !.lease = nextLease, !.expired = FALSE,
                 !.engine = IF base.status = "queued" THEN e ELSE base.engine,
                 !.run = IF base.status = "queued" THEN NoRun ELSE base.run]

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
            /\ mem' = [mem EXCEPT ![w] = r]
            /\ pc' = [pc EXCEPT ![w] = Dispatch(row, r)]
    /\ cursor' = [cursor EXCEPT ![w] = 1]
    /\ nextLease' = nextLease + 1
    /\ UNCHANGED <<fol, writes, proposals, halted, wroteWhileHalted, doneNotices,
                   unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars

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

ClaimWrite(w) ==
    /\ pc[w] = "claiming"
    /\ ~row.deleted
    /\ nextLease <= MaxLeases
    /\ \E e \in Engines(mem[w]) :
         LET r == ClaimedRow(mem[w], e)
         IN /\ row' = r
            /\ mem' = [mem EXCEPT ![w] = r]
            /\ pc' = [pc EXCEPT ![w] = Dispatch(mem[w], r)]
    /\ cursor' = [cursor EXCEPT ![w] = 1]
    /\ nextLease' = nextLease + 1
    /\ UNCHANGED <<fol, writes, proposals, halted, wroteWhileHalted, doneNotices,
                   unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars

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
                                     owner |-> {w}]}
          /\ pc' = [pc EXCEPT ![w] = "idle"]
       \/ /\ pc' = [pc EXCEPT ![w] = "fail"]
          /\ UNCHANGED <<row, fol>>
    /\ UNCHANGED <<mem, cursor, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars

\* lostAgentRun -> WorkerEngine.Lost, for a re-claimed agent row (c carries
\* the new lease). When this process still follows the run named on the row,
\* the follower adopts the new lease (re-attach) and the lane goes back to
\* claiming. Otherwise clearRun (a fenced checkpoint that clears the run)
\* and the failure checkpoint: Try again. A follower elsewhere keeps its old
\* lease, so its checkpoints are fenced.
Lost(w) ==
    /\ pc[w] = "lost"
    /\ \/ \E f \in fol :
            /\ f.run = mem[w].run
            /\ fol' = (fol \ {f}) \cup {[f EXCEPT !.lease = mem[w].lease]}
            /\ pc' = [pc EXCEPT ![w] = "idle"]
            /\ UNCHANGED <<row, seenEnded>>
       \/ /\ IF Allowed(mem[w].lease)
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

\* The API process that runs a follower dies while its lanes are idle.
FollowerCrash(f) ==
    /\ f \in fol
    /\ crashes < MaxCrashes
    /\ fol' = fol \ {f}
    /\ crashes' = crashes + 1
    /\ UNCHANGED <<row, mem, pc, cursor, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, sends, switches>>
    /\ UNCHANGED qvars

-----------------------------------------------------------------------------
(* The person (service.go change()/save(): lock the row, edit, save)         *)

Approve ==
    /\ ~row.deleted
    /\ row.status = "approval"
    /\ row' = [row EXCEPT !.phase = "apply", !.status = "queued"]
    /\ halted' = FALSE
    /\ unapproved' = FALSE
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, wroteWhileHalted,
                   doneNotices, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars

\* stop(): ends the run, clears the lease and the agent run; the engine's
\* Stop sends run.stop after the commit.
Stop ==
    /\ ~row.deleted
    /\ stops < MaxStops
    /\ row.status \in {"queued", "running", "approval"}
    /\ row' = [row EXCEPT !.status = "stopped", !.lease = NoLease, !.expired = FALSE,
                          !.run = NoRun, !.question = NoRun]
    /\ halted' = TRUE
    /\ stops' = stops + 1
    /\ seenEnded' = (seenEnded \/ (row.run # NoRun /\ row.run = seen))
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, retries, crashes, sends, switches>>
    /\ UNCHANGED <<seen, answeredEnded, asks>>

\* retry(): the agent run it had is over. A Retry of an apply whose every
\* step is done finishes the apply (no step left to write); one with steps
\* left goes back to approval. A Retry that plans again is the person asking
\* anew (in Auto its proposal may apply without Approve), so it ends the halt.
Retry ==
    /\ ~row.deleted
    /\ retries < MaxRetries
    /\ row.status \in {"failed", "stopped"}
    /\ IF row.phase = "apply" /\ \A i \in Steps : row.plan[i] = "done"
       THEN /\ row' = [row EXCEPT !.status = "queued", !.run = NoRun, !.question = NoRun]
            /\ UNCHANGED halted
       ELSE IF row.phase = "apply" /\ \E i \in Steps : row.plan[i] # "archived"
       THEN /\ row' = [row EXCEPT !.status = "approval", !.run = NoRun, !.question = NoRun,
                       !.plan = [i \in Steps |->
                                   IF RetryKeepsDone /\ row.plan[i] = "done"
                                   THEN "done" ELSE "pending"]]
            /\ UNCHANGED halted
       ELSE /\ row' = [row EXCEPT !.status = "queued", !.phase = "plan", !.run = NoRun,
                                    !.question = NoRun]
            /\ halted' = FALSE
    /\ retries' = retries + 1
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, crashes, sends, switches>>
    /\ UNCHANGED qvars

\* send(): a new message when no run is busy. archivePlan moves the plan into
\* history; the new request starts in the plan phase. Like a Retry that
\* plans again, it is the person asking anew.
Send ==
    /\ ~row.deleted
    /\ sends < MaxSends
    /\ row.status \notin {"queued", "running"}
    /\ row' = [row EXCEPT !.plan = Archived(row.plan), !.phase = "plan",
                           !.status = "queued"]
    /\ halted' = FALSE
    /\ sends' = sends + 1
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, switches>>
    /\ UNCHANGED qvars

\* reject(): discard the proposal waiting for approval.
Reject ==
    /\ ~row.deleted
    /\ row.status = "approval"
    /\ row' = [row EXCEPT !.plan = Archived(row.plan), !.phase = "plan",
                           !.status = "idle"]
    /\ halted' = TRUE
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars

\* receipts.go discardReview(): no busy check, so it can land mid-apply of a
\* receipt plan. Like Stop, it clears the lease; the plan is archived.
DiscardReview ==
    /\ ~row.deleted
    /\ row' = [row EXCEPT !.plan = Archived(row.plan), !.phase = "plan",
                           !.status = "idle", !.lease = NoLease, !.expired = FALSE]
    /\ halted' = TRUE
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED qvars

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

\* steer() (POST /chats/:id/steer) locks the row and adds a message only while
\* an agent run is live; it touches no field modelled here, so it is a
\* stutter step, listed so the action table names every route.
Steer ==
    /\ ~row.deleted
    /\ row.status = "running"
    /\ row.run # NoRun
    /\ UNCHANGED vars

\* remove(): the row is deleted; every later find() fails.
Delete ==
    /\ AllowDelete
    /\ ~row.deleted
    /\ row' = [row EXCEPT !.deleted = TRUE]
    /\ seenEnded' = (seenEnded \/ (row.run # NoRun /\ row.run = seen))
    /\ UNCHANGED <<mem, pc, cursor, fol, writes, nextLease, proposals, halted, wroteWhileHalted,
                   doneNotices, unapproved, wroteUnapproved, stops, retries, crashes, sends, switches>>
    /\ UNCHANGED <<seen, answeredEnded, asks>>

-----------------------------------------------------------------------------

Next ==
    \/ \E w \in Workers :
         \/ Claim(w) \/ ClaimRead(w) \/ ClaimWrite(w) \/ Renew(w)
         \/ SkipDone(w) \/ StepTx(w) \/ FinishApply(w) \/ FailRun(w)
         \/ PlanRun(w) \/ StartRun(w) \/ Lost(w) \/ Crash(w)
    \/ \E f \in fol : FollowerRenew(f) \/ FollowerEnd(f) \/ FollowerCrash(f)
                     \/ Ask(f) \/ CloseQuestion(f)
    \/ Expire \/ Approve \/ Stop \/ Retry \/ Send \/ Reject \/ DiscardReview
    \/ SetPermission \/ Steer \/ Delete \/ Answer

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

Symm == Permutations(Workers)
=============================================================================
