---
name: ai-live-test-harness
description: How to live-test Timely AI features in the cloud with the user's real keys behind a call recorder (Haiku-only, OpenRouter only embeddings/Jev), and what it found
metadata:
  type: reference
  modified: 2026-10-31T13:30:00.611Z
---

Built 2026-10-31 in thread "Live-test AI features with both keys" (user asked for both keys tested, "ultracode" = multi-agent workflow OK).

- Keys: cloud env vars TIMELY_LIVE_KEY_ANTHROPIC (added by the user 2026-10-31 13:17) and TIMELY_LIVE_KEY_OPENROUTER. Both valid as of 2026-10-31.
- Recorder: /mnt/project-files/ai-edge-cases/recorder.js (written by sibling thread "Test AI features with real API keys"). Copy it to the scratchpad and change `entry.tag === 'live'` to `/^live/.test(entry.tag)` so several test accounts can go live. It refuses non-Haiku Claude calls, stubs every OpenRouter chat completion as a rule break, forwards embeddings/Jev/model lists live. Only the recorder sees real keys.
- API: copy apps/api to the scratchpad, sed every hardcoded provider URL to http://127.0.0.1:9911/{anthropic,openrouter,typesafe}/... (registry.go anthropic endpoint, models.go, service.go, chat/provider.go, decide/client.go, embed/client.go), build, run from apps/api cwd with API_PORT=8081 CHAT_LOCAL_CLI=off ALLOW_REGISTRATION=true and the TIMELY_LIVE_KEY_* vars unset. Go 1.24 in the container downloads 1.25 itself (GOTOOLCHAIN=auto).
- Accounts save stand-in keys `sk-ant-standin-live<x>-0001` / `sk-or-standin-live<x>-0001`; the recorder swaps in the real key for tags starting "live". After saving the Anthropic key, PATCH /agent/providers {defaultProvider:"anthropic", models:{anthropic:"claude-haiku-5-5"}} in ONE request, or the default switch test-calls the auto-picked Opus.
- Container has 4 CPUs, so workflows run only 2 agents at a time.
- Helpers and README lived in that session's scratchpad (tools/: setup-account.mjs, api.mjs, calls.mjs); results in /mnt/project-files/ai-live-tests/.

Related: [model-key-for-tests](model-key-for-tests.md), [cloud-env-testing](cloud-env-testing.md), [jev-stand-in-testing](jev-stand-in-testing.md).

Results (final 2026-10-31 ~23:00): report doc https://claude.ai/artifact/M2XBaADfL23aq9TUAvZh8A ("Timely AI live test report"); every finding in /mnt/project-files/ai-live-tests/all-findings.md (ID, area, round, severity, re-check). 296 findings over 3 rounds (74 live, 41 gap 1, 181 gap 2); 148 high/medium re-run, 137 reproduced; final 7 high, 54 medium, 230 low, 5 not bugs. High: W1/GW1/GW2 Help me write Replace deletes text, GW3 add_live_block lost update, GU1 stale "Set as blocker" hint poisons task autosave, C2 invalid-UTF-8 error leaves chat running (GB4 same in jobs), E1 index dedupe keeps stale text. Other notable: GB1 MCP restore_account with empty rows wipes the account, GC2 private image chat text to OpenRouter embeddings without zdr. Phone app NOT tested. Evidence (421 PNGs light+dark) in /mnt/project-files/ai-live-tests/{routing,writing,chat,jev-embeddings,clients,jobs-restore}/.
- Fix ownership: the "Test AI features with real API keys" thread took the provider ROUTING fixes (OpenRouter default, default reset on disconnect, writeProvider fallback, OpenRouter key check as chat call, Opus default and re-key to Opus, add_live_block ignoring chat model). Everything else (data loss, jobs, Jev, images, cost) belongs to the live-test thread, fixes offered on a fix/ branch, not started; no PR without the user's OK.
- Usage: the 3 rounds hit the account 5-hour limit twice (container rebooted, servers restarted by hand; resume workflows with resumeFromRunId).
