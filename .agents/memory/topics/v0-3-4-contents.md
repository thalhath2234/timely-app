---
name: v0-3-4-contents
description: v0.3.3 and v0.3.4 contents PR by PR (#158-#236) and checks still pending on a real phone or PC
metadata:
  type: project
---
User-facing summary: /mnt/project-files/releases/v0.3.4-notes.md. Flow: [release-flow](release-flow.md).

## v0.3.3 (released)
- #158 Sheets engine + MCP sheet tools (agent row/col deletes don't fix formula refs) [sheets-stress-test](sheets-stress-test.md). #163 Help me write [help-me-write](help-me-write.md). #166 phone freeze panes. #165 crash fix (orphan next-server processes capped 1.5 GB; untested on real Windows).
- Open offers, no answer: OpenIntelligentUI ideas #1/#2; manual goal-task linking (#159).

## In v0.3.4 (real-phone checks pending unless noted)
- #171-#181 doc hint/task fixes, phone chat context, phone board drag [phone-board-drag](phone-board-drag.md), Today "Day board" [today-redesign](today-redesign.md), MCP sheet tools, auto-schedule duplicates (user UTC+9), small phone fixes.
- #182 natural-language search + Save as view. #183 shared phone form sheet [forms-sheets-redesign](forms-sheets-redesign.md). #184-#198 60-day run fixes (open: phone New label form ~45px under keyboard) [sixty-day-run](sixty-day-run.md). #199 doc page layout. #200 doc images/saving/history. #201/#203 card workshop from sheet cells/doc sections. #204 sheet column popovers. #208 Help me write preview docks beside its line. #211 desktop setup key inline + QR (untested in real build).
- Android (thread "Android app features", #202/#209/#212/#217): predictive back, native widgets, interactive widgets, Quick add bar, shortcuts, live notification (polls 60 s in focus), Back doesn't close app, widget battery fixes. Widget code apps/mobile/lib/widgets/. Open picks: settings 2/3, widget style 2/3, interactive 2/3. [android-features-pr-202](android-features-pr-202.md)
- #205 install-apk regen + pomodoro progress. #206 phone bottom bar icons only. #207 12-colour picker. #210 "Preparing Timely" waits for Today data. #213 phone dashboard drag grip. #215 Today free slot opens task.
- #214/#216 grouped view filter + phone Settings. #218 grouped task details/forms/dialogs [grouped-task-forms](grouped-task-forms.md). #220 grouped phone project screen (tested on phone; open: a task's repeat changed to Weekly by unknown cause, left alone).
- #221 doc task tick no longer opens keyboard (user to check). #223 doc lines matched to tasks word by word, "From <doc>" link on created tasks (API restart needed). #222 phone dashboard prefetch (tested; seen: Pomodoro card Timer settings panel toggles itself while scrolling).
- Widgets: #224/#226 standalone Pomodoro and Timer widgets (only action buttons reach Timely), sheet counter widget counts on phone and auto-saves on refresh, phone sheet pull-down gesture fix; #219 tap areas, resize redraw, Ask/Today open with app closed. Widget picker only lists cards on the Dashboard; after an update widget taps need Timely opened once (Autostart). #226 untested on phone. User to delete 'Widget test' cards + RC worktree gifted-swartz-321e3d. [widgets-standalone-pr-224](widgets-standalone-pr-224.md)
- #225 predictive back: slides away from start edge; logcat tag TimelyBack. #239 (dev 2026-10-20, post-v0.3.4): leaves at 32dp, returns under 24dp; Android's arrow still arms at 16dp. Offered own haptic at 32dp.
- #228 DESIGN OVERHAUL (phases 0-5, [design-overhaul-phases](design-overhaul-phases.md)). User has only reviewed phases 0-2; expect follow-up reports once they run it (`make dev`, `make install-apk`, new phone dependency expo-image). Related: a doc outline must be collapsible, no reading time.
- #230 doc checklist task suggestions (web + phone): an item is offered as a task only if it is two or more words or a single action/chore word (Call, Deploy, Laundry); lone nonsense words, numbers, dates, links are skipped. Help page updated. Shots /mnt/project-files/doc-task-suggestion/.
- #231 overlay blur flicker: dropdowns and date pickers open through view transitions that snapshotted the whole page incl. the blurred scrim; page now opts out, dialog fade-in moved to CSS. User to confirm on PC (flicker does not show in headless Chromium). 
- #232 chat "create sheet from template" with built-ins (builtin:yearly-expenses) no longer says "record not found". User has not confirmed.
