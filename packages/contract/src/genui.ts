import { createLibrary, createParser, defineComponent } from "@openuidev/lang-core";
import { z } from "zod/v4";
import { ACCENT_PRESETS } from "./designTokens";

/**
 * Reply cards: the UI the agent may add to a chat reply, written in OpenUI
 * Lang (https://openui.com). The model puts a short program in one
 * ```openui-lang fence after its text; each app draws it with its own kit
 * through @openuidev/react-lang, so only the components below can appear and
 * no model-written HTML or code runs. Web, desktop and phone register the same
 * names and props. `make gen-genui-prompt` writes the model's instructions for
 * the API (apps/api/internal/features/chat/genui_prompt.txt) from this file.
 *
 * Props are positional in OpenUI Lang, so the order of each `z.object` is part
 * of the contract: append new optional props, never reorder.
 */

export const GENUI_FENCE = "openui-lang";
export const GENUI_ROOT = "Reply";
/** Sent as `ui` with chat messages by apps that draw reply cards. */
export const GENUI_CAPABILITY = "openui-1";

/** Colour names map to the accent presets (`ACCENT_PRESETS` labels). */
export const GENUI_COLORS = ["indigo", "violet", "blue", "teal", "green", "orange", "red", "pink"] as const;
export type GenuiColor = (typeof GENUI_COLORS)[number];

/** A colour name's hex from the accent presets; undefined for none or an unknown name. */
export function genuiColorHex(name: string | undefined): string | undefined {
  return ACCENT_PRESETS.find((preset) => preset.label.toLowerCase() === name)?.hex;
}

