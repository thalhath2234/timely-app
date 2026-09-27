# Clarify may write a Manual block

- Status: Accepted
- Date: 2026-09-27

Clarify may include a start time. That time is a Manual block, written through Placement, not by Task create itself. Auto-schedule does not move it unless the person replaces manual blocks. ADR 0001 splits capture / decide / schedule; we still allow one submit to decide and place so the create form matches N.

## Considered Options

- **Clarify never places Work**: cleaner split. Rejected: the agreed form is N with a title, including optional `scheduledOn`.
- **Treat that time as an Engine block**: Apply could move it. Rejected: the person chose the time.
