# Timely verification map

This directory is the maintained source for verifying what users can do in the Timely web app. Read this index before driving the app, then use the matching feature file as the recipe. `$V` and `$B` are the helpers defined in `../SKILL.md`.

## Baseline preconditions

- `$V up` has finished and `$V doctor` reports `doctor: OK`. That means API `http://127.0.0.1:8081` in schema `verify_timely` with registration open, web `http://127.0.0.1:4002`, and headless Chromium on CDP `:9339`.
- Never drive `:8080` or `:4001`. Never drive an instance this run did not start.
- Most journeys start from a fresh signed-in account. Run `$B signup-onboard` (UI signup, onboarding "Skip for now", workspace `Verify`, tour skipped) and keep the email and password it prints. A fresh account has one workspace (`Verify`), statuses Backlog, Todo (default), In Progress, Blocked, Completed and Canceled, no labels, no tasks, no events, no docs and no AI provider key.
- `$V browser` restarts Chromium with an empty profile, which is a signed-out browser.
- Before driving, set `RUN=.agents/skills/verify-timely/evidence/<UTC timestamp>-<feature-id>` and `export VERIFY_TIMELY_EVIDENCE=$RUN`.

## Driving conventions

- Start every recipe from the baseline unless its preconditions say otherwise.
- Prefer `--role`/`--name` from an ARIA snapshot (`$B snapshot`). Scope inside dialogs with `--in-role dialog --in-name "<title>"`. Many buttons repeat across the page (`Delete`, `New doc`, `Schedule`).
- Treat quoted names as literal. Several contain curly quotes or ellipses copied from the UI (`Delete “X”?`, `Delete account…`).
- The first visit to each route compiles it in `next dev`. Give the first `wait` on a new route a `--timeout 60000`.
- Use unique titles per run, for example with a timestamp suffix, so a reused schema never matches an older row.
- Clean up with `$B api DELETE /me --body '{"password":"..."}'` after the evidence is saved. It deletes the account and everything in it.

## Known noise

- In `next dev`, a red `N Issue(s)` badge sits bottom-left. Run `$B click --role button --name "Open issues overlay"`, then `$B screenshot --path $RUN/dev-issues.png`, to record what it says, and press `Escape` to close it. As of 2026-10-19, every signed-in page shows one console error: "A props object containing a "key" prop is being spread into JSX" from `StatNumber` in `apps/web/app/_components/_ui/dataMotion.tsx:89`. Report new issues. Don't count this one as a failure of the feature under test.
- The badge overlaps the bottom-left of the sidebar in screenshots.

## Proof and skip reporting

- Capture the user action and the resulting state. Keep `actions.jsonl` (written automatically), plus at least one `snapshot --path ...aria.yml` and one `screenshot --path ...png` that shows the sidebar or page heading.
- Mutation proof includes a second, read-only view of the stored value. That means a reload, another screen showing the same data, and `$B api GET ... --path ....json`.
- Record the feature ID and the entry point used with every artifact. Put the sub-feature ID in the filename.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections, in this order:

1. `Sub-features`: short IDs, one line each.
2. `How to get to it (user POV)`: every user entry point.
3. `Driving it with browser.mjs`: starts with `Preconditions:`, then labeled bullets that pair each user action with an exact command and its observable result.
4. `Gotchas`: traps that can waste or invalidate a verification run.

## Features

- [Account and onboarding](./account-onboarding.md) covers sign-up, the two onboarding steps, the first-run tour, sign-out and sign-in, and the closed-registration screen.
- [Inbox capture](./inbox-capture.md) covers capture from the Inbox box and the Dashboard Quick capture card, clarifying an item into a task, and deleting it.
- [Tasks](./tasks.md) covers New task, the task list, and completing and reopening tasks.
- [Calendar events](./calendar-events.md) covers creating an event from an empty week slot, placing a waiting task, and Auto-schedule.
- [Files: docs](./files-docs.md) covers creating a doc, editing its title and body, and confirming the content persists.

Not mapped yet: Chat/assistant (needs an AI provider key in Settings → Agent, which a fresh account does not have), Projects, Today, Dashboard card editing, Sheets, Settings tabs, Notifications, and the help centre `/help`.
