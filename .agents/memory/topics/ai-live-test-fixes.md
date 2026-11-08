---
name: ai-live-test-fixes
description: Fixing the AI live-test findings (user 2026-11-01) - all fixes MERGED into dev as #265-#273 (2026-11-01 18:29); 16 owner questions open
metadata:
  type: project
  modified: 2026-11-01T14:30:46.594Z
---

User 2026-11-01 00:53 in thread "Live-test AI features with both keys": "Work on hight and medium, after review work ln low". Findings from [ai-live-test-harness](ai-live-test-harness.md) (all-findings.md; round-1 Jev ids are JC1-JC3).

Routing findings were fixed by #263; GW9 by #264 (both merged into dev, 6f76453).

HIGH/MEDIUM (all on dev base, fixed + independently reviewed, pushed, no PR): fix/help-me-write-data-loss 9e28a98, fix/ai-jobs-and-index 6487bd7, fix/web-stale-ai-hints c281c09, fix/live-block-apply 13d7cbf, fix/chat-image-answers c4f614b, fix/jev-suggestions 5235817, fix/chat-prompt-cost 50fa24b, fix/provider-settings-safety 79b48c9.

LOWS (done 2026-11-01 ~12:30; 246 items, 189 fixed, rest already-fixed/not-a-bug/needs-owner; each STACKED on its base): fix/jev-suggestions-lows 32e1d30, fix/web-client-lows b4ef30f + fix/search-lows aa7f692 (both on web-stale-ai-hints), fix/ai-jobs-and-index-lows 20fb140, fix/help-me-write-lows 3708283, fix/chat-image-lows 303d064, fix/chat-lows dd4cf9d (on chat-prompt-cost), fix/provider-settings-lows 28391f1, fix/live-block-lows 53444a0. Proof: /mnt/project-files/ai-live-tests/fixes/<lane>-lows/proof.md + PNGs.

OWNER DECISIONS 2026-11-01 (built on fix/provider-settings-lows, ADR docs/adr/0020-the-person-picks-the-default-provider.md):
- Removing the DEFAULT provider's key asks which remaining provider to use (web + phone).
- Saving the only key does NOT make it default on its own; Timely asks ("Which provider runs new chats?").
- Before a pick, AI features WAIT and point to Settings (no Automatic run).

PRS (user 2026-11-01 17:22 "open pr and merge it i will answer those questions later"): #265 jev, #266 help-me-write, #267 live-block, #268 ai-jobs-and-index (migration index_jobs_ids_only), #269 web-client, #270 search, #271 chat-image (migration chat_error_action), #272 chat, #273 provider-settings (ADR 0020). All base dev; each branch has the earlier ones merged in (conflicts resolved, combined tree fully tested), so merge strictly in that order with merge commits. ALL 9 MERGED into dev 2026-11-01 18:27-18:29 with green CI; dev d15dd6f has exactly the tree that was fully tested. API restart needed for the 2 migrations.

OPEN QUESTIONS: report doc "Timely AI live test report" (artifact M2XBaADfL23aq9TUAvZh8A) "Low fixes" section lists 16 needs-owner items with my picks in brackets (GJ25, P1, RV-jev-3, GU6, GU33, GU10, GB27, E4, JC1, W20, GS4, GS5, GS18, RV-images-1, R12, GP10). "go with your picks" = build my bracketed picks.

Phone app only typechecked; no device screenshots.

Outage recovery (usage limit reboots the container): restart Postgres + recorder (`nohup setsid start-rec.sh >/dev/null 2>&1 </dev/null & disown`), push unpushed agent commits, remove .claude/worktrees, resume workflow with resumeFromRunId. Disk tight: `go clean -cache` freed 18G.

**Why:** the user wants every finding fixed before v1.
**How to apply:** when the user answers the 16 questions, build on a fresh fix/ branch from dev and ask before the PR ([pr-confirm-rule](pr-confirm-rule.md)); Claude tests = Haiku only ([model-key-for-tests](model-key-for-tests.md)).
