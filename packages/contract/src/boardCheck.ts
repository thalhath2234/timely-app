/**
 * Checks a described card or live block the way the apps will draw it, for
 * the API's Describe loop (apps/api/internal/features/provider): the model
 * hands a draft to its check_block tool and reads back what every block
 * shows from the person's data and what is wrong, so a name that fits
 * nothing or an empty chart is fixed before the person sees the card.
 * `make gen-board-check` bundles this file into
 * apps/api/internal/features/provider/board/board-check.js.
 */
import type { DashboardData, EngineContext } from "./dashboard";
import type { GenuiNode } from "./genui";
import { BOARD_ROOT, boardParser, cellsProblems, dataProblems, drawBoard } from "./genuiBoard";

export interface BoardCheck {
  /** What is wrong, one sentence each; empty when the program draws as written. */
  problems: string[];
  /** What the card shows from the data, one line per block or row, children indented. */
  shows: string[];
}

const OUTLINE_LINES = 80;
const OUTLINE_TEXT = 80;
const OUTLINE_ITEMS = 12;

function isNode(value: unknown): value is GenuiNode {
  return Boolean(value) && typeof value === "object" && (value as GenuiNode).type === "element";
}

function clip(text: string): string {
  return text.length > OUTLINE_TEXT ? `${text.slice(0, OUTLINE_TEXT - 1)}…` : text;
}

function scalar(value: unknown): string {
  if (value === null || value === undefined) return "missing";
  if (typeof value === "string") return JSON.stringify(clip(value));
  return String(value);
}

