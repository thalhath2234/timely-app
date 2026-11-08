---
name: jev-phase4
description: Jev Phase 4 (receipts and sheets) PR #124 merged, test setup and what was left out
metadata:
  type: project
---
Jev Phase 4 = items 58–69 (receipts and sheets). PR #124 merged into dev 2026-10-09 by the thread on the user's word ("Merge the pr and proceed to next phase"). It also fixed six Phase 0–3 regressions; test report /mnt/project-files/jev-ideas/phase0-4-test-report.md.
- Covers receipt category/destination/repeat/refund hints, correction check, column matching, sheet-change review note, template suggestion (web/desktop only; mobile has no template picker), CSV column types (web+mobile).
- Items 65 and 67 deliberately left out (only source is the same model's photo reading).
- Privacy rule: no receipt amounts/photos to Jev; numbers in typed messages and column examples masked; OpenRouter gets provider.zdr.
- Cloud testing recipe: Electron under xvfb-run with ELECTRON_RENDERER_URL + CDP port; mobile via Expo web at 412x915 with a patched bundle (SSR broken, expo-secure-store shim), scripts in /tmp/claude-0/tester (ephemeral). No KVM, so no Android emulator in the cloud.
- The Timely cloud environment's OpenRouter key works (about 250 ms per Jev call).
Related: [jev-ideas](jev-ideas.md)

Phase 5: see [jev-phase5](jev-phase5.md).
