/**
 * What the rule builder on the Tasks screens (web toolbar, phone View sheet)
 * offers: the fields a rule can read, the conditions for each, the values a
 * choice field takes and the date words. Both apps draw their editors from
 * here so a rule made on one reads the same on the other.
 */
import type { TaskRuleField, TaskRuleOp, TaskViewCondition, TaskViewRule } from "./config";
import type { CustomField } from "./entities";
import { EFFORT_VALUES, PRIORITY_VALUES, RULE_FIELDS, ruleFieldInfo, type RuleFieldKind } from "./taskQuery";
import type { ViewVocabulary, VocabItem } from "./viewLanguage";

export interface RuleFieldChoice {
  field: TaskRuleField;
  label: string;
  kind: RuleFieldKind;
  /** Heading the field is listed under. */
  section: string;
}

const SECTIONS: [string, (keyof typeof RULE_FIELDS)[]][] = [
  ["Dates", ["deadline", "planned", "startDate", "createdAt", "updatedAt", "completedAt"]],
  ["Where", ["workspace", "project", "stage", "status", "label"]],
  ["Details", ["priority", "effort", "name", "description", "text", "duration", "tracked", "progress", "urgency"]],
  [
    "State",
    ["done", "overdue", "scheduled", "recurring", "blocked", "blocking", "hasChecklist", "overEstimate", "inFocus", "todayFocus", "locked"],
  ],
];

/**
 * Every field a rule can read, by section, then the person's custom fields.
 * A project's own list leaves out workspace and project.
 */
export function ruleFieldChoices(
  customFields: readonly CustomField[] = [],
  options: { scope?: "global" | "project" } = {},
): RuleFieldChoice[] {
  const out: RuleFieldChoice[] = [];
  for (const [section, fields] of SECTIONS) {
    for (const field of fields) {
      if (options.scope === "project" && (field === "workspace" || field === "project")) continue;
      const info = RULE_FIELDS[field];
      out.push({ field, label: info.label, kind: info.kind, section });
    }
  }
  const seen = new Set<string>();
  for (const custom of customFields) {
    if (seen.has(custom.id)) continue;
    seen.add(custom.id);
    const field = `cf:${custom.id}` as TaskRuleField;
    const info = ruleFieldInfo(field, customFields);
    if (info) out.push({ field, label: info.label, kind: info.kind, section: "Custom fields" });
  }
  return out;
}

const OP_WORDS: Record<RuleFieldKind, Partial<Record<TaskRuleOp, string>>> = {
  date: {
    in: "is in",
    notIn: "is not in",
    before: "is before",
    onOrBefore: "is on or before",
    after: "is after",
    onOrAfter: "is on or after",
    between: "is between",
    isEmpty: "is not set",
    isNotEmpty: "is set",
  },
  choice: {
    anyOf: "is any of",
    noneOf: "is none of",
    allOf: "has all of",
    gte: "is at least",
    lte: "is at most",
    isEmpty: "is not set",
    isNotEmpty: "is set",
  },
  text: {
    contains: "contains",
    notContains: "doesn't contain",
    is: "is exactly",
    startsWith: "starts with",
    isEmpty: "is empty",
    isNotEmpty: "is not empty",
  },
  number: {
    eq: "is",
    neq: "is not",
    gt: "is over",
    gte: "is at least",
    lt: "is under",
    lte: "is at most",
    between: "is between",
    isEmpty: "is not set",
    isNotEmpty: "is set",
  },
  flag: { is: "is" },
};

/** The conditions a field takes, in words: "is in", "is any of", "contains". */
export function ruleOpChoices(field: string, customFields: readonly CustomField[] = []): { value: TaskRuleOp; label: string }[] {
  const info = ruleFieldInfo(field, customFields);
  if (!info) return [];
  return info.ops.map((op) => ({ value: op, label: OP_WORDS[info.kind][op] ?? op }));
}

/** Whether a condition needs a value (everything but "is set" / "is not set"). */
export function opTakesValue(op: TaskRuleOp): boolean {
  return op !== "isEmpty" && op !== "isNotEmpty";
}

/** The unit a number field is counted in, for the value box. */
export function numberUnit(field: string): string {
  if (field === "duration" || field === "tracked") return "min";
  if (field === "progress") return "%";
  return "";
}

/** A new rule on `field` that already does something: this week, yes, a blank list. */
export function newCondition(field: TaskRuleField, customFields: readonly CustomField[] = []): TaskViewCondition {
  const info = ruleFieldInfo(field, customFields);
  const kind = info?.kind ?? "text";
  switch (kind) {
    case "date":
      return { field, op: "in", value: "thisWeek" };
    case "flag":
      return { field, op: "is", value: true };
    case "choice":
      return { field, op: "anyOf", value: [] };
    case "number":
      return { field, op: field === "duration" ? "lte" : "gte", value: field === "duration" ? 30 : field === "progress" ? 50 : 1 };
    default:
      return { field, op: "contains", value: "" };
  }
}

