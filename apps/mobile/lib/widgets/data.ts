import Constants from "expo-constants";
import { describedSources, normalizeDashboard, sourcesUsed, weekStart, type DashboardCard, type DashboardData } from "@timely/contract/dashboard";
import { addDaysToDate, todayInZone } from "@timely/contract/workStatus";
import { getToken } from "../auth/session";
import { getDoc, getDocs } from "../api/docs";
import { getProjects } from "../api/projects";
import { getCalendarRange, getToday } from "../api/schedule";
import { getSheet, getSheets } from "../api/sheets";
import { getFocusSessions, getTasks } from "../api/tasks";
import { getConfig, getWorkspaces } from "../api/workspaces";
import { pomodoroTimeLeft, usePomodoroStore } from "../pomodoroStore";
import type { Sheet } from "@timely/contract/sheet";
import type { WidgetDoc, WidgetInput, WidgetPomodoro } from "./model";
import { sharedLoads } from "./sharedLoads";

/**
 * Loads what a widget's card reads, straight from the API (widgets redraw in
 * a headless task, without the app's query cache). Each source fails on its
 * own, so one slow endpoint never blanks the widget, and widgets drawn
 * together share each request (sharedLoads).
 */

export function appScheme() {
  const value = Constants.expoConfig?.scheme;
  return (Array.isArray(value) ? value[0] : value) || "timelymobile";
}

const { shared, forget } = sharedLoads();

/** Drops the shared requests, so the next draw reads fresh data (something changed). */
export const forgetWidgetLoads = forget;

export async function signedIn() {
  try {
    return Boolean(await getToken());
  } catch {
    return false;
  }
}

/** The account's Dashboard cards, or null when signed out or offline. */
export async function loadCards(): Promise<{ cards: DashboardCard[]; config: Awaited<ReturnType<typeof getConfig>> } | null> {
  if (!(await signedIn())) return null;
  const config = await shared("config", getConfig);
  if (!config) return null;
  return { cards: normalizeDashboard(config.reportDashboard).cards, config };
}

/** Every pomodoro on the device, including ones waiting at the start of a phase. */
export function widgetPomodoros(now: number): WidgetPomodoro[] {
  // A phase that ended while JS was asleep moves on before it's drawn.
  usePomodoroStore.getState().tick(now);
  return Object.values(usePomodoroStore.getState().timers).map((timer) => ({
    cardId: timer.cardId,
    phase: timer.phase,
    endsAt: timer.endsAt,
    leftMs: pomodoroTimeLeft(timer, now),
    active: timer.endsAt !== null || timer.remaining !== null,
    taskName: timer.taskName ?? null,
  }));
}

export async function loadWidgetInput(cards: DashboardCard[], options: { today?: boolean } = {}): Promise<WidgetInput | null> {
  const board = await loadCards();
  if (!board) return null;
  const timeZone = board.config.workingHours?.timezone || undefined;
  const now = new Date();
  const day = todayInZone(timeZone, now);
  const used = sourcesUsed(cards);
  const custom = cards.some((card) => card.type === "custom");
  const wantsToday = options.today || used.has("today");
  const wantsFocus = cards.some((card) => card.type === "focusTime" || card.type === "goal");
  const wantsTasks = used.has("tasks") || wantsFocus;
  // A described card's program can read any range of events ("next7", "thisWeek"), so it
  // gets the Dashboard's window; other cards only need yesterday to tomorrow.
  const wideEvents = cards.some((card) => card.query?.described && describedSources(card.query.described.program).includes("events"));
  const [eventsFrom, eventsTo] = wideEvents ? [-180, 181] : [-1, 2];

  const [tasks, projects, workspaces, docs, sheets, inbox, reminders, events, today, focusSessions] = await Promise.all([
    wantsTasks ? shared("tasks", () => getTasks()) : undefined,
    used.has("projects") || custom ? shared("projects", getProjects) : undefined,
    custom ? shared("workspaces", getWorkspaces) : undefined,
    used.has("docs") ? shared("docs", getDocs) : undefined,
    used.has("sheets") ? shared("sheets", getSheets) : undefined,
    used.has("inbox") || cards.some((card) => card.type === "quickCapture") ? shared("inbox", () => getTasks({ inbox: true })) : undefined,
    used.has("reminders") ? shared("reminders", () => getTasks({ reminders: true })) : undefined,
    used.has("events")
      ? shared(`events:${day}:${eventsFrom}`, () =>
          getCalendarRange(new Date(`${addDaysToDate(day, eventsFrom)}T00:00:00`), new Date(`${addDaysToDate(day, eventsTo)}T00:00:00`)),
        )
      : undefined,
    wantsToday ? shared("today", getToday) : undefined,
    wantsFocus
      ? shared(`focus:${day}`, () => getFocusSessions(new Date(`${addDaysToDate(weekStart(day), -1)}T00:00:00`), new Date(`${addDaysToDate(day, 1)}T00:00:00`)))
      : undefined,
  ]);

  // Card workshop cards read whole sheets and docs (picked cells, sections).
  const sheetIds = [...new Set(cards.flatMap((card) => (card.query?.sheet ? [card.query.sheet.sheetId] : [])))];
  const docIds = [...new Set(cards.flatMap((card) => (card.query?.doc ? [card.query.doc.docId] : [])))];
  const [sheetFiles, docFiles] = await Promise.all([
    Promise.all(sheetIds.map(async (id) => [id, (await shared(`sheet:${id}`, () => getSheet(id))) as unknown as Sheet | undefined] as const)),
    Promise.all(docIds.map(async (id) => [id, (await shared(`doc:${id}`, () => getDoc(id))) as WidgetDoc | undefined] as const)),
  ]);

  const data: DashboardData = {
    tasks: tasks ?? [],
    projects: projects ?? [],
    workspaces: workspaces ?? [],
    docs: docs ?? [],
    sheets: sheets ?? [],
    inbox: inbox ?? [],
    reminders: reminders ?? [],
    events: events?.items ?? [],
  };

  const pomodoros = widgetPomodoros(now.getTime());

  return {
    now,
    data,
    today: today ?? null,
    workingHours: board.config.workingHours,
    focusSessions: focusSessions ?? [],
    pomodoros,
    timeZone,
    scheme: appScheme(),
    files: { sheets: Object.fromEntries(sheetFiles), docs: Object.fromEntries(docFiles) },
  };
}
