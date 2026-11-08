---
name: phone-motion-loops
description: Phone empty-state motion loops (animated WebP from the Remotion film kit): how they are rendered, why lossless 2x, how to screenshot them, open follow-ups (2026-10-20)
metadata:
  type: project
  modified: 2026-10-20T02:37:40.589Z
---

Thread "All the motion videos on mobile app are low resolution" (2026-10-20), branch fix/mobile-motion-resolution-7jqju7, PR #243 opened and merged into dev 2026-10-20 after the user said "Merge it" (CI green).

- The phone's six loops (capture, ask, cards, project, files, schedule) are `apps/mobile/assets/loops/*.webp`, played by `components/ui/LoopImage.tsx` (expo-image) in Inbox, Assistant new chat, Projects, Files, Dashboard (empty) and the tour. Rendered by `make film-render-loops` (apps/web/scripts/renderLoops.mjs) from `apps/web/app/_components/film/loops` (560x350, 30 fps, 4 s). The web plays the same compositions live, so composition edits change both.
- Fix: PNG frames at `--scale=2` (1120 px), ffmpeg `libwebp_anim -lossless 1` at 15 fps. 0.24 MB -> 1.39 MB (v0.3.4 arm64 APK is 60.2 MB).
- **Why lossless:** lossy animated WebP keeps "near enough" pixels from the previous frame, so slow fades (accept tint, cursor) leave blocky stale-colour patches; keyframes (kmax) or q90 do not remove it. That was the blockiness in the user's screenshots, on top of 420 px being stretched to ~960 px.
- Phone shows a loop at 337-359 dp wide (~930-990 px at 2.75x).
- Cloud: `pnpm exec remotion render/still` works without a browser flag. Screenshots via Expo web at 393x852, deviceScaleFactor 2.75; animated images need a burst of shots and picking the frame closest to the composition's last frame. Comparisons in /mnt/project-files/mobile-motion-resolution/.
- Follow-ups offered, not done: schedule loop clips event labels and header wraps; cards loop picker crowds the grid; with Reduce motion LoopImage rests on the blank frame 0 (fade-in start).
