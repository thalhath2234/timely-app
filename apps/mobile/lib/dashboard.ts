import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  defaultDashboard,
  normalizeDashboard,
  sourcesUsed,
  type DashboardCard,
  type DashboardData,
  type DashboardLayout,
} from "@timely/contract/dashboard";
import { addDaysToDate, todayInZone } from "@timely/contract/workStatus";
import { getTasks } from "./api/tasks";
import { updateConfig } from "./api/workspaces";
import {
  keys,
  useCalendarQuery,
  useConfigQuery,
  useDocsQuery,
  useInboxQuery,
  useProjectsQuery,
  useSheetsQuery,
  useTasksQuery,
  useTodayQuery,
  useWorkingHoursZone,
  useWorkspacesQuery,
} from "./hooks";
import { useToastStore } from "./toast";
import { getThemeMode } from "./theme";

const SAVE_DELAY_MS = 700;

/**
 * The account's Dashboard layout (the same one web and desktop edit), changed
 * locally and saved to the server a moment after the last change.
 */
export function useDashboardLayout() {
  const configQuery = useConfigQuery();
  const client = useQueryClient();
  const [draft, setDraft] = useState<DashboardLayout | null>(null);
  const revision = useRef(0);
  const pending = useRef<DashboardLayout | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saved = useMemo(
    () => (configQuery.data ? normalizeDashboard(configQuery.data.reportDashboard) : null),
    [configQuery.data],
  );
  const layout = draft ?? saved;

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    const sentRevision = revision.current;
    try {
      const config = await updateConfig({ reportDashboard: next });
      client.setQueryData(keys.config, config);
      if (revision.current === sentRevision) setDraft(null);
    } catch (error) {
      useToastStore.getState().show(error instanceof Error ? error.message : "Could not save the dashboard");
    }
  }, [client]);

  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  const update = useCallback(
    (change: (current: DashboardLayout) => DashboardLayout) => {
      const base = layoutRef.current ?? defaultDashboard();
      const next = change(base);
      if (next === base) return;
      layoutRef.current = next;
      revision.current += 1;
      pending.current = next;
      setDraft(next);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  // Leaving the screen or backgrounding the app still saves the last change.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") void flush();
    });
    return () => {
      subscription.remove();
      void flush();
    };
  }, [flush]);

  const updateCard = useCallback(
    (id: string, change: Partial<DashboardCard> | ((card: DashboardCard) => DashboardCard)) =>
      update((current) => ({
        ...current,
        cards: current.cards.map((card) =>
          card.id === id ? (typeof change === "function" ? change(card) : { ...card, ...change }) : card,
        ),
      })),
    [update],
  );

  return {
    layout,
    isLoading: configQuery.isLoading,
    isError: configQuery.isError,
    retry: () => configQuery.refetch(),
    update,
    updateCard,
  };
}

/** Day-aligned window so the calendar query key stays stable across renders. */
function eventsWindow(timeZone?: string) {
  const today = todayInZone(timeZone);
  return {
    from: new Date(`${addDaysToDate(today, -180)}T00:00:00`),
    to: new Date(`${addDaysToDate(today, 181)}T00:00:00`),
  };
}

/** Loads what the cards on the board read; a board with no event cards never asks for the calendar. */
export function useDashboardData(cards: DashboardCard[]) {
  const used = useMemo(() => sourcesUsed(cards), [cards]);
  const timeZone = useWorkingHoursZone();
  const span = useMemo(() => eventsWindow(timeZone), [timeZone]);

  const tasks = useTasksQuery();
  const projects = useProjectsQuery();
  const workspaces = useWorkspacesQuery();
  const docs = useDocsQuery();
  const sheets = useSheetsQuery();
  const inbox = useInboxQuery();
  const reminders = useQuery({
    queryKey: [...keys.tasks, "reminders"],
    queryFn: () => getTasks({ reminders: true }),
    enabled: used.has("reminders"),
  });
  const events = useCalendarQuery(span.from, span.to, used.has("events"));
  const today = useTodayQuery();

  const data: DashboardData = useMemo(
    () => ({
      tasks: tasks.data ?? [],
      projects: projects.data ?? [],
      workspaces: workspaces.data ?? [],
      docs: docs.data ?? [],
      sheets: sheets.data ?? [],
      inbox: inbox.data ?? [],
      reminders: reminders.data ?? [],
      events: events.data?.items ?? [],
    }),
    [tasks.data, projects.data, workspaces.data, docs.data, sheets.data, inbox.data, reminders.data, events.data],
  );

  const failures = [
    tasks.isError && "tasks",
    projects.isError && "projects",
    used.has("docs") && docs.isError && "docs",
    used.has("sheets") && sheets.isError && "sheets",
    used.has("inbox") && inbox.isError && "inbox",
    used.has("reminders") && reminders.isError && "reminders",
    used.has("events") && events.isError && "calendar events",
  ].filter((entry): entry is string => Boolean(entry));

  return { data, today, failures, loading: tasks.isLoading, timeZone };
}

/** A clock for cards that read the time. */
export function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/* Chart colours: the same validated palette as web, per theme. */

const SERIES_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const SERIES_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const HEAT_LIGHT = ["#ececf3", "#b7d3f6", "#86b6ef", "#3987e5", "#1c5cab"];
const HEAT_DARK = ["#23252d", "#184f95", "#256abf", "#3987e5", "#86b6ef"];

export function seriesColor(index: number, other = false) {
  const dark = getThemeMode() === "dark";
  if (other || index >= 8 || index < 0) return dark ? "#6b6a66" : "#a3a29c";
  return (dark ? SERIES_DARK : SERIES_LIGHT)[index];
}

export function heatColor(level: number) {
  return (getThemeMode() === "dark" ? HEAT_DARK : HEAT_LIGHT)[Math.max(0, Math.min(4, level))];
}

export function chartGridColor() {
  return getThemeMode() === "dark" ? "rgba(255,255,255,0.07)" : "#e4e5ea";
}
