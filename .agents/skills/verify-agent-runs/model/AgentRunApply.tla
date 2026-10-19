---------------------------- MODULE AgentRunApply ----------------------------
(***************************************************************************)
(* The apply phase of an Agent run: several chat pollers (three lanes per  *)
(* API process; the main checkout and every worktree poll the same         *)
(* `conversations` table) race to claim one conversation whose approved    *)
(* plan writes the person's data, while leases expire, processes crash,    *)
(* commits are lost on the wire, and the person presses Stop, Retry and    *)
(* Approve, or deletes the chat.                                           *)
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
    NSteps,         \* steps in the approved Plan
    MaxLeases,      \* bound on claims (each claim mints a fresh lease id)
    MaxStops,       \* bound on Stop presses
    MaxRetries,     \* bound on Retry presses
    MaxCrashes,     \* bound on worker process deaths
    MaxSends,       \* bound on new messages sent into the chat
    AllowDelete,    \* whether the person may delete the chat
    \* Guards in the code (TRUE = present). See run.sh / coverage.go.
    ClaimLocksRow,         \* work(): claim SELECT ... FOR UPDATE SKIP LOCKED
    StepFenced,            \* apply(): row.Status != "running" || row.Lease != c.Lease
    WritesInStepTx,        \* apply(): catalog := s.factory(tx); tools write through tx
    ApplySkipsDone,        \* apply(): if c.Plan[i].Status == "done" { continue }
    CheckpointFenced,      \* checkpoint(): latest.Lease != c.Lease || latest.Status != "running"
    CheckpointReadsLatest, \* checkpoint(): fn(tx, &latest); tx.Save(&latest)
    RetryKeepsDone         \* retry(): only steps with Status != "done" go back to pending

Steps == 1..NSteps
NoLease == 0

VARIABLES
    row,        \* the conversations row (absent once deleted)
    mem,        \* each worker's in-memory Conversation `c`
    pc,         \* each worker's place in Service.work
    cursor,     \* each worker's loop index in apply()
    writes,     \* committed writes to the person's data, per plan step
    nextLease,  \* next fresh lease id (id("lease_") is random and unique)
    halted,     \* ghost: a Stop or discard has committed and no Approve since
    wroteWhileHalted, \* ghost: a step write committed while halted
    doneNotices,      \* ghost: "Done" notices published (notify txtPushComplete)
    stops, retries, crashes, sends

vars == <<row, mem, pc, cursor, writes, nextLease, halted, wroteWhileHalted,
          doneNotices, stops, retries, crashes, sends>>

\* Step statuses: "pending" | "done" | "failed" | "archived"
\* ("archived" stands for archivePlan: the plan is moved into history and
\*  Plan = [] so the steps can never run again.)
RowType == [status : {"approval", "queued", "running", "stopped", "failed", "idle"},
            phase  : {"apply", "plan"},
            lease  : 0..MaxLeases,
            expired: BOOLEAN,     \* lease_until < now
            plan   : [Steps -> {"pending", "done", "failed", "archived"}],
            deleted: BOOLEAN]

TypeOK ==
    /\ row \in RowType
    /\ pc \in [Workers -> {"idle", "claiming", "apply", "plan", "fail"}]
    /\ cursor \in [Workers -> 1..(NSteps + 1)]
    /\ writes \in [Steps -> Nat]

Init ==
    \* A proposal waiting for approval (runner.go plan(): Status = "approval").
    /\ row = [status |-> "approval", phase |-> "apply", lease |-> NoLease,
              expired |-> FALSE, plan |-> [i \in Steps |-> "pending"],
              deleted |-> FALSE]
    /\ mem = [w \in Workers |-> row]
    /\ pc = [w \in Workers |-> "idle"]
    /\ cursor = [w \in Workers |-> 1]
    /\ writes = [i \in Steps |-> 0]
    /\ nextLease = 1
    /\ halted = FALSE
    /\ wroteWhileHalted = FALSE
    /\ doneNotices = 0
    /\ stops = 0 /\ retries = 0 /\ crashes = 0 /\ sends = 0

-----------------------------------------------------------------------------
(* Worker: claim (runner.go work, the claim Transaction)                     *)

Claimable(r) ==
    /\ ~r.deleted
    /\ \/ r.status = "queued"
       \/ r.status = "running" /\ r.expired

\* The claim transaction is atomic only because the SELECT locks the row
\* (FOR UPDATE SKIP LOCKED) until tx.Save(&c) commits.
Claim(w) ==
    /\ ClaimLocksRow
    /\ pc[w] = "idle"
    /\ Claimable(row)
    /\ nextLease <= MaxLeases
    /\ LET r == [row EXCEPT !.status = "running", !.lease = nextLease,
                            !.expired = FALSE]
       IN /\ row' = r
          /\ mem' = [mem EXCEPT ![w] = r]
          /\ pc' = [pc EXCEPT ![w] = IF r.phase = "apply" THEN "apply" ELSE "plan"]
    /\ cursor' = [cursor EXCEPT ![w] = 1]
    /\ nextLease' = nextLease + 1
    /\ UNCHANGED <<writes, halted, wroteWhileHalted, doneNotices, stops, retries, crashes, sends>>

\* Without the row lock the claim is a read, then a whole-row tx.Save(&c)
\* of what was read.
ClaimRead(w) ==
    /\ ~ClaimLocksRow
    /\ pc[w] = "idle"
    /\ Claimable(row)
    /\ mem' = [mem EXCEPT ![w] = row]
    /\ pc' = [pc EXCEPT ![w] = "claiming"]
    /\ UNCHANGED <<row, cursor, writes, nextLease, halted, wroteWhileHalted,
                   doneNotices, stops, retries, crashes, sends>>

ClaimWrite(w) ==
    /\ pc[w] = "claiming"
    /\ ~row.deleted
    /\ nextLease <= MaxLeases
    /\ LET r == [mem[w] EXCEPT !.status = "running", !.lease = nextLease,
                               !.expired = FALSE]
       IN /\ row' = r
          /\ mem' = [mem EXCEPT ![w] = r]
          /\ pc' = [pc EXCEPT ![w] = IF r.phase = "apply" THEN "apply" ELSE "plan"]
    /\ cursor' = [cursor EXCEPT ![w] = 1]
    /\ nextLease' = nextLease + 1
    /\ UNCHANGED <<writes, halted, wroteWhileHalted, doneNotices, stops, retries, crashes, sends>>

-----------------------------------------------------------------------------
(* Leases (keepLease, and time passing)                                      *)

\* lease_until passes: keepLease missed its 5 s renewals (GC pause, slow DB,
\* a step transaction holding the row lock for minutes, a dead process).
Expire ==
    /\ ~row.deleted
    /\ row.status = "running"
    /\ ~row.expired
    /\ row' = [row EXCEPT !.expired = TRUE]
    /\ UNCHANGED <<mem, pc, cursor, writes, nextLease, halted, wroteWhileHalted,
                   doneNotices, stops, retries, crashes, sends>>

\* keepLease: UPDATE ... WHERE id AND user_id AND lease = ? AND status = 'running'.
\* It does not look at lease_until, so a slow holder can revive its lease.
Renew(w) ==
    /\ pc[w] \in {"apply", "plan", "fail"}
    /\ ~row.deleted
    /\ row.status = "running"
    /\ row.lease = mem[w].lease
    /\ row.expired
    /\ row' = [row EXCEPT !.expired = FALSE]
    /\ UNCHANGED <<mem, pc, cursor, writes, nextLease, halted, wroteWhileHalted,
                   doneNotices, stops, retries, crashes, sends>>

-----------------------------------------------------------------------------
(* Worker: one plan step (runner.go apply, the step Transaction)             *)

Fenced(r, w) == r.status = "running" /\ r.lease = mem[w].lease

\* archivePlan: the plan moves into history (Plan = []); its steps never run.
Archived(p) == [j \in Steps |-> IF p[j] = "done" THEN "done" ELSE "archived"]

\* Skip a step the worker's copy says is done (the `continue`).
SkipDone(w) ==
    /\ pc[w] = "apply"
    /\ cursor[w] \in Steps
    /\ ApplySkipsDone
    /\ mem[w].plan[cursor[w]] = "done"
    /\ cursor' = [cursor EXCEPT ![w] = @ + 1]
    /\ UNCHANGED <<row, mem, pc, writes, nextLease, halted, wroteWhileHalted,
                   doneNotices, stops, retries, crashes, sends>>

Write(i) == writes' = [writes EXCEPT ![i] = @ + 1]

\* The step transaction: lock the row, check the lease, compare snapshots,
\* call the write tool, mark the step done, save, commit. Outcomes:
\*   "ok"         commits; the worker adopts the stored row (*c = next)
\*   "commitLost" commits on the server, but the worker sees an error
\*                (context cancelled during COMMIT, connection drop)
\*   "toolError"  the tool fails; the transaction rolls back
\*   "serial"     40001/40P01/25P02; retrySerializable runs it again
\*   "stale"      a snapshot no longer matches: archivePlan, back to plan
StepTx(w) ==
    /\ pc[w] = "apply"
    /\ cursor[w] \in Steps
    /\ ~(ApplySkipsDone /\ mem[w].plan[cursor[w]] = "done")
    /\ LET i == cursor[w] IN
       IF row.deleted \/ (StepFenced /\ ~Fenced(row, w))
       THEN \* s.find fails or context.Canceled: nothing written
            /\ pc' = [pc EXCEPT ![w] = "fail"]
            /\ UNCHANGED <<row, mem, cursor, writes, wroteWhileHalted>>
       ELSE \E o \in {"ok", "commitLost", "toolError", "serial", "stale"} :
         CASE o \in {"ok", "commitLost"} ->
                LET r == [row EXCEPT !.plan[i] = "done"] IN
                /\ row' = r
                /\ Write(i)
                /\ wroteWhileHalted' = (wroteWhileHalted \/ halted)
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
                /\ pc' = IF o = "serial" THEN pc ELSE [pc EXCEPT ![w] = "fail"]
                /\ UNCHANGED <<row, mem, cursor>>
           [] o = "stale" ->
                LET r == [row EXCEPT !.plan = Archived(row.plan),
                                     !.phase = "plan", !.status = "queued"] IN
                /\ row' = r
                /\ mem' = [mem EXCEPT ![w] = r]
                /\ pc' = [pc EXCEPT ![w] = "idle"]   \* apply returns nil
                /\ UNCHANGED <<cursor, writes, wroteWhileHalted>>
    /\ UNCHANGED <<nextLease, halted, doneNotices, stops, retries, crashes, sends>>

-----------------------------------------------------------------------------
(* Worker: checkpoints (service.go checkpoint)                               *)

\* The row the checkpoint's fn edits and saves.
CheckpointBase(w) == IF CheckpointReadsLatest THEN row ELSE mem[w]

CheckpointAllowed(w) ==
    /\ ~row.deleted
    /\ (CheckpointFenced => Fenced(row, w))

\* Plan loop finished: the final checkpoint publishes "Done".
\* (A batch continuation goes to queued/plan instead; not modelled.)
FinishApply(w) ==
    /\ pc[w] = "apply"
    /\ cursor[w] = NSteps + 1
    /\ IF CheckpointAllowed(w)
       THEN /\ row' = [CheckpointBase(w) EXCEPT !.status = "idle", !.expired = FALSE]
            /\ doneNotices' = doneNotices + 1
       ELSE UNCHANGED <<row, doneNotices>>
    /\ pc' = [pc EXCEPT ![w] = "idle"]
    /\ UNCHANGED <<mem, cursor, writes, nextLease, halted, wroteWhileHalted,
                   stops, retries, crashes, sends>>

FirstNotDone(p) == CHOOSE i \in Steps : p[i] # "done" /\ \A j \in 1..(i - 1) : p[j] = "done"

\* work(): after an error, the failure checkpoint names the first step that
\* is not done and sets Status = "failed".
FailRun(w) ==
    /\ pc[w] = "fail"
    /\ IF CheckpointAllowed(w)
       THEN LET b == CheckpointBase(w) IN
            row' = [b EXCEPT !.status = "failed", !.expired = FALSE,
                    !.plan = IF b.phase = "apply" /\ \E i \in Steps : b.plan[i] # "done"
                             THEN [b.plan EXCEPT ![FirstNotDone(b.plan)] = "failed"]
                             ELSE b.plan]
       ELSE UNCHANGED row
    /\ pc' = [pc EXCEPT ![w] = "idle"]
    /\ UNCHANGED <<mem, cursor, writes, nextLease, halted, wroteWhileHalted,
                   doneNotices, stops, retries, crashes, sends>>

