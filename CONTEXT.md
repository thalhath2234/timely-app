# Timely

Personal time and task management for one person per account. Accounts do not
collaborate on the same work.

## Language

### Capture and work

**Capture**:
Recording a title-only thought for later consideration.
_Avoid_: quick add, create task

**Inbox item**:
A captured thought that has not become Work or a Reminder. It has no estimate or calendar time.
_Avoid_: inbox task, unprocessed task, capture item

**Clarify**:
Replacing an Inbox item with new Work or a new Reminder. The Inbox item is consumed; deleting it without a replacement is not Clarify.
_Avoid_: convert, change kind

**Work**:
A piece of effort with a duration and a workspace that may be placed on the calendar.
_Avoid_: proper task, regular task

**Reminder**:
A timed ping without a work estimate or reserved busy time.
_Avoid_: notify, alert (when referring to the Reminder itself)

### Calendar and placement

**Working hours**:
The weekly clock intervals available for Auto-schedule to place Work. With no saved preference, they default to Monday–Friday, 09:00–17:00; an explicitly empty day has no placement hours.
_Avoid_: schedule, availability

**Event**:
A calendar commitment that is neither Work nor a Reminder. Its time is chosen by the person and counts as busy time for Auto-schedule.
_Avoid_: appointment, Calendar item (a Calendar item is a bar on the grid)

**All-day Event**:
An Event that fills the date's Working hours, or 09:00–17:00 if that day has no Working hours. It has no timed duration.
_Avoid_: all-day (when referring to midnight-to-midnight time)

**Calendar item**:
A visible bar on the calendar grid: a Work Block, a Reminder ping, or an Event Block.
_Avoid_: event, item (alone)

**Block**:
Reserved calendar time for Work or an Event.
_Avoid_: slot

**Manual block**:
A Block whose time the person chose, including an Event's time.
_Avoid_: locked block (pinning is only one way to choose a time)

**Engine block**:
A Block whose time Auto-schedule chose.
_Avoid_: automatic block, scheduled block

**Pinned**:
A Block, or all Blocks of one Work, that neither Auto-schedule nor manual placement may move or remove. An Event's time is kept the same way.
_Avoid_: locked, frozen (frozen is the near-term window the engine leaves alone)

**Auto-schedule**:
The Preview, Apply, and Undo operation that places Work within Working hours around existing busy time. It does not place or move Events. When Apply places Work again, the engine time it missed earlier that same day moves with it rather than staying behind; missed time from earlier days and hand-placed time stay.
_Avoid_: schedule, reschedule (when referring to this operation)

### Agent assistance

**Agent proposal**:
A reviewable set of changes requested through chat that the person can revise before approving or discard. It is required for multi-step requests, recurring-series changes, bulk edits, document-content replacement, populated sheet creation, and sheet-content removal or replacement. A discarded proposal writes nothing and stays in the conversation's history.
_Avoid_: plan (when referring to changes awaiting approval), reject (in copy; the person discards)

**Chat context**:
The location, open object, and selection or calendar date range attached to a conversation. It stays attached when the person navigates elsewhere and can be removed from the conversation.
_Avoid_: current screen (when referring to previously attached context)

**Agent run**:
An attempt to carry out a request in a conversation, with progress and results retained in its history. It can continue while the person leaves the chat; stopping prevents further steps but preserves completed changes.
_Avoid_: task (Work is a separate concept)

**Question card**:
A card an Agent run on the New engine puts in the chat when it needs the person to decide something: one to five questions, each with up to four choices or an open answer. The run waits on it and the chat reads "Needs your answer". The run takes the answer from the card, from a message typed meanwhile, or as a Skip, then goes on from where it stopped. Stop, deleting the chat or a lost run closes the card. After 10 minutes the card closes and the run goes on without an answer. A closed card stays in the thread with what was answered.
_Avoid_: clarify, clarification (Clarify is the Inbox step), prompt, choices card (that is a Reply card the model writes into its answer and that nothing waits on)

