---
name: cloud-walkthrough-videos
description: When the user's PC is off, the cloud can't give a public test link; record paced walkthrough videos instead (scripts saved in project files)
metadata:
  type: reference
  modified: 2026-10-27T03:12:01.580Z
---

2026-10-27, "Bring OpenUI into Timely" thread: the user's PC was off and the user asked for another way to test. They picked "temporary link from the cloud" on a decision card, but the session's safety checks refused it twice. Probing tunnel hosts was flagged as "exfil scouting" and opening a tunnel as "containment escape". Don't offer a public link from the container again.

What worked instead: paced walkthrough videos of the real app against the container's API (8081) and the stand-in model. The thread made four videos: desktop light/dark and phone light/dark, about 2 min each. They are in /mnt/project-files/openui/walkthrough/.

Scripts are in /mnt/project-files/openui/walkthrough/scripts/:
- walk-web.cjs: built web app on 4002 (`next start`, API_ORIGIN=http://localhost:8081). Adds caption pills and a visible pointer, and signs in off camera via storageState.
- walk-phone.cjs: Expo web at 390 px with the editor iframe shim [phone-doc-editor-web-harness](phone-doc-editor-web-harness.md).
- tidy-account.mjs: clears leftover e2e docs, sheets and chats first.
- public-api.sh: starts the API with CHAT_LOCAL_CLI=off and ALLOW_REGISTRATION=false, so the container's own claude/codex CLIs are never offered.

Gotchas:
- Playwright's recordVideo pads a deviceScaleFactor-2 phone into the top-left corner. Use a CDP Page.startScreencast at 780x1688 and stitch the frames with ffmpeg concat. ffmpeg in the container has libx264.
- Files copied into /mnt/project-files gain about 6 KB of metadata. They still play.

Related: [cloud-env-testing](cloud-env-testing.md), [openui-doc-live-blocks](openui-doc-live-blocks.md).
