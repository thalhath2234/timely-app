---
name: verify-agent-runs
description: Model-checks (TLA+) that an approved Agent run writes each plan step once and nothing after Stop, that a proposal recorded in Supervised never applies without Approve, and that no answer to a question card reaches a run after Stop, Delete or Lost, across chat pollers, both engines (classic lane, agent engine follower), lease expiry, crashes, Retry, permission switches and Delete. Use when changing how chat runs are claimed, leased, handed to the agent engine, applied, checkpointed, stopped, retried or discarded in apps/api/internal/features/chat (runner.go work/runClassic/keepLease/apply, service.go checkpoint/change/save/stop/retry/approve/send/reject/remove/configure/steer, receipts.go discardReview, engine.go, engine_agent.go Start/Lost/renew/save/flush/closeAsked/Answer/done, toolcall.go finishTurn/toolCall/renewLease, permission_mode.go, question.go questionOpen/closeQuestion/answerQuestion) or the chat tool catalog in apps/api/cmd/agent_deps.go.
---

# Verify Agent runs

## The promise

**Property:** an approved Agent run changes the person's data at most once per plan step, the stored plan marks exactly the steps whose change committed, no step's change commits after Stop (or a discard) until the person approves or asks again, "Done" is published once and only when every step is done, a proposal recorded while the chat is Supervised never changes data before the person approves it (plan 5.5b), and an answer to a question card never reaches a run that Stop, Delete, Lost or a failure ended (phase 4, Q-4.3).

**Harm if broken:** duplicated Work, Events, sheet rows or edits; changes that land after the person pressed Stop; a run reported done or failed that is not; a Supervised chat that changes data on its own; an answer the person gave to a card that a stopped, deleted or lost run asked, taken by that run anyway.

Every API process runs three `Service.work` lanes, and the main checkout and every worktree poll the same `conversations` table (unless `DB_SCHEMA` separates them), so one conversation is raced by many pollers. A plan turn runs on one of two engines: classic runs it in the lane under `keepLease`; the agent engine (ADR 0026) takes it from the lane in `Start`, and a follower goroutine in the same API process renews the lease and ends the turn, while the lane goes back to claiming. Integration tests (`make test-chat-integration`) run one worker in sequence; this check covers the interleavings.

## Run it

```bash
make verify-agent-runs                 # ~3.5 min: read guards from code, check drift, run TLC on both checks
make verify-agent-runs ARGS=--mutants  # ~80 s in all: also prove each guard matters
```

Needs Java 11+ and Go. `run.sh` downloads `tla2tools.jar` v1.7.4 (sha256-pinned in `run.sh`) once to `~/.cache/timely-verify/` (`TIMELY_VERIFY_CACHE` overrides), and runs TLC in a temp dir, so nothing lands in the repo. No database, no dev servers, no ports.

Exit codes of `run.sh`: `0` pass and in sync · `1` property violated · `2` the model no longer matches the code · `3` pass, but covered code changed since the sync commit. `make` prints its own `Error N` with run.sh's code and itself exits 2 on any failure, so read run.sh's code from make's message (or run `bash .agents/skills/verify-agent-runs/run.sh` directly). On a violation `run.sh` prints TLC's full trace, then a one-line-per-state summary.

Two checks run on the one model:
- **apply** (`model/AgentRunApply.cfg`): a proposal waits for approval; three lanes race to apply its two steps. The classic apply path, as before phase 2.
- **turn** (`model/AgentRunTurn.cfg`): a new message; two lanes claim it and run the turn on either engine (Start, the follower, Lost), the turn records a one-step proposal that waits or applies at once as the chat's mode decides, the agent run may ask one question card (Ask, CloseQuestion) the person answers (Answer), and the person may switch the mode, Stop, Retry, steer or delete. Two lanes keep it near 3 minutes since the question card (phase 4; before it, 30 s; three lanes took about 3 minutes and 6.6 million states without the card, and found nothing more).

## How the check is tied to the code

