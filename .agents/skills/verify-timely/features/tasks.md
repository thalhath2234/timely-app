# Tasks

A user creates tasks with a title and optional details (workspace, project, status, priority, duration, deadline, schedule, repeat, start date). They see them in the Tasks list, grouped by workspace, and complete or reopen them from the row's checkbox.

## Sub-features

- `tasks-new`: `New task` opens the dialog `New task`. `Create task` stays disabled until a title is entered, then creates the task.
- `tasks-list`: `/tasks` shows the `Task List` view, grouped by Workspace › Project › Stage, with one row per task and columns such as Duration, Workspace, Priority and Status.
- `tasks-complete`: the row checkbox `Complete <name>` marks the task done. Status becomes `Completed`, Completed At is filled, and the checkbox becomes `Reopen <name>`.
- `tasks-reopen`: `Reopen <name>` reverses `tasks-complete`.
- `tasks-views`: List, Kanban and Gantt layouts, saved views (`Add view`) and filters. Not driven yet.

## How to get to it (user POV)

- Sidebar `Tasks` (`/tasks`), then `New task` in the page header.
- Sidebar `Add item` opens the same create dialog from any page.
- An Inbox item's `Make it a task` (see [inbox-capture](./inbox-capture.md)).

## Driving it with browser.mjs

Preconditions:

- `$V doctor` reports OK, and there is a fresh account from `$B signup-onboard` (workspace `Verify`, no tasks).
- `T=$(date +%H%M%S)`.

Steps:

- **Open Tasks.** Run `$B open /tasks`, then `$B wait --role button --name "New task" --timeout 60000`. The heading `Tasks` is visible.
- **New task.** Run `$B click --role button --name "New task"`. The dialog `New task` opens with `Create task` disabled. Run `$B fill --in-role dialog --in-name "New task" --role textbox --name "What needs to be done?" --value "Write report $T"`, then `$B click --in-role dialog --in-name "New task" --role button --name "Create task"` and `$B wait --role dialog --name "New task" --state hidden`.
- **List row.** Run `$B expect --role checkbox --name "Complete Write report $T"`. The header reads `1 task · 0 projects`, and the row shows `Verify`, `Medium`, `Todo` and `30m`. Run `$B snapshot --path $RUN/tasks-new.aria.yml`.
- **Complete.** Run `$B click --role checkbox --name "Complete Write report $T"`. The checkbox becomes `Reopen Write report $T` (checked), and the row's Status is `Completed` with a Completed At time. Run `$B screenshot --path $RUN/tasks-complete.png`.
- **Second view.** Run `$B open /tasks` (reload), then `$B expect --role checkbox --name "Reopen Write report $T"`. Run `$B api GET /tasks --path $RUN/tasks-complete.api.json`. The task has a non-null `completedAt`, and its status name is `Completed`.
- **Reopen.** Run `$B click --role checkbox --name "Reopen Write report $T"`. The checkbox goes back to `Complete Write report $T`, and the Status is `Todo`.

## Gotchas

- `Create task` is disabled while the title is empty. Fill the title before you assert the button.
- Row checkboxes have two names per row: `Select <name>` (bulk selection) and `Complete <name>` / `Reopen <name>` (done state). Use the latter for completion.
- The footer `All local changes synced` means the optimistic edit reached the API. Wait for it before reading back through `$B api`.
- Timestamps in API output carry the server's local offset (for example `+09:00`). Compare dates, not raw strings.
