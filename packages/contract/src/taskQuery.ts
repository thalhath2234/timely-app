/**
 * The task query engine both apps use for saved views: which tasks a view
 * shows (its filter fields plus `rules`), their order and how they group. Web
 * and phone used to keep their own copies and disagreed on order, so every
 * list now reads this file.
 *
 * Dates are judged in the Working hours timezone, like Overdue
 * (`workStatus.ts`): `today` comes from `todayInZone`.
 */
import type {
  TaskListGroupField,
  TaskListSortDirection,
  TaskRuleField,
  TaskRuleOp,
  TaskViewCondition,
  TaskViewConfig,
  TaskViewRule,
  TaskViewRuleGroup,
  TaskViewRuleMatch,
  TaskViewSortBy,
} from "./config";
import type { CustomField, CustomFieldType, Task } from "./entities";
import { addDaysToDate, dateInZone, daysBetween, isOverdue, todayInZone } from "./workStatus";

// ---- Field catalogue ----

export type RuleFieldKind = "choice" | "text" | "date" | "number" | "flag";

export interface RuleFieldInfo {
  label: string;
  kind: RuleFieldKind;
  ops: TaskRuleOp[];
}

const CHOICE_OPS: TaskRuleOp[] = ["anyOf", "noneOf", "isEmpty", "isNotEmpty"];
const TEXT_OPS: TaskRuleOp[] = ["contains", "notContains", "is", "startsWith", "isEmpty", "isNotEmpty"];
const DATE_OPS: TaskRuleOp[] = ["in", "notIn", "before", "onOrBefore", "after", "onOrAfter", "between", "isEmpty", "isNotEmpty"];
const NUMBER_OPS: TaskRuleOp[] = ["eq", "neq", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"];
const FLAG_OPS: TaskRuleOp[] = ["is"];

/** Every built-in field a rule can read, in the order a picker lists them. */
export const RULE_FIELDS: Record<Exclude<TaskRuleField, `cf:${string}`>, RuleFieldInfo> = {
  deadline: { label: "Deadline", kind: "date", ops: DATE_OPS },
  planned: { label: "Planned day", kind: "date", ops: DATE_OPS },
  startDate: { label: "Start date", kind: "date", ops: DATE_OPS },
  createdAt: { label: "Created", kind: "date", ops: DATE_OPS },
  updatedAt: { label: "Updated", kind: "date", ops: DATE_OPS },
  completedAt: { label: "Completed", kind: "date", ops: DATE_OPS },
  priority: { label: "Priority", kind: "choice", ops: [...CHOICE_OPS, "gte", "lte"] },
  status: { label: "Status", kind: "choice", ops: CHOICE_OPS },
  project: { label: "Project", kind: "choice", ops: CHOICE_OPS },
  workspace: { label: "Workspace", kind: "choice", ops: CHOICE_OPS },
  stage: { label: "Stage", kind: "choice", ops: CHOICE_OPS },
  label: { label: "Labels", kind: "choice", ops: ["anyOf", "allOf", "noneOf", "isEmpty", "isNotEmpty"] },
  effort: { label: "Effort", kind: "choice", ops: CHOICE_OPS },
  name: { label: "Name", kind: "text", ops: TEXT_OPS },
  description: { label: "Description", kind: "text", ops: TEXT_OPS },
  text: { label: "Any text", kind: "text", ops: ["contains", "notContains"] },
  duration: { label: "Estimate", kind: "number", ops: NUMBER_OPS },
  tracked: { label: "Time tracked", kind: "number", ops: NUMBER_OPS },
  progress: { label: "Checklist progress", kind: "number", ops: NUMBER_OPS },
  urgency: { label: "Urgency", kind: "number", ops: NUMBER_OPS },
  done: { label: "Done", kind: "flag", ops: FLAG_OPS },
  overdue: { label: "Overdue", kind: "flag", ops: FLAG_OPS },
  scheduled: { label: "On the calendar", kind: "flag", ops: FLAG_OPS },
  recurring: { label: "Repeating", kind: "flag", ops: FLAG_OPS },
  blocked: { label: "Blocked", kind: "flag", ops: FLAG_OPS },
  blocking: { label: "Blocking other work", kind: "flag", ops: FLAG_OPS },
  hasChecklist: { label: "Has a checklist", kind: "flag", ops: FLAG_OPS },
  overEstimate: { label: "Over its estimate", kind: "flag", ops: FLAG_OPS },
  inFocus: { label: "In focus", kind: "flag", ops: FLAG_OPS },
  todayFocus: { label: "Today's focus", kind: "flag", ops: FLAG_OPS },
  locked: { label: "Schedule locked", kind: "flag", ops: FLAG_OPS },
};

const CUSTOM_KIND: Record<CustomFieldType, RuleFieldKind> = {
  text: "text",
  url: "text",
  select: "choice",
  multi_select: "choice",
  number: "number",
  date: "date",
  boolean: "flag",
};

/** What a rule field is: a built-in one, or a custom field when `cf:` names one. */
export function ruleFieldInfo(field: string, customFields: readonly CustomField[] = []): RuleFieldInfo | undefined {
  if (field.startsWith("cf:")) {
    const custom = customFields.find((item) => item.id === field.slice(3));
    if (!custom) return undefined;
    const kind = CUSTOM_KIND[custom.type] ?? "text";
    const ops =
      kind === "choice"
        ? custom.type === "multi_select"
          ? ["anyOf", "allOf", "noneOf", "isEmpty", "isNotEmpty"]
          : CHOICE_OPS
        : kind === "text"
          ? TEXT_OPS.filter((op) => op !== "startsWith" || custom.type === "text")
          : kind === "date"
            ? DATE_OPS
            : kind === "number"
              ? NUMBER_OPS
              : FLAG_OPS;
    return { label: custom.name, kind, ops: ops as TaskRuleOp[] };
  }
  return (RULE_FIELDS as Record<string, RuleFieldInfo>)[field];
}

export const PRIORITY_VALUES = ["Low", "Medium", "High", "Urgent"] as const;
export const EFFORT_VALUES = ["deep", "admin", "creative", "routine"] as const;

/** A priority's name as stored ("critical" reads as Urgent), or "" for none. */
export function priorityValue(value?: string | null): string {
  switch ((value ?? "").trim().toLowerCase()) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "urgent":
    case "critical":
      return "Urgent";
    default:
      return "";
  }
}

