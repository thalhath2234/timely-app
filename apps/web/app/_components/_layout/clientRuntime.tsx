"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { getConfig, updateAppearanceConfig } from "@/app/utils/api/worksapce";
import {
  ACCENT_STORAGE_KEY,
  applyDocumentAppearance,
  isAccentPreference,
  isThemePreference,
  readStoredAccent,
  readStoredSidebarAutoHide,
  readStoredTheme,
  SIDEBAR_AUTO_HIDE_STORAGE_KEY,
  THEME_STORAGE_KEY,
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
};

const PreferencesContext = createContext<Preferences>({
  theme: "system",
  setTheme: () => undefined,
  accent: "default",
  setAccent: () => undefined,
  sidebarAutoHide: false,
  setSidebarAutoHide: () => undefined,
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

export default function ClientRuntime({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [online, setOnline] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [theme, setThemeState] = useState<ThemePreference>("system");
  const [accent, setAccentState] = useState<AccentPreference>("default");
  const [sidebarAutoHide, setSidebarAutoHideState] = useState(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipPersist = useRef(true);
  const accountReady = useRef(false);

  useEffect(() => {
    const nextTheme = readStoredTheme();
    const nextAccent = readStoredAccent();
    setThemeState(nextTheme);
    setAccentState(nextAccent);
    setSidebarAutoHideState(readStoredSidebarAutoHide());
    applyDocumentAppearance(nextTheme, nextAccent);
    setHydrated(true);
  }, []);

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
          setThemeState(localTheme);
          setAccentState(localAccent);
          void updateAppearanceConfig({ theme: localTheme, accent: localAccent }).catch(() => undefined);
          return;
        }
        skipPersist.current = true;
        setThemeState(remote.theme);
        setAccentState(remote.accent);
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
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    localStorage.setItem(ACCENT_STORAGE_KEY, accent);
    return () => media.removeEventListener("change", apply);
  }, [theme, accent, hydrated]);

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
    if (!hydrated) return;
    localStorage.setItem(SIDEBAR_AUTO_HIDE_STORAGE_KEY, sidebarAutoHide ? "true" : "false");
  }, [sidebarAutoHide, hydrated]);

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
    setTheme: (next: ThemePreference) => setThemeState(next),
    accent,
    setAccent: (next: AccentPreference) => setAccentState(next),
    sidebarAutoHide,
    setSidebarAutoHide: (next: boolean) => setSidebarAutoHideState(next),
  }), [theme, accent, sidebarAutoHide]);

  return (
    <PreferencesContext.Provider value={value}>
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
    </PreferencesContext.Provider>
  );
}
