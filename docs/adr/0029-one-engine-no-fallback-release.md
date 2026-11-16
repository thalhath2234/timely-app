# One engine, with no classic fallback release

- Status: Accepted (2026-11-17)
- Date: 2026-11-17
- Amends: the Q-2.2 answer and phase 8 of the Hermes plan; ADR 0026 (engines); ADR 0027 and the Q-B4 answer (conversion)

The Hermes plan kept Timely's own chat loop ("Classic") as a per-chat fallback
for one release after the agent engine became the default. It also had the
owner approve each converted rule Bot one at a time, and waited for two weeks
of converted Bots alerting well before the rules code was deleted. On
2026-11-17 the owner chose to skip all three. Timely is not in production and
its data is dummy, so a fallback release protects nobody.

**The agent engine is the only engine.** The Classic plan loop, triage tool
narrowing, its own web search path, the `transcript` column, the per-account
and per-chat engine switch and "Use classic for this chat" are deleted in the
same change that makes the agent engine the default. Photo and Sensitive chats
run on the agent engine with image input and the no-persist path, which is
always on for Sensitive chats. Applying approved changes and the receipt
phases stay lane work; they were never Classic chat turns. When the agent
runtime is missing, chat fails with that reason; nothing falls back.

**Rule Bots are converted in the migration, without approval.** Every rules
Bot becomes an agent Bot whose prompt is built from its rules (with the
in-stock clause on product prices), and the rules, judge, re-judge and
suggestion code and their columns are deleted.

**Considered:** keeping Classic for one release (the plan), and keeping a small
Classic path only for photo chats. Both were rejected because they keep a
second engine, its TLA+ branch and its tests alive for no user.

**Consequence:** the Windows installer, the AppImage and the `.pacman` package
are first checked with the agent-only build when the owner tags the next
release, not before the deletion.
