/**
 * The Dashboard: the saved layout (`config.reportDashboard`), the
 * built-in card catalogue, the custom-card query a user builds in the card
 * workshop, and the pure engine that turns a query plus the account's data
 * into what a card draws. Web, desktop and mobile share all of it, so a card
 * shows the same numbers everywhere; each client only renders the result.
 *
 * The server stores the layout as sent and checks only its outline
 * (`models.ReportDashboard`), so `normalizeDashboard` is the gate for
 * anything read back: unknown cards are dropped, sizes clamped, missing
 * fields filled.
 */
import type { CalendarItem } from "./calendar";
import type { Doc } from "./documents";
import type { Project, Task, Workspace } from "./entities";
import type { WeekdayKey, WorkingHours } from "./schedule";
import type { Sheet } from "./sheet";
import { addDaysToDate, dateInZone, daysBetween, isOverdue, todayInZone } from "./workStatus";

export const DASHBOARD_VERSION = 1;
/** Grid columns on a wide screen; narrower screens scale spans down. */
export const DASHBOARD_COLUMNS = 12;
export const DASHBOARD_MAX_ROWS = 10;
export const DASHBOARD_MAX_CARDS = 60;

// ---- Layout ----

export type BuiltinCardType =
  | "pomodoro"
  | "today"
  | "quickCapture"
  | "notes"
  | "streak"
  | "dayProgress"
  | "matrix"
  | "countdown"
  | "highlights";

export type DashboardCardType = BuiltinCardType | "custom";

export interface DashboardCard {
  id: string;
  type: DashboardCardType;
  /** Overrides the default title; empty uses the catalogue or query name. */
  title?: string;
  /** Column span out of `DASHBOARD_COLUMNS`. */
  w: number;
  /** Row span; one row is a fixed height on each client. */
  h: number;
  /** Built-in card settings (durations, note text, countdown date...). */
  settings?: Record<string, unknown>;
  /** Custom cards only. */
  query?: CardQuery;
}

export interface DashboardLayout {
  version: number;
  cards: DashboardCard[];
}

// ---- Custom card query ----

export type CardSource = "tasks" | "projects" | "events" | "docs" | "sheets" | "reminders" | "inbox";

export type CardDisplay = "number" | "list" | "bar" | "line" | "pie" | "progress";

/** What a card adds up. `count` works for every source. */
export type CardMeasure = "count" | "estimate" | "tracked" | "duration";

export type CardAggregate = "sum" | "avg";

export type CardGroupBy =
  | "none"
  | "status"
  | "priority"
  | "project"
  | "workspace"
  | "label"
  | "stage"
  | "state"
  | "due"
  | "day"
  | "week"
  | "month"
  | "weekday";

export type CardDateField = "createdAt" | "updatedAt" | "completedAt" | "deadline" | "scheduled" | "startDate" | "start";

export type CardRangePreset =
  | "all"
  | "today"
  | "yesterday"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "last7"
  | "last14"
  | "last30"
  | "last90"
  | "next7"
  | "next14"
  | "next30"
  | "custom";

export interface CardRange {
  preset: CardRangePreset;
  /** `YYYY-MM-DD`, inclusive; custom ranges only. */
  from?: string;
  to?: string;
}

export type CardState = "open" | "done" | "all";

export interface CardFilters {
  state?: CardState;
  workspaceIds?: string[];
  projectIds?: string[];
  statusIds?: string[];
  labelIds?: string[];
  priorities?: string[];
  overdue?: boolean;
  hasDeadline?: boolean;
  scheduled?: boolean;
  recurring?: boolean;
  /** Case-insensitive match on the name or title. */
  text?: string;
}

export type CardSortField = "name" | "deadline" | "createdAt" | "updatedAt" | "completedAt" | "start" | "priority" | "value";

export interface CardQuery {
  source: CardSource;
  display: CardDisplay;
  measure: CardMeasure;
  aggregate?: CardAggregate;
  groupBy: CardGroupBy;
  /** Which date the time range and the day/week/month groups read. */
  dateField: CardDateField;
  range: CardRange;
  filters: CardFilters;
  sort?: { field: CardSortField; dir: "asc" | "desc" };
  /** Rows in a list, or groups in a chart before the rest fold into Other. */
  limit?: number;
  /** Progress cards: done out of all, or the measure against `goal`. */
  progress?: "completion" | "goal";
  goal?: number;
  /** Number cards: show the change against the previous period of the range. */
  compare?: boolean;
  /** Categorical palette slot (0-7) for single-colour marks. */
  color?: number;
}

// ---- Catalogue ----

export interface BuiltinCardInfo {
  type: BuiltinCardType;
  title: string;
  description: string;
  w: number;
  h: number;
  minW: number;
  minH: number;
  settings?: Record<string, unknown>;
  /** Offered only while smart suggestions are available. */
  smart?: boolean;
}

export const BUILTIN_CARDS: BuiltinCardInfo[] = [
  {
    type: "pomodoro",
    title: "Pomodoro timer",
    description: "Focus and break rounds with a session count. Link a task to track what you worked on.",
    w: 4,
    h: 4,
    minW: 3,
    minH: 3,
    settings: { focus: 25, shortBreak: 5, longBreak: 15, rounds: 4, autoStart: false, sound: true },
  },
  {
    type: "today",
    title: "Today",
    description: "What's on today: the next items on your calendar, what you're focusing on and what's done.",
    w: 4,
    h: 4,
    minW: 3,
    minH: 3,
  },
  {
    type: "quickCapture",
    title: "Quick capture",
    description: "Drop a thought into the Inbox without leaving the dashboard.",
    w: 4,
    h: 2,
    minW: 3,
    minH: 2,
  },
  {
    type: "notes",
    title: "Scratchpad",
    description: "A sticky note that saves as you type and follows you to every device.",
    w: 4,
    h: 3,
    minW: 2,
    minH: 2,
    settings: { text: "" },
  },
  {
    type: "streak",
    title: "Completion streak",
    description: "A heatmap of tasks finished per day, with your current and best streak.",
    w: 6,
    h: 3,
    minW: 4,
    minH: 3,
    settings: { weeks: 18 },
  },
  {
    type: "dayProgress",
    title: "Day and week",
    description: "How much of your working day, week, month and year has gone by.",
    w: 4,
    h: 3,
    minW: 3,
    minH: 2,
  },
  {
    type: "matrix",
    title: "Priority matrix",
    description: "Open tasks sorted by importance (priority) and urgency (deadline within 3 days).",
    w: 6,
    h: 5,
    minW: 4,
    minH: 4,
    settings: { urgentDays: 3 },
  },
  {
    type: "countdown",
    title: "Countdown",
    description: "Days left until a date that matters: a launch, a trip, an exam.",
    w: 3,
    h: 2,
    minW: 2,
    minH: 2,
    settings: { label: "", date: "" },
  },
  {
    type: "highlights",
    title: "Highlights",
    description: "What stands out this week, why work gets blocked or left unfinished, and tips your own data backs. Needs smart suggestions.",
    w: 6,
    h: 4,
    minW: 4,
    minH: 3,
    smart: true,
  },
];

/** The cards the add-card catalogue offers; smart cards only while smart suggestions are available. */
export function catalogCards(smartAvailable: boolean): BuiltinCardInfo[] {
  return smartAvailable ? BUILTIN_CARDS : BUILTIN_CARDS.filter((card) => !card.smart);
}

export function builtinInfo(type: DashboardCardType): BuiltinCardInfo | undefined {
  return BUILTIN_CARDS.find((card) => card.type === type);
}

export const CUSTOM_MIN_SIZE = { w: 2, h: 2 };

export function minCardSize(card: Pick<DashboardCard, "type" | "query">): { w: number; h: number } {
  const info = builtinInfo(card.type);
  if (info) return { w: info.minW, h: info.minH };
  const display = card.query?.display;
  if (display === "line" || display === "bar" || display === "pie" || display === "list") return { w: 3, h: 3 };
  return CUSTOM_MIN_SIZE;
}

export const SOURCE_LABELS: Record<CardSource, string> = {
  tasks: "Tasks",
  projects: "Projects",
  events: "Calendar events",
  docs: "Docs",
  sheets: "Sheets",
  reminders: "Reminders",
  inbox: "Inbox",
};

export const DISPLAY_LABELS: Record<CardDisplay, string> = {
  number: "Number",
  list: "List",
  bar: "Bar chart",
  line: "Line chart",
  pie: "Donut chart",
  progress: "Progress",
};

