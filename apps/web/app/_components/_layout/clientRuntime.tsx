"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onlineManager, useQueryClient } from "@tanstack/react-query";

export type ThemePreference = "light" | "dark" | "system";

const PreferencesContext = createContext<{
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
}>({ theme: "system", setTheme: () => undefined });

export function usePreferences() { return useContext(PreferencesContext); }

export default function ClientRuntime({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [online, setOnline] = useState(true);
  const [theme, setThemeState] = useState<ThemePreference>(() => {
    if (typeof window === "undefined") return "system";
    const saved = localStorage.getItem("timely.theme");
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    localStorage.setItem("timely.theme", theme);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

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
  }), [theme]);

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
