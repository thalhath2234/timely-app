---
name: bots-secure-signin-plan
description: Bots Part F redone 2026-11-05 after Muse screenshots - Secure Store + agent signs in + live view panel; owner answered the 4 questions 2026-11-06; nothing built
metadata:
  type: project
  modified: 2026-11-05T11:50:11.498Z
---

2026-11-05 user showed Muse (in-app browser, Secure Store, agent logs in) and asked: credentials in a secure store the LLM can't read, only the agent drives the browser, headless, show what it's doing on private pages (banks).

Written into the bots doc Part F (https://claude.ai/artifact/UKMDCSdYWygy9i9dnHekUy), new H3 "Secure sign-in: the agent signs in for you" + new F1-F7 table. Sketches (light+dark, desktop live panel, Secure Store modal, phone run + "Allow this request?", phone sign-in page): /mnt/project-files/bots-plan/sketches/secure-signin/ (source/ has HTML). Full synthesis was a workflow result, now in the doc.

F1 (recommended): Postgres table of logins sealed AES-256-GCM with NEW TIMELY_VAULT_KEY (Electron makes it, seals with async safeStorage, passes like TIMELY_BACKUP_KEY; no fallback to backup key/JWT_SECRET). AI holds only {handle, origin} ticket. Modal posts to REST, never chat. fill_credential checks https + exact punycode origin + frame origin + no cert error + field type, types via Input.insertText; submit_login arms ONE POST. Runs park (free worker lane). Live view = Page.startScreencast over SSE, memory only; header drawn by Timely, "Claude Haiku (cloud) is reading this page", Stop; Take control ANY TIME (doc section "Take control": pauses agent, AI reads nothing, guard stays on with Allow once only, Give back re-checks site, 15 min idle stops run, new "browser" wait keeps transcript, one device at a time). Private pages: Sensitive marking, text only to AI (no screenshots to cloud), "Only local AI" per login, exfil cut-offs. Read-only: CDP Fetch GET-only + "Allow this request?" card (field names only); no transfers/payments in v1. OTP code card PC+phone (5 min, once); TOTP off by default, blocked for banks unless on. 1 password try/run, 3/day. "Sign in on its own" off for Bank/Email/Health/Gov/Payments. Copy: "Timely types your saved password. The AI never sees it." F2 site API, F3 sign in yourself in a real window = fallback (Google), F4 Electron embedded browser later, F5 paste cookies, F6 Browserbase/Steel servers only, F7 captcha solvers/hiding automation REJECTED.

Tested: HeadlessChrome/153 + webdriver=true visible; Fetch blocked script and form POSTs; password not in outerHTML/innerText/AX tree but readable via JS (so never give the model eval).

Owner answers 2026-11-06: (1) Take control ANY TIME, not only when the agent asks; (2) cloud notice on bank pages, "Only local AI" switch shown ONLY when a local model is set up; (3) yes, SMS code needs you; authenticator keys for banks opt-in; (4) keep F3 sign-in-yourself fallback. Still open: picks for Parts A-G.

**Why:** a later thread building sign-ins starts here. **How to apply:** build only after the user picks; see [autonomous-bots-plan](autonomous-bots-plan.md), [pr-confirm-rule](pr-confirm-rule.md), [model-key-for-tests](model-key-for-tests.md).
