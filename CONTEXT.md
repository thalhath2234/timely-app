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

### Bots

**Bot**:
A named helper the person makes that checks one or more Watches on its own schedule, with nobody watching, and sends a Bot alert when something worth knowing changed. It runs in the API on the job queue and stops while the API is off (ADR 0021). It never buys, posts or deletes anything. It signs in only with a Sign-in the person attached to it, and on its own only where that Sign-in's "Sign in on its own" is on (ADR 0022).
_Avoid_: agent (that is the chat agent), automation, monitor, Jev (in copy)

**Watch**:
One thing a Bot reads: a page (its text, one part, or its published price), a feed, a price from a free source, or a Tool watch.
_Avoid_: source, trigger, scraper

**Check**:
One reading of a Bot's Watches, compared with the last reading against its rules. Most Checks find nothing and cost nothing; only a change that passes the rules can reach the AI judge.
_Avoid_: run (an Agent run is a chat attempt), scan, poll

**Bot alert**:
The notification a Bot sends, in its own notification category, with Useful and Not useful. Its numbers come from the Check, never from the AI. When the AI couldn't judge, it says "Not checked by AI".
_Avoid_: Reminder (a Reminder is a timed ping the person set), notification (alone)

**Lesson**:
A short line a Bot keeps from a Useful or Not useful answer on one of its alerts, read by the Judge on later Checks. Code writes it from the alert's rule words and the person's own note, never from text the AI or a page wrote. Up to 20 per Bot, each removable.
_Avoid_: memory, training, feedback (alone)

**Starter**:
A ready-made Bot description on the empty Bots page (Price drop, Page changed, Stock move, New in a feed, Morning brief) that opens Bot creation with the words filled in.
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

**Judge**:
The AI step that decides whether a change a Bot's rules spotted is worth telling the person, for Bots set to "AI judges". It runs once per Check on the account's default provider, with no tools, reads page text and notes only as quoted data, and answers alert or not, a title, one line on why, and how urgent. Up to 20 calls per Bot and 200 per account a day. When it can't answer for a passing reason, the alert says "Not checked by AI" and is judged again later; with no provider, no key or the cap used up, it says why and is not asked again (ADR 0024).
_Avoid_: AI filter, reviewer, model (in copy)

**Chain**:
The Bots one Finding travels through by Pass to links, at most 3 links long and never a loop. Its AI calls share one cap of 6, whichever Bot makes them, and the alert at its end shows "How this came to you".
_Avoid_: pipeline, workflow, graph

**Thing**:
What two Bots' alerts are about when they match: a product, a ticker or a link, keyed from the Watch or the feed item. Two alerts on the same Thing on the same day share one alert ("Also seen by"); a follow-up gets through only after a further 5% move or a jump in urgency.
_Avoid_: item (a feed item is one kind of Thing), duplicate, entity

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
