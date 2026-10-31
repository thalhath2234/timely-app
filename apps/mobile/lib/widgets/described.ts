/**
 * A described card (Describe a card, ADR 0014) as a home screen widget. The
 * widget can't run the phone kit's views, so it draws the card's program
 * from the same data with drawBoard, as the Dashboard does, and folds the
 * drawing into a WidgetModel: the first stats become the figure, the rows
 * of its lists and cards become rows with working ticks, a bar chart becomes
 * bars, shares become meters and text becomes the note. Pure, so
 * `make test-mobile-widgets` runs it under Node.
 */
import { fitQuery, type DashboardData } from "@timely/contract/dashboard";
import { checklistItems, findChecklistItem, type DocChecklistItem } from "@timely/contract/docChecklist";
import { genuiColorHex, genuiNodes, replyBlocks, type GenuiNode } from "@timely/contract/genui";
import { blockProblems, chartQueries, dataCardQuery, drawBoard, type ChartQuery } from "@timely/contract/genuiBoard";
import { isOverdue, todayInZone } from "@timely/contract/workStatus";
import type { WidgetModel, WidgetRow, WidgetTone } from "./model";

type Input = { now: Date; data: DashboardData; timeZone?: string; scheme: string };

const ROWS = 8;
const METERS = 5;
const BARS = 8;
// A tap's data goes to the app through Android's WorkManager, which takes at
// most 10 KB; an item longer than this opens its doc instead of ticking.
const TICK_TEXT = 1000;

const SCREENS: Record<string, string> = {
  today: "today",
  calendar: "calendar",
  tasks: "tasks",
  inbox: "inbox",
  dashboard: "dashboard",
};

const PLACES: Record<string, string> = { task: "tasks", project: "projects", doc: "docs", sheet: "sheets" };

const text = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");

/** Where an Open link goes on the phone, or "" when it has nowhere to go. */
function openPath(open: GenuiNode | undefined) {
  if (!open || open.typeName !== "Open") return "";
  const target = text(open.props.target);
  const id = text(open.props.id);
  if (SCREENS[target]) return SCREENS[target];
  return PLACES[target] && id ? `${PLACES[target]}/${encodeURIComponent(id)}` : "";
}

const TIME_GROUPS = new Set(["day", "week", "month"]);

/**
 * Where a chart's bars start when it has more than the widget shows. A time
 * series keeps the bars that end now, as the widget's plain charts do: the
 * latest ones of a range in the past, today's first of one ahead, and up to
 * today in this month by day. A sheet's latest entries keep their last rows.
 * Anything else, such as a chart sorted largest first, keeps its first bars.
 */
function barsStart(query: ChartQuery | undefined, count: number, today: string, source: DashboardData): number {
  if (count <= BARS) return 0;
  const latest = count - BARS;
  // The bars come from the query @Data runs (runData), which can regroup a time the
  // range can't hold or turn "next" into "last" for dates that are only ever past.
  const series = query?.data?.by ? fitQuery({ ...dataCardQuery(query.data, source), display: "bar", groupBy: query.data.by }) : undefined;
  if (series && TIME_GROUPS.has(series.groupBy)) {
    const range = series.range.preset;
    if (range.startsWith("next")) return 0;
    if (range === "thisMonth" && series.groupBy === "day") return Math.max(0, Math.min(latest, Number(today.slice(8, 10)) - BARS));
    return latest;
  }
  const cells = query?.cells;
  return cells?.last && !cells.sort ? latest : 0;
}

/** The blocks of a Panel in order, with Columns opened into their cards. */
function blocksOf(root: GenuiNode): GenuiNode[] {
  return replyBlocks(root.props.blocks).flatMap((block) => (block.typeName === "Columns" ? genuiNodes(block.props.cards) : [block]));
}

