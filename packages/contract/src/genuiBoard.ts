import { createLibrary, createParser, defineComponent, defineFunction, evaluateRoot } from "@openuidev/lang-core";
import { z } from "zod/v4";
import {
  RANGE_LABELS,
  SOURCE_CAPABILITIES,
  buildLookups,
  computeCard,
  defaultCardSize,
  defaultQuery,
  fitQuery,
  formatMetric,
  shortDay,
  type CardDateField,
  type CardFilters,
  type CardGroupBy,
  type CardQuery,
  type CardRangePreset,
  type CardRow,
  type CardSortField,
  type CardSource,
  type DashboardCard,
  type DashboardData,
  type EngineContext,
} from "./dashboard";
import { formatLike } from "./dashboardFiles";
import { GENUI_COMPONENTS, type GenuiNode } from "./genui";
import type { Sheet } from "./sheet";
import { cellIs, cellsTable, closestValue, columnByName, columnValues, nameKey, tabByName, type CellsTable } from "./sheetCells";
import { daysBetween, todayInZone } from "./workStatus";

/**
 * Described cards: dashboard cards the agent builds from the person's words
 * ("overdue client work and what's due this week"). The model writes one
 * OpenUI Lang program over the reply-card kit (genui.ts), and every number,
 * row and bar in it comes from an `@Data(...)` call. The apps answer those
 * calls from the data the dashboard already loaded, through the same engine
 * as custom cards (`computeCard`), so a described card stays live and never
 * asks the model again once it is on the board.
 *
 * The card is saved as a custom card whose query is the nearest plain card
 * plus `described` (see `describedCard`): clients without described cards
 * draw the plain card and keep the program when they save the layout.
 * `make gen-genui-prompt` writes the model's instructions for the API.
 */

export const BOARD_ROOT = "Panel";

/** Sizes the model may ask for, in grid columns and rows. */
export const BOARD_SIZES = {
  small: { w: 3, h: 2 },
  medium: { w: 4, h: 3 },
  tall: { w: 4, h: 5 },
  wide: { w: 6, h: 3 },
  large: { w: 6, h: 5 },
} as const;
export type BoardSize = keyof typeof BOARD_SIZES;

const { Card, Columns, Stats, Stat, TaskRow, EventRow, InfoRow, ShareRow, BarChart, DayStrip, Slot, Text, Open } = GENUI_COMPONENTS;

const List = defineComponent({
  name: "List",
  description: "Rows straight on the card, without a heading; shows the empty text when there are none.",
  props: z.object({
    rows: z.array(z.union([TaskRow.ref, EventRow.ref, InfoRow.ref, ShareRow.ref])),
    empty: z.string().optional().describe("e.g. Nothing overdue"),
    open: z.optional(Open.ref),
  }),
  component: null,
});

const Panel = defineComponent({
  name: "Panel",
  description: "The root: the card's name, its blocks from top to bottom, and its size on the board.",
  props: z.object({
    title: z.string().describe("Short, e.g. Overdue client work"),
    blocks: z.array(z.union([Stats.ref, List.ref, Card.ref, Columns.ref, BarChart.ref, DayStrip.ref, Text.ref])),
    size: z.enum(Object.keys(BOARD_SIZES) as [BoardSize, ...BoardSize[]]).optional(),
  }),
  component: null,
});

export const BOARD_COMPONENTS = {
  Panel,
  List,
  Card,
  Columns,
  Stats,
  Stat,
  TaskRow,
  EventRow,
  InfoRow,
  ShareRow,
  BarChart,
  DayStrip,
  Slot,
  Text,
  Open,
};
export type BoardName = keyof typeof BOARD_COMPONENTS;
export type BoardProps<N extends BoardName> = z.infer<(typeof BOARD_COMPONENTS)[N]["props"]>;

/** The board components with an app's renderers, ready for its `createLibrary`. */
export function withBoardRenderers<R extends Record<BoardName, unknown>>(renderers: R) {
  return (Object.keys(BOARD_COMPONENTS) as BoardName[]).map((name) => ({
    ...BOARD_COMPONENTS[name],
    component: renderers[name] as R[BoardName],
  }));
}

// ---- @Data ----

