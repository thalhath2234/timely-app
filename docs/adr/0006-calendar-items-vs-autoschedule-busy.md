# Calendar items are the grid; Auto-schedule computes busy itself

- Status: Accepted
- Date: 2026-09-27

Range returns Calendar items for the grid. Web and mobile draw that list and do not build bars. Auto-schedule does not use Calendar items for busy time; it computes busy itself. The two lists may drift (Reminder pings, All-day Working hours). That decoupling is deliberate.

## Considered Options

- **One read face**: Range plus busy intervals from the same list. Rejected: grid and engine stay separate; do not “fix” drift by merging them without revisiting this ADR.
