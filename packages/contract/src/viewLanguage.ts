/**
 * Reads a plain-words request ("show task deadline", "urgent bugs in Home due
 * this week as a board") as a task view: rules, sort, groups, layout and a
 * limit. It needs no AI key, so search and the Tasks screens work offline;
 * an AI reading (`POST /agent/view-query`) replaces it when words are left
 * over. `describeView` turns any view back into chips and a sentence.
 *
 * Text is matched lower-cased with single spaces and a space at each end, so
 * every pattern starts with a space and ends at one (`W`): no lookbehind,
 * which keeps it working in Hermes.
 */
import type {
  TaskListGroupField,
  TaskListSortDirection,
  TaskRuleField,
  TaskRuleOp,
  TaskViewCondition,
  TaskViewConfig,
  TaskViewRule,
  TaskViewSortBy,
} from "./config";
import type { CustomField } from "./entities";
import { addDaysToDate, todayInZone } from "./workStatus";
import { GROUP_FIELD_LABELS, isRuleGroup, mondayOf, normalizeRules, priorityValue, resolveDateValue, ruleFieldInfo } from "./taskQuery";

// ---- Public shapes ----

export interface VocabItem {
  id: string;
  name: string;
}

/** The person's own names the reader knows; statuses repeat per workspace. */
export interface ViewVocabulary {
  workspaces?: readonly VocabItem[];
  projects?: readonly VocabItem[];
  statuses?: readonly VocabItem[];
  stages?: readonly VocabItem[];
  labels?: readonly VocabItem[];
  customFields?: readonly CustomField[];
}

/** A view without its id and name. */
export type ViewDraft = Omit<TaskViewConfig, "id" | "name">;

export interface ViewReading {
  view: ViewDraft;
  /** A name for the view: the person's ("called Bugs") or one made from the filters. */
  name: string;
  /** True when the person named the view. */
  named: boolean;
  /** "new view …", "make a view for …": save it straight away. */
  createView: boolean;
  /** Asked to see something ("show", "list", "which") or named work ("tasks"). */
  listing: boolean;
  /** Filters, sorts, groups, layouts and limits read from known words. */
  understood: number;
  /** How many of those were only one of the person's names (a project, a label). */
  entities: number;
  /** Words nothing placed; each became a "mentions" filter. */
  leftover: string[];
}

// ---- Words ----

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, couple: 2, "couple of": 2, few: 3, "a few": 3, several: 5,
};
const NUM = `(\\d{1,4}|a few|a couple of|couple of|a couple|couple|few|several|an|a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty)`;

function toNumber(word: string | undefined, fallback = 1): number {
  if (!word) return fallback;
  const text = word.replace(/^a (?=few|couple)/, "").trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  return NUMBER_WORDS[text] ?? fallback;
}

/** Words that ask to see something; they carry no filter. */
const VERBS = /^(show|list|find|display|view|see|get|give|what|which|whats|open|pull|bring|filter|search|look|lookup|tell|where|wheres|need|want|have|got|are|is)$/;

/** Words for work itself. */
const NOUNS = /^(tasks?|todos?|to-?dos?|items?|things?|stuff|work|jobs?|assignments?|actions?|cards?|entries|entry|ones?)$/;

const FILLER = new Set([
  "a", "about", "all", "also", "am", "an", "and", "any", "anything", "are", "as", "at", "be", "been", "being", "but", "by", "can",
  "could", "do", "does", "doing", "for", "from", "give", "got", "had", "has", "have", "having", "hey", "how", "i", "id", "if", "im",
  "in", "into", "is", "it", "its", "ive", "just", "kind", "kinds", "let", "lets", "like", "me", "mine", "my", "myself", "need",
  "needs", "now", "of", "off", "on", "only", "or", "our", "out", "over", "please", "pls", "really", "right", "should", "so",
  "some", "sort", "than", "that", "thats", "the", "their", "them", "then", "there", "these", "they", "this", "those", "to", "u",
  "up", "us", "very", "was", "we", "were", "what", "whats", "when", "where", "which", "while", "who", "why", "will", "with",
  "would", "yet", "you", "your", "did", "get", "gets", "got", "everything", "every", "each", "currently", "still", "go", "going", "ok", "okay", "thanks",
  "thank", "maybe", "much", "many", "more", "most", "less", "least", "one", "ones", "view", "views", "page", "screen", "tab",
  "list", "lists", "here", "same", "other", "others", "else", "next", "first", "last", "time", "times", "day", "days", "week",
  "weeks", "month", "months", "year", "years", "should", "must", "might", "may", "able", "make", "made", "create", "new",
]);

