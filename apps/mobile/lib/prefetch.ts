import type { QueryClient } from "@tanstack/react-query";
import {
  goalSettings,
  normalizeDashboard,
  sourcesUsed,
} from "@timely/contract/dashboard";
import { dateInZone } from "@timely/contract/workStatus";
import { getDocs } from "./api/docs";
import { getProjects } from "./api/projects";
import { getSheets } from "./api/sheets";
import { getCalendarRange, getToday } from "./api/schedule";
import { getFocusSessions, getTasks } from "./api/tasks";
import { getConfig, getWorkspaces } from "./api/workspaces";
import { eventsWindow, weekFocusRange } from "./dashboard";
import { keys } from "./hooks";

/** Prefetched data no open screen reads yet stays cached until its tab is opened. */
const PREFETCH_GC_MS = 30 * 60_000;

/**
 * Warms the data used by the initial Today screen before navigation settles.
 * Adjacent tab data starts at the same time, but never extends startup time.
 */
export async function prefetchStartupData(client: QueryClient) {
  const initialScreen = Promise.all([
    client.prefetchQuery({ queryKey: ["today"], queryFn: () => getToday() }),
    client.prefetchQuery({ queryKey: ["tasks"], queryFn: () => getTasks() }),
    client.prefetchQuery({ queryKey: ["config"], queryFn: getConfig }),
  ]);

  void Promise.all([
    client.prefetchQuery({
      queryKey: ["workspaces"],
      queryFn: getWorkspaces,
      gcTime: PREFETCH_GC_MS,
    }),
    client.prefetchQuery({
      queryKey: ["projects"],
      queryFn: getProjects,
      gcTime: PREFETCH_GC_MS,
    }),
    client.prefetchQuery({
      queryKey: ["docs"],
      queryFn: getDocs,
      gcTime: PREFETCH_GC_MS,
    }),
    client.prefetchQuery({
      queryKey: ["sheets"],
      queryFn: getSheets,
      gcTime: PREFETCH_GC_MS,
    }),
    prefetchDashboardData(client),
  ]);

  await initialScreen;
}

/**
 * Warms what the Dashboard's saved cards read beyond the shared lists above
 * (inbox, reminders, calendar events, this week's focus), with the same query
 * keys the cards use, so the tab opens with its cards filled in. Highlights
 * are left to the card: they cost a model call and read all of this data.
 */
async function prefetchDashboardData(client: QueryClient) {
  const config = await client
    .ensureQueryData({ queryKey: keys.config, queryFn: getConfig })
    .catch(() => null);
  if (!config) return;
  const cards = normalizeDashboard(config.reportDashboard).cards;
  const used = sourcesUsed(cards);
  const timeZone = config.workingHours?.timezone || undefined;
  const jobs: Promise<void>[] = [
    client.prefetchQuery({
      queryKey: keys.inbox,
      queryFn: () => getTasks({ inbox: true }),
      gcTime: PREFETCH_GC_MS,
    }),
  ];
  if (used.has("reminders")) {
    jobs.push(
      client.prefetchQuery({
        queryKey: [...keys.tasks, "reminders"],
        queryFn: () => getTasks({ reminders: true }),
        gcTime: PREFETCH_GC_MS,
      }),
    );
  }
  if (used.has("events")) {
    const span = eventsWindow(timeZone);
    jobs.push(
      client.prefetchQuery({
        queryKey: keys.calendar(span.from.toISOString(), span.to.toISOString()),
        queryFn: () => getCalendarRange(span.from, span.to),
        gcTime: PREFETCH_GC_MS,
      }),
    );
  }
  if (
    cards.some(
      (card) =>
        card.type === "focusTime" ||
        (card.type === "goal" &&
          goalSettings(card.settings).metric === "focus"),
    )
  ) {
    const range = weekFocusRange(dateInZone(new Date(), timeZone));
    jobs.push(
      client.prefetchQuery({
        queryKey: [
          ...keys.focusSessions,
          range.from.toISOString(),
          range.to.toISOString(),
        ],
        queryFn: () => getFocusSessions(range.from, range.to),
        gcTime: PREFETCH_GC_MS,
      }),
    );
  }
  await Promise.all(jobs);
}