/** Low 1 to Urgent 4; 0 for none. */
export function priorityWeight(value?: string | null): number {
  const index = PRIORITY_VALUES.indexOf(priorityValue(value) as (typeof PRIORITY_VALUES)[number]);
  return index + 1;
}

// ---- Rule shape ----

export function isRuleGroup(rule: TaskViewRule): rule is TaskViewRuleGroup {
  return Array.isArray((rule as TaskViewRuleGroup).rules);
}

const MAX_RULES = 30;

const ALL_OPS = new Set<TaskRuleOp>([
  "anyOf", "noneOf", "allOf", "isEmpty", "isNotEmpty", "contains", "notContains", "startsWith", "is",
  "eq", "neq", "gt", "gte", "lt", "lte", "between", "in", "notIn", "before", "after", "onOrBefore", "onOrAfter",
]);

function cleanValue(value: unknown): TaskViewCondition["value"] | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").slice(0, 50);
  return undefined;
}

function cleanCondition(raw: unknown): TaskViewCondition | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const field = typeof record.field === "string" ? record.field : "";
  const op = record.op as TaskRuleOp;
  if (!field || !ALL_OPS.has(op)) return null;
  if (!field.startsWith("cf:") && !(field in RULE_FIELDS)) return null;
  const condition: TaskViewCondition = { field: field as TaskRuleField, op };
  const value = cleanValue(record.value);
  if (value !== undefined) condition.value = value;
  if (typeof record.to === "string" || typeof record.to === "number") condition.to = record.to;
  return condition;
}

/**
 * A view's `rules` as the engine reads them: anything malformed (an unknown
 * field or op, a group inside a group) is dropped rather than failing the
 * whole view, since views may come from an older or newer app.
 */
export function normalizeRules(raw: unknown): TaskViewRule[] {
  if (!Array.isArray(raw)) return [];
  const out: TaskViewRule[] = [];
  for (const item of raw) {
    if (out.length >= MAX_RULES) break;
    if (item && typeof item === "object" && Array.isArray((item as TaskViewRuleGroup).rules)) {
      const group = item as TaskViewRuleGroup;
      const rules = group.rules.map(cleanCondition).filter((rule): rule is TaskViewCondition => rule !== null);
      if (rules.length) out.push({ match: group.match === "any" ? "any" : "all", rules });
      continue;
    }
    const condition = cleanCondition(item);
    if (condition) out.push(condition);
  }
  return out;
}

// ---- Dates ----

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