const SOURCES = ["tasks", "reminders", "inbox", "projects", "events", "docs", "sheets"] as const satisfies readonly CardSource[];
const DATES = ["deadline", "completedAt", "scheduled", "start", "startDate", "createdAt", "updatedAt"] as const satisfies readonly CardDateField[];
const RANGES = Object.keys(RANGE_LABELS).filter((preset) => preset !== "custom") as [CardRangePreset, ...CardRangePreset[]];
const GROUPS = ["project", "workspace", "status", "priority", "label", "stage", "state", "due", "day", "week", "month", "weekday"] as const satisfies readonly CardGroupBy[];
const SORTS = ["deadline", "start", "name", "priority", "completedAt", "createdAt", "updatedAt"] as const satisfies readonly CardSortField[];

const DataQuery = z.object({
  source: z.enum(SOURCES),
  state: z.enum(["open", "done", "all"]).optional(),
  overdue: z.boolean().optional(),
  hasDeadline: z.boolean().optional(),
  project: z.string().optional(),
  workspace: z.string().optional(),
  label: z.string().optional(),
  status: z.string().optional(),
  priority: z.enum(["Urgent", "High", "Medium", "Low"]).optional(),
  text: z.string().optional(),
  date: z.enum(DATES).optional(),
  range: z.enum(RANGES).optional(),
  measure: z.enum(["count", "estimate", "tracked", "duration"]).optional(),
  by: z.enum(GROUPS).optional(),
  sort: z.enum(SORTS).optional(),
  desc: z.boolean().optional(),
  limit: z.number().optional(),
});
export type DataQuery = z.infer<typeof DataQuery>;

const DataRow = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  day: z.string(),
  time: z.string(),
  length: z.string(),
  note: z.string(),
  done: z.boolean(),
  late: z.boolean(),
});
const DataGroup = z.object({ label: z.string(), value: z.number(), text: z.string(), share: z.number() });
const DataResult = z.object({
  value: z.number(),
  text: z.string(),
  change: z.string(),
  done: z.number(),
  all: z.number(),
  percent: z.number(),
  ratio: z.string(),
  rows: z.array(DataRow),
  more: z.number(),
  labels: z.array(z.string()),
  values: z.array(z.number()),
  groups: z.array(DataGroup),
});
export type DataResult = z.infer<typeof DataResult>;

const Data = defineFunction({
  name: "Data",
  description:
    "Reads the person's live data. value/text: how many match (or the hours, with measure). change: against the period before the range. done/all/percent/ratio: done out of all that match, ignoring state. rows: the first matches (sort, limit). groups, labels, values: the matches split by `by`.",
  params: z.object({ query: DataQuery }),
  returns: DataResult,
  // Apps bind it to their data with boardFunctions.
  fn: () => emptyResult(),
});

function emptyResult(): DataResult {
  return { value: 0, text: "0", change: "", done: 0, all: 0, percent: 0, ratio: "0/0", rows: [], more: 0, labels: [], values: [], groups: [] };
}