export const MEASURE_LABELS: Record<CardMeasure, string> = {
  count: "Count",
  estimate: "Estimated hours",
  tracked: "Tracked hours",
  duration: "Event hours",
};

export const GROUP_LABELS: Record<CardGroupBy, string> = {
  none: "Nothing",
  status: "Status",
  priority: "Priority",
  project: "Project",
  workspace: "Workspace",
  label: "Label",
  stage: "Stage",
  state: "Open or done",
  due: "Due date bucket",
  day: "Day",
  week: "Week",
  month: "Month",
  weekday: "Day of week",
};

export const DATE_FIELD_LABELS: Record<CardDateField, string> = {
  createdAt: "Created",
  updatedAt: "Last edited",
  completedAt: "Completed",
  deadline: "Deadline",
  scheduled: "Scheduled time",
  startDate: "Start date",
  start: "Start",
};

export const RANGE_LABELS: Record<CardRangePreset, string> = {
  all: "All time",
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week",
  lastWeek: "Last week",
  thisMonth: "This month",
  lastMonth: "Last month",
  last7: "Last 7 days",
  last14: "Last 14 days",
  last30: "Last 30 days",
  last90: "Last 90 days",
  next7: "Next 7 days",
  next14: "Next 14 days",
  next30: "Next 30 days",
  custom: "Custom dates",
};

export const SORT_LABELS: Record<CardSortField, string> = {
  name: "Name",
  deadline: "Deadline",
  createdAt: "Created",
  updatedAt: "Last edited",
  completedAt: "Completed",
  start: "Start",
  priority: "Priority",
  value: "Value",
};

/** What each source can measure, group by, filter and date on. */
export interface SourceCapabilities {
  measures: CardMeasure[];
  groups: CardGroupBy[];
  dateFields: CardDateField[];
  sorts: CardSortField[];
  /** Filters the workshop offers for this source. */
  filters: (keyof CardFilters)[];
  /** Has an open / done state, so completion progress makes sense. */
  completable: boolean;
}

const TIME_GROUPS: CardGroupBy[] = ["day", "week", "month", "weekday"];

export const SOURCE_CAPABILITIES: Record<CardSource, SourceCapabilities> = {
  tasks: {
    measures: ["count", "estimate", "tracked"],
    groups: ["none", "status", "priority", "project", "workspace", "label", "stage", "state", "due", ...TIME_GROUPS],
    dateFields: ["deadline", "scheduled", "completedAt", "createdAt", "updatedAt"],
    sorts: ["deadline", "name", "priority", "createdAt", "updatedAt", "completedAt"],
    filters: ["state", "workspaceIds", "projectIds", "statusIds", "labelIds", "priorities", "overdue", "hasDeadline", "scheduled", "recurring", "text"],
    completable: true,
  },
  projects: {
    measures: ["count"],
    groups: ["none", "status", "priority", "workspace", "state", "due", ...TIME_GROUPS],
    dateFields: ["deadline", "startDate", "completedAt", "createdAt", "updatedAt"],
    sorts: ["deadline", "name", "priority", "createdAt", "updatedAt", "completedAt"],
    filters: ["state", "workspaceIds", "statusIds", "priorities", "overdue", "hasDeadline", "text"],
    completable: true,
  },
  events: {
    measures: ["count", "duration"],
    groups: ["none", "workspace", "project", ...TIME_GROUPS],
    dateFields: ["start"],
    sorts: ["start", "name"],
    filters: ["workspaceIds", "projectIds", "recurring", "text"],
    completable: false,
  },
  docs: {
    measures: ["count"],
    groups: ["none", "workspace", "project", ...TIME_GROUPS],
    dateFields: ["updatedAt", "createdAt"],
    sorts: ["updatedAt", "createdAt", "name"],
    filters: ["workspaceIds", "projectIds", "text"],
    completable: false,
  },
  sheets: {
    measures: ["count"],
    groups: ["none", "workspace", "project", ...TIME_GROUPS],
    dateFields: ["updatedAt", "createdAt"],
    sorts: ["updatedAt", "createdAt", "name"],
    filters: ["workspaceIds", "projectIds", "text"],
    completable: false,
  },
  reminders: {
    measures: ["count"],
    groups: ["none", "state", ...TIME_GROUPS],
    dateFields: ["scheduled", "completedAt", "createdAt"],
    sorts: ["start", "name", "createdAt", "completedAt"],
    filters: ["state", "recurring", "text"],
    completable: true,
  },
  inbox: {
    measures: ["count"],
    groups: ["none", ...TIME_GROUPS],
    dateFields: ["createdAt", "updatedAt"],
    sorts: ["createdAt", "updatedAt", "name"],
    filters: ["text"],
    completable: false,
  },
};

export const DISPLAY_NEEDS_GROUP: Record<CardDisplay, boolean> = {
  number: false,
  list: false,
  bar: true,
  line: true,
  pie: true,
  progress: false,
};

/** A fresh query for the workshop. */
export function defaultQuery(source: CardSource = "tasks"): CardQuery {
  const caps = SOURCE_CAPABILITIES[source];
  return {
    source,
    display: "number",
    measure: "count",
    groupBy: "none",
    dateField: caps.dateFields[0],
    range: { preset: "all" },
    filters: caps.completable ? { state: "open" } : {},
    sort: { field: caps.sorts[0], dir: caps.sorts[0] === "updatedAt" || caps.sorts[0] === "createdAt" ? "desc" : "asc" },
    limit: 8,
  };
}

/**
 * Brings a query in line with its source and display: a measure, group,
 * date field or sort the source cannot offer falls back to the first one it
 * can, a line chart groups by time, and a pie never groups by time.
 */
export function fitQuery(query: CardQuery): CardQuery {
  const source: CardSource = query.source in SOURCE_CAPABILITIES ? query.source : "tasks";
  const caps = SOURCE_CAPABILITIES[source];
  const display: CardDisplay = query.display in DISPLAY_LABELS ? query.display : "number";
  let groupBy: CardGroupBy = caps.groups.includes(query.groupBy) ? query.groupBy : "none";
  if (display === "line" && !TIME_GROUPS.includes(groupBy)) groupBy = "day";
  if (display === "line" && groupBy === "weekday") groupBy = "day";
  if ((display === "bar" || display === "pie") && groupBy === "none") {
    groupBy = caps.groups.find((group) => group !== "none" && !TIME_GROUPS.includes(group)) ?? "day";
  }
  if (display === "pie" && TIME_GROUPS.includes(groupBy)) {
    groupBy = caps.groups.find((group) => group !== "none" && !TIME_GROUPS.includes(group)) ?? groupBy;
  }
  const filters: CardFilters = {};
  for (const key of caps.filters) {
    const value = query.filters?.[key];
    if (value !== undefined) (filters as Record<string, unknown>)[key] = value;
  }
  const range: CardRange = query.range && query.range.preset in RANGE_LABELS ? { ...query.range } : { preset: "all" };
  if (range.preset !== "custom") {
    delete range.from;
    delete range.to;
  }
  const sortField = query.sort && (caps.sorts.includes(query.sort.field) || query.sort.field === "value") ? query.sort.field : caps.sorts[0];
  return {
    ...query,
    source,
    display,
    measure: caps.measures.includes(query.measure) ? query.measure : "count",
    aggregate: query.aggregate === "avg" ? "avg" : "sum",
    groupBy,
    dateField: caps.dateFields.includes(query.dateField) ? query.dateField : caps.dateFields[0],
    range,
    filters,
    sort: { field: sortField, dir: query.sort?.dir === "desc" ? "desc" : "asc" },
    limit: clampInt(query.limit ?? 8, 1, 50),
    progress: query.progress === "goal" || !caps.completable ? "goal" : "completion",
    goal: query.goal && query.goal > 0 ? query.goal : undefined,
    color: clampInt(query.color ?? 0, 0, 7),
  };
}

/** A readable default name for a custom card. */
export function describeQuery(query: CardQuery): string {
  const state = query.filters.state;
  const measure = query.measure === "count" ? "" : `${MEASURE_LABELS[query.measure]} · `;
  let subject: string = SOURCE_LABELS[query.source];
  if (state === "open") subject = `Open ${subject.toLowerCase()}`;
  if (state === "done") subject = `Completed ${subject.toLowerCase()}`;
  if (query.filters.overdue) subject = `Overdue ${subject.toLowerCase().replace(/^open /, "")}`;
  const group = query.groupBy !== "none" ? ` by ${GROUP_LABELS[query.groupBy].toLowerCase()}` : "";
  const range = query.range.preset !== "all" ? ` · ${RANGE_LABELS[query.range.preset].toLowerCase()}` : "";
  return `${measure}${subject}${group}${range}`;
}