/** A picked date and time as the person's answer, e.g. "Thu, 30 Oct, 17:00" (24-hour, like the agent's times). */
export function spokenTime(date: Date, now = new Date()): string {
  const day = date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${day}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Where an Open link goes; task, project, doc and sheet need an id. */
export const GENUI_TARGETS = ["today", "calendar", "tasks", "inbox", "dashboard", "task", "project", "doc", "sheet"] as const;
export type GenuiTarget = (typeof GENUI_TARGETS)[number];

const color = z.enum(GENUI_COLORS);
const tone = z.enum(["default", "warning", "success"]);

// Components carry no renderer here; each app adds its own (see withRenderers).
const Open = defineComponent({
  name: "Open",
  description: "A link that opens a Timely screen, or a task, project, doc or sheet by its id.",
  props: z.object({
    label: z.string().describe("Short, e.g. Open Today"),
    target: z.enum(GENUI_TARGETS),
    id: z.string().optional().describe("Required for task, project, doc and sheet; from a tool result"),
  }),
  component: null,
});

const TaskRow = defineComponent({
  name: "TaskRow",
  description:
    "A Work item or Reminder with a working tick box; tapping it opens the task. Shows the task's live title and state.",
  props: z.object({
    taskId: z.string().describe("The task's id from a tool result"),
    title: z.string(),
    time: z.string().optional().describe("Short time or day, e.g. 17:00 or Fri"),
    note: z.string().optional().describe("Short detail, e.g. the project or Overdue 2 days"),
  }),
  component: null,
});

const EventRow = defineComponent({
  name: "EventRow",
  description: "A calendar event or block in a day.",
  props: z.object({
    time: z.string().describe("Start, e.g. 13:00"),
    title: z.string(),
    length: z.string().optional().describe("e.g. 1 h 30 min"),
    color: color.optional(),
    eventId: z.string().optional().describe("The event's id from a tool result"),
  }),
  component: null,
});

const FreeRow = defineComponent({
  name: "FreeRow",
  description: "A free gap in the day; the person can ask you to plan something in it.",
  props: z.object({ from: z.string().describe("e.g. 15:00"), to: z.string().describe("e.g. 18:00") }),
  component: null,
});

const InfoRow = defineComponent({
  name: "InfoRow",
  description: "A row with a label on the left and a value on the right.",
  props: z.object({
    label: z.string(),
    value: z.string().optional(),
    note: z.string().optional().describe("A second line under the label"),
    tone: tone.optional().describe("warning for something late or at risk, success for something done"),
  }),
  component: null,
});

const ShareRow = defineComponent({
  name: "ShareRow",
  description: "A row with a share bar, e.g. time per project.",
  props: z.object({
    label: z.string(),
    value: z.string().describe("e.g. 5 h 10 min"),
    share: z.number().describe("0 to 100: this row's share of the largest or of the total"),
    color: color.optional(),
  }),
  component: null,
});

const Stat = defineComponent({
  name: "Stat",
  description: "One number with a label.",
  props: z.object({
    label: z.string(),
    value: z.string().describe("e.g. 18/22, 82% or 9h 40m"),
    hint: z.string().optional(),
  }),
  component: null,
});

const Stats = defineComponent({
  name: "Stats",
  description: "Two to four Stat tiles side by side.",
  props: z.object({ items: z.array(Stat.ref) }),
  component: null,
});

const BarChart = defineComponent({
  name: "BarChart",
  description: "Bars comparing up to 12 values, e.g. focus hours per day.",
  props: z.object({
    title: z.string(),
    labels: z.array(z.string()),
    values: z.array(z.number()),
    unit: z.string().optional().describe("e.g. h"),
    highlight: z.string().optional().describe("The label to stand out"),
  }),
  component: null,
});

const Slot = defineComponent({
  name: "Slot",
  description: "A span in a DayStrip.",
  props: z.object({
    from: z.string().describe("HH:MM"),
    to: z.string().describe("HH:MM"),
    kind: z.enum(["event", "task", "free"]),
    label: z.string().optional(),
    color: color.optional(),
  }),
  component: null,
});

const DayStrip = defineComponent({
  name: "DayStrip",
  description: "A day as a time line with its events, tasks and free gaps.",
  props: z.object({
    start: z.string().describe("HH:MM, e.g. 08:00"),
    end: z.string().describe("HH:MM, e.g. 20:00"),
    slots: z.array(Slot.ref),
  }),
  component: null,
});

const Text = defineComponent({
  name: "Text",
  description: "A short paragraph inside a card.",
  props: z.object({ text: z.string() }),
  component: null,
});

const Card = defineComponent({
  name: "Card",
  description: "A card of grouped rows with a title.",
  props: z.object({
    title: z.string().describe("e.g. Today · Sun 25 Oct, or Tasks"),
    rows: z.array(
      z.union([TaskRow.ref, EventRow.ref, FreeRow.ref, InfoRow.ref, ShareRow.ref, Stats.ref, BarChart.ref, Text.ref]),
    ),
    meta: z.string().optional().describe("Short summary on the right, e.g. 2 events · 3 tasks"),
    open: z.optional(Open.ref),
  }),
  component: null,
});

const Columns = defineComponent({
  name: "Columns",
  description: "Two or three cards side by side on wide screens, stacked on the phone.",
  props: z.object({ cards: z.array(Card.ref) }),
  component: null,
});

const Choices = defineComponent({
  name: "Choices",
  description:
    "Up to four short answers to the question you just asked; tapping one sends it as the person's reply.",
  props: z.object({
    options: z.array(z.string()),
    pickTime: z.boolean().optional().describe("true adds Pick a time…, which opens Timely's date and time picker"),
  }),
  component: null,
});

const Reply = defineComponent({
  name: "Reply",
  description: "The root: the cards under your text.",
  props: z.object({ blocks: z.array(z.union([Card.ref, Choices.ref])) }),
  component: null,
});

export const GENUI_COMPONENTS = {
  Reply,
  Card,
  Columns,
  Stats,
  Stat,
  TaskRow,
  EventRow,
  FreeRow,
  InfoRow,
  ShareRow,
  BarChart,
  DayStrip,
  Slot,
  Choices,
  Text,
  Open,
};
export type GenuiName = keyof typeof GENUI_COMPONENTS;

/** The kit minus the dashboard-only layouts (Columns, a day strip): replies are grouped cards. */
const REPLY_COMPONENTS = Object.values(GENUI_COMPONENTS).filter((component) => !["Columns", "DayStrip", "Slot"].includes(component.name));
export type GenuiProps<N extends GenuiName> = z.infer<(typeof GENUI_COMPONENTS)[N]["props"]>;

/**
 * The shared components with an app's renderers, ready for that app's
 * `createLibrary` (from @openuidev/react-lang).
 */
export function withRenderers<R extends Record<GenuiName, unknown>>(renderers: R) {
  return (Object.keys(GENUI_COMPONENTS) as GenuiName[]).map((name) => ({
    ...GENUI_COMPONENTS[name],
    component: renderers[name] as R[GenuiName],
  }));
}

const PREAMBLE = `## Reply cards
The app can show cards under your reply. After your text you may add ONE fenced block that starts with \`\`\`${GENUI_FENCE} and holds an OpenUI Lang program. Timely draws it with its own components; text outside the fence is your message, and ids inside the fence are never shown to the person.`;

const RULES = [
  "Add a card when the answer is a list of the person's tasks, events or days, numbers worth comparing, or a choice the person makes. Greetings, confirmations, explanations and errors stay text only.",
  "Keep the text to one or two sentences with the conclusion; do not repeat every row of the card in the text.",
  "Show only data you read with tools in this conversation. Never invent tasks, events, ids, times or numbers; leave out a row you cannot back with data.",
  "taskId, eventId and Open ids must be real ids from tool results; the ids in the examples are placeholders. Use TaskRow for Work and Reminders, EventRow for events and blocks.",
  "Cards never change anything by themselves: ticking a TaskRow is the person's own action. Every write you make still goes through propose_changes, never through a card.",
  "When you ask a question with a few likely answers, end the reply with Choices (up to four short options in the person's language). Set pickTime when the answer is a date or time.",
  "Lay out each answer as one Card of grouped rows. A day is one Card: events, free time and timed tasks in time order, then untimed and done tasks, overdue ones last. Numbers go first in their card as Stats, then the ShareRow or BarChart rows that explain them. Add a second Card only for a different subject.",
  "At most two cards and twelve rows per card; for more, end the card with an Open link to the full list.",
  "Write times in the person's local time as 24-hour HH:MM, and every label in the person's language.",
  "Put the fence at the very end of the reply and close it. Never put the fence inside a proposal summary.",
];

const EXAMPLES = [
  `Five things today, and one overdue. You're free from 15:00 to 18:00.

\`\`\`${GENUI_FENCE}
root = Reply([day])
day = Card("Today · Sun 25 Oct", [gym, lunch, gap, invoice, plan, passport], "2 events · 3 tasks", open)
gym = EventRow("10:00", "Gym", "1 h", "teal")
lunch = EventRow("13:00", "Lunch with Sara", "1 h 30 min", "pink")
gap = FreeRow("15:00", "18:00")
invoice = TaskRow("tsk_8f2", "Send the Acme invoice", "17:00", "Client work")
plan = TaskRow("tsk_4a7", "Plan next week")
passport = TaskRow("tsk_1c9", "Renew passport", "Fri", "Overdue 2 days")
open = Open("Open Today", "today")
\`\`\``,
  `A good week: most tasks landed on time, and Wednesday carried the most focus.

\`\`\`${GENUI_FENCE}
root = Reply([week])
week = Card("This week · 19–25 Oct", [nums, p1, p2, p3], "3 projects", open)
nums = Stats([Stat("Tasks done", "18/22"), Stat("On time", "82%"), Stat("Focus", "9h 40m")])
p1 = ShareRow("Client work", "5 h 10 min", 100, "indigo")
p2 = ShareRow("Timely", "2 h 50 min", 55, "teal")
p3 = ShareRow("Personal", "1 h 40 min", 32, "orange")
open = Open("Open Dashboard", "dashboard")
\`\`\``,
  `When should I remind you to call the bank?

\`\`\`${GENUI_FENCE}
root = Reply([ask])
ask = Choices(["Today 17:00", "Today 20:00", "Tomorrow 09:00"], true)
\`\`\``,
];

const promptLibrary = () => createLibrary({ components: REPLY_COMPONENTS, root: GENUI_ROOT });

/** The model's instructions for reply cards (the API embeds this text). */
export function genuiPrompt(): string {
  return promptLibrary().prompt({ preamble: PREAMBLE, additionalRules: RULES, examples: EXAMPLES });
}

/** A parser for one fence's program, for checks outside a renderer. */
export function genuiParser() {
  return createParser(promptLibrary().toJSONSchema(), GENUI_ROOT);
}

/** A parsed component as renderers receive it in their props. */
export type GenuiNode = { type: "element"; typeName: string; props: Record<string, unknown> };

/** The components in a list prop; ones with missing required props arrive as null. */
export function genuiNodes(value: unknown): GenuiNode[] {
  return Array.isArray(value)
    ? value.filter((item): item is GenuiNode => Boolean(item) && (item as GenuiNode).type === "element")
    : [];
}

export type ReplyPart = { kind: "text"; text: string } | { kind: "ui"; code: string; closed: boolean };

// Fences open and close at the start of a line, as models write them.
const FENCE = new RegExp("(?:^|\\n)```" + GENUI_FENCE + "[ \\t]*\\n([\\s\\S]*?)(\\n```|$)", "g");

/**
 * A reply split into its text and its card programs, in order. An unclosed
 * fence (a reply cut short) still yields its program, marked `closed: false`.
 */
export function splitReply(content: string): ReplyPart[] {
  const parts: ReplyPart[] = [];
  let last = 0;
  for (const match of content.matchAll(FENCE)) {
    const text = content.slice(last, match.index).trim();
    if (text) parts.push({ kind: "text", text });
    parts.push({ kind: "ui", code: match[1].trim(), closed: match[2] !== "" });
    last = match.index + match[0].length;
  }
  const rest = content.slice(last).trim();
  if (rest) parts.push({ kind: "text", text: rest });
  return parts;
}

/** The reply without its card programs, for previews, copying and old clients. */
export function replyText(content: string): string {
  return splitReply(content)
    .flatMap((part) => (part.kind === "text" ? [part.text] : []))
    .join("\n\n");
}
