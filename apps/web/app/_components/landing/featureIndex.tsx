import { Bell, Bot, CalendarDays, FolderKanban, NotebookPen, ShieldCheck, type LucideIcon } from "lucide-react";
import { hueStyle } from "./hue";

/** Everything the animated sections did not cover, grouped the way the app is. */
const GROUPS: { title: string; icon: LucideIcon; hue: string; items: string[] }[] = [
  {
    title: "Plan",
    icon: FolderKanban,
    hue: "#6E56CF",
    items: [
      "Projects with stages and progress",
      "List, Kanban and Gantt views",
      "Saved views with filters, grouping and sorting",
      "Custom fields, labels and statuses",
      "Dependencies: one task blocked by another",
      "Checklists and bulk edits",
    ],
  },
  {
    title: "Calendar",
    icon: CalendarDays,
    hue: "#0090FF",
    items: [
      "Day, Week, Month and Agenda views",
      "Events, timed or all-day",
      "Repeating tasks and events, editable one occurrence at a time",
      "Drag to schedule, move and resize blocks",
      "Working hours with several windows a day",
      "Pinned blocks, buffers and a freeze window",
    ],
  },
  {
    title: "Stay aware",
    icon: Bell,
    hue: "#FFB224",
    items: [
      "Reminders with snooze",
      "Start-soon and missed-block alerts",
      "Overdue alerts for passed deadlines",
      "Daily digests",
      "Quiet hours",
      "A notification centre on desktop and phone",
    ],
  },
  {
    title: "Write and calculate",
    icon: NotebookPen,
    hue: "#12A594",
    items: [
      "Nested docs with favourites and archive",
      "Markdown import and export",
      "Code blocks with syntax colours",
      "Multi-tab sheets with formatting and merged cells",
      "More than 20 formula functions",
      "Sheet templates and CSV export",
    ],
  },
  {
    title: "Assistant",
    icon: Bot,
    hue: "#AB4ABA",
    items: [
      "Chat that takes the screen and selection you attach as context",
      "Runs that continue after you leave the chat",
      "Receipt photos turned into expense rows",
      "Optional web search",
      "OpenRouter, Claude Code or Codex as the model",
      "A revocable API key for external MCP agents",
    ],
  },
  {
    title: "Yours",
    icon: ShieldCheck,
    hue: "#30A66D",
    items: [
      "Several private workspaces per account",
      "Full JSON backup and restore",
      "Encrypted scheduled backups",
      "Tasks as CSV, calendar as ICS",
      "Light, dark and accent-colour themes",
      "Keyboard shortcuts across the desktop app",
      "Offline-aware phone app that queues changes",
    ],
  },
];

export default function FeatureIndex() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {GROUPS.map((group) => (
        <div key={group.title} className="l-hue l-card rounded-3xl p-6" style={hueStyle(group.hue)}>
          <div className="flex items-center gap-3">
            <span className="l-stage flex size-10 items-center justify-center rounded-2xl">
              <group.icon className="size-5" />
            </span>
            <h3 className="l-display text-xl font-bold">{group.title}</h3>
          </div>
          <ul className="l-soft mt-4 space-y-2 text-sm leading-snug">
            {group.items.map((item) => (
              <li key={item} className="flex gap-2.5">
                <span
                  aria-hidden
                  className="mt-[0.5em] size-1.5 shrink-0 rounded-full"
                  style={{ background: "var(--l-hue-ink)" }}
                />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
