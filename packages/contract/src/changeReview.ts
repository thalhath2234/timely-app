/**
 * How an Agent proposal reads in review, on web and phone alike: the plan's
 * steps grouped into one item per kind of change and target (every entry for
 * one sheet, every new task, one doc), each drawn by a fixed design for its
 * kind, with names instead of ids and values formatted the way the apps show
 * them. Pure: each app passes the names it already has cached and draws the
 * groups with its own kit.
 */
import { docBlocks, type DocBlock } from "./dashboardFiles";
import { fromMarkdown } from "./markdown";
import { formatCurrency, formatDateValue, formatNumberValue } from "./sheetDisplay";
import { parseNumberInput } from "./sheetCell";
import { formatDateText } from "./sheetFunctions";
import type { SheetColumn } from "./sheetTypes";
import { parseIsoDate } from "./sheetValues";

export type { DocBlock } from "./dashboardFiles";

/** One step of a plan as the API sends it (chat `plan` and message `steps`). */
export type ReviewStep = {
  tool: string;
  summary: string;
  arguments: Record<string, unknown>;
  status: string;
  result?: Record<string, unknown>;
  before?: Record<string, unknown>;
  error?: string;
};

export type ReviewSheetInfo = {
  title?: string;
  icon?: string;
  tabs?: { id: string; name: string; columns?: SheetColumn[] }[];
  columns?: SheetColumn[];
};

/**
 * Names the app already has cached. Every lookup is optional; an id nobody
 * can name shows as its kind ("a project"), never as the id itself.
 */
export type ReviewNames = {
  workspace?: (id: string) => string | undefined;
  project?: (id: string) => string | undefined;
  task?: (id: string) => string | undefined;
  doc?: (id: string) => string | undefined;
  sheet?: (id: string) => ReviewSheetInfo | undefined;
  label?: (id: string) => string | undefined;
  status?: (id: string) => string | undefined;
  stage?: (id: string) => string | undefined;
  event?: (id: string) => string | undefined;
  customField?: (id: string) => string | undefined;
};

/** A label and its value, ready to draw as a grouped row. */
export type ReviewField = {
  label: string;
  value: string;
  /** The value before this change, when the change replaces one. */
  was?: string;
  /** A colour swatch to draw next to the value. */
  color?: string;
  /** Markdown drawn as doc blocks instead of one line. */
  blocks?: DocBlock[];
};

export type ReviewKind = "sheet" | "tasks" | "doc" | "events" | "change";

export type ReviewSheetColumn = {
  key: string;
  name: string;
  numeric: boolean;
  /** The currency every cell is in ("Rs"), shown once in the heading. */
  unit?: string;
};
export type ReviewSheetRow = {
  /** The plan step that writes this row (status, errors). */
  step: number;
  cells: string[];
};
export type ReviewSheetTab = {
  name: string;
  columns: ReviewSheetColumn[];
  rows: ReviewSheetRow[];
  /** Values every entry shares ("Notes: Sample data"), said once instead of in each row. */
  same: ReviewField[];
  /**
   * For a compact list (phone): the column that names an entry, its date and
   * its amount, as indexes into `columns`; -1 when the tab has none.
   */
  lead: number;
  date: number;
  amount: number;
};

export type ReviewTaskRow = {
  step: number;
  title: string;
  /** What happens to the task: "New", "Done", "Reopen", "Moves", "Changes". */
  action: "create" | "update" | "complete" | "reopen" | "focus" | "other";
  /** Short facts under the title: where, when, how long. */
  meta: string[];
  /** For edits: what changes, each with its value before when known. */
  changes: ReviewField[];
  /** A description or checklist as doc blocks. */
  blocks?: DocBlock[];
};

export type ReviewEventRow = { step: number; title: string; when: string; meta: string[]; changes: ReviewField[] };

type GroupBase = {
  key: string;
  kind: ReviewKind;
  /** The plan steps in this group, in plan order. */
  steps: number[];
  /** Eyebrow, the kind of thing ("Sheet", "New tasks"). */
  eyebrow: string;
  /** What it is ("Expenses 2026", "Trip to Tokyo"). */
  title: string;
  /** One line of scope ("30 entries in 3 tabs"). */
  meta: string;
  /** Deletes or clears data: drawn as a removal. */
  removal: boolean;
};

export type ReviewGroup =
  | (GroupBase & { kind: "sheet"; sheetId: string; icon?: string; tabs: ReviewSheetTab[]; fields: ReviewField[] })
  | (GroupBase & { kind: "tasks"; rows: ReviewTaskRow[] })
  | (GroupBase & { kind: "doc"; icon?: string; blocks: DocBlock[]; fields: ReviewField[]; action: "create" | "update" | "append" })
  | (GroupBase & { kind: "events"; rows: ReviewEventRow[] })
  | (GroupBase & { kind: "change"; tool: string; fields: ReviewField[]; table?: ReviewSheetTab });

const SHEET_ENTRY_TOOLS = new Set(["add_sheet_row", "add_sheet_entries"]);
const TASK_TOOLS = new Set([
  "create_task",
  "update_task",
  "complete_task",
  "reopen_task",
  "move_task_to_status",
  "move_task_to_stage",
  "set_task_labels",
  "set_today_focus",
  "capture_inbox_item",
  "clarify_inbox_item",
  "add_task_comment",
  "add_checklist_item",
  "update_checklist_item",
  "toggle_checklist_item",
  "set_task_dependency",
  "set_task_custom_field",
  "schedule_task",
  "pin_task",
  "start_focus",
  "pause_focus",
  "stop_focus",
]);
const DOC_TOOLS = new Set(["create_doc", "update_doc", "append_to_doc", "add_live_block", "open_daily_note"]);
const EVENT_TOOLS = new Set(["create_event", "update_event"]);

