"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { Config, Task } from "@/app/_types/types";
import { updateReportDashboard } from "@/app/utils/api/worksapce";
import { getTasks } from "@/app/utils/api/tasks";
import { useCalendarRange, useToday } from "@/app/utils/hooks/calendar";
import { useDocs } from "@/app/utils/hooks/docs";
import { useProjects } from "@/app/utils/hooks/projects";
import { useSheets } from "@/app/utils/hooks/sheets";
import { useInboxTasks, useTasks } from "@/app/utils/hooks/tasks";
import { useConfig, useWorkingHoursZone, useWorkspaces } from "@/app/utils/hooks/workspaces";
import { useToastStore } from "@/app/_store/toastStore";

const SAVE_DELAY_MS = 700;

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * The account's Report layout, edited locally and saved to the server a
 * moment after the last change. Edits show at once; the saved copy in the
 * config cache catches up when the save returns.
 */
export function useDashboardLayout() {
  const configQuery = useConfig();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<DashboardLayout | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const revision = useRef(0);
  const pending = useRef<DashboardLayout | null>(null);
  const timer = useRef<number | null>(null);

  const saved = useMemo(
    () => (configQuery.data ? normalizeDashboard(configQuery.data.reportDashboard) : null),
    [configQuery.data],
  );
  const layout = draft ?? saved;

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    const sentRevision = revision.current;
    setSaveState("saving");
    try {
      const config = await updateReportDashboard(next);
      queryClient.setQueryData<Config>(["config"], config);
      // Nothing newer was typed while this save ran: the server copy is current.
      if (revision.current === sentRevision) {
        setDraft(null);
        setSaveState("saved");
      }
    } catch (error) {
      setSaveState("error");
      useToastStore.getState().show(error instanceof Error ? error.message : "Could not save the dashboard");
    }
  }, [queryClient]);

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
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  // Leaving the page (or the app) still saves the last change.
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
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
    error: configQuery.isError ? configQuery.error : null,
    retry: () => configQuery.refetch(),
    update,
    updateCard,
    saveState,
  };
}

const remindersKey = ["tasks", "reminders"] as const;

/** Day-aligned window so the calendar query key stays stable across renders. */
function eventsWindow(timeZone?: string) {
  const today = todayInZone(timeZone);
  return {
    from: new Date(`${addDaysToDate(today, -180)}T00:00:00`),
    to: new Date(`${addDaysToDate(today, 181)}T00:00:00`),
  };
}

/**
 * Loads what the cards on the board read, and only that: a board with no
 * event cards never asks for the calendar.
 */
export function useDashboardData(cards: DashboardCard[], extra: DashboardCard[] = []) {
  const used = useMemo(() => sourcesUsed([...cards, ...extra]), [cards, extra]);
  const timeZone = useWorkingHoursZone();
  const span = useMemo(() => eventsWindow(timeZone), [timeZone]);

  const tasks = useTasks();
  const projects = useProjects();
  const workspaces = useWorkspaces();
  const docs = useDocs();
  const sheets = useSheets();
  const inbox = useInboxTasks();
  const reminders = useQuery({
    queryKey: remindersKey,
    queryFn: () => getTasks({ reminders: true }),
    enabled: used.has("reminders"),
  });
  const events = useCalendarRange(span.from, span.to, used.has("events"));
  const today = useToday();

  const data: DashboardData = useMemo(
    () => ({
      tasks: (tasks.data ?? []) as Task[],
      projects: projects.data ?? [],
      workspaces: workspaces.data ?? [],
      docs: docs.data ?? [],
      sheets: sheets.data ?? [],
      inbox: (inbox.data ?? []) as Task[],
      reminders: (reminders.data ?? []) as Task[],
      events: events.data?.items ?? [],
    }),
    [tasks.data, projects.data, workspaces.data, docs.data, sheets.data, inbox.data, reminders.data, events.data],
  );

  const failures = [
    { what: "tasks", query: tasks },
    { what: "projects", query: projects },
    { what: "workspaces", query: workspaces },
    used.has("docs") && { what: "docs", query: docs },
    used.has("sheets") && { what: "sheets", query: sheets },
    used.has("inbox") && { what: "inbox", query: inbox },
    used.has("reminders") && { what: "reminders", query: reminders },
    used.has("events") && { what: "calendar events", query: events },
  ].filter((entry): entry is { what: string; query: typeof tasks } => Boolean(entry) && Boolean(entry && entry.query.isError));

  const loading = {
    tasks: tasks.isLoading,
    projects: projects.isLoading,
    events: events.isLoading && used.has("events"),
    docs: docs.isLoading,
    sheets: sheets.isLoading,
    inbox: inbox.isLoading,
    reminders: reminders.isLoading && used.has("reminders"),
  };

  return { data, today, failures, loading, timeZone };
}
