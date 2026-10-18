/**
 * Pure data, safe to import from server components. The scene components
 * live in ./scenes (they need Remotion, which is client-only).
 */
import { C, FPS } from "./theme";

export type Chapter = {
  id: string;
  n: string;
  /** Short name on the rail and in the nav. */
  title: string;
  /** Headline of the chapter's section. */
  headline: string;
  body: string;
  facts: string[];
  help: string;
  color: string;
  /** Length of the scene, in frames. */
  frames: number;
};

const SCENE = 5 * FPS;

/** The film, in order. Every chapter is one feature, one scene, one section of the page. */
export const CHAPTERS: Chapter[] = [
  {
    id: "capture",
    n: "01",
    title: "Capture",
    headline: "Get it out of your head.",
    body: "Type anything into the Inbox the moment you think of it, on the desktop, from the phone's Quick add bar, or by voice. Sort it later: clarify it, schedule it or park it for someday.",
    facts: ["One box, no fields to fill", "Ctrl/Cmd+K from anywhere", "A Quick add widget on Android"],
    help: "/help/plan/capture",
    color: C.violet,
    frames: SCENE,
  },
  {
    id: "tasks",
    n: "02",
    title: "Workspaces and projects",
    headline: "Every task has a home.",
    body: "Workspaces hold projects; projects have stages, labels and custom fields of their own. The same tasks show as a list, a board or a Gantt chart, with saved views and natural-language filters.",
    facts: ["Stages, labels, custom fields", "List, board and Gantt", "Recurring tasks and reminders"],
    help: "/help/organize/tasks",
    color: C.red,
    frames: SCENE,
  },
  {
    id: "auto-schedule",
    n: "03",
    title: "Auto-schedule",
    headline: "The week rearranges itself.",
    body: "Give a task an estimate and Timely finds it a slot in free time inside your working hours. When a meeting lands on top of it, the next run moves it. Pins and manual blocks stay where you put them.",
    facts: ["Working hours and focus blocks", "Deadlines and priorities respected", "Runs when something changes"],
    help: "/help/plan/auto-schedule",
    color: C.amber,
    frames: SCENE,
  },
  {
    id: "sheets",
    n: "04",
    title: "Sheets",
    headline: "Numbers next to the work.",
    body: "A spreadsheet inside every project: formulas, tabs, freeze panes, column menus. Any cell becomes a card on your Dashboard or a counter widget on your phone. The assistant and your agents can fill rows too.",
    facts: ["Formulas and ranges", "Cards and widgets from cells", "Receipts become rows"],
    help: "/help/notes/sheets",
    color: C.green,
    frames: SCENE,
  },
  {
    id: "docs",
    n: "05",
    title: "Docs",
    headline: "Notes that turn into tasks.",
    body: "Write with a slash menu, tables, images and code. A line that reads like a task becomes one, linked back to the doc. Help me write rewrites a paragraph on your own AI. Markdown goes in and comes out.",
    facts: ["Slash menu and Help me write", "Lines become linked tasks", "Markdown import and export"],
    help: "/help/notes/docs",
    color: C.blue,
    frames: SCENE,
  },
  {
    id: "cards",
    n: "06",
    title: "Dashboard cards",
    headline: "Build the card you need.",
    body: "The Dashboard is a grid you arrange yourself. Pick from thirty-five built-in cards, from a Pomodoro timer to a priority matrix, or open the card workshop and build one from your tasks, events, a sheet or a doc: choose the source, the display, the measure, the grouping and the range, and watch the preview.",
    facts: ["Stats, tools, timers, journals", "Your own cards from any data", "Every card can be a phone widget"],
    help: "/help/notes/dashboard",
    color: C.accent,
    frames: SCENE,
  },
  {
    id: "suggestions",
    n: "07",
    title: "Smart suggestions",
    headline: "Jev fills in the blanks.",
    body: "Smart suggestions run on Jev, TypeSafe's decision model. Timely asks it typed questions, how long, which project, how urgent, and gets back a choice with a probability. No prompts, no free text, nothing to make up. Turn it off and the fields are simply yours.",
    facts: ["Estimate, project, priority, due", "Probabilities you can see", "Your TypeSafe or OpenRouter key"],
    help: "/help/assistant/smart-suggestions",
    color: C.pink,
    frames: SCENE,
  },
  {
    id: "assistant",
    n: "08",
    title: "AI assistant",
    headline: "Your AI, your account.",
    body: "The assistant runs on Claude Code with your Claude subscription, on Codex with your ChatGPT subscription, or on any model with your own API key. It reads your week, proposes changes and waits for your approval.",
    facts: ["Claude Code, Codex or a key", "Proposals you approve", "Quick prompt with Ctrl/Cmd+Shift+J"],
    help: "/help/assistant/subscriptions",
    color: C.accent,
    frames: SCENE,
  },
  {
    id: "agents",
    n: "09",
    title: "Agents over MCP",
    headline: "Hermes, OpenClaw, or yours.",
    body: "Timely is an MCP server over HTTP. Make a key, scope it to what the agent may touch, and it reads and writes tasks, docs and sheets with the same tools the assistant uses.",
    facts: ["Scoped keys, revoked in one click", "Tasks, docs, sheets, calendar", "Works over your tailnet"],
    help: "/help/assistant/mcp",
    color: C.cyan,
    frames: SCENE,
  },
  {
    id: "widgets",
    n: "10",
    title: "Widgets",
    headline: "Your day on the Home screen.",
    body: "Today, habits, Pomodoro, timers, counters from a sheet and Quick add, as Android widgets. Tick a box or start a timer and it happens on the phone, without opening the app.",
    facts: ["Interactive, not just pictures", "Any Dashboard card, built-in or your own", "Live notification during focus"],
    help: "/help/start/phone",
    color: C.orange,
    frames: SCENE,
  },
  {
    id: "self-host",
    n: "11",
    title: "Self-host",
    headline: "Runs on your computer. Reaches your phone.",
    body: "The desktop app bundles PostgreSQL and its own server. Your phone pairs by QR code and talks to it over your Tailscale network, at home or away. Open source, no cloud, no account with anyone but yourself.",
    facts: ["Windows, Linux and Android", "Pair by QR, connect over Tailscale", "MIT licence on GitHub"],
    help: "/help/install/android",
    color: C.green,
    frames: SCENE,
  },
];

export const FILM_FRAMES = CHAPTERS.reduce((sum, chapter) => sum + chapter.frames, 0);

/** First frame of each chapter in the film. */
export const CHAPTER_STARTS = CHAPTERS.reduce<number[]>((starts, chapter, i) => {
  starts.push(i === 0 ? 0 : starts[i - 1] + CHAPTERS[i - 1].frames);
  return starts;
}, []);

export function chapterAt(frame: number) {
  let index = 0;
  for (let i = 0; i < CHAPTER_STARTS.length; i++) if (frame >= CHAPTER_STARTS[i]) index = i;
  return index;
}