export function cardTitle(card: DashboardCard): string {
  if (card.title?.trim()) return card.title.trim();
  if (card.type === "custom" && card.query) return describeQuery(card.query);
  return builtinInfo(card.type)?.title ?? "Card";
}

// ---- Templates (custom cards with a head start) ----

export interface CardTemplate {
  id: string;
  title: string;
  description: string;
  w: number;
  h: number;
  query: CardQuery;
}

const q = (partial: Partial<CardQuery> & Pick<CardQuery, "source" | "display">): CardQuery =>
  fitQuery({ ...defaultQuery(partial.source), ...partial });

export const CARD_TEMPLATES: CardTemplate[] = [
  {
    id: "open-tasks",
    title: "Open tasks",
    description: "Everything still on your plate, compared with last week.",
    w: 3,
    h: 2,
    query: q({ source: "tasks", display: "number", filters: { state: "open" } }),
  },
  {
    id: "done-this-week",
    title: "Done this week",
    description: "Tasks completed since Monday, against last week.",
    w: 3,
    h: 2,
    query: q({
      source: "tasks",
      display: "number",
      filters: { state: "done" },
      dateField: "completedAt",
      range: { preset: "thisWeek" },
      compare: true,
    }),
  },
  {
    id: "overdue",
    title: "Overdue",
    description: "Open tasks whose deadline has passed, oldest first.",
    w: 6,
    h: 4,
    query: q({
      source: "tasks",
      display: "list",
      filters: { state: "open", overdue: true },
      sort: { field: "deadline", dir: "asc" },
      limit: 10,
    }),
  },
  {
    id: "due-soon",
    title: "Due in the next 14 days",
    description: "Open tasks with a deadline coming up.",
    w: 6,
    h: 4,
    query: q({
      source: "tasks",
      display: "list",
      filters: { state: "open" },
      dateField: "deadline",
      range: { preset: "next14" },
      sort: { field: "deadline", dir: "asc" },
      limit: 10,
    }),
  },
  {
    id: "completed-trend",
    title: "Completed per day",
    description: "Tasks finished each day over the last 30 days.",
    w: 6,
    h: 3,
    query: q({
      source: "tasks",
      display: "line",
      filters: { state: "done" },
      dateField: "completedAt",
      range: { preset: "last30" },
      groupBy: "day",
    }),
  },
  {
    id: "by-priority",
    title: "Open by priority",
    description: "How your open work splits across priorities.",
    w: 4,
    h: 3,
    query: q({ source: "tasks", display: "bar", filters: { state: "open" }, groupBy: "priority", sort: { field: "name", dir: "asc" } }),
  },
  {
    id: "by-project",
    title: "Open tasks by project",
    description: "Which projects hold the most open work.",
    w: 4,
    h: 4,
    query: q({ source: "tasks", display: "pie", filters: { state: "open" }, groupBy: "project", sort: { field: "value", dir: "desc" }, limit: 6 }),
  },
  {
    id: "due-buckets",
    title: "Workload by due date",
    description: "Open tasks bucketed into overdue, today, this week, later and no date.",
    w: 4,
    h: 3,
    query: q({ source: "tasks", display: "bar", filters: { state: "open" }, groupBy: "due" }),
  },
  {
    id: "weekly-completion",
    title: "Weekly completion",
    description: "Share of this week's tasks already done.",
    w: 3,
    h: 2,
    query: q({
      source: "tasks",
      display: "progress",
      filters: { state: "all" },
      dateField: "deadline",
      range: { preset: "thisWeek" },
      progress: "completion",
    }),
  },
  {
    id: "estimate-by-workspace",
    title: "Planned hours by workspace",
    description: "Estimated hours of open work in each workspace.",
    w: 4,
    h: 3,
    query: q({ source: "tasks", display: "bar", measure: "estimate", filters: { state: "open" }, groupBy: "workspace", sort: { field: "value", dir: "desc" } }),
  },
  {
    id: "upcoming-events",
    title: "Upcoming events",
    description: "Calendar events in the next 7 days.",
    w: 4,
    h: 4,
    query: q({ source: "events", display: "list", dateField: "start", range: { preset: "next7" }, sort: { field: "start", dir: "asc" }, limit: 8 }),
  },
  {
    id: "meeting-hours",
    title: "Event hours per day",
    description: "Hours in calendar events each day over the next two weeks.",
    w: 6,
    h: 3,
    query: q({ source: "events", display: "bar", measure: "duration", dateField: "start", range: { preset: "next14" }, groupBy: "day" }),
  },
  {
    id: "project-status",
    title: "Projects by status",
    description: "Open projects split by status.",
    w: 4,
    h: 3,
    query: q({ source: "projects", display: "pie", filters: { state: "open" }, groupBy: "status" }),
  },
  {
    id: "recent-files",
    title: "Recently edited docs",
    description: "The docs you touched last.",
    w: 4,
    h: 4,
    query: q({ source: "docs", display: "list", sort: { field: "updatedAt", dir: "desc" }, limit: 8 }),
  },
  {
    id: "inbox-count",
    title: "Inbox",
    description: "Captures waiting to be sorted.",
    w: 3,
    h: 2,
    query: q({ source: "inbox", display: "number" }),
  },
];

// ---- Defaults & normalising ----

let idCounter = 0;
export function newCardId(): string {
  idCounter += 1;
  return `card_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${idCounter}`;
}

function templateCard(templateId: string, id: string, size?: { w: number; h: number }): DashboardCard {
  const template = CARD_TEMPLATES.find((entry) => entry.id === templateId);
  if (!template) throw new Error(`unknown template ${templateId}`);
  return { id, type: "custom", title: template.title, w: size?.w ?? template.w, h: size?.h ?? template.h, query: template.query };
}

function builtinCard(type: BuiltinCardType, id: string, size?: { w: number; h: number }): DashboardCard {
  const info = builtinInfo(type)!;
  return { id, type, w: size?.w ?? info.w, h: size?.h ?? info.h, settings: info.settings ? { ...info.settings } : undefined };
}

/** The layout a new account starts with. Ids are fixed so a reset is stable. */
export function defaultDashboard(): DashboardLayout {
  return {
    version: DASHBOARD_VERSION,
    cards: [
      templateCard("open-tasks", "default_open", { w: 3, h: 2 }),
      templateCard("done-this-week", "default_done", { w: 3, h: 2 }),
      { ...templateCard("overdue", "default_overdue_count", { w: 3, h: 2 }), query: q({ source: "tasks", display: "number", filters: { state: "open", overdue: true }, color: 7 }) },
      templateCard("weekly-completion", "default_week_progress", { w: 3, h: 2 }),
      builtinCard("today", "default_today", { w: 4, h: 5 }),
      builtinCard("pomodoro", "default_pomodoro", { w: 4, h: 5 }),
      templateCard("by-priority", "default_priority", { w: 4, h: 5 }),
      templateCard("overdue", "default_overdue", { w: 6, h: 4 }),
      templateCard("due-soon", "default_due_soon", { w: 6, h: 4 }),
      templateCard("completed-trend", "default_trend", { w: 8, h: 3 }),
      builtinCard("dayProgress", "default_day", { w: 4, h: 3 }),
      builtinCard("streak", "default_streak", { w: 6, h: 3 }),
      templateCard("by-project", "default_by_project", { w: 6, h: 3 }),
      builtinCard("matrix", "default_matrix", { w: 6, h: 5 }),
      builtinCard("notes", "default_notes", { w: 6, h: 5 }),
    ],
  };
}

function clampInt(value: unknown, min: number, max: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(max, Math.max(min, number));
}

const CARD_TYPES = new Set<DashboardCardType>(["custom", ...BUILTIN_CARDS.map((card) => card.type)]);

/**
 * Reads a saved layout back. Null or unreadable input gives the default
 * layout; cards of an unknown type (from a newer client) are dropped.
 */
