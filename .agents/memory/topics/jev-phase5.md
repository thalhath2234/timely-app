---
name: jev-phase5
description: Jev Phase 5 (work and projects, items 12-27) PR #125, what it covers and the cloud test recipe for it
metadata:
  type: project
---
Phase 5 = items 12–27. PR #125 opened and merged 2026-10-09 from feature/jev-phase4-j1vvw6 (merge commit 09cb163).
- Covers task hints, stale work review (21 days idle), project insights, label/status/option cleanup merges (workspace/merge.go, rewrites saved views), "Start from" in New project, agent pick_tasks + bulk_update batches of 50.
- POST /projects/:id/duplicate now takes an optional new-project body (same workspace only) so "Start from → copy" keeps the form's fields and custom values.
- Live Jev quirks: uncovered brief items and overlaps vary run to run (Prefill/Flag thresholds); Area multi-select not caught.
- Stale-work screenshots need old dates; a direct psql write to the test schema is refused, so a throwaway API build shifted time.Now() for stale-work only (never committed).
- Screenshots: /mnt/project-files/jev-ideas/screens/phase5/.
Related: [jev-phase4](jev-phase4.md) [jev-ideas](jev-ideas.md)
