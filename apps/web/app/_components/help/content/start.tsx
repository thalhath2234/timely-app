import { Compass } from "lucide-react";
import Link from "next/link";
import type { HelpSection } from "../types";
import { Callout, Path, PhoneShots, Shot, Steps } from "../ui";

export const start: HelpSection = {
  id: "start",
  title: "Getting started",
  description: "What Timely is, how its loop works, and how to set up your first week.",
  icon: Compass,
  articles: [
    {
      slug: "what-is-timely",
      title: "What is Timely?",
      summary: "A private planner that turns loose thoughts into a planned week, on your own computer.",
      keywords: ["overview", "about", "introduction", "loop"],
      lead: (
        <p>
          Timely is a personal planner with tasks, a calendar, docs, sheets and an assistant in one app. You
          decide what needs doing and how long it takes; Timely finds the time for it on your calendar, around
          your meetings and inside your working hours. It is open source and runs on your own computer, with a
          phone app that connects to it.
        </p>
      ),
      sections: [
        {
          id: "the-loop",
          title: "The loop: capture, clarify, schedule, focus",
          body: (
            <>
              <p>Everything in Timely follows one loop:</p>
              <ol>
                <li>
                  <strong>Capture.</strong> Type a thought into the Inbox the moment it shows up. It needs nothing
                  but a title.
                </li>
                <li>
                  <strong>Clarify.</strong> Later, decide what each Inbox item is: <em>Work</em> (something that
                  takes time, with a length and a workspace) or a <em>Reminder</em> (a ping at a set time).
                </li>
                <li>
                  <strong>Auto-schedule.</strong> Timely places your Work as blocks on the calendar, in free time
                  inside your working hours, ordered by deadline and priority.
                </li>
                <li>
                  <strong>Focus.</strong> Today shows what is next. Start a focus session and the time counts
                  toward the task.
                </li>
              </ol>
              <Shot
                src="calendar"
                alt="Week calendar with work blocks placed around events, and a list of work waiting for a slot."
                caption="Work placed on the week by Auto-schedule, with events and reminders around it."
              />
            </>
          ),
        },
        {
          id: "whats-inside",
          title: "What is inside",
          body: (
            <>
              <ul>
                <li>
                  <strong>Plan:</strong> <Link href="/help/plan/inbox">Inbox and Clarify</Link>,{" "}
                  <Link href="/help/plan/calendar">a calendar</Link> with day, week, month and agenda views,{" "}
                  <Link href="/help/plan/auto-schedule">Auto-schedule</Link>,{" "}
                  <Link href="/help/plan/today">Today with focus, habits and goals</Link>, and{" "}
                  <Link href="/help/plan/reminders">reminders and notifications</Link>.
                </li>
                <li>
                  <strong>Organize:</strong> <Link href="/help/organize/workspaces">workspaces</Link>,{" "}
                  <Link href="/help/organize/projects">projects with stages</Link>,{" "}
                  <Link href="/help/organize/tasks">tasks</Link> with checklists and repeats, and{" "}
                  <Link href="/help/organize/views">list, board and Gantt views</Link>.
                </li>
                <li>
                  <strong>Write:</strong> <Link href="/help/notes/docs">docs</Link> that import and export Markdown,
                  and <Link href="/help/notes/sheets">sheets</Link> with formulas and templates.
                </li>
                <li>
                  <strong>Find and review:</strong> <Link href="/help/notes/search">search</Link> with commands, and
                  a <Link href="/help/notes/dashboard">Dashboard</Link> of cards you arrange.
                </li>
                <li>
                  <strong>Assistant:</strong> an <Link href="/help/assistant/chat">assistant</Link> that runs on{" "}
                  <Link href="/help/assistant/subscriptions">your own Claude or ChatGPT subscription</Link>,{" "}
                  <Link href="/help/assistant/smart-suggestions">smart suggestions</Link>, and an{" "}
                  <Link href="/help/assistant/mcp">MCP server</Link> for your own agents.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "where-it-runs",
          title: "Where it runs",
          body: (
            <>
              <p>
                The desktop app for Windows and Linux carries its own server and its own PostgreSQL database, kept in
                your app data folder. Nothing is sent to a Timely cloud, because there isn&apos;t one. The Android app
                pairs with your computer by QR code and, if you want to use it away from home, reaches it over your
                own Tailscale network.
              </p>
              <p>
                Each account is private. Several people can have accounts on the same computer, but nothing is shared
                between them.
              </p>
              <Callout kind="tip">
                Ready to install? Start with <Link href="/help/install/windows">Windows</Link>,{" "}
                <Link href="/help/install/ubuntu">Ubuntu</Link> or <Link href="/help/install/arch">Arch Linux</Link>,
                then add <Link href="/help/install/android">your Android phone</Link>.
              </Callout>
            </>
          ),
        },
      ],
    },
    {
      slug: "first-week",
      title: "Set up your first week",
      summary: "Create your account, set working hours, capture a few things and let Timely plan them.",
      keywords: ["onboarding", "register", "sign up", "account", "getting started", "workspace"],
      lead: (
        <p>
          Ten minutes from a fresh install to a planned week. This assumes the desktop app is installed; if not,
          see the install guides first.
        </p>
      ),
      sections: [
        {
          id: "create-account",
          title: "Create your account",
          body: (
            <>
              <Steps>
                <p>
                  Open Timely and choose <strong>Register</strong>. Enter your name, email and a password of at least
                  eight characters. The email is only your sign-in name; Timely never sends mail.
                </p>
                <p>
                  Name your first workspace, such as <em>Personal</em> or <em>Work</em>. Workspaces keep their own
                  statuses, labels and fields.
                </p>
                <p>
                  On the desktop app a short setup comes next: reaching Timely from your phone, picking how the assistant
                  thinks, and pairing your phone. Every step can be skipped and changed later in Settings.
                </p>
              </Steps>
              <Callout kind="note">
                Only the first account can sign up on a new install. To let someone else register, turn on{" "}
                <Path>Settings &gt; Server &gt; Allow new accounts</Path> on the desktop app. See{" "}
                <Link href="/help/account/server">Server and accounts</Link>.
              </Callout>
            </>
          ),
        },
        {
          id: "working-hours",
          title: "Set your working hours",
          body: (
            <>
              <p>
                Auto-schedule only places Work inside your working hours. Open <Path>Settings &gt; Schedule</Path>,
                pick your time zone, and set the hours for each day. A day can have more than one window, and a day can
                be off. Without changes, Timely uses Monday to Friday, 09:00 to 17:00.
              </p>
              <Shot
                src="settings-schedule"
                alt="Settings, Schedule tab: time zone and per-day working hours from 9 AM to 5 PM, Saturday and Sunday off."
              />
            </>
          ),
        },
        {
          id: "capture-and-plan",
          title: "Capture, clarify and plan",
          body: (
            <Steps>
              <p>
                Open the <Link href="/help/plan/inbox">Inbox</Link> (<kbd>g</kbd> then <kbd>i</kbd>) and type
                everything on your mind, one item per line.
              </p>
              <p>
                Click an item to <strong>Clarify</strong> it. Choose <strong>Work</strong>, pick a workspace and
                set how long it takes; add a deadline or priority if it has one. Or choose <strong>Reminder</strong>{" "}
                and set when Timely should ping you.
              </p>
              <p>
                Add your fixed appointments as events on the <Link href="/help/plan/calendar">calendar</Link>.
              </p>
              <p>
                Press <strong>Auto-schedule</strong> on the calendar, look over the changes, and apply them.
              </p>
            </Steps>
          ),
        },
        {
          id: "next-steps",
          title: "Next steps",
          body: (
            <ul>
              <li>
                Star up to seven tasks for today on <Link href="/help/plan/today">Today</Link>.
              </li>
              <li>
                Install <Link href="/help/install/android">the Android app</Link> and pair it with your computer.
              </li>
              <li>
                Add an API key in <Path>Settings &gt; Agent</Path> to use the{" "}
                <Link href="/help/assistant/chat">assistant</Link> and{" "}
                <Link href="/help/assistant/smart-suggestions">smart suggestions</Link>.
              </li>
            </ul>
          ),
        },
      ],
    },
    {
      slug: "phone-app",
      title: "Timely on your phone",
      summary: "What the Android app does: Home, Calendar, Tasks, Search and Files, plus the pinch assistant.",
      keywords: ["mobile", "android", "phone", "app", "offline", "pinch"],
      lead: (
        <p>
          The Android app is a full Timely client with a compact layout. It connects to the Timely server on your
          computer, so everything you change shows up on both. To install and pair it, see{" "}
          <Link href="/help/install/android">Install on Android</Link>.
        </p>
      ),
      sections: [
        {
          id: "tabs",
          title: "The five tabs",
          body: (
            <>
              <ul>
                <li>
                  <strong>Home:</strong> today&apos;s habits and goals, the Inbox count, your Today focus list and
                  what is on the calendar.
                </li>
                <li>
                  <strong>Calendar:</strong> day, week, agenda and month views, with Auto-schedule in the header.
                </li>
                <li>
                  <strong>Tasks:</strong> your saved views as a list or board, with filters, grouping and bulk actions.
                </li>
                <li>
                  <strong>Search:</strong> the same search and commands as <kbd>Ctrl</kbd>+<kbd>K</kbd> on the desktop.
                </li>
                <li>
                  <strong>Files:</strong> docs and sheets, with a nested page tree, favourites and Markdown import.
                </li>
              </ul>
              <PhoneShots
                shots={[
                  { src: "phone-home", alt: "Phone Home tab with habits, goals, Inbox count and Today focus." },
                  { src: "phone-calendar", alt: "Phone Calendar tab in agenda view with today's items." },
                  { src: "phone-tasks", alt: "Phone Tasks tab listing work grouped by workspace and project." },
                ]}
              />
            </>
          ),
        },
        {
          id: "quick-add",
          title: "Quick add and the assistant",
          body: (
            <p>
              The round <strong>+</strong> button adds an Inbox item, task, reminder, event, doc or sheet. Pinch inward
              with two fingers anywhere to open the assistant about what is on screen; it can also read a photo of a
              receipt into fields.
            </p>
          ),
        },
        {
          id: "offline",
          title: "When the computer is out of reach",
          body: (
            <p>
              The phone shows a clear offline banner and the last data it saw. Some changes, such as completing a task
              or ticking a checklist item, wait in a queue and are sent when the connection is back. Editing docs and
              sheets and chatting with the assistant need a connection. Reminders you already have still fire, because
              the phone schedules them itself.
            </p>
          ),
        },
      ],
    },
    {
      slug: "shortcuts",
      title: "Keyboard shortcuts",
      summary: "Every keyboard shortcut in the desktop and web app.",
      keywords: ["keyboard", "hotkeys", "keys", "shortcut"],
      lead: <p>Most of Timely can be driven from the keyboard. On a Mac, use Cmd where this page says Ctrl.</p>,
      sections: [
        {
          id: "everywhere",
          title: "Everywhere",
          body: (
            <table>
              <thead>
                <tr>
                  <th>Keys</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <kbd>Ctrl</kbd> <kbd>K</kbd> or <kbd>/</kbd>
                  </td>
                  <td>Search and run a command</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>J</kbd>
                  </td>
                  <td>Quick prompt: ask the assistant from a bar at the bottom</td>
                </tr>
                <tr>
                  <td>
                    <kbd>c</kbd> or <kbd>n</kbd>
                  </td>
                  <td>New task (in the Inbox, <kbd>c</kbd> jumps to the capture box)</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Esc</kbd>
                  </td>
                  <td>Close a panel or dialog</td>
                </tr>
              </tbody>
            </table>
          ),
        },
        {
          id: "go-to",
          title: "Go to a page",
          body: (
            <>
              <p>
                Press <kbd>g</kbd>, then:
              </p>
              <table>
                <tbody>
                  {[
                    ["a", "Chat"],
                    ["y", "Today"],
                    ["i", "Inbox"],
                    ["c", "Calendar"],
                    ["t", "Tasks"],
                    ["p", "Projects"],
                    ["d", "Dashboard"],
                    ["f", "Files"],
                    ["n", "Notifications"],
                  ].map(([key, page]) => (
                    <tr key={key}>
                      <td>
                        <kbd>g</kbd> <kbd>{key}</kbd>
                      </td>
                      <td>{page}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ),
        },
        {
          id: "tasks-and-editors",
          title: "Tasks, docs and sheets",
          body: (
            <table>
              <tbody>
                <tr>
                  <td>
                    <kbd>x</kbd>
                  </td>
                  <td>On Tasks, complete the open task (with Undo)</td>
                </tr>
                <tr>
                  <td>
                    <kbd>s</kbd>
                  </td>
                  <td>On Tasks, schedule the open task on the calendar</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Ctrl</kbd> <kbd>Enter</kbd>
                  </td>
                  <td>Post a comment on a task</td>
                </tr>
                <tr>
                  <td>
                    <kbd>/</kbd> and <kbd>@</kbd>
                  </td>
                  <td>In a doc, open the block menu or mention a doc, sheet, task or project</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Enter</kbd> or <kbd>F2</kbd>
                  </td>
                  <td>In a sheet, edit the selected cell; arrows and <kbd>Tab</kbd> move</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Ctrl</kbd> <kbd>T</kbd>, <kbd>Ctrl</kbd> <kbd>W</kbd>, <kbd>Ctrl</kbd> <kbd>Tab</kbd>
                  </td>
                  <td>Open, close and switch doc and sheet tabs in the desktop app</td>
                </tr>
              </tbody>
            </table>
          ),
        },
      ],
    },
  ],
};
