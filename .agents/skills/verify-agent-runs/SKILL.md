---
name: verify-agent-runs
description: Model-checks (TLA+) that an approved Agent run writes each plan step once and nothing after Stop, across chat pollers, lease expiry, crashes, Retry and Delete. Use when changing how chat runs are claimed, leased, applied, checkpointed, stopped, retried or discarded in apps/api/internal/features/chat (runner.go work/keepLease/apply, service.go checkpoint/change/stop/retry/approve/send/reject/remove, receipts.go discardReview) or the chat tool catalog in apps/api/cmd/agent_deps.go.
---

# Verify Agent runs

## The promise

**Property:** an approved Agent run changes the person's data at most once per plan step, the stored plan marks exactly the steps whose change committed, no step's change commits after Stop (or a discard) until the person approves again, and "Done" is published once and only when every step is done.

**Harm if broken:** duplicated Work, Events, sheet rows or edits; changes that land after the person pressed Stop; a run reported done or failed that is not.

Every API process runs three `Service.work` lanes, and the main checkout and every worktree poll the same `conversations` table (unless `DB_SCHEMA` separates them), so one conversation is raced by many pollers. Integration tests (`make test-chat-integration`) run one worker in sequence; this check covers the interleavings.

## Run it

```bash
make verify-agent-runs                 # ~10 s: read guards from code, check drift, run TLC
make verify-agent-runs ARGS=--mutants  # +~20 s: prove each guard matters
```

Needs Java 11+ and Go. `run.sh` downloads `tla2tools.jar` v1.7.4 (sha256-pinned in `run.sh`) once to `~/.cache/timely-verify/` (`TIMELY_VERIFY_CACHE` overrides), and runs TLC in a temp dir, so nothing lands in the repo. No database, no dev servers, no ports.

Exit codes of `run.sh` (make reports them as `Error N`): `0` pass and in sync · `1` property violated · `2` the model no longer matches the code · `3` pass, but covered code changed since the sync commit. On a violation `run.sh` prints TLC's full trace, then a one-line-per-state summary.

## How the check is tied to the code

- `model/AgentRunApply.tla` is the protocol. Each action is one database transaction in the code; its comment names the function.
- `model/AgentRunApply.cfg` holds the bounds and guard constants.
- `tools/coverage.go` parses the covered Go files and:
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
| `RetryKeepsDone` | `service.go` `retry`: only `Status != "done"` steps go back to pending | DoneMatchesWrites |

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
| `Approve`, `Stop`, `Retry`, `Send`, `Reject`, `Delete` | `service.go` `approve`, `stop`, `retry`, `send`, `reject`, `remove` (each one `change()` transaction holding the row lock) |
| `DiscardReview` | `receipts.go` `discardReview` (no busy check, so it can land mid-apply) |
| `Claim` (`ClaimRead`+`ClaimWrite` when unlocked) | the claim transaction in `runner.go` `work` |
| `Expire` / `Renew` | `lease_until` passing / `keepLease` renewing |
| `StepTx` | one step transaction in `apply` (outcomes: `ok`, `commitLost` = committed but the worker saw an error, `toolError`, `serial` = `retrySerializable` rerun, `stale` = snapshot mismatch and `archivePlan`) |
| `SkipDone` | the `continue` over done steps in `apply` |
| `FinishApply` / `FailRun` / `PlanRun` | the final checkpoint in `apply` / the failure checkpoint in `work` / `plan`'s checkpoint |
| `Crash` | the API process dies; its lease is left to expire |

`writes[i]` counts changes to the person's data for plan step `i`; `row.lease` is the `lease` column (a number stands for a random `id("lease_")`); `mem[w]` is worker `w`'s in-memory `c`. Report a trace as steps, e.g. "worker 1 claims and writes step 1; its lease expires; worker 2 claims and writes step 1 again".

## When the covered code changed on purpose

1. Change the model to what the code now does, and the anchors in `tools/coverage.go` to the new code text. Keep the properties as they are; a property changes only when the product promise changes.
2. `make verify-agent-runs ARGS=--mutants` passes and every mutant is caught.
3. Commit the change, then `make verify-agent-runs ARGS=--resync`. It refuses while covered files have uncommitted changes, rewrites `coverage.lock`, and moves the sync commit below. Move the sync commit only after steps 1 and 2.

## Coverage record

Sync commit: `12cb41f8c7865e21b65b37d27366cc06dd6862b5` (the model was last confirmed to describe the code at this commit; `coverage.lock` holds the per-function fingerprints).

- `apps/api/internal/features/chat/runner.go`: `(*Service).work` (claim, failure checkpoint), `(*Service).keepLease`, `(*Service).apply`, `retrySerializable`, `serializationFailure`
- `apps/api/internal/features/chat/service.go`: `(*Service).change`, `send`, `approve`, `stop`, `reject`, `remove`, `retry`, `checkpoint`, `busy`
- `apps/api/internal/features/chat/receipts.go`: `(*Service).discardReview`
- `apps/api/cmd/agent_deps.go`: `chatCatalog`; `apps/api/cmd/main.go`: the `chat.New(...)` wiring (anchor only)

Last proven able to fail at the sync commit: deleting the `row.Status != "running" || row.Lease != c.Lease` check in `apply` gave `guard missing: StepFenced` and a StopHolds trace in about 1 s (Approve, worker 1 claims, the person presses Stop, worker 1's step transaction still writes step 1).

## Bounds and scope

Bounds (`model/AgentRunApply.cfg`): 3 workers, 2 plan steps, 4 claims, 1 Stop, 2 Retries, 1 crash, 1 new message, Delete allowed; about 1.07 million distinct states. A pass covers every interleaving within these bounds, not every size.

Assumed, not checked here:
- Postgres row locks and `SERIALIZABLE` behave as documented, and lease ids never repeat.
- Every write tool reaches the database only through the transaction `chatCatalog(tx, ...)` is built on (anchored at the wiring, not proven per tool). A tool that writes through another handle, a goroutine or an external service breaks at-most-once; review new write tools for this.

Left out:
- The plan phase is abstracted to one checkpoint that writes no data; proposal building, direct proposals, batch continuation (`pendingBatch`), receipt/extract phases and `similar` are not modelled.
- Realtime broadcasts, push delivery (`jobs` queue) and Jev feedback, which sit outside the transaction.
- Liveness: that an approved run eventually finishes.