/** Monday of the week holding `day`. */
export function mondayOf(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const weekday = (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7;
  return addDaysToDate(day, -weekday);
}

export interface DayRange {
  from: string;
  to: string;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The inclusive days a date value names, judged from `today`; null when the
 * value is not a date. See `TaskViewCondition` for the words it takes.
 */
export function resolveDateValue(value: unknown, today: string): DayRange | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (ISO_DAY.test(text)) return { from: text, to: text };
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return { from: text.slice(0, 10), to: text.slice(0, 10) };
  const offset = /^([+-])(\d{1,4})$/.exec(text);
  if (offset) {
    const day = addDaysToDate(today, (offset[1] === "-" ? -1 : 1) * Number(offset[2]));
    return { from: day, to: day };
  }
  const window = /^(next|last):(\d{1,4})$/.exec(text);
  if (window) {
    const days = Number(window[2]);
    return window[1] === "next" ? { from: today, to: addDaysToDate(today, days) } : { from: addDaysToDate(today, -days), to: today };
  }
  const monday = mondayOf(today);
  switch (text) {
    case "today":
      return { from: today, to: today };
    case "tomorrow": {
      const day = addDaysToDate(today, 1);
      return { from: day, to: day };
    }
    case "yesterday": {
      const day = addDaysToDate(today, -1);
      return { from: day, to: day };
    }
    case "thisWeek":
      return { from: monday, to: addDaysToDate(monday, 6) };
    case "nextWeek":
      return { from: addDaysToDate(monday, 7), to: addDaysToDate(monday, 13) };
    case "lastWeek":
      return { from: addDaysToDate(monday, -7), to: addDaysToDate(monday, -1) };
    case "thisWeekend":
      return { from: addDaysToDate(monday, 5), to: addDaysToDate(monday, 6) };
    case "thisMonth":
      return { from: monthStart(today), to: monthEnd(today) };
    case "nextMonth": {
      const from = addMonths(today, 1);
      return { from, to: monthEnd(from) };
    }
    case "lastMonth": {
      const from = addMonths(today, -1);
      return { from, to: monthEnd(from) };
    }
    case "thisYear":
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    default:
      return null;
  }
}

const OFFSET_SUFFIX = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

/** The day of a stored value: a bare date as is, an instant in `timeZone`. */
export function dayOf(value: string | null | undefined, timeZone?: string | null): string | null {
  if (!value) return null;
  const text = value.trim().replace(" ", "T");
  if (ISO_DAY.test(text)) return text;
  const time = text.indexOf("T");
  if (time < 0) return null;
  if (!OFFSET_SUFFIX.test(text.slice(time + 1))) return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
  const normalized = text.replace(/([+-]\d{2})(\d{2})$/, "$1:$2").replace(/([+-]\d{2})$/, "$1:00");
  const instant = new Date(normalized);
  return Number.isNaN(instant.getTime()) ? null : dateInZone(instant, timeZone);
}

// ---- Context ----

export interface QueryContext {
  today: string;
  timeZone?: string | null;
  now: Date;
  /** Open state of every task by id, for "blocked". */
  doneById: Map<string, boolean>;
  /** Ids of tasks some open task waits on, for "blocking". */
  blockingIds: Set<string>;
  /** Stage names by id, for sorting and grouping by stage. */
  stageNames?: Record<string, string>;
}

/** What rules need to know beyond one task, built once per list. */
export function queryContext(
  tasks: readonly Task[],
  timeZone?: string | null,
  now: Date = new Date(),
  stageNames?: Record<string, string>,
): QueryContext {
  const doneById = new Map<string, boolean>();
  const blockingIds = new Set<string>();
  for (const task of tasks) {
    doneById.set(task.id, Boolean(task.completedAt));
    if (task.blockedById && !task.completedAt) blockingIds.add(task.blockedById);
  }
  return { today: todayInZone(timeZone, now), timeZone, now, doneById, blockingIds, stageNames };
}

// ---- Reading a task ----

function labelIdsOf(task: Task): string[] {
  const ids = new Set<string>();
  for (const label of task.labels ?? []) ids.add(label.id);
  for (const label of task.labelIds ?? []) ids.add(label.id);
  return [...ids];
}

/** Days the task has calendar time on: its blocks, else its `scheduledOn`. */
function plannedDays(task: Task, timeZone?: string | null): string[] {
  const days: string[] = [];
  for (const block of task.blocks ?? []) {
    const day = dayOf(block.start, timeZone);
    if (day) days.push(day);
  }
  if (days.length === 0) {
    const day = dayOf(task.scheduledOn, timeZone);
    if (day) days.push(day);
  }
  return days.sort();
}

function customValue(task: Task, fieldId: string) {
  return task.customFieldValues?.find((entry) => entry.customFieldId === fieldId);
}

function checklistPercent(task: Task): number | null {
  const total = task.checklistTotal ?? task.checklist?.length ?? 0;
  if (total > 0) {
    const done = task.checklistDone ?? task.checklist?.filter((item) => item.completedAt).length ?? 0;
    return Math.round((done / total) * 100);
  }
  if (task.progressTotal && task.progressTotal > 0) return Math.round(((task.progressDone ?? 0) / task.progressTotal) * 100);
  return null;
}

/** The days a date field holds for a task (several for planned time). */
function dateDays(task: Task, field: string, ctx: QueryContext): string[] {
  switch (field) {
    case "deadline":
      return task.deadline ? [task.deadline.slice(0, 10)] : [];
    case "startDate":
      return task.startDate ? [task.startDate.slice(0, 10)] : [];
    case "planned":
      return plannedDays(task, ctx.timeZone);
    case "createdAt":
    case "updatedAt":
    case "completedAt": {
      const day = dayOf(task[field], ctx.timeZone);
      return day ? [day] : [];
    }
    default: {
      if (!field.startsWith("cf:")) return [];
      const day = customValue(task, field.slice(3))?.stringValue?.slice(0, 10);
      return day && ISO_DAY.test(day) ? [day] : [];
    }
  }
}

function numberOf(task: Task, field: string): number | null {
  switch (field) {
    case "duration":
      return task.duration > 0 ? task.duration : null;
    case "tracked":
      return task.actualMinutes && task.actualMinutes > 0 ? task.actualMinutes : null;
    case "urgency":
      return typeof task.urgency === "number" ? task.urgency : null;
    case "progress":
      return checklistPercent(task);
    default: {
      if (!field.startsWith("cf:")) return null;
      const raw = customValue(task, field.slice(3))?.stringValue?.trim();
      if (!raw) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    }
  }
}

function textOf(task: Task, field: string): string {
  switch (field) {
    case "name":
      return task.name ?? "";
    case "description":
      return task.description ?? "";
    case "text":
      return [task.name, task.description, ...(task.checklist ?? []).map((item) => item.title)].filter(Boolean).join("\n");
    default:
      return field.startsWith("cf:") ? customValue(task, field.slice(3))?.stringValue ?? "" : "";
  }
}

/** The ids (or names, for priority and effort) a choice field holds. */
function choicesOf(task: Task, field: string): string[] {
  switch (field) {
    case "workspace": {
      const id = task.workspace?.id ?? task.workspaceId;
      return id ? [id] : [];
    }
    case "project": {
      const id = task.project?.id ?? task.projectId;
      return id ? [id] : [];
    }
    case "status": {
      const id = task.status?.id ?? task.statusId;
      return id ? [id] : [];
    }
    case "stage": {
      const id = task.stage?.id ?? task.stageId;
      return id ? [id] : [];
    }
    case "label":
      return labelIdsOf(task);
    case "priority": {
      const value = priorityValue(task.priorityLevel);
      return value ? [value] : [];
    }
    case "effort":
      return task.effortKind ? [task.effortKind] : [];
    default: {
      if (!field.startsWith("cf:")) return [];
      const value = customValue(task, field.slice(3));
      return (value?.optionValue ?? []).map((option) => option.id);
    }
  }
}

function flagOf(task: Task, field: string, ctx: QueryContext): boolean {
  switch (field) {
    case "done":
      return Boolean(task.completedAt);
    case "overdue":
      return isOverdue(task, ctx.today);
    case "recurring":
      return Boolean(task.recurrence);
    case "scheduled":
      return (task.blocks?.length ?? 0) > 0 || Boolean(task.scheduledOn);
    case "blocked":
      // A blocker that is not in the list (deleted, or another account's) still blocks.
      return Boolean(task.blockedById) && ctx.doneById.get(task.blockedById!) !== true;
    case "blocking":
      return ctx.blockingIds.has(task.id);
    case "hasChecklist":
      return (task.checklistTotal ?? task.checklist?.length ?? 0) > 0;
    case "overEstimate":
      return task.duration > 0 && (task.actualMinutes ?? 0) > task.duration;
    case "inFocus":
      return Boolean(task.focusStartedAt || task.focusPausedAt);
    case "todayFocus":
      return Boolean(task.todayFocusOn) && task.todayFocusOn!.slice(0, 10) === ctx.today;
    case "locked":
      return Boolean(task.scheduleLocked);
    default: {
      if (!field.startsWith("cf:")) return false;
      const value = customValue(task, field.slice(3));
      if (typeof value?.boolValue === "boolean") return value.boolValue;
      return value?.stringValue === "true";
    }
  }
}

/** A custom field's kind from its value on the task, else from the rule's op. */
function fieldKind(rule: TaskViewCondition, task: Task): RuleFieldKind {
  const { field, op } = rule;
  if (!field.startsWith("cf:")) return (RULE_FIELDS as Record<string, RuleFieldInfo>)[field]?.kind ?? "text";
  const type = customValue(task, field.slice(3))?.type as CustomFieldType | undefined;
  if (type && CUSTOM_KIND[type]) return CUSTOM_KIND[type];
  if (op === "is" && typeof rule.value === "boolean") return "flag";
  if (op === "anyOf" || op === "noneOf" || op === "allOf") return "choice";
  if (op === "in" || op === "notIn" || op === "before" || op === "after" || op === "onOrBefore" || op === "onOrAfter") return "date";
  if (op === "eq" || op === "neq" || op === "gt" || op === "gte" || op === "lt" || op === "lte") return "number";
  if (op === "between") return typeof rule.value === "number" ? "number" : "date";
  return "text";
}

function asList(value: TaskViewCondition["value"]): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value) return [value];
  return [];
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeText(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

function matchCondition(task: Task, rule: TaskViewCondition, ctx: QueryContext): boolean {
  const { field, op } = rule;
  // A custom field the task has no value for reads as empty, whatever its type.
  const kind = fieldKind(rule, task);

  if (kind === "flag") {
    const want = rule.value !== false;
    return flagOf(task, field, ctx) === want;
  }

  if (kind === "date") {
    const days = dateDays(task, field, ctx);
    if (op === "isEmpty") return days.length === 0;
    if (op === "isNotEmpty") return days.length > 0;
    if (days.length === 0) return false;
    const range = resolveDateValue(rule.value, ctx.today);
    if (!range) return true;
    switch (op) {
      case "in":
        return days.some((day) => day >= range.from && day <= range.to);
      case "notIn":
        return !days.some((day) => day >= range.from && day <= range.to);
      case "before":
        return days[0] < range.from;
      case "onOrBefore":
        return days[0] <= range.to;
      case "after":
        return days[days.length - 1] > range.to;
      case "onOrAfter":
        return days[days.length - 1] >= range.from;
      case "between": {
        const end = resolveDateValue(rule.to, ctx.today) ?? range;
        const from = range.from <= end.to ? range.from : end.from;
        const to = range.from <= end.to ? end.to : range.to;
        return days.some((day) => day >= from && day <= to);
      }
      default:
        return true;
    }
  }

  if (kind === "number") {
    const value = numberOf(task, field);
    if (op === "isEmpty") return value === null;
    if (op === "isNotEmpty") return value !== null;
    const target = asNumber(rule.value);
    if (target === null) return true;
    // A task with no value never passes a comparison: "under 30 minutes"
    // leaves out work that has no estimate.
    if (value === null) return false;
    switch (op) {
      case "eq":
        return value === target;
      case "neq":
        return value !== target;
      case "gt":
        return value > target;
      case "gte":
        return value >= target;
      case "lt":
        return value < target;
      case "lte":
        return value <= target;
      case "between": {
        const upper = asNumber(rule.to) ?? target;
        return value >= Math.min(target, upper) && value <= Math.max(target, upper);
      }
      default:
        return true;
    }
  }

  if (kind === "choice") {
    const held = choicesOf(task, field);
    if (op === "isEmpty") return held.length === 0;
    if (op === "isNotEmpty") return held.length > 0;
    if (field === "priority" && (op === "gte" || op === "lte")) {
      const weight = priorityWeight(task.priorityLevel);
      const target = priorityWeight(typeof rule.value === "string" ? rule.value : "");
      if (!target) return true;
      if (!weight) return false;
      return op === "gte" ? weight >= target : weight <= target;
    }
    const wanted = asList(rule.value).map((value) => (field === "priority" ? priorityValue(value) || value : value));
    if (wanted.length === 0) return true;
    switch (op) {
      case "anyOf":
      case "is":
        return held.some((value) => wanted.includes(value));
      case "noneOf":
        return !held.some((value) => wanted.includes(value));
      case "allOf":
        return wanted.every((value) => held.includes(value));
      default:
        return true;
    }
  }

  const text = normalizeText(textOf(task, field));
  if (op === "isEmpty") return text.trim() === "";
  if (op === "isNotEmpty") return text.trim() !== "";
  const needle = normalizeText(typeof rule.value === "string" ? rule.value : String(rule.value ?? "")).trim();
  if (!needle) return true;
  switch (op) {
    case "contains":
      return text.includes(needle);
    case "notContains":
      return !text.includes(needle);
    case "is":
      return text.trim() === needle;
    case "startsWith":
      return text.trimStart().startsWith(needle);
    default:
      return true;
  }
}

function matchRule(task: Task, rule: TaskViewRule, ctx: QueryContext): boolean {
  if (!isRuleGroup(rule)) return matchCondition(task, rule, ctx);
  if (rule.rules.length === 0) return true;
  return rule.match === "any"
    ? rule.rules.some((inner) => matchCondition(task, inner, ctx))
    : rule.rules.every((inner) => matchCondition(task, inner, ctx));
}

/** Whether a task passes a view's rules. No rules passes everything. */
export function matchesRules(
  task: Task,
  rules: readonly TaskViewRule[] | undefined,
  match: TaskViewRuleMatch | undefined,
  ctx: QueryContext,
): boolean {
  if (!rules || rules.length === 0) return true;
  return match === "any" ? rules.some((rule) => matchRule(task, rule, ctx)) : rules.every((rule) => matchRule(task, rule, ctx));
}

// ---- Filters (a view's fields plus its rules) ----

export type TaskListFilters = {
  workspaceIds: string[];
  statusIds: string[];
  projectIds: string[];
  priorityLevels: string[];
  labelIds: string[];
  stageIds: string[];
  showCompleted: boolean;
  onlyOverdue: boolean;
  onlyScheduled: boolean;
  onlyRecurring: boolean;
  /** Only tasks with a deadline or reserved time; the "My Deadlines" predicate. */
  onlyDated: boolean;
  showReminders: boolean;
  rules?: TaskViewRule[];
  ruleMatch?: TaskViewRuleMatch;
};

export const DEFAULT_TASK_FILTERS: TaskListFilters = {
  workspaceIds: [],
  statusIds: [],
  projectIds: [],
  priorityLevels: [],
  labelIds: [],
  stageIds: [],
  showCompleted: true,
  onlyOverdue: false,
  onlyScheduled: false,
  onlyRecurring: false,
  onlyDated: false,
  showReminders: false,
};

/** Built-in views whose name promises a date filter. Older saved configs
 * predate the flag, so the id doubles as the default until the user changes it. */
const DEADLINE_VIEW_IDS = new Set(["view_my_deadlines"]);

export function resolveViewOnlyDated(view: Pick<TaskViewConfig, "id" | "onlyDated">): boolean {
  if (typeof view.onlyDated === "boolean") return view.onlyDated;
  return DEADLINE_VIEW_IDS.has(view.id);
}

export function resolveViewShowCompleted(view: Pick<TaskViewConfig, "id" | "showCompleted">): boolean {
  if (typeof view.showCompleted === "boolean") return view.showCompleted;
  return !DEADLINE_VIEW_IDS.has(view.id);
}

export function filtersFromView(view: TaskViewConfig): TaskListFilters {
  return {
    workspaceIds: view.selectedWorkspaceIds ?? [],
    statusIds: view.selectedStatusIds ?? [],
    projectIds: view.selectedProjectIds ?? [],
    priorityLevels: view.selectedPriorityLevels ?? [],
    labelIds: view.selectedLabelIds ?? [],
    stageIds: view.selectedStageIds ?? [],
    showCompleted: resolveViewShowCompleted(view),
    onlyOverdue: Boolean(view.onlyOverdue),
    onlyScheduled: Boolean(view.onlyScheduled),
    onlyRecurring: Boolean(view.onlyRecurring),
    onlyDated: resolveViewOnlyDated(view),
    showReminders: Boolean(view.showReminders),
    rules: normalizeRules(view.rules),
    ruleMatch: view.ruleMatch,
  };
}

export function isReminderTask(task: Task): boolean {
  if (task.kind === "inbox") return false;
  if (task.kind === "reminder") return true;
  return (task.duration ?? 0) <= 0 && task.kind !== "task";
}

/** A deadline, calendar time or a repeat rule: the "My Deadlines" predicate. */
export function taskHasAnyDate(task: Task): boolean {
  return Boolean(task.deadline) || (task.blocks?.length ?? 0) > 0 || Boolean(task.scheduledOn) || Boolean(task.recurrence);
}

/**
 * The tasks a view's filters keep. `timeZone` is the Working hours timezone
 * dates are judged in; undefined means the device zone. `all` is the full
 * task list when `tasks` is already a subset, so "blocked" can see blockers.
 */
export function filterTasks(
  tasks: Task[],
  filters: TaskListFilters,
  timeZone?: string | null,
  options: { now?: Date; all?: readonly Task[] } = {},
): Task[] {
  const ctx = queryContext(options.all ?? tasks, timeZone, options.now);
  const wantedWorkspaces = new Set(filters.workspaceIds);
  const wantedStatuses = new Set(filters.statusIds);
  const wantedProjects = new Set(filters.projectIds);
  const wantedPriorities = new Set(filters.priorityLevels);
  const wantedLabels = new Set(filters.labelIds);
  const wantedStages = new Set(filters.stageIds);
  const rules = filters.rules ?? [];

  return tasks.filter((task) => {
    if (task.kind === "inbox") return false;
    if (filters.showReminders) {
      if (!isReminderTask(task)) return false;
    } else if (isReminderTask(task)) {
      return false;
    }

    if (!filters.showCompleted && task.completedAt) return false;
    if (filters.onlyOverdue && !isOverdue(task, ctx.today)) return false;
    if (filters.onlyScheduled && !task.scheduledOn && !(task.blocks && task.blocks.length > 0)) return false;
    if (filters.onlyRecurring && !task.recurrence) return false;
    if (filters.onlyDated && !taskHasAnyDate(task)) return false;

    if (wantedWorkspaces.size) {
      const workspaceId = task.workspace?.id || task.workspaceId;
      if (!workspaceId || !wantedWorkspaces.has(workspaceId)) return false;
    }
    if (wantedStatuses.size) {
      const statusId = task.status?.id || task.statusId;
      if (!statusId || !wantedStatuses.has(statusId)) return false;
    }
    if (wantedProjects.size) {
      const projectId = task.project?.id || task.projectId;
      if (!projectId || !wantedProjects.has(projectId)) return false;
    }
    if (wantedPriorities.size) {
      if (!task.priorityLevel || !wantedPriorities.has(task.priorityLevel)) return false;
    }
    if (wantedLabels.size) {
      if (!labelIdsOf(task).some((id) => wantedLabels.has(id))) return false;
    }
    if (wantedStages.size) {
      if (!task.stageId || !wantedStages.has(task.stageId)) return false;
    }

    return matchesRules(task, rules, filters.ruleMatch, ctx);
  });
}

// ---- Sorting ----

export interface TaskSort {
  sortBy: TaskViewSortBy;
  sortDirection: TaskListSortDirection;
  thenSortBy?: TaskViewSortBy;
  thenSortDirection?: TaskListSortDirection;
}

/** The value a sort reads; null sorts last whichever the direction. */
function sortValue(task: Task, by: TaskViewSortBy, ctx: QueryContext): string | number | null {
  switch (by) {
    case "name":
      return (task.name || "").toLocaleLowerCase() || null;
    case "deadline":
      return task.deadline ? task.deadline.slice(0, 10) : null;
    case "startDate":
      return task.startDate ? task.startDate.slice(0, 10) : null;
    case "scheduledOn": {
      const starts = (task.blocks ?? []).map((block) => block.start).sort();
      return starts[0] ?? task.scheduledOn ?? null;
    }
    case "createdAt":
      return task.createdAt || null;
    case "updatedAt":
      return task.updatedAt || null;
    case "completedAt":
      return task.completedAt || null;
    case "priority":
      return priorityWeight(task.priorityLevel) || null;
    case "status":
      return task.status?.name?.toLocaleLowerCase() || null;
    case "project":
      return task.project?.title?.toLocaleLowerCase() || null;
    case "workspace":
      return task.workspace?.name?.toLocaleLowerCase() || null;
    case "stage": {
      const id = task.stage?.id ?? task.stageId;
      return (id && (ctx.stageNames?.[id] ?? task.stage?.name)?.toLocaleLowerCase()) || null;
    }
    case "duration":
    case "tracked":
    case "urgency":
    case "progress":
      return numberOf(task, by);
    case "effort":
      return task.effortKind ?? null;
    default: {
      if (!by.startsWith("cf:")) return null;
      const value = customValue(task, by.slice(3));
      if (!value) return null;
      if (value.optionValue?.length) return value.optionValue.map((option) => option.value).join(", ").toLocaleLowerCase();
      if (typeof value.boolValue === "boolean") return value.boolValue ? 1 : 0;
      const raw = value.stringValue?.trim();
      if (!raw) return null;
      const number = Number(raw);
      return value.type === "number" && Number.isFinite(number) ? number : raw.toLocaleLowerCase();
    }
  }
}

function compareValues(left: string | number | null, right: string | number | null, direction: TaskListSortDirection): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const compared =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
  return direction === "desc" ? -compared : compared;
}

