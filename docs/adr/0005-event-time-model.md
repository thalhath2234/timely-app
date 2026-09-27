# Event time: duration on the Event, Blocks, All-day fills Working hours

- Status: Accepted
- Date: 2026-09-27

A timed Event has duration on the Event and at least one Manual block; further Manual blocks are allowed and each is exactly that duration long. Repeating Events expand on read; a changed occurrence keeps that time until the person changes it again. Auto-schedule does not place or move Events. An All-day Event fills Working hours that date (09:00–17:00 if none); duration does not apply; if Working hours change, future All-day Blocks are rewritten and past ones stay.

## Considered Options

- **Keep Event start/end only** (no Blocks): rejected; one Event may occupy several intervals (Tue + Thu) without an RRULE.
- **Store a Block per repeating occurrence**: rejected; same expand-on-read model as Work series.
- **Auto-schedule places Events**: rejected; Event times are Manual and busy.
