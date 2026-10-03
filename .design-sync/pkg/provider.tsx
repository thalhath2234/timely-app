"use client";

import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { MotionConfig, MotionGlobalConfig } from "motion/react";
import { useLayoutEffect, useState, type CSSProperties, type ReactNode } from "react";
import { installMockApi, type TimelyMockApi } from "./mockApi";
import { sampleApi } from "./sample";

export type TimelyProviderProps = {
  children?: ReactNode;
  /** Colour scheme for everything inside. "dark" applies the app's `.dark` token set. Default "light". */
  theme?: "light" | "dark";
  /**
   * Query-cache seed: `[queryKey, data]` pairs, so data-bound components (task
   * tables, calendars, settings panels) render with this data instead of
   * fetching it. Scoped to this provider (each has its own query cache), e.g.
   * `seed={[[["tasks"], []]]}` for an empty task list.
   */
  seed?: ReadonlyArray<readonly [QueryKey, unknown]>;
  /**
   * Built-in sample workspace (tasks, projects, calendar, docs, sheets, chats,
   * settings) answered by an in-browser mock of the Timely API, so data-bound
   * components render populated. Default true. false = no sample routes.
   */
  sampleData?: boolean;
  /**
   * false = every animation jumps straight to its end state: motion entrance
   * fades/springs/layout moves are skipped, and the page reports
   * `prefers-reduced-motion: reduce`, which makes the landing scenes show their
   * finished frame. Use for static screenshots. Default true.
   */
  animations?: boolean;
  /**
   * Extra or overriding mock API routes, merged over the sample routes. See
   * TimelyMockApi. Page-global: `fetch` is shared, so the last-mounted provider's
   * routes answer every component on the page. For one region's data (e.g. an
   * empty list next to a full one) use `seed`, which is per provider.
   */
  api?: TimelyMockApi;
  className?: string;
  style?: CSSProperties;
};

/**
 * Root wrapper for every Timely component. Supplies what the app's
 * `providers.tsx` + `<html>` supply in production: the React Query client the
 * data hooks read, motion defaults, the light/dark token scope, the Inter font
 * and the page background/foreground colours - plus a mock of the Timely API
 * serving a sample workspace (see `sampleData` / `api`). Queries never refetch.
 */
let reducedMotionForced = false;
function forceReducedMotion() {
  if (reducedMotionForced || typeof window === "undefined") return;
  reducedMotionForced = true;
  const real = window.matchMedia.bind(window);
  window.matchMedia = (query: string) => {
    const result = real(query);
    if (!/prefers-reduced-motion:\s*reduce/.test(query)) return result;
    return new Proxy(result, {
      get: (target, key) => {
        if (key === "matches") return true;
        const value = Reflect.get(target, key, target);
        // MediaQueryList methods throw "Illegal invocation" unless called on the real object.
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
}

export function TimelyProvider({ children, theme = "light", seed, sampleData = true, animations = true, api, className, style }: TimelyProviderProps) {
  const [client] = useState(() => {
    // Global switch read by every motion component; set before children mount.
    MotionGlobalConfig.skipAnimations = !animations;
    if (!animations) forceReducedMotion();
    // Installed during this first render, before any child query fires.
    installMockApi({ ...(sampleData ? sampleApi() : {}), ...api });
    const qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false, refetchOnMount: false },
        mutations: { retry: false },
      },
    });
    for (const [key, data] of seed ?? []) qc.setQueryData(key, data);
    return qc;
  });

  // Dialogs, menus and popovers portal into document.body, outside the wrapper
  // div below, so the dark token scope also has to sit on <html> (as in the app).
  useLayoutEffect(() => {
    if (theme !== "dark") return;
    const root = document.documentElement;
    const had = root.classList.contains("dark");
    root.classList.add("dark");
    return () => { if (!had) root.classList.remove("dark"); };
  }, [theme]);

  return (
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="user">
        <div
          data-timely-root=""
          className={[theme === "dark" ? "dark" : "", "bg-background text-foreground font-sans antialiased", className]
            .filter(Boolean)
            .join(" ")}
          style={{ colorScheme: theme, ...style }}
        >
          {children}
        </div>
      </MotionConfig>
    </QueryClientProvider>
  );
}

export default TimelyProvider;