/**
 * Compares two tasks for a view: its sort, then its second sort, then (for a
 * deadline sort) the higher priority. Empty values go last either way.
 */
export function compareTasks(a: Task, b: Task, sort: TaskSort, ctx: QueryContext): number {
  const first = compareValues(sortValue(a, sort.sortBy, ctx), sortValue(b, sort.sortBy, ctx), sort.sortDirection);
  if (first !== 0) return first;
  if (sort.thenSortBy) {
    const second = compareValues(
      sortValue(a, sort.thenSortBy, ctx),
      sortValue(b, sort.thenSortBy, ctx),
      sort.thenSortDirection ?? "asc",
    );
    if (second !== 0) return second;
  } else if (sort.sortBy === "deadline") {
    return compareValues(priorityWeight(a.priorityLevel) || null, priorityWeight(b.priorityLevel) || null, "desc");
  }
  return 0;
}

/** A sorted copy. */
export function sortTasks(tasks: readonly Task[], sort: TaskSort, ctx: QueryContext): Task[] {
  return [...tasks].sort((a, b) => compareTasks(a, b, sort, ctx));
}

export function viewSort(view: Pick<TaskViewConfig, "sortBy" | "sortDirection" | "thenSortBy" | "thenSortDirection"> | undefined): TaskSort {
  return {
    sortBy: view?.sortBy ?? "deadline",
    sortDirection: view?.sortDirection ?? "asc",
    thenSortBy: view?.thenSortBy,
    thenSortDirection: view?.thenSortDirection,
  };
}

