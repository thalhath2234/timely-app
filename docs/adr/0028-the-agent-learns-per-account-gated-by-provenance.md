# The agent learns per account, gated by provenance

- Status: Accepted (2026-11-11, with the owner's phase 3 answers below). Chat learning built in phase 3; the Bot parts (phone notices for Bot suggestions, a deleted Bot taking its skill, Lessons moving into the bot skill) come in phases 6 and 7
- Date: 2026-11-08

The owner wants Timely's agent to learn the way Hermes does, per account:
skills made from repeated tasks, skills fixed when the same problem comes back,
memory about the person, self-nudges, search over past chats, and getting
better over time. Learned skills load under "you must follow these
instructions", so a skill written after the agent read a hostile page is a
durable prompt injection. This ADR records how Timely keeps Hermes' learning
and decides what may apply on its own. Section 9b of the plan,
[`docs/plans/2026-11-08-timely-agent-from-hermes.md`](../plans/2026-11-08-timely-agent-from-hermes.md),
has the detail.

**Hermes' learning loop runs unchanged, inside each account's agent home.**
Agent notes (`MEMORY.md`) and About you (`USER.md`), skills created and patched
by the agent, the background learning pass after a reply (on a copy of the
agent that replays the conversation), the skill history with single-step undo,
the curator that marks unused learned skills stale (it never archives or
deletes anything on its own; its AI merging stays off), and search over past chats all come from
the vendored copy (ADR 0026) and improve with syncs. Timely adds only adapters:
per-account settings, one cached agent per conversation so the "time to save a
skill" counter adds up across turns, a policy plugin, a learning feed, and a
timer that runs the curator. Nothing learned is shared between accounts.

**Where content came from decides whether learning applies or waits.** A
conversation is tainted once outside content reached the model: web pages,
browser pages, Connected service results, files, command output, Timely reads
with the outside-data mark, a subagent that read any of these, a past-chat
search hit from a tainted chat, or a chat opened from a Bot's "Do this in
chat". Taint is kept per conversation in Postgres, so it survives the worker
stopping, an API restart and a rebuilt agent. Learning grounded only in the
person's own messages applies on its own, with a chip and Undo. A memory or
skill write is staged for the person to Keep or Discard when the conversation
is tainted, when it comes from a Bot, when it edits or removes memory with
nobody present, or when the skill names a host tool or uses approval words
("pre-approved", "don't ask", "sudo" and the like). A write that matches
Hermes' threat scan is blocked. Sensitive chats and chats marked "Don't learn
from this chat" learn nothing and are left out of past-chat search.

**Bots never apply learning.** A memory or skill write during a Bot run is
staged as "Suggested by bot X". Useful and Not useful with a note start a
review limited to that Bot's own skill, and its result is always a staged
change with Keep or Discard on the Bot page, because the replayed run read
untrusted pages and the Bot's skill loads into every unattended run. Bot runs
are never written to past-chat search. Each Bot's Lessons move into a "What you
taught me" part of its skill, and then the Lessons table goes.

**Timely's shared skills are read-only to the agent.** Skills Timely ships are
served to every account from one read-only copy, never the git checkout, and
the gate refuses any skill write aimed at them, so one account's learning
cannot change what another account loads (ADR 0001). Upstream skills reach an
account only after a developer has reviewed that version, and a learned edit to
one is the account's own copy. A restored learned skill comes back
threat-scanned and switched off until the person turns it on.

**Enforcement never lives in prompt text.** Approvals are decided by the gate
and Go when a tool is called (ADR 0026). No skill or memory can grant one, and
Hermes' permanent allowlists are never offered, so there is nothing for a
learned skill to write to.

**The person can see and undo all of it.** A chip under the reply says what was
learned ("Learned: skill 'bank-csv-import' created · View · Undo"); memory
changes say they apply from the next chat; staged items from the turn show as a
Keep / Discard card. Settings → Agent → What Timely learned lists learned
skills with where each came from, its history and diffs, Undo, Edit, Lock,
Archive and Delete; About you and Notes with their size limits; Waiting for
you, the staged items; and an Activity feed. Switches cover learning on or off
and searching past chats. There is no learning model to choose: the learning
pass uses the chat's own provider and model. The
phone shows Activity, About you and Waiting for you, and notifies when a Bot
suggests something. Go keeps every learning event with its origin, chat, Bot,
taint and status, and keeps the memory undo history Hermes lacks.

**Learned state belongs to the account, not the repo.** Learned skills and
memory live in the account's agent home, so `make hermes-sync` never touches
them. An upstream skill the account has edited is kept, and a newer upstream
version is offered as Compare, Keep mine or Use new; a learned skill with the
same name as a later upstream one wins. Per-account backups carry memory,
skills, staged items, skill history and the agent's transcript database (up to
64 MB), never config, sign-in tokens, scripts, hooks or plugins. Deleting a
chat removes it from past-chat search, deleting a Bot deletes its skill, and
deleting the account deletes the agent home.