**Sub-task**:
Part of an Agent run's work handed to a helper agent that runs inside the same run and reports back. A run gets at most three sub-tasks, and they share one budget. A sub-task can read but never proposes changes. Each shows as a "Sub-task: …" line while it works. Outside content a sub-task reads gives the chat its Taint.
_Avoid_: subagent, child agent (in copy), delegate (a Bot's link to another Bot is Pass to), task (Work is a separate concept)

**Host card**:
A card an Agent run on the New engine puts in the chat when it wants to run a command, change or read a file, drive the browser, run code or use an MCP server on the person's own computer. It shows exactly what it would do (the command, path, address or tool, and the folder) and the chat reads "Needs your OK". Run once lets that one call go ahead, Allow for this chat also covers later calls of the same kind in this chat, and Deny tells the assistant no. Run once and Allow for this chat on the phone ask for fingerprint, face or screen lock first. The run waits live for 10 minutes; after that the card is a Parked card. Stop, deleting the chat or a lost run closes it, and a closed card stays in the thread (Ran, Allowed for this chat, Denied, Expired, Stopped). Approve and Reject never act on it: they are for proposals.
_Avoid_: approval prompt, permission popup, confirm dialog

**Host-allowed account**:
An account that may use the computer the app runs on: its Agent runs get the terminal, file, code and browser tools and may add MCP servers that start a program. Whoever runs the host decides, in Settings → Server in the desktop window or with `TIMELY_AGENT_HOST_ACCOUNTS` on a server; several accounts can be turned on, each separately, and nobody is by default. It grants no access to another account through Timely. An approved command runs as the person who runs the app and can read whatever that person can, other accounts' data included.
_Avoid_: admin, trusted account, host-trusted (the ADRs' older word), superuser

**Parked card**:
A Host card whose run stopped waiting after 10 minutes. The chat reads "Waiting for your OK" and nothing runs. The card stays for up to an hour (10 to 60 minutes in Settings → Permissions, "Paused cards wait up to"); Run once then starts the assistant again to run exactly that call. When the time passes, the card closes as "Expired, not run".
_Avoid_: pending card, expired card (that is what it becomes), timed-out card

**Allow for this chat**:
A choice on a Host card that lets later calls of the same kind in this chat run without asking again: the same program for commands (and the same subcommand for tools like git or npm), the same folder for files, the same server and tool for MCP. It never covers a command with a pipe, redirect or `sudo`, code, a browser call (every one asks), an item on the Critical list, or an MCP server set to Ask me first. The one exception on the Critical list is a change after the chat read outside content (item 6) when everything it read was local (a file or a command's own output): that card can be allowed for the chat. It lasts as long as the chat and is listed on the chat's permission sheet with Remove.
_Avoid_: always allow, trust this command, remember (in copy)

**Working folder**:
The folder a Host-allowed account's commands start in and its files tools resolve names from, chosen in Settings → Server in the desktop window. With none chosen it is the account's agent workspace. A folder the person chose also lets the folder's own agent instructions (an `AGENTS.md`) apply, and reading one counts as outside content for Taint. Commands run with the person's real home folder either way.
_Avoid_: workspace (that is the Timely Workspace), project folder, cwd (in copy)

**Quick prompt**:
The floating chat bar opened with Ctrl/Cmd+Shift+J from any screen. It carries Chat context, image attach, Web search and the model choice. Sending starts the conversation and hands it to the Activity island.
_Avoid_: agent modal, chat overlay (in copy)

**Agent provider**:
The model source an account's Agent runs use: OpenRouter or a direct API provider (Anthropic, OpenAI, Gemini, DeepSeek, xAI, Mistral, Z.ai, Kimi, Ollama, NVIDIA, OpenCode) with the account's own key, or the Claude Code or Codex CLI installed and signed in on the API host. Each account chooses one default provider, and has a model per provider; until the person chooses, runs and the writing features wait and Settings shows "Not chosen" (ADR 0020). A run keeps the provider it started with.
_Avoid_: backend, engine (Auto-schedule is the engine), LLM (in copy)

**Connect**:
Verifying a CLI Agent provider on the API host: the binary is found, its sign-in is valid, and one test call succeeds. Connect never takes a path from the person and never signs in for them.
_Avoid_: install, log in (those happen in a terminal on the host)

**Reply card**:
A card the agent adds under its chat text to show the person's own tasks, events, days or numbers, or to offer answers: a card of grouped rows per answer (task rows with working ticks, events and free time in time order, stats, a bar chart, project shares) and answer chips with a time picker. Cards show only data the agent read with its tools and change nothing by themselves; a tick in one is the person's own action, and the agent's own changes still follow Agent proposal rules. Apps that can't draw them get the text alone (ADR 0013).
_Avoid_: widget (the phone's home-screen widgets), generative UI, OpenUI (in copy)

**Described card**:
A Dashboard card the AI builds from the person's words in "Describe a card", on desktop or phone. The AI writes the card's layout once from the Reply card kit; the card reads the person's tasks, events and files each time the dashboard shows, so it stays current without asking the AI again. More words change it. While it builds the card, the AI can read the person's data with the chat agent's read tools and draws its draft from that data to fix empty or mistaken blocks before answering (ADR 0016). Apps that can't draw it show the nearest custom card instead (ADR 0014).
_Avoid_: AI card, smart card, generated card

**Live block**:
A Described card inside a doc, added from the "/" menu or by the agent. The doc keeps its program as an `openui-lang` code block, so the doc stays Markdown; the editors draw it at the doc's width from the person's data each time the doc opens, with working ticks and links, and hide the program unless asked for. More words change it, as with a Described card (ADR 0015).
_Avoid_: embed (that is a video or page from a link), widget, dashboard in a doc

**Checklist row**:
An item from a doc's checklist shown in a Reply card, a Described card or a Live block. Its tick box ticks the item in the doc and its words open the doc. The row shows the item as the doc has it now, and a tick changes only that item, so an older copy of the doc never overwrites newer edits (ADR 0017).
_Avoid_: task (a checklist item is not a Task), todo

**Engine**:
What runs a chat's turns: Classic (Timely's own loop, the default) or New (the agent engine, a Hermes-derived agent in a per-account worker, ADR 0026). Each account picks one in Settings → Agent; a chat can be set to the other. Private photo chats, Sensitive chats and applying approved changes always run on Classic. When New can't run a chat, the run fails with the reason and "Use classic for this chat"; Timely never switches engines on its own.
_Avoid_: backend, provider (that is the Agent provider), model

**Permission mode**:
How much a chat's agent may do without asking: Supervised (every change waits for Approve), Auto (changes apply at once with Undo, except the Critical list), or Full Access (no Host card for commands, files or code, or for a tool of an MCP server set to Use; a browser call and a tool of a server set to Ask me first still show a card in every mode; turning it on needs a confirmation from the desktop window, or from an unlocked phone when Settings allows Full Access on any device, that names what it lifts, and it never lifts the floors: wiping the disk or system and handing out keys). A Full Access that was not confirmed acts as Auto, and a new chat made from any other device takes Auto, not the account's Full Access default. New chats take the account's default (Supervised unless changed); each chat can be switched from the composer chip. A looser mode never approves a change already waiting; a stricter one holds the next.
_Avoid_: autonomy level, trust level, YOLO (in copy)

**Critical list**:
The changes Auto always asks about first: deleting or overwriting (deletes, more than 10 items at once, whole-content replacements), sending the person's data out, buying, paying or signing in, installing software, changing settings or permissions (Bots included), and any change after the chat read outside content (a page, a file or command output). It lives in Go (`agent/permission.go`).
_Avoid_: dangerous actions, blocklist (the floors no mode lifts are separate)

**Taint**:
The mark a chat carries once outside content reached the agent in it: a web page or search (its own or a Sub-task's), a Timely read of outside data (a Bot's findings), or a past-chat search hit from a chat that carries the mark. It stays with the chat for good, through restarts. In a tainted chat every change is held for review and every learning write is Staged. Where the agent may search or read the web is not limited by the mark: web reads follow Hermes' own handling (outside text reaches the model marked as untrusted data, a link that carries a key or token is refused, private addresses are blocked; owner decision Q-3.9).
_Avoid_: dirty, unsafe, untrusted chat (in copy, say "this chat read something from outside Timely")

**Learning pass**:
The agent's look back over a chat after it replied, on the chat's own provider and model, deciding whether to save or fix a skill or a note about the person. It runs once enough work built up in a chat (about ten tool steps for skills, ten turns for notes), never in Sensitive chats, chats marked "Don't learn from this chat", or when learning is off.
_Avoid_: background review, reflection, training (nothing about the model changes)

**Staged change**:
A learned skill or note (About you, Notes) written but not applied, waiting for the person to Keep or Discard in the chat's card or in Waiting for you. A change is staged when its chat is tainted or it came from a Bot, when it edits or removes notes with nobody there, or when a skill names a tool or claims approval; otherwise it applies at once with a chip and Undo. Discard leaves nothing behind.
_Avoid_: pending approval (Agent proposals are approved), draft, suggestion (except "Suggested by bot")

**Smart suggestions**:
Pre-filled fields and hints from Jev, TypeSafe's decision model, such as the Clarify form's type, effort, priority, project, labels and possible duplicates, or the Agent's default length for new Work. They use the account's TypeSafe key first and its OpenRouter key otherwise, and change nothing until the person saves. With neither key, or turned off in Settings → Agent, Timely behaves as it does without them.
_Avoid_: AI autofill, auto-classify, Jev (in copy, except where the key is set up)

### Activity

**Activity island**:
The pill above Sign out in the web and desktop sidebar that tracks what is in progress: Agent runs that are working or waiting for the person (including ones sent from the Quick prompt), the Work being focused, Pomodoro timers from the Dashboard (running or paused), and a running Auto-schedule. Clicking it opens a list of those activities. It bounces when an Agent run finishes, and it disappears when nothing is in progress.
_Avoid_: dynamic island (in copy), status bar, tray

### Work status and order

**Rank**:
An ordering hint for Work, made of a Score and reasons. It orders Work that is Unscheduled or Overdue; it is not a probability.
_Avoid_: what next

**Score**:
The number in a Rank; a higher Score comes sooner.
_Avoid_: priority (priority is one input to Rank)

**Unscheduled**:
Open Work without a Block on the current date in the Working hours timezone. A future Block does not change today's Unscheduled status.
_Avoid_: waiting for a slot (that list includes Overdue Work too)

**Overdue**:
Open Work whose deadline date is before the current date in the Working hours timezone. A past Block alone does not make Work Overdue.
_Avoid_: missed, skipped, late

**Missed**:
An occurrence of Work whose calendar time has ended while the Work remains incomplete. Missed is not Overdue unless its deadline has also passed.
_Avoid_: overdue (deadline only), skipped

### Habits and goals

**Habit**:
Something the person wants to do every day, checked off on Today (web, desktop and the phone's Home tab). Up to 20 per account, stored on the server so every surface matches.
_Avoid_: routine, recurring task (a habit is never Work and is never scheduled)

**Streak**:
The run of consecutive days a Habit was checked off, counted on the server from the person's own date. A Habit not yet checked today keeps yesterday's Streak.
_Avoid_: score, combo

**Goal**:
One of up to five outcomes the person names in their own words on Today. Goals work without Smart suggestions; with them, each Goal shows the open Work that moves it forward, and Today's suggestions name the Goal a pick serves.
_Avoid_: target, objective, OKR

### Desktop host and devices

**Desktop host**:
The Timely desktop app when it runs its own database and API as supervised sidecars (ADR 0011). It keeps serving while its window is hidden and stops serving when the person quits it.
_Avoid_: backend, local install, machine (the Desktop host is an app, not hardware)

**Server address**:
An `http://host:port` the phone uses to reach a Desktop host or any other Timely API. A Desktop host has a loopback address and, when allowed, Tailscale addresses.
_Avoid_: endpoint, API URL (in copy), base URL

**Pair**:
Giving the phone a Desktop host's Server addresses by scanning the QR code in Settings → Server or pasting one address. Pairing checks the address with a health call; it does not sign in.
_Avoid_: connect (reserved for Agent providers and Connected services), link, sync (sync is what happens after Pair)

**Tailscale access**:
The Settings → Server switch that lets the API listen on the host's Tailscale addresses in addition to loopback. Off means loopback only; there is no LAN or public option.
_Avoid_: remote access, expose, port forwarding

**Start at login**:
The Desktop host starting hidden in the tray when the person signs in to their computer, so Bots keep watching without a window. On by default, for new installs and upgraders (who get a one-time notice); one switch in Settings → Notifications, desktop only. Timely never turns it back on after Windows or the desktop turned it off; only the switch does (ADR 0025).
_Avoid_: autostart (in copy), run on boot, launch on startup, background service

**Instant push**:
A Bot alert or reminder reaching the phone in seconds through Expo's push service, even while the app is closed, instead of at the next check about every 15 minutes. It needs a push project in the phone build; without one the phone keeps checking and Settings says why. A phone's push token belongs to the sign-in that registered it, so signing that phone out stops its pushes. "Hide alert text in push" makes Bot pushes say only "A bot has news" (ADR 0025).
_Avoid_: notification (alone; that is the in-app row), FCM, remote notification

### Bots

**Bot**:
A named helper the person makes: a scheduled agent run on the New engine that does its Bot prompt on its own schedule, with nobody watching, stays silent when nothing qualifies and sends a Bot alert when something is worth knowing. A Bot with Watches wakes the agent only when one changed; one with none runs on its schedule. Go keeps the schedule, the queue and the record, and stops while the API is off (ADR 0021, ADR 0027). It has no terminal, files or code, never buys, posts or deletes anything, and a step that needs approval parks in Needs you. Memory and About you are a per-Bot switch, off by default. It signs in only with a Sign-in the person attached to it, and on its own only where that Sign-in's "Sign in on its own" is on (ADR 0022).
_Avoid_: agent (that is the chat agent), automation, monitor, Jev (in copy)

**Bot thread**:
The one conversation each Bot has. The Bot's alerts are posted into it, and the person writes to it to change the Bot or ask about its Checks. A message changes the Bot at once and the reply says what changed, with Undo; a change that widens what the Bot can do alone (a new site for the signed-in browser, memory, a looser permission mode) waits for one tap. A Bot thread never acts on Timely or the computer; acting on a finding happens in a separate chat ("Do this in chat").
_Avoid_: bot chat (a chat is an Agent conversation), bot editor (the grouped-row screen), inbox

**Bot prompt**:
The plain-words task a Bot does on each run (up to 4000 characters). The person changes it by talking to the Bot thread or in the grouped-row editor.
_Avoid_: instructions (in copy), rule

**Bot notepad**:
Short notes a Bot keeps between its own runs, read back at the start of the next. They belong to that Bot, are shown in its history and are never shared with other Bots or chats.
_Avoid_: memory (that is the per-Bot switch for About you), lesson

**Watch**:
One thing a Bot reads: a page (its text, one part, or its published price), a feed, a price from a free source, or a Tool watch.
_Avoid_: source, trigger, scraper

**Check**:
One wake of a Bot: Go reads the Bot's Watches, and when one changed (or the Bot has none) the agent runs its Bot prompt once, with a 5-minute deadline. Most Checks find nothing and cost nothing. A Check that needs the browser while a chat holds it is skipped and recorded as "browser busy".
_Avoid_: run (an Agent run is a chat attempt), scan, poll

**Bot alert**:
The notification a Bot sends, in its own notification category, with Useful and Not useful. Its numbers come from the Check's readings, never from the agent's words. With no AI provider or during an outage, the Bot records readings and sends no alert. It is also posted into the Bot thread, and an alert that repeats within 7 days is held as a duplicate.
_Avoid_: Reminder (a Reminder is a timed ping the person set), notification (alone)

**Lesson**:
A short line a Bot keeps from a Useful or Not useful answer on one of its alerts, read by the Bot's agent on later Checks. Code writes it from the person's own answer and note, never from text the AI or a page wrote. Up to 20 per Bot, each removable.
_Avoid_: memory, training, feedback (alone)

**Starter**:
A ready-made Bot prompt on the empty Assistant page, one for each Hermes blueprint plus Price drop, Page changed, Stock move, New in a feed and Morning brief, that opens a new Bot thread with the setup filled in. A Starter that needs a connector Timely lacks says what it needs and stays off.
_Avoid_: template (in copy), preset (store presets are Watch settings)

**Finding**:
A typed note a Bot writes after a Check, kept on the findings board for other Bots, @-tag answers and the morning digest. Findings from fetched pages or outside services carry the outside-data mark.
_Avoid_: result, message (Bots never send each other free text)

**Brief**:
A Bot with no Watches that gathers new Findings from up to 8 other Bots into one alert once a day, at the time the person picks, from a template or written by AI. A source Bot set to "Only in the brief" alerts only through it. The morning digest is not a Brief; it gets its own "From your bots" section.
_Avoid_: digest (that is the morning digest), briefing (the morning digest's picks), report

**Pass to**:
A link from one Bot to another, with up to 5 optional filter words, that hands over each new Finding holding one of them (or every one, with no words), so the second Bot checks it under its own rules before the person is told. The first Bot stays quiet about passed Findings. Up to 4 per Bot, 10 items a Check and 20 a day per link; a Finding is never free text for the next Bot to follow (ADR 0024).
_Avoid_: delegate, forward, message, trigger

**Chain**:
The Bots one Finding travels through by Pass to links, at most 3 links long and never a loop. Its AI calls share one cap of 6, whichever Bot makes them, and the alert at its end shows "How this came to you".
_Avoid_: pipeline, workflow, graph

**Thing**:
What two Bots' alerts are about when they match: a product, a ticker or a link, keyed from the Watch or the feed item. Two alerts on the same Thing on the same day share one alert ("Also seen by"); a follow-up gets through only after a further 5% move or a jump in urgency.
_Avoid_: item (a feed item is one kind of Thing), duplicate, entity

**Catch-up**:
The one Check each Bot at least 30 minutes late makes after Timely was closed, the computer slept or Pause all was on, however many scheduled Checks it missed. Late Checks start one by one, about 10 seconds apart, and the next alert says how long the Bot was paused ("Paused for 9 hours while Timely was closed"). A paused Bot is not caught up and stays paused; a snoozed Bot catches up, and its alert stays held until the snooze ends (ADR 0025).
_Avoid_: backfill, replay, missed checks (no missed slot is replayed)

**Secure Store**:
The sealed store, under TIMELY_VAULT_KEY, of saved website logins and Connected service secrets. Timely types a saved password into the page or attaches a token itself; the AI never sees either and holds only a ticket (ADR 0022, ADR 0023).
_Avoid_: password manager, vault (in copy), keychain

**Sign-in**:
A saved login in the Secure Store, or a session the person signed in to themselves in a real window, that a Bot or chat run uses on one website. Signed-in pages are private and read-only. A Connected service's OAuth sign-in is not a Sign-in; call it the service's sign-in (ADR 0023).
_Avoid_: account (an account is the person's Timely account), credentials (in copy)

**Local model**:
A model Ollama serves at a loopback address on this PC, answering now, that can use tools and isn't an Ollama cloud model. Remote Ollama, API providers, OpenRouter, Claude Code and Codex never count. "Only local AI" keeps a site's or service's data on one.
_Avoid_: offline AI, on-device (in copy)

**Take control**:
The person driving a run's browser page themselves. The agent pauses and reads nothing until Give back.
_Avoid_: manual mode, override

**Connected service**:
Another app's MCP server added under Settings → Integrations ("Apps Timely can use"), with its own token or sign-in. Timely is the MCP client (ADR 0023). Adding one is not Connect (Connect verifies a CLI Agent provider).
_Avoid_: integration (alone; the tab also lists apps that use Timely), connector, plugin

**Tool choice**:
What the person allows for one tool of a Connected service: Can use (it only reads), Ask me first (it may change things), or Off. The service's own labels never decide it.
_Avoid_: permission, scope (scopes are what a sign-in asks for)

**Tool watch**:
A Watch that makes one fixed call to a Connected service's tool, with the tool and arguments set in the Bot editor, and compares the result with the last one.
_Avoid_: integration watch, API watch

**Outside data**:
Text that came from a fetched page or a Connected service. It reaches the AI only as quoted data, keeps its mark when it is passed on, and can't steer what a Bot or chat run does next.
_Avoid_: untrusted input (in copy), external content
