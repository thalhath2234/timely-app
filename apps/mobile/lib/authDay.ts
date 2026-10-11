/**
 * The day shown beside sign-in and onboarding, as on the web
 * (`apps/web/app/_components/auth/sampleDay.ts` and `clock.ts`).
 */

/** Project colours, from `entityColor.ts`, plus the "now" lavender of the landing page. */
export const DAY_COLORS = {
  now: "#c0c1ff",
  green: "#30a66d",
  violet: "#6e56cf",
  amber: "#ffb224",
  blue: "#0090ff",
  pink: "#e93d82",
  cyan: "#00a2c7",
  red: "#e5484d",
} as const;

export type DayBlock = {
  id: string;
  title: string;
  /** Minutes from now. */
  at: number;
  length: number;
  color: string;
  now?: boolean;
  tag?: { name: string; color: string };
};

/** Local minutes since midnight. */
export function minuteOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

/** "HH:MM" for minutes since midnight, wrapping past 24:00. */
export function clock(minutes: number) {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

function isoWeek(date: Date) {
  const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return Math.ceil(((day.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sun 11 Oct · Week 41". */
export function dateLine(date: Date) {
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} · Week ${isoWeek(date)}`;
}

/** Start minute of a block: the now block at the real time, the rest from the next quarter hour. */
export function blockStart(block: DayBlock, now: number) {
  if (block.now) return now + block.at;
  return Math.ceil((now + 1) / 15) * 15 + block.at;
}

const LABEL_TASKS: Record<string, [string, number]> = {
  Urgent: ["Renew the passport", 30],
  Waiting: ["Hear back from the printer", 20],
  "Quick win": ["Book the dentist", 15],
  "Deep work": ["Deep work: launch brief", 90],
  Meeting: ["Team sync", 30],
  "Follow up": ["Follow up with Alex", 20],
  Admin: ["Expense report", 30],
  Errand: ["Pick up the parcel", 25],
  Bills: ["Pay the electricity bill", 15],
  Family: ["Call mum", 30],
  Health: ["Doctor's appointment", 45],
  Workout: ["Gym: legs day", 60],
  Reading: ["Read chapter 4", 45],
  Exam: ["Revise for the stats exam", 90],
  Assignment: ["Essay draft due", 60],
  Research: ["Collect sources", 45],
  Clients: ["Call with Northwind", 30],
  Invoices: ["Send October invoices", 25],
  Marketing: ["Plan the newsletter", 45],
  Sales: ["Demo for a new lead", 30],
  Hiring: ["Interview a designer", 45],
  "1:1": ["1:1 with Priya", 30],
  Review: ["Review the draft", 30],
  Ideas: ["Sketch new ideas", 30],
  Draft: ["First draft of the story", 60],
  "Home repair": ["Fix the kitchen tap", 45],
  Shopping: ["Weekly shop", 40],
  Learning: ["Spanish lesson", 45],
};

/** One example block per picked starter label, after a "Set up Timely" block at now. */
export function onboardingDay(labels: { name: string; color: string }[], max = 5): DayBlock[] {
  const blocks: DayBlock[] = [{ id: "now", title: "Set up Timely", at: 0, length: 20, color: DAY_COLORS.now, now: true }];
  let at = 20;
  for (const label of labels.slice(0, max)) {
    const [title, length] = LABEL_TASKS[label.name] ?? [label.name, 30];
    blocks.push({ id: `label-${label.name}`, title, at, length, color: label.color, tag: label });
    at += length + 10;
  }
  return blocks;
}
