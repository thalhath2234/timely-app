"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useMutation } from "@tanstack/react-query";
import type {
  DesktopAction,
  DesktopActionResult,
  DesktopInstance,
  DesktopSettingKey,
  TimelyDesktop,
} from "@/electron-env";

export type DesktopBridge = NonNullable<TimelyDesktop["instance"]>;

function readBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.timelyDesktop?.instance ?? null;
}

const noopSubscribe = () => () => {};

/** The desktop bridge, or null in a browser / during server rendering. The
 * bridge is injected before any script runs, so it never changes after load;
 * the server snapshot is always null so the first client render matches. */
export function useDesktopBridge(): DesktopBridge | null {
  return useSyncExternalStore(noopSubscribe, readBridge, () => null);
}

export type DesktopInstanceState = {
  instance: DesktopInstance | null;
  loading: boolean;
  error: string | null;
};

// One shared snapshot so every component sees the same instance and a
// setSetting() answer reaches all of them, not just the caller.
const serverState: DesktopInstanceState = { instance: null, loading: true, error: null };
let state: DesktopInstanceState = serverState;
const listeners = new Set<() => void>();
let unsubscribeBridge: (() => void) | null = null;

function publish(next: Partial<DesktopInstanceState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : "The desktop app did not answer.";
}

function start(bridge: DesktopBridge) {
  if (unsubscribeBridge) return;
  unsubscribeBridge = bridge.subscribe((instance) => {
    publish({ instance, loading: false, error: null });
  });
  void bridge
    .get()
    .then((instance) => publish({ instance, loading: false, error: null }))
    .catch((err) => publish({ loading: false, error: errorText(err) }));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reads the desktop instance once and follows every change the main process
 * pushes. Outside the desktop app it settles to `{instance: null, loading: false}`. */
export function useDesktopInstance(): DesktopInstanceState & { refresh: () => Promise<void> } {
  const bridge = useDesktopBridge();
  const snapshot = useSyncExternalStore(subscribe, () => state, () => serverState);

  useEffect(() => {
    if (bridge) start(bridge);
  }, [bridge]);

  const refresh = useCallback(async () => {
    if (!bridge) return;
    try {
      const instance = await bridge.get();
      publish({ instance, loading: false, error: null });
    } catch (err) {
      publish({ loading: false, error: errorText(err) });
    }
  }, [bridge]);

  if (!bridge) {
    return { instance: null, loading: false, error: null, refresh };
  }
  return { ...snapshot, refresh };
}

/** Runs a desktop action. `pending` names the action in flight; `result` is
 * the last answer, for a live region. */
export function useDesktopAction() {
  const bridge = useDesktopBridge();
  const mutation = useMutation({
    mutationFn: async (name: DesktopAction): Promise<DesktopActionResult> => {
      if (!bridge) return { ok: false, error: "Only available in the desktop app." };
      return bridge.action(name);
    },
  });
  const result: DesktopActionResult | null = mutation.error
    ? { ok: false, error: errorText(mutation.error) }
    : (mutation.data ?? null);
  return {
    run: mutation.mutateAsync,
    pending: mutation.isPending ? mutation.variables : null,
    result,
    reset: mutation.reset,
  };
}

/** Changes one desktop setting. The main process answers with the new
 * instance, which is pushed to every `useDesktopInstance()` at once. */
export function useDesktopSetting() {
  const bridge = useDesktopBridge();
  const mutation = useMutation({
    mutationFn: async ({ key, value }: { key: DesktopSettingKey; value: boolean }) => {
      if (!bridge) throw new Error("Only available in the desktop app.");
      const instance = await bridge.setSetting(key, value);
      publish({ instance, loading: false, error: null });
      return instance;
    },
  });
  return {
    set: (key: DesktopSettingKey, value: boolean) => mutation.mutateAsync({ key, value }),
    pending: mutation.isPending ? mutation.variables.key : null,
    error: mutation.error ? errorText(mutation.error) : null,
    reset: mutation.reset,
  };
}