/** A view's row limit, or undefined for every row. */
export function viewLimit(view: Pick<TaskViewConfig, "limit"> | undefined): number | undefined {
  const limit = view?.limit;
  return typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined;
}

/**
 * The rows a view shows: filtered, sorted and cut to its limit. Callers that
 * group or roll up projects use `filterTasks` and `compareTasks` directly.
 */
export function runView(
  tasks: Task[],
  view: TaskViewConfig,
  options: { timeZone?: string | null; now?: Date; stageNames?: Record<string, string> } = {},
): Task[] {
  const ctx = queryContext(tasks, options.timeZone, options.now, options.stageNames);
  const rows = filterTasks(tasks, filtersFromView(view), options.timeZone, { now: options.now }).sort((a, b) =>
    compareTasks(a, b, viewSort(view), ctx),
  );
  const limit = viewLimit(view);
  return limit ? rows.slice(0, limit) : rows;
}

// ---- Grouping ----

/** Group fields this file labels; the apps label the rest (workspace, project, ...). */
export const BUCKET_GROUP_FIELDS = new Set<string>([
  "label",
  "deadline",
  "planned",
  "startDate",
  "createdAt",
  "updatedAt",
  "completedAt",
  "effort",
  "done",
  "recurring",
]);

const AHEAD_BUCKETS = ["Overdue", "Earlier", "Today", "Tomorrow", "This week", "Next week", "Later"];
const PAST_BUCKETS = ["Today", "Yesterday", "This week", "Last week", "This month", "Earlier"];
const EFFORT_LABELS: Record<string, string> = { deep: "Deep work", admin: "Admin", creative: "Creative", routine: "Routine" };

