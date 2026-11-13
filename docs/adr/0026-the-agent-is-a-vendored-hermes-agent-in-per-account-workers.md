# Timely's agent is a vendored Hermes-derived Python agent in per-account workers

- Status: Proposed
- Date: 2026-11-08

Timely's in-app agent today is a Go loop that calls Timely tools and drives
each provider as a pure model (ADR 0009). The owner wants it to work like
Hermes Agent (NousResearch, MIT licence): skills, memory, a learning loop,
past-chat search, delegation, web, browser, terminal and files. Users should be
able to do everything Hermes can do through Timely without installing Hermes,
and the code should stay close enough to upstream that new Hermes releases
arrive by merge. The plan,
[`docs/plans/2026-11-08-timely-agent-from-hermes.md`](../plans/2026-11-08-timely-agent-from-hermes.md),
has the detail and the evidence; this ADR records the decisions.

**Timely owns a copy of Hermes and merges upstream with git.** Whole Hermes
Python packages, its skills and its tool connectors live at
`apps/agent/hermes/` as a filtered snapshot of one upstream release, keeping
upstream's import names. `make hermes-sync` builds one snapshot commit per
tagged release on a vendor line and merges it into Timely with a merge commit,
never a squash or rebase. Upstream tags are unsigned, so the sync checks each
tag against GitHub's releases and Timely's record of every tag it imported, and
refuses a moved tag. Tagged releases are taken every one or two weeks, security
fixes at once, and there is no scheduled CI job that opens draft sync PRs (the
owner's answer to Q-1.2). Timely never edits, moves, reformats or deletes a
vendored file. Its own code lives in adapters at `apps/agent/timely_agent/` and
plugs in through Hermes' public seams: constructor arguments, callbacks, plugin
hooks and config files. Edits inside vendored files start at zero, each marked
and listed, with a hard cap of five (the recommended answer to Q-1.3 in the
plan). A sync merges only when every new tool is classified in Timely's tool
policy, every changed skill has been read by a developer, the seams Timely
relies on are unchanged or re-reviewed, and the contract tests pass. A tool the
policy does not know is blocked.

**One worker per active account, spawned by the Go API.** For each account in
use, the API starts one Python process with its own agent home (the account's
Hermes folder: memory, skills, the agent's session database) under the data
directory, and talks to it with JSON lines over the child's stdin and stdout.
That is the one transport Go can hand a child on Windows too, so there are no
ports, no tokens and no Hermes gateway. The worker's environment is built from
an allowlist, so Timely's own secrets never reach it or the commands it runs.
Workers start on first need and are stopped after 15 idle minutes, at most 3 at
a time; both numbers are on Settings → Server. One process per account, not one
for all, because Hermes keeps terminal settings and caches in process globals
and some of its features (the kanban board, the agent roster) cross profiles by
design, which would break ADR 0001.

**Direct mode, with an automatic backup mode.** The worker builds Hermes' agent
itself and keeps one per conversation, which the learning loop needs
(ADR 0028). If direct mode fails its startup self-test, for example because a
sync moved a seam, or crashes twice within 10 minutes at startup, Go switches
that account's worker to backup mode: the same worker starts Hermes' own HTTP
API (`api_server`) alone, on loopback with a per-worker token, with the cron
ticker and every messaging adapter off and the same Timely plugins and config,
and Go talks to it over HTTP. Go never switches mid-run and never retries a run
across modes, so nothing runs twice. Backup mode is degraded, and Settings →
Agent says "Running in backup mode" with the reason: tool sets are fixed per
platform rather than per run, and the agent is rebuilt for every request, so
the skill nudge never fires. Go tries direct mode again at the next worker
start after a release changes the copy. Both modes are code inside Timely's
download, and every sync runs the contract tests in both.

**Go stays the owner of Timely data and the record.** Postgres
`agent_conversations` stays the record the apps read; the agent's SQLite
transcript is a working copy Go can rebuild from Postgres. Timely's read tools
reach the agent through a Timely plugin that calls Go over the pipe, so
authority, Sensitive chats, answer-only turns and the outside-data mark stay in
one Go code path that both engines share. Changes to the person's data arrive
only as Agent proposals (ADR 0007), which Go applies with today's model-free
apply; write tools are never Hermes tools. Provider selection, encrypted
per-account keys and the provider fixed at claim stay in Go (ADR 0009,
ADR 0019, ADR 0020). Go hands the run's key to the worker for each run, and
Hermes calls API-key providers directly. Hermes' fallback to another model
(`fallback_model`) is never configured, and its auxiliary calls (compression,
titles, the learning pass) use only the run's provider or the person's chosen
learning model, so Timely still never switches providers silently. The Claude
Code and Codex CLIs, and Sensitive runs, go through a Go model endpoint on its
own 127.0.0.1 listener, never the API's Tailscale address.

**The person sets how much the agent may do alone.** A permission mode, set
per account, chat and Bot, decides which calls need approval: Supervised
(every action asks; the default for new chats), Auto (only destructive and
critical actions ask: deleting or overwriting, sending data out, paying or
signing in, installing, changing settings, and writes after reading outside
pages) or Full Access (nothing asks; turning it on needs step-up). Go owns the
critical list. Hermes' hardline blocklist, the secret allowlist, account
isolation and staged learning hold in every mode.

**Host actions that need approval are asked per call.** Every terminal,
process, code, file and browser call passes a Timely gate plugin that asks Go,
which answers from the permission mode; when approval is needed, Hermes' own
approval gate raises it and Timely shows it as a host card: Run once or Deny (the
recommended answer to Q-5.1, which also asks whether to add "Allow for this
chat" as a grant Timely keeps itself). Hermes' "always allow" lists are never
offered, and no skill, memory or prompt can grant an approval. A worker whose
gate plugin is not loaded refuses to serve, and a gate that does not answer in
time denies. Whether a card may be approved only in the desktop window or on
any device after device unlock is open (Q-5.7). Only a host-trusted account
(below) can run commands or touch files on the host at all.

**Timely apps only.** The agent and Bots are reachable only through Timely web,
desktop and mobile, over the API's authenticated routes. Hermes' messaging
platforms stay in the copy because its core modules import them, but they are
never started or configured, messaging tools are blocked by name, and the
self-test fails if one resolves.

**Every Timely download ships the runtime.** The Linux and Windows desktop
installers bundle a standalone Python interpreter, the copy and its
dependencies (about 105 MB more to download), and the Docker image moves from
Alpine to Debian slim with the same runtime. The API spawns workers; there is
no fourth desktop sidecar. Today's Go loop stays the default engine until the
new one matches it on the agent QA scenarios and every download ships the
runtime; then the Go loop is deleted.

**This amends ADR 0001 with a host-trusted account.** Making an account
host-trusted is a decision of whoever runs the host, made outside Timely's
account system: in the desktop window, through an action only the desktop app's
own window can call, or on a server through `TIMELY_AGENT_HOST_ACCOUNTS`.
Nobody is host-trusted by default. It is not a role: it grants no access to
other accounts through Timely's API, and the API still returns not-found for
cross-account reads. But an approved host command of a host-trusted account
runs as the host's OS user and can read the host, including other accounts'
agent homes, the database files and other workers' environments. So at most one
account may be host-trusted on the local terminal backend; a second is refused
with that reason, unless a sandboxed (Docker) terminal backend exists, which
then becomes mandatory for every host-trusted account. Accounts that are not
host-trusted keep the agent's other features but never get terminal, file or
code tools or MCP servers that start a program on the host. These rules are the
recommended answer to Q-5.2.

## Consequences

- Isolation between accounts holds inside Timely, not on the host. Workers,
  agent homes, learned skills and session data are per account, and Go checks
  the account on every pipe message, but an approved host command can read
  anything the host's OS user can, including MCP sign-in token files while a
  worker runs. The host-trusted account is the control.
- Timely carries a second language and runtime: about 450 MB more on disk per
  desktop install, about 200 MB of memory per active account, sync work every
  one or two weeks, and two transcripts of a conversation, of which Postgres
  wins.
- A run lost to a worker crash or an API restart fails with Try again and names
  any host command that may already have run; Timely data is safe because only
  Go's apply writes it.
- A capability Hermes already has (web search, page reading, browser, terminal,
  files, memory, past-chat search) has one implementation, Hermes', improved by
  syncs. Go keeps domain tools and the boundaries that carry a Timely
  guarantee, such as the Bot fetcher.
- Other ADRs this changes, recorded here rather than edited while this ADR is
  Proposed. When it is accepted, the partly superseded ones get a note at the
  top, as ADR 0019 got for ADR 0020.
  - ADR 0007: Timely data still changes only through Agent proposals, applied
    by Go; the permission mode decides which proposals wait for Approve
    (all in Supervised) and which apply at once with Undo; host actions that
    need approval get per-call approval, once or deny.
  - ADR 0008: runs live in the worker; a lost run fails with Try again naming
    possible host effects; approval waits are bounded (recommended in Q-5.1: a
    10-minute live wait, then the card is parked).
  - ADR 0009: "the runner keeps the tool loop" is superseded. Selection on the
    API host, encrypted keys and driving a CLI as a pure model (now through the
    Go model endpoint) stand.
  - ADR 0011: the desktop bundles a Python runtime, the API spawns workers, and
    folder backups include agent state.
  - ADR 0012: triage no longer narrows the tools offered on the new engine.
  - ADR 0021 and ADR 0024: changed by ADR 0027.
  - ADR 0022: chat uses Hermes' browser tools on the person's own browser, and
    Timely typing the saved password becomes an adapter. ADR 0022 never lets
    the model run script in a page, on any page, and every Hermes browser tool
    either runs script or sends raw browser commands. Adopting them in chat
    therefore amends that rule, and Q-5.3 in the plan decides how far: pages
    that are not signed in only, or signed-in pages too. Until the owner
    answers, ADR 0022's rule stands and the script-running tools stay off.
  - ADR 0023: Go as Timely's MCP client is superseded by Hermes' MCP client,
    with the gate enforcing the person's Tool choice; Can use, Ask me first and
    Off stay, and MCP servers that start a program on the host are for the
    host-trusted account only. Tool watches and "Fixed calls first" go with the
    rules engine. In Bots, ADR 0027's egress policy replaces the rule that no
    MCP call follows a read of the person's data or another service's results:
    read-only Can use tools the person allowed for Bots may still run after the
    run has read outside content. In chat, that rule stands: after the
    conversation has read the person's Timely data or another service's
    results, an MCP call the model picks becomes a card with every argument
    shown, which the gate enforces from what the run has read (phase 5; the
    owner's Q-3.9 removed the plan's chat exfiltration rule for web reads only,
    not this MCP rule). MCP tokens move
    from the Secure Store's `TIMELY_VAULT_KEY` to `agent_secrets`, sealed like
    provider keys, and sit as plaintext files in the agent home while a worker
    runs, where an approved host command can read them; they are never backed
    up. Tool-definition fingerprinting stays: the gate blocks a tool whose
    definition differs from the one the person approved until they review it.
    The plan has not designed that for Hermes' client yet; it belongs to
    phase 5.
  - ADR 0013 to ADR 0020 stand.

## The owner's answers (2026-11-13, phase 4)

- **Q-4.1** Hermes' own sign-ins are never offered: no ChatGPT or Codex
  OAuth, no borrowing the Claude Code login, no Nous Portal. The New engine
  uses API keys and, for Claude Code and Codex, the Go model endpoint above.
  Go and the worker each keep an allowlist of API-key provider ids. A Claude
  Code OAuth token is refused as an Anthropic key, and the worker refuses the
  Claude Code token variables and never reads the CLI's credentials file.
- **Q-4.2** Sensitive and photo chats stay on Classic. The no-persist run they
  would need is built and proved behind a test-only switch:
  - nothing is written to the agent home;
  - no learning, past-chat search, web, sub-tasks or questions;
  - Go sends the whole conversation each turn;
  - the Go model endpoint gives the run a zero-data-retention grant.

  They move only at the cutover (plan phase 8).
- **Q-4.3** When the agent needs the person to decide, it asks on a Question
  card the run waits on, on web and phone. The person answers on the card or
  by typing, or skips, and the run goes on where it stopped. Stop, deleting
  the chat, a lost run and a 10-minute limit close the card. The wait keeps
  the run's `running` status, so claiming, leases, Stop and Delete are
  unchanged, and the answer is accepted only while the run that asked is
  still live (checked in TLA+). Bots never ask and never start Sub-tasks.
  A Sub-task's outside read counts as the chat's own.

## Considered Options

- **Install Hermes as a pinned package**: rejected by the owner; the code lives
  in Timely's repo so it ships in every download and can be fixed in adapters.
- **Port Hermes to Rust (or Go)**: rejected by the owner; every upstream fix
  would have to be ported by hand, and "work like Hermes" would drift with
  every release.
- **Keep the Go loop and call single Hermes tools from it** (the earlier plan,
  `docs/plans/2026-11-08-hermes-tools.md`): rejected; Hermes refuses its loop
  tools (memory, past-chat search, delegation, todo) outside its own loop, so
  the learning in ADR 0028 could not work, and upstream loop fixes would never
  arrive.
- **Hermes' `api_server` as the main mode**: rejected as the default; it fixes
  tool sets per platform, not per run, so chat, Bot and Sensitive runs could
  not get different tools; it rebuilds the agent on every request, so the skill
  nudge never fires; and it was never run end to end here. It is the automatic
  backup mode instead.
- **One process for all accounts, as Hermes profiles**: rejected; Hermes' board
  and agent roster cross profiles and some paths ignore the per-profile root,
  which breaks ADR 0001, to save about 21 MB per extra account.
- **One process per run**: rejected; about 2 seconds more per turn, and it
  loses terminal state and the per-conversation agent the learning loop needs.