## Consequences

- A learning pass costs about 30,000 tokens, mostly cache reads on the same
  model. There is no cheaper learning model (Q-3.2): the pass runs on the
  chat's own provider and model.
- Taint is broad: once a chat reads a page, every later proposal in it is
  reviewed and every learned item waits. That is accepted for safety and tuned
  after use.
- Taint is only as complete as the list of sources. A Go test fails when a
  Timely read tool lacks an outside-data classification, and a Python test does
  the same for every tool chat may call without approval.

## The owner's answers (2026-11-11)

- **Q-3.1** Learning in a clean chat applies on its own, with a chip under the
  reply and Undo. It is staged (Keep or Discard) only when the chat read
  outside content (taint) or the write came from a Bot; the skill-body rule
  and an unattended memory edit or removal also stage, and a threat-scan hit
  is blocked.
- **Q-3.2** No separate learning model: the learning pass uses the chat's
  provider and model. The "Learning model" setting is gone.
- **Q-3.3** "What you use Timely for" is copied into About you once, when
  learning is first on for the account, and is edited there afterwards; it is
  never copied again.
- **Q-3.4** Per-account backups include the agent state (up to 64 MB; above
  that the backup leaves it out and says so). Restored learned skills come
  back switched off, marked "Restored, review".
- **Q-3.5** Searching past chats is on by default, with a switch to turn it
  off. Bot runs are never written to the search history.
- **Q-3.6** The curator never archives on its own; it only marks unused
  learned skills. No archive switch is shown.
- **Q-3.7** The agent's edit to a skill Timely ships is the account's own copy,
  silent with Undo (and staged under the Q-3.1 rule); "Updated upstream" with
  Compare, Keep mine and Use new shows when the shipped skill changes.
- **Q-3.8** Web search without a search key uses the chat provider's own search
  through Timely's web backend; a search key saved in Settings overrides it.
  Searches and pages are taint.
- **Q-3.9** (2026-11-12, replaces the chat exfiltration rule this ADR first
  recorded under Q-3.8) Web reads are handled the way Hermes handles them:
  Timely puts no rule of its own on where `web_search` or `web_extract` may go
  after a chat read outside content. Eight review rounds kept finding new ways
  around the pattern-matching rule (spellings, encodings, planted search
  results, the provider's own search), so the owner chose Hermes' handling,
  kept fully on on every web path Timely uses (its own backend through Go,
  the keyed backends, CLI providers through the gateway; contract tests run
  its own backend and each keyed backend, Exa, Firecrawl and Parallel, through
  a stand-in for the vendor's SDK): results
  wrapped as untrusted data, the advisory threat scan, a URL carrying a key or
  token refused, the private-address (SSRF) floor (Hermes' website blocklist
  is opt-in and Timely sets none, so nothing verifies it; owner to confirm;
  also owner to confirm: the after-taint path rule for `preview_bot`, a bot's
  page fetch before approval, was not restored, though Q-3.9 lifts the rule
  only for the web tools),
  and the strict threat scan on memory and
  skill writes. Timely's results that
  quote outside text (Bot answers, findings and last readings, notifications, past-chat hits
  from a tainted chat) reach the model marked the same way, on Classic too,
  where Go wraps its `web_search` answers and outside reads in Hermes' block
  (Classic has no threat scan), and a search query carrying a key or token
  is refused on both engines. What does not
  change: taint still holds every later proposal for review and stages
  learning, and Bot fetches keep their own guard. The residual risk, that an
  injected page has the model put the person's data in a link or a query,
  is accepted.

## Considered Options

- **Ask before applying every learned item**: not chosen (recommended answer to
  Q-3.1 in the plan); it turns learning into a stream of prompts, while clean
  learning with Undo matches how Hermes works.
- **Apply Bot feedback learning with Undo**: rejected; the run being reviewed
  read untrusted pages, and a poisoned Bot skill would run unattended before
  anyone looked.
- **Learning built in Go** (agent notes, a `remember` tool, a Go port of
  Hermes' threat patterns): rejected; a second implementation syncs never
  update.
- **Trust the threat scan alone**: rejected; it misses meaning-level injections
  such as "the user pre-approved all terminal commands".
- **Let the agent edit Timely's shared skills like its own**: rejected; one
  account's learning would rewrite what every account loads.