export const GROUP_FIELD_LABELS: Record<string, string> = {
  workspace: "Workspace",
  project: "Project",
  stage: "Stage",
  status: "Status",
  priority: "Priority",
  label: "Label",
  deadline: "Deadline",
  planned: "Planned day",
  startDate: "Start date",
  createdAt: "Created",
  updatedAt: "Updated",
  completedAt: "Completed",
  effort: "Effort",
  done: "Done or open",
  recurring: "Repeating",
};

const EMPTY_LABEL: Record<string, string> = {
  label: "No labels",
  deadline: "No deadline",
  planned: "Not planned",
  startDate: "No start date",
  createdAt: "Unknown",
  updatedAt: "Unknown",
  completedAt: "Not done",
  effort: "No effort set",
};

function aheadBucket(day: string, today: string, overdue: boolean): string {
  if (day < today) return overdue ? "Overdue" : "Earlier";
  if (day === today) return "Today";
  if (day === addDaysToDate(today, 1)) return "Tomorrow";
  const monday = mondayOf(today);
  if (day <= addDaysToDate(monday, 6)) return "This week";
  if (day <= addDaysToDate(monday, 13)) return "Next week";
  return "Later";
}

function pastBucket(day: string, today: string): string {
  const gap = daysBetween(day, today);
  if (gap <= 0) return "Today";
  if (gap === 1) return "Yesterday";
  const monday = mondayOf(today);
  if (day >= monday) return "This week";
  if (day >= addDaysToDate(monday, -7)) return "Last week";
  if (day >= monthStart(today)) return "This month";
  return "Earlier";
}

