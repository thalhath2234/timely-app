"use client";

import { useSyncExternalStore } from "react";

function subscribeMinute(listener: () => void) {
  const timer = window.setInterval(listener, 15_000);
  return () => window.clearInterval(timer);
}

/**
 * Minutes since the Unix epoch, refreshed every 15 seconds; null on the
 * server and during hydration, so time-dependent UI renders after mount.
 */
export function useNowMinute() {
  return useSyncExternalStore(
    subscribeMinute,
    () => Math.floor(Date.now() / 60_000),
    () => null,
  );
}

/** Local minutes since midnight. */
export function minuteOfDay(epochMinute: number) {
  const date = new Date(epochMinute * 60_000);
  return date.getHours() * 60 + date.getMinutes();
}

/** "HH:MM" for minutes since midnight, wrapping past 24:00. */
export function clock(minutes: number) {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  return `${String(hours).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/** ISO week number of a date. */
function isoWeek(date: Date) {
  const day = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return Math.ceil(
    ((day.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
}

/** "Sun 11 Oct · Week 41", the landing page's date line for today. */
export function dateLine(epochMinute: number) {
  const date = new Date(epochMinute * 60_000);
  const weekday = date.toLocaleDateString("en-GB", { weekday: "short" });
  const month = date.toLocaleDateString("en-GB", { month: "short" });
  return `${weekday} ${date.getDate()} ${month} · Week ${isoWeek(date)}`;
}
