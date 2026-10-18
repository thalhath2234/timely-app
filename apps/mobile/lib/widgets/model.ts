/**
 * Home screen widgets, worked out from the same Dashboard cards web, desktop
 * and the phone show. Each card becomes a small `WidgetModel` (a number, a
 * few rows, bars, a ring, a note or buttons) that lib/widgets/render.tsx
 * draws with react-native-android-widget. Pure, so
 * `make test-mobile-widgets` runs it under Node.
 */
import {
  builtinInfo,
  cardTitle,
  clockElapsed,
  clockEndsAt,
  clockRemaining,
  clockState,
  completionStreak,
  completionsByDay,
  computeCard,
  daysUntil,
  focusSummary,
  formatMetric,
  formatMinutes,
  goalSettings,
  habitList,
  habitLog,
  habitStreak,
  initialPomodoro,
  journalPrompt,
  MATRIX_LABELS,
  nextUp,
  POMODORO_MAX_MS,
  POMODORO_PHASE_MAX,
  POMODORO_PHASE_SETTING,
  pomodoroRemaining,
  pomodoroSettings,
  priorityMatrix,
  timeProgress,
  topThreePicks,
  weeklyReview,
  workdayWindow,
  type DashboardCard,
  type ClockState,
  type DashboardData,
  type FocusSessionLike,
  type MatrixQuadrant,
  type PomodoroPhase,
} from "@timely/contract/dashboard";
import {
  computeSheetCard,
  formatLike,
  pickDocBlocks,
  pickDocChecks,
  type DocPick,
  type SheetPick,
} from "@timely/contract/dashboardFiles";
import type { DocContent } from "@timely/contract/documents";
import type { Sheet } from "@timely/contract/sheet";
import type { SheetColumn } from "@timely/contract/sheetTypes";
import { calendarItemDone, type TodayResponse } from "@timely/contract/calendar";
import { addDaysToDate, dateInZone, todayInZone } from "@timely/contract/workStatus";
import type { WorkingHours } from "@timely/contract/schedule";
import type { LocalTap, WidgetAction, WidgetTap } from "./actions";

export type WidgetTone = "default" | "muted" | "accent" | "danger" | "success";

export type WidgetRow = {
  title: string;
  meta?: string;
  tone?: WidgetTone;
  done?: boolean;
  color?: string;
  uri?: string;
  /** Tapping the checkbox does this in place (the rest of the row still opens `uri`). */
  toggle?: WidgetAction;
  /** A table row's other cells, one per column after the first (blank cells stay, so columns line up). */
  cells?: string[];
};

export type WidgetGlyph = "play" | "pause" | "skip" | "reset" | "plus" | "minus" | "lap" | "inbox" | "save";

/** A button opens `uri`, runs `action` on the home screen, or makes a `local` change the phone draws by itself. */
export type WidgetButton = { label: string; uri?: string; action?: WidgetAction; local?: LocalTap; glyph?: WidgetGlyph };

/**
 * A figure the launcher ticks by itself (a system Chronometer): `base` is the
 * epoch ms where a stopwatch reads 0:00, or where a countdown ends.
 */
export type WidgetTimer = { base: number; countDown: boolean; running: boolean };

export type WidgetModel = {
  title: string;
  /** Where a tap on the widget goes (a timelymobile:// link). */
  uri: string;
  /** Large figure for stat-like cards. */
  value?: string;
  /**
   * Drawn in place of `value` (which still sizes the figure): a {{key:clock}}
   * the phone fills in itself when a tap changes a length (lib/widgets/local.ts).
   */
  valueText?: string;
  /** The widest text the phone may put in place of `value`: the figure is sized to fit it. */
  valueFit?: string;
  /** Line under (or beside) the figure. */
  caption?: string;
  captionTone?: WidgetTone;
  rows?: WidgetRow[];
  /** A table's column names, over its rows' title and cells. */
  columns?: string[];
  /** Rows that don't fit scroll inside the widget instead of being cut off. */
  scroll?: boolean;
  bars?: { label: string; value: number; highlight?: boolean }[];
  /** Draws `bars` as a line instead (a line chart card). */
  line?: boolean;
  ring?: { value: number; target: number; label: string };
  meters?: { label: string; value: number; detail?: string }[];
  note?: string;
  buttons?: WidgetButton[];
  /** Tabs over the figure (a pomodoro's phases); tapping one runs its action in place. */
  tabs?: { label: string; selected: boolean; action: WidgetTap }[];
  /** −/+ beside the tabs; a side is missing at its limit. */
  stepper?: { minus?: WidgetTap; plus?: WidgetTap; unit: string };
  /** Makes `value` a live clock. */
  timer?: WidgetTimer;
  /** Shown when there's nothing to draw. */
  empty?: string;
};

export type WidgetPomodoro = {
  cardId: string;
  phase: "focus" | "short" | "long";
  endsAt: number | null;
  leftMs: number;
  /** Running or paused mid-phase (not waiting at the start of a phase). */
  active?: boolean;
  taskName?: string | null;
};

export type WidgetInput = {
  now: Date;
  data: DashboardData;
  today?: TodayResponse | null;
  workingHours?: WorkingHours | null;
  focusSessions?: FocusSessionLike[];
  pomodoros?: WidgetPomodoro[];
  timeZone?: string;
  scheme: string;
  /** Full sheets and docs that sheet and doc cards read, by id (lib/widgets/data.ts loads them). */
  files?: { sheets?: Record<string, Sheet | undefined>; docs?: Record<string, WidgetDoc | undefined> };
};

