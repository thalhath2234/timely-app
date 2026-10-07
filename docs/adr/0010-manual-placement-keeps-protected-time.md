# Manual placement keeps protected time and overlaps it

- Status: Accepted
- Date: 2026-10-03

Placing or moving a Work Block by hand (drag, `schedule_task`, `move_block`, and `update_task` or a task PATCH that sets `scheduledOn` on Work) still pushes aside other replaceable Work Blocks in that span so Auto-schedule can re-place them. It never deletes Pinned time or an Event's time: those Blocks stay and the new Block simply overlaps them. An Agent proposal that places a Block also records the calendar span it reserves; a new Block in that span after approval sends the proposal back for review.

## Considered Options

- **Displace everything** (previous behaviour): silently deleted a Pinned Block or an Event's only time. Rejected: the person chose that time explicitly.
- **Reject the placement with an error**: safe but makes a quick drag fail. Rejected: overlap is visible on the grid and the person can resolve it; the agent already refuses when it can see the conflict beforehand.
