"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { listNotifications } from "@/app/utils/api/notifications";
import type { AppNotification } from "@/app/_types/types";

/** Shown now: a Bot alert meant for the desktop that quiet hours no longer hold. */
function released(item: AppNotification, now: number): boolean {
  if (item.category !== "bot" || item.data?.desktop === false) return false;
  return !item.snoozedUntil || Date.parse(item.snoozedUntil) <= now;
}

/** Pops Bot alerts as native desktop notifications. Renders nothing. */
export default function BotAlertRuntime() {
  const router = useRouter();
  const desktop = typeof window !== "undefined" && !!window.timelyDesktop?.notifyAlert;
  const { data } = useQuery({
    queryKey: ["notifications", "bot-runtime"],
    queryFn: () => listNotifications(true),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    enabled: desktop,
  });
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const notify = window.timelyDesktop?.notifyAlert;
    if (!data || !notify) return;
    // The first poll only records what is already out; later polls pop the
    // rest, including alerts quiet hours held until now.
    const first = seen.current === null;
    const ids = seen.current ?? new Set<string>();
    seen.current = ids;
    const now = Date.now();
    for (const item of data) {
      if (!released(item, now) || ids.has(item.id)) continue;
      ids.add(item.id);
      if (!first) notify({ id: item.id, title: item.title, body: item.body });
    }
  }, [data]);
  useEffect(
    () => window.timelyDesktop?.onOpenAlert?.(() => router.push("/notifications")),
    [router],
  );
  return null;
}