function stripPlural(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("es") && /(ss|sh|ch|x)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Lower case, plain apostrophes gone ("today's" reads "today"), punctuation as spaces. */
export function normalizeWords(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`]/g, "'")
    .replace(/'s\b/g, "")
    .replace(/'/g, "")
    .replace(/[“”]/g, '"')
    .replace(/(\d)\s*%/g, "$1%")
    .replace(/(\d),(\d)/g, "$1$2")
    .replace(/[,;!?(){}\[\]]+/g, " , ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/\s*:\s*/g, " : ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** A pattern that starts after a space and ends before one. */
function W(source: string): RegExp {
  return new RegExp(` (?:${source})(?= )`, "g");
}

// ---- Dates ----

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const WEEKDAY_SHORT: Record<string, number> = { mon: 0, tue: 1, tues: 1, wed: 2, thu: 3, thur: 3, thurs: 3, fri: 4, sat: 5, sun: 6 };
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const MONTH_ALT = `${MONTHS.join("|")}|sept|${MONTH_SHORT.filter((name) => name !== "may" && name !== "mar").join("|")}`;
const WEEKDAY_ALT = WEEKDAYS.join("|");
const UNIT = "(days?|weeks?|months?|years?)";

/** Date phrases, longest first; each is read again by `dateSpec`. */
const DATE_PHRASES = [
  "end of (?:the |this )?(?:week|month)",
  "eow|eom",
  `(?:in |within |over |during |for )?(?:the )?(?:next|coming|upcoming|following) ${NUM} ${UNIT}`,
  `(?:in |within |over |during |for )?(?:the )?(?:next|coming|upcoming|following) ${UNIT}`,
  `(?:in |within |over |during |for )?(?:the )?(?:last|past|previous) ${NUM} ${UNIT}`,
  `(?:in |within |over |during |for )?(?:the )?past ${UNIT}`,
  `${NUM} ${UNIT} ago`,
  `${NUM} ${UNIT} from (?:now|today)`,
  `(?:with)?in ${NUM} ${UNIT}`,
  "this coming week|the coming week|this week|next week|last week|this weekend|the weekend|next weekend|weekend",
  "this month|next month|last month|this year|next year|last year",
  "today|tonight|tomorrow|tmrw|tmr|yesterday|soon|upcoming|coming up|recently|lately",
  `(?:this |next |last |coming )?(?:${WEEKDAY_ALT})`,
  `(?:this |next |last |coming )(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)`,
  "\\d{4}-\\d{2}-\\d{2}",
  `(?:${MONTH_ALT}) \\d{1,2}(?:st|nd|rd|th)?`,
  `\\d{1,2}(?:st|nd|rd|th)? (?:of )?(?:${MONTH_ALT})`,
  `(?:early|mid|late|end of) (?:${MONTHS.join("|")})`,
];
// Inner groups do not capture, so a pattern built around a date counts its own groups.
const DATE_SRC = DATE_PHRASES.join("|").replace(/\((?!\?)/g, "(?:");

/** What a date phrase names: a range word, a day, or a span of days. */
interface DateSpec {
  value: string;
  /** For an "on or before" or "between", the end of a span ("by end of month"). */
  to?: string;
}

function iso(today: string, offset: number): string {
  return addDaysToDate(today, offset);
}

function monthIndex(word: string): number {
  const full = MONTHS.indexOf(word);
  if (full >= 0) return full;
  if (word === "sept") return 8;
  return MONTH_SHORT.indexOf(word);
}

function dayOfMonth(today: string, month: number, day: number): string {
  const year = Number(today.slice(0, 4));
  const stamp = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // A date well in the past means next year's ("jan 5" asked in December).
  return stamp < addDaysToDate(today, -180) ? `${year + 1}${stamp.slice(4)}` : stamp;
}

function unitDays(unit: string, count: number): number {
  if (unit.startsWith("week")) return count * 7;
  if (unit.startsWith("month")) return count * 30;
  if (unit.startsWith("year")) return count * 365;
  return count;
}

/** Date words with one meaning ("last week" is Monday to Sunday, not 7 days). */
function exactDate(text: string, today: string, monday: string): DateSpec | null {
  switch (text) {
    case "this week":
      return { value: "thisWeek" };
    case "next week":
    case "this coming week":
    case "the coming week":
      return { value: "nextWeek" };
    case "last week":
      return { value: "lastWeek" };
    case "this weekend":
    case "the weekend":
    case "weekend":
      return { value: "thisWeekend" };
    case "next weekend":
      return { value: iso(monday, 12), to: iso(monday, 13) };
    case "this month":
      return { value: "thisMonth" };
    case "next month":
      return { value: "nextMonth" };
    case "last month":
      return { value: "lastMonth" };
    case "this year":
      return { value: "thisYear" };
    case "next year": {
      const year = Number(today.slice(0, 4)) + 1;
      return { value: `${year}-01-01`, to: `${year}-12-31` };
    }
    case "last year": {
      const year = Number(today.slice(0, 4)) - 1;
      return { value: `${year}-01-01`, to: `${year}-12-31` };
    }
    case "today":
    case "tonight":
      return { value: "today" };
    case "tomorrow":
    case "tmrw":
    case "tmr":
      return { value: "tomorrow" };
    case "yesterday":
      return { value: "yesterday" };
    case "soon":
    case "upcoming":
    case "coming up":
      return { value: "next:7" };
    case "recently":
    case "lately":
      return { value: "last:7" };
  }
  return null;
}

function dateSpec(phrase: string, today: string): DateSpec | null {
  const text = phrase.trim();
  const monday = mondayOf(today);
  const exact = exactDate(text, today, monday);
  if (exact) return exact;
  let match: RegExpExecArray | null;
  if ((match = /^end of (?:the |this )?(week|month)$/.exec(text)) || (match = /^(eow|eom)$/.exec(text))) {
    const range = resolveDateValue(match[1].startsWith("w") || match[1] === "eow" ? "thisWeek" : "thisMonth", today)!;
    return { value: range.to };
  }
  if ((match = new RegExp(`^(?:in |within |over |during |for )?(?:the )?(?:next|coming|upcoming|following)(?: ${NUM})? ${UNIT}$`).exec(text))) {
    const count = toNumber(match[1]);
    if (!match[1] && match[2].startsWith("week")) return { value: "nextWeek" };
    if (!match[1] && match[2].startsWith("month")) return { value: "nextMonth" };
    return { value: `next:${unitDays(match[2], count)}` };
  }
  if ((match = new RegExp(`^(?:in |within |over |during |for )?(?:the )?(?:last|past|previous)(?: ${NUM})? ${UNIT}$`).exec(text))) {
    const count = toNumber(match[1]);
    return { value: `last:${unitDays(match[2], count)}` };
  }
  if ((match = new RegExp(`^(?:in |within |over |during |for )?(?:the )?past ${UNIT}$`).exec(text))) {
    return { value: `last:${unitDays(match[1], 1)}` };
  }
  if ((match = new RegExp(`^${NUM} ${UNIT} ago$`).exec(text))) return { value: `-${unitDays(match[2], toNumber(match[1]))}` };
  if ((match = new RegExp(`^${NUM} ${UNIT} from (?:now|today)$`).exec(text))) return { value: `+${unitDays(match[2], toNumber(match[1]))}` };
  if ((match = new RegExp(`^(?:with)?in ${NUM} ${UNIT}$`).exec(text))) return { value: `next:${unitDays(match[2], toNumber(match[1]))}` };
  if ((match = new RegExp(`^(?:(this|next|last|coming) )?(${WEEKDAY_ALT}|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)$`).exec(text))) {
    const index = WEEKDAYS.indexOf(match[2]) >= 0 ? WEEKDAYS.indexOf(match[2]) : WEEKDAY_SHORT[match[2]];
    const todayIndex = (Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${monday}T00:00:00Z`)) / 86_400_000) + 7) % 7;
    if (match[1] === "next") return { value: iso(monday, 7 + index) };
    if (match[1] === "last") return { value: iso(monday, index - 7) };
    if (match[1] === "this") return { value: iso(monday, index) };
    // A bare weekday is the next one, today included.
    return { value: iso(today, (index - todayIndex + 7) % 7) };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { value: text };
  if ((match = new RegExp(`^(${MONTH_ALT}) (\\d{1,2})(?:st|nd|rd|th)?$`).exec(text))) {
    return { value: dayOfMonth(today, monthIndex(match[1]), Number(match[2])) };
  }
  if ((match = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${MONTH_ALT})$`).exec(text))) {
    return { value: dayOfMonth(today, monthIndex(match[2]), Number(match[1])) };
  }
  if ((match = new RegExp(`^(early|mid|late|end of) (${MONTHS.join("|")})$`).exec(text))) {
    const month = MONTHS.indexOf(match[2]);
    const first = dayOfMonth(today, month, 1);
    const end = resolveDateValue("thisMonth", first)!.to;
    if (match[1] === "early") return { value: first, to: addDaysToDate(first, 9) };
    if (match[1] === "mid") return { value: addDaysToDate(first, 10), to: addDaysToDate(first, 19) };
    return { value: addDaysToDate(first, 20), to: end };
  }
  return null;
}

/** A whole month named on its own ("in october"). */
function monthSpec(word: string, today: string): DateSpec | null {
  const month = monthIndex(word);
  if (month < 0) return null;
  const first = dayOfMonth(today, month, 1);
  return { value: first, to: resolveDateValue("thisMonth", first)!.to };
}

// ---- Fields named in words ----

type DateField = "deadline" | "startDate" | "planned" | "createdAt" | "updatedAt" | "completedAt";

const DATE_FIELD_WORDS: [string, DateField][] = [
  ["due dates?|deadlines?|due|ending|ends|expiring|expires|expire", "deadline"],
  ["start dates?|starting|starts|started|start|begins|beginning|began|begin", "startDate"],
  ["scheduled|planned|booked|blocked out|time blocked|slotted|on (?:the |my )?calendar|happening|working on", "planned"],
  ["created|added|made|captured|logged|new", "createdAt"],
  ["updated|changed|edited|modified|touched|worked on", "updatedAt"],
  ["completed|complete|completing|done|got done|get done|finished|finish|closed|close|ticked off|checked off|marked done|wrapped up|did", "completedAt"],
];

const SORT_WORDS: [string, TaskViewSortBy, TaskListSortDirection][] = [
  ["deadlines?|due dates?|due|date due|dates?|when (?:it is|its|they are|theyre) due", "deadline", "asc"],
  ["names?|titles?|alphabet|alphabetical order|letters?", "name", "asc"],
  ["date created|creation date|created date|created|creation|date added|added|age", "createdAt", "desc"],
  ["last updated|date updated|updated|last changed|changed|activity|recent activity|last activity|modified|last modified", "updatedAt", "desc"],
  ["date completed|completion date|completed|finished|done date", "completedAt", "desc"],
  ["start dates?|start|starting date", "startDate", "asc"],
  ["planned days?|planned|schedule|scheduled time|scheduled|calendar time|calendar", "scheduledOn", "asc"],
  ["priority|priorities|importance", "priority", "desc"],
  ["urgency", "urgency", "desc"],
  ["estimates?|durations?|length|size|time estimate|how long", "duration", "asc"],
  ["time tracked|tracked time|tracked|time spent|logged time", "tracked", "desc"],
  ["progress|checklist progress|completion", "progress", "desc"],
  ["status|statuses|state", "status", "asc"],
  ["projects?", "project", "asc"],
  ["workspaces?|spaces?", "workspace", "asc"],
  ["stages?|columns?", "stage", "asc"],
  ["effort|effort kind|type of work|kind of work", "effort", "asc"],
];

const GROUP_WORDS: [string, TaskListGroupField][] = [
  ["projects?", "project"],
  ["workspaces?|spaces?|areas?", "workspace"],
  ["status|statuses|state|states", "status"],
  ["stages?|columns?|phases?", "stage"],
  ["priority|priorities|importance", "priority"],
  ["labels?|tags?", "label"],
  ["effort|effort kind|type of work|kind of work|work type", "effort"],
  ["deadlines?|due dates?|due|due week|when (?:it is|its|they are|theyre) due", "deadline"],
  ["days?|planned days?|schedule|calendar|when", "planned"],
  ["start dates?|start", "startDate"],
  ["date created|created|creation date|date added|added", "createdAt"],
  ["date completed|completed|completion date|finished", "completedAt"],
  ["last updated|updated|activity", "updatedAt"],
  ["done|done or not|open or done|completion|finished or not", "done"],
  ["repeating|recurring|recurrence|repeat", "recurring"],
];

/** Group fields "by X" means without a group verb; the rest of "by X" sorts. */
const GROUP_BY_DEFAULT = new Set<TaskListGroupField>(["project", "workspace", "status", "stage", "label", "effort", "done", "recurring"]);

const DIRECTION = "(asc|ascending|desc|descending|newest first|oldest first|latest first|earliest first|soonest first|highest first|lowest first|biggest first|smallest first|longest first|shortest first|most recent first|reversed?|a-z|a to z|z-a|z to a)";

function directionOf(word: string | undefined, by: TaskViewSortBy, fallback: TaskListSortDirection): TaskListSortDirection {
  if (!word) return fallback;
  if (/^(asc|ascending|oldest first|earliest first|soonest first|lowest first|smallest first|shortest first|a-z|a to z)$/.test(word)) {
    return by === "priority" && word === "lowest first" ? "asc" : "asc";
  }
  if (/^(reversed?)$/.test(word)) return fallback === "asc" ? "desc" : "asc";
  return "desc";
}

const PRIORITY_WORDS: Record<string, string> = {
  urgent: "Urgent", critical: "Urgent", asap: "Urgent", "top priority": "Urgent", highest: "Urgent", blocker: "Urgent", p0: "Urgent", p1: "High",
  high: "High", p2: "Medium", medium: "Medium", normal: "Medium", mid: "Medium", moderate: "Medium", low: "Low", lowest: "Low", minor: "Low", p3: "Low",
};
const P = "(top priority|urgent|critical|asap|highest|high|medium|normal|mid|moderate|lowest|low|minor|p0|p1|p2|p3)";
const PRIO = "(?:priority|priorities|prio|pri)";

const MIN_UNIT = "(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)";
const MIN_NUM = "(\\d+(?:\\.\\d+)?|half an|half|an|a|one|two|three|four|five|six|seven|eight|ten|fifteen|twenty|thirty)";

function minutesOf(count: string, unit: string | undefined): number {
  const value = count.startsWith("half") ? 0.5 : toNumber(count, 1);
  const hours = unit ? /^h/.test(unit) : value <= 12;
  return Math.round(hours ? value * 60 : value);
}

// ---- The person's names ----

type EntityKind = "project" | "workspace" | "label" | "stage" | "status" | "option" | "field";

interface Entity {
  kind: EntityKind;
  key: string;
  name: string;
  ids: string[];
  /** The rule field it filters ("cf:…" for a custom field option or field). */
  field: TaskRuleField;
  custom?: CustomField;
}

const ENTITY_ORDER: EntityKind[] = ["project", "label", "stage", "status", "workspace", "option", "field"];

const CONTEXT_WORDS: Record<string, EntityKind> = {
  project: "project", projects: "project",
  workspace: "workspace", workspaces: "workspace", space: "workspace", area: "workspace",
  label: "label", labels: "label", labelled: "label", labeled: "label", tag: "label", tags: "label", tagged: "label",
  stage: "stage", stages: "stage", column: "stage", phase: "stage",
  status: "status", state: "status", marked: "status", "marked as": "status",
};
const CONTEXT_ALT = "marked as|projects?|workspaces?|space|area|labels?|labell?ed|tags?|tagged|stages?|column|phase|status|state|marked";

function buildEntities(vocab: ViewVocabulary): Entity[] {
  const byKey = new Map<string, Entity>();
  const add = (kind: EntityKind, field: TaskRuleField, item: { id: string; name: string }, custom?: CustomField) => {
    const key = normalizeWords(item.name).replace(/ , /g, " ").trim();
    if (!key) return;
    const id = `${kind}:${field}:${key}`;
    const existing = byKey.get(id);
    if (existing) {
      if (!existing.ids.includes(item.id)) existing.ids.push(item.id);
      return;
    }
    byKey.set(id, { kind, key, name: item.name.trim(), ids: [item.id], field, custom });
  };
  for (const item of vocab.projects ?? []) add("project", "project", item);
  for (const item of vocab.workspaces ?? []) add("workspace", "workspace", item);
  for (const item of vocab.labels ?? []) add("label", "label", item);
  for (const item of vocab.stages ?? []) add("stage", "stage", item);
  for (const item of vocab.statuses ?? []) add("status", "status", item);
  for (const field of vocab.customFields ?? []) {
    add("field", `cf:${field.id}`, { id: field.id, name: field.name }, field);
    if (field.type === "select" || field.type === "multi_select") {
      for (const option of field.options?.options ?? []) add("option", `cf:${field.id}`, { id: option.id, name: option.value }, field);
    }
  }
  return [...byKey.values()];
}

/** Words the reader gives its own meaning; a name made of one needs "project …" or "#…". */
const RESERVED = new Set([
  "today", "tomorrow", "yesterday", "week", "month", "year", "soon", "overdue", "late", "done", "completed", "complete",
  "finished", "closed", "open", "pending", "active", "todo", "to do", "urgent", "high", "medium", "low", "critical", "important",
  "board", "kanban", "timeline", "gantt", "list", "table", "deadline", "deadlines", "due", "scheduled", "planned", "blocked",
  "repeating", "recurring", "quick", "big", "small", "deep", "admin", "creative", "routine", "focus", "locked", "new", "old",
  "recent", "tasks", "task", "work", "projects", "project", "reminders", "reminder", "all", "everything", "next", "last", "top",
  "first", "stale", "remaining", "started", "starting", "start", "created", "updated", "status", "label", "tag", "stage",
  "priority", "inbox", "later", "waiting", "stuck", "ready", "notes", "description", "checklist", "estimate",
  ...WEEKDAYS, ...MONTHS,
]);

// ---- The reader ----

interface Pending {
  spec: DateSpec;
  op: TaskRuleOp;
  /** Second date of a "between". */
  to?: DateSpec;
}

class Reader {
  rest: string;
  readonly today: string;
  readonly vocab: ViewVocabulary;
  readonly entities: Entity[];
  rules: TaskViewRule[] = [];
  sort?: { by: TaskViewSortBy; dir: TaskListSortDirection };
  thenSort?: { by: TaskViewSortBy; dir: TaskListSortDirection };
  groups: TaskListGroupField[] = [];
  render?: TaskViewConfig["renderMode"];
  dataMode?: TaskViewConfig["dataMode"];
  reminders = false;
  showCompleted?: boolean;
  onlyDated = false;
  limit?: number;
  name?: string;
  createView = false;
  listing = false;
  understood = 0;
  entityParts = 0;
  dates: Pending[] = [];
  leftover: string[] = [];

  constructor(text: string, vocab: ViewVocabulary, today: string) {
    this.today = today;
    this.vocab = vocab;
    this.entities = buildEntities(vocab);
    this.rest = ` ${text} `;
  }

  /** Runs a pattern over what is left; each match the callback accepts is cut out. */
  take(pattern: RegExp, apply: (match: string[]) => string | false | void): void {
    this.rest = this.rest.replace(pattern, (...args: unknown[]) => {
      const match = args.slice(0, -2).map((part) => (typeof part === "string" ? part : "")) as string[];
      const out = apply(match);
      if (out === false) return match[0];
      return out ?? " | ";
    });
    this.rest = this.rest.replace(/\s+/g, " ");
    if (!this.rest.startsWith(" ")) this.rest = ` ${this.rest}`;
    if (!this.rest.endsWith(" ")) this.rest = `${this.rest} `;
  }

  /** Adds a rule and marks its place, so "A or B" can join them later. */
  rule(rule: TaskViewRule, entity = false): string {
    this.rules.push(rule);
    this.understood += 1;
    if (entity) this.entityParts += 1;
    return ` |r${this.rules.length - 1}| `;
  }

  part(): string {
    this.understood += 1;
    return " | ";
  }

  setSort(by: TaskViewSortBy, dir: TaskListSortDirection) {
    if (!this.sort) this.sort = { by, dir };
    else if (!this.thenSort && this.sort.by !== by) this.thenSort = { by, dir };
  }

  entity(key: string, kinds: readonly EntityKind[] = ENTITY_ORDER): Entity | undefined {
    const wanted = [key, stripPlural(key)];
    for (const kind of kinds) {
      for (const word of wanted) {
        const found = this.entities.find((item) => item.kind === kind && (item.key === word || stripPlural(item.key) === word));
        if (found) return found;
      }
    }
    return undefined;
  }

  namesSource(filter: (entity: Entity) => boolean = () => true): string {
    const keys = [...new Set(this.entities.filter(filter).map((item) => item.key))].sort((a, b) => b.length - a.length);
    return keys.map((key) => `${escapeRegex(key)}(?:s|es)?`).join("|");
  }

  /** The condition an entity stands for. */
  entityRule(entity: Entity, exclude: boolean): TaskViewCondition {
    if (entity.kind === "field") {
      const custom = entity.custom!;
      if (custom.type === "boolean") return { field: entity.field, op: "is", value: !exclude };
      return { field: entity.field, op: exclude ? "isEmpty" : "isNotEmpty" };
    }
    return { field: entity.field, op: exclude ? "noneOf" : "anyOf", value: [...entity.ids] };
  }
}

/**
 * Reads plain words as a view. `today` (`YYYY-MM-DD`, in the Working hours
 * timezone) anchors "this week" and weekday names; it defaults to the device date.
 */
export function readViewQuery(input: string, vocab: ViewVocabulary = {}, options: { today?: string } = {}): ViewReading {
  const today = options.today ?? todayInZone();
  // Quoted text is taken as typed: a view's name after "called", else words to find.
  const quoted: string[] = [];
  let raw = input.replace(/["“”]([^"“”]+)["“”]/g, (_, text: string) => {
    quoted.push(text.trim());
    return ` "q${quoted.length - 1}" `;
  });
  raw = raw.replace(/\s+/g, " ").trim();
  const reader = new Reader(normalizeWords(raw).replace(/" ?q(\d+) ?"/g, " qq$1 "), vocab, today);

  readIntent(reader, quoted);
  readEntities(reader);
  readLayout(reader);
  readGroupsAndSorts(reader);
  readStates(reader);
  readDates(reader);
  readSizes(reader);
  readFlags(reader);
  readPriority(reader);
  readBareEntities(reader);
  readText(reader, quoted);
  readLeftover(reader);
  joinAlternatives(reader);

  return finish(reader);
}

function readIntent(r: Reader, quoted: string[]) {
  r.take(
    /^ (?:(?:hey|ok|okay|please|pls|can you|could you|would you|i want to|i want|i need|id like to|lets|let me)(?: please)? )*(?:create|make|add|build|set up|setup|save|new|start)(?: me)?(?: a| an)?(?: new)?(?: saved)?(?: task)? (?:view|filter|tab|saved view|smart list|list|board|timeline)(?: (?:for|of|with|showing|that shows|to show|which shows|where|:))?(?= )/g,
    (match) => {
      r.createView = true;
      r.listing = true;
      // "make a board …" asks for the layout too.
      if (/ board(?: |$)/.test(match[0])) r.render = "kanban";
      if (/ timeline(?: |$)/.test(match[0])) r.render = "gantt";
    },
  );
  if (!r.createView) {
    r.take(W("(?:save|keep)(?: (?:this|it|that))? as (?:a |an )?(?:new )?(?:saved )?view"), () => {
      r.createView = true;
    });
  }
  // "… called Bugs", "named \"Week plan\"": the view's name.
  r.take(W("(?:called|named|titled|name it|call it)(?: the view)? (qq\\d+|[^|:]+?)(?= :| for | with | that | showing | of | which | where | \\| | $)"), (match) => {
    if (!r.createView) return false;
    const quote = /^qq(\d+)$/.exec(match[1].trim());
    r.name = quote ? quoted[Number(quote[1])] : match[1].trim().replace(/^\w/, (char) => char.toUpperCase());
  });
  r.take(/ : /g, () => " | ");
  r.take(W("(?:show|list|find|display|view|see|get|give|pull up|bring up|filter|search|look up|look for|tell)(?: me)?(?: all)?(?: of)?(?: the| my| our)?"), () => {
    r.listing = true;
  });
  r.take(W("(?:what|which|whats|where)(?: are| is| do| should| can)?(?: i| we)?(?: have| got| need| working on)?"), () => {
    r.listing = true;
  });
}

function readEntities(r: Reader) {
  if (r.entities.length === 0) return;
  const names = r.namesSource();
  // Excluded: "not in Home", "without label bug", "except project Timely".
  r.take(
    W(`(?:not in|not on|not from|not|without|except|excluding|exclude|other than|outside of|outside|minus|but not|no|skip)(?: the| any)?(?: (${CONTEXT_ALT}))?(?: is| =)? (${names})(?: (${CONTEXT_ALT}))?`),
    (match) => {
      const kind = CONTEXT_WORDS[match[1] || match[3]];
      const entity = r.entity(match[2], kind ? [kind] : ENTITY_ORDER);
      if (!entity) return false;
      if (!kind && entity.key.split(" ").length === 1 && RESERVED.has(entity.key)) return false;
      return r.rule(r.entityRule(entity, true), true);
    },
  );
  // "project Timely", "in the Home workspace", "tagged bug", "status In review", "#bug".
  r.take(
    W(`(?:(?:in|for|from|under|of|within|inside|on|at|with) )?(?:the |a |my )?(${CONTEXT_ALT})(?: is| =| named| called| of)? (${names})`),
    (match) => {
      const entity = r.entity(match[2], [CONTEXT_WORDS[match[1]]]);
      if (!entity) return false;
      return r.rule(r.entityRule(entity, false), true);
    },
  );
  r.take(
    W(`(?:(?:in|for|from|under|of|within|inside|on|at|with) )?(?:the |a |my )?(${names}) (${CONTEXT_ALT})`),
    (match) => {
      const entity = r.entity(match[1], [CONTEXT_WORDS[match[2]]]);
      if (!entity) return false;
      return r.rule(r.entityRule(entity, false), true);
    },
  );
  r.take(W(`#(${names})`), (match) => {
    const entity = r.entity(match[1], ["label"]);
    if (!entity) return false;
    return r.rule(r.entityRule(entity, false), true);
  });
  // Custom fields: "type is bug", "effort points over 3", "with estimate link".
  for (const entity of r.entities.filter((item) => item.kind === "field")) {
    const field = entity.custom!;
    const key = escapeRegex(entity.key);
    if (field.type === "select" || field.type === "multi_select") {
      const options = r.namesSource((item) => item.kind === "option" && item.field === entity.field);
      if (options) {
        r.take(W(`(?:${key})(?: is| =| of| :)? (${options})|(${options}) (?:${key})`), (match) => {
          const option = r.entities.find((item) => item.kind === "option" && item.field === entity.field && (item.key === (match[1] || match[2]) || stripPlural(item.key) === stripPlural(match[1] || match[2])));
          if (!option) return false;
          return r.rule(r.entityRule(option, false), true);
        });
      }
    }
    if (field.type === "number") {
      r.take(W(`(?:${key}) (?:is )?(over|above|more than|greater than|at least|under|below|less than|at most|>=|<=|>|<|=|is|of) (-?\\d+(?:\\.\\d+)?)`), (match) => {
        const op: TaskRuleOp = /^(over|above|more than|greater than|>)$/.test(match[1]) ? "gt" : /^(at least|>=)$/.test(match[1]) ? "gte" : /^(under|below|less than|<)$/.test(match[1]) ? "lt" : /^(at most|<=)$/.test(match[1]) ? "lte" : "eq";
        return r.rule({ field: entity.field, op, value: Number(match[2]) });
      });
    }
    if (field.type === "text" || field.type === "url") {
      r.take(W(`(?:${key}) (?:contains|has|includes|is|=|:|with) ([^ |]+)`), (match) => r.rule({ field: entity.field, op: "contains", value: match[1] }));
    }
    r.take(W(`(?:no|without|missing|empty|not)(?: an?| the)? (?:${key})`), () => r.rule(r.entityRule(entity, true)));
    r.take(W(`(?:with|has|have|having|set)(?: an?| the)? (?:${key})`), () => r.rule(r.entityRule(entity, false)));
  }
}

