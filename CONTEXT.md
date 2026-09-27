# Timely

Personal time and task management for one person per account. Collaboration is out of scope.

## Language

**Capture**:
The recording of a title-only thought. Extra fields do not become part of the Inbox item.
_Avoid_: quick add, create task

**Inbox item**:
A captured thought that is not yet Work or a Reminder. It has a title and nothing that would estimate or schedule it. The title may change; it remains an Inbox item.
_Avoid_: inbox task, unprocessed task, capture item

**Clarify**:
Replacing an Inbox item with new Work or a new Reminder. The Inbox item is then gone. Title-only is not Clarify; that is Capture. The new Work may already have a time on the calendar. Deleting without a replacement is not Clarify. An Event is not Clarify.
_Avoid_: convert, change kind

**Work**:
A piece of effort with a duration and a workspace, which can be scheduled.
_Avoid_: proper task, regular task

**Reminder**:
A timed ping with no work estimate. It can be notified at a time; it does not reserve busy time.
_Avoid_: notify, alert (when you mean the Reminder itself)

**Working hours**:
The clock intervals on each weekday when Auto-schedule may place Work. If a date has none, 09:00–17:00 that day is the default.
_Avoid_: schedule, availability

**Event**:
A calendar entry that is not Work and not a Reminder. A timed Event has a duration on the Event, at least one Manual block, optional further Manual blocks, and every timed Block is exactly that duration long. Repeating Events expand on read; a changed occurrence keeps that time until the person changes it again. Auto-schedule does not place or move Events. It is not made from an Inbox item.
_Avoid_: appointment, Calendar item (a Calendar item is a bar on the grid, not this)

**All-day Event**:
An Event that fills Working hours on a date. Auto-schedule places no Work in those hours. Manual Work and Events may still sit outside those hours. Reminder pings are allowed. Duration does not apply. If Working hours change, All-day Blocks on future dates are rewritten; past All-day Blocks stay.
_Avoid_: all-day (when you mean midnight to midnight)

**Calendar item**:
One bar on the grid in a date range: a Work Block, a Reminder ping, or an Event Block (including All-day filling Working hours). Web and mobile draw this list; they do not build it. Auto-schedule does not use this list for busy time.
_Avoid_: event, item (alone)

**Auto-schedule**:
Preview, Apply, and Undo of engine placement of Work onto the calendar. It does not place or move Events. Events are busy time. It computes busy itself; it does not use Calendar items.
_Avoid_: schedule, reschedule (when you mean this engine)

**Placement**:
The one face for writing times on the calendar. Auto-schedule sits inside it. Clarify with a time calls Placement; it does not write a Block itself. Placement writes Blocks for Work and Events.
_Avoid_: schedule module

**Block**:
Reserved time on the calendar for Work or an Event.
_Avoid_: slot

**Manual block**:
A Block the person placed: drag, pin, a time set during Clarify, or an Event’s time.
_Avoid_: locked block (pin is one way to get this, not the only way)

**Engine block**:
A Block placed by Auto-schedule.
_Avoid_: automatic block, scheduled block (that phrase is the row, not the source)

**Rank**:
An ordering hint for Work: a Score and reasons. Not a probability. Auto-schedule computes it. The next-Work list and the waiting-for-slot rail consume the same list: Unscheduled or Overdue Work, ordered by Rank. Callers do not copy the policy.
_Avoid_: what next

**Score**:
The number inside a Rank. Higher is sooner.
_Avoid_: priority (priority is an input to Rank)

**Unscheduled**:
Work that has no Block on the current date (Working hours timezone). A Block on a future date does not make it scheduled for Rank.
_Avoid_: waiting for a slot (that rail shows Unscheduled or Overdue Work)

**Overdue**:
Open Work whose deadline date is before the current date (Working hours timezone). No deadline means not Overdue. Inbox items, Reminders, and Events are never Overdue.
_Avoid_: missed, skipped, late (those are not this term)

**Missed**:
Open Work whose Block or repeating occurrence has ended and is still incomplete. Missed is not Overdue unless the deadline is also before today.
_Avoid_: overdue (deadline only), skipped