/** The same rule under a new condition, with its value reshaped to fit. */
export function withOp(rule: TaskViewCondition, op: TaskRuleOp, customFields: readonly CustomField[] = []): TaskViewCondition {
  const kind = ruleFieldInfo(rule.field, customFields)?.kind ?? "text";
  const next: TaskViewCondition = { field: rule.field, op };
  if (!opTakesValue(op)) return next;
  if (kind === "choice") {
    const list = Array.isArray(rule.value) ? rule.value : typeof rule.value === "string" && rule.value ? [rule.value] : [];
    // "Priority is at least High" takes one level; the lists take many.
    next.value = op === "gte" || op === "lte" ? (list[0] ?? "High") : list;
    return next;
  }
  if (kind === "date") {
    next.value = typeof rule.value === "string" && rule.value ? rule.value : "today";
    if (op === "between") next.to = typeof rule.to === "string" && rule.to ? rule.to : "+7";
    return next;
  }
  if (kind === "number") {
    next.value = typeof rule.value === "number" ? rule.value : Number(rule.value) || 0;
    if (op === "between") next.to = typeof rule.to === "number" ? rule.to : (next.value as number) + 30;
    return next;
  }
  next.value = rule.value ?? (kind === "flag" ? true : "");
  return next;
}

export interface RuleChoice {
  /** The first id; the key for a list. */
  value: string;
  /** Every id the choice stands for: statuses of one name across workspaces. */
  ids: string[];
  label: string;
  color?: string;
}

function byName(items: readonly VocabItem[] | undefined): RuleChoice[] {
  const out = new Map<string, RuleChoice>();
  for (const item of items ?? []) {
    const key = item.name.trim().toLowerCase();
    const found = out.get(key);
    if (found) found.ids.push(item.id);
    else out.set(key, { value: item.id, ids: [item.id], label: item.name, color: item.color });
  }
  return [...out.values()];
}

const EFFORT_LABELS: Record<string, string> = { deep: "Deep work", admin: "Admin", creative: "Creative", routine: "Routine" };

/** The values a choice field takes, with names merged across workspaces. */
export function ruleChoices(field: string, vocab: ViewVocabulary = {}): RuleChoice[] {
  switch (field) {
    case "priority":
      return PRIORITY_VALUES.map((level) => ({ value: level, ids: [level], label: level }));
    case "effort":
      return EFFORT_VALUES.map((kind) => ({ value: kind, ids: [kind], label: EFFORT_LABELS[kind] ?? kind }));
    case "workspace":
      return (vocab.workspaces ?? []).map((item) => ({ value: item.id, ids: [item.id], label: item.name, color: item.color }));
    case "project":
      return (vocab.projects ?? []).map((item) => ({ value: item.id, ids: [item.id], label: item.name, color: item.color }));
    case "status":
      return byName(vocab.statuses);
    case "stage":
      return byName(vocab.stages);
    case "label":
      return byName(vocab.labels);
    default: {
      if (!field.startsWith("cf:")) return [];
      const custom = vocab.customFields?.find((item) => `cf:${item.id}` === field);
      return (custom?.options?.options ?? []).map((option) => ({
        value: option.id,
        ids: [option.id],
        label: option.value,
        color: option.color,
      }));
    }
  }
}

/** Whether every id of a choice is in the rule's list. */
export function choiceSelected(rule: TaskViewCondition, choice: RuleChoice): boolean {
  const list = Array.isArray(rule.value) ? rule.value : [];
  return choice.ids.every((id) => list.includes(id));
}

/** The rule with a choice added to, or taken off, its list. */
export function toggleChoice(rule: TaskViewCondition, choice: RuleChoice): TaskViewCondition {
  const list = Array.isArray(rule.value) ? rule.value : [];
  const value = choiceSelected(rule, choice)
    ? list.filter((id) => !choice.ids.includes(id))
    : [...new Set([...list, ...choice.ids])];
  return { ...rule, value };
}

/** Date words a rule can hold, so a saved view keeps moving with the calendar. */
export const DATE_PRESETS: { value: string; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "yesterday", label: "Yesterday" },
  { value: "thisWeek", label: "This week" },
  { value: "nextWeek", label: "Next week" },
  { value: "lastWeek", label: "Last week" },
  { value: "thisMonth", label: "This month" },
  { value: "nextMonth", label: "Next month" },
  { value: "lastMonth", label: "Last month" },
  { value: "next:7", label: "Next 7 days" },
  { value: "last:7", label: "Last 7 days" },
  { value: "last:30", label: "Last 30 days" },
  { value: "+7", label: "In 7 days" },
  { value: "-7", label: "7 days ago" },
  { value: "-30", label: "30 days ago" },
];

/** True for a fixed day (`YYYY-MM-DD`) rather than a date word. */
export function isFixedDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Rules with the one at `index` replaced (or removed with `null`). */
export function replaceRule(rules: readonly TaskViewRule[], index: number, rule: TaskViewRule | null): TaskViewRule[] {
  if (rule === null) return rules.filter((_, at) => at !== index);
  return rules.map((item, at) => (at === index ? rule : item));
}
