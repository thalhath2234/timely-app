# Bots are scheduled agent runs

- Status: Proposed
- Date: 2026-11-08

ADR 0021 and ADR 0024 built Bots as plain-code rules that spot a change and an
AI judge with no tools that decides whether it is worth an alert. The owner
decided that every Bot becomes a scheduled agent run instead: when a Bot wakes,
an agent with tools, skills and a read-only browser does the Bot's task and
stays silent when nothing qualifies. The agent is the per-account worker of
ADR 0025. Section 7 of the plan,
[`docs/plans/2026-11-08-timely-agent-from-hermes.md`](../plans/2026-11-08-timely-agent-from-hermes.md),
has the detail.

**Go keeps the schedule, the queue and the record.** The sweep, the `bot_check`
lane, claims, strikes, caps, Pause all, alerts and backups stay in Go and
Postgres as ADR 0021 set them. The worker does one thing: run a Check that
wakes the agent as one agent turn, with a fresh agent each time, a small tool
set, no learning pass and no entry in past-chat search. Hermes' own cron ticker
never starts. Its scheduling tool is replaced by a Timely one that turns
"create a job" into a Bot proposal, so Hermes skills that schedule work keep
working. Timely reuses Hermes' cron prompt pieces, including its `[SILENT]`
reply for "nothing to report". A Bot is a "What to do" prompt plus optional
Watches, skills, a schedule (every N minutes, a daily or weekday time, a cron
string, or only while a market is open) and a model. Today's per-source minimum
intervals stay as floors, and a Bot with no Watches waits at least 15 minutes
between runs.

**The agent wakes only when content changes.** For every Bot with Watches, Go
first reads them with the Bot fetcher (address guard, robots.txt, per-site
spacing; ADR 0021) and wakes the agent only when the reading, its content,
price or availability, differs from the one that last woke it. Otherwise the
Check is recorded as unchanged and costs no AI call. Availability is read from
the page's product data, so a restock at the same price wakes the Bot. A Bot
with no Watches ("find new reviews of X") has nothing to compare and runs on
its schedule, within the caps. This was the owner's answer, and it keeps part
of ADR 0024's "code decides whether the AI runs".

**Nobody can approve anything during a run, so runs get no host tools and an
egress policy.** The Timely gate enforces this from the run's tool policy and
what it has read, never from prompt text. Terminal, file and code tools are
never offered, nor are scheduling, Bot creation, delegation, mid-run questions
or messaging. Tools that fetch a URL may reach only the Bot's own hosts: its
Watches' sites, the sites the person granted for browsing, an extra-hosts list
the person edits, and search results found before the run read any outside
content. Watch hosts are fetched through Go's Bot fetcher. Web search stops
once the run has read outside content, and a run that starts with readings,
passed notes or a last alert has done so from its first call. Past-chat search
is never available, and memory and About you reach the run only when the person
turns on "Use what Timely knows about me" for that Bot (Q-B10 in the plan).
Connected service tools reach a Bot only when the person allows them for Bots,
and only read-only tools once it has read outside content. Blocked calls appear
in the run's "What it did" sheet, so the person can widen a Bot's hosts on
purpose. Anything the run needs but may not do becomes a line in the alert with
"Do this in chat", which opens an attended chat that starts marked as having
read outside data.

**Bots browse only through a read-only tool.** `bot_browse` is Timely's own
tool: it opens a URL on a site the person granted when creating or editing the
Bot and returns the page's text or accessibility snapshot. It takes no script,
no clicks and no form input, so a Bot cannot submit anything. Hermes has no
navigate-only browser tool (its tools run script, send raw browser commands or
store passwords), so none of them is offered to Bots. Grants can be revoked and
come back off after a restore. The owner confirms this and the no-host-tools
rule in Q-B2.