export type WidgetDoc = { id: string; title?: string; content?: unknown; archivedAt?: string | null };

function link(scheme: string, path: string) {
  return `${scheme}://${path}`;
}

/** "3:05 PM" in the working-hours zone. */
export function timeLabel(iso: string, timeZone?: string) {
  const date = new Date(iso);
  try {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
  }
}

function untilLabel(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `in ${hours}h ${rest}m` : `in ${hours}h`;
}

function clockText(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** A length as the phone draws it while it waits: 25:00, 90:00 (RNWidgetLocal's {{key:clock}}). */
function minutesText(minutes: number) {
  return `${minutes}:00`;
}

function percent(share: number) {
  return Math.round(Math.min(1, Math.max(0, share)) * 100);
}

const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

function weekdayLetter(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** The Today widget (and the Today card). */
export function todayModel(input: WidgetInput, title = "Today"): WidgetModel {
  const { today, now, scheme, timeZone } = input;
  const uri = link(scheme, "today");
  if (!today) return { title, uri, empty: "Open Timely to load today." };
  const done = new Set(today.completedToday.map((task) => task.id));
  const planned = new Set<string>(done);
  for (const item of today.items) {
    if ((item.kind === "task" || item.kind === "taskOccurrence") && item.taskId && !item.reminder) planned.add(item.taskId);
  }
  for (const task of today.todayFocus) planned.add(task.id);
  const focusing = today.focusing ?? today.pausedFocus;
  const rows: WidgetRow[] = [];
  if (focusing) {
    rows.push({
      title: focusing.name,
      meta: today.focusing ? "Focusing" : "Paused",
      tone: today.focusing ? "accent" : "muted",
      uri: link(scheme, `tasks/${focusing.id}`),
    });
  }
  const upNext = today.items
    .filter((item) => new Date(item.end).getTime() >= now.getTime() && !calendarItemDone(item))
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 6);
  for (const item of upNext) {
    const live = new Date(item.start).getTime() <= now.getTime();
    rows.push({
      title: item.title,
      meta: item.allDay ? "All day" : live ? "Now" : timeLabel(item.start, timeZone),
      tone: live ? "accent" : "default",
      color: item.color ?? undefined,
      uri: item.taskId ? link(scheme, `tasks/${item.taskId}`) : item.eventId ? link(scheme, `events/${item.eventId}`) : uri,
      ...(item.taskId && (item.kind === "task" || item.kind === "taskOccurrence")
        ? {
            done: false,
            toggle: {
              kind: "task" as const,
              taskId: item.taskId,
              done: true,
              ...(item.kind === "taskOccurrence" && item.originalStart ? { originalStart: item.originalStart } : {}),
            },
          }
        : {}),
    });
  }
  return {
    title,
    uri,
    value: `${done.size}/${planned.size}`,
    caption: today.overdue.length ? `${today.overdue.length} overdue` : planned.size ? "done today" : "Nothing planned yet",
    captionTone: today.overdue.length ? "danger" : "muted",
    rows,
    empty: rows.length ? undefined : "Nothing else on the calendar today.",
  };
}

/** A table widget lists at most this many rows (a widget list is drawn up front, not as it scrolls). */
const TABLE_ROWS = 100;

function sheetModel(pick: SheetPick, input: WidgetInput, title: string, cardId: string): WidgetModel {
  const uri = link(input.scheme, `sheets/${pick.sheetId}`);
  const sheet = input.files?.sheets?.[pick.sheetId];
  const result = computeSheetCard(sheet, pick);
  switch (result.kind) {
    case "missing":
      return { title, uri, empty: result.message };
    case "value":
      return { title, uri, value: result.text || "–", caption: result.label ?? pick.range, captionTone: "muted" };
    case "counter": {
      // A formula cell can't count; the widget then just shows it.
      const locked = !result.cell || Boolean(result.cell.formula);
      return {
        title,
        uri,
        value: result.text,
        caption: locked ? "This cell is a formula, so it can't count" : (result.label ?? `Saves into ${sheet?.title || "the sheet"}`),
        captionTone: "muted",
        buttons: locked
          ? undefined
          : [
              { label: `Take away ${result.step}`, glyph: "minus", action: { kind: "counter", cardId, by: -result.step } },
              { label: `Add ${result.step}`, glyph: "plus", action: { kind: "counter", cardId, by: result.step } },
            ],
      };
    }
    case "progress":
      return {
        title,
        uri,
        ring: { value: result.value, target: result.target, label: `${result.valueText} of ${result.targetText}` },
      };
    case "table": {
      // Every row and column: rows that don't fit scroll inside the widget.
      const rows = result.rows
        .filter((cells) => cells.some((cell) => cell.text.trim()))
        .slice(0, TABLE_ROWS)
        .map((cells) => ({ title: cells[0]?.text ?? "", cells: cells.slice(1).map((cell) => cell.text) }));
      return {
        title,
        uri,
        rows,
        columns: result.headers ?? undefined,
        scroll: true,
        empty: rows.length ? undefined : "No rows yet.",
      };
    }
    case "chart": {
      const points = result.series[0]?.points ?? [];
      if (result.view === "pie") {
        const total = points.reduce((sum, point) => sum + Math.max(0, point.value), 0) || 1;
        return {
          title,
          uri,
          meters: points.slice(0, 5).map((point) => ({ label: point.label, value: Math.max(0, point.value) / total, detail: point.text })),
          empty: points.length ? undefined : "No numbers in the picked cells.",
        };
      }
      return {
        title,
        uri,
        value: points.length ? points[points.length - 1].text : undefined,
        caption: points.length ? points[points.length - 1].label : undefined,
        captionTone: "muted",
        line: result.view === "line",
        bars: points.slice(-8).map((point, index, all) => ({ label: point.label, value: point.value, highlight: index === all.length - 1 })),
        empty: points.length ? undefined : "No numbers in the picked cells.",
      };
    }
    case "addRow":
      return {
        title,
        uri,
        caption: `Adds a row to ${result.tabName}`,
        captionTone: "muted",
        buttons: [{ label: "Add a row", uri: link(input.scheme, "dashboard") }],
      };
  }
}

/**
 * How a counter's cell writes its number (a prefix such as $, grouping,
 * decimals), so the phone writes a count the way the sheet does: the figure
 * the phone redraws is `{{count:'$'#,##0.00;-'$'#,##0.00}}`, a DecimalFormat
 * pattern (RNWidgetLocal). Null for formats that change the number itself (a
 * percentage shows 0.5 as 50%): that counter keeps asking the app per tap.
 */
export type CounterFormat = { prefix: string; suffix: string; grouping: boolean; minDecimals: number; maxDecimals: number };

export function counterFormat(column: SheetColumn | undefined): CounterFormat | null {
  const parts = (n: number) => /^([^\d-]*)(\d[\d,]*)(?:\.(\d+))?([^\d]*)$/.exec(formatLike(n, column));
  const long = parts(1234.5678);
  const whole = parts(1234);
  if (!long || !whole || long[1] !== whole[1] || long[4] !== whole[4] || /[{}]/.test(long[1] + long[4])) return null;
  const shown = Number(`${long[2].replace(/,/g, "")}.${long[3] ?? "0"}`);
  if (Math.abs(shown - 1234.5678) > 0.5 || whole[2].replace(/,/g, "") !== "1234") return null;
  const maxDecimals = long[3]?.length ?? 0;
  return { prefix: long[1], suffix: long[4], grouping: long[2].includes(","), minDecimals: Math.min(maxDecimals, whole[3]?.length ?? 0), maxDecimals };
}

/** The DecimalFormat pattern the phone writes a count with: -$2.00, as the sheet writes it. */
export function counterPattern(format: CounterFormat) {
  const decimals = format.maxDecimals ? `.${"0".repeat(format.minDecimals)}${"#".repeat(format.maxDecimals - format.minDecimals)}` : "";
  const quote = (text: string) => (text ? `'${text.replace(/'/g, "''")}'` : "");
  const number = `${quote(format.prefix)}${format.grouping ? "#,##0" : "0"}${decimals}${quote(format.suffix)}`;
  return `${number};-${number}`;
}

const roundCount = (n: number) => Math.round(n * 1e6) / 1e6;

/** A count as the phone writes it (the same as `counterPattern` in DecimalFormat). */
export function formatCount(n: number, format: CounterFormat) {
  const value = roundCount(n || 0);
  const text = Math.abs(value).toLocaleString("en-US", {
    useGrouping: format.grouping,
    minimumFractionDigits: format.minDecimals,
    maximumFractionDigits: format.maxDecimals,
  });
  return `${value < 0 ? "-" : ""}${format.prefix}${text}${format.suffix}`;
}

/**
 * A sheet counter as its widget counts it: −/+ change `count` on the phone
 * alone; Save, or Timely's next redraw of the widget, adds count − base to
 * the cell in one save (lib/widgets/counter.ts).
 */
export type CounterLocal = { count: number; base: number };

export type CounterWidget = {
  cardId: string;
  title: string;
  uri: string;
  /** The line under the figure while nothing waits to be saved. */
  caption: string;
  step: number;
  format: CounterFormat;
  /** The cell's own text for `base`, drawn while nothing waits to be saved. */
  baseText?: string;
  local: CounterLocal;
};

/** Whether a counter has taps waiting to be saved. */
export const counterChanged = ({ count, base }: CounterLocal) => Math.abs(count - base) >= 1e-9;

/** A sheet counter's widget; `changed` picks the drawing (the phone keeps one of each). */
export function counterWidgetModel(widget: CounterWidget, changed = counterChanged(widget.local)): WidgetModel {
  const { cardId, title, uri, step, format, local } = widget;
  const value = !changed && widget.baseText ? widget.baseText : formatCount(local.count, format);
  // Sized for a hundred taps either way, so a redraw on the phone isn't cut off.
  const fit = [value, formatCount(local.count + 100 * step, format), formatCount(local.count - 100 * step, format)].reduce((a, b) => (b.length > a.length ? b : a));
  return {
    title,
    uri,
    value,
    valueText: `{{count:${counterPattern(format)}}}`,
    valueFit: fit,
    caption: changed ? "Not saved yet" : widget.caption,
    captionTone: changed ? "accent" : "muted",
    buttons: [
      { label: `Take away ${step}`, glyph: "minus", local: { step: "count", by: -step } },
      ...(changed ? [{ label: "Save", glyph: "save" as const, action: { kind: "counterSave" as const, cardId } }] : []),
      { label: `Add ${step}`, glyph: "plus", local: { step: "count", by: step } },
    ],
  };
}

/**
 * A sheet card's counter, ready to count on the phone: its widget (without
 * the count yet), the cell's number and which cell it is. Null when it can't
 * count there (missing, a formula, or a format like a percentage).
 */
export function sheetCounter(
  pick: SheetPick,
  input: WidgetInput,
  title: string,
  cardId: string,
): { widget: Omit<CounterWidget, "local">; value: number; cell: string } | null {
  const sheet = input.files?.sheets?.[pick.sheetId];
  const result = computeSheetCard(sheet, pick);
  if (result.kind !== "counter" || !result.cell || result.cell.formula) return null;
  const format = counterFormat(result.cell.column);
  if (!format) return null;
  return {
    widget: {
      cardId,
      title,
      uri: link(input.scheme, `sheets/${pick.sheetId}`),
      caption: result.label ?? `Saves into ${sheet?.title || "the sheet"}`,
      step: result.step,
      format,
      baseText: result.text,
    },
    value: result.value,
    cell: counterCell(pick, result.cell),
  };
}

/** Which cell a counter counts in: taps saved for one cell never land in another. */
export const counterCell = (pick: SheetPick, cell: { rowId: string; colId: string }) => `${pick.sheetId}/${pick.tabId ?? ""}/${cell.rowId}/${cell.colId}`;

function docModel(pick: DocPick, input: WidgetInput, title: string, cardId: string): WidgetModel {
  const uri = link(input.scheme, `docs/${pick.docId}`);
  const doc = input.files?.docs?.[pick.docId];
  if (!doc || doc.archivedAt) return { title, uri, empty: "This doc was deleted or archived." };
  const content = doc.content as DocContent | undefined;
  if (pick.view === "checklist") {
    const { checks } = pickDocChecks(content, pick);
    const shown = pick.hideDone ? checks.filter((check) => !check.checked) : checks;
    return {
      title,
      uri,
      value: checks.length ? `${checks.filter((check) => check.checked).length}/${checks.length}` : undefined,
      rows: shown.slice(0, 8).map((check) => ({
        title: check.text,
        done: check.checked,
        uri,
        toggle: { kind: "docCheck" as const, cardId, index: check.index, checked: !check.checked },
      })),
      empty: shown.length ? undefined : checks.length ? "All done." : "No checkboxes in this doc.",
    };
  }
  const { blocks } = pickDocBlocks(content, pick, 40);
  const lines = blocks.flatMap((block) => {
    switch (block.kind) {
      case "heading":
      case "paragraph":
      case "quote":
      case "code":
        return block.text ? [block.text] : [];
      case "bullet":
        return [`${block.marker === "•" || !block.marker ? "•" : block.marker} ${block.text}`];
      case "check":
        return [`${block.checked ? "☑" : "☐"} ${block.text}`];
      default:
        return [];
    }
  });
  return { title, uri, note: lines.join("\n") || undefined, empty: lines.length ? undefined : "This doc is empty." };
}

const SOURCE_NOUN: Record<string, string> = {
  tasks: "tasks",
  projects: "projects",
  events: "events",
  docs: "docs",
  sheets: "sheets",
  reminders: "reminders",
  inbox: "in your Inbox",
};

function customModel(card: DashboardCard, input: WidgetInput, title: string): WidgetModel {
  const uri = link(input.scheme, "dashboard");
  if (!card.query) return { title, uri, empty: "This card has no query yet." };
  // Card workshop cards read picked sheet cells or a doc, not task lists.
  if (card.query.sheet) return sheetModel(card.query.sheet, input, title, card.id);
  if (card.query.doc) return docModel(card.query.doc, input, title, card.id);
  const result = computeCard(card.query, input.data, { now: input.now, timeZone: input.timeZone });
  switch (result.kind) {
    case "number": {
      const delta = result.previous !== undefined ? result.value - result.previous : null;
      return {
        title,
        uri,
        value: formatMetric(result.value, result.unit),
        caption:
          delta === null
            ? (result.periodLabel ?? SOURCE_NOUN[card.query.source])
            : `${delta >= 0 ? "▲" : "▼"} ${formatMetric(Math.abs(delta), result.unit)} ${result.periodLabel ?? ""}`.trim(),
        captionTone: delta === null ? "muted" : delta >= 0 ? "success" : "danger",
      };
    }
    case "list":
      return {
        title,
        uri,
        value: result.total > result.rows.length ? String(result.total) : undefined,
        rows: result.rows.slice(0, 8).map((row) => ({
          title: row.title,
          meta: row.meta,
          done: row.entity === "task" ? Boolean(row.done) : row.done,
          ...(row.entity === "task" ? { toggle: { kind: "task" as const, taskId: row.id, done: !row.done } } : {}),
          tone: row.tone === "danger" ? "danger" : row.tone === "success" ? "success" : row.tone === "muted" ? "muted" : "default",
          uri: link(input.scheme, row.entity === "task" ? `tasks/${row.id}` : row.entity === "project" ? `projects/${row.id}` : row.entity === "event" ? `events/${row.id}` : `files/${row.id}`),
        })),
        empty: result.rows.length ? undefined : "Nothing matches right now.",
      };
    case "series": {
      const points = result.temporal ? result.points.slice(-8) : result.points.slice(0, 6);
      return {
        title,
        uri,
        value: formatMetric(result.total, result.unit),
        caption: "total",
        captionTone: "muted",
        line: card.query.display === "line",
        bars: points.map((point, index) => ({
          label: point.label,
          value: point.value,
          highlight: result.temporal ? index === points.length - 1 : index === 0,
        })),
        empty: points.length ? undefined : "No data in this range.",
      };
    }
    case "progress":
      return {
        title,
        uri,
        ring: { value: result.value, target: result.target, label: `${formatMetric(result.value, result.unit)} of ${formatMetric(result.target, result.unit)}` },
      };
  }
}

const PHASE_LABEL = { focus: "Focus", short: "Short break", long: "Long break" } as const;
/** Tab labels short enough for three across a widget. */
const PHASE_TAB = { focus: "Focus", short: "Short", long: "Long" } as const;

/**
 * A pomodoro's phase and lengths as its widget keeps them. While the phase
 * waits to start, the tabs and −/+ change these on the phone alone (no app,
 * no server); Start hands them to the app (lib/widgets/local.ts).
 */
export type PomodoroLocal = { phase: PomodoroPhase; focus: number; short: number; long: number };

/** −/+ limits for each length, by phase (the same as a card's settings). */
export const POMODORO_LOCAL_LIMITS: Record<PomodoroPhase, [number, number]> = {
  focus: [1, POMODORO_PHASE_MAX.focus],
  short: [1, POMODORO_PHASE_MAX.short],
  long: [1, POMODORO_PHASE_MAX.long],
};

export function pomodoroLocalFrom(settings: Record<string, unknown> | undefined, phase: PomodoroPhase = "focus"): PomodoroLocal {
  const lengths = pomodoroSettings(settings);
  return { phase, focus: lengths.focus, short: lengths.shortBreak, long: lengths.longBreak };
}

/** Settings with the widget's own lengths in place of the card's. */
export function pomodoroLocalSettings(settings: Record<string, unknown> | undefined, local: PomodoroLocal): Record<string, unknown> {
  return { ...settings, focus: local.focus, shortBreak: local.short, longBreak: local.long };
}

export type PomodoroWidget = {
  /** The pomodoro store's key: a card id, or widget-ID for the Pomodoro widget. */
  cardId: string;
  title: string;
  uri: string;
  settings: Record<string, unknown> | undefined;
  now: number;
  pomodoros?: WidgetPomodoro[];
  /** The widget's own phase and lengths; without it −/+ change the card's settings. */
  local?: PomodoroLocal;
};

/** A pomodoro: a live countdown with Start, Pause, Skip and Reset right on the widget. */
export function pomodoroWidgetModel({ cardId, title, uri, settings: given, now, pomodoros, local }: PomodoroWidget): WidgetModel {
  const timer = (pomodoros ?? []).find((t) => t.cardId === cardId);
  const running = Boolean(timer && timer.endsAt !== null);
  const paused = Boolean(timer && !running && timer.active);
  const waiting = !running && !paused;
  // A waiting phase is the widget's to pick; once it runs, the timer's.
  const phase = waiting && local ? local.phase : (timer?.phase ?? "focus");
  const settings = pomodoroSettings(local ? pomodoroLocalSettings(given, local) : given);
  // A phase that hasn't started is as long as the card says (the widget may just have changed it).
  const left = running
    ? Math.max(0, (timer!.endsAt ?? 0) - now)
    : paused
      ? (timer?.leftMs ?? 0)
      : pomodoroRemaining({ ...initialPomodoro(), phase }, settings, now);
  const action = (op: "start" | "pause" | "skip" | "reset") => ({ kind: "pomodoro" as const, cardId, op });
  // As on the Dashboard: before a phase starts −/+ change its length, once it runs this round only.
  const length = settings[POMODORO_PHASE_SETTING[phase]];
  const canLower = waiting ? length > 1 : left > 60_000;
  const canRaise = waiting ? length < POMODORO_PHASE_MAX[phase] : left < POMODORO_MAX_MS;
  const phoneOnly = waiting && Boolean(local);
  const step = (by: number) => (phoneOnly ? { step: phase, by } : { kind: "pomodoroStep" as const, cardId, by });
  const task = timer?.taskName ? ` · ${timer.taskName}` : "";
  return {
    title,
    uri,
    // The phone redraws a waiting length as whole minutes (90:00), sized for the longest it allows.
    ...(phoneOnly
      ? { value: minutesText(length), valueText: `{{${phase}:clock}}`, valueFit: minutesText(POMODORO_PHASE_MAX[phase]) }
      : { value: clockText(left) }),
    // A waiting phase is plain text: the phone redraws it when −/+ change it.
    ...(phoneOnly ? {} : { timer: { base: running ? (timer!.endsAt ?? now) : now + left, countDown: true, running } }),
    caption: running ? `${PHASE_LABEL[phase]}${task}` : paused ? `Paused · ${PHASE_LABEL[phase]}` : `${PHASE_LABEL[phase]}${task}`,
    captionTone: running ? "accent" : "muted",
    tabs: (["focus", "short", "long"] as const).map((each) => ({
      label: PHASE_TAB[each],
      selected: each === phase,
      action: phoneOnly ? { set: "phase", value: each } : { kind: "pomodoroPhase" as const, cardId, phase: each },
    })),
    // The phone keeps a length within its limits itself, so both sides stay.
    stepper: phoneOnly
      ? { minus: step(-1), plus: step(1), unit: "a minute" }
      : { minus: canLower ? step(-1) : undefined, plus: canRaise ? step(1) : undefined, unit: "a minute" },
    buttons: running
      ? [
          { label: "Pause", glyph: "pause", action: action("pause") },
          { label: "Skip", glyph: "skip", action: action("skip") },
        ]
      : paused
        ? [
            { label: "Resume", glyph: "play", action: action("start") },
            { label: "Reset", glyph: "reset", action: action("reset") },
          ]
        : [
            // The tabs already say which phase; a short label stays on the button at 3x2.
            { label: phoneOnly ? "Start" : phase === "focus" ? "Start focus" : "Start break", glyph: "play", action: action("start") },
            // As on the Dashboard: a waiting phase can be skipped, so a break isn't the only way on.
            { label: "Skip", glyph: "skip", action: action("skip") },
          ],
  };
}

function pomodoroModel(card: DashboardCard, input: WidgetInput, title: string): WidgetModel {
  return pomodoroWidgetModel({
    cardId: card.id,
    title,
    uri: link(input.scheme, "dashboard"),
    settings: card.settings,
    now: input.now.getTime(),
    pomodoros: input.pomodoros,
  });
}

/** A Timer widget's mode and length while it's idle, changed on the phone alone. */
export type ClockLocal = { mode: ClockState["mode"]; minutes: number };

export const CLOCK_LOCAL_LIMITS = { minutes: [1, 600] as [number, number] };

const CLOCK_TAB = { stopwatch: "Stopwatch", timer: "Timer" } as const;

export type ClockWidget = {
  cardId: string;
  title: string;
  uri: string;
  state: ClockState;
  now: number;
  /** The widget's own mode and length: idle, tabs and −/+ change them on the phone. */
  local?: ClockLocal;
};

function clockIdle(state: ClockState) {
  return state.startedAt === null && state.elapsed === 0 && !state.done;
}

/** A stopwatch or timer, running on the widget. */
export function clockWidgetModel({ cardId, title: given, uri, state: saved, now, local }: ClockWidget): WidgetModel {
  const phoneOnly = Boolean(local) && clockIdle(saved);
  const state = phoneOnly ? { ...saved, ...local! } : saved;
  // The Timer widget names what it runs once the tabs make way for its buttons.
  const title = local && !phoneOnly ? CLOCK_TAB[state.mode] : given;
  const running = state.startedAt !== null;
  const action = (op: "start" | "pause" | "reset" | "lap") => ({ kind: "clock" as const, cardId, op });
  const tabs = phoneOnly
    ? (["stopwatch", "timer"] as const).map((mode) => ({ label: CLOCK_TAB[mode], selected: mode === state.mode, action: { set: "mode", value: mode } }))
    : undefined;
  if (phoneOnly && state.mode === "timer") {
    return {
      title,
      uri,
      value: minutesText(state.minutes),
      valueText: "{{minutes:clock}}",
      valueFit: minutesText(CLOCK_LOCAL_LIMITS.minutes[1]),
      caption: "Timer",
      captionTone: "muted",
      tabs,
      stepper: { minus: { step: "minutes", by: -1 }, plus: { step: "minutes", by: 1 }, unit: "a minute" },
      buttons: [{ label: "Start", glyph: "play", action: action("start") }],
    };
  }
  if (phoneOnly) {
    return { title, uri, value: clockText(0), caption: "Stopwatch", captionTone: "muted", tabs, buttons: [{ label: "Start", glyph: "play", action: action("start") }] };
  }
  if (state.mode === "timer") {
    const remaining = clockRemaining(state, now);
    const done = state.done || (running && remaining <= 0);
    if (done) {
      return {
        title,
        uri,
        value: "0:00",
        caption: "Time's up",
        captionTone: "accent",
        buttons: [
          { label: "Restart", glyph: "play", action: action("start") },
          { label: "Reset", glyph: "reset", action: action("reset") },
        ],
      };
    }
    const started = running || state.elapsed > 0;
    return {
      title,
      uri,
      value: clockText(remaining),
      timer: { base: running ? (clockEndsAt(state) ?? now) : now + remaining, countDown: true, running },
      caption: running ? "Timer running" : started ? "Timer paused" : `${state.minutes} min timer`,
      captionTone: running ? "accent" : "muted",
      buttons: running
        ? [
            { label: "Pause", glyph: "pause", action: action("pause") },
            { label: "Reset", glyph: "reset", action: action("reset") },
          ]
        : started
          ? [
              { label: "Resume", glyph: "play", action: action("start") },
              { label: "Reset", glyph: "reset", action: action("reset") },
            ]
          : [{ label: "Start", glyph: "play", action: action("start") }],
    };
  }
  const elapsed = clockElapsed(state, now);
  const lastLap = state.laps[state.laps.length - 1];
  return {
    title,
    uri,
    value: clockText(elapsed),
    timer: { base: now - elapsed, countDown: false, running },
    caption: lastLap !== undefined ? `Lap ${state.laps.length} · ${clockText(lastLap)}` : running ? "Stopwatch running" : elapsed ? "Stopwatch paused" : "Stopwatch",
    captionTone: running ? "accent" : "muted",
    buttons: running
      ? [
          { label: "Pause", glyph: "pause", action: action("pause") },
          { label: "Lap", glyph: "lap", action: action("lap") },
        ]
      : elapsed
        ? [
            { label: "Resume", glyph: "play", action: action("start") },
            { label: "Reset", glyph: "reset", action: action("reset") },
          ]
        : [{ label: "Start", glyph: "play", action: action("start") }],
  };
}

/** A stopwatch or timer card, running on the widget. */
function clockModel(card: DashboardCard, input: WidgetInput, title: string): WidgetModel {
  return clockWidgetModel({ cardId: card.id, title, uri: link(input.scheme, "dashboard"), state: clockState(card.settings), now: input.now.getTime() });
}

/** One Dashboard card as a widget. */
export function cardWidgetModel(card: DashboardCard, input: WidgetInput): WidgetModel {
  const { now, scheme, data, timeZone } = input;
  const title = cardTitle(card);
  const day = todayInZone(timeZone, now);
  const dashboard = link(scheme, "dashboard");
  const settings = card.settings ?? {};
  const tasks = data.tasks ?? [];
  switch (card.type) {
    case "custom":
      return customModel(card, input, title);
    case "today":
      return todayModel(input, title);
    case "nextUp": {
      const info = nextUp(data.events ?? [], now, workdayWindow(input.workingHours, now), timeZone);
      const next = info.next && dateInZone(new Date(info.next.start), timeZone) === day ? info.next : null;
      const rows: WidgetRow[] = info.later.slice(0, 4).map((item) => ({ title: item.title, meta: timeLabel(item.start, timeZone), color: item.color ?? undefined }));
      return {
        title,
        uri: link(scheme, "calendar"),
        value: next ? untilLabel(new Date(next.start).getTime() - now.getTime()) : info.current ? "Now" : "Free",
        caption: next ? next.title : info.current ? `${info.current.title} until ${timeLabel(info.current.end, timeZone)}` : "Nothing else on the calendar today",
        captionTone: "default",
        rows: [
          ...(info.freeMinutes !== null ? [{ title: "Free time left", meta: formatMinutes(info.freeMinutes), tone: "muted" as const }] : []),
          ...rows,
        ],
      };
    }
    case "countdown": {
      const date = typeof settings.date === "string" ? settings.date : "";
      const label = typeof settings.label === "string" && settings.label.trim() ? settings.label.trim() : title;
      const days = date ? daysUntil(date, day) : null;
      if (days === null) return { title, uri: dashboard, empty: "Pick a date on the Dashboard." };
      return {
        title: label,
        uri: dashboard,
        value: days === 0 ? "Today" : String(Math.abs(days)),
        caption: days === 0 ? "It's the day" : days > 0 ? `day${days === 1 ? "" : "s"} to go` : `day${days === -1 ? "" : "s"} ago`,
        captionTone: "muted",
      };
    }
    case "streak": {
      const counts = completionsByDay(tasks, timeZone);
      const streak = completionStreak(counts, day);
      const days = Array.from({ length: 7 }, (_, i) => addDaysToDate(day, i - 6));
      return {
        title,
        uri: dashboard,
        value: `${streak.current}`,
        caption: `day streak · best ${streak.best}`,
        captionTone: "muted",
        bars: days.map((d) => ({ label: weekdayLetter(d), value: counts.get(d) ?? 0, highlight: d === day })),
      };
    }
    case "goal": {
      const goal = goalSettings(settings);
      if (goal.metric === "focus") {
        const summary = focusSummary(input.focusSessions ?? [], tasks, now, timeZone);
        const hours = Math.round((summary.today / 60) * 10) / 10;
        return { title, uri: dashboard, ring: { value: hours, target: goal.target, label: `${hours}h of ${goal.target}h focused` } };
      }
      const doneToday = completionsByDay(tasks, timeZone).get(day) ?? 0;
      return { title, uri: dashboard, ring: { value: doneToday, target: goal.target, label: `${doneToday} of ${goal.target} tasks` } };
    }
    case "dayProgress": {
      const share = timeProgress(now, workdayWindow(input.workingHours, now), timeZone);
      return {
        title,
        uri: dashboard,
        caption: share.dayLabel,
        captionTone: "muted",
        meters: [
          { label: "Day", value: share.day, detail: `${percent(share.day)}%` },
          { label: "Week", value: share.week, detail: `${percent(share.week)}%` },
          { label: "Month", value: share.month, detail: `${percent(share.month)}%` },
          { label: "Year", value: share.year, detail: `${percent(share.year)}%` },
        ],
      };
    }
    case "inboxZero": {
      // Oldest first, with their age: the ones that have waited longest come up first.
      const inbox = (data.inbox ?? [])
        .filter((task) => !task.completedAt)
        .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
      const age = (task: (typeof inbox)[number]) => (task.createdAt ? Math.max(0, -(daysUntil(task.createdAt.slice(0, 10), day) ?? 0)) : null);
      const oldest = inbox[0] ? age(inbox[0]) : null;
      return {
        title,
        uri: link(scheme, "inbox"),
        value: String(inbox.length),
        caption:
          inbox.length === 0
            ? "Inbox zero"
            : oldest === null
              ? "waiting"
              : oldest === 0
                ? "waiting, all from today"
                : `waiting, oldest ${oldest} day${oldest === 1 ? "" : "s"}`,
        captionTone: inbox.length === 0 ? "success" : "muted",
        rows: inbox.slice(0, 8).map((task) => {
          const days = age(task);
          return { title: task.name, meta: days ? `${days}d` : undefined, tone: "muted" as const, uri: link(scheme, `tasks/${task.id}`) };
        }),
        buttons: [{ label: "Capture", uri: link(scheme, "shortcut/capture"), glyph: "inbox" }],
      };
    }
    case "topThree": {
      const picks = topThreePicks(settings, day);
      const byId = new Map(tasks.map((task) => [task.id, task]));
      const rows = picks
        .map((id) => byId.get(id))
        .filter((task): task is NonNullable<typeof task> => Boolean(task))
        .map((task) => ({
          title: task.name,
          done: Boolean(task.completedAt),
          uri: link(scheme, `tasks/${task.id}`),
          toggle: { kind: "task" as const, taskId: task.id, done: !task.completedAt },
        }));
      return {
        title,
        uri: dashboard,
        value: rows.length ? `${rows.filter((row) => row.done).length}/${rows.length}` : undefined,
        rows,
        empty: rows.length ? undefined : "Pick today's three on the Dashboard.",
      };
    }
    case "focusTime": {
      const summary = focusSummary(input.focusSessions ?? [], tasks, now, timeZone);
      return {
        title,
        uri: dashboard,
        value: formatMinutes(summary.today),
        caption: `today · ${formatMinutes(summary.week)} this week`,
        captionTone: "muted",
        bars: summary.days.map((entry) => ({ label: weekdayLetter(entry.day), value: entry.minutes, highlight: entry.day === day })),
      };
    }
    case "habits": {
      const habits = habitList(settings);
      const log = habitLog(settings);
      return {
        title,
        uri: dashboard,
        value: habits.length ? `${habits.filter((habit) => log[day]?.includes(habit.id)).length}/${habits.length}` : undefined,
        rows: habits.slice(0, 6).map((habit) => {
          const streak = habitStreak(log, habit.id, day);
          return {
            title: habit.name,
            done: Boolean(log[day]?.includes(habit.id)),
            meta: streak ? `${streak}🔥` : undefined,
            toggle: { kind: "habit" as const, cardId: card.id, habitId: habit.id },
          };
        }),
        empty: habits.length ? undefined : "Add habits on the Dashboard.",
      };
    }
    case "matrix": {
      const urgentDays = typeof settings.urgentDays === "number" ? settings.urgentDays : 3;
      const matrix = priorityMatrix(tasks, day, urgentDays);
      const order: MatrixQuadrant[] = ["do", "schedule", "quick", "later"];
      return {
        title,
        uri: dashboard,
        rows: order.map((quadrant) => ({
          title: MATRIX_LABELS[quadrant].title,
          meta: String(matrix[quadrant].length),
          tone: quadrant === "do" && matrix.do.length ? "danger" : "default",
        })),
      };
    }
    case "weeklyReview": {
      const review = weeklyReview(tasks, day, 0, timeZone);
      return {
        title,
        uri: dashboard,
        value: String(review.done.length),
        caption: "finished this week",
        captionTone: "muted",
        rows: [
          { title: "Slipped", meta: String(review.slipped.length), tone: review.slipped.length ? "danger" : "muted" },
          { title: "Carried over", meta: String(review.carried.length), tone: "muted" },
        ],
      };
    }
    case "quickCapture": {
      // Newest first: what was just captured, filling a tall widget's middle.
      const inbox = (data.inbox ?? [])
        .filter((task) => !task.completedAt)
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      return {
        title,
        uri: link(scheme, "shortcut/capture"),
        caption: `${inbox.length} in your Inbox`,
        captionTone: "muted",
        rows: inbox.slice(0, 8).map((task) => ({ title: task.name, tone: "muted" as const, uri: link(scheme, `tasks/${task.id}`) })),
        buttons: [
          { label: "Capture", uri: link(scheme, "shortcut/capture"), glyph: "inbox" },
          { label: "New task", uri: link(scheme, "shortcut/new-task"), glyph: "plus" },
        ],
      };
    }
    case "notes": {
      const text = typeof settings.text === "string" ? settings.text.trim() : "";
      return { title, uri: dashboard, note: text || undefined, empty: text ? undefined : "Your scratchpad is empty." };
    }
    case "journal":
      return {
        title,
        uri: dashboard,
        note: journalPrompt(day),
        buttons: [{ label: settings.day === day && settings.savedDocId ? "Saved today" : "Write", uri: dashboard }],
      };
    case "pomodoro":
      return pomodoroModel(card, input, title);
    case "clock":
      return clockModel(card, input, title);
    case "highlights":
      return { title, uri: dashboard, note: "This week's highlights, blockers and tips are on your Dashboard.", buttons: [{ label: "Open", uri: dashboard }] };
    default:
      return { title: builtinInfo(card.type)?.title ?? title, uri: dashboard, empty: "Open the Dashboard to see this card." };
  }
}

/** Every card on the board as a pick list for the widget settings screen. */
export function widgetChoices(cards: DashboardCard[]) {
  return cards.map((card) => ({
    id: card.id,
    title: cardTitle(card),
    kind: card.type === "custom" ? "Your card" : (builtinInfo(card.type)?.title ?? "Card"),
    custom: card.type === "custom",
  }));
}
