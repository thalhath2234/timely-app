# Placement is the only writer of Blocks

- Status: Accepted
- Date: 2026-09-27

Every Block write (Auto-schedule Preview/Apply/Undo, pin, drag, add/move/delete, Clarify with a time, Event times) goes through Placement. Task create, when it has a time, writes that Block through `placeSingleBlock`, which delegates to Placement. Pin must not write Task maps that skip kind rules.

## Consequences

- Auto-schedule is Preview, Apply, and Undo *inside* Placement; drag is not Auto-schedule.
- Two Block writers (Task vs schedule) was the leak; do not reintroduce a third for Events.