\* plan(): reads and a model call, then one checkpoint. Writes nothing to
\* the person's data; abstracted to a reply (Status = "idle").
PlanRun(w) ==
    /\ pc[w] = "plan"
    /\ IF CheckpointAllowed(w)
       THEN row' = [CheckpointBase(w) EXCEPT !.status = "idle", !.expired = FALSE]
       ELSE UNCHANGED row
    /\ pc' = [pc EXCEPT ![w] = "idle"]
    /\ UNCHANGED <<mem, cursor, writes, nextLease, halted, wroteWhileHalted,
                   doneNotices, stops, retries, crashes, sends>>

\* The API process dies (or shuts down) mid-run; its lease is left to expire.
Crash(w) ==
    /\ pc[w] # "idle"
    /\ crashes < MaxCrashes
    /\ pc' = [pc EXCEPT ![w] = "idle"]
    /\ crashes' = crashes + 1
    /\ UNCHANGED <<row, mem, cursor, writes, nextLease, halted, wroteWhileHalted,
                   doneNotices, stops, retries, sends>>

-----------------------------------------------------------------------------
(* The person (service.go change(): lock the row, edit, Revision++, save)   *)

Approve ==
    /\ ~row.deleted
    /\ row.status = "approval"
    /\ row' = [row EXCEPT !.phase = "apply", !.status = "queued"]
    /\ halted' = FALSE
    /\ UNCHANGED <<mem, pc, cursor, writes, nextLease, wroteWhileHalted,
                   doneNotices, stops, retries, crashes, sends>>

