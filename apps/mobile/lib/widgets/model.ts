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
  journalPrompt,
  MATRIX_LABELS,
  nextUp,
  priorityMatrix,
  timeProgress,
  topThreePicks,
  weeklyReview,
  workdayWindow,
  type DashboardCard,
  type DashboardData,
  type FocusSessionLike,
  type MatrixQuadrant,
} from "@timely/contract/dashboard";
import {
  computeSheetCard,
  pickDocBlocks,
  pickDocChecks,
  type DocPick,
  type SheetPick,
} from "@timely/contract/dashboardFiles";
import type { DocContent } from "@timely/contract/documents";
import type { Sheet } from "@timely/contract/sheet";
import { calendarItemDone, type TodayResponse } from "@timely/contract/calendar";
import { addDaysToDate, dateInZone, todayInZone } from "@timely/contract/workStatus";
import type { WorkingHours } from "@timely/contract/schedule";

export type WidgetTone = "default" | "muted" | "accent" | "danger" | "success";

export type WidgetRow = { title: string; meta?: string; tone?: WidgetTone; done?: boolean; color?: string; uri?: string };

export type WidgetModel = {
  title: string;
  /** Where a tap on the widget goes (a timelymobile:// link). */
  uri: string;
  /** Large figure for stat-like cards. */
  value?: string;
  /** Line under (or beside) the figure. */
  caption?: string;
  captionTone?: WidgetTone;
  rows?: WidgetRow[];
  bars?: { label: string; value: number; highlight?: boolean }[];
  ring?: { value: number; target: number; label: string };
  meters?: { label: string; value: number; detail?: string }[];
  note?: string;
  buttons?: { label: string; uri: string }[];
  /** Shown when there's nothing to draw. */
  empty?: string;
};

export type WidgetPomodoro = { cardId: string; phase: "focus" | "short" | "long"; endsAt: number | null; leftMs: number; taskName?: string | null };

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

function sheetModel(pick: SheetPick, input: WidgetInput, title: string): WidgetModel {
  const uri = link(input.scheme, `sheets/${pick.sheetId}`);
  const sheet = input.files?.sheets?.[pick.sheetId];
  const result = computeSheetCard(sheet, pick);
  switch (result.kind) {
    case "missing":
      return { title, uri, empty: result.message };
    case "value":
      return { title, uri, value: result.text || "–", caption: result.label ?? pick.range, captionTone: "muted" };
    case "counter":
      return {
        title,
        uri,
        value: result.text,
        caption: result.label ?? "Counter",
        captionTone: "muted",
        buttons: [{ label: "Change", uri: link(input.scheme, "dashboard") }],
      };
    case "progress":
      return {
        title,
        uri,
        ring: { value: result.value, target: result.target, label: `${result.valueText} of ${result.targetText}` },
      };
    case "table":
      return {
        title,
        uri,
        rows: result.rows.slice(0, 8).map((cells) => {
          const [first, ...rest] = cells.filter((cell) => cell.text.trim());
          return { title: first?.text ?? "", meta: rest.slice(-1)[0]?.text };
        }),
        empty: result.rows.length ? undefined : "No rows yet.",
      };
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

function docModel(pick: DocPick, input: WidgetInput, title: string): WidgetModel {
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
      rows: shown.slice(0, 8).map((check) => ({ title: check.text, done: check.checked, uri })),
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
  if (card.query.sheet) return sheetModel(card.query.sheet, input, title);
  if (card.query.doc) return docModel(card.query.doc, input, title);
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
          done: row.done,
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
      const inbox = (data.inbox ?? []).filter((task) => !task.completedAt);
      const oldest = [...inbox].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))[0];
      return {
        title,
        uri: link(scheme, "inbox"),
        value: String(inbox.length),
        caption: inbox.length === 0 ? "Inbox zero" : oldest ? `Oldest: ${oldest.name}` : "waiting",
        captionTone: inbox.length === 0 ? "success" : "muted",
        buttons: [{ label: "Capture", uri: link(scheme, "shortcut/capture") }],
      };
    }
    case "topThree": {
      const picks = topThreePicks(settings, day);
      const byId = new Map(tasks.map((task) => [task.id, task]));
      const rows = picks
        .map((id) => byId.get(id))
        .filter((task): task is NonNullable<typeof task> => Boolean(task))
        .map((task) => ({ title: task.name, done: Boolean(task.completedAt), uri: link(scheme, `tasks/${task.id}`) }));
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
          return { title: habit.name, done: Boolean(log[day]?.includes(habit.id)), meta: streak ? `${streak}🔥` : undefined };
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
    case "quickCapture":
      return {
        title,
        uri: link(scheme, "shortcut/capture"),
        caption: `${(data.inbox ?? []).filter((task) => !task.completedAt).length} in your Inbox`,
        captionTone: "muted",
        buttons: [
          { label: "Capture", uri: link(scheme, "shortcut/capture") },
          { label: "New task", uri: link(scheme, "shortcut/new-task") },
        ],
      };
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
    case "pomodoro": {
      const timer = (input.pomodoros ?? []).find((t) => t.cardId === card.id);
      if (!timer) return { title, uri: dashboard, value: "Ready", caption: "Start a round on the Dashboard", captionTone: "muted" };
      const running = timer.endsAt !== null;
      const left = running ? Math.max(0, (timer.endsAt ?? 0) - now.getTime()) : timer.leftMs;
      const phase = timer.phase === "focus" ? "Focus" : timer.phase === "short" ? "Short break" : "Long break";
      return {
        title,
        uri: dashboard,
        value: running ? `ends ${timeLabel(new Date(timer.endsAt ?? 0).toISOString(), timeZone)}` : clockText(left),
        caption: running ? `${phase}${timer.taskName ? ` · ${timer.taskName}` : ""}` : `Paused · ${phase}`,
        captionTone: running ? "accent" : "muted",
      };
    }
    case "clock": {
      const state = clockState(settings);
      const ms = state.mode === "timer" ? clockRemaining(state, now.getTime()) : clockElapsed(state, now.getTime());
      return {
        title,
        uri: dashboard,
        value: clockText(ms),
        caption: state.startedAt ? (state.mode === "timer" ? "Timer running" : "Stopwatch running") : state.mode === "timer" ? "Timer" : "Stopwatch",
        captionTone: state.startedAt ? "accent" : "muted",
      };
    }
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
