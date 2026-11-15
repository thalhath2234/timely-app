----------------------------- MODULE BotRunPark -----------------------------
(***************************************************************************)
(* Phase 6 (Q-B2, plan 7.5): an agent Bot's tick runs in the worker as a   *)
(* bot.run, and nobody can approve during it. A step the Bot's mode holds  *)
(* is answered "approve": the worker parks it and the tick goes on, and Go *)
(* writes it as a parked host card on the Bot's thread, a chat row of kind *)
(* bot_thread (ParkCard, parkBotCard). The person answers it on the thread *)
(* (answerBotCard): Deny closes it; Run once closes it approved and runs   *)
(* the thread under a fresh lease naming the continuation (AnswerOnce),    *)
(* whose goroutine sends a bot.run carrying the card's call as             *)
(* pre_approved only while the row still runs it under that lease          *)
(* (ContSend, ContFenced: BotAgent.run's fence, botRowHolds). The worker   *)
(* runs the pre-approved call at most once, never for a run it got         *)
(* run.stop for (RunCall), and the continuation ends on the row fenced on  *)
(* its lease (ContDone, finishBotCard). A card past its time expires       *)
(* (ExpireHost); Stop and Delete on the thread close a waiting card and,   *)
(* through WorkerEngine.Stop (stopBotRun) or the continuation's failing    *)
(* lease renewal, send run.stop to a continuation already sent.            *)
(*                                                                         *)
(* Every action is one database transaction in the code (or one pipe      *)
(* message); its comment names the function. The boolean constants are    *)
(* guards in the code: run.sh reads each one from an anchor in the Go      *)
(* source (tools/coverage.go), so removing a guard there removes it here.  *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS
    MaxAnswers,     \* bound on answers pressed (Run once or Deny, retries included)
    MaxStops,       \* bound on Stop presses on the thread
    AllowDelete,    \* whether the thread (or its Bot) may be deleted
    BotAnswerFenced,  \* answerBotCard: the row waits on this very card (409 otherwise)
    BotContFenced,    \* BotAgent.run: bot.run goes out only while the row runs it under its lease
    BotStopReaches    \* WorkerEngine.Stop -> stopBotRun, and the failing renewal, send run.stop

Conts == 1..MaxAnswers      \* continuation ids: one per answer at most
NoRun == 0

VARIABLES
    row,        \* the Bot thread: [status, card, run, lease, deleted]
    nextLease,  \* leases minted so far (each answer mints one)
    cont,       \* cont[c]: "none", "queued" (goroutine started), "sent", "done"
    contLease,  \* the lease answer c gave its continuation
    pre,        \* pre[c]: the worker still holds c's pre-approved call
    wstopped,   \* continuations the worker got run.stop for
    parked,     \* the card was asked (one card per model run)
    answers, stops,
    resolved,   \* how many times the card closed (answered, expired, stopped)
    approved,   \* how many Run once answers committed
    ran,        \* calls the worker ran
    halted,     \* Stop or Delete committed after the card was asked
    ranAfterStop

vars == <<row, nextLease, cont, contLease, pre, wstopped, parked, answers, stops,
          resolved, approved, ran, halted, ranAfterStop>>

Statuses == {"idle", "host_approval", "running", "stopped"}

TypeOK ==
    /\ row.status \in Statuses
    /\ row.card \in {"none", "pending"}
    /\ row.run \in Conts \cup {NoRun}
    /\ row.lease \in 0..MaxAnswers
    /\ row.deleted \in BOOLEAN
    /\ cont \in [Conts -> {"none", "queued", "sent", "done"}]
    /\ pre \in [Conts -> BOOLEAN]
    /\ wstopped \subseteq Conts

Init ==
    /\ row = [status |-> "idle", card |-> "none", run |-> NoRun, lease |-> 0, deleted |-> FALSE]
    /\ nextLease = 0
    /\ cont = [c \in Conts |-> "none"]
    /\ contLease = [c \in Conts |-> 0]
    /\ pre = [c \in Conts |-> FALSE]
    /\ wstopped = {}
    /\ parked = FALSE
    /\ answers = 0 /\ stops = 0
    /\ resolved = 0 /\ approved = 0 /\ ran = 0
    /\ halted = FALSE /\ ranAfterStop = FALSE

\* parkBotCard: a tick's gate.ask answered "approve" writes the card on a
\* free thread (idle, stopped or failed, and no card waiting); a busy one
\* gets a "Not asked" notice instead, which changes nothing here.
ParkCard ==
    /\ ~parked
    /\ ~row.deleted
    /\ row.status \in {"idle", "stopped"} /\ row.card = "none"
    /\ row' = [row EXCEPT !.status = "host_approval", !.card = "pending"]
    /\ parked' = TRUE
    /\ halted' = FALSE
    /\ UNCHANGED <<nextLease, cont, contLease, pre, wstopped, answers, stops, resolved, approved, ran, ranAfterStop>>

\* The fence of answerBotCard (BotAnswerFenced): the row waits on the card.
AnswerOpen == IF BotAnswerFenced THEN row.status = "host_approval" /\ row.card = "pending" ELSE TRUE

\* answerBotCard, Run once: the card closes approved and the thread runs
\* the continuation under a fresh lease, in one transaction; ContinueBot
\* then starts the continuation's goroutine.
AnswerOnce ==
    /\ ~row.deleted
    /\ answers < MaxAnswers
    /\ AnswerOpen
    /\ LET c == answers + 1 IN
       /\ row' = [row EXCEPT !.status = "running", !.card = "none", !.run = c, !.lease = nextLease + 1]
       /\ cont' = [cont EXCEPT ![c] = "queued"]
       /\ contLease' = [contLease EXCEPT ![c] = nextLease + 1]
    /\ nextLease' = nextLease + 1
    /\ answers' = answers + 1
    /\ resolved' = resolved + 1
    /\ approved' = approved + 1
    /\ UNCHANGED <<pre, wstopped, parked, stops, ran, halted, ranAfterStop>>

\* answerBotCard, Deny: the card closes denied, the thread goes idle.
AnswerDeny ==
    /\ ~row.deleted
    /\ answers < MaxAnswers
    /\ AnswerOpen
    /\ row' = [row EXCEPT !.status = "idle", !.card = "none"]
    /\ answers' = answers + 1
    /\ resolved' = resolved + 1
    /\ UNCHANGED <<nextLease, cont, contLease, pre, wstopped, parked, stops, approved, ran, halted, ranAfterStop>>

\* expireHost (the sweep) or answerBotCard after the card's time: Expired.
ExpireHost ==
    /\ ~row.deleted
    /\ row.status = "host_approval" /\ row.card = "pending"
    /\ row' = [row EXCEPT !.status = "idle", !.card = "none"]
    /\ resolved' = resolved + 1
    /\ UNCHANGED <<nextLease, cont, contLease, pre, wstopped, parked, answers, stops, approved, ran, halted, ranAfterStop>>

\* The run.stop WorkerEngine.Stop sends to the continuation the row named
\* (stopBotRun), when its bot.run went out (before that, run sends it right
\* after bot.run, on the same pipe: modelled as sent with the commit).
StoppedConts(r) ==
    IF BotStopReaches /\ r # NoRun /\ cont[r] = "sent" THEN wstopped \cup {r} ELSE wstopped

\* service.stop on the thread: a waiting card closes Stopped, a running
\* continuation's run and lease leave the row; the engine's Stop follows.
Stop ==
    /\ ~row.deleted
    /\ stops < MaxStops
    /\ row.status \in {"host_approval", "running"}
    /\ row' = [row EXCEPT !.status = "stopped", !.card = "none", !.run = NoRun, !.lease = 0]
    /\ resolved' = IF row.card = "pending" THEN resolved + 1 ELSE resolved
    /\ wstopped' = StoppedConts(row.run)
    /\ halted' = parked
    /\ stops' = stops + 1
    /\ UNCHANGED <<nextLease, cont, contLease, pre, parked, answers, approved, ran, ranAfterStop>>

\* service.remove on the thread (or the Bot's delete, which cascades to it):
\* the row is gone; the engine's Stop, or the continuation's failing lease
\* renewal, stops a continuation already sent.
Delete ==
    /\ AllowDelete
    /\ ~row.deleted
    /\ row' = [row EXCEPT !.deleted = TRUE]
    /\ wstopped' = StoppedConts(row.run)
    /\ halted' = parked
    /\ UNCHANGED <<nextLease, cont, contLease, pre, parked, answers, stops, resolved, approved, ran, ranAfterStop>>

\* The continuation's fence holds: the row still runs it under its lease.
RowHolds(c) == ~row.deleted /\ row.status = "running" /\ row.run = c /\ row.lease = contLease[c]

\* BotAgent.run: bot.run with pre_approved goes out (BotContFenced: only
\* while the row holds it).
ContSend(c) ==
    /\ cont[c] = "queued"
    /\ ~BotContFenced \/ RowHolds(c)
    /\ cont' = [cont EXCEPT ![c] = "sent"]
    /\ pre' = [pre EXCEPT ![c] = TRUE]
    /\ UNCHANGED <<row, nextLease, contLease, wstopped, parked, answers, stops, resolved, approved, ran, halted, ranAfterStop>>

\* BotAgent.run: the fence fails, nothing is sent; finishBotCard settles
\* the card Not run (no row change modelled: the row is not the
\* continuation's any more).
ContFenced(c) ==
    /\ BotContFenced
    /\ cont[c] = "queued"
    /\ ~RowHolds(c)
    /\ cont' = [cont EXCEPT ![c] = "done"]
    /\ UNCHANGED <<row, nextLease, contLease, pre, wstopped, parked, answers, stops, resolved, approved, ran, halted, ranAfterStop>>

\* The worker runs the pre-approved call: once (pre_approved is used up),
\* and never for a run it got run.stop for (timely_gate rule 1).
RunCall(c) ==
    /\ cont[c] = "sent"
    /\ pre[c]
    /\ c \notin wstopped
    /\ pre' = [pre EXCEPT ![c] = FALSE]
    /\ ran' = ran + 1
    /\ ranAfterStop' = (ranAfterStop \/ halted)
    /\ UNCHANGED <<row, nextLease, cont, contLease, wstopped, parked, answers, stops, resolved, approved, halted>>

\* bot.done: finishBotCard sends the row the continuation still holds under
\* its lease back to idle; otherwise (Stop, Delete) it only settles the card.
ContDone(c) ==
    /\ cont[c] = "sent"
    /\ cont' = [cont EXCEPT ![c] = "done"]
    /\ pre' = [pre EXCEPT ![c] = FALSE]
    /\ row' = IF RowHolds(c) THEN [row EXCEPT !.status = "idle", !.run = NoRun, !.lease = 0] ELSE row
    /\ UNCHANGED <<nextLease, contLease, wstopped, parked, answers, stops, resolved, approved, ran, halted, ranAfterStop>>

Next ==
    \/ ParkCard \/ AnswerOnce \/ AnswerDeny \/ ExpireHost \/ Stop \/ Delete
    \/ \E c \in Conts : ContSend(c) \/ ContFenced(c) \/ RunCall(c) \/ ContDone(c)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* Properties                                                                *)

\* A Bot's parked card closes at most once (answered, expired or stopped).
HostResolvesOnce == resolved <= 1

\* No approved call runs after the person pressed Stop on the thread or
\* deleted it (or its Bot) once the card was asked.
NoHostToolAfterStop == ~ranAfterStop

\* The approved call runs at most once, and only after Run once.
ContinuationOnce == ran <= 1 /\ (ran > 0 => approved > 0)
=============================================================================