export function describedModel(program: string, input: Input, title: string): WidgetModel {
  const link = (path: string) => `${input.scheme}://${path}`;
  let root: GenuiNode | null = null;
  try {
    root = drawBoard(program, input.data, { now: input.now, timeZone: input.timeZone });
  } catch {
    root = null;
  }
  if (!root || root.typeName !== "Panel") return { title, uri: link("dashboard"), empty: "Open the Dashboard to see this card." };

  // Ticks show tasks and checklist items as they are now, as the Dashboard's rows do.
  const today = todayInZone(input.timeZone, input.now);
  const tasks = new Map([...(input.data.tasks ?? []), ...(input.data.reminders ?? []), ...(input.data.inbox ?? [])].map((task) => [task.id, task]));
  const checklists = new Map<string, DocChecklistItem[] | undefined>();
  const checklist = (docId: string) => {
    if (!checklists.has(docId)) {
      const doc = input.data.docs?.find((entry) => entry.id === docId);
      checklists.set(docId, doc ? checklistItems(doc.content) : undefined);
    }
    return checklists.get(docId);
  };

  function row(node: GenuiNode): WidgetRow | null {
    const p = node.props;
    switch (node.typeName) {
      case "TaskRow": {
        const id = text(p.taskId);
        const task = tasks.get(id);
        const done = Boolean(task?.completedAt);
        const late = task ? isOverdue(task, today) && !done : false;
        return {
          title: task?.name || text(p.title),
          meta: done ? "Done" : [text(p.time), text(p.note)].filter(Boolean).join(" · ") || undefined,
          tone: late ? "danger" : "default",
          uri: link(`tasks/${encodeURIComponent(id)}`),
          ...(task ? { done, toggle: { kind: "task" as const, taskId: id, done: !done } } : {}),
        };
      }
      case "CheckRow": {
        const docId = text(p.docId);
        const items = checklist(docId);
        const item = items ? findChecklistItem(items, text(p.text), typeof p.item === "number" ? p.item : undefined) : undefined;
        const done = Boolean(item?.done);
        return {
          title: item?.text ?? text(p.text),
          meta: text(p.note) || undefined,
          uri: link(`docs/${encodeURIComponent(docId)}`),
          ...(item ? { done } : {}),
          ...(item && item.text.length <= TICK_TEXT ? { toggle: { kind: "checkItem" as const, docId, item: item.item, text: item.text, done: !done } } : {}),
        };
      }
      case "EventRow":
        return {
          title: text(p.title),
          meta: [text(p.time), text(p.length)].filter(Boolean).join(" · ") || undefined,
          color: genuiColorHex(text(p.color)),
          ...(text(p.eventId) ? { uri: link(`events/${encodeURIComponent(text(p.eventId))}`) } : {}),
        };
      case "InfoRow": {
        const tone: WidgetTone = p.tone === "warning" ? "danger" : p.tone === "success" ? "success" : "default";
        return { title: text(p.label), meta: [text(p.value), text(p.note)].filter(Boolean).join(" · ") || undefined, tone };
      }
      case "FreeRow":
        return { title: `Free until ${text(p.to)}`, meta: text(p.from), tone: "muted" };
      default:
        return null;
    }
  }

  const model: WidgetModel = { title, uri: link("dashboard") };
  const rows: WidgetRow[] = [];
  const meters: NonNullable<WidgetModel["meters"]> = [];
  const notes: string[] = [];
  let empty = "";
  const take = (list: unknown, open?: unknown) => {
    for (const node of genuiNodes(list)) {
      if (node.typeName === "ShareRow") {
        const share = Math.max(0, Math.min(100, Number(node.props.share) || 0));
        meters.push({ label: text(node.props.label), value: share / 100, detail: text(node.props.value) });
        continue;
      }
      // A Card's rows can hold Stats, a BarChart and Text too (genui.ts Card).
      if (node.typeName === "Stats" || node.typeName === "BarChart" || node.typeName === "Text") {
        block(node);
        continue;
      }
      const drawn = row(node);
      if (drawn) rows.push(drawn);
    }
    // The first Open link is where a tap on the widget goes, as on the card.
    const path = openPath(open as GenuiNode | undefined);
    if (path && model.uri === link("dashboard")) model.uri = link(path);
  };

  function block(node: GenuiNode) {
    const p = node.props;
    switch (node.typeName) {
      case "Stats": {
        if (model.value !== undefined) break;
        const [first, ...rest] = genuiNodes(p.items);
        if (!first) break;
        model.value = text(first.props.value);
        model.caption = [text(first.props.label), ...rest.map((stat) => `${text(stat.props.value)} ${text(stat.props.label)}`)].filter(Boolean).join(" · ");
        model.captionTone = "muted";
        break;
      }
      case "List":
        if (!genuiNodes(p.rows).length && text(p.empty)) empty ||= text(p.empty);
        take(p.rows, p.open);
        break;
      case "Card":
        take(p.rows, p.open);
        break;
      case "BarChart": {
        if (model.bars) break;
        const all = (Array.isArray(p.values) ? p.values : []).map((value) => Number(value) || 0);
        const labels = Array.isArray(p.labels) ? p.labels.map(text) : [];
        let query: ChartQuery | undefined;
        try {
          // The drawn chart's own query: one that drew empty isn't drawn, so match by statement or title.
          const charts = chartQueries(program);
          const statementId = (node as GenuiNode & { statementId?: string }).statementId;
          query =
            (statementId ? charts.find((chart) => chart.statementId === statementId) : undefined) ??
            charts.find((chart) => chart.title !== undefined && chart.title === text(p.title)) ??
            (charts.length === 1 ? charts[0] : undefined);
        } catch {
          query = undefined;
        }
        const start = barsStart(query, all.length, today, input.data);
        const values = all.slice(start, start + BARS);
        const max = Math.max(...values, 0);
        const highlight = text(p.highlight);
        model.bars = values.map((value, index) => ({
          label: labels[start + index] ?? "",
          value,
          highlight: highlight ? labels[start + index] === highlight : value === max && max > 0,
        }));
        break;
      }
      case "DayStrip":
        for (const slot of genuiNodes(p.slots)) {
          const label = slot.props.kind === "free" ? text(slot.props.label) || "Free" : text(slot.props.label);
          rows.push({ title: label || text(slot.props.kind), meta: `${text(slot.props.from)}–${text(slot.props.to)}`, tone: slot.props.kind === "free" ? "muted" : "default" });
        }
        break;
      case "Text":
        if (text(p.text)) notes.push(text(p.text));
        break;
    }
  }
  blocksOf(root).forEach(block);

  if (rows.length) model.rows = rows.slice(0, ROWS);
  if (meters.length) model.meters = meters.slice(0, METERS);
  if (notes.length && !rows.length) model.note = notes.join("\n");
  if (model.bars && !model.bars.length) delete model.bars;
  // A doc or sheet the program names but can't find says so, as on the Dashboard,
  // instead of reading as an empty list ("Everything is ticked off").
  let problem = "";
  try {
    problem = blockProblems(program, input.data)[0] ?? "";
  } catch {
    problem = "";
  }
  if (problem && !rows.length) model.note = problem;
  if (!rows.length && !meters.length && !model.bars && !model.note) {
    const nothing = empty || (model.value ? "" : "Nothing here yet.");
    if (nothing) model.empty = nothing;
  }
  return model;
}
