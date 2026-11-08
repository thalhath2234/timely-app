---
name: design-system
description: Shared desktop/phone design kit from the 2026-10-11 UI review (PR #147) and the rules UI work should follow
metadata:
  type: project
  modified: 2026-10-11T10:50:05.430Z
---

The thread "UI design review" (2026-10-11) shipped PR #147 into dev (MERGED 2026-10-11, with the Inbox redesign and shortcut removal): one design kit for desktop (apps/web) and phone (apps/mobile). Spec: docs/design-system.md. Tokens: packages/contract/src/designTokens.ts; `make test-design-tokens` fails if apps/web/app/globals.css drifts.

- Web: `Button`/`buttonClass` (_ui/button.tsx, variants primary, secondary, outline, ghost, soft, destructive, destructive-ghost, link; sizes 28/32/36), `Input`/`Field`/`controlClass` (_ui/field.tsx), `Select` (sizes, variant="bare", groups, searchable), `SegmentedControl`, `PageHeader`/`PageBadge`.
- Phone: `Button` (same variants, iconOnly), `Field`/`Select` with `label` (Select `searchable`), `DateField`/`TimeField` (components/ui/DateTimeField.tsx), MobileHeader large title only on tab roots.
- Rules: no native select/date/time inputs, no typed HH:mm, no window.confirm (use requestConfirm), weights 500/600, corners 10/12/20, tabular-nums instead of mono fonts.
- Not migrated: landing, /help, Login/Signup/onboarding (other thread), and the doc editor's code-block and callout selects.
- Critique and screenshots: /mnt/project-files/ui-review/ (before/, after/, critique.md).

**Why:** the user asked for one universal design for reused components and for desktop and phone to match.
**How to apply:** build new UI from these components, not hand-styled classes. Related: [landing-and-help-center](landing-and-help-center.md).

Inbox redesign (2026-10-11, commit 4 of PR #147): user picked "triage desk + capture first" from 3 mockups (canvas https://claude.ai/artifact/99eENrhEEX9qCiMB1Bz5sg). Big composer (phone: docked at bottom), Up next card = oldest capture with Jev suggestion and T/R/S/Del keys on desktop, the rest as cards (amber from 3 days). Shared rules in @timely/contract/inbox (`make test-inbox`). Task createdAt is date-only, so no time of day is shown. Shots: /mnt/project-files/ui-review/inbox/.