const DATEY_SORTS = new Set<string>(["completedAt", "createdAt", "updatedAt"]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Ids for a name in a lookup; a name that matches nothing keeps the filter, so nothing matches. */
function idsFor(names: Map<string, string>, name: string | undefined): string[] | undefined {
  const wanted = name?.trim().toLowerCase();
  if (!wanted) return undefined;
  const ids = [...names].filter(([, value]) => value.trim().toLowerCase() === wanted).map(([id]) => id);
  return ids.length ? ids : ["__no_match__"];
}

/** The date a range reads when the program names a range but no date. */
function dateFor(query: DataQuery): CardDateField | undefined {
  if (query.date) return query.date;
  if (!query.range || query.range === "all") return undefined;
  switch (query.source) {
    case "events":
      return "start";
    case "docs":
    case "sheets":
      return "updatedAt";
    case "inbox":
      return "createdAt";
    case "reminders":
      return query.state === "done" ? "completedAt" : "scheduled";
    default:
      return query.state === "done" ? "completedAt" : "deadline";
  }
}

/** The plain card query an `@Data` call reads. */
export function dataCardQuery(query: DataQuery, data: DashboardData): CardQuery {
  const base = defaultQuery(query.source);
  const lookups = buildLookups(data);
  const filters: CardFilters = { ...base.filters };
  if (query.state) filters.state = query.state;
  if (query.overdue !== undefined) filters.overdue = query.overdue;
  if (query.hasDeadline !== undefined) filters.hasDeadline = query.hasDeadline;
  if (query.priority) filters.priorities = [query.priority];
  if (query.text?.trim()) filters.text = query.text.trim();
  const named: [keyof CardFilters, Map<string, string>, string | undefined][] = [
    ["projectIds", lookups.projects, query.project],
    ["workspaceIds", lookups.workspaces, query.workspace],
    ["labelIds", lookups.labels, query.label],
    ["statusIds", lookups.statuses, query.status],
  ];
  for (const [key, names, name] of named) {
    const ids = idsFor(names, name);
    if (ids) (filters as Record<string, unknown>)[key] = ids;
  }
  const sortField = query.sort ?? base.sort?.field ?? "name";
  const dir = query.desc === undefined ? (DATEY_SORTS.has(sortField) ? "desc" : "asc") : query.desc ? "desc" : "asc";
  return fitQuery({
    ...base,
    measure: query.measure ?? "count",
    dateField: dateFor(query) ?? base.dateField,
    range: { preset: query.range ?? "all" },
    groupBy: query.by ?? "none",
    filters,
    sort: { field: sortField, dir },
    limit: query.limit ?? 8,
  });
}

/** A day as a row shows it: Today, a weekday for the next six days, else a date. */
function rowDay(day: string | undefined, today: string): string {
  if (!day) return "";
  const diff = daysBetween(today, day);
  if (diff === 0) return "Today";
  if (diff > 0 && diff < 7) {
    const [year, month, date] = day.split("-").map(Number);
    return WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()];
  }
  const [, month, date] = day.split("-").map(Number);
  return `${date} ${MONTHS[month - 1]}`;
}

function rowTime(at: string | undefined, timeZone?: string): string {
  if (!at) return "";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
}

