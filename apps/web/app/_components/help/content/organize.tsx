import { FolderKanban } from "lucide-react";
import Link from "next/link";
import type { HelpSection } from "../types";
import { Callout, HelpLink, Path, Shot } from "../ui";

export const organize: HelpSection = {
  id: "organize",
  title: "Organize work",
  description: "Workspaces, projects and stages, tasks, and the views that list them.",
  icon: FolderKanban,
  articles: [
    {
      slug: "tasks",
      title: "Tasks",
      summary: "Work and Reminders, the create form, their fields, checklists, dependencies, repeats and bulk edits.",
      keywords: [
        "task",
        "work",
        "checklist",
        "subtask",
        "repeat",
        "recurring",
        "dependency",
        "blocked",
        "priority",
        "create",
        "new task",
        "more options",
        "comment",
        "activity",
        "bulk edit",
        "select",
        "undo",
        "set label",
      ],
      lead: (
        <p>
          A task in Timely is either <strong>Work</strong>, which takes time and gets scheduled, or a{" "}
          <strong>Reminder</strong>, which is a ping at a set time. Create one with the <strong>+</strong> in
          the sidebar or from search.
        </p>
      ),
      sections: [
        {
          id: "create",
          title: "Create a task",
          body: (
            <>
              <p>
                The <strong>+</strong> opens the create form. The kind chip at the top switches between{" "}
                <strong>Task</strong>, <strong>Reminder</strong>, <strong>Event</strong>, <strong>Doc</strong>,{" "}
                <strong>Sheet</strong>, <strong>Project</strong> and <strong>Workspace</strong>, and keeps the title
                you already typed.
              </p>
              <p>
                Under the title and notes, a task&apos;s fields are rows with the name on the left and the value on
                the right: <strong>Workspace</strong>, <strong>Project</strong>, <strong>Stage</strong> (when the
                project has stages), <strong>Status</strong>, <strong>Priority</strong> and <strong>Duration</strong>,
                then <strong>Deadline</strong>, <strong>Schedule</strong>, <strong>Repeat</strong> and{" "}
                <strong>Start date</strong>. <strong>More options</strong> opens labels and custom fields. The footer
                sums up what you are about to create.
              </p>
              <Shot
                src="task-create"
                alt="The create form set to Task: a title and notes, then grouped rows for Workspace, Project, Status, Priority and Duration beside Deadline, Schedule, Repeat and Start date, More options, and a Create task button."
              />
              <p>
                On the phone, the <strong>+</strong> button opens one sheet with the same kind chip (plus{" "}
                <strong>Inbox</strong>), a large title, notes and the same rows. Each row opens its picker in the
                sheet, and <strong>More options</strong> holds the Auto-schedule window, labels and fields.
              </p>
            </>
          ),
        },
        {
          id: "fields",
          title: "What a task holds",
          body: (
            <>
              <Shot
                src="task-detail"
                alt="A task open in its panel: title, description, Focus Now, Today Focus and Duplicate, checklist and activity on the left; on the right grouped rows for Type, Workspace, Status, Priority, Project, Stage, Blocked by, Duration and Labels, then Dates, Schedule and Auto-schedule."
              />
              <p>
                Click a task to open its panel. Next to the notes, checklist and <strong>Activity</strong>, cards of
                rows hold everything else: <strong>Type</strong> (Work or Reminder), workspace, status, priority,
                project, stage, <strong>Blocked by</strong>, duration and labels; a <strong>Dates</strong> card; the{" "}
                <strong>Schedule</strong> card with its reserved times; and custom fields. Click a value to change
                it. The phone&apos;s task screen uses the same rows.
              </p>
              <ul>
                <li>
                  <strong>Duration</strong>: how long the Work takes. This is what Auto-schedule places.
                </li>
                <li>
                  <strong>Workspace, project, status, stage</strong> and <strong>priority</strong> (Low, Medium, High,
                  Urgent).
                </li>
                <li>
                  <strong>Start date</strong> and <strong>deadline</strong>. A deadline can&apos;t be before the start
                  date.
                </li>
                <li>
                  <strong>Labels</strong> and any custom fields your workspace has.
                </li>
                <li>A rich-text description, comments and an activity history of every change.</li>
              </ul>
            </>
          ),
        },
        {
          id: "checklists",
          title: "Checklists",
          body: (
            <p>
              Break a task into steps with its checklist. Checklist items are ticked off inside the task and are not
              scheduled on their own; the task&apos;s duration covers them all.
            </p>
          ),
        },
        {
          id: "dependencies",
          title: "Blocked by",
          body: (
            <p>
              Set <strong>Blocked by</strong> when a task can&apos;t start until another is done. Auto-schedule places
              the blocking task first, and the blocking task lists what is waiting on it.
            </p>
          ),
        },
        {
          id: "repeat",
          title: "Repeating tasks",
          body: (
            <>
              <p>
                The <strong>Repeat</strong> row offers <strong>Daily</strong>, <strong>Weekly</strong>,{" "}
                <strong>Every weekday</strong>, <strong>Monthly</strong>, <strong>Yearly</strong> and{" "}
                <strong>Custom…</strong>. Custom adds rows in the same card: <strong>Every</strong> so many days,
                weeks, months or years, <strong>On</strong> which weekdays, <strong>By</strong> date or weekday for
                monthly rules, and <strong>Ends</strong> never, on a date, or after a number of times.
              </p>
              <p>
                Each occurrence can be completed, skipped or moved on its own, and a change can apply to one
                occurrence, the ones after it, or all of them.
              </p>
            </>
          ),
        },
        {
          id: "bulk",
          title: "Change many at once",
          body: (
            <>
              <p>
                Select several tasks in a list to <strong>Complete</strong> or <strong>Reopen</strong> them, set
                status, priority or project, <strong>Set label</strong>, <strong>Set deadline</strong>, or delete
                them. On the phone, press and hold a task to start selecting.
              </p>
              <ul>
                <li>The message after each change has Undo, which puts back each task&apos;s own previous value.</li>
                <li>
                  <strong>Set label</strong> adds the label to the labels each task already has. It uses the label of
                  that name in each task&apos;s workspace and skips tasks whose workspace has none.
                </li>
                <li>Bulk changes never schedule; use Auto-schedule for that.</li>
              </ul>
            </>
          ),
        },
      ],
    },
    {
      slug: "views",
      title: "List, board and Gantt views",
      summary: "Saved views that filter, group and sort your tasks or projects, set by hand or described in words.",
      keywords: [
        "view",
        "kanban",
        "board",
        "gantt",
        "timeline",
        "list",
        "filter",
        "group",
        "sort",
        "rules",
        "describe",
        "natural language",
        "save as view",
        "preview",
        "customize view",
        "then by",
        "limit",
        "match",
      ],
      lead: (
        <p>
          The <strong>Tasks</strong> page shows your work through saved views. Each view remembers how it looks, what
          it groups by, and which filters are on. Switch views with the tabs at the top. You can keep up to 20.
        </p>
      ),
      sections: [
        {
          id: "layouts",
          title: "Three layouts",
          body: (
            <>
              <ul>
                <li>
                  <strong>List</strong>: rows with columns you can drag into any order, grouped up to three levels
                  deep.
                </li>
                <li>
                  <strong>Kanban</strong>: a board with a column per status, or per priority, workspace, project or
                  stage when the view groups by one of those first. Drag a card to another column to change it; the
                  message that follows has Undo.
                </li>
                <li>
                  <strong>Gantt</strong>: bars on a timeline from start date and blocks to deadline. Drag an undated
                  task onto the timeline to give it dates.
                </li>
              </ul>
              <Shot src="tasks" alt="Tasks page in List layout grouped by workspace, project and stage." caption="List" />
              <Shot src="tasks-kanban" alt="Tasks page in Kanban layout with Studio and Personal columns of cards." caption="Kanban" />
              <Shot src="tasks-gantt" alt="Tasks page in Gantt layout with coloured bars over two weeks." caption="Gantt" />
            </>
          ),
        },
        {
          id: "customize",
          title: "Group, filter and sort",
          body: (
            <ul>
              <li>
                <strong>Group</strong> by workspace, project, stage, status, priority, label, deadline, planned day,
                start date, created, updated, completed, effort, done or open, repeating, or a custom field.{" "}
                <strong>Order groups</strong> sets the order of the groups themselves.
              </li>
              <li>
                Filter by status, workspace, project, priority, label and stage, and tick <strong>Overdue</strong>,{" "}
                <strong>Show completed</strong>, <strong>Scheduled</strong>, <strong>Recurring</strong> or{" "}
                <strong>Dated only</strong>.
              </li>
              <li>
                <strong>Sort</strong> opens one panel: <strong>Sort by</strong> (name, dates, priority, urgency,
                status, stage, project, duration, time tracked, checklist progress and more), a second sort under{" "}
                <strong>Then by</strong>, and <strong>Show</strong> all rows or only the first few.
              </li>
              <li>Switch a view from tasks to reminders or projects; projects show one row per project.</li>
            </ul>
          ),
        },
        {
          id: "rules",
          title: "Filters in words",
          body: (
            <>
              <p>
                Under the options, the rules row has a <strong>Describe what to show</strong> box. Type something
                like &ldquo;urgent bugs due this week&rdquo; and press <kbd>Enter</kbd>: the words replace the
                view&apos;s filters, and sort, groups, layout and limit change only when you name them. With an AI
                provider set up, <strong>Read with AI</strong> reads the words the plain reading left over.
              </p>
              <ul>
                <li>Each filter shows as a chip. Click it to change the field, condition or value, or remove it.</li>
                <li>
                  <strong>Add filter</strong> lists every field you can filter by, custom fields included.
                </li>
                <li>
                  With two or more filters, <strong>Match</strong> <strong>All</strong> or <strong>Any</strong> sets
                  whether a task must pass every filter or just one.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "from-search",
          title: "Views from search",
          body: (
            <>
              <p>
                In <HelpLink href="/help/notes/search">search</HelpLink>, words that describe a list, such as
                &ldquo;show task deadline&rdquo;, show a row with how many tasks match and the first few. Choose it
                to open the list on the Tasks page as a <strong>Preview</strong>, then <strong>Save as view</strong>{" "}
                to keep it or <strong>Close</strong> to drop it. Words that ask for a view, such as &ldquo;make a view
                of urgent tasks&rdquo;, offer <strong>Create view</strong>, which saves it straight away.
              </p>
              <p>
                Search also finds your saved views by name: &ldquo;my deadlines&rdquo; offers{" "}
                <strong>Open view</strong> for a view called My Deadlines. Both work the same on the phone.
              </p>
            </>
          ),
        },
        {
          id: "phone",
          title: "On the phone",
          body: (
            <>
              <p>
                The phone keeps its own views as a <strong>List</strong> or <strong>Board</strong>. The{" "}
                <strong>Customize view</strong> button in the Tasks header opens a sheet with three cards:
              </p>
              <ul>
                <li>
                  <strong>Filters</strong>: describe the view in words and tap <strong>Apply</strong>, edit or
                  remove each filter, <strong>Add filter</strong>, and choose whether every filter or any must match.
                </li>
                <li>
                  <strong>Arrange</strong>: <strong>Layout</strong>, <strong>Show</strong> (tasks, reminders or
                  projects), <strong>Limit</strong>, <strong>Group by</strong> and <strong>Sort</strong> with a{" "}
                  <strong>Then by</strong>.
                </li>
                <li>
                  <strong>Narrow down</strong>: workspace, project, status, priority, labels and stage, the quick
                  toggles, and <strong>Show completed tasks</strong>.
                </li>
              </ul>
              <p>
                On a board, drag a card by its handle at the right edge to another column. The board scrolls
                sideways when you near the edge, and the message that follows has Undo. Cards, columns and group
                headers use the project, workspace, stage or priority colour, as on the desktop. Gantt is desktop
                only.
              </p>
            </>
          ),
        },
      ],
    },
    {
      slug: "projects",
      title: "Projects and stages",
      summary: "Group related work, track progress and activity, and move tasks through stages.",
      keywords: ["project", "stage", "milestone", "progress", "board", "duplicate", "activity", "colour", "new project", "delete"],
      lead: (
        <p>
          A project collects related tasks inside a workspace, with its own dates, priority, colour and description.
          The <strong>Projects</strong> page shows every project as a card with its progress.
        </p>
      ),
      sections: [
        {
          id: "hub",
          title: "The Projects page",
          body: (
            <>
              <Shot
                src="projects"
                alt="Projects page: one row per project with workspace, description, stage strip, progress, open and done counts, deadline and priority, and a panel of planned hours and deadlines on the right."
              />
              <p>
                To start one, choose <strong>Project</strong> in the <strong>+</strong> dialog. Its rows cover{" "}
                <strong>Workspace</strong>, <strong>Status</strong>, <strong>Priority</strong>,{" "}
                <strong>Colour</strong>, <strong>Start date</strong>, <strong>Deadline</strong> and a{" "}
                <strong>Stages</strong> switch.
              </p>
            </>
          ),
        },
        {
          id: "project-page",
          title: "Inside a project",
          body: (
            <>
              <p>
                Open a project for its <strong>Overview</strong>, <strong>Tasks</strong>, <strong>Stages</strong> and{" "}
                <strong>Activity</strong> tabs. The Overview shows what is <strong>Up next</strong> and{" "}
                <strong>Recent changes</strong>. From the header you can <strong>Mark complete</strong>,{" "}
                <strong>Duplicate</strong> or delete it.
              </p>
              <Shot
                src="project"
                alt="A project's Stages tab: four stages with progress bars, and a board of tasks by stage."
              />
              <Callout kind="warning">
                Deleting a project deletes its tasks and stages with it. The confirmation says how many.
              </Callout>
            </>
          ),
        },
        {
          id: "activity",
          title: "Activity",
          body: (
            <p>
              The <strong>Activity</strong> tab lists status, priority, stage, schedule, comment and completion
              changes on every task in the project. Click an entry to open its task. Edits to the
              project&apos;s own title, dates and description are not recorded yet.
            </p>
          ),
        },
        {
          id: "stages",
          title: "Stages",
          body: (
            <p>
              Stages split a project into phases such as Plan, Design, Build and Launch. Add, rename, colour and
              reorder them on the Stages tab, then drag tasks between them on the stage board. Task lists can group by
              stage too.
            </p>
          ),
        },
        {
          id: "phone",
          title: "On the phone",
          body: (
            <>
              <p>
                <Path>Settings &gt; Projects</Path> lists your projects. <strong>New project</strong> opens a sheet
                with the title, <strong>Workspace</strong>, <strong>Start date</strong> and{" "}
                <strong>Deadline</strong>.
              </p>
              <p>
                A project&apos;s screen starts with its title and one card of rows: <strong>Status</strong>,{" "}
                <strong>Priority</strong>, <strong>Start date</strong>, <strong>Deadline</strong>,{" "}
                <strong>Colour</strong> and <strong>Stages</strong>. Below are the description, its tasks (add one
                inline, or use <strong>Full composer</strong> for dates, labels and repeat), and an{" "}
                <strong>Activity</strong> card. <strong>Done</strong> in the header marks it complete.
              </p>
              <p>
                <strong>Project settings</strong> in the header turns stages on, lists them to reorder, rename or
                delete, adds a <strong>New stage</strong>, and has <strong>Duplicate project</strong> (copies its
                stages and tasks) and <strong>Delete project</strong>.
              </p>
            </>
          ),
        },
      ],
    },
    {
      slug: "workspaces",
      title: "Workspaces",
      summary: "Separate areas of your life, each with its own statuses, labels and custom fields.",
      keywords: ["workspace", "space", "status", "label", "custom field", "taxonomy", "colour", "color"],
      lead: (
        <p>
          Workspaces keep areas of your life apart, for example <em>Personal</em> and <em>Work</em>. Every task and
          project belongs to one. You can have as many as you like; they are all private to your account.
        </p>
      ),
      sections: [
        {
          id: "manage",
          title: "Create and manage",
          body: (
            <>
              <p>
                Create a workspace from the <strong>+</strong> in the sidebar or in{" "}
                <Path>Settings &gt; Workspaces</Path>, where you can also rename it, pick its colour, or delete it
                (except the last one).
              </p>
              <Shot src="settings-workspaces" alt="Settings, Workspaces tab with Name, Status, Labels and Custom fields tabs." />
              <p>
                On the phone, <Path>Settings &gt; Workspaces</Path> lists them with a <strong>New workspace</strong>{" "}
                row. A workspace&apos;s page shows its name, cards for <strong>Statuses</strong>,{" "}
                <strong>Labels</strong> and <strong>Custom fields</strong>, its projects with a{" "}
                <strong>New project</strong> row, and <strong>Delete workspace</strong>. Tap a card to see its items
                and edit one.
              </p>
            </>
          ),
        },
        {
          id: "statuses-labels",
          title: "Statuses, labels and custom fields",
          body: (
            <>
              <ul>
                <li>
                  <strong>Statuses</strong>: new workspaces start with Backlog, Todo, In Progress, Blocked, Completed
                  and Canceled. Rename, recolour and add your own.
                </li>
                <li>
                  <strong>Labels</strong>: coloured tags. Different workspaces can each have a label with the same
                  name, but one workspace can&apos;t have two labels with the same name, whatever the capitals.
                </li>
                <li>
                  <strong>Custom fields</strong>: text, number, date, link, single or multiple choice, and yes/no. Use
                  them as columns and groups in <Link href="/help/organize/views">views</Link>.
                </li>
              </ul>
              <p>
                On the phone, statuses, labels, field options, projects and stages pick from the same 12 named
                colours. A colour picked outside that set on the desktop shows as <strong>Custom</strong>.
              </p>
              <Callout kind="tip">
                Labels and custom fields can be created right from the task form while you fill it in.
              </Callout>
            </>
          ),
        },
        {
          id: "auto-schedule",
          title: "Keep a workspace off the calendar",
          body: (
            <p>
              To stop Auto-schedule placing a workspace&apos;s Work, add it under{" "}
              <strong>Exclude workspaces from auto-schedule</strong> in <Path>Settings &gt; Schedule</Path>.
            </p>
          ),
        },
      ],
    },
  ],
};