/** Deletions and clearing blocks remove data; their review says so. */
export function isRemovalTool(tool: string): boolean {
  return tool.startsWith("delete_") || tool === "clear_task_blocks" || tool === "clear_task_recurrence" || tool === "undo_schedule";
}

// ---------------------------------------------------------------- values

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** "2026-11-04" → "Wed 4 Nov"; a timestamp adds the local time. */
export function reviewDate(value: string, withYear = false): string {
  const text = value.trim();
  if (DATE_RE.test(text)) {
    const date = parseIsoDate(text);
    return date ? formatDateText(date, withYear ? "ddd d mmm yyyy" : "ddd d mmm") : text;
  }
  if (STAMP_RE.test(text)) {
    const at = new Date(text);
    if (Number.isNaN(at.getTime())) return text;
    const day = formatDateText({ year: at.getFullYear(), month: at.getMonth() + 1, day: at.getDate() }, withYear ? "ddd d mmm yyyy" : "ddd d mmm");
    // A date-only value sent as midnight UTC is a day, not a time.
    if (/T00:00(:00(\.0+)?)?Z$/.test(text)) return formatDateText(parseIsoDate(text.slice(0, 10))!, withYear ? "ddd d mmm yyyy" : "ddd d mmm");
    return `${day}, ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  }
  return text;
}

/** Minutes as "45 min", "1 h", "1 h 30 min". */
export function reviewMinutes(value: unknown): string {
  const minutes = typeof value === "number" ? value : parseInt(str(value), 10);
  if (!Number.isFinite(minutes) || minutes <= 0) return str(value);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const WEEKDAYS: Record<string, string> = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };

/** A repeat rule in words: "Every week on Mon, Wed", "Every 2 days". */
export function reviewRepeat(rule: unknown): string {
  const text = str(obj(rule)?.rrule ?? rule).replace(/^RRULE:/i, "");
  if (!text) return "";
  const parts = Object.fromEntries(
    text
      .split(";")
      .map((part) => part.split("="))
      .filter((pair) => pair.length === 2)
      .map(([k, v]) => [k.toUpperCase(), v.toUpperCase()]),
  );
  const every = Number(parts.INTERVAL) > 1 ? Number(parts.INTERVAL) : 1;
  const unit = ({ DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" } as Record<string, string>)[parts.FREQ];
  if (!unit) return "Repeats";
  let out = every > 1 ? `Every ${every} ${unit}s` : `Every ${unit}`;
  if (parts.BYDAY) {
    const days = parts.BYDAY.split(",").map((day: string) => WEEKDAYS[day.slice(-2)] ?? day);
    out += ` on ${days.join(", ")}`;
  }
  if (parts.COUNT) out += `, ${parts.COUNT} times`;
  if (parts.UNTIL && /^\d{8}/.test(parts.UNTIL)) out += `, until ${reviewDate(`${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}`, true)}`;
  return out;
}

const PREFIX_NOUNS: [string, string][] = [
  ["shtpl_", "a sheet template"],
  ["sht_", "a sheet"],
  ["doc_", "a doc"],
  ["tsk_", "a task"],
  ["pr_", "a project"],
  ["ws_", "a workspace"],
  ["evt_", "an event"],
  ["blk_", "a calendar block"],
  ["lbl_", "a label"],
  ["tst_", "a status"],
  ["stg_", "a stage"],
  ["cf_", "a custom field"],
  ["tab_", "a tab"],
  ["col_", "a column"],
  ["row_", "a row"],
];

/** The object a "$N.path" reference names: what step N creates. */
function referenceName(value: string, steps: ReviewStep[]): string | null {
  const match = /^\$(\d+)\./.exec(value);
  if (!match) return null;
  const step = steps[Number(match[1])];
  if (!step) return "an earlier change";
  const args = step.arguments ?? {};
  const name = str(args.name || args.title);
  const done = obj(step.result);
  const made = obj(done?.task) ?? obj(done?.project) ?? obj(done?.sheet) ?? obj(done?.doc) ?? done;
  const finalName = str(made?.name || made?.title) || name;
  const noun = step.tool.replace(/^create_|^add_/, "").replace(/_/g, " ");
  return finalName ? `New ${noun} “${finalName}”` : `The new ${noun}`;
}

/** The name an id stands for, or its kind when nothing knows it. */
export function reviewName(id: string, names: ReviewNames, steps: ReviewStep[] = []): string {
  const ref = referenceName(id, steps);
  if (ref) return ref;
  const look: [string, ((id: string) => string | undefined) | undefined][] = [
    ["ws_", names.workspace],
    ["pr_", names.project],
    ["tsk_", names.task],
    ["doc_", names.doc],
    ["sht_", (sheet) => names.sheet?.(sheet)?.title],
    ["lbl_", names.label],
    ["tst_", names.status],
    ["stg_", names.stage],
    ["evt_", names.event],
    ["cf_", names.customField],
  ];
  for (const [prefix, fn] of look) {
    if (id.startsWith(prefix)) {
      const name = fn?.(id);
      if (name) return name;
    }
  }
  const noun = PREFIX_NOUNS.find(([prefix]) => id.startsWith(prefix));
  return noun ? noun[1][0].toUpperCase() + noun[1].slice(1) : id;
}

// --------------------------------------------------------------- fields

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  title: "Title",
  workspaceId: "Workspace",
  projectId: "Project",
  taskId: "Task",
  docId: "Doc",
  sheetId: "Sheet",
  tabId: "Tab",
  parentId: "Inside",
  statusId: "Status",
  stageId: "Stage",
  labelIds: "Labels",
  blockedById: "Waits for",
  eventId: "Event",
  columnId: "Column",
  customFieldId: "Field",
  deadline: "Due",
  startDate: "Starts",
  scheduleAt: "Scheduled",
  scheduledOn: "Scheduled",
  start: "Starts",
  end: "Ends",
  duration: "Length",
  durationMinutes: "Length",
  minutes: "For",
  until: "Until",
  priorityLevel: "Priority",
  description: "Description",
  markdown: "Content",
  comment: "Comment",
  color: "Colour",
  icon: "Icon",
  kind: "Type",
  completed: "Done",
  completedAt: "Done",
  allDay: "All day",
  recurrence: "Repeats",
  rrule: "Repeats",
  locked: "Pinned",
  isFavorite: "Favourite",
  archived: "Archived",
  doesHaveStages: "Stages",
  type: "Type",
  options: "Choices",
  date: "Day",
  words: "Asked for",
  count: "Rows",
  frozenRows: "Frozen rows",
  frozenCols: "Frozen columns",
};

/** Keys a reviewer never needs: plumbing, not content. */
const HIDDEN_FIELDS = new Set([
  "id",
  "userId",
  "createdAt",
  "updatedAt",
  "timezone",
  "order",
  "confirm",
  "replace",
  "includeManual",
  "minChunkMinutes",
  "preferredChunkMinutes",
  "contiguous",
  "earliestStartAt",
  "scheduleLocked",
  "segments",
  "dtstart",
  "originalStart",
]);

const KINDS: Record<string, string> = { task: "Work", reminder: "Reminder", event: "Event", habit: "Habit", note: "Note" };

function fieldLabel(key: string): string {
  // "labelId" names a label, "templateIds" templates: the id is plumbing.
  const name = key.replace(/Ids$/, "s").replace(/(.)Id$/, "$1");
  return FIELD_LABELS[key] ?? name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase());
}

function fieldValue(key: string, value: unknown, names: ReviewNames, steps: ReviewStep[]): ReviewField | null {
  if (value == null || value === "") return null;
  const label = fieldLabel(key);
  if (typeof value === "boolean") return { label, value: value ? "Yes" : "No" };
  if (typeof value === "number") {
    if (key === "duration" || key === "durationMinutes" || key === "minutes") return { label, value: reviewMinutes(value) };
    return { label, value: formatNumberValue(value, undefined, undefined, undefined) };
  }
  if (typeof value === "string") {
    if (/Id$/.test(key) || /^\$\d+\./.test(value)) return { label, value: reviewName(value, names, steps) };
    if (key === "color" && /^#[0-9a-f]{3,8}$/i.test(value)) return { label, value: value.toUpperCase(), color: value };
    if (key === "markdown" || key === "description") return { label, value: "", blocks: markdownBlocks(value) };
    if (key === "kind") return { label, value: KINDS[value] ?? value };
    if (key === "priorityLevel") return { label, value: value[0].toUpperCase() + value.slice(1) };
    if (key === "rrule") return { label, value: reviewRepeat(value) };
    if (key === "duration" || key === "durationMinutes" || key === "minutes") return { label, value: reviewMinutes(value) };
    if (DATE_RE.test(value) || STAMP_RE.test(value)) return { label, value: reviewDate(value, true) };
    return { label, value };
  }
  if (Array.isArray(value)) {
    if (!value.length) return /Ids$/.test(key) ? { label, value: "None" } : null;
    if (value.every((item) => typeof item === "string")) {
      const items = value.map((item) => (/Ids$/.test(key) || /^\$\d+\./.test(item as string) ? reviewName(item as string, names, steps) : (item as string)));
      return { label, value: items.join(", ") };
    }
    if (key === "options") return { label, value: value.map((option) => str(obj(option)?.value ?? option)).join(", ") };
    return { label, value: `${value.length} ${value.length === 1 ? "item" : "items"}` };
  }
  if (key === "recurrence") return { label, value: reviewRepeat(value) };
  const record = obj(value);
  if (record) {
    const parts = Object.entries(record)
      .filter(([k]) => !HIDDEN_FIELDS.has(k))
      .map(([k, v]) => fieldValue(k, v, names, steps))
      .filter((f): f is ReviewField => !!f && !!f.value)
      .map((f) => `${f.label} ${f.value}`);
    return parts.length ? { label, value: parts.join(" · ") } : null;
  }
  return null;
}

/** A step's arguments as readable rows: names for ids, nothing internal. */
export function reviewFields(args: Record<string, unknown>, names: ReviewNames, steps: ReviewStep[] = [], skip: string[] = []): ReviewField[] {
  const out: ReviewField[] = [];
  for (const [key, value] of Object.entries(args ?? {})) {
    if (HIDDEN_FIELDS.has(key) || skip.includes(key)) continue;
    const field = fieldValue(key, value, names, steps);
    if (field && (field.value || field.blocks?.length)) out.push(field);
  }
  return out.sort((a, b) => fieldRank(a.label) - fieldRank(b.label));
}

const FIELD_ORDER = ["Name", "Title", "Workspace", "Project", "Inside", "Sheet", "Tab", "Task", "Doc", "Status", "Stage", "Type", "Due", "Starts", "Ends", "Scheduled", "Length", "Repeats", "Priority", "Labels"];
function fieldRank(label: string): number {
  const at = FIELD_ORDER.indexOf(label);
  return at < 0 ? FIELD_ORDER.length : at;
}

/** Markdown as the doc blocks the person will see, tick boxes included. */
export function markdownBlocks(markdown: string, limit = 200): DocBlock[] {
  if (!markdown.trim()) return [];
  return docBlocks(fromMarkdown(markdown).content, limit);
}

// ----------------------------------------------------------- sheet rows

function sheetInfo(step: ReviewStep, sheetId: string, names: ReviewNames): ReviewSheetInfo | undefined {
  // The proposal stores the sheet as it was read (title, tabs, columns in
  // order); a finished step returns the tab it wrote. The cache is a fallback.
  const before = obj(obj(step.before)?.sheet);
  const after = obj(step.result);
  const cached = names.sheet?.(sheetId);
  const tabs = (before?.tabs as ReviewSheetInfo["tabs"]) ?? cached?.tabs;
  const afterTab = obj(after?.tab) as { id: string; name: string; columns?: SheetColumn[] } | undefined;
  return {
    title: str(before?.title) || str(obj(after?.sheet)?.title) || cached?.title,
    icon: str(before?.icon) || str(obj(after?.sheet)?.icon) || cached?.icon,
    tabs: afterTab && !tabs?.some((tab) => tab.id === afterTab.id) ? [...(tabs ?? []), afterTab] : tabs,
    columns: (before?.columns as SheetColumn[]) ?? cached?.columns,
  };
}

function findTab(info: ReviewSheetInfo | undefined, tabId: string) {
  const tabs = info?.tabs ?? [];
  const wanted = tabId.trim().toLowerCase();
  if (!wanted) return tabs.length === 1 ? tabs[0] : tabs[0];
  return tabs.find((tab) => tab.id === tabId) ?? tabs.find((tab) => tab.name.trim().toLowerCase() === wanted);
}

function letterIndex(key: string): number {
  if (!/^[A-Za-z]{1,3}$/.test(key)) return -1;
  let index = 0;
  for (const ch of key.toUpperCase()) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

/** "G Unit price (LKR)" → "Unit price", as the API reads a copied heading. */
function headingName(key: string): string {
  let out = key.trim();
  const unit = out.lastIndexOf(" (");
  if (unit > 0 && out.endsWith(")")) out = out.slice(0, unit).trim();
  const space = out.indexOf(" ");
  if (space > 0 && letterIndex(out.slice(0, space)) >= 0 && out.slice(0, space).toUpperCase() === out.slice(0, space)) out = out.slice(space + 1).trim();
  return out;
}

/** The column a cell key means, as the API matches it: id, name, heading or letter. */
export function columnForKey(columns: SheetColumn[], key: string): SheetColumn | undefined {
  const byId = columns.find((column) => column.id === key);
  if (byId) return byId;
  const name = key.trim().toLowerCase();
  const byName = columns.find((column) => column.name.trim().toLowerCase() === name);
  if (byName) return byName;
  const heading = headingName(key).toLowerCase();
  const byHeading = columns.find((column) => column.name.trim().toLowerCase() === heading);
  if (byHeading) return byHeading;
  const index = letterIndex(key);
  return index >= 0 ? columns[index] : undefined;
}

const NUMERIC = new Set(["number", "currency", "percent"]);

/** A currency's sign as the sheet writes it: "Rs", "€", "$". */
export function currencyUnit(currency: string | undefined): string | undefined {
  const code = currency?.trim();
  if (!code) return undefined;
  return formatCurrency(0, code, 0).replace(/[-\d.,\s\u00a0]+/g, "").trim() || code;
}

/**
 * A typed value as the sheet shows it: "Rs 85,000.00", "Tue 1 Sep". With
 * `bare`, a currency drops its sign (the table heading carries it).
 */
export function reviewCell(column: SheetColumn | undefined, raw: unknown, bare = false): string {
  const text = str(raw).trim();
  if (!text || !column) return text;
  if (text.startsWith("=")) return text;
  if (column.type === "date") {
    if (DATE_RE.test(text)) return formatDateValue(text, column.format?.dateFormat ?? "ddd d mmm");
    return text;
  }
  if (NUMERIC.has(column.type)) {
    const number = typeof raw === "number" ? raw : parseNumberInput(text);
    if (number == null) return text;
    if (column.type === "currency") return formatCurrency(number, bare ? undefined : column.format?.currency, column.format?.decimals ?? 2);
    return formatNumberValue(number, column.type === "percent" ? "percent" : undefined, column.format?.decimals, column.format?.currency);
  }
  if (column.type === "boolean") return /^(true|yes|1)$/i.test(text) ? "Yes" : "No";
  return text;
}

type Entry = { step: number; tabId: string; cells: Record<string, unknown>; worked?: Record<string, unknown> };

function entriesOf(step: ReviewStep, index: number): Entry[] {
  const args = step.arguments ?? {};
  const tabId = str(args.tabId);
  const result = obj(step.result);
  if (step.tool === "add_sheet_row") {
    return [{ step: index, tabId, cells: obj(args.cells) ?? {}, worked: obj(result?.values) }];
  }
  const entries = Array.isArray(args.entries) ? args.entries : [];
  const worked = Array.isArray(result?.values) ? (result!.values as unknown[]) : [];
  return entries.map((entry, i) => ({ step: index, tabId, cells: obj(obj(entry)?.cells) ?? {}, worked: obj(worked[i]) }));
}

function sheetGroup(key: string, indexes: number[], steps: ReviewStep[], names: ReviewNames): ReviewGroup {
  const sheetId = str(steps[indexes[0]].arguments?.sheetId);
  let info: ReviewSheetInfo | undefined;
  for (const i of indexes) {
    const next = sheetInfo(steps[i], sheetId, names);
    if (!info || (!info.tabs?.length && next?.tabs?.length)) info = next;
  }
  const byTab = new Map<string, { name: string; columns?: SheetColumn[]; entries: Entry[] }>();
  for (const i of indexes) {
    for (const entry of entriesOf(steps[i], i)) {
      const tab = findTab(info, entry.tabId);
      const name = tab?.name ?? (entry.tabId.startsWith("tab_") || !entry.tabId ? "Sheet" : entry.tabId);
      const tabKey = (tab?.id ?? name).toLowerCase();
      const bucket = byTab.get(tabKey) ?? { name, columns: tab?.columns ?? info?.columns, entries: [] };
      bucket.entries.push(entry);
      byTab.set(tabKey, bucket);
    }
  }
  const tabs: ReviewSheetTab[] = [];
  let total = 0;
  for (const bucket of byTab.values()) {
    const known = (bucket.columns ?? []).filter((column) => !column.hidden);
    // Columns in the sheet's order, only those an entry fills (or the sheet
    // worked out after applying, like Total); keys no column matches go last.
    const used = new Map<string, SheetColumn | undefined>();
    const extra: string[] = [];
    for (const entry of bucket.entries) {
      for (const cellKey of Object.keys(entry.cells)) {
        const column = columnForKey(known, cellKey);
        if (column) used.set(column.id, column);
        else if (!extra.includes(cellKey)) extra.push(cellKey);
      }
      for (const name of Object.keys(entry.worked ?? {})) {
        const column = columnForKey(known, name);
        if (column) used.set(column.id, column);
      }
    }
    const ordered = known.filter((column) => used.has(column.id));
    const columns: ReviewSheetColumn[] = [
      ...ordered.map((column) => ({
        key: column.id,
        name: column.name,
        numeric: NUMERIC.has(column.type),
        unit: column.type === "currency" ? currencyUnit(column.format?.currency) : undefined,
      })),
      ...extra.map((name) => ({ key: name, name, numeric: false })),
    ];
    const rows = bucket.entries.map((entry) => {
      const byColumn = new Map<string, unknown>();
      for (const [cellKey, value] of Object.entries(entry.cells)) {
        const column = columnForKey(known, cellKey);
        byColumn.set(column?.id ?? cellKey, value);
      }
      for (const [name, value] of Object.entries(entry.worked ?? {})) {
        const column = columnForKey(known, name);
        if (column && !byColumn.has(column.id)) byColumn.set(column.id, value);
      }
      return {
        step: entry.step,
        cells: columns.map((column) => reviewCell(known.find((c) => c.id === column.key), byColumn.get(column.key), true)),
      };
    });
    total += rows.length;
    const typeOf = (i: number) => known.find((c) => c.id === columns[i].key)?.type;
    const indexes = columns.map((_, i) => i);
    const leadAt = indexes.find((i) => (typeOf(i) ?? "text") === "text") ?? -1;
    const dateAt = indexes.find((i) => typeOf(i) === "date") ?? -1;
    // The amount is the last money column: Total once worked out, else the price.
    const money = indexes.filter((i) => typeOf(i) === "currency");
    const amountAt = money.length ? money[money.length - 1] : (indexes.filter((i) => columns[i].numeric).pop() ?? -1);
    // A column every entry fills alike is said once (three entries or more).
    const sameAt = indexes.filter(
      (i) => rows.length >= 3 && i !== leadAt && i !== dateAt && i !== amountAt && !!rows[0].cells[i] && rows.every((row) => row.cells[i] === rows[0].cells[i]),
    );
    const keep = indexes.filter((i) => !sameAt.includes(i));
    const at = (i: number) => (i < 0 ? -1 : keep.indexOf(i));
    tabs.push({
      name: bucket.name,
      columns: keep.map((i) => columns[i]),
      rows: rows.map((row) => ({ ...row, cells: keep.map((i) => row.cells[i]) })),
      same: sameAt.map((i) => ({ label: columns[i].name, value: rows[0].cells[i] })),
      lead: at(leadAt),
      date: at(dateAt),
      amount: at(amountAt),
    });
  }
  const title = info?.title || reviewName(sheetId, names, steps);
  const tabWord = tabs.length > 1 ? ` in ${tabs.length} tabs` : tabs[0] && tabs[0].name !== "Sheet" ? ` in ${tabs[0].name}` : "";
  return {
    key,
    kind: "sheet",
    steps: indexes,
    eyebrow: "Sheet",
    title,
    meta: `${total} new ${total === 1 ? "entry" : "entries"}${tabWord}`,
    removal: false,
    sheetId,
    icon: info?.icon || undefined,
    tabs,
    fields: [],
  };
}

// ---------------------------------------------------------------- tasks

function taskBefore(step: ReviewStep): Record<string, unknown> | undefined {
  return obj(obj(step.before)?.task) ?? obj(step.before);
}

function whereOf(args: Record<string, unknown>, names: ReviewNames, steps: ReviewStep[]): string {
  const parts = [];
  if (args.workspaceId) parts.push(reviewName(str(args.workspaceId), names, steps));
  if (args.projectId) parts.push(reviewName(str(args.projectId), names, steps));
  return parts.join(" › ");
}

function taskFacts(args: Record<string, unknown>, names: ReviewNames, steps: ReviewStep[]): string[] {
  const facts: string[] = [];
  const kind = str(args.kind);
  if (kind && kind !== "task") facts.push(KINDS[kind] ?? kind);
  if (args.scheduleAt) facts.push(reviewDate(str(args.scheduleAt)));
  if (args.deadline) facts.push(`Due ${reviewDate(str(args.deadline))}`);
  if (args.startDate) facts.push(`Starts ${reviewDate(str(args.startDate))}`);
  if (args.duration) facts.push(reviewMinutes(args.duration));
  if (args.recurrence) facts.push(reviewRepeat(args.recurrence));
  if (args.priorityLevel && str(args.priorityLevel).toLowerCase() !== "low") facts.push(`${str(args.priorityLevel)[0].toUpperCase()}${str(args.priorityLevel).slice(1)} priority`);
  if (Array.isArray(args.labelIds) && args.labelIds.length) facts.push(args.labelIds.map((id) => reviewName(str(id), names, steps)).join(", "));
  if (args.statusId) facts.push(reviewName(str(args.statusId), names, steps));
  if (args.stageId) facts.push(reviewName(str(args.stageId), names, steps));
  return facts;
}

function beforeValue(key: string, before: Record<string, unknown> | undefined, names: ReviewNames): string | undefined {
  if (!before) return undefined;
  const value = before[key];
  if (value == null || value === "") return key === "deadline" || key === "startDate" ? "None" : undefined;
  if (key === "labelIds") {
    const labels = (before.labels as { name?: string }[] | undefined)?.map((label) => str(label.name)).filter(Boolean);
    return labels?.length ? labels.join(", ") : "None";
  }
  if (key === "projectId") return str(obj(before.project)?.title) || names.project?.(str(value));
  if (key === "workspaceId") return str(obj(before.workspace)?.name) || names.workspace?.(str(value));
  if (key === "statusId") return str(obj(before.status)?.name) || names.status?.(str(value));
  if (key === "stageId") return str(obj(before.stage)?.name) || names.stage?.(str(value));
  const field = fieldValue(key, value, names, []);
  return field?.value || undefined;
}

function taskRow(step: ReviewStep, index: number, names: ReviewNames, steps: ReviewStep[]): ReviewTaskRow {
  const args = step.arguments ?? {};
  const before = taskBefore(step);
  const resultTask = obj(obj(step.result)?.task);
  const named = str(args.name) || str(before?.name) || str(resultTask?.name) || (args.taskId ? reviewName(str(args.taskId), names, steps) : "") || step.summary;
  switch (step.tool) {
    case "create_task":
    case "capture_inbox_item": {
      const where = whereOf(args, names, steps);
      return {
        step: index,
        title: named,
        action: "create",
        meta: [...(where ? [where] : []), ...taskFacts(args, names, steps)],
        changes: [],
        blocks: args.description ? markdownBlocks(str(args.description), 40) : undefined,
      };
    }
    case "complete_task":
      return { step: index, title: named, action: "complete", meta: ["Mark done"], changes: [] };
    case "reopen_task":
      return { step: index, title: named, action: "reopen", meta: ["Reopen"], changes: [] };
    case "set_today_focus":
      return { step: index, title: named, action: "focus", meta: [`Focus for ${args.date ? reviewDate(str(args.date)) : "today"}`], changes: [] };
    case "start_focus":
    case "pause_focus":
    case "stop_focus":
      return { step: index, title: named, action: "focus", meta: [{ start_focus: "Start focus", pause_focus: "Pause focus", stop_focus: "Stop focus" }[step.tool]!], changes: [] };
  }
  const skip = ["taskId", "name", "description"];
  const changes = reviewFields(args, names, steps, skip).map((field) => {
    const key = Object.keys(args).find((k) => fieldLabel(k) === field.label);
    const was = key ? beforeValue(key, before, names) : undefined;
    return was && was !== field.value ? { ...field, was } : field;
  });
  if (args.name && before?.name && args.name !== before.name) changes.unshift({ label: "Name", value: str(args.name), was: str(before.name) });
  if (args.description) changes.push({ label: "Description", value: "", blocks: markdownBlocks(str(args.description), 40) });
  const verbs: Record<string, string> = {
    move_task_to_status: "Move",
    move_task_to_stage: "Move",
    set_task_labels: "Labels",
    add_task_comment: "Comment",
    add_checklist_item: "Add checklist item",
    update_checklist_item: "Edit checklist item",
    toggle_checklist_item: "Tick checklist item",
    set_task_dependency: "Waits for",
    set_task_custom_field: "Field",
    schedule_task: "Schedule",
    pin_task: "Pin",
    clarify_inbox_item: "Clarify",
  };
  return {
    step: index,
    title: before?.name ? str(before.name) : named,
    action: step.tool === "update_task" ? "update" : "other",
    meta: verbs[step.tool] ? [verbs[step.tool]] : [],
    changes,
  };
}

function tasksGroup(key: string, indexes: number[], steps: ReviewStep[], names: ReviewNames): ReviewGroup {
  const rows = indexes.map((i) => taskRow(steps[i], i, names, steps));
  const creates = rows.filter((row) => row.action === "create").length;
  const eyebrow = creates === rows.length ? (creates === 1 ? "New task" : "New tasks") : creates ? "Tasks" : rows.length === 1 ? "Task" : "Tasks";
  const where = (() => {
    // Only when every change happens in the same place.
    const places = new Set(indexes.map((i) => whereOf(steps[i].arguments ?? {}, names, steps)));
    return places.size === 1 ? [...places][0] : "";
  })();
  // The shared place is said once, in the group's line.
  if (where) for (const row of rows) row.meta = row.meta.filter((fact) => fact !== where);
  const counts: string[] = [];
  if (creates) counts.push(`${creates} new`);
  if (rows.length - creates) counts.push(`${rows.length - creates} ${rows.length - creates === 1 ? "change" : "changes"}`);
  return {
    key,
    kind: "tasks",
    steps: indexes,
    eyebrow,
    title: rows.length === 1 ? rows[0].title : `${rows.length} tasks`,
    meta: [where, counts.join(", ")].filter(Boolean).join(" · "),
    removal: false,
    rows,
  };
}

// ----------------------------------------------------------------- docs

function docGroup(key: string, index: number, steps: ReviewStep[], names: ReviewNames): ReviewGroup {
  const step = steps[index];
  const args = step.arguments ?? {};
  const before = obj(obj(step.before)?.doc) ?? obj(step.before);
  const docId = str(args.docId);
  const existing = str(before?.title) || (docId ? reviewName(docId, names, steps) : "");
  const action = step.tool === "create_doc" ? "create" : step.tool === "append_to_doc" ? "append" : "update";
  const title = str(args.title) || existing || (step.tool === "open_daily_note" ? `Daily note ${args.date ? reviewDate(str(args.date)) : ""}`.trim() : "Doc");
  const where = whereOf(args, names, steps) || (args.parentId && args.parentId !== "root" ? reviewName(str(args.parentId), names, steps) : "");
  const blocks = args.markdown ? markdownBlocks(str(args.markdown)) : [];
  // A doc that opens with its own title as a heading shows it once.
  const opening = blocks[0];
  if (opening?.kind === "heading" && opening.text.trim().toLowerCase() === title.trim().toLowerCase()) blocks.shift();
  const fields = reviewFields(args, names, steps, ["markdown", "title", "icon", "workspaceId", "projectId", "parentId", "docId"]);
  if (action === "update" && args.title && existing && existing !== args.title) fields.unshift({ label: "Title", value: str(args.title), was: existing });
  const checks = blocks.filter((block) => block.kind === "check").length;
  const lead = action === "create" ? "New doc" : action === "append" ? "Adds to doc" : step.tool === "add_live_block" ? "Live block" : "Doc changes";
  const scope = [where, checks ? `${checks} checklist ${checks === 1 ? "item" : "items"}` : ""].filter(Boolean).join(" · ");
  return {
    key,
    kind: "doc",
    steps: [index],
    eyebrow: lead,
    title,
    meta: scope,
    removal: false,
    icon: str(args.icon) || str(before?.icon) || undefined,
    blocks,
    fields,
    action,
  };
}

// --------------------------------------------------------------- events

function eventsGroup(key: string, indexes: number[], steps: ReviewStep[], names: ReviewNames): ReviewGroup {
  const rows = indexes.map((i) => {
    const step = steps[i];
    const args = step.arguments ?? {};
    const before = obj(obj(step.before)?.event) ?? obj(step.before);
    const title = str(args.title) || str(before?.title) || (args.eventId ? reviewName(str(args.eventId), names, steps) : step.summary);
    const start = str(args.start);
    const end = str(args.end);
    let when = start ? reviewDate(start) : "";
    if (end && STAMP_RE.test(end) && !args.allDay) when += `–${reviewDate(end).split(", ").pop()}`;
    if (args.allDay) when = `${reviewDate(start.slice(0, 10))}, all day`;
    const meta = [whereOf(args, names, steps), args.recurrence ? reviewRepeat(args.recurrence) : ""].filter(Boolean);
    const changes = step.tool === "update_event" ? reviewFields(args, names, steps, ["eventId", "title", "start", "end"]) : [];
    return { step: i, title, when, meta, changes };
  });
  return {
    key,
    kind: "events",
    steps: indexes,
    eyebrow: rows.length === 1 ? (steps[indexes[0]].tool === "create_event" ? "New event" : "Event") : "Calendar",
    title: rows.length === 1 ? rows[0].title : `${rows.length} events`,
    meta: rows.length === 1 ? rows[0].when : "",
    removal: false,
    rows,
  };
}

// ------------------------------------------------------------- grouping

const EYEBROWS: [RegExp, string][] = [
  [/sheet_template/, "Sheet template"],
  [/sheet/, "Sheet"],
  [/workspace|label|status|custom_field/, "Workspace"],
  [/project|stage/, "Project"],
  [/event|schedule|block/, "Calendar"],
  [/habit|goal/, "Habits and goals"],
  [/notification|reminder/, "Notifications"],
  [/view/, "Task view"],
  [/doc|3d_model/, "Doc"],
];

/**
 * A sheet's columns and rows written in one step (create_sheet,
 * update_sheet), as the table they make: the rows under their columns.
 */
function structureTable(args: Record<string, unknown>): ReviewSheetTab | undefined {
  if (!Array.isArray(args.columns) || !args.columns.length) return undefined;
  const sheetColumns = (args.columns as unknown[])
    .map((column, i) => {
      const c = obj(column) ?? {};
      return { id: str(c.id) || str(c.name) || `col${i}`, name: str(c.name) || `Column ${i + 1}`, type: (str(c.type) || "text") as SheetColumn["type"], width: 0, format: obj(c.format) as SheetColumn["format"] };
    });
  const rows = (Array.isArray(args.rows) ? args.rows : []).map((row) => {
    const cells = obj(obj(row)?.cells) ?? obj(row) ?? {};
    return {
      step: -1,
      cells: sheetColumns.map((column) => {
        const raw = cells[column.id] ?? cells[column.name];
        return reviewCell(column, raw, true);
      }),
    };
  });
  const columns = sheetColumns.map((column) => ({
    key: column.id,
    name: column.name,
    numeric: NUMERIC.has(column.type),
    unit: column.type === "currency" ? currencyUnit(column.format?.currency) : undefined,
  }));
  const at = (test: (column: (typeof sheetColumns)[number]) => boolean) => sheetColumns.findIndex(test);
  const money = sheetColumns.map((column, i) => (column.type === "currency" ? i : -1)).filter((i) => i >= 0);
  return {
    name: str(args.title) || str(args.name) || "Sheet",
    columns,
    rows,
    same: [],
    lead: at((column) => column.type === "text"),
    date: at((column) => column.type === "date"),
    amount: money.length ? money[money.length - 1] : -1,
  };
}

function changeGroup(key: string, index: number, steps: ReviewStep[], names: ReviewNames): ReviewGroup {
  const step = steps[index];
  const table = /sheet/.test(step.tool) ? structureTable(step.arguments ?? {}) : undefined;
  const eyebrow = EYEBROWS.find(([re]) => re.test(step.tool))?.[1] ?? "Change";
  // A removal names what goes, from the copy read before it.
  const before = obj(step.before);
  const record = before && (obj(before.task) ?? obj(before.project) ?? obj(before.doc) ?? obj(before.sheet) ?? obj(before.event) ?? obj(before.workspace) ?? before);
  const gone = record ? str(record.name || record.title) : "";
  return {
    key,
    kind: "change",
    steps: [index],
    eyebrow,
    title: step.summary,
    meta: isRemovalTool(step.tool) && gone ? `Removes “${gone}”` : "",
    removal: isRemovalTool(step.tool),
    tool: step.tool,
    fields: reviewFields(step.arguments ?? {}, names, steps, table ? ["columns", "rows"] : []),
    table,
  };
}

/** The group a step joins: entries by sheet, tasks together, a doc alone. */
function groupKey(step: ReviewStep, index: number): { key: string; kind: ReviewKind } {
  if (SHEET_ENTRY_TOOLS.has(step.tool)) return { key: `sheet:${str(step.arguments?.sheetId)}`, kind: "sheet" };
  if (TASK_TOOLS.has(step.tool)) return { key: "tasks", kind: "tasks" };
  if (DOC_TOOLS.has(step.tool)) return { key: `doc:${index}`, kind: "doc" };
  if (EVENT_TOOLS.has(step.tool)) return { key: "events", kind: "events" };
  return { key: `change:${index}`, kind: "change" };
}

/**
 * Which plan steps review as one change, without reading them: what a
 * count of changes needs ("1 of 4 changes applied").
 */
export function planGroups(steps: Pick<ReviewStep, "tool" | "arguments">[]): { key: string; kind: ReviewKind; steps: number[] }[] {
  const out: { key: string; kind: ReviewKind; steps: number[] }[] = [];
  const byKey = new Map<string, { key: string; kind: ReviewKind; steps: number[] }>();
  steps.forEach((step, index) => {
    const { key, kind } = groupKey(step as ReviewStep, index);
    const group = byKey.get(key);
    if (group) group.steps.push(index);
    else {
      const next = { key, kind, steps: [index] };
      byKey.set(key, next);
      out.push(next);
    }
  });
  return out;
}

/**
 * The plan as review groups, in the order of each group's first step. Steps
 * keep their plan index (`steps`), which status, errors and "$N" references
 * use; applying still runs the plan in its own order.
 */
export function reviewGroups(steps: ReviewStep[], names: ReviewNames = {}): ReviewGroup[] {
  return planGroups(steps).map(({ key, kind, steps: indexes }) => {
    switch (kind) {
      case "sheet":
        return sheetGroup(key, indexes, steps, names);
      case "tasks":
        return tasksGroup(key, indexes, steps, names);
      case "doc":
        return docGroup(key, indexes[0], steps, names);
      case "events":
        return eventsGroup(key, indexes, steps, names);
      default:
        return changeGroup(key, indexes[0], steps, names);
    }
  });
}

/** One figure of the summary strip above the review: "30 · Sheet entries". */
export type ReviewStat = { value: number; label: string };

/**
 * What the plan adds up to, biggest kinds first, for the strip above the
 * cards: entries, new tasks, task changes, docs, events, removals, the rest.
 */
export function reviewStats(groups: ReviewGroup[]): ReviewStat[] {
  let entries = 0;
  let newTasks = 0;
  let taskChanges = 0;
  let newDocs = 0;
  let docChanges = 0;
  let events = 0;
  let removals = 0;
  let other = 0;
  for (const group of groups) {
    if (group.kind === "sheet") entries += group.tabs.reduce((n, tab) => n + tab.rows.length, 0);
    else if (group.kind === "tasks") {
      const created = group.rows.filter((row) => row.action === "create").length;
      newTasks += created;
      taskChanges += group.rows.length - created;
    } else if (group.kind === "doc") {
      if (group.action === "create") newDocs++;
      else docChanges++;
    } else if (group.kind === "events") events += group.rows.length;
    else if (group.removal) removals++;
    else other++;
  }
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const stats: ReviewStat[] = [
    { value: entries, label: plural(entries, "Sheet entry", "Sheet entries") },
    { value: newTasks, label: plural(newTasks, "New task", "New tasks") },
    { value: taskChanges, label: plural(taskChanges, "Task change", "Task changes") },
    { value: newDocs, label: plural(newDocs, "New doc", "New docs") },
    { value: docChanges, label: plural(docChanges, "Doc change", "Doc changes") },
    { value: events, label: plural(events, "Event", "Events") },
    { value: removals, label: plural(removals, "Removal", "Removals") },
    { value: other, label: plural(other, "Other change", "Other changes") },
  ];
  return stats.filter((stat) => stat.value > 0);
}

export type ReviewProgress = {
  state: "pending" | "active" | "done" | "failed" | "discarded" | "partial";
  done: number;
  total: number;
  /** The first failed step's error. */
  error?: string;
};

/** Where a group stands while the plan is reviewed or applied. */
export function reviewProgress(group: Pick<ReviewGroup, "steps">, steps: ReviewStep[], activeIndex = -1): ReviewProgress {
  const own = group.steps.map((i) => steps[i]).filter(Boolean);
  const done = own.filter((step) => step.status === "done").length;
  const failed = own.find((step) => step.status === "failed");
  const total = own.length;
  if (failed) return { state: "failed", done, total, error: failed.error };
  if (group.steps.includes(activeIndex)) return { state: "active", done, total };
  if (total && done === total) return { state: "done", done, total };
  if (total && own.every((step) => step.status === "discarded")) return { state: "discarded", done, total };
  return { state: done ? "partial" : "pending", done, total };
}
