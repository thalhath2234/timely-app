import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { hasTimelyAndroid, isLiveActivityRunning } from "../modules/timely-android";
import { redrawLiveActivity, refreshLiveActivity } from "../lib/live/liveActivity";
import { usePomodoroStore } from "../lib/pomodoroStore";
import { useScheduleActivity } from "../lib/scheduleActivity";
import { registerBackgroundRefresh } from "../lib/background/register";

/**
 * Keeps Android's outside-the-app surfaces in step with the app: the live
 * notification (Assistant runs, focus, pomodoros, Auto-schedule) and the home
 * screen widgets. Mounted once inside the signed-in layout; renders nothing.
 */

const LIVE_KEYS = new Set(["chats", "today", "tasks", "chat"]);
const WIDGET_KEYS = new Set(["tasks", "today", "config", "projects", "docs", "sheets", "calendar", "focus-sessions", "workspaces"]);
const FOREGROUND_TICK_MS = 20_000;
const WIDGET_DELAY_MS = 4_000;

export default function AndroidBridges() {
  const client = useQueryClient();

  useEffect(() => {
    if (Platform.OS !== "android" || !hasTimelyAndroid()) return;
    void refreshLiveActivity({ force: true });
    void registerBackgroundRefresh();

    // A run started on the desktop shows up here within one tick; while the
    // service runs, its own task keeps the notification fresh.
    const tick = setInterval(() => {
      if (AppState.currentState === "active" && !isLiveActivityRunning()) void refreshLiveActivity();
    }, FOREGROUND_TICK_MS);

    const stopPomodoro = usePomodoroStore.subscribe((state, previous) => {
      if (state.timers !== previous.timers) redrawLiveActivity();
    });
    const stopSchedule = useScheduleActivity.subscribe((state, previous) => {
      if (state.status !== previous.status) redrawLiveActivity();
    });

    let liveTimer: ReturnType<typeof setTimeout> | null = null;
    let widgetTimer: ReturnType<typeof setTimeout> | null = null;
    const redrawWidgets = () => {
      // Loaded on first use so the widget renderer stays out of startup.
      const { refreshAllWidgets } = require("../lib/widgets/taskHandler") as typeof import("../lib/widgets/taskHandler");
      void refreshAllWidgets();
    };
    const stopCache = client.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      const head = String(event.query.queryKey[0] ?? "");
      if (LIVE_KEYS.has(head)) {
        if (liveTimer) clearTimeout(liveTimer);
        liveTimer = setTimeout(() => void refreshLiveActivity(), 800);
      }
      if (WIDGET_KEYS.has(head)) {
        if (widgetTimer) clearTimeout(widgetTimer);
        widgetTimer = setTimeout(redrawWidgets, WIDGET_DELAY_MS);
      }
    });

    // Leaving the app is when the home screen shows again: draw fresh widgets.
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        if (widgetTimer) clearTimeout(widgetTimer);
        redrawWidgets();
        void refreshLiveActivity({ force: true });
      }
    });

    return () => {
      clearInterval(tick);
      stopPomodoro();
      stopSchedule();
      stopCache();
      appState.remove();
      if (liveTimer) clearTimeout(liveTimer);
      if (widgetTimer) clearTimeout(widgetTimer);
    };
  }, [client]);

  return null;
}
