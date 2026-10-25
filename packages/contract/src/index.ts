/**
 * Shared JSON contract for Timely clients.
 *
 * Wire types mirror the JSON the Go API sends (json tags in
 * `apps/api/internal/models` and the handler DTOs). Where the web and mobile
 * apps disagree, the server wins. One hand-maintained file per domain, no
 * code generation; see the `exports` map in package.json:
 *
 *   entities       Workspace, Project, Task, recurrence, blocks, events
 *   calendar       CalendarItem, CalendarRange, TodayResponse, activity feeds
 *   schedule       working hours, auto-schedule plan
 *   notifications  notifications, jobs
 *   documents      Doc and the rich-text shapes
 *   sheet          Sheet, SheetTemplate and cell formats (cell logic: sheet*.ts)
 *   account        User, ApiKey, DeviceSession
 *   config         Config and saved task views
 *   dashboard      Dashboard layout, card queries and the card engine
 *   starterLabels  onboarding's starter labels split across new workspaces
 *   taskQuery      view rules and the shared filter, sort and group engine
 *   ruleBuilder    the fields, conditions and values the Tasks rule builder offers
 *   viewLanguage   plain words read into a task view, and views read back as words
 *   viewSearch     search finding a saved task view by its name
 *   projectDelete  the confirm before deleting a project and its tasks
 *   bulkEdit       bulk task edits: per-task Undo, adding a label by name
 *   genui          reply cards: the OpenUI components the agent may use in a reply
 */

/**
 * What a task row is. Task JSON always includes `kind`. "task" is the wire
 * value for Work (schedulable work, see CONTEXT.md); the others are a timed
 * "reminder" ping and an unprocessed "inbox" capture.
 */
export type TaskKind = "task" | "reminder" | "inbox";