Stop ==
    /\ ~row.deleted
    /\ stops < MaxStops
    /\ row.status \in {"queued", "running", "approval"}
    /\ row' = [row EXCEPT !.status = "stopped", !.lease = NoLease, !.expired = FALSE]
    /\ halted' = TRUE
    /\ stops' = stops + 1
    /\ UNCHANGED <<mem, pc, cursor, writes, nextLease, wroteWhileHalted,
                   doneNotices, retries, crashes, sends>>

Retry ==
    /\ ~row.deleted
    /\ retries < MaxRetries
    /\ row.status \in {"failed", "stopped"}
    /\ row' = IF row.phase = "apply" /\ \E i \in Steps : row.plan[i] # "archived"
              THEN [row EXCEPT !.status = "approval",
                     !.plan = [i \in Steps |->
                                 IF RetryKeepsDone /\ row.plan[i] = "done"
                                 THEN "done" ELSE "pending"]]
              ELSE [row EXCEPT !.status = "queued", !.phase = "plan"]
    /\ retries' = retries + 1
    /\ UNCHANGED <<mem, pc, cursor, writes, nextLease, halted, wroteWhileHalted,
                   doneNotices, stops, crashes, sends>>

\* send(): a new message when no run is busy. archivePlan moves the plan into
\* history; the new request starts in the plan phase.
Send ==
    /\ ~row.deleted
    /\ sends < MaxSends
    /\ row.status \notin {"queued", "running"}
    /\ row' = [row EXCEPT !.plan = Archived(row.plan), !.phase = "plan",
                           !.status = "queued"]
    /\ sends' = sends + 1
    /\ UNCHANGED <<mem, pc, cursor, writes, nextLease, halted, wroteWhileHalted,
                   doneNotices, stops, retries, crashes>>