/**
 * The group labels a task falls under for one of `BUCKET_GROUP_FIELDS`:
 * several for labels, one otherwise. `labelNames` names label ids the task
 * carries without a preloaded label. Undefined for any other field.
 */
export function bucketGroupLabels(
  task: Task,
  field: TaskListGroupField | string,
  ctx: QueryContext,
  labelNames: Record<string, string> = {},
): string[] | undefined {
  if (!BUCKET_GROUP_FIELDS.has(field)) return undefined;
  switch (field) {
    case "label": {
      const names = new Map<string, string>();
      for (const label of task.labels ?? []) names.set(label.id, label.name);
      for (const label of task.labelIds ?? []) if (!names.has(label.id)) names.set(label.id, labelNames[label.id] ?? "");
      const list = [...names.values()].filter(Boolean);
      return list.length ? [...new Set(list)] : [EMPTY_LABEL.label];
    }
    case "effort":
      return [task.effortKind ? EFFORT_LABELS[task.effortKind] ?? task.effortKind : EMPTY_LABEL.effort];
    case "done":
      return [task.completedAt ? "Done" : "Open"];
    case "recurring":
      return [task.recurrence ? "Repeating" : "One-off"];
    case "deadline":
    case "planned":
    case "startDate": {
      const days = dateDays(task, field, ctx);
      if (days.length === 0) return [EMPTY_LABEL[field]];
      const upcoming = days.find((day) => day >= ctx.today) ?? days[days.length - 1];
      return [aheadBucket(upcoming, ctx.today, field === "deadline" && isOverdue(task, ctx.today))];
    }
    default: {
      const days = dateDays(task, field, ctx);
      if (days.length === 0) return [EMPTY_LABEL[field] ?? "Unknown"];
      return [pastBucket(days[0], ctx.today)];
    }
  }
}

/**
 * The natural order of a bucket label (Overdue before Today before Later),
 * or undefined when groups of this field sort by name.
 */
export function bucketGroupRank(field: TaskListGroupField | string, label: string): number | undefined {
  let order: string[] | undefined;
  if (field === "deadline" || field === "planned" || field === "startDate") order = [...AHEAD_BUCKETS, EMPTY_LABEL[field]];
  else if (field === "createdAt" || field === "updatedAt" || field === "completedAt") order = [...PAST_BUCKETS, EMPTY_LABEL[field] ?? "Unknown"];
  else if (field === "done") order = ["Open", "Done"];
  else if (field === "recurring") order = ["Repeating", "One-off"];
  else if (field === "effort") order = [...Object.values(EFFORT_LABELS), EMPTY_LABEL.effort];
  else if (field === "label") return label === EMPTY_LABEL.label ? Number.MAX_SAFE_INTEGER : undefined;
  if (!order) return undefined;
  const index = order.indexOf(label);
  return index < 0 ? order.length : index;
}