function readLayout(r: Reader) {
  r.take(W("(?:(?:as|in|on|into|like) )?(?:a |an |the )?(?:kanban board|kanban|board)(?: view| layout)?"), () => {
    r.render = "kanban";
    return r.part();
  });
  r.take(W("(?:(?:as|in|on|into|like) )?(?:a |an |the )?(?:timeline|gantt chart|gantt|roadmap)(?: view| layout)?"), () => {
    r.render = "gantt";
    return r.part();
  });
  r.take(W("(?:as|in|into) (?:a |an |the )?(?:list|table|plain list)(?: view| layout)?"), () => {
    r.render = "list";
    return r.part();
  });
  r.take(W("(?:my |all |the |all my |our )?(?:reminders?|pings?|alerts?)"), () => {
    r.reminders = true;
    r.listing = true;
    return r.part();
  });
  r.take(W("(?:my |all |the |all my |our )?projects"), () => {
    r.dataMode = "project";
    r.listing = true;
    return r.part();
  });
  r.take(W(`(?:top|first|next|only|just|the) (\\d{1,3}|${Object.keys(NUMBER_WORDS).filter((word) => !/^(a|an|one|couple|couple of|a few|few|several)$/.test(word)).join("|")})(?! (?:days?|weeks?|months?|years?|hours?|hrs?|h|mins?|minutes?|m|%))`), (match) => {
    r.limit = toNumber(match[1], 10);
    return r.part();
  });
  r.take(W(`(\\d{1,3}) (?=most |tasks? |items? |things |todos? |deadlines |ones )`), (match) => {
    r.limit = Number(match[1]);
    return r.part();
  });
}

