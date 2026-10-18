import { CalendarClock } from "lucide-react";
import Link from "next/link";
import type { HelpSection } from "../types";
import { Callout, HelpLink, Path, PhoneShots, Shot, Steps, Still } from "../ui";

export const plan: HelpSection = {
  id: "plan",
  title: "Plan your time",
  description: "Capture and clarify, the calendar, Auto-schedule, Today and reminders.",
  icon: CalendarClock,
  articles: [
    {
      slug: "inbox",
      title: "Capture and Clarify",
      summary: "Get thoughts into the Inbox fast, then decide on each one, oldest first.",
      keywords: [
        "inbox",
        "capture",
        "clarify",
        "triage",
        "quick add",
        "gtd",
        "up next",
        "later",
        "stale",
        "inbox zero",
        "make it a task",
        "remind me",
        "duplicate",
      ],
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
                Open <strong>Inbox</strong> in the sidebar, type in the big <strong>What&apos;s on your mind?</strong>{" "}
                box at the top and press <kbd>Enter</kbd> or choose <strong>Capture</strong>. The box stays ready for
                the next one. Inbox items have no workspace, project, date or length, and Auto-schedule leaves them
                alone.
              </p>
              <p>
                You can also capture from the Quick capture card on the Dashboard, or by asking the assistant.
              </p>
              <Still
                id="capture"
                alt="The Inbox: a capture box with Capture, an Up next card for the oldest capture with Make it a task, Reminder and Skip, the other captures with Review buttons, and counts of what this week's captures became."
              />
              <p>
                On the phone, open <strong>Inbox</strong> from the Home tab. The capture box sits at the bottom of the
                screen and stays above the keyboard. The <strong>+</strong> button&apos;s <strong>Inbox</strong>{" "}
                option opens the same box and confirms with <strong>Captured to Inbox</strong>.
              </p>
            </>
          ),
        },
        {
          id: "up-next",
          title: "Up next",
          body: (
            <>
              <p>
                Under the capture box, <strong>Up next</strong> shows one capture at a time: the one that has waited
                longest. Its card says how long it has waited. Captures left three days or more are marked as getting
                stale.
              </p>
              <ul>
                <li>
                  <strong>Make it a task</strong> or <strong>Remind me</strong> opens Clarify for it.
                </li>
                <li>
                  <strong>Later</strong> puts it behind the others for now, and the next oldest comes up.
                </li>
                <li>
                  <strong>Delete</strong> removes it after you confirm.
                </li>
              </ul>
              <p>
                With <HelpLink href="/help/assistant/smart-suggestions">smart suggestions</HelpLink> on, the card also
                says what the capture looks like (a task, how long it takes, when it is due) and lists tasks that{" "}
                <strong>Might already exist</strong>. Open one to compare; if it is the same thing, delete the
                capture.
              </p>
              <p>
                The rest are under <strong>Also waiting</strong>, newest first. Click a card to clarify it. On a wide
                screen, a column on the right counts what is new today, from this week and getting stale.
              </p>
              <p>
                On the phone, Up next has <strong>Review</strong>, <strong>Later</strong> and a delete button. Tap a
                card under Also waiting to review it, or press and hold it to delete it.
              </p>
            </>
          ),
        },
        {
          id: "clarify",
          title: "Clarify",
          body: (
            <>
              <p>
                Clarify opens the create form with the title filled in. The <strong>Clarify as</strong> chip at the
                top switches between:
              </p>
              <ul>
                <li>
                  <strong>Task</strong> (Work) takes time. Give it a workspace and a duration (30 minutes to start
                  with). The other rows are optional: project, status, priority, deadline, schedule, repeat and start
                  date. <strong>More options</strong> holds labels and custom fields.
                </li>
                <li>
                  <strong>Reminder</strong> is a ping at a time, with no length. Set <strong>Notify at</strong>.
                </li>
              </ul>
              <p>
                Choose <strong>Clarify</strong> to save. That creates the new Work or Reminder and removes the item
                from the Inbox. If you set a time on Work, it lands on the calendar as a manual block right away;
                otherwise Auto-schedule finds it a slot.
              </p>
              <Shot
                src="clarify"
                alt="The Clarify dialog: the item title, a description box, and fields for workspace, project, status, priority, duration, dates and repeat."
              />
              <p>
                On the phone, <strong>Review</strong> opens the item. Pick <strong>Work</strong> or{" "}
                <strong>Reminder</strong> in its <strong>Type</strong> row.
              </p>
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
      keywords: [
        "calendar",
        "events",
        "week",
        "month",
        "agenda",
        "day view",
        "drag",
        "ics",
        "waiting for a slot",
        "add to calendar",
        "past",
        "overdue",
        "reminders",
      ],
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
              <Still
                id="auto-schedule"
                alt="Week view: coloured work blocks placed around events from Sunday to Friday, one block marked moved from Wed, and the Waiting for a slot list on the right."
              />
              <ul>
                <li>The colour legend under the title maps colours to projects and to events.</li>
                <li>Reminders appear as small chips with a bell. They don&apos;t take up time.</li>
                <li>
                  A block for Work whose deadline has passed shows a red dot and &ldquo;overdue&rdquo;.
                </li>
                <li>
                  <strong>Waiting for a slot</strong> on the right lists open Work with no block coming up, in the
                  order Auto-schedule would place it. Work already placed on a later day is not listed. Right-click an
                  item and choose <strong>Schedule this…</strong> to place just that one.
                </li>
                <li>
                  <strong>Agenda</strong> lists the coming days, reminders included, and has an{" "}
                  <strong>Overdue</strong> section for Work whose deadline has passed.
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
            <>
              <p>
                Events are appointments with a fixed time: meetings, lunches, trips. Choose <strong>Add</strong>, or
                click an empty slot in Day or Week view, to open <strong>Add to calendar</strong>. Pick{" "}
                <strong>New event</strong> to create one, or <strong>Schedule a task</strong> to place existing Work
                there. You can also create an event from the <strong>+</strong> dialog or from search.
              </p>
              <p>
                An event can be all-day, repeat, and belong to a workspace. When you change a repeating one, choose
                under <strong>Apply to</strong>: <strong>This occurrence</strong>, <strong>This and following</strong>{" "}
                or <strong>All occurrences</strong>. Auto-schedule never moves events and treats them as busy time,
                including all-day ones.
              </p>
            </>
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
                A block you place or move by hand stays put when Auto-schedule runs, unless you turn on{" "}
                <strong>Move my own blocks too</strong> in the Auto-schedule dialog. For repeating items, choose
                whether a change applies to this one, this and the following ones, or all of them.
              </p>
              <p>
                You can&apos;t drop Work on time that has already passed: a past day or slot shows a short message
                instead. Dropping on today in Month view places it at the next quarter hour. When a drop pushes other
                Work aside, only that Work is placed again.
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
      keywords: [
        "auto schedule",
        "autoschedule",
        "engine",
        "working hours",
        "pin",
        "freeze",
        "buffer",
        "undo",
        "one sitting",
        "chunk",
        "repeating",
        "manual blocks",
      ],
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
                  waiting for a slot.
                </p>
                <p>
                  Read the preview. It lists every change (added, moved, removed or pinned blocks), how full each day
                  is, and anything that couldn&apos;t be placed, with the reason in plain words. Turn on{" "}
                  <strong>Move my own blocks too</strong> if it may also move blocks you placed by hand.
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
              <p>
                Once the plan is applied, the message that confirms it and the <strong>Waiting for a slot</strong>{" "}
                panel both offer <strong>Show me</strong>: a short replay of the week in which each placed block
                appears in the order it was planned and each moved block slides from its old slot to the new one.
              </p>
              <Still
                id="replay"
                alt="The What auto-schedule did replay at its end: five blocks on a Monday to Friday grid, and the line 5 blocks placed inside your working hours, 1 moved out of a meeting's way."
              />
              <p>
                Running it again later the same day moves Work it placed earlier that day instead of adding a second
                block, for example after you change your working hours. The preview shows that as a move.
              </p>
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
                them as needing one sitting. Inbox items, reminders and completed tasks are never placed.
              </p>
              <p>
                Repeating Work with a time keeps each occurrence at that time, even outside working hours. It only
                moves when something else already holds that time.
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
                  <strong>Freeze next hours</strong>: hours ahead that Auto-schedule won&apos;t rearrange, so the next
                  few hours stay stable.
                </li>
                <li>
                  <strong>Exclude workspaces from auto-schedule</strong> for workspaces it should leave alone.
                </li>
              </ul>
              <p>
                On a single task, the <strong>Auto-schedule</strong> card in its panel has:
              </p>
              <ul>
                <li>
                  <strong>Pin task</strong>, so Auto-schedule won&apos;t move any of its time.
                </li>
                <li>
                  <strong>One sitting</strong>, to place it as one block.
                </li>
                <li>
                  <strong>Minimum chunk</strong> and <strong>Preferred chunk</strong>.
                </li>
                <li>
                  <strong>Earliest start</strong> and <strong>Work hours</strong> for the times of day it should
                  use.
                </li>
              </ul>
              <p>
                To keep just one block where it is, pin that time in the task&apos;s <strong>Schedule</strong> card.
              </p>
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
      summary: "The day board: pick what matters today, run focus sessions, and keep habits and goals in view.",
      keywords: [
        "today",
        "focus",
        "habits",
        "goals",
        "streak",
        "timer",
        "home",
        "day board",
        "pomodoro",
        "end of day",
        "shut down day",
        "plan tomorrow",
        "suggested for today",
        "free time",
        "live notification",
      ],
      lead: (
        <p>
          <strong>Today</strong> is the page to keep open while you work: one dense board with what to do, when it
          happens, and the small things around it. On the phone, the same things are on the <strong>Home</strong>{" "}
          tab.
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
                alt="The Today board: Today focus with one task focusing now on a running timer beside Reschedule and Stop, and Start focus on the others; Suggested for today with Focus buttons and a free-time row with Schedule here; the Schedule column with a line at now and the free time until noon; and Habits and goals, Reminders, Overdue with Reschedule, and End of day with Plan tomorrow and Shut down day on the right."
                size={{ width: 1440, height: 900 }}
              />
              <p>
                The header shows the date, how many items wait in the Inbox (click it to open the Inbox) and how much
                focus time you logged today.
              </p>
              <ul>
                <li>
                  <strong>Today focus</strong>: up to seven tasks you want done today, whatever their deadlines. Add
                  them with <strong>Add to focus</strong> at the top or the add row under the list, or star a task
                  from its panel. Each row shows when it is due, its length and checklist progress. The meter shows
                  how many are done and still open.
                </li>
                <li>
                  <strong>Suggested for today</strong> appears with smart suggestions on. It lists Work worth doing
                  today; <strong>Focus</strong> adds one to Today focus. A dashed row names a task that fits the next
                  free time: click its name to open it, or choose <strong>Schedule here</strong> to book it into that
                  time.
                </li>
                <li>
                  <strong>Schedule</strong>: today&apos;s blocks and events on a clock, with all-day items on top,
                  reminders pinned at their time, a line at now, the free time until your next item, and a countdown
                  to it.
                </li>
                <li>
                  <strong>Habits and goals</strong> and <strong>Reminders</strong> sit on the right.{" "}
                  <strong>New</strong> in Reminders adds one.
                </li>
                <li>
                  <strong>Overdue</strong> shows up when open Work is past its deadline. <strong>Reschedule</strong>{" "}
                  opens it on the calendar.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "end-of-day",
          title: "End of day",
          body: (
            <p>
              <strong>End of day</strong> counts what is done, what is unfinished and what is already starred for
              tomorrow. <strong>Plan tomorrow</strong> opens tomorrow in the calendar&apos;s Day view.{" "}
              <strong>Shut down day</strong> moves your unfinished focus tasks to tomorrow&apos;s focus; the message
              that follows has Undo.
            </p>
          ),
        },
        {
          id: "focus",
          title: "Focus sessions",
          body: (
            <>
              <p>
                <strong>Start focus</strong> on a task to time your work on it. Only one task can be in focus at a
                time, and the page shows <strong>Focus mode</strong> while it runs. When you stop, the minutes are
                added to the task&apos;s actual time and show up in the Dashboard&apos;s Focus time card. The phone
                can also pause and resume a session.
              </p>
              <p>
                On Android, a running focus session or Pomodoro timer also shows as a live notification. A focus
                session has <strong>Stop focus</strong> and <strong>Open task</strong>. A Pomodoro shows a progress
                bar through the current round, with <strong>Pause</strong> or <strong>Resume</strong> and{" "}
                <strong>Take a break</strong> or <strong>Skip break</strong>. You can also run them from{" "}
                <HelpLink href="/help/start/widgets">Home-screen widgets</HelpLink>.
              </p>
            </>
          ),
        },
        {
          id: "habits-goals",
          title: "Habits and goals",
          body: (
            <>
              <p>
                Habits are things you repeat daily, such as reading or a walk; goals are the bigger outcomes you are
                working toward. You can have up to 20 habits and 5 goals, and both sync with the phone.
              </p>
              <ul>
                <li>Tap a habit to tick it for today. The flame shows the streak.</li>
                <li>
                  The <strong>+</strong> after your habits adds a new one in a single tap.
                </li>
                <li>
                  With smart suggestions on, a goal shows a count such as &ldquo;3 tasks&rdquo;. Tap it to list the
                  open tasks that move the goal forward. At 0 it says why the list is empty and offers{" "}
                  <strong>Add a task</strong>.
                </li>
                <li>
                  <strong>Edit</strong> lets you add, rename, reorder or remove them. While you rename one, the tick
                  beside it saves the name; <kbd>Enter</kbd> or moving to another field saves it too. Choose{" "}
                  <strong>Done</strong> when you are finished.
                </li>
              </ul>
            </>
          ),
        },
        {
          id: "phone",
          title: "On the phone",
          body: (
            <>
              <p>
                The Home tab follows the same order in one column: habits and goals, an <strong>Inbox</strong> row
                with how many items wait, the session in focus, Today focus, suggestions, the schedule, overdue work
                and end of day. You can star several tasks at once in <strong>Add to today</strong>.
              </p>
              <p>
                When you open the app, <strong>Preparing Timely</strong> stays up until today&apos;s data has loaded,
                so Home opens filled in. If the server is slow, the app opens after a few seconds on your saved
                account and fills in when the data arrives.
              </p>
              <PhoneShots
                shots={[{ src: "phone-home", alt: "Phone Home tab with habit chips, two goals, the Inbox row and the Today focus card." }]}
              />
            </>
          ),
        },
      ],
    },
    {
      slug: "reminders",
      title: "Reminders and notifications",
      summary: "Timed pings, snoozing, alerts for missed and overdue work, phone quick actions, and quiet hours.",
      keywords: [
        "reminder",
        "notification",
        "snooze",
        "alert",
        "quiet hours",
        "digest",
        "bell",
        "quick actions",
        "notification buttons",
        "done",
        "live notification",
      ],
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
              In the <strong>+</strong> dialog or in Clarify, switch the kind chip to <strong>Reminder</strong> and set{" "}
              <strong>Notify at</strong>. <strong>New</strong> in the Reminders panel on Today does the same. Reminders
              can repeat. They show on the calendar as small chips with a bell, and in the Agenda.
            </p>
          ),
        },
        {
          id: "notifications",
          title: "The notification centre",
          body: (
            <>
              <p>
                <strong>Notifications</strong> in the sidebar lists everything
                Timely has told you. Snooze a reminder for 15 minutes, an hour, or until 9:00 tomorrow; mark items read
                or clear them all.
              </p>
              <Shot src="notifications" alt="The Notifications page with two reminders, each with Snooze 15m, Snooze 1h and Tomorrow 9:00 buttons." />
              <p>Besides reminders, Timely can tell you when:</p>
              <ul>
                <li>a block of Work starts in 10 minutes,</li>
                <li>a block ended and the Work isn&apos;t done (missed),</li>
                <li>Work passed its deadline (overdue),</li>
                <li>the assistant has an update or needs your review.</li>
              </ul>
              <p>Overdue and missed notices are marked read on their own once you finish the task.</p>
            </>
          ),
        },
        {
          id: "phone-actions",
          title: "Buttons on phone notifications",
          body: (
            <>
              <p>
                On the phone, each notification carries up to three buttons that act without opening the app:
              </p>
              <ul>
                <li>
                  Reminders: <strong>Done</strong> and two snooze lengths.
                </li>
                <li>
                  A block about to start: <strong>Start focus</strong>, <strong>Done</strong> and a short snooze.
                </li>
                <li>
                  Overdue Work: <strong>Reschedule urgently</strong>, <strong>Done</strong> and{" "}
                  <strong>Open</strong>.
                </li>
                <li>
                  Missed Work: <strong>Start focus</strong>, <strong>Done</strong> and <strong>Open</strong>.
                </li>
                <li>
                  The assistant: <strong>Review</strong> or <strong>Open chat</strong>, and <strong>Reply</strong>{" "}
                  to answer from the notification.
                </li>
              </ul>
              <p>
                With smart suggestions on, the step they suggest comes first, marked with ✦. On Android, a running
                focus session or Pomodoro also stays in a live notification; see{" "}
                <HelpLink href="/help/plan/today">Focus sessions</HelpLink>.
              </p>
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
