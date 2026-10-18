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
      keywords: ["overview", "about", "introduction", "loop", "features", "widgets", "card workshop", "help me write", "jev", "mcp"],
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
                  with <strong>Help me write</strong> in the <kbd>/</kbd> menu to draft a passage, and{" "}
                  <Link href="/help/notes/sheets">sheets</Link> with formulas and templates.
                </li>
                <li>
                  <strong>Find and review:</strong> <Link href="/help/notes/search">search</Link> with commands, and
                  a <Link href="/help/notes/dashboard">Dashboard</Link> of cards you arrange. The{" "}
                  <strong>Card workshop</strong> builds your own cards, including cards that read cells from a sheet
                  or a checklist from a doc.
                </li>
                <li>
                  <strong>Phone:</strong> <Link href="/help/start/phone-app">an Android app</Link> with{" "}
                  <Link href="/help/start/widgets">home-screen widgets</Link> for Today, quick add, a pomodoro, a
                  timer and any Dashboard card.
                </li>
                <li>
                  <strong>Assistant:</strong> an <Link href="/help/assistant/chat">assistant</Link> that runs on{" "}
                  <Link href="/help/assistant/subscriptions">your own Claude or ChatGPT subscription</Link> or an API
                  key, and an <Link href="/help/assistant/mcp">MCP server</Link> so your own agents can work with your
                  tasks, calendar, docs and sheets.
                </li>
                <li>
                  <strong>Smart suggestions:</strong>{" "}
                  <Link href="/help/assistant/smart-suggestions">small hints</Link> from Jev, TypeSafe&apos;s decision
                  model, such as filling in the Clarify form. They use a TypeSafe or OpenRouter key. Without a key,
                  Timely works the same, minus the hints.
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
      summary: "Create your account, pick what Timely is for, set working hours, and let Timely plan your first items.",
      keywords: [
        "onboarding",
        "register",
        "sign up",
        "create account",
        "account",
        "getting started",
        "workspace",
        "starter labels",
        "setup",
        "first run",
      ],
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
                  Open Timely. On the sign-in page, choose <strong>Register</strong> or{" "}
                  <strong>Create an account</strong>. Enter your name, email and a password of at least eight
                  characters, then choose <strong>Create account</strong>. The email is only your sign-in name; Timely
                  never sends mail.
                </p>
                <p>
                  <strong>What fills your days?</strong> Pick any that fit, such as <em>Work and projects</em>,{" "}
                  <em>Personal life</em> or <em>Study</em>. Timely offers <strong>Starter labels</strong> to match; tap
                  a label to leave it out. Choose <strong>Continue</strong>, or <strong>Skip for now</strong>.
                </p>
                <p>
                  Name your first workspace, or tap one of the <strong>Suggested names</strong>. Under{" "}
                  <strong>Also create</strong> you can add a workspace for each of your other picks, each with its own
                  labels. Choose <strong>Create workspace</strong>.
                </p>
                <div>
                  <p>On the desktop app a short setup comes next, one step at a time:</p>
                  <ul>
                    <li>
                      <strong>Reach Timely from anywhere:</strong> turn on Tailscale access so your phone can reach
                      the computer away from home.
                    </li>
                    <li>
                      <strong>Choose how the assistant thinks:</strong> paste an <strong>OpenRouter API key</strong>{" "}
                      and choose <strong>Save key</strong>, right in the step. Keys from Anthropic, OpenAI, Gemini and
                      others go under <strong>More API keys</strong>.
                    </li>
                    <li>
                      <strong>Use Claude Code or Codex:</strong> use your Claude or ChatGPT subscription instead of a
                      key. Install the CLI, sign in from a terminal, then choose <strong>Re-scan</strong>.
                    </li>
                    <li>
                      <strong>Pair your phone:</strong> scan the QR code with the Android app.
                    </li>
                  </ul>
                  <p>
                    Choose <strong>Next</strong> or <strong>Skip</strong> on each step and <strong>Finish</strong> at
                    the end. If you close Timely before <strong>Finish</strong>, the setup opens again the next time
                    you start it. You can change all of it later in Settings.
                  </p>
                </div>
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
                Open the <Link href="/help/plan/inbox">Inbox</Link> and type
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
                Install <Link href="/help/install/android">the Android app</Link>, pair it with your computer, and add
                a few <Link href="/help/start/widgets">home-screen widgets</Link>.
              </li>
              <li>
                Set up the <Link href="/help/assistant/chat">assistant</Link> in <Path>Settings &gt; Agent</Path>{" "}
                with <Link href="/help/assistant/subscriptions">your Claude or ChatGPT subscription</Link> or an API
                key. A TypeSafe or OpenRouter key also turns on{" "}
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
      summary:
        "What the Android app does: Home, Dashboard, Calendar, Tasks, Search and Files, the back gesture, settings and the pinch assistant.",
      keywords: [
        "mobile",
        "android",
        "phone",
        "app",
        "offline",
        "pinch",
        "tab bar",
        "back",
        "back gesture",
        "predictive back",
        "settings",
        "preparing timely",
        "shortcuts",
        "live notification",
      ],
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
          title: "The tab bar",
          body: (
            <>
              <p>
                The bar at the bottom shows icons only. From left to right:
              </p>
              <ul>
                <li>
                  <strong>Home</strong> (a house), titled <em>Today</em>: habits and goals, the Inbox count, your Today
                  focus list, today&apos;s schedule and End of day. The bell and the gear at the top open
                  notifications and Settings.
                </li>
                <li>
                  <strong>Dashboard</strong> (four squares): your Dashboard cards. <strong>Add card</strong> (the{" "}
                  <strong>+</strong> in the header) adds one, and <strong>Edit dashboard</strong> (the pencil) lets you
                  drag a card by its grip to move it. Card sizes and the Card workshop are on the desktop and web app.
                </li>
                <li>
                  <strong>Calendar:</strong> day, week, agenda and month views, with Auto-schedule in the header.
                </li>
                <li>
                  <strong>Tasks</strong> (a checklist): your saved views as a list or board, with filters, grouping
                  and bulk actions.
                </li>
                <li>
                  <strong>Search</strong> (a magnifier): the same search and commands as <kbd>Ctrl</kbd>+<kbd>K</kbd>{" "}
                  on the desktop.
                </li>
                <li>
                  <strong>Files</strong> (a page): docs and sheets, with a nested page tree, favourites and Markdown
                  import.
                </li>
              </ul>
              <p>Screen readers read each icon&apos;s name.</p>
              <PhoneShots
                shots={[
                  {
                    src: "phone-home",
                    alt: "Phone Home tab titled Today: habits and goals, Inbox, Today focus, Schedule, End of day and a Meet your assistant tip about pinching, with the icon-only tab bar at the bottom.",
                  },
                  {
                    src: "phone-calendar",
                    alt: "Phone Calendar tab in agenda view with today's items, from an older version with a labelled five-tab bar.",
                  },
                  {
                    src: "phone-tasks",
                    alt: "Phone Tasks tab listing work grouped by workspace and project, from an older version with a labelled five-tab bar.",
                  },
                ]}
              />
            </>
          ),
        },
        {
          id: "quick-add",
          title: "Quick add and the assistant",
          body: (
            <>
              <p>
                The round <strong>+</strong> button adds an Inbox item, task, reminder, event, doc or sheet. It is
                hidden on Search, and on Dashboard, which has its own <strong>Add card</strong> button.
              </p>
              <p>
                Pinch inward with two fingers anywhere to open the assistant. A new chat starts with the screen you
                pinched on as its context, such as the task, doc or calendar day you were looking at, so you can ask
                about it straight away. The assistant can also read a photo of a receipt into fields.
              </p>
            </>
          ),
        },
        {
          id: "back",
          title: "Going back",
          body: (
            <>
              <p>
                Swipe in from the left or right edge, or use Android&apos;s Back button. As you swipe, the screen you
                are going back to shows behind the current one. Once the screen slides away, letting go goes back;
                move your finger back toward the edge to cancel.
              </p>
              <ul>
                <li>On a pushed screen, such as a task or a doc, Back returns to the screen before it.</li>
                <li>
                  A screen opened from a widget, a shortcut or a notification has nothing behind it, so Back takes you
                  to the tab or list it belongs to instead of closing the app.
                </li>
                <li>On any other tab, Back goes to Home. Only Back on Home leaves Timely.</li>
              </ul>
            </>
          ),
        },
        {
          id: "settings",
          title: "Settings on the phone",
          body: (
            <>
              <p>
                Tap the gear on Home. Your name and email at the top open your account. Below them, settings are
                grouped:
              </p>
              <ul>
                <li>
                  <strong>Make it yours:</strong> appearance.
                </li>
                <li>
                  <strong>Organize:</strong> Inbox, Notifications, Projects and Workspaces.
                </li>
                <li>
                  <strong>Desktop:</strong> Server, the computer the phone is paired with.
                </li>
                <li>
                  <strong>Preferences &amp; tools:</strong> Notification settings, Working hours, Data &amp; backups,
                  Agent and API keys.
                </li>
              </ul>
              <p>
                <strong>Sign out</strong> is at the bottom.
              </p>
            </>
          ),
        },
        {
          id: "widgets-and-shortcuts",
          title: "Widgets, shortcuts and the live notification",
          body: (
            <p>
              Timely adds widgets to your home screen, shortcuts to its app icon, and one ongoing notification while
              a focus session or pomodoro runs. See <Link href="/help/start/widgets">Home-screen widgets</Link>.
            </p>
          ),
        },
        {
          id: "starting-up",
          title: "Starting up",
          body: (
            <p>
              When you open the app, it shows <strong>Preparing Timely</strong> while it loads your account and the
              first screen. If the computer is slow to answer, the app opens after about three seconds with what it
              saw last and fills in when the data arrives. It also loads the data your Dashboard cards read, so the
              Dashboard tab opens filled in.
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
      slug: "widgets",
      title: "Home-screen widgets",
      summary:
        "Add Today, Quick add, Pomodoro, Timer and any Dashboard card to your Android home screen, plus app shortcuts and the live notification.",
      keywords: [
        "widget",
        "widgets",
        "home screen",
        "android",
        "pomodoro",
        "timer",
        "stopwatch",
        "quick add",
        "counter",
        "shortcuts",
        "long press",
        "live notification",
        "autostart",
        "battery",
        "xiaomi",
        "hyperos",
      ],
      lead: (
        <p>
          The Android app puts Timely on your home screen. Widgets show your day and your Dashboard cards, and many
          of their buttons work without opening the app. Light and dark follow your phone.
        </p>
      ),
      sections: [
        {
          id: "which",
          title: "The widgets",
          body: (
            <>
            <ul>
              <li>
                <strong>Today:</strong> what you are focusing on and what is next on your calendar. Tick a task to
                complete it.
              </li>
              <li>
                <strong>Quick add:</strong> a bar with four buttons: <strong>Task</strong> adds a task,{" "}
                <strong>Capture</strong> adds to the Inbox, <strong>Ask</strong> opens the assistant in a new chat,
                and <strong>Search</strong> opens search.
              </li>
              <li>
                <strong>Pomodoro:</strong> a pomodoro of its own. Pick <strong>Focus</strong>,{" "}
                <strong>Short</strong> or <strong>Long</strong>, set the length with <strong>−</strong> and{" "}
                <strong>+</strong> a minute at a time, then <strong>Start</strong>.
              </li>
              <li>
                <strong>Timer:</strong> a <strong>Stopwatch</strong> or a countdown <strong>Timer</strong> that runs
                on your phone. For a countdown, set the minutes with <strong>−</strong> and <strong>+</strong>.
              </li>
              <li>
                <strong>Timely card:</strong> any card from your <Link href="/help/notes/dashboard">Dashboard</Link>,
                including cards you made in the Card workshop, such as a table or a counter from a sheet.
              </li>
            </ul>
            <Shot
              src="widgets"
              alt="Android widgets in dark mode: Overdue count and Overdue list cards, Completion streak in two sizes, Today with 2 of 5 done and the next items, Day and week progress bars, Inbox zero with a Capture button, a Daily goal ring, and the Quick add bar with Task, Capture, Ask and Search."
              size={{ width: 1640, height: 1666 }}
              caption="Dashboard cards, the Today widget and Quick add on a home screen. Cards marked your card were made in the Card workshop."
            />
            <Shot
              src="widgets-timers"
              alt="The Pomodoro widget with Focus, Short and Long tabs, minus and plus buttons, 25:00, Start and Skip, next to the Timer widget with Stopwatch and Timer tabs, 10:00 and Start."
              size={{ width: 1520, height: 520 }}
              caption="The Pomodoro and Timer widgets before they start."
            />
            </>
          ),
        },
        {
          id: "add",
          title: "Add a widget",
          body: (
            <>
              <Steps>
                <p>
                  Touch and hold an empty spot on your home screen, open the widgets list, and find{" "}
                  <strong>Timely</strong>. The exact words depend on your phone.
                </p>
                <p>Drag the widget you want onto the home screen.</p>
                <p>
                  For a <strong>Timely card</strong>, <strong>Choose a card</strong> opens with a preview. Cards you
                  made are listed under <strong>Your cards</strong>, the rest under <strong>Dashboard cards</strong>.
                  Pick one and choose <strong>Add widget</strong>.
                </p>
              </Steps>
              <Callout kind="note">
                The list only shows cards that are on your Dashboard. To show something else, add it as a card to the
                Dashboard first, then add the widget. To switch a widget to another card later, touch and hold it.
              </Callout>
              <p>
                Resize a widget as you would any other; it redraws at the new size straight away, then refreshes. If
                you aren&apos;t signed in, a widget says so; open Timely and sign in.
              </p>
            </>
          ),
        },
        {
          id: "in-place",
          title: "What works on the widget",
          body: (
            <>
              <ul>
                <li>
                  <strong>Tick boxes</strong> complete tasks and habits and tick doc checklist items, on the Today
                  widget and on cards such as Top 3, Habits and task lists.
                </li>
                <li>
                  <strong>Pomodoro:</strong> <strong>Start</strong>, <strong>Pause</strong>, <strong>Resume</strong>,{" "}
                  <strong>Skip</strong> and <strong>Reset</strong>. A pomodoro card on a widget gets the same tabs and{" "}
                  <strong>−</strong> and <strong>+</strong>, and a new length is saved to the card when you start.
                </li>
                <li>
                  <strong>Timer:</strong> <strong>Start</strong>, <strong>Pause</strong>, <strong>Lap</strong> and{" "}
                  <strong>Reset</strong>. The clock ticks on its own, and a countdown shows <em>Time&apos;s up</em>{" "}
                  when it ends.
                </li>
                <li>
                  <strong>Sheet counters:</strong> <strong>−</strong> and <strong>+</strong> change the count on the
                  phone at once. The widget then says <em>Not saved yet</em> and shows <strong>Save</strong>, which
                  writes the total to the cell. If you don&apos;t tap it, the count is saved the next time Timely
                  redraws the widget.
                </li>
                <li>
                  <strong>Tables</strong> list every row, up to 100, with as many columns as fit. Scroll inside the
                  widget to see more.
                </li>
              </ul>
              <p>
                Tapping anything else opens Timely on that task, event, doc or the Dashboard. Widgets update when you
                change something in Timely, when you leave the app, about every 15 minutes in the background, and
                when a timer ends.
              </p>
              <Callout kind="warning">
                Buttons that change something, such as a tick box, <strong>Start</strong> or <strong>Save</strong>,
                run Timely in the background. If they do nothing while the app is closed, allow Timely to run in the
                background: in Android&apos;s app info for Timely, set battery use to no restrictions. Some phones,
                such as Xiaomi phones with HyperOS, also need <strong>Autostart</strong> turned on for Timely.
              </Callout>
              <Callout kind="tip">
                After you install a new version of the app, open Timely once and go back to the home screen. That
                redraws every widget with the new version.
              </Callout>
            </>
          ),
        },
        {
          id: "shortcuts",
          title: "App shortcuts",
          body: (
            <p>
              Touch and hold the Timely icon for four shortcuts: <strong>New task</strong>,{" "}
              <strong>Capture</strong> to the Inbox, <strong>Ask Timely</strong> in a new chat, and{" "}
              <strong>Search</strong>.
            </p>
          ),
        },
        {
          id: "live-notification",
          title: "The live notification",
          body: (
            <>
              <p>
                While something runs, Timely keeps one notification up with buttons, so you can act without opening
                the app:
              </p>
              <ul>
                <li>
                  <strong>Focus session:</strong> the task and its running time, with <strong>Stop focus</strong> and{" "}
                  <strong>Open task</strong>.
                </li>
                <li>
                  <strong>Pomodoro:</strong> the time left and a progress bar through the phase, with{" "}
                  <strong>Pause</strong> or <strong>Resume</strong>, and <strong>Take a break</strong> or{" "}
                  <strong>Skip break</strong>.
                </li>
                <li>
                  <strong>Assistant run:</strong> what the assistant is doing, with <strong>Open chat</strong> and{" "}
                  <strong>Stop</strong>.
                </li>
                <li>
                  <strong>Auto-schedule</strong> while it places your tasks.
                </li>
              </ul>
              <p>When more than one thing runs, the notification lists them all. It goes away when nothing runs.</p>
            </>
          ),
        },
      ],
    },
    {
      slug: "shortcuts",
      title: "Keyboard shortcuts",
      summary: "The few keyboard shortcuts in the desktop and web app: search, quick prompt and closing the window.",
      keywords: ["keyboard", "hotkeys", "keys", "shortcut", "ctrl k", "ctrl shift j", "ctrl w", "close window", "multi-select"],
      lead: (
        <p>
          Timely keeps keyboard shortcuts to a few, so a stray key never does something you did not mean. On a Mac,
          use Cmd where this page says Ctrl.
        </p>
      ),
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
                    <kbd>Ctrl</kbd> <kbd>K</kbd>
                  </td>
                  <td>Search and run a command</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>J</kbd>
                  </td>
                  <td>Quick prompt: ask the assistant about the screen you are on</td>
                </tr>
              </tbody>
            </table>
          ),
        },
        {
          id: "desktop",
          title: "In the desktop app",
          body: (
            <p>
              <kbd>Ctrl</kbd> <kbd>W</kbd> closes the window. Timely keeps running in the tray, so your phone and
              reminders keep working. To stop it, use <strong>Quit Timely</strong> in the tray menu.
            </p>
          ),
        },
        {
          id: "card-workshop",
          title: "In the Card workshop",
          body: (
            <p>
              In the <strong>Pick cells</strong> grid, hold <kbd>Ctrl</kbd> while you click or drag to add cells to
              the pick instead of replacing it.
            </p>
          ),
        },
      ],
    },
  ],
};