function sortFor(word: string): [TaskViewSortBy, TaskListSortDirection] | undefined {
  for (const [source, by, dir] of SORT_WORDS) if (new RegExp(`^(?:${source})$`).test(word)) return [by, dir];
  const custom = /^cf:(.+)$/.exec(word);
  if (custom) return [`cf:${custom[1]}`, "asc"];
  return undefined;
}

function groupFor(word: string): TaskListGroupField | undefined {
  for (const [source, field] of GROUP_WORDS) if (new RegExp(`^(?:${source})$`).test(word)) return field;
  const custom = /^cf:(.+)$/.exec(word);
  if (custom) return `cf:${custom[1]}`;
  return undefined;
}

function readGroupsAndSorts(r: Reader) {
  // Custom field names stand in as "cf:<id>" for sorting and grouping.
  const fields = (r.vocab.customFields ?? []).map((field) => ({ key: normalizeWords(field.name), id: field.id })).filter((item) => item.key);
  const customAlt = fields.map((item) => escapeRegex(item.key)).join("|");
  const custom = (word: string) => fields.find((item) => item.key === word);
  const S = `(${SORT_WORDS.map(([source]) => source).join("|")}${customAlt ? `|${customAlt}` : ""})`;
  const G = `(${GROUP_WORDS.map(([source]) => source).join("|")}${customAlt ? `|${customAlt}` : ""})`;
  const sortKey = (word: string) => {
    const field = custom(word);
    return sortFor(field ? `cf:${field.id}` : word);
  };
  const groupKey = (word: string) => {
    const field = custom(word);
    return groupFor(field ? `cf:${field.id}` : word);
  };
  const addGroup = (word: string | undefined) => {
    if (!word) return;
    const field = groupKey(word);
    if (field && !r.groups.includes(field) && r.groups.length < 3) r.groups.push(field);
  };

  // "sorted by deadline then priority", "order by created newest first".
  r.take(
    W(`(?:sort|sorted|sorting|order|ordered|ordering|arrange|arranged|rank|ranked|listed)(?: them| it| everything| all)? (?:by|on) (?:the |their |its )?${S}(?: ${DIRECTION})?(?:(?: ,)? (?:then|and then|and|after that) (?:by )?(?:the )?${S}(?: ${DIRECTION})?)?`),
    (match) => {
      const first = sortKey(match[1]);
      if (!first) return false;
      r.setSort(first[0], directionOf(match[2], first[0], first[1]));
      const second = match[3] ? sortKey(match[3]) : undefined;
      if (second) r.thenSort = { by: second[0], dir: directionOf(match[4], second[0], second[1]) };
      return r.part();
    },
  );
  // "grouped by project and status", "per label", "split into stages".
  r.take(
    W(`(?:group|grouped|grouping|split|splitted|organi[sz]ed|organi[sz]e|bucket|bucketed|broken down|break(?: it| them)? down|segmented|segment|clustered|arranged|sorted into|separated|organised) (?:by|into|per|on|in) (?:the |their )?${G}(?:(?: ,)? (?:and|then|plus|,) (?:by )?${G})?(?:(?: ,)? (?:and|then|plus|,) (?:by )?${G})?`),
    (match) => {
      addGroup(match[1]);
      addGroup(match[2]);
      addGroup(match[3]);
      return r.part();
    },
  );
  r.take(W(`(?:per|for each|each|in groups of) ${G}`), (match) => {
    addGroup(match[1]);
    return r.part();
  });
  r.take(W(`then by ${S}(?: ${DIRECTION})?`), (match) => {
    const key = sortKey(match[1]);
    if (!key) return false;
    if (!r.sort) r.sort = { by: key[0], dir: directionOf(match[2], key[0], key[1]) };
    else r.thenSort = { by: key[0], dir: directionOf(match[2], key[0], key[1]) };
    return r.part();
  });
  // "by project" groups; "by deadline" sorts.
  r.take(W(`by (?:the |their |its )?${S}(?: ${DIRECTION})?`), (match) => {
    const group = groupKey(match[1]);
    if (group && GROUP_BY_DEFAULT.has(group) && !match[2]) {
      addGroup(match[1]);
      return r.part();
    }
    const key = sortKey(match[1]);
    if (!key) return false;
    r.setSort(key[0], directionOf(match[2], key[0], key[1]));
    return r.part();
  });

  const sorts: [string, TaskViewSortBy, TaskListSortDirection][] = [
    ["(?:soonest|earliest|closest|nearest)(?: deadlines?| due)?(?: first)?|due soonest(?: first)?|most pressing(?: first)?", "deadline", "asc"],
    ["(?:latest|furthest|farthest)(?: deadlines?| due)? first|due last first", "deadline", "desc"],
    ["(?:newest|most recent|latest|recently added|recently created|just added)(?: first)?|new to old", "createdAt", "desc"],
    ["(?:oldest)(?: first)?|old to new|longest waiting(?: first)?", "createdAt", "asc"],
    ["(?:recently|most recently|last) (?:updated|changed|edited|touched|modified|active)(?: first)?", "updatedAt", "desc"],
    ["(?:least recently|longest since) (?:updated|changed|edited|touched)(?: first)?", "updatedAt", "asc"],
    ["(?:recently|most recently|last) (?:completed|done|finished|closed)(?: first)?", "completedAt", "desc"],
    ["(?:highest|top|most important|most urgent|high) (?:priority )?(?:first|on top)|by importance|most important|highest priority", "priority", "desc"],
    ["(?:lowest|least important|low) (?:priority )?first|least important", "priority", "asc"],
    ["alphabetical(?:ly)?(?: order)?|a-z|a to z|in alphabetical order", "name", "asc"],
    ["reverse alphabetical(?:ly)?|z-a|z to a", "name", "desc"],
    ["(?:the )?(?:longest|biggest|largest|heaviest)(?: ones| tasks)?(?: first)?", "duration", "desc"],
    ["(?:the )?(?:shortest|quickest|smallest|easiest)(?: ones| tasks)? first", "duration", "asc"],
    ["(?:most progress|closest to done|nearly done first|most done)(?: first)?", "progress", "desc"],
    ["(?:most|highest) urgency(?: first)?", "urgency", "desc"],
    ["(?:most time|most tracked|most hours)(?: tracked| spent| logged)?(?: first)?", "tracked", "desc"],
  ];
  for (const [source, by, dir] of sorts) {
    r.take(W(source), () => {
      if (!r.sort) r.sort = { by, dir };
      else if (!r.thenSort && r.sort.by !== by) r.thenSort = { by, dir };
      return r.part();
    });
  }
  r.take(W("(?:in )?(ascending|descending|reverse)(?: order)?"), (match) => {
    if (!r.sort) r.sort = { by: "deadline", dir: "asc" };
    r.sort.dir = match[1] === "ascending" ? "asc" : match[1] === "descending" ? "desc" : r.sort.dir === "asc" ? "desc" : "asc";
    return r.part();
  });
}

function readStates(r: Reader) {
  // Everything, done included.
  r.take(
    W("(?:all (?:tasks?|work|items|todos?)|everything|any state|done or not|open or done|open and done|done and open|open and closed|(?:including|incl|with|plus) (?:the )?(?:done|completed|finished|closed)(?: ones| tasks| work)?|(?:done|completed|finished)(?: ones| tasks)? (?:too|as well|included))"),
    () => {
      r.showCompleted = true;
      r.listing = true;
      return r.part();
    },
  );
  // "not updated in 30 days", "untouched for 2 weeks", "stale".
  r.take(
    W(`(?:(?:not|havent been|hasnt been|haven't been|not been|no one has|nobody) (?:updated|changed|touched|edited|modified|worked on)|untouched|neglected|forgotten|abandoned|stale|idle|dormant|gathering dust)(?: (?:in|for|since|over) (?:the )?(?:last |past )?${NUM} ${UNIT})?`),
    (match) => {
      const days = match[2] ? unitDays(match[2], toNumber(match[1])) : 14;
      return r.rule({ field: "updatedAt", op: "before", value: `-${days}` });
    },
  );
  r.take(W(`(?:older than|more than|over) ${NUM} ${UNIT}(?: old)?|(?:created|added) (?:more than|over) ${NUM} ${UNIT} ago`), (match) => {
    const count = match[1] || match[3];
    const unit = match[2] || match[4];
    return r.rule({ field: "createdAt", op: "before", value: `-${unitDays(unit, toNumber(count))}` });
  });
  r.take(W(`(?:younger than|less than|under) ${NUM} ${UNIT} old`), (match) => r.rule({ field: "createdAt", op: "onOrAfter", value: `-${unitDays(match[2], toNumber(match[1]))}` }));
}