- `model/AgentRunApply.tla` is the protocol. Each action is one database transaction in the code; its comment names the function.
- `model/AgentRunApply.cfg` and `model/AgentRunTurn.cfg` hold the bounds and guard constants of the two checks.
- `tools/coverage.go` (built by `run.sh`, not `go run`, so its exit code survives) parses the covered Go files and:
  - sets each **guard** constant from anchor text in the code, so a removed guard is modelled as absent and TLC shows what that allows;
  - checks each **assumption** (row locks, the claim predicate, Stop clearing the lease, ...), and exits 2 when one is gone;
  - fingerprints each covered function (comments and formatting ignored) against `coverage.lock`, and exits 3 on drift.

| Guard constant | Code (anchor in `coverage.go`) | Removing it breaks |
| --- | --- | --- |
| `ClaimLocksRow` | `runner.go` `work`: claim `FOR UPDATE SKIP LOCKED` | StopHolds or DoneMatchesWrites (a stale whole-row `Save` revives a stopped run or un-marks a done step) |
| `StepFenced` | `runner.go` `apply`: `row.Status != "running" \|\| row.Lease != c.Lease` | StopHolds / AtMostOnce |
| `WritesInStepTx` | `apply`: `catalog := s.factory(tx)`; `main.go`: `chatCatalog(tx, ...)` | DoneMatchesWrites / AtMostOnce |
| `ApplySkipsDone` | `apply`: `if c.Plan[i].Status == "done" { continue }` | AtMostOnce |
| `CheckpointFenced` | `service.go` `checkpoint`: lease and status check | OneDoneNotice |
| `CheckpointReadsLatest` | `checkpoint`: locked `find`, `fn(tx, &latest)`, `Save(&latest)` | DoneMatchesWrites |
| `RetryKeepsDone` | `service.go` `retry`: only `Status != "done"` (and not discarded) steps go back to pending | DoneMatchesWrites |
| `AnswerFenced` | `question.go` `questionOpen`: status `running`, `agent_run_id` set and equal to `question.run`, same `requestId`; `answerQuestion`: `if !questionOpen(&row, requestID) { return errCardClosed }` | NoAnswerAfterEnd (turn check) |
| `HoldsSupervised` | `permission_mode.go` `holdReason`: `mode == agent.Supervised` returns `heldSupervised`; `proposalStatus` returns `"approval"` for any hold reason; `toolcall.go` `finishTurn`: `row.Status = proposalStatus(row, ...)` on the stored row | SupervisedHolds (turn check) |

## Reading a result

- **`guard missing: X`, then FAIL with a trace**: a guard's anchor text is gone. Open the function named. If the guard really is gone or weakened, the trace is a real bug: report it in the code's words (below) and leave it for the person to decide. If the code still guards the same thing in new words, it is a modelling error: update that anchor's `Text` in `tools/coverage.go` to the new code and rerun.
- **`MODEL MISMATCH`** (exit 2): an assumption the model has no switch for is gone, so the model no longer describes the code. Read the changed function, change the matching action in `AgentRunApply.tla` to what the code now does, update the anchor, and rerun with `--mutants`.
- **`DRIFT`** (exit 3): a covered function changed. Read its diff against the sync commit (`git diff <sync> -- <file>`). If the change does not touch what any action models (logging, a new field, copy), nothing to do but resync. If it does, update the model first.
- **FAIL with all guards TRUE**: either a real protocol bug, or an action that lets the model do something the code cannot. Check each step of the trace against the code before calling it a bug.
- **`--mutants` reports `NO VIOLATION`**: the model stopped exercising that guard. Fix the model; a check that cannot fail proves nothing.

## Reading a counterexample

TLC prints numbered states, each labelled with the action that produced it. Translate each action:

| Action | In the code |
| --- | --- |
| `Approve`, `Stop`, `Retry`, `Send`, `Reject`, `Delete` | `service.go` `approve`, `stop`, `retry`, `send`, `reject`, `remove` (each one `change()`/`save()` transaction holding the row lock; Stop and Retry also clear `agent_run_id`) |
| `SetPermission` | `service.go` `configure` with `{permission}`: any time, mode only |
| `Steer` | `service.go` `steer`: adds a message to a live agent run; changes nothing modelled (a stutter). A steer or a send while a card waits is `Answer` |
| `Ask` | `engine_agent.go` `ask` -> `flush`: the worker's `clarify.request`; the card (`question`) goes on the row in the follower's fenced save, with one push |
| `CloseQuestion` | `engine_agent.go` `closeAsked`: the worker's `clarify.closed` (timed out, cancelled); a card still on the row closes in the follower's fenced save |
| `Answer` | `question.go` `answerQuestion` (`POST /chats/:id/answer`, and `send`/`steer` while a card waits): the fenced commit that closes the card, then `clarify.answer` |
| `DiscardReview` | `receipts.go` `discardReview` (no busy check, so it can land mid-apply) |
| `Claim` (`ClaimRead`+`ClaimWrite` when unlocked) | the claim transaction in `runner.go` `work`, which also picks the engine (`runEngine`) for a fresh plan turn |
| `Expire` / `Renew` | `lease_until` passing / `keepLease` renewing (classic lanes) |
| `StartRun` | `engine.go` `startAgentRun` -> `engine_agent.go` `Start`: the fenced checkpoint that names the run (`agent_run_id`), then the follower takes the lease; failures go to `FailRun` |
| `Lost` | `work` re-claimed an expired agent row: `Lost` re-attaches the follower of the run the row names (it adopts the new lease), else `clearRun` and `FailRun` (Try again) |
| `FollowerRenew` | `engine_agent.go` `renew` -> `toolcall.go` `renewLease` (the same UPDATE as `keepLease`, every 20 s) |
| `FollowerEnd` | `engine_agent.go` `done` -> `finishTurn`, or `stopped` / `fail`, all through the fenced `checkpoint` under the run's current lease |
| `FollowerCrash` | the API process that runs a follower dies; its lease is left to expire |
| `PlanRun` | classic `plan()` ending with `finishTurn`: a reply, or a proposal that is held (`approval`) or applied at once (`queued`, apply phase) |
| `StepTx` | one step transaction in `apply` (outcomes: `ok`, `commitLost` = committed but the worker saw an error, `toolError`, `serial` = `retrySerializable` rerun, `stale` = snapshot mismatch and `archivePlan`) |
| `SkipDone` | the `continue` over done steps in `apply` |
| `FinishApply` / `FailRun` | the final checkpoint in `apply` / the failure checkpoint in `work` |
| `Crash` | the API process of a lane dies, with any follower it ran; their lease is left to expire |

`writes[i]` counts changes to the person's data for plan step `i`; `row.lease` is the `lease` column (a number stands for a random `id("lease_")`); `row.run` is `agent_run_id` (a number: the lease Start held, `0` = none); `row.mode` is `permission`; `mem[w]` is lane `w`'s in-memory `c`; `fol` is the set of live followers (`run`, `lease`, the lane whose process runs it); `unapproved` is set when a proposal is recorded while the stored row says Supervised and cleared by Approve; `row.question` is the run whose card waits (`0` = `{}`), `seen` the run whose card the person's screen shows, `ended` the runs the row recorded as ended by Stop, Delete, Lost or a failure, and `answeredEnded` is set when an answer reaches one of them. Report a trace as steps, e.g. "worker 1 claims and writes step 1; its lease expires; worker 2 claims and writes step 1 again".

## When the covered code changed on purpose

1. Change the model to what the code now does, and the anchors in `tools/coverage.go` to the new code text. Keep the properties as they are; a property changes only when the product promise changes.
2. `make verify-agent-runs ARGS=--mutants` passes and every mutant is caught.
3. Commit the change, then `make verify-agent-runs ARGS=--resync`. It refuses while covered files have uncommitted changes, rewrites `coverage.lock`, and moves the sync commit below. Move the sync commit only after steps 1 and 2.

## Coverage record

Sync commit: `00727d83cb5125132f10a98993700bce1f72af7f` (the model was last confirmed to describe the code at this commit; `coverage.lock` holds the per-function fingerprints).

