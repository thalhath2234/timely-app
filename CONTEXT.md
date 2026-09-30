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

**Auto-schedule**:
The Preview, Apply, and Undo operation that places Work within Working hours around existing busy time. It does not place or move Events.
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

**Agent provider**:
The model source an account's Agent runs use: OpenRouter with the account's own key, or the Claude Code or Codex CLI installed and signed in on the API host. Each account has one default provider and a model per provider; a run keeps the provider it started with.
_Avoid_: backend, engine (Auto-schedule is the engine), LLM (in copy)

**Connect**:
Verifying a CLI Agent provider on the API host: the binary is found, its sign-in is valid, and one test call succeeds. Connect never takes a path from the person and never signs in for them.
_Avoid_: install, log in (those happen in a terminal on the host)

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