function readDates(r: Reader) {
  const fieldAlt = DATE_FIELD_WORDS.map(([source]) => source).join("|");
  const dateFields = (r.vocab.customFields ?? []).filter((field) => field.type === "date");
  const customAlt = dateFields.map((field) => escapeRegex(normalizeWords(field.name))).filter(Boolean).join("|");
  const fieldOf = (word: string): TaskRuleField | undefined => {
    for (const [source, field] of DATE_FIELD_WORDS) if (new RegExp(`^(?:${source})$`).test(word)) return field;
    const custom = dateFields.find((field) => normalizeWords(field.name) === word);
    return custom ? `cf:${custom.id}` : undefined;
  };
  const F = `(${fieldAlt}${customAlt ? `|${customAlt}` : ""})`;
  const D = `(${DATE_SRC})`;
  const pending = (spec: DateSpec, op: TaskRuleOp, to?: DateSpec) => {
    r.dates.push({ spec, op, to });
    return ` @d${r.dates.length - 1} `;
  };
  const spec = (text: string) => dateSpec(text, r.today);

  // "between monday and friday", "from oct 1 to oct 5".
  r.take(W(`(?:between|from) ${D} (?:and|to|until|till|through|thru|-) ${D}`), (match) => {
    const from = spec(match[1]);
    const to = spec(match[2]);
    if (!from || !to) return false;
    return pending(from, "between", to);
  });
  r.take(W(`(?:before|earlier than|prior to|ahead of) ${D}`), (match) => {
    const value = spec(match[1]);
    return value ? pending(value, "before") : false;
  });
  r.take(W(`(?:by|until|till|no later than|on or before|up to|at the latest by|latest by) ${D}`), (match) => {
    const value = spec(match[1]);
    return value ? pending(value, "onOrBefore") : false;
  });
  r.take(W(`(?:after|later than) ${D}`), (match) => {
    const value = spec(match[1]);
    return value ? pending(value, "after") : false;
  });
  r.take(W(`(?:since|from|on or after|as of|starting from) ${D}`), (match) => {
    const value = spec(match[1]);
    return value ? pending(value, "onOrAfter") : false;
  });
  r.take(W(`(?:(?:on|for|in|during|at|this) )?${D}`), (match) => {
    const value = spec(match[1]);
    return value ? pending(value, "in") : false;
  });
  // A month on its own needs a word before it ("may" is also a verb).
  r.take(W(`(in|during|for|by|before|after|until|since|of|throughout) (${MONTHS.join("|")}|sept|jan|feb|apr|jun|jul|aug|sep|oct|nov|dec)`), (match) => {
    const value = monthSpec(match[2], r.today);
    if (!value) return false;
    const op: TaskRuleOp = match[1] === "before" ? "before" : match[1] === "after" ? "after" : match[1] === "by" || match[1] === "until" ? "onOrBefore" : match[1] === "since" ? "onOrAfter" : "between";
    return op === "between" ? pending({ value: value.value }, "between", { value: value.to! }) : pending(op === "before" || op === "onOrAfter" ? { value: value.value } : { value: value.to! }, op);
  });

  const bind = (field: TaskRuleField, index: number, negate = false) => {
    const date = r.dates[index];
    if (!date) return false;
    const rule = dateRule(field, date);
    if (negate && rule.op === "in") rule.op = "notIn";
    if (field === "completedAt") r.showCompleted = true;
    return r.rule(rule);
  };
  // "due this week", "created last month", "deadline before friday", "completed today".
  r.take(W(`(?:is |was |are |were |being |get |gets |got |been )?${F}(?: date| dates| on| in| for| at| is| was| are)? @d(\\d+)`), (match) => {
    const field = fieldOf(match[1]);
    return field ? bind(field, Number(match[2])) : false;
  });
  r.take(W(`(?:not|isnt|arent|wasnt) ${F}(?: on| in| for)? @d(\\d+)`), (match) => {
    const field = fieldOf(match[1]);
    return field ? bind(field, Number(match[2]), true) : false;
  });
  // "this week's deadlines", "today's completed".
  r.take(W(`@d(\\d+)(?: (?:that are|that were|that is))? ${F}`), (match) => {
    const field = fieldOf(match[2]);
    return field ? bind(field, Number(match[1])) : false;
  });
  // A date with no field: due or planned on that day, or due before or after it.
  r.take(W("@d(\\d+)"), (match) => {
    const date = r.dates[Number(match[1])];
    if (!date) return false;
    if (date.op === "in" || date.op === "between") {
      return r.rule({ match: "any", rules: [dateRule("deadline", date), dateRule("planned", date)] });
    }
    return r.rule(dateRule("deadline", date));
  });
}

function dateRule(field: TaskRuleField, date: Pending): TaskViewCondition {
  if (date.op === "between") return { field, op: "between", value: date.spec.value, to: date.to?.to ?? date.to?.value ?? date.spec.value };
  if (date.spec.to) {
    // A span ("next weekend", "early october").
    if (date.op === "in") return { field, op: "between", value: date.spec.value, to: date.spec.to };
    if (date.op === "onOrBefore" || date.op === "after") return { field, op: date.op, value: date.spec.to };
    return { field, op: date.op, value: date.spec.value };
  }
  return { field, op: date.op, value: date.spec.value };
}

function readSizes(r: Reader) {
  const target = (word: string | undefined): TaskRuleField => (word && /tracked|logged|spent/.test(word) ? "tracked" : "duration");
  const TRACK = "(?:(time tracked|tracked|logged|spent|time spent|time logged|took|taking) )?";
  r.take(W(`${TRACK}between ${MIN_NUM} ?${MIN_UNIT}? and ${MIN_NUM} ?${MIN_UNIT}`), (match) => {
    const unit = match[3] || match[5];
    return r.rule({ field: target(match[1]), op: "between", value: minutesOf(match[2], unit), to: minutesOf(match[4], match[5]) });
  });
  r.take(W(`${TRACK}(longer than|more than|over|above|greater than|bigger than|at least|>=|>|exceeding) ${MIN_NUM} ?${MIN_UNIT}(?: (?:long|of tracked time|tracked|logged|spent|of work|estimated))?`), (match) => {
    const op: TaskRuleOp = match[2] === "at least" || match[2] === ">=" ? "gte" : "gt";
    return r.rule({ field: target(match[1]), op, value: minutesOf(match[3], match[4]) });
  });
  r.take(W(`${TRACK}(shorter than|less than|under|below|smaller than|at most|no more than|up to|<=|<) ${MIN_NUM} ?${MIN_UNIT}(?: (?:long|tracked|logged|spent|of work|estimated))?`), (match) => {
    const op: TaskRuleOp = /^(at most|no more than|up to|<=)$/.test(match[2]) ? "lte" : "lt";
    return r.rule({ field: target(match[1]), op, value: minutesOf(match[3], match[4]) });
  });
  r.take(W(`${MIN_NUM}[ -]?${MIN_UNIT}(?: long| or less| or under| max)?(?= (?:tasks?|ones|things|items|jobs|work|todos?|chunks?|blocks?|or less|\\|))`), (match) => r.rule({ field: "duration", op: "lte", value: minutesOf(match[1], match[2]) }));
  r.take(W("(?:quick wins?|quick|quickest|small|short|easy|easiest|tiny|little|low effort|bite[- ]sized|simple|fast)(?: wins?| tasks?| ones| things| jobs| items| stuff)?"), () => r.rule({ field: "duration", op: "lte", value: 30 }));
  r.take(W("(?:big|bigger|large|long|huge|heavy|major|high effort|lengthy|chunky|meaty)(?: tasks?| ones| things| jobs| items| pieces of work| projects)?"), () => r.rule({ field: "duration", op: "gte", value: 120 }));
  r.take(W("(?:no|without(?: an?)?|missing(?: an?)?|lacking(?: an?)?) (?:time )?(?:estimates?|durations?)|unestimated|not estimated|no estimated time"), () => r.rule({ field: "duration", op: "isEmpty" }));
  r.take(W("(?:with|has|have|having)(?: an?)? (?:time )?(?:estimates?|durations?)|estimated"), () => r.rule({ field: "duration", op: "isNotEmpty" }));
  r.take(W("(?:no time (?:tracked|logged)|nothing (?:tracked|logged)|untracked|not tracked|never tracked|no tracked time)"), () => r.rule({ field: "tracked", op: "isEmpty" }));
  r.take(W("(?:with |has |have )?(?:time tracked|tracked time|time logged|logged time|tracked)"), () => r.rule({ field: "tracked", op: "isNotEmpty" }));
  r.take(W("(more than|over|above|at least|less than|under|below|at most) (\\d{1,3})%(?: (?:done|complete|completed|finished|through))?"), (match) => {
    const op: TaskRuleOp = /^(more than|over|above)$/.test(match[1]) ? "gt" : match[1] === "at least" ? "gte" : match[1] === "at most" ? "lte" : "lt";
    return r.rule({ field: "progress", op, value: Number(match[2]) });
  });
  r.take(W("(?:almost|nearly|mostly|close to) (?:done|finished|complete|there)"), () => {
    r.rule({ field: "done", op: "is", value: false });
    return r.rule({ field: "progress", op: "gte", value: 75 });
  });
}

function readFlags(r: Reader) {
  const flag = (source: string, field: TaskRuleField, value: boolean) =>
    r.take(W(source), () => r.rule({ field, op: "is", value }));
  // Negatives first, so "not overdue" is not read as "overdue".
  flag("not overdue|not late|on time|on track", "overdue", false);
  flag("overdue|late|past due|past (?:their |its |the )?deadlines?|missed(?: deadlines?)?|behind(?: schedule)?|slipped|slipping", "overdue", true);
  flag("one[- ]?offs?|one[- ]?time|non[- ]?recurring|not recurring|not repeating|single", "recurring", false);
  flag("recurring|repeating|repeats|repeat|habits?|regular|every (?:day|week|month)|daily|weekly|monthly", "recurring", true);
  flag("not blocked|unblocked|ready to start|ready to go|ready|actionable|can start|can be started|startable|free to start", "blocked", false);
  flag("blocked|waiting on (?:something|others|someone)|waiting for (?:something|others|someone)|waiting|stuck|on hold|held up|dependent", "blocked", true);
  flag("blocking(?: others| other tasks| other work| anything)?|blockers|that block others|holding (?:others|things) up", "blocking", true);
  flag("(?:unscheduled|not scheduled|unplanned|not planned|not on (?:the |my )?calendar|off (?:the |my )?calendar|needs? (?:a )?(?:slot|time)|need scheduling|no time (?:blocked|booked|reserved)|without (?:a )?(?:slot|time|time block))", "scheduled", false);
  flag("(?:scheduled|planned|on (?:the |my )?calendar|booked|time blocked|has a slot|have a slot|with time blocked)", "scheduled", true);
  flag("(?:without|no|missing)(?: an?)? checklists?", "hasChecklist", false);
  r.take(W("(?:unfinished|incomplete|open|unchecked) checklists?|checklists? (?:not done|not finished|left|remaining|open)|checklist items? left"), () => {
    r.rule({ field: "hasChecklist", op: "is", value: true });
    return r.rule({ field: "progress", op: "lt", value: 100 });
  });
  flag("(?:with|has|have|having)(?: an?)? checklists?|checklists?|subtasks?|sub-tasks?", "hasChecklist", true);
  flag("over (?:the |its |their )?estimates?|over budget|over time|overrun|ran over|took longer(?: than (?:planned|estimated|expected))?|underestimated", "overEstimate", true);
  flag("today focus|focus (?:for )?today|my focus|focus list|daily focus", "todayFocus", true);
  flag("(?:in|currently in|on) focus|focusing|focused|being worked on|in progress right now|active focus|timer running", "inFocus", true);
  flag("focus", "todayFocus", true);
  flag("unlocked|not locked", "locked", false);
  flag("locked|pinned in place|fixed time", "locked", true);
  r.take(W("(?:no|without(?: an?)?|missing(?: an?)?|empty) (?:descriptions?|notes|details)|undescribed"), () => r.rule({ field: "description", op: "isEmpty" }));
  r.take(W("(?:with|has|have|having)(?: an?)? (?:descriptions?|notes|details)"), () => r.rule({ field: "description", op: "isNotEmpty" }));
  r.take(W("(?:no|without(?: an?)?|missing(?: an?)?) start dates?"), () => r.rule({ field: "startDate", op: "isEmpty" }));
  r.take(W("(?:with|has|have|having)(?: an?)? start dates?"), () => r.rule({ field: "startDate", op: "isNotEmpty" }));
  r.take(W("(?:no|without(?: an?| any)?|missing(?: an?)?) (?:deadlines?|due dates?|dates?)|undated|not due|no due"), () => r.rule({ field: "deadline", op: "isEmpty" }));
  r.take(W("(?:(?:with|that have|having|has|have|set|carrying) )?(?:(?:an?|a set|their) )?(?:deadlines?|due dates?)(?: set)?|due"), () => r.rule({ field: "deadline", op: "isNotEmpty" }));
  r.take(W("dated|with (?:a )?date|with dates|has a date|on the radar"), () => {
    r.onlyDated = true;
    return r.part();
  });
  r.take(W("(?:no|without(?: a| any)?|not in (?:a|any)|outside(?: of)? (?:a|any)) projects?|loose|unfiled|standalone|orphan(?:ed)?"), () => r.rule({ field: "project", op: "isEmpty" }));
  r.take(W("(?:no|without(?: any)?) (?:labels|tags|label|tag)|unlabell?ed|untagged"), () => r.rule({ field: "label", op: "isEmpty" }));
  r.take(W("(?:with|has|have|having) (?:labels|tags|a label|a tag|any labels|any tags)|labell?ed|tagged"), () => r.rule({ field: "label", op: "isNotEmpty" }));
  r.take(W("(?:no|without(?: a)?) stages?|unstaged"), () => r.rule({ field: "stage", op: "isEmpty" }));

  // Done and open.
  r.take(W("(?:not done|undone|not completed|incomplete|uncompleted|unfinished|not finished|open|pending|remaining|outstanding|active|left|to ?do|todos?|current|in flight|ongoing|unresolved|not closed)"), () => {
    if (r.showCompleted === undefined) r.showCompleted = false;
    return r.part();
  });
  r.take(W("(?:done|completed|complete|finished|closed|ticked off|checked off|marked (?:as )?done|wrapped up|accomplished|achieved)"), () => {
    r.showCompleted = true;
    if (!r.sort) r.sort = { by: "completedAt", dir: "desc" };
    return r.rule({ field: "done", op: "is", value: true });
  });

  // Effort kinds.
  const effort = (source: string, value: string) => r.take(W(source), () => r.rule({ field: "effort", op: "anyOf", value: [value] }));
  effort("deep work|deep focus|deep|focus work|heads? down|hard thinking", "deep");
  effort("admin(?: work| stuff| tasks)?|paperwork|errands|chores|busywork|busy work", "admin");
  effort("creative(?: work| stuff| tasks)?", "creative");
  effort("routine(?: work| stuff| tasks)?", "routine");
}

