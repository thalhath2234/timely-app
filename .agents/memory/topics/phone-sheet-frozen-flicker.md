---
name: phone-sheet-frozen-flicker
description: Phone sheet frozen rows/columns flicker fix (2026-11-06): pinned layers moved from Reanimated to RN native-driver Animated.event; branch fix/phone-sheet-frozen-flicker, no PR yet
metadata:
  type: project
---

Thread "Fix flickering frozen sheet headers on phone" (2026-11-06). Branch fix/phone-sheet-frozen-flicker, PR #278 MERGED into dev 2026-11-06 (user opened it from the Claude Code UI); real-phone check not done.

- Cause: SheetGrid pinned layers ([phone-freeze-panes](phone-freeze-panes.md)) used Reanimated useAnimatedStyle. On Android Fabric, Reanimated (4.5.1, default flags) applies drag-scroll updates via shadow-tree commits and PAUSES them from a React commit until it mounts (ReanimatedCommitHook/MountHook). Every cell press-in re-renders the whole grid, so layers rode with the scroll then snapped back.
- Fix: RN core Animated.event({useNativeDriver:true}) on both grid scrollers; components/sheets/SheetPinLayer.tsx (native transform + passthroughAnimatedPropExplicitValues with the resting offset after 80ms quiet, needed for Pressability press regions); web path writes DOM transform from the scroll event (RN-web's JS Animated lags a frame). createScrollRest in lib/sheetFreeze.ts; tests in `make test-mobile-sheet-freeze`.
- Expo web cannot show the bug: before and after both 0 px drift (measure script, wheel steps; CDP touch gestures don't scroll the grid). Proof needs the real phone. Shots /mnt/project-files/phone-sheet-frozen-flicker/.
- Seen in passing: light theme "Month total" row is dark text on dark green (unreadable), not fixed.
