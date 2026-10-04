"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { motion, MotionConfig } from "motion/react";
import { getConfig, updateAppearanceConfig } from "@/app/utils/api/worksapce";
import { useClientGate } from "@/app/_components/_ui/motion";
import {
  applyDocumentAppearance,
  applyDocumentReducedMotion,
  isAccentPreference,
  isThemePreference,
  readStoredAccent,
  readStoredReducedMotion,
  readStoredSidebarAutoHide,
  readStoredTheme,
  subscribeStoredAppearance,
  writeStoredAccent,
  writeStoredReducedMotion,
  writeStoredSidebarAutoHide,
  writeStoredTheme,
  type AccentPreference,
  type ThemePreference,
} from "@/app/utils/theme";

export type { AccentPreference, ThemePreference };

type Preferences = {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  accent: AccentPreference;
  setAccent: (accent: AccentPreference) => void;
  sidebarAutoHide: boolean;
  setSidebarAutoHide: (hide: boolean) => void;
  reducedMotion: boolean;
  setReducedMotion: (reduce: boolean) => void;
};

const PreferencesContext = createContext<Preferences>({
  theme: "system",
  setTheme: () => undefined,
  accent: "default",
  setAccent: () => undefined,
  sidebarAutoHide: false,
  setSidebarAutoHide: () => undefined,
  reducedMotion: true,
  setReducedMotion: () => undefined,
});

export function usePreferences() { return useContext(PreferencesContext); }

function appearanceFromConfig(value: { theme?: string; accent?: string } | undefined): {
  theme: ThemePreference;
  accent: AccentPreference;
} {
  const rawTheme = value?.theme ?? null;
  const rawAccent = value?.accent ?? null;
  return {
    theme: isThemePreference(rawTheme) ? rawTheme : "system",
    accent: isAccentPreference(rawAccent) ? rawAccent : "default",
  };
}

const serverTheme = (): ThemePreference => "system";
const serverAccent = (): AccentPreference => "default";
const serverSidebarAutoHide = () => false;
const serverReducedMotion = () => true;

export default function ClientRuntime({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [online, setOnline] = useState(true);
  // Server render and hydration use the defaults; the client snapshot from
  // localStorage takes over right after hydration without a state update.
  const hydrated = useClientGate();
  const theme = useSyncExternalStore(subscribeStoredAppearance, readStoredTheme, serverTheme);
  const accent = useSyncExternalStore(subscribeStoredAppearance, readStoredAccent, serverAccent);
  const sidebarAutoHide = useSyncExternalStore(
    subscribeStoredAppearance,
    readStoredSidebarAutoHide,
    serverSidebarAutoHide,
  );
  const reducedMotion = useSyncExternalStore(
    subscribeStoredAppearance,
    readStoredReducedMotion,
    serverReducedMotion,
  );
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipPersist = useRef(true);
  const accountReady = useRef(false);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void getConfig()
      .then((config) => {
        if (cancelled) return;
        const remote = appearanceFromConfig(config.appearance);
        const localTheme = readStoredTheme();
        const localAccent = readStoredAccent();
        const serverIsDefault = remote.theme === "system" && remote.accent === "default";
        const localDiffers = localTheme !== "system" || localAccent !== "default";
        if (serverIsDefault && localDiffers) {
          skipPersist.current = false;
          accountReady.current = true;
          writeStoredTheme(localTheme);
          writeStoredAccent(localAccent);
          void updateAppearanceConfig({ theme: localTheme, accent: localAccent }).catch(() => undefined);
          return;
        }
        skipPersist.current = true;
        writeStoredTheme(remote.theme);
        writeStoredAccent(remote.accent);
        accountReady.current = true;
        queueMicrotask(() => {
          skipPersist.current = false;
        });
      })
      .catch(() => {
        skipPersist.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyDocumentAppearance(theme, accent);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme, accent, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    applyDocumentReducedMotion(reducedMotion);
  }, [reducedMotion, hydrated]);

  useEffect(() => {
    if (!hydrated || skipPersist.current || !accountReady.current) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void updateAppearanceConfig({ theme, accent }).catch(() => undefined);
    }, 250);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [theme, accent, hydrated]);

  useEffect(() => {
    const update = () => {
      const next = navigator.onLine;
      onlineManager.setOnline(next);
      setOnline(next);
      if (next) void queryClient.invalidateQueries();
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [queryClient]);

  const value = useMemo(() => ({
    theme,
    setTheme: writeStoredTheme,
    accent,
    setAccent: writeStoredAccent,
    sidebarAutoHide,
    setSidebarAutoHide: writeStoredSidebarAutoHide,
    reducedMotion,
    setReducedMotion: writeStoredReducedMotion,
  }), [theme, accent, sidebarAutoHide, reducedMotion]);

  return (
    <PreferencesContext.Provider value={value}>
      <MotionConfig reducedMotion={reducedMotion ? "always" : "user"}>
        {!online ? (
          <motion.div
            role="status"
            aria-live="polite"
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="fixed inset-x-0 top-0 z-[100] bg-warning px-3 py-1.5 text-center text-xs font-medium text-black shadow"
          >
            Offline · showing saved data, which may be out of date
          </motion.div>
        ) : null}
        {children}
      </MotionConfig>
    </PreferencesContext.Provider>
  );
}
