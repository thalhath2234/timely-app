"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import {
  ACCENT_STORAGE_KEY,
  applyDocumentAppearance,
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

export default function ClientRuntime({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [online, setOnline] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [theme, setThemeState] = useState<ThemePreference>("system");
  const [accent, setAccentState] = useState<AccentPreference>("default");
  const [sidebarAutoHide, setSidebarAutoHideState] = useState(false);

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
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyDocumentAppearance(theme, accent);
    apply();
    media.addEventListener("change", apply);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    localStorage.setItem(ACCENT_STORAGE_KEY, accent);
    return () => media.removeEventListener("change", apply);
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
        <div role="status" aria-live="polite" className="fixed inset-x-0 top-0 z-[100] bg-warning px-3 py-1.5 text-center text-xs font-medium text-black shadow">
          Offline · showing saved data, which may be out of date
        </div>
      ) : null}
      {children}
    </PreferencesContext.Provider>
  );
}