function readPriority(r: Reader) {
  const value = (word: string) => PRIORITY_WORDS[word] ?? priorityValue(word);
  r.take(W(`(?:no|without(?: a| any)?|missing(?: a)?|unset) ${PRIO}(?: set)?|unprioriti[sz]ed|not prioriti[sz]ed`), () => r.rule({ field: "priority", op: "isEmpty" }));
  r.take(W(`(?:${PRIO} )?(?:at least|above|>=|minimum) ${P}(?: ${PRIO})?|${P}(?: ${PRIO})? (?:and|or) (?:above|higher|up|more|over)|${P}\\+(?: ${PRIO})?`), (match) => {
    const word = match[1] || match[2] || match[3];
    return r.rule({ field: "priority", op: "gte", value: value(word) });
  });
  r.take(W(`(?:${PRIO} )?(?:at most|below|<=|maximum) ${P}(?: ${PRIO})?|${P}(?: ${PRIO})? (?:and|or) (?:below|lower|less|under)`), (match) => {
    const word = match[1] || match[2];
    return r.rule({ field: "priority", op: "lte", value: value(word) });
  });
  r.take(W(`(?:not|non|non-) ?${P}(?: ${PRIO})?`), (match) => r.rule({ field: "priority", op: "noneOf", value: [value(match[1])] }));
  r.take(W(`(?:${PRIO} (?:is |of |= |: )?)?${P}(?:(?: ,| or| and|\\/) ${P})?(?:(?: ,| or| and|\\/) ${P})?(?: ${PRIO})?`), (match) => {
    const words = [match[1], match[2], match[3]].filter(Boolean);
    const values = [...new Set(words.map(value))];
    return r.rule({ field: "priority", op: "anyOf", value: values });
  });
  r.take(W("(?:very |really |most )?important|must[- ]do|key|crucial|top"), () => r.rule({ field: "priority", op: "gte", value: "High" }));
  r.take(W("(?:not important|unimportant|someday|nice to have|backlog|whenever)"), () => r.rule({ field: "priority", op: "lte", value: "Medium" }));
}

function readBareEntities(r: Reader) {
  if (r.entities.length === 0) return;
  // A name the reader has no other use for: "Timely tasks", "bugs in Home".
  const usable = (entity: Entity) => entity.key.length >= 2 && (entity.key.includes(" ") || (!RESERVED.has(entity.key) && !FILLER.has(entity.key) && !NOUNS.test(entity.key)));
  // After "in" or "from" a name is a name even when it is also a word ("in Home", "from Work").
  const placed = r.namesSource((entity) => entity.kind !== "field" && entity.kind !== "option" && entity.key.length >= 2 && !FILLER.has(entity.key));
  if (placed) {
    r.take(W(`(?:in|from|within|inside|under) (?:the |my )?(${placed})`), (match) => {
      const entity = r.entity(match[1], ["project", "workspace", "stage", "status", "label"]);
      if (!entity) return false;
      return r.rule(r.entityRule(entity, false), true);
    });
  }
  const names = r.namesSource((entity) => usable(entity) && entity.kind !== "field");
  if (names) {
    r.take(W(`(?:(?:for|on|at|of|about) )?(?:the )?(${names})`), (match) => {
      const entity = r.entity(match[1]);
      if (!entity || !usable(entity)) return false;
      return r.rule(r.entityRule(entity, false), true);
    });
  }
  // Checkbox fields on their own: "billable tasks".
  const flags = r.namesSource((entity) => entity.kind === "field" && entity.custom?.type === "boolean" && usable(entity));
  if (flags) {
    r.take(W(`(${flags})`), (match) => {
      const entity = r.entity(match[1], ["field"]);
      if (!entity) return false;
      return r.rule(r.entityRule(entity, false), true);
    });
  }
}

function readText(r: Reader, quoted: string[]) {
  r.take(W("(?:named|called|titled|with (?:the )?(?:name|title)|whose (?:name|title) (?:is|has|contains)|name (?:has|contains|is)|title (?:has|contains|is)) (qq\\d+|[^|@]+?)(?= (?:\\||$))"), (match) => {
    const text = textOf(match[1], quoted);
    return text ? r.rule({ field: "name", op: "contains", value: text }) : false;
  });
  r.take(W("(?:about|regarding|mentioning|mention|mentions|containing|contains|contain|that say|that mention|related to|relating to|concerning|on the topic of|to do with|re|involving|with the word|with the words) (qq\\d+|[^|@]+?)(?= (?:\\||$))"), (match) => {
    const text = textOf(match[1], quoted);
    return text ? r.rule({ field: "text", op: "contains", value: text }) : false;
  });
  r.take(W("qq(\\d+)"), (match) => {
    const text = quoted[Number(match[1])];
    return text ? r.rule({ field: "text", op: "contains", value: text }) : false;
  });
}

function textOf(raw: string, quoted: string[]): string {
  const quote = /^qq(\d+)$/.exec(raw.trim());
  if (quote) return quoted[Number(quote[1])] ?? "";
  const words = raw.trim().split(" ").filter((word) => word && word !== "," && word !== "|");
  while (words.length && (FILLER.has(words[0]) || NOUNS.test(words[0]))) words.shift();
  while (words.length && (FILLER.has(words[words.length - 1]) || NOUNS.test(words[words.length - 1]))) words.pop();
  return words.join(" ");
}

function readLeftover(r: Reader) {
  const words = r.rest.split(" ").filter(Boolean);
  for (const word of words) {
    if (word === "|" || word === "," || /^\|r\d+\|$/.test(word) || /^@d\d+$/.test(word)) continue;
    if (VERBS.test(word)) {
      r.listing = true;
      continue;
    }
    if (NOUNS.test(word)) {
      r.listing = true;
      continue;
    }
    if (FILLER.has(word) || word.length < 3 || /^\d+$/.test(word) || /^[^\p{L}\p{N}]+$/u.test(word)) continue;
    r.leftover.push(word);
  }
  for (const word of r.leftover) r.rules.push({ field: "text", op: "contains", value: word });
}

/** "overdue or due today": rules side by side with "or" become one "any" group. */
function joinAlternatives(r: Reader) {
  const joined = new Map<number, number>();
  const root = (index: number): number => (joined.has(index) ? root(joined.get(index)!) : index);
  let previous: number | null = null;
  let sawOr = false;
  for (const token of r.rest.split(" ").filter(Boolean)) {
    const mark = /^\|r(\d+)\|$/.exec(token);
    if (mark) {
      const index = Number(mark[1]);
      if (previous !== null && sawOr) {
        const left = root(previous);
        const right = root(index);
        if (left !== right) joined.set(right, left);
      }
      previous = index;
      sawOr = false;
      continue;
    }
    if (token === "or" || token === "either" || token === "/") sawOr = true;
    else if (!(token === "|" || token === "," || FILLER.has(token) || NOUNS.test(token))) previous = null;
  }
  if (joined.size === 0) return;
  const groups = new Map<number, TaskViewRule[]>();
  r.rules.forEach((rule, index) => {
    const key = root(index);
    groups.set(key, [...(groups.get(key) ?? []), rule]);
  });
  const out: TaskViewRule[] = [];
  for (const [, members] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    if (members.length === 1) {
      out.push(members[0]);
      continue;
    }
    const conditions = members.flatMap((rule) => (isRuleGroup(rule) ? rule.rules : [rule]));
    out.push({ match: "any", rules: conditions });
  }
  r.rules = out;
}

/** Same-field "any of" choices side by side ("project A and B") read as either. */
function mergeChoices(rules: TaskViewRule[]): TaskViewRule[] {
  const out: TaskViewRule[] = [];
  for (const rule of rules) {
    if (isRuleGroup(rule)) {
      const inner = mergeChoices(rule.rules) as TaskViewCondition[];
      out.push(inner.length === 1 && rule.match === "any" ? inner[0] : { ...rule, rules: inner });
      continue;
    }
    const twin = out.find(
      (other): other is TaskViewCondition =>
        !isRuleGroup(other) && other.field === rule.field && other.op === rule.op && (rule.op === "anyOf" || rule.op === "noneOf") && rule.field !== "label",
    );
    if (twin && Array.isArray(twin.value) && Array.isArray(rule.value)) {
      twin.value = [...new Set([...twin.value, ...rule.value])];
      continue;
    }
    out.push(rule);
  }
  return out;
}