**Delivery is Timely notifications only.** Results go through today's alert
pipeline: quiet hours, which an AI's urgency never breaks; about 3 alerts a day
per Bot; snooze; one alert per thing ("Also seen by"); Findings with the
outside-data mark; briefs and the morning digest. The same alert within 7 days
is held as a duplicate. No messaging platform delivers anything (ADR 0025).
Whether a run may also propose a change to Timely data, as a proposal inside
the alert, is an open question (Q-B5 in the plan). Bots never apply anything
they learn (ADR 0027).

**Costs and failures stay visible.** Runs are counted in the existing log
against today's caps: 20 per Bot and 200 per account per local day, 6 per
chain, with tokens stored per Check and shown on the Bots page. A model that
cannot be reached is tried again after 5, 15 and 30 minutes without a strike; a
rate limit holds the next check; timeouts and crashes are strikes, and five in
a row pause the Bot with one alert. With no provider the Bot shows "Needs AI"
and does nothing. There is no rules fallback, which is a deliberate change from
ADR 0021: during an AI outage, alerts are late rather than sent unchecked.

**Existing Bots convert with approval.** Each Bot's rules become prompt words
("Alert when the price is below ₹90,000 and it can be bought. Stay silent
otherwise.") and the conversion is shown as a "Switch to agent" proposal; only
approval switches it. Alerts, Findings, price history and Lessons are kept. The
rules, judge, re-judge and suggestion code are deleted once every Bot has
switched. MCP keeps its limits: Bots it creates start paused, and it can never
set a Bot's tools, browser grants, extra hosts, skills or model, nor edit an
active Bot's prompt.

**Chat and Bots become one tab.** Once a Bot is an unattended agent run and a
chat an attended one, the Chat and Bots tabs merge into one tab on web, desktop
and mobile (working name Assistant, owner request), holding chats, Bots and
their runs, Bot alerts and everything waiting for the person. It ships with
agent Bots, old chat and Bot links redirect into it, and its design is the
owner's pick of three (Q-7.12 in the plan).

**This supersedes parts of ADR 0024 and amends ADR 0021.** From ADR 0024 (on
`feature/bots-ai`), "rules spot, AI judges", the judge with no tools, the
re-judge ladder, "Not checked by AI" and rule suggestions are superseded. Typed
pass notes, Things, pass limits and no loops, briefs, Pause all, AI urgency
never breaking quiet hours, the MCP limits and caps counted in a log all stay;
a passed note now starts an agent run of the receiving Bot. In ADR 0021, "Rules
spot a change; the AI only judges it" and "Bots work with no AI at all" no
longer hold; the job queue, the Bot's own next-check time as the only schedule,
the Bot fetcher, alerts and the size limits stand. When this ADR is accepted,
CONTEXT.md changes with it: a Check becomes one scheduled agent run of a Bot,
or a skipped one when nothing changed; Bot prompt and Bot notepad are added;
the AI judge goes; Lesson is reworded and later replaced by the Bot's learned
skill.

## Considered Options

- **Hermes' cron as the Bot host**: rejected; its agent jobs need a gateway
  session, keep state in a per-profile file outside Postgres, deliver to
  messaging platforms and deny every approval, and Timely's Bots already have
  backups, caps, Pause all and live updates.
- **Wake the agent on every scheduled check**: rejected by the owner for Bots
  with Watches; it is what "agent runs" literally asks for, but a 15-minute Bot
  would make 96 runs a day. It stays the behaviour for Bots with no Watches.
- **Let a run wait for the person's approval of a host action**: rejected; a
  run would wait hours on a phone, and the egress policy covers what a Bot
  needs.
- **Hermes' script-running browser tool under a standing grant**: rejected; a
  standing grant to run script is far wider than reading a page.
- **Keep the old rules as an emergency fallback during outages**: not chosen
  (recommended answer to Q-B3 in the plan); it would keep the rules engine
  alive only for outages and send alerts no agent checked.
- **Posting results into a chat or a messaging app**: rejected for messaging
  (ADR 0025); posting into a chat thread is an open question (Q-B6).