/** Minutes as the reply cards write lengths: 45 min, 1 h, 1 h 30 min. */
export function lengthText(minutes: number | undefined): string {
  if (!minutes || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function dataRow(row: CardRow, today: string, timeZone?: string) {
  return {
    id: row.id,
    kind: row.entity,
    title: row.title,
    day: rowDay(row.day, today),
    time: rowTime(row.at, timeZone),
    length: lengthText(row.minutes),
    note: row.subtitle ?? "",
    done: Boolean(row.done),
    late: Boolean(row.overdue),
  };
}

/** Answers one `@Data` call from the dashboard's data. */
export function runData(query: DataQuery, data: DashboardData, ctx: EngineContext): DataResult {
  const card = dataCardQuery(query, data);
  const today = todayInZone(ctx.timeZone, ctx.now);
  const result = emptyResult();

  const number = computeCard({ ...card, display: "number", compare: true }, data, ctx);
  if (number.kind === "number") {
    result.value = number.value;
    result.text = formatMetric(number.value, number.unit);
    if (number.previous !== undefined && number.periodLabel) {
      const diff = Math.round((number.value - number.previous) * 10) / 10;
      result.change = diff === 0 ? `Same as ${number.periodLabel.replace(/^vs /, "")}` : `${diff > 0 ? "+" : "−"}${formatMetric(Math.abs(diff), number.unit)} ${number.periodLabel}`;
    }
  }

  if (SOURCE_CAPABILITIES[card.source].completable) {
    const progress = computeCard({ ...card, display: "progress", progress: "completion" }, data, ctx);
    if (progress.kind === "progress") {
      result.done = progress.value;
      result.all = progress.target;
      result.percent = progress.target ? Math.round((progress.value / progress.target) * 100) : 0;
      result.ratio = `${formatMetric(progress.value, progress.unit)}/${formatMetric(progress.target, progress.unit)}`;
    }
  }

  const list = computeCard({ ...card, display: "list" }, data, ctx);
  if (list.kind === "list") {
    result.rows = list.rows.map((row) => dataRow(row, today, ctx.timeZone));
    result.more = Math.max(0, list.total - list.rows.length);
  }

  if (query.by) {
    const series = computeCard({ ...card, display: "bar", groupBy: query.by }, data, ctx);
    if (series.kind === "series") {
      const max = Math.max(0, ...series.points.map((point) => point.value)) || 1;
      // A week or less of days reads better as weekdays.
      const weekdays = query.by === "day" && series.points.length <= 7;
      result.groups = series.points.map((point) => ({
        label: weekdays && /^\d{4}-\d{2}-\d{2}$/.test(point.key) ? WEEKDAYS[new Date(`${point.key}T00:00:00Z`).getUTCDay()] : point.label,
        value: point.value,
        text: formatMetric(point.value, series.unit),
        share: Math.round((point.value / max) * 100),
      }));
      result.labels = result.groups.map((group) => group.label);
      result.values = result.groups.map((group) => group.value);
    }
  }
  return result;
}

// ---- @Cells ----

const CellsQuery = z.object({
  sheet: z.string(),
  tab: z.string().optional(),
  label: z.string().optional(),
  value: z.string().optional(),
  where: z.string().optional(),
  is: z.string().optional(),
  group: z.boolean().optional(),
  sort: z.enum(["value", "label"]).optional(),
  desc: z.boolean().optional(),
  last: z.boolean().optional(),
  limit: z.number().optional(),
});
export type CellsQuery = z.infer<typeof CellsQuery>;

const CellsRow = z.object({ label: z.string(), value: z.number(), text: z.string(), share: z.number() });
const CellsResult = z.object({
  sheetId: z.string(),
  value: z.number(),
  text: z.string(),
  average: z.string(),
  last: z.string(),
  count: z.number(),
  rows: z.array(CellsRow),
  more: z.number(),
  labels: z.array(z.string()),
  values: z.array(z.number()),
});
export type CellsResult = z.infer<typeof CellsResult>;

const Cells = defineFunction({
  name: "Cells",
  description:
    "Reads a sheet's cells, worked out as the sheet shows them. sheet and tab (left out: the first tab) are names from the person's sheets; label is the column that names each row, value the column of numbers (left out: the first one). where/is keep the rows whose cell in that column holds that value, written as the sheets below list it (no is: any text). group: rows with the same label add up into one. sort: value (largest first) or label; desc flips it. last: the last rows, the latest entries, instead of the first. limit: rows to keep (12). value/text: the value column's total over the matching rows; average; last: the bottom row's value; count: how many rows match. A value column of text counts rows instead (with group: how many rows have each label). rows, labels, values: the kept rows. sheetId opens the sheet.",
  params: z.object({ query: CellsQuery }),
  returns: CellsResult,
  // Apps bind it to their data with boardFunctions.
  fn: () => emptyCells(),
});

/** A Stat with nothing to show, rather than a label under a blank. */
const NONE = "–";

function emptyCells(): CellsResult {
  return { sheetId: "", value: 0, text: "0", average: NONE, last: NONE, count: 0, rows: [], more: 0, labels: [], values: [] };
}

const round = (value: number) => Math.round(value * 1e9) / 1e9;

/** The sheet a name means: the latest edited of those with the name, archived ones left out. */
function sheetByName(sheets: Sheet[] | undefined, name: string): Sheet | undefined {
  const wanted = nameKey(name);
  return (sheets ?? [])
    .filter((sheet) => !sheet.archivedAt && nameKey(sheet.title ?? "") === wanted)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
}

type FoundCells = { sheet?: Sheet; table?: CellsTable; labelCol: number; valueCol: number; whereCol: number; missing: string };

/**
 * What a `@Cells` call names: the sheet, its tab and the columns. missing
 * says, in the person's words, which name matches nothing, or which `is`
 * value is a near miss of one the column holds ("Grocery" for "Groceries");
 * a tab with nothing in it is not missing, only empty, and an `is` value
 * nothing like the column's ("yes" in a column of "no") only matches no rows yet.
 */
function findCells(query: CellsQuery, data: DashboardData): FoundCells {
  const found: FoundCells = { labelCol: -1, valueCol: -1, whereCol: -1, missing: "" };
  const name = query.sheet?.trim() ?? "";
  const sheet = sheetByName(data.sheets, name);
  if (!sheet) return { ...found, missing: `No sheet is called “${name}”.` };
  found.sheet = sheet;
  const title = sheet.title?.trim() || name;
  const tab = tabByName(sheet, query.tab);
  if (!tab) return query.tab?.trim() ? { ...found, missing: `“${title}” has no tab called “${query.tab.trim()}”.` } : found;
  const table = cellsTable(sheet, tab);
  if (!table) return found;
  found.table = table;
  const named = (wanted: string | undefined, fallback: number) => (wanted?.trim() ? columnByName(table, wanted) : fallback);
  found.labelCol = named(query.label, table.labelCol);
  found.valueCol = named(
    query.value,
    table.columns.findIndex((column, index) => column.numbers && index !== found.labelCol),
  );
  found.whereCol = named(query.where, -1);
  const lost = [query.label, query.value, query.where].find((wanted) => wanted?.trim() && columnByName(table, wanted) < 0);
  if (lost) found.missing = `“${title}” has no column called “${lost.trim()}”.`;
  else if (found.valueCol < 0) found.missing = `“${title}” has no column of numbers.`;
  else if (found.whereCol >= 0 && query.is?.trim()) {
    const holds = cellIs(query.is);
    if (!table.rows.some((row) => holds(row[found.whereCol]))) {
      const near = closestValue(columnValues(table, found.whereCol), query.is);
      if (near) found.missing = `“${title}” has no ${table.columns[found.whereCol].name} called “${query.is.trim()}”. The closest is “${near}”.`;
    }
  }
  return found;
}

/**
 * Answers one `@Cells` call from the sheets the app loaded. A sheet, tab or
 * column name that matches nothing answers with nothing, as `@Data` does for
 * a name that fits no project, so a wrong name shows an empty block, never
 * another column's numbers; cellsProblems says what is missing.
 */
export function runCells(query: CellsQuery, data: DashboardData): CellsResult {
  const result = emptyCells();
  const { sheet, table, labelCol, valueCol, whereCol, missing } = findCells(query, data);
  result.sheetId = sheet?.id ?? "";
  if (!table || missing) return result;
  const { column, numbers } = table.columns[valueCol];
  // A column of text counts its rows instead: grouped, how many have each label.
  const counting = !numbers;
  const shown = (value: number) => (counting ? String(value) : formatLike(value, column));

  const holds = query.is === undefined ? null : cellIs(query.is);
  const matching = table.rows.filter((row) => {
    if (whereCol < 0) return true;
    return holds ? holds(row[whereCol]) : (row[whereCol]?.text.trim() ?? "") !== "";
  });
  type Entry = { label: string; value: number; text: string; number: boolean };
  let entries: Entry[] = matching
    .map((row) => {
      const cell = row[valueCol];
      const label = labelCol >= 0 ? (row[labelCol]?.text.trim() ?? "") : (cell?.address.replace(/^[A-Z]+/, "") ?? "");
      const number = cell?.number ?? null;
      return { label, value: counting ? 1 : (number ?? 0), text: cell?.text.trim() ?? "", number: counting || number !== null };
    })
    .filter((entry) => entry.text !== "");

  const counted = entries.filter((entry) => entry.number);
  const total = round(counted.reduce((sum, entry) => sum + entry.value, 0));
  result.count = entries.length;
  result.value = total;
  result.text = shown(total);
  // Two places at most: a column without a number format would show every digit.
  result.average = !counting && counted.length ? formatLike(Math.round((total / counted.length) * 100) / 100, column) : NONE;
  result.last = entries[entries.length - 1]?.text ?? NONE;

  if (query.group) {
    const groups = new Map<string, Entry>();
    for (const entry of entries) {
      const key = nameKey(entry.label);
      const group = groups.get(key);
      if (group) group.value = round(group.value + entry.value);
      else groups.set(key, { ...entry });
    }
    entries = [...groups.values()].map((entry) => ({ ...entry, text: shown(entry.value) }));
  }
  const limit = Math.max(1, Math.min(50, Math.round(query.limit ?? 12)));
  if (query.last) entries = entries.slice(-limit);
  if (query.sort) {
    const byValue = query.sort === "value";
    const dir = (query.desc ?? byValue) ? -1 : 1;
    entries = [...entries].sort((a, b) => dir * (byValue ? a.value - b.value : a.label.localeCompare(b.label, undefined, { numeric: true })));
  }
  result.more = Math.max(0, entries.length - limit);
  entries = entries.slice(0, limit);
  const max = Math.max(0, ...entries.map((entry) => entry.value)) || 1;
  result.rows = entries.map((entry) => ({
    label: entry.label,
    value: entry.value,
    text: entry.text,
    share: Math.max(0, Math.min(100, Math.round((entry.value / max) * 100))),
  }));
  result.labels = result.rows.map((row) => row.label);
  result.values = result.rows.map((row) => row.value);
  return result;
}

/**
 * The board's functions over one copy of the data. Programs repeat the same
 * call in several props, so answers are kept for as long as this data is.
 */
export function boardFunctions(data: DashboardData, ctx: EngineContext) {
  const answers = new Map<string, DataResult>();
  const cells = new Map<string, CellsResult>();
  return [
    {
      ...Data,
      fn: ({ query }: { query: DataQuery }) => {
        const key = JSON.stringify(query);
        let answer = answers.get(key);
        if (!answer) {
          answer = runData(query, data, ctx);
          answers.set(key, answer);
        }
        return answer;
      },
    },
    {
      ...Cells,
      fn: ({ query }: { query: CellsQuery }) => {
        const key = JSON.stringify(query);
        let answer = cells.get(key);
        if (!answer) {
          answer = runCells(query, data);
          cells.set(key, answer);
        }
        return answer;
      },
    },
  ];
}

// ---- The model's instructions ----

const PREAMBLE = `You build one card for the person's Timely dashboard from their words. Answer with ONE OpenUI Lang program and nothing else: no text before or after it and no code fence. Timely draws it with its own components and fills every @Data and @Cells call from the person's live data each time the dashboard shows, so the card stays current without you.`;

const RULES = [
  "Every number, row, bar and share comes from @Data or @Cells. Never write the person's tasks, events, names or numbers yourself; labels and empty texts are the only words you write.",
  "A sheet's cells come from @Cells, never @Data: sheet, tab and column names exactly as in the person's sheets below, and an is value one of the values listed for that column (\"October\", not \"Oct\"). Chart them with BarChart(title, c.labels, c.values); list them with @Each(c.rows, \"r\", InfoRow(r.label, r.text)) or ShareRow(r.label, r.text, r.share).",
  "Pick the blocks that answer the words: counts as Stats, items as a List of TaskRow or EventRow rows made with @Each, a split as a BarChart or a List of ShareRow rows, two views side by side as Columns of Cards.",
  "TaskRow(t.id, t.title, t.day, t.note) for tasks, reminders and inbox; EventRow(e.time, e.title, e.day + \" · \" + e.length) for events; InfoRow(p.title, p.day) for projects, docs and sheets.",
  "With a range, set date: completedAt for finished work, deadline for due work, scheduled for planned work, start for events. Hours need measure: estimate (planned) or tracked (worked) for tasks, duration for events.",
  "project, workspace, label and status take exact names from the person's names below. Leave a filter out when no name fits; never guess one.",
  "Fit the size: small holds one or two Stats; medium up to three Stats or five rows; tall up to ten rows; wide a chart or Columns; large several blocks. Set limit to the rows that fit.",
  "Give every List an empty text, and an Open link to the full screen when there may be more rows than fit.",
  "The title is a few words in the person's language, without the word card. Labels are in the person's language too.",
  "When the message holds the card's current program and a change, answer with the whole changed program, keeping the rest as it was.",
];

const EXAMPLES = [
  `Words: overdue client work and what's due this week
root = Panel("Client work", [nums, list], "medium")
late = @Data({source: "tasks", project: "Client work", overdue: true, sort: "deadline", limit: 5})
week = @Data({source: "tasks", project: "Client work", date: "deadline", range: "thisWeek", state: "all"})
nums = Stats([Stat("Overdue", late.text), Stat("This week", week.ratio, "done")])
list = List(@Each(late.rows, "t", TaskRow(t.id, t.title, t.day, t.note)), "Nothing overdue", open)
open = Open("Open Tasks", "tasks")`,
  `Words: how is my week going
root = Panel("This week", [nums, chart], "wide")
done = @Data({source: "tasks", state: "done", date: "completedAt", range: "thisWeek", by: "day"})
focus = @Data({source: "tasks", state: "done", date: "completedAt", range: "thisWeek", measure: "tracked"})
nums = Stats([Stat("Done", done.text, done.change), Stat("Focus", focus.text)])
chart = BarChart("Done per day", done.labels, done.values)`,
  `Words: meeting hours per project this week
root = Panel("Meeting hours", [list], "medium")
hours = @Data({source: "events", measure: "duration", date: "start", range: "thisWeek", by: "project", limit: 5})
list = List(@Each(hours.groups, "g", ShareRow(g.label, g.text, g.share)), "No events this week")`,
  `Words: what's coming up
root = Panel("Coming up", [list], "tall")
next = @Data({source: "events", date: "start", range: "next7", sort: "start", limit: 8})
list = List(@Each(next.rows, "e", EventRow(e.time, e.title, e.day + " · " + e.length)), "Nothing in the next 7 days", open)
open = Open("Open Calendar", "calendar")`,
];

// Only in the model's instructions: a sheet the person may not have is no example to offer them.
const SHEET_EXAMPLE = `Words: spending per category from my Budget sheet
root = Panel("Spending by category", [nums, chart], "wide")
spend = @Cells({sheet: "Budget", tab: "October", label: "Category", value: "Amount", group: true, sort: "value"})
nums = Stats([Stat("Spent", spend.text), Stat("Per entry", spend.average)])
chart = BarChart("Per category", spend.labels, spend.values)`;

const promptLibrary = () => createLibrary({ components: Object.values(BOARD_COMPONENTS), functions: [Data, Cells], root: BOARD_ROOT });

/** The model's instructions for described cards (the API embeds this text). */
export function boardPrompt(): string {
  return promptLibrary().prompt({ preamble: PREAMBLE, additionalRules: RULES, examples: [...EXAMPLES, SHEET_EXAMPLE], builtinFunctions: true });
}

/** A parser for described-card programs, for checks outside a renderer. */
export function boardParser() {
  return createParser(promptLibrary().toJSONSchema(), BOARD_ROOT);
}

/**
 * The program as a renderer draws it: every @Data call answered from this
 * data and every reference, sum and @Each worked out. Null when it has no
 * Panel root. The web's Renderer does this itself; the phone draws the root
 * on its own (the package's Renderer draws DOM elements), so it reads it here.
 */
export function drawBoard(program: string, data: DashboardData, ctx: EngineContext): GenuiNode | null {
  const library = promptLibrary();
  const schema = library.toJSONSchema();
  const result = createParser(schema, BOARD_ROOT).parse(program);
  if (!result.root) return null;
  const [data$, cells$] = boardFunctions(data, ctx);
  const functions = { Data: { ...schema.functions!.Data, fn: data$.fn }, Cells: { ...schema.functions!.Cells, fn: cells$.fn } };
  const root = evaluateRoot(result, { ctx: { getState: () => undefined, resolveRef: () => undefined, functions }, library, store: null });
  return root?.typeName === BOARD_ROOT ? (root as GenuiNode) : null;
}

/** Words to start a card from, offered under the describe box. */
export const DESCRIBE_EXAMPLES = EXAMPLES.map((example) => example.split("\n")[0].replace(/^Words:\s*/, ""));

/** The describe box's examples, the last one a chart of the person's latest edited sheet when they have one. */
export function describeExamples(sheets: Sheet[] | undefined): string[] {
  const latest = (sheets ?? []).filter((sheet) => !sheet.archivedAt && sheet.title?.trim()).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];
  if (!latest) return DESCRIBE_EXAMPLES;
  return [...DESCRIBE_EXAMPLES.slice(0, -1), `A chart of my ${latest.title.trim()} sheet`];
}

/** Changes to try once a card is built. */
export const DESCRIBE_CHANGES = ["Show more rows", "Add a chart by day", "Only the overdue ones", "Make it smaller"];
const SHEET_CHANGES = ["Show more rows", "Only the latest entries", "Sort by name", "Make it smaller"];

/** Changes to offer once a card is built: a card of a sheet's cells gets its own. */
export function describeChanges(program: string): string[] {
  return /@Cells\s*\(/.test(program) && !/@Data\s*\(/.test(program) ? SHEET_CHANGES : DESCRIBE_CHANGES;
}

/** The example programs in the prompt, without their "Words:" line. */
export function boardExamples(): { words: string; program: string }[] {
  return [...EXAMPLES, SHEET_EXAMPLE].map((example) => {
    const [first, ...rest] = example.split("\n");
    return { words: first.replace(/^Words:\s*/, ""), program: rest.join("\n") };
  });
}

// ---- Saving ----

type Ast = { k: string; [key: string]: unknown };

/** A literal argument as JSON; expressions (references, maths) give undefined. */
function literal(node: Ast | undefined): unknown {
  if (!node) return undefined;
  switch (node.k) {
    case "Str":
    case "Num":
    case "Bool":
      return node.v;
    case "Null":
      return null;
    case "Arr":
      return (node.els as Ast[] | undefined)?.map(literal);
    case "Obj":
      return Object.fromEntries((node.entries as [string, Ast][]).map(([key, value]) => [key, literal(value)]));
    default:
      return undefined;
  }
}

/** The `@Data` (or `@Cells`) queries in a parsed tree, in the order they appear. */
function dataCalls(value: unknown, out: DataQuery[] = []): DataQuery[] {
  return calls(value, "Data", DataQuery, out);
}

function calls<T>(value: unknown, name: string, schema: z.ZodType<T>, out: T[] = []): T[] {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) calls(item, name, schema, out);
    return out;
  }
  const node = value as Ast;
  if (node.k === "Comp" && node.name === name) {
    const query = schema.safeParse(literal((node.args as Ast[] | undefined)?.[0]));
    if (query.success) out.push(query.data);
  }
  for (const child of Object.values(node)) calls(child, name, schema, out);
  return out;
}

export interface DescribedParse {
  title: string;
  size: { w: number; h: number };
  /** The first @Data query, as a plain card for older clients. */
  fallback: CardQuery;
}

/** Reads a program's title, size and fallback card; null when it has no Panel root or errors. */
export function readBoardProgram(program: string, data: DashboardData = {}): DescribedParse | null {
  const result = boardParser().parse(program);
  const root = result.root as GenuiNode | null;
  if (!root || root.typeName !== BOARD_ROOT || result.meta.errors.length) return null;
  const title = typeof root.props.title === "string" ? root.props.title.trim().slice(0, 120) : "";
  const named = BOARD_SIZES[root.props.size as BoardSize];
  const first = dataCalls(result.root)[0];
  const usesRows = /\b(List|TaskRow|EventRow|InfoRow)\(/.test(program);
  const usesChart = /\bBarChart\(/.test(program);
  // A program that reads only cells falls back to the list of sheets: a picked
  // sheet's card would drop the program when the layout is saved (fitQuery).
  const cellsOnly = !first && calls(result.root, "Cells", CellsQuery).length > 0;
  const plain = first ? dataCardQuery(first, data) : fitQuery(defaultQuery(cellsOnly ? "sheets" : "tasks"));
  const fallback = fitQuery({
    ...plain,
    display: usesChart && first?.by ? "bar" : usesRows ? "list" : "number",
    groupBy: first?.by ?? plain.groupBy,
  });
  return { title, size: named ? { ...named } : defaultCardSize(fallback), fallback };
}

/**
 * What a program's `@Cells` calls name that the person's sheets don't have,
 * such as a column renamed after the card was built, one sentence each.
 * Empty until the sheets are loaded.
 */
export function cellsProblems(program: string, data: DashboardData): string[] {
  if (!data.sheets || !/@Cells\s*\(/.test(program)) return [];
  const root = boardParser().parse(program).root;
  const missing = calls(root, "Cells", CellsQuery).map((query) => findCells(query, data).missing);
  return [...new Set(missing.filter(Boolean))];
}

// ---- Live blocks ----

/**
 * A live block is a described card inside a doc: the same Panel program,
 * saved in the doc as a fenced code block in this language, so the doc stays
 * Markdown and other editors show the program as code. The apps draw it at
 * the doc's width from their own data each time the doc shows; `size` is
 * left out there.
 */
export const LIVE_BLOCK_LANGUAGE = "openui-lang";

/**
 * Stand-in dashboard cards for live block programs, for the apps' dashboard
 * data hooks, so they load what the programs read and nothing else.
 */
export function liveBlockCards(programs: string[]): DashboardCard[] {
  return programs
    .filter((program) => program.trim())
    .map((program, index) => ({
      id: `live-${index}`,
      type: "custom",
      w: 4,
      h: 3,
      query: { ...fitQuery(defaultQuery("tasks")), described: { prompt: "", program } },
    }));
}

/** The dashboard card for a described program, or null when it can't be read. */
export function describedCard(id: string, prompt: string, program: string, data?: DashboardData): DashboardCard | null {
  const read = readBoardProgram(program, data);
  if (!read) return null;
  return {
    id,
    type: "custom",
    title: read.title || prompt.slice(0, 60),
    w: read.size.w,
    h: read.size.h,
    query: { ...read.fallback, described: { prompt: prompt.trim(), program } },
  };
}
