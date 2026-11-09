// Package agenthost supervises Timely's agent workers: one Python process per
// account running the vendored Hermes agent (apps/agent, ADR 0026).
//
// The supervisor spawns a worker on first need (Ensure), talks to it over the
// child's stdin and stdout as newline-delimited JSON, logs its stderr, checks
// that it stays healthy, reaps it after the idle time, notices crashes and
// limits restarts, and stops every worker when the API shuts down. It never
// passes extra descriptors (fd 3+), because os/exec cannot do that on Windows,
// a shipped desktop target.
//
// # Wire protocol (Go side, protocol version 1)
//
// apps/agent/PROTOCOL.md is the contract (plan section 5.1 with the names it
// left open fixed). This is the part the supervisor itself relies on:
//
//   - One JSON object per line, UTF-8, "\n" terminated ("\r\n" is accepted).
//     Lines longer than MaxLineBytes are a protocol violation. Go refuses to
//     send one (ErrLineTooLong) before it marks any run live.
//   - Every message carries "type" and "account". The supervisor stamps
//     "account" on everything it sends and kills the worker if a line arrives
//     with a missing or different account (ADR 0001). The one exception is an
//     "error" with no account, which a worker sends before it has pinned its
//     account (refused environment, rejected hello): it is logged or fails
//     the request it answers, and never reaches the handler.
//   - Requests carry "id". A reply uses the same "id". Go's request ids start
//     with "go-", the worker's with "w-". A reply of type
//     "error" ({"type":"error","id":...,"code":...,"message":...}) fails the
//     request with a *ReplyError.
//   - Run-scoped messages carry "run". Outgoing "run.start" and "bot.run"
//     mark the run live (Send gives them an id starting "start-"; a second
//     start of a live run is ErrRunLive); incoming "run.done" and "bot.done"
//     end it. A worker with a live run is never reaped.
//   - Before spawning (Config.RenderAccount): "boot.py prepare --agent-dir
//     <root>" once, then "boot.py render-account --agent-dir <root> --account
//     <id>" with the settings JSON on stdin; its config_sha256 is the hello's
//     settings_hash. Before each spawn managed/config.yaml must still hash to
//     prepare's managed_sha256 (ErrManagedChanged otherwise).
//   - Handshake: Go sends "hello" {protocol, account, home, settings_hash,
//     settings?, catalog_version, timely_skills_dir, browser_executable,
//     managed_sha256}; the worker answers "ready" {protocol,
//     hermes_tag, tools[], plugins_loaded[], self_test{ok, failures[],
//     checks[{name, ok, detail}]}} within Config.HelloTimeout (20 s).
//     self_test.ok must be true, otherwise the worker is stopped and Ensure
//     fails with the failed checks. An "error" reply is ErrWorkerRefused.
//   - Liveness: any line from the worker counts. The worker sends
//     "heartbeat" {busy} every 10 s after ready; when it has been quiet for
//     HeartbeatInterval, Go also sends "ping" {id} and the worker answers
//     "pong" {id, busy}. busy is {runs, learning, children}; a busy worker is
//     never reaped. Silence for HeartbeatTimeout (30 s) kills its process
//     group.
//   - Writes: one goroutine writes the worker's stdin, in order. Request waits
//     for its write only as long as its ctx (the handshake: HelloTimeout);
//     Send, Reply, pings and shutdown wait up to WriteTimeout (30 s). A write
//     still unfinished after WriteTimeout means the worker stopped reading: it
//     is killed like a missed heartbeat, which also unblocks the write. ready
//     carries the interpreter's pid; Go refuses a worker whose pid is outside
//     its process group or Job Object, or whose containment cannot be checked
//     (no pid, a failed check, or a Job Object that could not be set up: the
//     spawn fails). Windows starts the worker suspended, assigns the job, then
//     resumes it, so a venv launcher's child is inside.
//   - "log" {level, text} lines are written to the API log. Everything else
//     (events, tool.call, gate.ask, taint, run.done, ...) goes to
//     Config.Handler in arrival order. With no handler, gate.ask gets a
//     "block" verdict and tool.call an error result, so the worker fails
//     closed at once instead of waiting for its hook timeout.
//   - Refused starts: an "error" carrying "run" and the id of that run's own
//     run.start or bot.run (busy, refused, bad_message, ...) ends the run like
//     run.done would, and reaches Config.Handler (or the Request waiting on
//     its id) so the caller can fail the run. duplicate_run never ends a run
//     (the first start is still live), and neither does an error answering
//     run.stop, run.steer or approval.answer: those are only logged.
//   - Stop: Go sends "shutdown" {grace} and keeps stdin open. grace is
//     ShutdownGrace minus 3 s in whole seconds: the worker waits that long for
//     live runs, then interrupts the rest (about 2 s), so it exits inside
//     ShutdownGrace. While stopping, Go refuses new work (ErrWorkerStopping)
//     but still writes what lets a live run finish: tool.result, gate.verdict,
//     run.stop, run.steer and approval.answer. Go waits ShutdownGrace, closes
//     stdin (the worker's lifeline), then SIGTERMs the process group (Unix),
//     waits KillWait, then SIGKILLs the group (Unix) or terminates the Job
//     Object (Windows).
//
// The package is not wired into the API yet (phase 1 has no user-visible
// change); phase 2's chat engine is its first caller.
package agenthost
