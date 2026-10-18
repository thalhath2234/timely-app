/**
 * Pure data for the auto-schedule replay: what a SchedulePlan looks like on
 * a week grid. Safe to import from the store and from server components.
 */
import type { SchedulePlan, ScheduleProposalBlock } from "@timely/contract/schedule";

export type ReplayBlock = {
  title: string;
  /** Column, 0 = the first day shown. */
  day: number;
  /** Start as hours since midnight, e.g. 9.5. */
  start: number;
  hours: number;
  color: string;
};

export type ReplayPlan = {
  /** Short labels for the columns, in order. */
  days: string[];
  /** First and last hour shown. */
  from: number;
  to: number;
  /** Blocks that arrive, in the order the engine placed them (by time). */
  placed: ReplayBlock[];
  /** Blocks that slide from where they were to where they are now. */
  moved: { from: ReplayBlock; to: ReplayBlock }[];
  /** Minutes placed in all, for the closing line. */
  minutes: number;
};

const PALETTE = ["#30a66d", "#ffb224", "#0090ff", "#e93d82", "#6e56cf", "#00a2c7", "#f76808", "#b8b7ff"];

const DAY = 24 * 60 * 60 * 1000;

function dayStart(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Builds the replay from an applied plan in the browser's zone; null when nothing moved or landed. */
export function replayFromSchedule(plan: SchedulePlan): ReplayPlan | null {
  const movedIds = new Set(plan.changes.filter((change) => change.action === "move" && change.before && change.after).map((change) => change.taskId));
  const raw: { title: string; block: ScheduleProposalBlock; taskIndex: number; kind: "placed" | "from" | "to" }[] = [];
  const taskIndex = new Map<string, number>();
  const indexOf = (id: string) => {
    if (!taskIndex.has(id)) taskIndex.set(id, taskIndex.size);
    return taskIndex.get(id)!;
  };
  for (const proposal of plan.proposals) {
    if (movedIds.has(proposal.taskId)) continue;
    for (const block of proposal.blocks) raw.push({ title: proposal.taskName, block, taskIndex: indexOf(proposal.taskId), kind: "placed" });
  }
  for (const change of plan.changes) {
    if (change.action !== "move" || !change.before || !change.after) continue;
    const index = indexOf(change.taskId);
    raw.push({ title: change.taskName, block: change.before, taskIndex: index, kind: "from" });
    raw.push({ title: change.taskName, block: change.after, taskIndex: index, kind: "to" });
  }
  if (raw.length === 0) return null;

  const starts = raw.map((item) => new Date(item.block.start));
  const ends = raw.map((item) => new Date(item.block.end));
  const first = dayStart(new Date(Math.min(...starts.map((d) => d.getTime()))));
  const last = dayStart(new Date(Math.max(...ends.map((d) => d.getTime()))));
  const dayCount = Math.min(7, Math.max(1, Math.round((last.getTime() - first.getTime()) / DAY) + 1));
  const days = Array.from({ length: dayCount }, (_, i) => new Date(first.getTime() + i * DAY).toLocaleDateString(undefined, { weekday: "short" }));
  const hourOf = (d: Date) => d.getHours() + d.getMinutes() / 60;
  const from = Math.max(0, Math.floor(Math.min(...starts.map(hourOf))) - 1);
  const to = Math.min(24, Math.ceil(Math.max(...ends.map((d) => (hourOf(d) === 0 ? 24 : hourOf(d))))) + 1);

  const toBlock = (item: (typeof raw)[number]): ReplayBlock | null => {
    const start = new Date(item.block.start);
    const end = new Date(item.block.end);
    const day = Math.round((dayStart(start).getTime() - first.getTime()) / DAY);
    if (day < 0 || day >= dayCount) return null;
    return { title: item.title, day, start: hourOf(start), hours: Math.max(0.25, (end.getTime() - start.getTime()) / (60 * 60 * 1000)), color: PALETTE[item.taskIndex % PALETTE.length] };
  };
  const placed = raw
    .filter((item) => item.kind === "placed")
    .sort((a, b) => a.block.start.localeCompare(b.block.start))
    .map(toBlock)
    .filter((block): block is ReplayBlock => block !== null);
  const moved: ReplayPlan["moved"] = [];
  for (const item of raw.filter((entry) => entry.kind === "from")) {
    const to = raw.find((entry) => entry.kind === "to" && entry.taskIndex === item.taskIndex);
    const a = toBlock(item);
    const b = to ? toBlock(to) : null;
    if (a && b) moved.push({ from: a, to: b });
  }
  const minutes = Math.round([...placed, ...moved.map((m) => m.to)].reduce((sum, block) => sum + block.hours * 60, 0));
  return { days, from, to, placed, moved, minutes };
}

/** A week as Studio shows it (`make film-studio`, composition ScheduleReplay). */
export const SAMPLE_REPLAY: ReplayPlan = {
  days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  from: 8,
  to: 18,
  placed: [
    { title: "Write release notes", day: 0, start: 10, hours: 1, color: "#30a66d" },
    { title: "Design the homepage", day: 1, start: 9, hours: 3, color: "#ffb224" },
    { title: "Fix build on Windows", day: 2, start: 9, hours: 2, color: "#30a66d" },
    { title: "Pick three case studies", day: 3, start: 14, hours: 1.5, color: "#6e56cf" },
  ],
  moved: [{ from: { title: "Record the demo", day: 3, start: 10, hours: 1, color: "#0090ff" }, to: { title: "Record the demo", day: 4, start: 10, hours: 1, color: "#0090ff" } }],
  minutes: 510,
};
