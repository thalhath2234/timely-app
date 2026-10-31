# Chat changes are pushed, polling only backs them up

The web app learns that a chat changed from one server-sent event stream,
`GET /chats/watch`, instead of polling the chat list every few seconds. A
database trigger on `agent_conversations` announces every change with
`NOTIFY`, so no code path that writes a chat can forget to, and every API
process on the database hears it (a run claimed by another process still
reaches this one's apps). Lease renewals are left out, and a rolled-back
transaction sends nothing.

It is an event stream, not a WebSocket: the web app and the desktop reach the
API only through the same-origin `/api-proxy` route, which passes streams
through but cannot carry a WebSocket upgrade, and updates only flow from the
server. A browser holds six connections to one address across its tabs, so
one tab holds the stream (a Web Lock) and shares it over a BroadcastChannel.
A once-a-minute poll stays as the fallback for a dropped stream; while the
stream is down, chats with a run working are polled fast again. The phone
still polls while its chat sheet is open.