- `apps/api/internal/features/chat/runner.go`: `(*Service).work` (claim, engine dispatch, failure checkpoint), `runClassic`, `keepLease`, `apply`, `retrySerializable`, `serializationFailure`
- `apps/api/internal/features/chat/service.go`: `(*Service).change`, `save`, `send`, `approve`, `stop`, `reject`, `remove`, `retry`, `checkpoint`, `configure`, `steer`, `busy`
- `apps/api/internal/features/chat/receipts.go`: `(*Service).discardReview`
- `apps/api/internal/features/chat/engine.go`: `runEngine`, `startAgentRun`, `lostAgentRun`
- `apps/api/internal/features/chat/engine_agent.go`: `(*WorkerEngine).Start`, `clearRun`, `Lost`, `Stop`, `loop`, `save`, `renew`, `done`, `stopped`, `fail`, `failWith`
- `apps/api/internal/features/chat/toolcall.go`: `(*Service).toolCall` (reads only), `finishTurn`, `endRun`, `renewLease`
- `apps/api/internal/features/chat/permission_mode.go`: `proposalStatus`, `holdReason`
- `apps/api/internal/features/chat/question.go`: `questionOpen`, `closeQuestion`, `(*Service).answerQuestion`; `engine_agent.go` also `flush`, `closeAsked`, `Answer`; `service.go` also `sendMessage`
- `apps/api/cmd/agent_deps.go`: `chatCatalog`; `apps/api/cmd/main.go`: the `chat.New(...)` wiring (anchor only)

