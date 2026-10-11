import { FolderKanban } from "lucide-react";
import Link from "next/link";
import type { HelpSection } from "../types";
import { Callout, Path, Shot } from "../ui";

export const organize: HelpSection = {
  id: "organize",
  title: "Organize work",
  description: "Workspaces, projects and stages, tasks, and the views that list them.",
  icon: FolderKanban,
  articles: [
    {
      slug: "tasks",
      title: "Tasks",
      summary: "Work and Reminders, their fields, checklists, dependencies and repeats.",
      keywords: ["task", "work", "checklist", "subtask", "repeat", "recurring", "dependency", "blocked", "priority"],
      lead: (
        <p>
          A task in Timely is either <strong>Work</strong>, which takes time and gets scheduled, or a{" "}
          <strong>Reminder</strong>, which is a ping at a set time. Create one with the <strong>+</strong> in
          the sidebar or from search.
        </p>
      ),
      sections: [
        {
          id: "fields",
          title: "What a task holds",
          body: (
            <>
              <Shot
                src="task-detail"
                alt="A task open in the side panel: description editor, checklist, workspace, project, status, stage, priority, duration, dates and its scheduled blocks."
              />
              <ul>
                <li>
                  <strong>Duration</strong>: how long the Work takes. This is what Auto-schedule places.
                </li>
                <li>
                  <strong>Workspace, project, status, stage</strong> and <strong>priority</strong> (Low, Medium, High,
                  Urgent).
                </li>
                <li>
                  <strong>Start date</strong> and <strong>deadline</strong>.
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
            <p>
              Choose a repeat: daily, weekly, weekdays, monthly, yearly, or a custom rule (every few days, certain
              weekdays, the second Tuesday, until a date or a number of times). Each occurrence can be completed,
              skipped or moved on its own, and a change can apply to one occurrence, the ones after it, or all of
              them.
            </p>
          ),
        },
        {
          id: "bulk",
          title: "Change many at once",
          body: (
            <p>
              Select several tasks in a list to complete or reopen them, or set status, priority, project, label or
              deadline together. Bulk changes never schedule; use Auto-schedule for that.
            </p>
          ),
        },
      ],
    },
    {
      slug: "views",
      title: "List, board and Gantt views",
      summary: "Saved views that group, filter and sort your tasks or projects.",
      keywords: ["view", "kanban", "board", "gantt", "timeline", "list", "filter", "group", "sort"],
      lead: (
        <p>
          The <strong>Tasks</strong> page shows your work through saved views. Each view remembers how it looks, what
          it groups by, and which filters are on. Switch views with the tabs at the top.
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
                  <strong>Kanban</strong>: a board with a column per status. Drag a card to change its status.
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
              <li>Group by workspace, project, stage, status, priority, or a custom field.</li>
              <li>
                Filter by workspace, status, project, priority, labels and stage, and show or hide completed, overdue,
                scheduled, repeating or dated work, or reminders.
              </li>
              <li>Sort by name, deadline, start date, created date, priority, status or project.</li>
              <li>Switch a view from tasks to projects to see one row per project.</li>
            </ul>
          ),
        },
        {
          id: "phone",
          title: "On the phone",
          body: (
            <p>
              The phone keeps its own views as a list or board, with the same grouping and filters. Gantt is desktop
              only.
            </p>
          ),
        },
      ],
    },
    {
      slug: "projects",
      title: "Projects and stages",
      summary: "Group related work, track progress, and move tasks through stages.",
      keywords: ["project", "stage", "milestone", "progress", "board", "duplicate"],
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
            <Shot
              src="projects"
              alt="Projects page with four project cards showing workspace, priority, description, open and done counts, and dates."
            />
          ),
        },
        {
          id: "project-page",
          title: "Inside a project",
          body: (
            <>
              <p>
                Open a project for its <strong>Overview</strong>, <strong>Tasks</strong>, <strong>Stages</strong> and{" "}
                <strong>Activity</strong> tabs. From the header you can mark it complete or duplicate it.
              </p>
              <Shot
                src="project"
                alt="A project's Stages tab: four stages with progress bars, and a board of tasks by stage."
              />
            </>
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
      ],
    },
    {
      slug: "workspaces",
      title: "Workspaces",
      summary: "Separate areas of your life, each with its own statuses, labels and custom fields.",
      keywords: ["workspace", "space", "status", "label", "custom field", "taxonomy"],
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
                  name.
                </li>
                <li>
                  <strong>Custom fields</strong>: text, number, date, link, single or multiple choice, and yes/no. Use
                  them as columns and groups in <Link href="/help/organize/views">views</Link>.
                </li>
              </ul>
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
              To stop Auto-schedule placing a workspace&apos;s Work, add it to the excluded workspaces in{" "}
              <Path>Settings &gt; Schedule</Path>.
            </p>
          ),
        },
      ],
    },
  ],
};
