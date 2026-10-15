import Constants from "expo-constants";
import { normalizeDashboard, sourcesUsed, weekStart, type DashboardCard, type DashboardData } from "@timely/contract/dashboard";
import { addDaysToDate, todayInZone } from "@timely/contract/workStatus";
import { getToken } from "../auth/session";
import { getDoc, getDocs } from "../api/docs";
import { getProjects } from "../api/projects";
import { getCalendarRange, getToday } from "../api/schedule";
import { getSheet, getSheets } from "../api/sheets";
import { getFocusSessions, getTasks } from "../api/tasks";
import { getConfig, getWorkspaces } from "../api/workspaces";
import { pomodoroTimeLeft, selectActivePomodoros, usePomodoroStore } from "../pomodoroStore";
import type { Sheet } from "@timely/contract/sheet";
import type { WidgetDoc, WidgetInput } from "./model";

/**
 * Loads what a widget's card reads, straight from the API (widgets redraw in
 * a headless task, without the app's query cache). Each source fails on its
 * own, so one slow endpoint never blanks the widget.
 */

export function appScheme() {
  const value = Constants.expoConfig?.scheme;
  return (Array.isArray(value) ? value[0] : value) || "timelymobile";
}

const quiet = <T,>(promise: Promise<T>): Promise<T | undefined> => promise.catch(() => undefined);

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
  const config = await quiet(getConfig());
  if (!config) return null;
  return { cards: normalizeDashboard(config.reportDashboard).cards, config };
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

  const [tasks, projects, workspaces, docs, sheets, inbox, reminders, events, today, focusSessions] = await Promise.all([
    wantsTasks ? quiet(getTasks()) : undefined,
    used.has("projects") || custom ? quiet(getProjects()) : undefined,
    custom ? quiet(getWorkspaces()) : undefined,
    used.has("docs") ? quiet(getDocs()) : undefined,
    used.has("sheets") ? quiet(getSheets()) : undefined,
    used.has("inbox") || cards.some((card) => card.type === "quickCapture") ? quiet(getTasks({ inbox: true })) : undefined,
    used.has("reminders") ? quiet(getTasks({ reminders: true })) : undefined,
    used.has("events")
      ? quiet(getCalendarRange(new Date(`${addDaysToDate(day, -1)}T00:00:00`), new Date(`${addDaysToDate(day, 2)}T00:00:00`)))
      : undefined,
    wantsToday ? quiet(getToday()) : undefined,
    wantsFocus
      ? quiet(getFocusSessions(new Date(`${addDaysToDate(weekStart(day), -1)}T00:00:00`), new Date(`${addDaysToDate(day, 1)}T00:00:00`)))
      : undefined,
  ]);

  // Card workshop cards read whole sheets and docs (picked cells, sections).
  const sheetIds = [...new Set(cards.flatMap((card) => (card.query?.sheet ? [card.query.sheet.sheetId] : [])))];
  const docIds = [...new Set(cards.flatMap((card) => (card.query?.doc ? [card.query.doc.docId] : [])))];
  const [sheetFiles, docFiles] = await Promise.all([
    Promise.all(sheetIds.map(async (id) => [id, (await quiet(getSheet(id))) as unknown as Sheet | undefined] as const)),
    Promise.all(docIds.map(async (id) => [id, (await quiet(getDoc(id))) as WidgetDoc | undefined] as const)),
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

  const pomodoros = selectActivePomodoros(usePomodoroStore.getState()).map((timer) => ({
    cardId: timer.cardId,
    phase: timer.phase,
    endsAt: timer.endsAt,
    leftMs: pomodoroTimeLeft(timer, now.getTime()),
    taskName: timer.taskName ?? null,
  }));

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