function finish(r: Reader): ViewReading {
  const rules = mergeChoices(normalizeRules(r.rules));
  const has = (field: string) =>
    rules.some((rule) => (isRuleGroup(rule) ? rule.rules.some((inner) => inner.field === field) : rule.field === field));
  let sort = r.sort;
  if (!sort) {
    if (has("deadline") || has("overdue") || r.onlyDated) sort = { by: "deadline", dir: "asc" };
    else if (has("completedAt")) sort = { by: "completedAt", dir: "desc" };
    else if (has("createdAt")) sort = { by: "createdAt", dir: "desc" };
    else if (has("updatedAt")) sort = { by: "updatedAt", dir: "desc" };
    else if (has("planned") || has("scheduled")) sort = { by: "scheduledOn", dir: "asc" };
    else if (has("startDate")) sort = { by: "startDate", dir: "asc" };
  }
  const doneWanted = rules.some((rule) => !isRuleGroup(rule) && rule.field === "done" && rule.value === true) || has("completedAt");
  const groupFields = r.groups.length ? r.groups : r.render === "kanban" ? (["status"] as TaskListGroupField[]) : [];
  const view: ViewDraft = {
    dataMode: r.dataMode ?? "task",
    renderMode: r.render ?? "list",
    groupFields,
    groupSortDirection: "asc",
    groupValueOrders: {},
    sortBy: sort?.by ?? "deadline",
    sortDirection: sort?.dir ?? "asc",
    selectedWorkspaceIds: [],
    selectedStatusIds: [],
    selectedProjectIds: [],
    selectedPriorityLevels: [],
    selectedLabelIds: [],
    selectedStageIds: [],
    // Open work unless the words ask for done or everything.
    showCompleted: r.showCompleted ?? doneWanted,
    onlyOverdue: false,
    onlyScheduled: false,
    onlyRecurring: false,
    onlyDated: r.onlyDated,
    showReminders: r.reminders,
    columnOrder: [],
    rules,
  };
  if (r.thenSort) {
    view.thenSortBy = r.thenSort.by;
    view.thenSortDirection = r.thenSort.dir;
  }
  if (r.limit) view.limit = r.limit;
  const named = Boolean(r.name);
  return {
    view,
    name: (r.name ?? viewName(view, r.vocab)).slice(0, 100),
    named,
    createView: r.createView,
    listing: r.listing,
    understood: r.understood,
    entities: r.entityParts,
    leftover: r.leftover,
  };
}

// ---- Describing a view ----

export type ViewChipKind = "filter" | "sort" | "group" | "layout" | "scope" | "limit";

export interface ViewChip {
  key: string;
  kind: ViewChipKind;
  label: string;
  /** A short form for a view's name ("Due this week", "#bug"). */
  short: string;
  /** The change that takes this chip off the view. */
  remove: Partial<TaskViewConfig>;
}

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const weekday = (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7;
  return `${WEEKDAY_NAMES[weekday]} ${date} ${MONTH_NAMES[month - 1]}`;
}

/** A date value in words: "this week", "in the next 7 days", "Mon 20 Oct". */
export function dateWords(value: unknown): string {
  if (typeof value !== "string") return "";
  const words: Record<string, string> = {
    today: "today", tomorrow: "tomorrow", yesterday: "yesterday", thisWeek: "this week", nextWeek: "next week",
    lastWeek: "last week", thisWeekend: "this weekend", thisMonth: "this month", nextMonth: "next month",
    lastMonth: "last month", thisYear: "this year",
  };
  if (words[value]) return words[value];
  let match: RegExpExecArray | null;
  if ((match = /^next:(\d+)$/.exec(value))) return `in the next ${match[1]} days`;
  if ((match = /^last:(\d+)$/.exec(value))) return `in the last ${match[1]} days`;
  if ((match = /^\+(\d+)$/.exec(value))) return match[1] === "1" ? "tomorrow" : `in ${match[1]} days`;
  if ((match = /^-(\d+)$/.exec(value))) return match[1] === "1" ? "yesterday" : `${match[1]} days ago`;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return shortDay(value.slice(0, 10));
  return value;
}

const DATE_VERBS: Record<string, [string, string]> = {
  // [prefix, short noun]
  deadline: ["Due", "Due"],
  planned: ["Planned", "Planned"],
  startDate: ["Starts", "Starts"],
  createdAt: ["Created", "Created"],
  updatedAt: ["Updated", "Updated"],
  completedAt: ["Completed", "Done"],
};

function dateLabel(field: string, op: TaskRuleOp, value: unknown, to: unknown, fieldName: string): string {
  const verb = DATE_VERBS[field]?.[0] ?? fieldName;
  const when = dateWords(value);
  const relative = typeof value === "string" && /^-\d+$/.test(value);
  switch (op) {
    case "isEmpty":
      return field === "deadline" ? "No deadline" : field === "planned" ? "Not planned" : field === "completedAt" ? "Not done" : `No ${fieldName.toLowerCase()}`;
    case "isNotEmpty":
      return field === "deadline" ? "Has a deadline" : field === "planned" ? "Planned" : field === "completedAt" ? "Done" : `Has ${fieldName.toLowerCase()}`;
    case "in":
      return `${verb} ${/^(\w{3} \d)/.test(when) ? `on ${when}` : when}`;
    case "notIn":
      return `Not ${verb.toLowerCase()} ${when}`;
    case "before":
      if (field === "updatedAt" && relative) return `Not updated in ${String(value).slice(1)} days`;
      if (field === "createdAt" && relative) return `Older than ${String(value).slice(1)} days`;
      return `${verb} before ${when}`;
    case "onOrBefore":
      return `${verb} by ${resolveEndWords(value)}`;
    case "after":
      return `${verb} after ${resolveEndWords(value)}`;
    case "onOrAfter":
      return `${verb} since ${when}`;
    case "between":
      return `${verb} ${when} – ${dateWords(to)}`;
    default:
      return `${verb} ${when}`;
  }
}

/** "by this week" reads "by the end of this week". */
function resolveEndWords(value: unknown): string {
  const words = dateWords(value);
  return /^(this|next|last) (week|month|year|weekend)$/.test(words) ? `the end of ${words}` : words;
}

function minutesWords(value: unknown): string {
  const minutes = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(minutes)) return String(value);
  if (minutes >= 60 && minutes % 30 === 0) {
    const hours = minutes / 60;
    return `${hours} h`;
  }
  return `${minutes} min`;
}

const NUMBER_OP_WORDS: Partial<Record<TaskRuleOp, string>> = {
  eq: "is", neq: "is not", gt: "over", gte: "at least", lt: "under", lte: "at most",
};

const FLAG_WORDS: Record<string, [string, string]> = {
  done: ["Done", "Open"],
  overdue: ["Overdue", "Not overdue"],
  scheduled: ["On the calendar", "Not on the calendar"],
  recurring: ["Repeating", "One-off"],
  blocked: ["Blocked", "Not blocked"],
  blocking: ["Blocking other work", "Not blocking"],
  hasChecklist: ["Has a checklist", "No checklist"],
  overEstimate: ["Over its estimate", "Within its estimate"],
  inFocus: ["In focus", "Not in focus"],
  todayFocus: ["Today's focus", "Not in today's focus"],
  locked: ["Schedule locked", "Not locked"],
};

const EFFORT_WORDS: Record<string, string> = { deep: "Deep work", admin: "Admin", creative: "Creative", routine: "Routine" };

function names(ids: unknown, items: readonly VocabItem[] | undefined, fallback: string): string[] {
  const list = Array.isArray(ids) ? ids : typeof ids === "string" ? [ids] : [];
  const out = list.map((id) => items?.find((item) => item.id === id)?.name ?? (items ? "" : id)).filter(Boolean);
  return out.length ? [...new Set(out)] : list.length ? [fallback] : [];
}

function joinWords(words: string[], last: "or" | "and" = "or"): string {
  if (words.length <= 1) return words[0] ?? "";
  if (words.length > 3) return `${words.slice(0, 2).join(", ")} +${words.length - 2}`;
  return `${words.slice(0, -1).join(", ")} ${last} ${words[words.length - 1]}`;
}

/** One condition in words: "Due this week", "Label: bug or ui", "Estimate at most 30 min". */
export function conditionLabel(rule: TaskViewCondition, vocab: ViewVocabulary = {}): { label: string; short: string } {
  const info = ruleFieldInfo(rule.field, vocab.customFields ?? []);
  const fieldName = info?.label ?? "Field";
  const { op, value } = rule;
  if (info?.kind === "date") {
    const label = dateLabel(rule.field, op, value, rule.to, fieldName);
    const short = op === "isNotEmpty" && rule.field === "deadline" ? "Deadlines" : label;
    return { label, short };
  }
  if (info?.kind === "flag") {
    const words = FLAG_WORDS[rule.field] ?? [fieldName, `Not ${fieldName.toLowerCase()}`];
    const label = value === false ? words[1] : words[0];
    return { label, short: label };
  }
  if (info?.kind === "number") {
    const isMinutes = rule.field === "duration" || rule.field === "tracked";
    const show = (number: unknown) => (isMinutes ? minutesWords(number) : rule.field === "progress" ? `${number}%` : String(number));
    if (op === "isEmpty") {
      const label = rule.field === "duration" ? "No estimate" : rule.field === "tracked" ? "No time tracked" : `No ${fieldName.toLowerCase()}`;
      return { label, short: label };
    }
    if (op === "isNotEmpty") {
      const label = rule.field === "duration" ? "Has an estimate" : rule.field === "tracked" ? "Time tracked" : `Has ${fieldName.toLowerCase()}`;
      return { label, short: label };
    }
    if (rule.field === "duration" && op === "lte" && Number(value) <= 30) return { label: `Quick (${show(value)} or less)`, short: "Quick" };
    if (rule.field === "duration" && op === "gte" && Number(value) >= 120) return { label: `Big (${show(value)} or more)`, short: "Big" };
    if (op === "between") return { label: `${fieldName} ${show(value)} – ${show(rule.to)}`, short: fieldName };
    const label = `${fieldName} ${NUMBER_OP_WORDS[op] ?? op} ${show(value)}`;
    return { label, short: label };
  }
  if (info?.kind === "choice") {
    let items: readonly VocabItem[] | undefined;
    let noun = fieldName;
    switch (rule.field) {
      case "workspace":
        items = vocab.workspaces;
        break;
      case "project":
        items = vocab.projects;
        break;
      case "status":
        items = vocab.statuses;
        break;
      case "stage":
        items = vocab.stages;
        break;
      case "label":
        items = vocab.labels;
        noun = "Label";
        break;
      case "priority":
      case "effort":
        items = undefined;
        break;
      default: {
        const custom = vocab.customFields?.find((field) => `cf:${field.id}` === rule.field);
        items = custom?.options?.options?.map((option) => ({ id: option.id, name: option.value })) ?? [];
      }
    }
    if (op === "isEmpty") {
      const label = rule.field === "label" ? "No labels" : `No ${fieldName.toLowerCase()}`;
      return { label, short: label };
    }
    if (op === "isNotEmpty") {
      const label = rule.field === "label" ? "Has labels" : `Has a ${fieldName.toLowerCase()}`;
      return { label, short: label };
    }
    if (rule.field === "priority") {
      const level = Array.isArray(value) ? value : [String(value ?? "")];
      if (op === "gte") return { label: `${value} priority or higher`, short: `${value}+` };
      if (op === "lte") return { label: `${value} priority or lower`, short: `${value} or lower` };
      const words = joinWords(level.map((item) => priorityValue(item) || item));
      return op === "noneOf" ? { label: `Not ${words} priority`, short: `Not ${words}` } : { label: `${words} priority`, short: words };
    }
    if (rule.field === "effort") {
      const level = (Array.isArray(value) ? value : [String(value ?? "")]).map((item) => EFFORT_WORDS[item] ?? item);
      return op === "noneOf" ? { label: `Not ${joinWords(level)}`, short: `Not ${joinWords(level)}` } : { label: joinWords(level), short: joinWords(level) };
    }
    const list = names(value, items, `a missing ${noun.toLowerCase()}`);
    if (op === "noneOf") return { label: `Not ${rule.field === "label" ? "labelled" : `in ${noun.toLowerCase()}`} ${joinWords(list)}`, short: `Not ${joinWords(list)}` };
    if (op === "allOf") return { label: `Labels ${joinWords(list, "and")}`, short: list.map((item) => `#${item}`).join(" ") };
    if (rule.field === "label") return { label: `Label ${joinWords(list)}`, short: list.map((item) => `#${item}`).join(" ") };
    return { label: `${noun}: ${joinWords(list)}`, short: joinWords(list) };
  }
  // Text.
  const text = typeof value === "string" ? value : String(value ?? "");
  if (op === "isEmpty") return { label: `No ${fieldName.toLowerCase()}`, short: `No ${fieldName.toLowerCase()}` };
  if (op === "isNotEmpty") return { label: `Has ${fieldName.toLowerCase()}`, short: `Has ${fieldName.toLowerCase()}` };
  const about = rule.field === "text" ? "Mentions" : `${fieldName} has`;
  if (op === "notContains") return { label: rule.field === "text" ? `Doesn't mention “${text}”` : `${fieldName} lacks “${text}”`, short: `Not “${text}”` };
  if (op === "is") return { label: `${fieldName} is “${text}”`, short: `“${text}”` };
  if (op === "startsWith") return { label: `${fieldName} starts with “${text}”`, short: `“${text}…”` };
  return { label: `${about} “${text}”`, short: `“${text}”` };
}