export function normalizeDashboard(raw: unknown): DashboardLayout {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as DashboardLayout).cards)) return defaultDashboard();
  const seen = new Set<string>();
  const cards: DashboardCard[] = [];
  for (const entry of (raw as DashboardLayout).cards) {
    if (!entry || typeof entry !== "object") continue;
    const card = entry as DashboardCard;
    if (typeof card.id !== "string" || !card.id || seen.has(card.id)) continue;
    if (!CARD_TYPES.has(card.type)) continue;
    if (card.type === "custom" && (!card.query || typeof card.query !== "object")) continue;
    seen.add(card.id);
    const min = minCardSize(card);
    const info = builtinInfo(card.type);
    cards.push({
      id: card.id,
      type: card.type,
      title: typeof card.title === "string" ? card.title.slice(0, 120) : undefined,
      w: clampInt(card.w, min.w, DASHBOARD_COLUMNS),
      h: clampInt(card.h, min.h, DASHBOARD_MAX_ROWS),
      settings:
        info?.settings || card.settings
          ? { ...(info?.settings ?? {}), ...(card.settings && typeof card.settings === "object" ? card.settings : {}) }
          : undefined,
      query: card.type === "custom" ? fitQuery({ ...defaultQuery(card.query!.source), ...card.query! }) : undefined,
    });
    if (cards.length >= DASHBOARD_MAX_CARDS) break;
  }
  return { version: DASHBOARD_VERSION, cards };
}

// ---- Engine ----

export interface DashboardData {
  tasks?: Task[];
  reminders?: Task[];
  inbox?: Task[];
  projects?: Project[];
  /** GET /calendar items; only event and event-occurrence rows are read. */
  events?: CalendarItem[];
  docs?: Doc[];
  sheets?: Sheet[];
  workspaces?: Workspace[];
}

export interface EngineContext {
  now: Date;
  /** Working hours zone; undefined uses the device zone. */
  timeZone?: string;
}

export type EntityKind = "task" | "project" | "event" | "doc" | "sheet";

export interface CardRow {
  id: string;
  entity: EntityKind;
  title: string;
  subtitle?: string;
  /** Right-hand text: a date or a value. */
  meta?: string;
  tone?: "danger" | "success" | "muted";
  done?: boolean;
}

export interface SeriesPoint {
  key: string;
  label: string;
  value: number;
  /** Full label for tooltips (dates show the whole range). */
  detail?: string;
  /** True for the folded "Other" group. */
  other?: boolean;
}

export type CardUnit = "count" | "hours";

export type CardResult =
  | { kind: "number"; value: number; unit: CardUnit; previous?: number; periodLabel?: string; matched: number }
  | { kind: "list"; rows: CardRow[]; total: number }
  | { kind: "series"; points: SeriesPoint[]; unit: CardUnit; temporal: boolean; total: number }
  | { kind: "progress"; value: number; target: number; unit: CardUnit; matched: number };

/** One record from any source, flattened so filters and groups read the same fields. */
interface Item {
  id: string;
  entity: EntityKind;
  title: string;
  workspaceId: string | null;
  projectId: string | null;
  projectTitle?: string | null;
  statusId: string | null;
  statusName?: string | null;
  stageId: string | null;
  stageName?: string | null;
  labels: { id: string; name: string }[];
  priority: string | null;
  done: boolean;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  deadline: string | null;
  startDate: string | null;
  scheduled: string | null;
  start: string | null;
  overdue: boolean;
  recurring: boolean;
  isScheduled: boolean;
  estimateMinutes: number;
  trackedMinutes: number;
  durationMinutes: number;
}

const PRIORITY_ORDER = ["Urgent", "High", "Medium", "Low", "None"];

export function priorityName(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) return "None";
  const lower = trimmed.toLowerCase();
  if (lower === "critical") return "Urgent";
  return trimmed[0].toUpperCase() + trimmed.slice(1).toLowerCase();
}

function priorityRank(value?: string | null): number {
  const index = PRIORITY_ORDER.indexOf(priorityName(value));
  return index < 0 ? PRIORITY_ORDER.length : index;
}

/** The date a task's time on the calendar points at: its next block, else the last one, else `scheduledOn`. */
export function taskScheduledAt(task: Pick<Task, "blocks" | "scheduledOn">, now: Date): string | null {
  const blocks = [...(task.blocks ?? [])].sort((a, b) => a.start.localeCompare(b.start));
  const upcoming = blocks.find((block) => new Date(block.end).getTime() >= now.getTime());
  if (upcoming) return upcoming.start;
  if (blocks.length > 0) return blocks[blocks.length - 1].start;
  return task.scheduledOn ?? null;
}

function taskItem(task: Task, today: string, now: Date): Item {
  const labels = new Map<string, string>();
  for (const label of task.labels ?? []) labels.set(label.id, label.name);
  for (const label of task.labelIds ?? []) if (!labels.has(label.id)) labels.set(label.id, "");
  return {
    id: task.id,
    entity: "task",
    title: task.name || "Untitled task",
    workspaceId: task.workspaceId,
    projectId: task.project?.id ?? task.projectId,
    projectTitle: task.project?.title,
    statusId: task.status?.id ?? task.statusId,
    statusName: task.status?.name,
    stageId: task.stage?.id ?? task.stageId,
    stageName: task.stage?.name,
    labels: [...labels.entries()].map(([id, name]) => ({ id, name })),
    priority: task.priorityLevel,
    done: Boolean(task.completedAt),
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    deadline: task.deadline,
    startDate: task.startDate,
    scheduled: taskScheduledAt(task, now),
    start: taskScheduledAt(task, now),
    overdue: isOverdue(task, today),
    recurring: Boolean(task.recurrence),
    isScheduled: (task.blocks?.length ?? 0) > 0 || Boolean(task.scheduledOn),
    estimateMinutes: task.duration || 0,
    trackedMinutes: task.actualMinutes || 0,
    durationMinutes: task.duration || 0,
  };
}

function projectItem(project: Project, today: string): Item {
  const deadlineDay = project.deadline?.slice(0, 10) ?? "";
  return {
    id: project.id,
    entity: "project",
    title: project.title || "Untitled project",
    workspaceId: project.workspaceId,
    projectId: project.id,
    projectTitle: project.title,
    statusId: project.status?.id ?? project.statusId,
    statusName: project.status?.name,
    stageId: null,
    labels: [],
    priority: project.priorityLevel,
    done: Boolean(project.completedAt),
    completedAt: project.completedAt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    deadline: project.deadline,
    startDate: project.startDate,
    scheduled: project.startDate,
    start: project.startDate,
    overdue: !project.completedAt && Boolean(deadlineDay) && deadlineDay < today,
    recurring: false,
    isScheduled: false,
    estimateMinutes: 0,
    trackedMinutes: 0,
    durationMinutes: 0,
  };
}

function eventItem(item: CalendarItem): Item {
  const minutes = Math.max(0, (new Date(item.end).getTime() - new Date(item.start).getTime()) / 60_000);
  return {
    id: item.id,
    entity: "event",
    title: item.title || "Untitled event",
    workspaceId: item.event?.workspaceId ?? null,
    projectId: item.event?.projectId ?? null,
    statusId: null,
    stageId: null,
    labels: [],
    priority: null,
    done: false,
    completedAt: null,
    createdAt: item.event?.createdAt ?? null,
    updatedAt: item.event?.updatedAt ?? null,
    deadline: null,
    startDate: item.start,
    scheduled: item.start,
    start: item.start,
    overdue: false,
    recurring: item.kind === "eventOccurrence" || Boolean(item.event?.recurrence),
    isScheduled: true,
    estimateMinutes: 0,
    trackedMinutes: 0,
    durationMinutes: item.allDay ? 0 : minutes,
  };
}

function fileItem(entity: "doc" | "sheet", file: Doc | Sheet): Item {
  return {
    id: file.id,
    entity,
    title: file.title || (entity === "doc" ? "Untitled doc" : "Untitled sheet"),
    workspaceId: file.workspaceId,
    projectId: file.projectId,
    statusId: null,
    stageId: null,
    labels: [],
    priority: null,
    done: false,
    completedAt: null,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    deadline: null,
    startDate: null,
    scheduled: null,
    start: null,
    overdue: false,
    recurring: false,
    isScheduled: false,
    estimateMinutes: 0,
    trackedMinutes: 0,
    durationMinutes: 0,
  };
}

/** The records a source reads, before filters. */
function sourceItems(source: CardSource, data: DashboardData, today: string, now: Date): Item[] {
  switch (source) {
    case "tasks":
      return (data.tasks ?? []).filter((task) => task.kind !== "inbox" && task.kind !== "reminder").map((task) => taskItem(task, today, now));
    case "reminders":
      return (data.reminders ?? []).map((task) => taskItem(task, today, now));
    case "inbox":
      return (data.inbox ?? []).map((task) => taskItem(task, today, now));
    case "projects":
      return (data.projects ?? []).map((project) => projectItem(project, today));
    case "events":
      return (data.events ?? []).filter((item) => item.kind === "event" || item.kind === "eventOccurrence").map(eventItem);
    case "docs":
      return (data.docs ?? []).filter((doc) => !doc.archivedAt && !doc.isTemplate).map((doc) => fileItem("doc", doc));
    case "sheets":
      return (data.sheets ?? []).filter((sheet) => !sheet.archivedAt).map((sheet) => fileItem("sheet", sheet));
  }
}

