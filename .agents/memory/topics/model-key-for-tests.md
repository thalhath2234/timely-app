---
name: model-key-for-tests
description: AI test keys rule (user 2026-10-31) - Claude ALWAYS Haiku only; OpenRouter key ONLY for embeddings and Jev; keys live as cloud env vars, never printed
metadata:
  type: feedback
  modified: 2026-10-31T13:30:12.681Z
---

User, 2026-10-31 (threads "Fix Help me write checklist context" and "Group agent changes for review"): "use the environment variables i gave for openrouter and claude to test ai features. for claude always use haiku no other model and only use openrouter api for embedding and jev".

**Why:** cost. The cloud env had no working model key before ([cloud-env-testing](cloud-env-testing.md)), so threads tested with a scripted stand-in model.
**How to apply:**
- Test AI features with the user's keys from the cloud env vars. Never print, paste or commit a key (check names only, e.g. `env | cut -d= -f1`).
- CLAUDE: the test account's Anthropic provider uses a Haiku model only (claude-haiku-5-5). Never Sonnet, Opus or Fable, not even for one call.
- OPENROUTER: only for embeddings (semantic search) and Jev. Never as the chat agent's model.
- Agent chat runs that need a model therefore use Claude Haiku, or the scripted stand-in when no Claude key is set.
- Names seen 2026-10-31 08:05 in the "Group agent changes" session: `TIMELY_LIVE_KEY_OPENROUTER` was set; NO Anthropic-shaped key was in the env (the Claude key may need adding as a cloud env secret, e.g. `TIMELY_LIVE_KEY_ANTHROPIC`; only new sessions see new secrets). `make test-providers-live` reads TIMELY_LIVE_KEY_<ID> (do NOT run it with the OpenRouter key: it sends chat calls).
- 2026-10-31 13:15: the user's `ANTHROPIC_API_KEY` env var is NOT visible inside cloud sessions (likely reserved by Claude Code itself). User added `TIMELY_LIVE_KEY_ANTHROPIC` at 13:17; sessions started after that see it. OpenRouter key works (~$50 limit).
- Recorder harness for AI tests: /mnt/project-files/ai-edge-cases/recorder.js (logs provider/model per call, refuses non-Haiku Claude and OpenRouter chat calls, forwards only embeddings + Jev). Edge-case map: /mnt/project-files/ai-edge-cases/ [ai-edge-cases](ai-edge-cases.md). Patched-API setup that routes all calls through it: [ai-live-test-harness](ai-live-test-harness.md).