/** A rule (or group of rules) in words. */
export function ruleLabel(rule: TaskViewRule, vocab: ViewVocabulary = {}): { label: string; short: string } {
  if (!isRuleGroup(rule)) return conditionLabel(rule, vocab);
  const parts = rule.rules.map((inner) => conditionLabel(inner, vocab));
  // "Due today or Planned today" reads "Due or planned today".
  const tails = parts.map((part) => part.label.split(" ").slice(1).join(" "));
  if (parts.length === 2 && tails[0] && tails[0] === tails[1]) {
    const heads = parts.map((part) => part.label.split(" ")[0]);
    const label = `${heads[0]} or ${heads[1].toLowerCase()} ${tails[0]}`;
    return { label, short: label };
  }
  const label = parts
    .map((part, index) => (index === 0 ? part.label : part.label.replace(/^[A-Z](?=[a-z])/, (char) => char.toLowerCase())))
    .join(rule.match === "any" ? " or " : " and ");
  return { label, short: parts.map((part) => part.short).join(rule.match === "any" ? " or " : " + ") };
}

const SORT_LABELS: Record<string, [string, string]> = {
  // [asc, desc]
  name: ["Name A–Z", "Name Z–A"],
  deadline: ["Soonest deadline first", "Latest deadline first"],
  startDate: ["Earliest start first", "Latest start first"],
  scheduledOn: ["Earliest planned first", "Latest planned first"],
  createdAt: ["Oldest first", "Newest first"],
  updatedAt: ["Least recently updated first", "Recently updated first"],
  completedAt: ["Earliest completed first", "Recently completed first"],
  priority: ["Lowest priority first", "Highest priority first"],
  status: ["Status A–Z", "Status Z–A"],
  project: ["Project A–Z", "Project Z–A"],
  workspace: ["Workspace A–Z", "Workspace Z–A"],
  stage: ["Stage A–Z", "Stage Z–A"],
  duration: ["Shortest first", "Longest first"],
  tracked: ["Least time tracked first", "Most time tracked first"],
  urgency: ["Least urgent first", "Most urgent first"],
  progress: ["Least progress first", "Most progress first"],
  effort: ["Effort A–Z", "Effort Z–A"],
};

export function sortLabel(by: TaskViewSortBy, direction: TaskListSortDirection, vocab: ViewVocabulary = {}): string {
  const words = SORT_LABELS[by];
  if (words) return words[direction === "desc" ? 1 : 0];
  const field = vocab.customFields?.find((item) => `cf:${item.id}` === by);
  return `${field?.name ?? "Field"} ${direction === "desc" ? "high to low" : "low to high"}`;
}

export function groupLabel(field: TaskListGroupField, vocab: ViewVocabulary = {}): string {
  if (field.startsWith("cf:")) return vocab.customFields?.find((item) => `cf:${item.id}` === field)?.name ?? "Field";
  return GROUP_FIELD_LABELS[field] ?? field;
}

/** A view's filters, sort, groups, layout and limit as removable chips. */
export function describeView(view: Partial<TaskViewConfig>, vocab: ViewVocabulary = {}): ViewChip[] {
  const chips: ViewChip[] = [];
  const push = (key: string, kind: ViewChipKind, label: string, remove: Partial<TaskViewConfig>, short = label) =>
    chips.push({ key, kind, label, short, remove });
  if (view.showReminders) push("scope:reminders", "scope", "Reminders", { showReminders: false });
  else if (view.dataMode === "project") push("scope:projects", "scope", "Projects", { dataMode: "task" });
  const legacy: [keyof TaskViewConfig, string, readonly VocabItem[] | undefined][] = [
    ["selectedWorkspaceIds", "Workspace", vocab.workspaces],
    ["selectedProjectIds", "Project", vocab.projects],
    ["selectedStatusIds", "Status", vocab.statuses],
    ["selectedStageIds", "Stage", vocab.stages],
    ["selectedLabelIds", "Label", vocab.labels],
  ];
  for (const [key, noun, items] of legacy) {
    const ids = (view[key] as string[] | undefined) ?? [];
    if (!ids.length) continue;
    const list = names(ids, items, `a missing ${noun.toLowerCase()}`);
    push(`field:${key}`, "filter", `${noun}: ${joinWords(list)}`, { [key]: [] }, joinWords(list));
  }
  if (view.selectedPriorityLevels?.length) {
    const words = joinWords(view.selectedPriorityLevels);
    push("field:priority", "filter", `${words} priority`, { selectedPriorityLevels: [] }, words);
  }
  if (view.onlyOverdue) push("flag:overdue", "filter", "Overdue", { onlyOverdue: false });
  if (view.onlyScheduled) push("flag:scheduled", "filter", "On the calendar", { onlyScheduled: false });
  if (view.onlyRecurring) push("flag:recurring", "filter", "Repeating", { onlyRecurring: false });
  if (view.onlyDated) push("flag:dated", "filter", "Has a date", { onlyDated: false }, "Dated");
  const rules = normalizeRules(view.rules);
  rules.forEach((rule, index) => {
    const { label, short } = ruleLabel(rule, vocab);
    push(`rule:${index}`, "filter", label, { rules: rules.filter((_, at) => at !== index) }, short);
  });
  const doneRule = rules.some((rule) => !isRuleGroup(rule) && rule.field === "done");
  if (view.showCompleted === false && !doneRule && !view.showReminders) push("flag:open", "filter", "Open only", { showCompleted: true }, "Open");
  if (view.ruleMatch === "any" && rules.length > 1) push("match:any", "filter", "Any filter can match", { ruleMatch: "all" });
  if (view.sortBy) push("sort", "sort", sortLabel(view.sortBy, view.sortDirection ?? "asc", vocab), { sortBy: "deadline", sortDirection: "asc", thenSortBy: undefined, thenSortDirection: undefined });
  if (view.thenSortBy) push("sort:then", "sort", `then ${sortLabel(view.thenSortBy, view.thenSortDirection ?? "asc", vocab).replace(/^\w/, (char) => char.toLowerCase())}`, { thenSortBy: undefined, thenSortDirection: undefined });
  (view.groupFields ?? []).forEach((field, index, all) => {
    push(`group:${field}`, "group", `Grouped by ${groupLabel(field, vocab).toLowerCase()}`, { groupFields: all.filter((_, at) => at !== index) });
  });
  if (view.renderMode === "kanban") push("layout", "layout", "Board", { renderMode: "list" });
  if (view.renderMode === "gantt") push("layout", "layout", "Timeline", { renderMode: "list" });
  if (view.limit) push("limit", "limit", `Top ${view.limit}`, { limit: undefined });
  return chips;
}

/** "Open tasks", "Done tasks", "Reminders", "Projects": what a view lists. */
export function viewNoun(view: Partial<TaskViewConfig>): string {
  if (view.showReminders) return "Reminders";
  if (view.dataMode === "project") return "Projects";
  const rules = normalizeRules(view.rules);
  const done = rules.find((rule): rule is TaskViewCondition => !isRuleGroup(rule) && rule.field === "done");
  if (done) return done.value === false ? "Open tasks" : "Done tasks";
  return view.showCompleted === false ? "Open tasks" : "Tasks";
}

/** A name made from a view's filters: "Has a deadline", "Urgent · Due this week". */
export function viewName(view: Partial<TaskViewConfig>, vocab: ViewVocabulary = {}): string {
  const filters = describeView(view, vocab).filter((chip) => chip.kind === "filter" && chip.key !== "flag:open");
  const shorts = filters.slice(0, 3).map((chip) => chip.short);
  if (shorts.length === 0) {
    const sort = view.sortBy && view.sortBy !== "deadline" ? sortLabel(view.sortBy, view.sortDirection ?? "asc", vocab) : "";
    const group = view.groupFields?.[0] ? `By ${groupLabel(view.groupFields[0], vocab).toLowerCase()}` : "";
    return [viewNoun(view), group || sort].filter(Boolean).join(" · ").slice(0, 100) || "New view";
  }
  return shorts.join(" · ").slice(0, 100);
}

/** A full view from a reading, ready to save. */
export function viewFromReading(reading: ViewReading, id: string, options: { phone?: boolean; prompt?: string } = {}): TaskViewConfig {
  const view: TaskViewConfig = { ...reading.view, id, name: reading.name || "New view" };
  if (options.phone && view.renderMode === "gantt") view.renderMode = "list";
  if (options.prompt) view.prompt = options.prompt.slice(0, 300);
  return view;
}

/**
 * Whether search should offer a reading as a list of tasks: it read at least
 * one filter, sort or group beyond a bare name, or the person asked to see
 * work ("show …", "tasks …") and something was read.
 */
export function readingIsListing(reading: ViewReading): boolean {
  if (reading.createView) return true;
  const structural = reading.understood - reading.entities;
  if (structural >= 1) return true;
  return reading.listing && reading.understood >= 1;
}