\* reject(): discard the proposal waiting for approval.
Reject ==
    /\ ~row.deleted
    /\ row.status = "approval"
    /\ row' = [row EXCEPT !.plan = Archived(row.plan), !.phase = "plan",
                           !.status = "idle"]
    /\ halted' = TRUE
    /\ UNCHANGED <<mem, pc, cursor, writes, nextLease, wroteWhileHalted,
                   doneNotices, stops, retries, crashes, sends>>

\* receipts.go discardReview(): no busy check, so it can land mid-apply of a
\* receipt plan. Like Stop, it clears the lease; the plan is archived.
DiscardReview ==
    /\ ~row.deleted
    /\ row' = [row EXCEPT !.plan = Archived(row.plan), !.phase = "plan",
                           !.status = "idle", !.lease = NoLease, !.expired = FALSE]
    /\ halted' = TRUE
    /\ UNCHANGED <<mem, pc, cursor, writes, nextLease, wroteWhileHalted,
                   doneNotices, stops, retries, crashes, sends>>

\* remove(): the row is deleted; every later find() fails.
Delete ==
    /\ AllowDelete
    /\ ~row.deleted
    /\ row' = [row EXCEPT !.deleted = TRUE]
    /\ UNCHANGED <<mem, pc, cursor, writes, nextLease, halted, wroteWhileHalted,
                   doneNotices, stops, retries, crashes, sends>>

-----------------------------------------------------------------------------

Next ==
    \/ \E w \in Workers :
         \/ Claim(w) \/ ClaimRead(w) \/ ClaimWrite(w) \/ Renew(w)
         \/ SkipDone(w) \/ StepTx(w) \/ FinishApply(w) \/ FailRun(w)
         \/ PlanRun(w) \/ Crash(w)
    \/ Expire \/ Approve \/ Stop \/ Retry \/ Send \/ Reject \/ DiscardReview \/ Delete

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* Properties                                                                *)

\* Each approved step changes the person's data at most once.
AtMostOnce == \A i \in Steps : writes[i] <= 1

\* The stored plan says "done" exactly for the steps whose write committed,
\* so Retry and a resumed lease skip precisely the completed changes.
DoneMatchesWrites ==
    ~row.deleted => \A i \in Steps : (row.plan[i] = "done") <=> (writes[i] = 1)

\* After Stop (or a discard) commits, no step write commits until the person
\* approves again.
StopHolds == ~wroteWhileHalted

\* "Done" is published once, and only when every step is done.
OneDoneNotice == doneNotices <= 1
DoneMeansComplete ==
    (~row.deleted /\ row.status = "idle" /\ row.phase = "apply")
        => \A i \in Steps : row.plan[i] = "done"

Symm == Permutations(Workers)
=============================================================================
