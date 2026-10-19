# Inbox capture

A user writes down a thought with nothing but a title. It lands in the Inbox as an undecided item: no workspace, date or length, and Auto-schedule ignores it. The user later clarifies it into a task or a reminder, or deletes it. The same capture works from the Dashboard's Quick capture card.

## Sub-features

- `inbox-capture-box`: typing in "What's on your mind?" and pressing Enter (or choosing Capture) adds an Inbox item and clears the box for the next one.
- `inbox-up-next`: the oldest capture shows in the Up next card (`UP NEXT · OLDEST CAPTURE`) with `Make it a task`, `Reminder`, `Later` (skip to the next one; offered only when others wait) and the trash button `Delete`. Others wait in the "Also waiting" list with Review buttons.
- `inbox-clarify-task`: Make it a task opens the Clarify dialog. Choosing Clarify turns the item into a Todo task in the chosen workspace and empties the Inbox.
- `inbox-delete`: Delete on the Up next card asks for confirmation, removes the item and shows "Inbox item deleted".
- `inbox-dashboard-card`: the Dashboard Quick capture card adds to the same Inbox and shows "N waiting in Inbox".

## How to get to it (user POV)

- Sidebar link `Inbox` (`/inbox`), then the capture box at the top.
- Dashboard (`/dashboard`): `Add card` → `Quick capture`, then "Capture to Inbox". The card is not on the default dashboard.
- The assistant (Chat) can also capture, but needs an AI provider key. It is not covered here.
- On the phone: Home → Inbox, or + → Inbox. That is a secondary surface and not driven by this skill.

## Driving it with browser.mjs

Preconditions:

- `$V doctor` reports OK.
- A fresh account from `$B signup-onboard`, so the Inbox is empty ("Inbox zero").
- `RUN` and `VERIFY_TIMELY_EVIDENCE` are set (see the README). `T=$(date +%H%M%S)` gives unique titles.

Steps:

- **Open Inbox.** Choose `Inbox` in the sidebar. Run `$B click --role link --name Inbox --exact`, then `$B wait --testid inbox-capture --timeout 60000`. The heading `Inbox` and the text `Inbox zero` are visible. Run `$B snapshot --path $RUN/inbox-capture-box.before.aria.yml`.
- **Capture with Enter.** Type a thought and press Enter. Run `$B fill --role textbox --name "What's on your mind?" --value "Call the bank $T"`, then `$B press --role textbox --name "What's on your mind?" --key Enter`. The status line reads `Captured. Add the next one.` (`$B wait --text "Captured. Add the next one."`), and the box is empty again.
- **Capture with the button.** Run `$B fill --role textbox --name "What's on your mind?" --value "Renew passport $T"`, then `$B click --role button --name Capture --exact`. The page badge reads `2 to review`.
- **Up next order.** The oldest capture is Up next. Run `$B expect --in-testid inbox-up-next --text "Call the bank $T"` and `$B expect --in-testid inbox-list --role button --name "Renew passport $T"` (the row's name starts with the title, so drop `--exact`). Run `$B screenshot --path $RUN/inbox-up-next.png` and `$B snapshot --path $RUN/inbox-up-next.aria.yml`.
- **Persistence.** Reload the page. Run `$B open /inbox`, then `$B wait --testid inbox-up-next`. Both items are still there. Run `$B api GET "/tasks?inbox=true" --path $RUN/inbox-capture-box.api.json`. The body has both names with `"kind":"inbox"`.
- **Clarify into a task.** Choose Make it a task. Run `$B click --in-testid inbox-up-next --role button --name "Make it a task"`. The dialog `Clarify` opens with `What needs to be done?` prefilled and Workspace `Verify`. Run `$B click --in-role dialog --in-name Clarify --role button --name Clarify --exact` and `$B wait --role dialog --name Clarify --state hidden`. The Up next card now shows `Renew passport $T`.
- **Second view of the task.** Choose `Tasks` in the sidebar. Run `$B open /tasks`, then `$B expect --role checkbox --name "Complete Call the bank $T"`. Its row shows Workspace `Verify` and Status `Todo`. Run `$B screenshot --path $RUN/inbox-clarify-task.tasks.png` and `$B api GET /tasks --path $RUN/inbox-clarify-task.api.json`. The task has `"kind":"task"`.
- **Delete.** Back in the Inbox, delete the remaining item. Run `$B open /inbox`, then `$B click --in-testid inbox-up-next --role button --name Delete --exact`. The alert dialog `Delete “Renew passport $T”?` appears. Run `$B click --in-role alertdialog --in-name "Delete “Renew passport $T”?" --role button --name Delete --exact`. The toast `Inbox item deleted` and the text `Inbox zero` appear (`$B wait --text "Inbox zero"`).
- **Dashboard card.** Run `$B open /dashboard`, then `$B click --role button --name "Add card"`, then `$B click --in-role dialog --in-name "Add a card" --role button --name "Quick capture"`. Next run `$B fill --role textbox --name "Capture to Inbox" --value "From the dashboard $T"` and `$B click --role button --name "Add to Inbox"`. The region `Quick capture` reads `1 waiting in Inbox` (`$B wait --in-role region --in-name "Quick capture" --text "1 waiting in Inbox"`). Run `$B screenshot --path $RUN/inbox-dashboard-card.png`. Run `$B open /inbox`, then `$B expect --in-testid inbox-up-next --text "From the dashboard $T"`.
- **Proof.** Capture the final state. Run `$B snapshot --path $RUN/inbox-final.aria.yml`, `$B screenshot --path $RUN/inbox-final.png` and `$B api GET "/tasks?inbox=true" --path $RUN/inbox-final.api.json`. The artifacts show the Inbox heading, and the item comes from the dashboard capture.

## Gotchas

- The `Capture` button stays disabled until the box has non-blank text. Pressing Enter with an empty box does nothing.
- The Inbox list API is `GET /tasks?inbox=true`. `GET /inbox` returns 404, because `/inbox` is POST-only (capture).
- "Also waiting" rows are buttons whose accessible name is the title plus its age badge and `Review`, such as `Renew passport 123456 New Review`. Don't match them with `--exact`.
- Clarify and Delete live in dialogs. Without `--in-role` scoping, `Delete` matches the Up next card button too (strict-mode error).
- With smart suggestions off (the default on a fresh account), Up next shows placeholder hints. That is expected, not a failure.
- Deleting an Inbox item cannot be undone. Use a disposable title.
- Clarify creates a new task row. Its `id` differs from the Inbox item's `id`, so match on the name, not the ID, when you compare the before and after API reads.
- Proved end to end on 2026-10-19 (evidence `evidence/20261019T115739Z-inbox-capture/`, local only). Every step above passed as written. The dev overlay showed `1 Issue`, the known `StatNumber` console error (see the README gotchas).
