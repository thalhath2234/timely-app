# Calendar events

A user plans their week on the Calendar. Clicking an empty slot opens "Add to calendar", where they either place a waiting task by hand or create an event that blocks the time. Tasks without a slot wait in the "Waiting for a slot" panel, and Auto-schedule can place them inside working hours.

## Sub-features

- `calendar-views`: Day, Week, Month and Agenda in the radiogroup "Calendar view", with `Previous period`, `Next period` and `Today`.
- `calendar-slot-event`: an empty slot leads to `Add to calendar`, then `New event`, Title, then `Create event`. The event appears in the grid.
- `calendar-slot-task`: an empty slot leads to `Add to calendar`, then `Schedule a task`, then picking a waiting task, then `Schedule`.
- `calendar-waiting`: the panel "Waiting for a slot" lists unscheduled tasks, each with a `Schedule` button.
- `calendar-autoschedule`: the header button `Auto-schedule N` places waiting tasks into working hours. Not driven yet.

## How to get to it (user POV)

- Sidebar `Calendar` (`/calendar?view=month`). Switch to Week with the `Week` radio, or open `/calendar?view=week`.
- Click any empty hour. Each slot is a button named `Schedule at <h AM/PM> on <Weekday>, <Month> <d>`.
- The header `Add` button.

## Driving it with browser.mjs

Preconditions:

- `$V doctor` reports OK, and there is a fresh account from `$B signup-onboard`.
- For `calendar-slot-task`, one unscheduled task exists. Create it through [tasks](./tasks.md) first.
- Slot names depend on the current week. Build them from `$B snapshot`, or pick a day in the visible week, for example `"Schedule at 10 AM on Tuesday, October 20"`.

Steps:

- **Open the week.** Run `$B open "/calendar?view=week"`, then `$B wait --role radio --name Week --timeout 60000`. The heading `Calendar` and the range text (`Oct 18 – 24, 2026`) are visible.
- **Open a slot.** Run `$B click --role button --name "Schedule at 10 AM on Tuesday, October 20"`. The dialog `Add to calendar` opens, with `Schedule a task` checked and `When, Tue, Oct 20, 10:00 AM`.
- **New event.** Run `$B click --in-role dialog --in-name "Add to calendar" --role radio --name "New event"`, then `$B fill --in-role dialog --in-name "Add to calendar" --role textbox --name Title --value "Dentist $T"` and `$B click --in-role dialog --in-name "Add to calendar" --role button --name "Create event"`. The dialog closes (`$B wait --role dialog --name "Add to calendar" --state hidden`), and a grid button named `Dentist $T` appears (`$B expect --role button --name "Dentist $T"`).
- **Second view.** Run `$B open "/calendar?view=week"`, then `$B expect --role button --name "Dentist $T"`. Run `$B api GET /events --path $RUN/calendar-slot-event.api.json`. The event has `start` 10:00 and `duration` 30. Run `$B screenshot --path $RUN/calendar-slot-event.png`.
- **Place a waiting task.** Open another slot. In `Schedule a task`, choose the task's button (named `<task> Verify · Medium 30m`), then `$B click --in-role dialog --in-name "Add to calendar" --role button --name Schedule --exact`. The task leaves "Waiting for a slot" and shows in the grid.

## Gotchas

- Slot and range labels use the browser's local time zone (the host's), while API timestamps carry the server offset. Assert on the visible label, and on `start` in `/events`, using the same zone.
- `Schedule` appears both in the waiting panel and in the dialog. Scope with `--in-role dialog --in-name "Add to calendar"`.
- `Create event` stays disabled until Title has text.
- Week view renders all 24 hours × 7 days as slot buttons, so full ARIA snapshots are long. Snapshot a region or dialog when you can.
