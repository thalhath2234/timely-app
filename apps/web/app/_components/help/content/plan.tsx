import { CalendarClock } from "lucide-react";
import Link from "next/link";
import type { HelpSection } from "../types";
import { Callout, Path, PhoneShots, Shot, Steps } from "../ui";

export const plan: HelpSection = {
  id: "plan",
  title: "Plan your time",
  description: "Capture and clarify, the calendar, Auto-schedule, Today and reminders.",
  icon: CalendarClock,
  articles: [
    {
      slug: "inbox",
      title: "Capture and Clarify",
      summary: "Get thoughts into the Inbox fast, then decide what each one is.",
      keywords: ["inbox", "capture", "clarify", "triage", "quick add", "gtd"],
      lead: (
        <p>
          The Inbox is where things land before you have decided anything about them. Capturing takes a title and
          nothing else; clarifying turns it into Work or a Reminder later, when you have a minute.
        </p>
      ),
      sections: [
        {
          id: "capture",
          title: "Capture",
          body: (
            <>
              <p>
                Open <strong>Inbox</strong> in the sidebar (<kbd>g</kbd> then <kbd>i</kbd>), type in the box at the
                top and press <kbd>Enter</kbd>. Inbox items have no workspace, project, date or length, and
                Auto-schedule leaves them alone.
              </p>
              <p>
                You can also capture from the phone&apos;s <strong>+</strong> button, from the Quick capture card on
                the Dashboard, or by asking the assistant.
              </p>
              <Shot src="inbox" alt="The Inbox page with a capture box and five captured items, each with a Review button." />
            </>
          ),
        },
        {
          id: "clarify",
          title: "Clarify",
          body: (
            <>
              <p>
                Click an Inbox item to open it in <strong>Clarify</strong>. Choose what it is:
              </p>
              <ul>
                <li>
                  <strong>Work</strong> takes time. Give it a workspace and a duration (30 minutes to start with), and
                  optionally a project, status, priority, start date, deadline, labels and repeat.
                </li>
                <li>
                  <strong>Reminder</strong> is a ping at a time, with no length. Set <strong>Notify at</strong>.
                </li>
              </ul>
              <p>
                Saving creates the new Work or Reminder and removes the item from the Inbox. If you set a time on Work,
                it lands on the calendar as a manual block right away; otherwise Auto-schedule finds it a slot.
              </p>
              <Shot
                src="clarify"
                alt="The Clarify dialog: the item title, a Work or Reminder switch, and fields for workspace, project, priority, duration, dates and repeat."
              />
              <Callout kind="tip">
                With <Link href="/help/assistant/smart-suggestions">smart suggestions</Link> on, Clarify reads the
                item&apos;s words (&ldquo;by Friday&rdquo;, &ldquo;this afternoon&rdquo;) and suggests a project,
                labels, dates and a length.
              </Callout>
            </>
          ),
        },
      ],
    },
    {
      slug: "calendar",
      title: "The calendar",
      summary: "Day, week, month and agenda views, events, and moving blocks by hand.",
      keywords: ["calendar", "events", "week", "month", "agenda", "day view", "drag", "ics"],
      lead: (
        <p>
          The calendar shows everything with a time: events, the blocks Auto-schedule placed for your Work, and
          reminders. Switch between <strong>Day</strong>, <strong>Week</strong>, <strong>Month</strong> and{" "}
          <strong>Agenda</strong> in the top right.
        </p>
      ),
      sections: [
        {
          id: "views",
          title: "Reading the calendar",
          body: (
            <>
              <Shot
                src="calendar"
                alt="Week view: coloured work blocks and events across Sunday to Saturday, reminder chips, and the Waiting for a slot list on the right."
              />
              <ul>
                <li>The colour legend under the title maps colours to projects and to events.</li>
                <li>Reminders appear as small chips with a bell. They don&apos;t take up time.</li>
                <li>
                  <strong>Waiting for a slot</strong> on the right lists open Work with no block yet, in the order
                  Auto-schedule would place it. <strong>Schedule this</strong> places one item.
                </li>
                <li>
                  <strong>Agenda</strong> lists the coming days and has an <strong>Overdue</strong> section for Work
                  whose deadline has passed.
                </li>
              </ul>
              <Shot src="calendar-month" alt="Month view of October with items listed in each day cell." />
            </>
          ),
        },
        {
          id: "events",
          title: "Events",
          body: (
            <p>
              Events are appointments with a fixed time: meetings, lunches, trips. Add one with the{" "}
              <strong>Add</strong> button, by clicking an empty slot in Day or Week view, or from search. An event can
              be all-day, repeat, and link to a workspace, project or task. Auto-schedule never moves events and treats
              them as busy time, including all-day ones.
            </p>
          ),
        },
        {
          id: "move-blocks",
          title: "Moving things by hand",
          body: (
            <>
              <ul>
                <li>Drag a block to another time, or drag its edge to make it longer or shorter.</li>
                <li>Drag an item from Waiting for a slot onto the grid to place it yourself.</li>
                <li>Click an empty slot to schedule an existing task there or create a new event.</li>
              </ul>
              <p>
                A block you place or move by hand stays put when Auto-schedule runs, unless you ask it to include
                manual blocks. For repeating items, choose whether a change applies to this one, this and the following
                ones, or all of them.
              </p>
            </>
          ),
        },
        {
          id: "export",
          title: "Export to another calendar",
          body: (
            <p>
              <Path>Settings &gt; Data &amp; privacy &gt; Calendar ICS</Path> downloads your calendar as an{" "}
              <code>.ics</code> file you can import elsewhere. Timely doesn&apos;t sync with Google or Outlook
              calendars.
            </p>
          ),
        },
      ],
    },
    {
      slug: "auto-schedule",
      title: "Auto-schedule",
      summary: "How Timely places Work on your calendar, and how to steer it.",
      keywords: ["auto schedule", "autoschedule", "engine", "working hours", "pin", "freeze", "buffer", "undo"],
      lead: (
        <p>
          Auto-schedule turns your open Work into blocks on the calendar. It looks at your working hours, your
          events and the blocks already there, then places each task in the earliest free time that fits, most
          urgent first.
        </p>
      ),
      sections: [
        {
          id: "run",
          title: "Run it",
          body: (
            <>
              <Steps>
                <p>
                  On the calendar, choose <strong>Auto-schedule</strong>. The number next to it is how much Work is
                  waiting.
                </p>
                <p>
                  Read the preview. It lists every change (added, moved, removed or pinned blocks), how full each day
                  is, and anything that couldn&apos;t be placed, with the reason in plain words.
                </p>
                <p>
                  Choose <strong>Apply schedule</strong>. Changed your mind? <strong>Undo last apply</strong> puts
                  the calendar back.
                </p>
              </Steps>
              <Shot
                src="auto-schedule"
                alt="The Auto-schedule dialog: date range, capacity by day, a list of changes per task, and Undo last apply and Apply schedule buttons."
              />
            </>
          ),
        },
        {
          id: "order",
          title: "What goes first",
          body: (
            <>
              <p>
                Timely ranks open Work by how close the deadline is compared with the work left, priority, whether
                it&apos;s in your Today focus, whether something else is waiting on it, and progress so far. Tasks that
                block others are placed before the tasks that wait on them.
              </p>
              <p>
                Long tasks can be split into chunks (labelled &ldquo;1/2&rdquo;, &ldquo;2/2&rdquo;) unless you mark
                them as needing one unbroken block. Inbox items, reminders and completed tasks are never placed.
              </p>
            </>
          ),
        },
        {
          id: "steer",
          title: "Steer it",
          body: (
            <>
              <p>
                In <Path>Settings &gt; Schedule</Path>:
              </p>
              <ul>
                <li>
                  <strong>Working hours</strong> per day, with more than one window if you like, and your time zone.
                </li>
                <li>
                  <strong>Buffer between blocks</strong>, 5 minutes by default.
                </li>
                <li>
                  <strong>Freeze window</strong>: hours ahead that Auto-schedule won&apos;t rearrange, so the next
                  few hours stay stable.
                </li>
                <li>
                  <strong>Excluded workspaces</strong> that Auto-schedule should leave alone.
                </li>
              </ul>
              <p>On a single task you can also set:</p>
              <ul>
                <li>Earliest start, and preferred times of day.</li>
                <li>Minimum and preferred chunk size, or one unbroken block.</li>
                <li>
                  <strong>Pin</strong> a block so it never moves, or lock the whole task&apos;s schedule.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "overdue-missed",
          title: "Overdue and missed",
          body: (
            <p>
              <strong>Overdue</strong> means the deadline date has passed and the Work is still open.{" "}
              <strong>Missed</strong> means a block ended and the Work isn&apos;t done; Timely sends a notification
              and the next Auto-schedule run finds it a new slot.
            </p>
          ),
        },
      ],
    },
    {
      slug: "today",
      title: "Today, focus, habits and goals",
      summary: "Pick what matters today, run focus sessions, and keep habits and goals in view.",
      keywords: ["today", "focus", "habits", "goals", "streak", "timer", "home"],
      lead: (
        <p>
          <strong>Today</strong> (<kbd>g</kbd> then <kbd>y</kbd>) is the page to keep open while you work. On the
          phone, the same things are on the <strong>Home</strong> tab.
        </p>
      ),
      sections: [
        {
          id: "overview",
          title: "What is on Today",
          body: (
            <>
              <Shot
                src="today"
                alt="The Today page: habits and goals at the top, a Today focus list of three tasks with Start Focus buttons, and the scheduled agenda."
              />
              <ul>
                <li>
                  <strong>Habits and goals</strong>: tick a habit when you&apos;ve done it today. The flame shows the
                  streak.
                </li>
                <li>
                  <strong>Today focus</strong>: up to seven tasks you want done today, whatever their deadlines.
                </li>
                <li>
                  <strong>Scheduled agenda</strong>: today&apos;s blocks and events on a timeline.
                </li>
                <li>
                  <strong>Reminders</strong> for today, and a nudge when the Inbox has items waiting.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "focus",
          title: "Focus sessions",
          body: (
            <p>
              <strong>Start Focus</strong> on a task to time your work on it. Only one task can be in focus at a time.
              When you stop, the minutes are added to the task&apos;s actual time and show up in the Dashboard&apos;s
              Focus time card. The phone can also pause and resume a session.
            </p>
          ),
        },
        {
          id: "habits-goals",
          title: "Habits and goals",
          body: (
            <>
              <p>
                Choose <strong>Edit</strong> next to Habits and goals to add, rename, reorder or remove them. Habits
                are things you repeat daily, such as reading or a walk; goals are the bigger outcomes you are working
                toward. Both sync with the phone.
              </p>
              <PhoneShots
                shots={[{ src: "phone-home", alt: "Phone Home tab with habit chips, three goals and the Today focus list." }]}
              />
            </>
          ),
        },
      ],
    },
    {
      slug: "reminders",
      title: "Reminders and notifications",
      summary: "Timed pings, snoozing, alerts for missed and overdue work, and quiet hours.",
      keywords: ["reminder", "notification", "snooze", "alert", "quiet hours", "digest", "bell"],
      lead: (
        <p>
          A Reminder is a ping at a set time, such as &ldquo;Call mum at 18:00&rdquo;. It has no length and never
          takes up time on the calendar. Notifications collect reminders and the alerts Timely sends about your Work.
        </p>
      ),
      sections: [
        {
          id: "create",
          title: "Create a reminder",
          body: (
            <p>
              In the Add dialog or in Clarify, switch from <strong>Work</strong> to <strong>Reminder</strong> and set{" "}
              <strong>Notify at</strong>. Reminders can repeat. They show on the calendar as small chips with a bell.
            </p>
          ),
        },
        {
          id: "notifications",
          title: "The notification centre",
          body: (
            <>
              <p>
                <strong>Notifications</strong> in the sidebar (<kbd>g</kbd> then <kbd>n</kbd>) lists everything
                Timely has told you. Snooze a reminder for 15 minutes, an hour, or until 9:00 tomorrow; mark items read
                or clear them all.
              </p>
              <Shot src="notifications" alt="The Notifications page with two reminders, each with Snooze 15m, Snooze 1h and Tomorrow 9:00 buttons." />
              <p>Besides reminders, Timely can tell you when:</p>
              <ul>
                <li>a block of Work starts in 10 minutes,</li>
                <li>a block ended and the Work isn&apos;t done (missed),</li>
                <li>Work passed its deadline (overdue); on the phone you can reschedule it urgently from the alert,</li>
                <li>the assistant has an update or needs your review.</li>
              </ul>
            </>
          ),
        },
        {
          id: "settings",
          title: "Choose what you hear about",
          body: (
            <>
              <p>
                <Path>Settings &gt; Notifications</Path> turns each kind on or off and sets quiet hours and the times
                of the morning and evening digests.
              </p>
              <Callout kind="note">
                Reminders are sent by the server even when the window is closed, as long as Timely runs in the tray.
                The phone also schedules its own reminder notifications, so they fire without a connection.
              </Callout>
            </>
          ),
        },
      ],
    },
  ],
};