/** The drawn tree as lines: each component with its words and numbers, its blocks and rows under it. */
function outline(root: GenuiNode): string[] {
  const lines: string[] = [];
  const walk = (node: GenuiNode, depth: number) => {
    const pad = "  ".repeat(depth);
    const words: string[] = [];
    const children: unknown[] = [];
    for (const [name, value] of Object.entries(node.props)) {
      if (isNode(value) || (Array.isArray(value) && value.some(isNode))) {
        children.push(value);
      } else if (Array.isArray(value)) {
        const shown = value.slice(0, OUTLINE_ITEMS).map(scalar);
        words.push(`${name}: [${shown.join(", ")}${value.length > OUTLINE_ITEMS ? `, … ${value.length - OUTLINE_ITEMS} more` : ""}]`);
      } else {
        words.push(`${name}: ${scalar(value)}`);
      }
    }
    lines.push(`${pad}${node.typeName}${words.length ? ` ${words.join(", ")}` : ""}`);
    for (const value of children) {
      for (const child of (Array.isArray(value) ? value : [value]).filter(isNode)) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return lines.length > OUTLINE_LINES ? [...lines.slice(0, OUTLINE_LINES), `… ${lines.length - OUTLINE_LINES} more lines`] : lines;
}

/** Draws program from data and says what it shows and what is wrong with it. */
export function checkBoard(program: string, data: DashboardData, ctx: EngineContext): BoardCheck {
  const parsed = boardParser().parse(program);
  const problems: string[] = [];
  if (!parsed.root || parsed.root.typeName !== BOARD_ROOT) problems.push(`The program has no root = ${BOARD_ROOT}(...) line.`);
  for (const error of parsed.meta.errors) problems.push(error.statementId ? `${error.statementId}: ${error.message}` : error.message);
  for (const name of parsed.meta.unresolved) problems.push(`${name} is used but never defined.`);
  for (const name of parsed.meta.orphaned) problems.push(`${name} is defined but no block shows it: put it in a block or leave it out.`);
  problems.push(...dataProblems(program, data), ...cellsProblems(program, data));
  const root = drawBoard(program, data, ctx);
  return { problems: [...new Set(problems)], shows: root ? outline(root) : [] };
}

// ---- A runtime without Intl ----

/**
 * The API's VM (goja) has no Intl and reads toLocaleString's first argument
 * as a radix, so dates in the Working hours zone and grouped numbers come
 * out wrong or throw. It passes this host function instead: the instant's
 * [year, month, day, hour, minute, second, weekday] in zone, null for a zone
 * it doesn't know.
 */
declare const hostZoneParts: ((ms: number, zone: string) => number[] | null) | undefined;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function zoned(at: Date, zone?: string) {
  const host = zone && typeof hostZoneParts === "function" ? hostZoneParts(at.getTime(), zone) : null;
  if (host) return { year: host[0], month: host[1], day: host[2], hour: host[3], minute: host[4], second: host[5], weekday: host[6] };
  return { year: at.getFullYear(), month: at.getMonth() + 1, day: at.getDate(), hour: at.getHours(), minute: at.getMinutes(), second: at.getSeconds(), weekday: at.getDay() };
}

const two = (value: number) => String(value).padStart(2, "0");

type Part = { type: string; value: string };

/** Enough of Intl.DateTimeFormat for the shared code: the parts it reads, always in 24-hour time. */
class ZoneFormat {
  private options: Intl.DateTimeFormatOptions;
  constructor(_locale?: unknown, options: Intl.DateTimeFormatOptions = {}) {
    if (options.timeZone && typeof hostZoneParts === "function" && !hostZoneParts(0, options.timeZone)) {
      throw new RangeError(`Invalid time zone specified: ${options.timeZone}`);
    }
    this.options = options;
  }
  formatToParts(at?: Date | number): Part[] {
    const o = this.options;
    const p = zoned(new Date(at ?? Date.now()), o.timeZone);
    const parts: Part[] = [];
    const add = (type: string, value: string, after: string) => {
      if (parts.length) parts.push({ type: "literal", value: after });
      parts.push({ type, value });
    };
    const named = o.month === "long" || o.month === "short";
    if (o.weekday) add("weekday", o.weekday === "long" ? DAY_NAMES[p.weekday] : DAY_NAMES[p.weekday].slice(0, 3), "");
    if (o.month) add("month", named ? MONTH_NAMES[p.month - 1].slice(0, o.month === "short" ? 3 : undefined) : o.month === "2-digit" ? two(p.month) : String(p.month), ", ");
    if (o.day) add("day", o.day === "2-digit" ? two(p.day) : String(p.day), named ? " " : "/");
    if (o.year) add("year", o.year === "2-digit" ? two(p.year % 100) : String(p.year), named ? ", " : "/");
    if (o.hour) add("hour", o.hour === "2-digit" ? two(p.hour) : String(p.hour), ", ");
    if (o.minute) add("minute", two(p.minute), ":");
    if (o.second) add("second", two(p.second), ":");
    return parts;
  }
  format(at?: Date | number): string {
    return this.formatToParts(at)
      .map((part) => part.value)
      .join("");
  }
  resolvedOptions() {
    return { locale: "en-US", timeZone: this.options.timeZone ?? "UTC" };
  }
}

/** Number toLocaleString as en-US writes it: grouped thousands and the fraction digits asked for. */
function localeNumber(this: number, _locale?: unknown, options: { minimumFractionDigits?: number; maximumFractionDigits?: number } = {}): string {
  const value = Number(this);
  if (!Number.isFinite(value)) return String(value);
  const min = Math.max(0, Math.min(20, options.minimumFractionDigits ?? 0));
  const max = Math.max(min, Math.min(20, options.maximumFractionDigits ?? Math.max(min, 3)));
  const [whole, digits = ""] = Math.abs(value).toFixed(max).split(".");
  let fraction = digits.replace(/0+$/, "");
  while (fraction.length < min) fraction += "0";
  const text = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? `.${fraction}` : "");
  return value < 0 && /[1-9]/.test(text) ? `-${text}` : text;
}

/** Fills in what the shared code needs when the runtime lacks Intl; a full runtime is left alone. */
function fillRuntime() {
  if (typeof Intl !== "undefined") return;
  (globalThis as { Intl?: unknown }).Intl = { DateTimeFormat: ZoneFormat };
  Number.prototype.toLocaleString = localeNumber as unknown as typeof Number.prototype.toLocaleString;
  Date.prototype.toLocaleTimeString = function (this: Date, locale?: unknown, options: Intl.DateTimeFormatOptions = {}) {
    return new ZoneFormat(locale, { timeZone: options.timeZone, hour: "2-digit", minute: "2-digit" }).format(this);
  } as typeof Date.prototype.toLocaleTimeString;
  Date.prototype.toLocaleDateString = function (this: Date, locale?: unknown, options: Intl.DateTimeFormatOptions = {}) {
    const asked = options.weekday || options.month || options.day || options.year;
    return new ZoneFormat(locale, asked ? options : { ...options, month: "numeric", day: "numeric", year: "numeric" }).format(this);
  } as typeof Date.prototype.toLocaleDateString;
}

interface CheckRequest {
  program: string;
  data: DashboardData;
  /** The instant to draw at, as an ISO string. */
  now: string;
  /** Working hours zone; empty uses the runtime's zone. */
  timeZone?: string;
}

/** Takes and returns JSON, as the API's VM passes only strings. */
export function check(json: string): string {
  fillRuntime();
  const request = JSON.parse(json) as CheckRequest;
  const now = new Date(request.now);
  const ctx = { now: Number.isNaN(now.getTime()) ? new Date() : now, timeZone: request.timeZone || undefined };
  return JSON.stringify(checkBoard(request.program ?? "", request.data ?? {}, ctx));
}
