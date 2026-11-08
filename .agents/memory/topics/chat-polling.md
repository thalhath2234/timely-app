---
name: chat-polling
description: Why devtap's inspector (:9090) showed GET /chats over and over, the polling fix, and the SSE chat stream branch (thread "Repeated /chat requests", 2026-10-25)
metadata:
  type: project
  modified: 2026-10-25T12:53:25.259Z
---

User asked (2026-10-25) why /chat is called over and over on http://localhost:9090.

- :9090 is devtap's inspector. Since #249 `make dev-api` runs the API behind devtap when it is installed (devtap on 8080 -> air on DEVTAP_API_PORT 8087). Not related to #248.
- Cause: web `useChats()` (apps/web/app/utils/hooks/chat.ts) polled GET /chats every 5 s on every page, also in hidden tabs (Activity island, Chat unread badge, desktop notifications read it); `useChat(id)` polled every 5 s too. Each tab polls separately. Phone Assistant only polls while it is open.
- fix/chat-list-polling (commit 7c3a183): fast polling only while a run is queued/running, else 60 s. Idle 12/min -> 1/min. Evidence /mnt/project-files/chat-polling/.
- User then asked "Can I use a web socket to update chats status"; recommended SSE (Next /api-proxy route can't carry a WebSocket upgrade), user PICKED "SSE stream" on the card (12:34 UTC).
- feature/chat-status-stream (includes the polling fix; dev merged in 2026-10-31; PR #259 opened 2026-10-31 on the user's "open pr", MERGED into dev 2026-10-31 09:20 on the user's "merge", merge commit 5538ff9): GET /chats/watch SSE; DB trigger on agent_conversations NOTIFY timely_chats (migration renamed to 20261031090000 to run after dev's newer ones, lease renewals excluded, schema in payload for DB_SCHEMA); web shares one stream per browser via Web Locks + BroadcastChannel (apps/web/app/utils/api/chatStream.ts); realtime.Hub.Close on shutdown (dev waited 10 s with a doc watch open). ADR 0018 (0013 was taken). Changes reach the page in ~0.3 s. Evidence /mnt/project-files/chat-polling/stream/results.md.

**Why:** a later thread on chat polling, devtap noise, island/notification delays or realtime streams needs this without re-measuring.
**How to apply:** don't add WebSockets through /api-proxy; extend the trigger/hub pattern. The phone still polls; a phone stream would need an SSE reader in RN.