/** Which datasets a query needs, so clients fetch only those. */
export function sourcesUsed(cards: DashboardCard[]): Set<CardSource | "today"> {
  const used = new Set<CardSource | "today">();
  for (const card of cards) {
    if (card.type === "custom" && card.query) used.add(card.query.source);
    if (card.type === "matrix" || card.type === "streak" || card.type === "highlights") used.add("tasks");
    if (card.type === "highlights") used.add("inbox");
    if (card.type === "today") used.add("today");
  }
  return used;
}

/** `YYYY-MM-DD` of an item's date field in the zone; deadlines read their own date like `isOverdue`. */
function itemDay(item: Item, field: CardDateField, timeZone?: string): string | null {
  const value = item[field === "scheduled" ? "scheduled" : field];
  if (!value) return null;
  if (field === "deadline" || field === "startDate") return value.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dateInZone(date, timeZone);
}

/** Monday of the week holding `day`. */
export function weekStart(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const weekday = (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7;
  return addDaysToDate(day, -weekday);
}

function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function monthEnd(day: string): string {
  const [year, month] = day.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${day.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

function addMonths(day: string, months: number): string {
  const [year, month] = day.split("-").map(Number);
  const moved = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** The inclusive day window of a range; null for all time. */
export function resolveRange(range: CardRange, today: string): { from: string; to: string } | null {
  switch (range.preset) {
    case "all":
      return null;
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const day = addDaysToDate(today, -1);
      return { from: day, to: day };
    }
    case "thisWeek": {
      const from = weekStart(today);
      return { from, to: addDaysToDate(from, 6) };
    }
    case "lastWeek": {
      const from = addDaysToDate(weekStart(today), -7);
      return { from, to: addDaysToDate(from, 6) };
    }
    case "thisMonth":
      return { from: monthStart(today), to: monthEnd(today) };
    case "lastMonth": {
      const from = addMonths(today, -1);
      return { from, to: monthEnd(from) };
    }
    case "last7":
      return { from: addDaysToDate(today, -6), to: today };
    case "last14":
      return { from: addDaysToDate(today, -13), to: today };
    case "last30":
      return { from: addDaysToDate(today, -29), to: today };
    case "last90":
      return { from: addDaysToDate(today, -89), to: today };
    case "next7":
      return { from: today, to: addDaysToDate(today, 6) };
    case "next14":
      return { from: today, to: addDaysToDate(today, 13) };
    case "next30":
      return { from: today, to: addDaysToDate(today, 29) };
    case "custom": {
      const valid = (value?: string) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
      const from = valid(range.from);
      const to = valid(range.to);
      if (!from && !to) return null;
      const start = from ?? "0000-01-01";
      const end = to ?? "9999-12-31";
      return start <= end ? { from: start, to: end } : { from: end, to: start };
    }
  }
}

/** The window just before `window`, same length (calendar-aligned for weeks and months). */
function previousWindow(range: CardRange, window: { from: string; to: string }): { from: string; to: string } | null {
  if (range.preset === "thisMonth" || range.preset === "lastMonth") {
    const from = addMonths(window.from, -1);
    return { from, to: monthEnd(from) };
  }
  if (range.preset === "custom" && (window.from === "0000-01-01" || window.to === "9999-12-31")) return null;
  const length = daysBetween(window.from, window.to) + 1;
  return { from: addDaysToDate(window.from, -length), to: addDaysToDate(window.from, -1) };
}

function matchesFilters(item: Item, filters: CardFilters): boolean {
  const state = filters.state ?? "all";
  if (state === "open" && item.done) return false;
  if (state === "done" && !item.done) return false;
  const has = (list?: string[]) => Boolean(list && list.length > 0);
  if (has(filters.workspaceIds) && (!item.workspaceId || !filters.workspaceIds!.includes(item.workspaceId))) return false;
  if (has(filters.projectIds) && (!item.projectId || !filters.projectIds!.includes(item.projectId))) return false;
  if (has(filters.statusIds) && (!item.statusId || !filters.statusIds!.includes(item.statusId))) return false;
  if (has(filters.labelIds) && !item.labels.some((label) => filters.labelIds!.includes(label.id))) return false;
  if (has(filters.priorities) && !filters.priorities!.includes(priorityName(item.priority))) return false;
  if (filters.overdue && !item.overdue) return false;
  if (filters.hasDeadline && !item.deadline) return false;
  if (filters.scheduled && !item.isScheduled) return false;
  if (filters.recurring && !item.recurring) return false;
  const text = filters.text?.trim().toLowerCase();
  if (text && !item.title.toLowerCase().includes(text)) return false;
  return true;
}

function inWindow(item: Item, field: CardDateField, window: { from: string; to: string } | null, timeZone?: string): boolean {
  if (!window) return true;
  const day = itemDay(item, field, timeZone);
  return day !== null && day >= window.from && day <= window.to;
}

function measureOf(item: Item, measure: CardMeasure): number {
  switch (measure) {
    case "count":
      return 1;
    case "estimate":
      return item.estimateMinutes / 60;
    case "tracked":
      return item.trackedMinutes / 60;
    case "duration":
      return item.durationMinutes / 60;
  }
}

function aggregate(items: Item[], query: CardQuery): number {
  if (query.measure === "count") return items.length;
  const values = items.map((item) => measureOf(item, query.measure));
  const sum = values.reduce((total, value) => total + value, 0);
  if (query.aggregate === "avg") return values.length ? sum / values.length : 0;
  return sum;
}

export interface Lookups {
  workspaces: Map<string, string>;
  statuses: Map<string, string>;
  projects: Map<string, string>;
  labels: Map<string, string>;
}

export function buildLookups(data: DashboardData): Lookups {
  const workspaces = new Map<string, string>();
  const statuses = new Map<string, string>();
  const labels = new Map<string, string>();
  const projects = new Map<string, string>();
  for (const workspace of data.workspaces ?? []) {
    workspaces.set(workspace.id, workspace.name);
    for (const status of workspace.status ?? []) statuses.set(status.id, status.name);
    for (const label of workspace.lables ?? []) labels.set(label.id, label.name);
  }
  for (const project of data.projects ?? []) {
    projects.set(project.id, project.title || "Untitled project");
    if (project.status) statuses.set(project.status.id, project.status.name);
  }
  for (const task of data.tasks ?? []) {
    if (task.project) projects.set(task.project.id, task.project.title || "Untitled project");
    if (task.status) statuses.set(task.status.id, task.status.name);
    for (const label of task.labels ?? []) labels.set(label.id, label.name);
  }
  return { workspaces, statuses, projects, labels };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDay(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  return `${MONTHS[month - 1]} ${date}`;
}

function dueBucket(item: Item, today: string): { key: string; label: string; order: number } {
  if (!item.deadline) return { key: "none", label: "No deadline", order: 5 };
  const day = item.deadline.slice(0, 10);
  if (!item.done && day < today) return { key: "overdue", label: "Overdue", order: 0 };
  if (day === today) return { key: "today", label: "Today", order: 1 };
  const diff = daysBetween(today, day);
  if (diff > 0 && diff <= 7) return { key: "week", label: "Next 7 days", order: 2 };
  if (diff > 0 && diff <= 30) return { key: "month", label: "Next 30 days", order: 3 };
  if (diff > 30) return { key: "later", label: "Later", order: 4 };
  return { key: "past", label: "Past", order: 0 };
}

interface Bucket {
  key: string;
  label: string;
  order: number | string;
  items: Item[];
  detail?: string;
}

function categoricalBuckets(items: Item[], query: CardQuery, lookups: Lookups, today: string, timeZone?: string): Bucket[] {
  const buckets = new Map<string, Bucket>();
  const add = (key: string, label: string, order: number | string, item: Item) => {
    const bucket = buckets.get(key) ?? { key, label, order, items: [] };
    bucket.items.push(item);
    buckets.set(key, bucket);
  };
  for (const item of items) {
    switch (query.groupBy) {
      case "status": {
        // Each workspace has its own "Todo"; a chart reads them as one status.
        const name = item.statusId ? item.statusName || lookups.statuses.get(item.statusId) || "Unknown status" : null;
        if (name) add(`status:${name.trim().toLowerCase()}`, name, 0, item);
        else add("none", "No status", 1, item);
        break;
      }
      case "priority": {
        const name = priorityName(item.priority);
        add(name, name, priorityRank(item.priority), item);
        break;
      }
      case "project":
        if (item.projectId) add(item.projectId, item.projectTitle || lookups.projects.get(item.projectId) || "Untitled project", 0, item);
        else add("none", "No project", 1, item);
        break;
      case "workspace":
        if (item.workspaceId) add(item.workspaceId, lookups.workspaces.get(item.workspaceId) || "Unknown workspace", 0, item);
        else add("none", "No workspace", 1, item);
        break;
      case "stage":
        if (item.stageId) add(item.stageId, item.stageName || "Stage", 0, item);
        else add("none", "No stage", 1, item);
        break;
      case "label":
        if (item.labels.length === 0) add("none", "No label", 1, item);
        for (const label of item.labels) add(label.id, label.name || lookups.labels.get(label.id) || "Label", 0, item);
        break;
      case "state":
        if (item.done) add("done", "Done", 1, item);
        else add("open", "Open", 0, item);
        break;
      case "due": {
        const bucket = dueBucket(item, today);
        add(bucket.key, bucket.label, bucket.order, item);
        break;
      }
      case "weekday": {
        const day = itemDay(item, query.dateField, timeZone);
        if (!day) break;
        const [year, month, date] = day.split("-").map(Number);
        const index = (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7;
        add(String(index), WEEKDAYS[index], index, item);
        break;
      }
      default:
        add("all", "All", 0, item);
    }
  }
  const list = [...buckets.values()];
  if (query.groupBy === "weekday") {
    for (let index = 0; index < 7; index += 1) {
      if (!buckets.has(String(index))) list.push({ key: String(index), label: WEEKDAYS[index], order: index, items: [] });
    }
  }
  return list;
}

const MAX_TIME_BUCKETS = 120;

function timeBuckets(items: Item[], query: CardQuery, window: { from: string; to: string } | null, timeZone?: string): Bucket[] {
  const keyOf = (day: string) => (query.groupBy === "week" ? weekStart(day) : query.groupBy === "month" ? monthStart(day) : day);
  const step = (key: string) =>
    query.groupBy === "week" ? addDaysToDate(key, 7) : query.groupBy === "month" ? addMonths(key, 1) : addDaysToDate(key, 1);
  const days = new Map<string, Item[]>();
  for (const item of items) {
    const day = itemDay(item, query.dateField, timeZone);
    if (!day) continue;
    const key = keyOf(day);
    days.set(key, [...(days.get(key) ?? []), item]);
  }
  let from = window?.from;
  let to = window?.to;
  if (!from || from === "0000-01-01" || !to || to === "9999-12-31") {
    const keys = [...days.keys()].sort();
    if (keys.length === 0) return [];
    if (!from || from === "0000-01-01") from = keys[0];
    if (!to || to === "9999-12-31") to = keys[keys.length - 1];
  }
  const buckets: Bucket[] = [];
  for (let key = keyOf(from); key <= to && buckets.length < 2000; key = step(key)) {
    const last = query.groupBy === "week" ? addDaysToDate(key, 6) : query.groupBy === "month" ? monthEnd(key) : key;
    const label = query.groupBy === "month" ? `${MONTHS[Number(key.slice(5, 7)) - 1]}${key.slice(2, 4) !== from.slice(2, 4) || key.slice(2, 4) !== to.slice(2, 4) ? ` '${key.slice(2, 4)}` : ""}` : shortDay(key);
    const detail = query.groupBy === "week" ? `Week of ${shortDay(key)} – ${shortDay(last)}` : query.groupBy === "month" ? `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}` : `${WEEKDAYS[(new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7]} ${shortDay(key)}`;
    buckets.push({ key, label, order: key, items: days.get(key) ?? [], detail });
  }
  return buckets.slice(-MAX_TIME_BUCKETS);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function compareText(a: string | null | undefined, b: string | null | undefined, dir: "asc" | "desc"): number {
  // Missing values sort last either way.
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return dir === "asc" ? a.localeCompare(b) : b.localeCompare(a);
}

export function formatHours(hours: number): string {
  if (hours === 0) return "0h";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${Math.round(hours * 10) / 10}h`;
}

function rowFor(item: Item, query: CardQuery, lookups: Lookups, today: string, timeZone?: string): CardRow {
  const parts: string[] = [];
  if (item.entity === "task" || item.entity === "project") {
    if (item.entity === "task") {
      const project = item.projectId ? item.projectTitle || lookups.projects.get(item.projectId) : null;
      parts.push(project || "No project");
    } else if (item.workspaceId) {
      parts.push(lookups.workspaces.get(item.workspaceId) ?? "");
    }
    if (item.priority) parts.push(priorityName(item.priority));
  } else if (item.workspaceId) {
    const workspace = lookups.workspaces.get(item.workspaceId);
    if (workspace) parts.push(workspace);
  }
  let meta: string | undefined;
  let tone: CardRow["tone"];
  const sortField = query.sort?.field;
  const dateField: CardDateField =
    sortField === "deadline" || sortField === "createdAt" || sortField === "updatedAt" || sortField === "completedAt"
      ? sortField
      : sortField === "start"
        ? item.entity === "event"
          ? "start"
          : "scheduled"
        : query.dateField;
  const day = itemDay(item, dateField, timeZone);
  if (day) {
    const diff = daysBetween(today, day);
    const relative = diff === 0 ? "today" : diff === 1 ? "tomorrow" : diff === -1 ? "yesterday" : diff > 0 ? `in ${diff}d` : `${-diff}d ago`;
    meta = `${shortDay(day)} · ${relative}`;
    if (item.entity === "event" && item.start && !/^\d{4}-\d{2}-\d{2}$/.test(item.start)) {
      const time = new Date(item.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone });
      meta = `${shortDay(day)} · ${time}`;
    }
  }
  if (item.overdue && dateField === "deadline") tone = "danger";
  if (item.done) tone = "success";
  if (query.measure !== "count") {
    const value = measureOf(item, query.measure);
    meta = meta ? `${formatHours(value)} · ${meta}` : formatHours(value);
  }
  return { id: item.id, entity: item.entity, title: item.title, subtitle: parts.filter(Boolean).join(" · ") || undefined, meta, tone, done: item.done };
}

function sortItems(items: Item[], query: CardQuery, timeZone?: string): Item[] {
  const sort = query.sort ?? { field: "name", dir: "asc" };
  const sorted = [...items];
  sorted.sort((a, b) => {
    switch (sort.field) {
      case "name":
        return compareText(a.title, b.title, sort.dir);
      case "priority":
        return sort.dir === "asc" ? priorityRank(a.priority) - priorityRank(b.priority) : priorityRank(b.priority) - priorityRank(a.priority);
      case "value": {
        const diff = measureOf(a, query.measure) - measureOf(b, query.measure);
        return sort.dir === "asc" ? diff : -diff;
      }
      case "start":
        return compareText(a.start ?? a.scheduled, b.start ?? b.scheduled, sort.dir);
      case "deadline":
        return compareText(a.deadline, b.deadline, sort.dir);
      default:
        return compareText(
          itemDay(a, sort.field, timeZone) ? (a[sort.field] as string) : null,
          itemDay(b, sort.field, timeZone) ? (b[sort.field] as string) : null,
          sort.dir,
        );
    }
  });
  return sorted;
}

/** Items a query keeps: source, filters and the time window. */
function selectItems(query: CardQuery, data: DashboardData, ctx: EngineContext, window: { from: string; to: string } | null): Item[] {
  const today = todayInZone(ctx.timeZone, ctx.now);
  return sourceItems(query.source, data, today, ctx.now).filter(
    (item) => matchesFilters(item, query.filters) && inWindow(item, query.dateField, window, ctx.timeZone),
  );
}

/** Runs a custom card's query against the account's data. */
export function computeCard(rawQuery: CardQuery, data: DashboardData, ctx: EngineContext): CardResult {
  const query = fitQuery(rawQuery);
  const today = todayInZone(ctx.timeZone, ctx.now);
  const window = resolveRange(query.range, today);
  const items = selectItems(query, data, ctx, window);
  const lookups = buildLookups(data);
  const unit: CardUnit = query.measure === "count" ? "count" : "hours";

  switch (query.display) {
    case "number": {
      const value = round(aggregate(items, query));
      if (!query.compare || !window) return { kind: "number", value, unit, matched: items.length };
      const previous = previousWindow(query.range, window);
      if (!previous) return { kind: "number", value, unit, matched: items.length };
      const before = round(aggregate(selectItems(query, data, ctx, previous), query));
      return { kind: "number", value, unit, previous: before, periodLabel: previousLabel(query.range.preset), matched: items.length };
    }
    case "progress": {
      if (query.progress === "goal") {
        return { kind: "progress", value: round(aggregate(items, query)), target: query.goal ?? 10, unit, matched: items.length };
      }
      // Completion reads done out of everything in scope, whatever the state filter says.
      const scope = selectItems({ ...query, filters: { ...query.filters, state: "all" } }, data, ctx, window);
      const done = scope.filter((item) => item.done);
      return {
        kind: "progress",
        value: round(aggregate(done, query)),
        target: round(aggregate(scope, query)),
        unit,
        matched: scope.length,
      };
    }
    case "list": {
      const sorted = sortItems(items, query, ctx.timeZone);
      return {
        kind: "list",
        rows: sorted.slice(0, query.limit ?? 8).map((item) => rowFor(item, query, lookups, today, ctx.timeZone)),
        total: items.length,
      };
    }
    default: {
      const temporal = query.groupBy === "day" || query.groupBy === "week" || query.groupBy === "month";
      const buckets = temporal ? timeBuckets(items, query, window, ctx.timeZone) : categoricalBuckets(items, query, lookups, today, ctx.timeZone);
      let points: SeriesPoint[] = buckets.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        value: round(aggregate(bucket.items, query)),
        detail: bucket.detail,
      }));
      if (!temporal) {
        const orderOf = new Map(buckets.map((bucket) => [bucket.key, bucket.order]));
        const byOrder = (a: SeriesPoint, b: SeriesPoint) => {
          const left = orderOf.get(a.key) ?? 0;
          const right = orderOf.get(b.key) ?? 0;
          if (typeof left === "number" && typeof right === "number" && left !== right) return left - right;
          return a.label.localeCompare(b.label);
        };
        const sort = query.sort?.field === "value" ? query.sort : query.groupBy === "priority" || query.groupBy === "due" || query.groupBy === "weekday" || query.groupBy === "state" ? null : { field: "value", dir: "desc" as const };
        if (sort) points.sort((a, b) => (sort.dir === "asc" ? a.value - b.value : b.value - a.value) || byOrder(a, b));
        else points.sort(byOrder);
        if (query.groupBy !== "weekday" && query.groupBy !== "due") points = points.filter((point) => point.value > 0);
        // Past the limit (and never more than 7 colours), the rest fold into Other.
        const cap = Math.min(query.limit ?? 8, query.display === "pie" ? 7 : 12);
        if (points.length > cap) {
          const kept = points.slice(0, cap - 1);
          const rest = points.slice(cap - 1);
          const restValue = round(query.measure !== "count" && query.aggregate === "avg" ? rest.reduce((sum, point) => sum + point.value, 0) / rest.length : rest.reduce((sum, point) => sum + point.value, 0));
          points = [...kept, { key: "__other", label: `Other (${rest.length})`, value: restValue, other: true }];
        }
      }
      return { kind: "series", points, unit, temporal, total: round(aggregate(items, query)) };
    }
  }
}

function previousLabel(preset: CardRangePreset): string {
  switch (preset) {
    case "today":
      return "vs yesterday";
    case "yesterday":
      return "vs the day before";
    case "thisWeek":
    case "lastWeek":
      return "vs the week before";
    case "thisMonth":
    case "lastMonth":
      return "vs the month before";
    default:
      return "vs the period before";
  }
}

// ---- Built-in card helpers ----

/** Tasks completed per day (`YYYY-MM-DD` in the zone). */
export function completionsByDay(tasks: Task[], timeZone?: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (!task.completedAt || task.kind === "inbox") continue;
    const date = new Date(task.completedAt);
    if (Number.isNaN(date.getTime())) continue;
    const day = dateInZone(date, timeZone);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return counts;
}

/**
 * Current and best run of consecutive days with at least one completion.
 * Today without a completion yet does not break the current run.
 */
export function completionStreak(counts: Map<string, number>, today: string): { current: number; best: number } {
  let current = 0;
  let cursor = (counts.get(today) ?? 0) > 0 ? today : addDaysToDate(today, -1);
  while ((counts.get(cursor) ?? 0) > 0) {
    current += 1;
    cursor = addDaysToDate(cursor, -1);
  }
  const days = [...counts.keys()].filter((day) => (counts.get(day) ?? 0) > 0).sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of days) {
    run = previous && daysBetween(previous, day) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return { current, best: Math.max(best, current) };
}

export type MatrixQuadrant = "do" | "schedule" | "quick" | "later";

export const MATRIX_LABELS: Record<MatrixQuadrant, { title: string; hint: string }> = {
  do: { title: "Do now", hint: "Important and due soon" },
  schedule: { title: "Schedule", hint: "Important, not due yet" },
  quick: { title: "Squeeze in", hint: "Due soon, lower priority" },
  later: { title: "Later", hint: "Neither pressing nor important" },
};

/** Sorts open work into the four quadrants. Urgent and High priority count as important. */
export function priorityMatrix(tasks: Task[], today: string, urgentDays = 3): Record<MatrixQuadrant, Task[]> {
  const result: Record<MatrixQuadrant, Task[]> = { do: [], schedule: [], quick: [], later: [] };
  const horizon = addDaysToDate(today, urgentDays);
  for (const task of tasks) {
    if (task.completedAt || task.kind === "inbox" || task.kind === "reminder") continue;
    const rank = priorityRank(task.priorityLevel);
    const important = rank <= 1;
    const deadline = task.deadline?.slice(0, 10);
    const urgent = Boolean(deadline && deadline <= horizon);
    const quadrant: MatrixQuadrant = important ? (urgent ? "do" : "schedule") : urgent ? "quick" : "later";
    result[quadrant].push(task);
  }
  for (const list of Object.values(result)) {
    list.sort((a, b) => compareText(a.deadline, b.deadline, "asc") || priorityRank(a.priorityLevel) - priorityRank(b.priorityLevel));
  }
  return result;
}

/** Share (0-1) of the working day, ISO week, month and year that has passed. */
export function timeProgress(
  now: Date,
  workday: { start: string; end: string } | null,
  timeZone?: string,
): { day: number; week: number; month: number; year: number; dayLabel: string } {
  const parts = zonedParts(now, timeZone);
  const minutes = parts.hour * 60 + parts.minute + parts.second / 60;
  const toMinutes = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    return (hour || 0) * 60 + (minute || 0);
  };
  const start = workday ? toMinutes(workday.start) : 0;
  const end = workday ? toMinutes(workday.end) : 24 * 60;
  const span = Math.max(1, end - start);
  const day = Math.min(1, Math.max(0, (minutes - start) / span));
  const today = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const weekday = (new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() + 6) % 7;
  const week = (weekday + minutes / 1440) / 7;
  const daysInMonth = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  const month = (parts.day - 1 + minutes / 1440) / daysInMonth;
  const leap = (parts.year % 4 === 0 && parts.year % 100 !== 0) || parts.year % 400 === 0;
  const dayOfYear = daysBetween(`${parts.year}-01-01`, today);
  const year = (dayOfYear + minutes / 1440) / (leap ? 366 : 365);
  const remaining = Math.max(0, end - minutes);
  const dayLabel =
    minutes < start
      ? "Workday hasn't started"
      : remaining <= 0
        ? "Workday is over"
        : `${Math.floor(remaining / 60)}h ${Math.round(remaining % 60)}m left`;
  return { day, week, month, year, dayLabel };
}

function zonedParts(now: Date, timeZone?: string) {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    });
    const values: Record<string, number> = {};
    for (const part of formatter.formatToParts(now)) {
      if (part.type !== "literal") values[part.type] = Number(part.value);
    }
    return { year: values.year, month: values.month, day: values.day, hour: values.hour % 24, minute: values.minute, second: values.second };
  } catch {
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      hour: now.getHours(),
      minute: now.getMinutes(),
      second: now.getSeconds(),
    };
  }
}

const WEEKDAY_KEYS: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Today's working window (`HH:MM`, first start to last end) from Working
 * hours, or null on a day off or when none are saved.
 */
export function workdayWindow(hours: WorkingHours | null | undefined, now: Date): { start: string; end: string } | null {
  if (!hours?.days) return null;
  const today = dateInZone(now, hours.timezone || undefined);
  const [year, month, day] = today.split("-").map(Number);
  const key = WEEKDAY_KEYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const windows = (hours.days[key] ?? []).filter((window) => window.start && window.end);
  if (windows.length === 0) return null;
  const starts = windows.map((window) => window.start).sort();
  const ends = windows.map((window) => window.end).sort();
  return { start: starts[0], end: ends[ends.length - 1] };
}

/** Whole days from today to `date`; negative once it has passed. */
export function daysUntil(date: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  return daysBetween(today, date.slice(0, 10));
}

// ---- Pomodoro ----

export type PomodoroPhase = "focus" | "short" | "long";

export interface PomodoroSettings {
  focus: number;
  shortBreak: number;
  longBreak: number;
  rounds: number;
  autoStart: boolean;
  sound: boolean;
}

export function pomodoroSettings(settings?: Record<string, unknown>): PomodoroSettings {
  const read = (key: string, fallback: number, max: number) => clampInt(settings?.[key] ?? fallback, 1, max);
  return {
    focus: read("focus", 25, 180),
    shortBreak: read("shortBreak", 5, 60),
    longBreak: read("longBreak", 15, 90),
    rounds: read("rounds", 4, 12),
    autoStart: settings?.autoStart === true,
    sound: settings?.sound !== false,
  };
}

/** Running timer state; clients persist it on the device so a reload keeps the clock. */
export interface PomodoroState {
  phase: PomodoroPhase;
  /** Focus rounds finished in the current cycle. */
  round: number;
  /** Epoch ms the running phase ends; null while paused or idle. */
  endsAt: number | null;
  /** Ms left while paused; null when idle (full phase length). */
  remaining: number | null;
  /** Ms added to (or taken off) the current phase with the +/- buttons; cleared when the phase changes. */
  extra?: number;
  taskId?: string | null;
  /** Focus rounds completed per day (`YYYY-MM-DD`), last 14 days kept. */
  history: Record<string, number>;
}

export function initialPomodoro(): PomodoroState {
  return { phase: "focus", round: 0, endsAt: null, remaining: null, history: {} };
}

export function phaseMinutes(phase: PomodoroPhase, settings: PomodoroSettings): number {
  return phase === "focus" ? settings.focus : phase === "short" ? settings.shortBreak : settings.longBreak;
}

/** The current phase's full length in ms, including time added or taken off. */
export function pomodoroLength(state: PomodoroState, settings: PomodoroSettings): number {
  return phaseMinutes(state.phase, settings) * 60_000 + (state.extra ?? 0);
}

export function pomodoroRemaining(state: PomodoroState, settings: PomodoroSettings, now: number): number {
  if (state.endsAt !== null) return Math.max(0, state.endsAt - now);
  if (state.remaining !== null) return state.remaining;
  return pomodoroLength(state, settings);
}

/** Longest a phase can run after adding time. */
export const POMODORO_MAX_MS = 180 * 60_000;

/**
 * Adds (or takes off) time on a running or paused phase without touching the
 * settings. Never leaves less than a second, so taking time off can't end the
 * phase by itself. An idle timer is returned unchanged.
 */
export function adjustPomodoro(state: PomodoroState, settings: PomodoroSettings, deltaMs: number, now: number): PomodoroState {
  if (state.endsAt === null && state.remaining === null) return state;
  const left = pomodoroRemaining(state, settings, now);
  const next = Math.min(POMODORO_MAX_MS, Math.max(1000, left + deltaMs));
  if (next === left) return state;
  const extra = (state.extra ?? 0) + (next - left);
  return state.endsAt !== null ? { ...state, endsAt: now + next, extra } : { ...state, remaining: next, extra };
}

/** Moves to the phase after the current one. A finished focus round counts toward today. */
export function advancePomodoro(state: PomodoroState, settings: PomodoroSettings, completed: boolean, today: string, now: number): PomodoroState {
  let { round } = state;
  let history = state.history;
  let next: PomodoroPhase;
  if (state.phase === "focus") {
    if (completed) {
      history = { ...history, [today]: (history[today] ?? 0) + 1 };
      const keep = Object.keys(history).sort().slice(-14);
      history = Object.fromEntries(keep.map((day) => [day, history[day]]));
    }
    round += 1;
    next = round >= settings.rounds ? "long" : "short";
  } else {
    if (state.phase === "long") round = 0;
    next = "focus";
  }
  const run = settings.autoStart && completed;
  return {
    ...state,
    phase: next,
    round,
    history,
    endsAt: run ? now + phaseMinutes(next, settings) * 60_000 : null,
    remaining: null,
    extra: 0,
  };
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Compact number for stat tiles: 1,284 / 12.9K. */
export function formatMetric(value: number, unit: CardUnit): string {
  if (unit === "hours") return formatHours(value);
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 100) / 10}K`;
  return Number.isInteger(value) ? value.toLocaleString("en-US") : (Math.round(value * 10) / 10).toLocaleString("en-US");
}

// ---- Highlights ----

export interface HighlightFact {
  id: string;
  text: string;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Facts the Highlights card sends to smart suggestions, worked out here so
 * every number is counted in code: finished work this week against last,
 * the completion streak, overdue and soon-due work, the busiest weekday and
 * the Inbox. Smart suggestions only pick which ones to highlight.
 */
export function highlightFacts(data: DashboardData, ctx: EngineContext): HighlightFact[] {
  const tasks = (data.tasks ?? []).filter((task) => task.kind !== "inbox" && task.kind !== "reminder");
  const today = todayInZone(ctx.timeZone, ctx.now);
  const facts: HighlightFact[] = [];
  const counts = completionsByDay(tasks, ctx.timeZone);
  const sum = (from: string, to: string) => {
    let total = 0;
    for (const [day, n] of counts) if (day >= from && day <= to) total += n;
    return total;
  };
  const thisWeek = sum(addDaysToDate(today, -6), today);
  const lastWeek = sum(addDaysToDate(today, -13), addDaysToDate(today, -7));
  facts.push({
    id: "done_week",
    text:
      lastWeek === thisWeek
        ? `Finished ${thisWeek} task${thisWeek === 1 ? "" : "s"} in the last 7 days, the same as the 7 days before.`
        : `Finished ${thisWeek} task${thisWeek === 1 ? "" : "s"} in the last 7 days, ${thisWeek > lastWeek ? "up" : "down"} from ${lastWeek} the 7 days before.`,
  });
  const streak = completionStreak(counts, today);
  if (streak.current > 0 || streak.best > 0) {
    facts.push({ id: "streak", text: `Current streak: ${streak.current} day${streak.current === 1 ? "" : "s"} in a row with something finished (best: ${streak.best}).` });
  }
  const open = tasks.filter((task) => !task.completedAt);
  const overdue = open.filter((task) => isOverdue(task, today));
  if (overdue.length) {
    const oldest = Math.max(...overdue.map((task) => daysBetween(task.deadline!.slice(0, 10), today)));
    facts.push({ id: "overdue", text: `${overdue.length} open task${overdue.length === 1 ? " is" : "s are"} past the deadline, the oldest by ${oldest} day${oldest === 1 ? "" : "s"}.` });
  }
  const horizon = addDaysToDate(today, 7);
  const dueSoon = open.filter((task) => task.deadline && task.deadline.slice(0, 10) >= today && task.deadline.slice(0, 10) <= horizon);
  if (dueSoon.length) {
    facts.push({ id: "due_week", text: `${dueSoon.length} open task${dueSoon.length === 1 ? " is" : "s are"} due in the next 7 days.` });
  }
  const noDeadline = open.filter((task) => !task.deadline).length;
  if (open.length) {
    facts.push({ id: "open", text: `${open.length} open task${open.length === 1 ? "" : "s"} in all; ${noDeadline} without a deadline.` });
  }
  const byWeekday = new Array(7).fill(0);
  let recent = 0;
  for (const [day, n] of counts) {
    if (day < addDaysToDate(today, -27) || day > today) continue;
    const [y, m, d] = day.split("-").map(Number);
    byWeekday[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] += n;
    recent += n;
  }
  if (recent >= 5) {
    const best = byWeekday.indexOf(Math.max(...byWeekday));
    facts.push({ id: "busiest_day", text: `Over the last 4 weeks you finished the most on ${WEEKDAY_NAMES[best]}s (${byWeekday[best]} of ${recent} tasks).` });
  }
  const inbox = (data.inbox ?? []).filter((task) => !task.completedAt);
  if (inbox.length) {
    const waiting = inbox.filter((task) => task.createdAt && daysBetween(task.createdAt.slice(0, 10), today) >= 3).length;
    facts.push({ id: "inbox", text: `${inbox.length} item${inbox.length === 1 ? "" : "s"} in the Inbox; ${waiting} waiting 3 days or more.` });
  }
  return facts;
}