Model changed 2026-11-13 (phase 4, Q-4.3): a question card. The row gains `question` (the run whose card waits), the person's screen `seen`; actions Ask and CloseQuestion (the follower's fenced saves) and Answer (the person's fenced commit); Stop, Retry, Lost's `clearRun`, a turn's end and a failed or stopped run close the card; the property NoAnswerAfterEnd and the guard `AnswerFenced` (its mutant: Ask, Stop, then an answer to the stopped run). `send` moved its transaction into `sendMessage` (the anchors followed), and `runEngine` keeps photo chats classic and lets Sensitive chats follow the chat's engine only with the test-only no-persist switch (`Start` then sends a no-persist run: no claim, lease or checkpoint changes). Bounds: the turn check allows one card (`MaxAsks = 1`), the apply check none.

Code changed 2026-11-13 (phase 4 exit), model unchanged: `(*WorkerEngine).Start` appends the Timely block's ask line (`askHint`) for a run that may ask; nothing about claim, lease, Stop or the card changed.

Resynced 2026-11-12 (owner decision Q-3.9): `toolCall` (the timely backend's `web_search` and `web_extract` no longer take the conversation: Timely's web rule after taint is gone, and `preview_bot` reads through the plain pre-approval guard) and `Start` (run.start no longer carries `person_hosts`, `person_links`, `search_results` or `private_context`) changed; neither changes how a run is claimed, leased, checkpointed, held or applied, so the model did not change, and `--mutants` caught all eight guards.

Resynced 2026-11-12 (phase 3 review round 7): `fail` now delegates to `failWith` (the anchor moved there: the same fenced save, plus a "This reply failed." notice tagged with the run so its learning shows under it; a refused run.start leaves none), and `Start` (run.start carries `search_results`, the chat's clean searches' results) changed; neither changes how a run is claimed, leased, checkpointed, held or applied, so the model did not change, and `--mutants` caught all eight guards.

Resynced 2026-11-12 (phase 3 review round 6): `stop` and `stopped` (the cut reply and the Stopped notice carry the stopped run's id, so its learning shows under them), `configure` and `Start` (the stop-learning hook takes a search-only flag; after sending run.start, Start also sends the search-only stop when "Search my past chats" turned off meanwhile) changed; none of them changes how a run is claimed, leased, checkpointed, held or applied, so the model did not change, and `--mutants` caught all eight guards.

Resynced 2026-11-12 (phase 3 review round 5): `Start` (after its checkpoint it narrows the run's learning flags to the row it locked and the account's switches, and after sending run.start it sends learning.stop when either turned off meanwhile) changed; it does not change how a run is claimed, leased, checkpointed, held or applied, so the model did not change, and `--mutants` caught all eight guards.

Resynced 2026-11-12 (phase 3 review round 2): `Start` (run.start carries `person_links`, the links the person typed, for the page rule every web backend now shares) changed; it does not change how a run is claimed, leased, checkpointed, held or applied, so the model did not change, and `--mutants` caught all eight guards.

Resynced 2026-11-12 (phase 3 review fixes): `toolCall` (web_search gets the conversation for the exfiltration rule's host check) and `Start` (run.start carries `search_allow` and `private_context`) changed; neither changes how a run is claimed, leased, checkpointed, held or applied, so the model did not change, and `--mutants` caught all eight guards.

Resynced 2026-11-11 (phase 3): `configure` (the `noLearning` field), `toolCall` (the web branches), `finishTurn` (messages carry the agent run id) and `Start` (the run's learning and web setup) changed; none of them changes how a run is claimed, leased, checkpointed, held or applied, so the model did not change, and `--mutants` caught all eight guards.

Last proven able to fail (2026-11-13, phase 4): `--mutants` caught all nine guards, `AnswerFenced` in the turn check (NoAnswerAfterEnd: a run asks, the person stops it, and the card still on screen is answered to the stopped run). Earlier (2026-11-09, phase 2): with `HoldsSupervised` removed, the turn check gave a SupervisedHolds trace in 5 states (a lane claims the new message, its turn records the proposal as queued in a Supervised chat, a lane claims it and the step transaction writes); with `CheckpointFenced` removed, the turn check alone gave DoneMeansComplete in 6 states (a lane claims, its lease expires, a second lane claims, both plan turns commit). Every guard's mutant is caught (`--mutants`): seven in the apply check, `HoldsSupervised` in the turn check.

## Bounds and scope

Bounds:
- apply (`AgentRunApply.cfg`): 3 lanes, 2 plan steps, 4 claims, 1 Stop, 2 Retries, 1 crash, 1 new message, Delete allowed, no agent engine, no mode switch; about 1.01 million distinct states, 14 s.
- turn (`AgentRunTurn.cfg`): 2 lanes and the followers they start, 1 plan step, 4 claims, 1 Stop, 1 Retry, 1 crash, 1 new message, 1 permission switch, 1 question card, starting Supervised, Delete allowed, both engines; about 10.4 million distinct states, 190 s (1.75 million and 30 s before the question card).

A pass covers every interleaving within these bounds, not every size.

Assumed, not checked here:
- Postgres row locks and `SERIALIZABLE` behave as documented, and lease ids never repeat.
- Every write tool reaches the database only through the transaction `chatCatalog(tx, ...)` is built on (anchored at the wiring, not proven per tool). A tool that writes through another handle, a goroutine or an external service breaks at-most-once; review new write tools for this.
- A turn writes no Timely data: `toolCall` runs read tools and refuses write tools (anchored), and the agent engine's worker reaches Timely only through `tool.call` (ADR 0007). The DB audit in the phase 2 record (plan section 13) checks this on a live run. Phase 3's web branches of `toolCall` (the timely backend's `web_search` and `web_extract`) only read a search answer or a page; the taint they add can only hold a proposal for review, which the model's free hold choice already covers. Since Q-3.9 they apply no rule of their own after taint.
- Full Access lifts nothing more than Auto for Timely data in phases 2 and 3, so the model has two modes.
- Lost re-attaches only in the API process that runs the follower; the model lets any lane re-attach the follower of the run the row names, which is more than the code allows.

Left out:
- The plan turn is abstracted to its last checkpoint (`finishTurn`) and the hold decision to Supervised plus a free choice for every other hold reason; proposal building, partial approval and discarded steps, batch continuation (`pendingBatch`), receipt/extract phases, the activity checkpoints of the follower (fenced, they only renew `lease_until` as far as this model sees) and the `similar` pointer (status `choose`) are not modelled. One proposal is recorded per behaviour.
- Undo (`undo.go`): the person's Undo queues the inverse plan into the same apply; it is like an Approve of a new plan and is not modelled.
- The follower's own copy of the row: its saves are modelled on the stored row, so `CheckpointReadsLatest` is exercised on lanes only (the same `checkpoint` function).
- Realtime broadcasts, push delivery (`jobs` queue) and Jev feedback, which sit outside the transaction.
- Liveness: that an approved run eventually finishes.
