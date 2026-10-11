"use client";

import { create } from "zustand";
import { FILES_PATH, legacyFilePath } from "@/app/utils/fileRoutes";

/**
 * Open docs and sheets, Obsidian style. Each tab keeps its own back/forward
 * history of pathnames under /files; the URL always shows the active tab's
 * current entry. Saved per device in localStorage.
 */
export type PageTab = {
  id: string;
  history: string[];
  index: number;
  /** The tab that was active when this one opened in the background. */
  openerId?: string;
  /** Scroll of the page's main scroller, put back when the tab is reopened. */
  scroll?: { href: string; top: number; left: number };
};

export type PageTabsState = {
  hydrated: boolean;
  tabs: PageTab[];
  activeId: string | null;
  /** Tab ids, most recently active first. */
  recent: string[];
  hydrate: () => void;
  /** The active tab navigated to `href` (a link, the docs list, the browser). */
  visit: (href: string) => void;
  open: (href: string, options?: { activate?: boolean }) => PageTab;
  activate: (id: string) => PageTab | null;
  /** Closes a tab; returns the tab that is active afterwards. */
  close: (id: string) => PageTab | null;
  /** Moves the active tab through its history; returns the href to show. */
  go: (delta: -1 | 1) => string | null;
  reorder: (ids: string[]) => void;
  saveScroll: (id: string, scroll: NonNullable<PageTab["scroll"]>) => void;
  /** Drops background tabs whose page no longer exists. */
  prune: (exists: (href: string) => boolean) => void;
};

const STORAGE_KEY = "timely.pageTabs";
const MAX_TABS = 30;
const MAX_HISTORY = 50;

export function currentHref(tab: PageTab) {
  return tab.history[tab.index] ?? FILES_PATH;
}

export function isTabbedPath(pathname: string) {
  return /^\/files(\/|$)/.test(pathname);
}

/** The Files start page, shown as a new tab. */
export function isSectionIndex(pathname: string) {
  return pathname === FILES_PATH;
}

function newTab(href: string): PageTab {
  const id = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  return { id, history: [href], index: 0 };
}

function touch(recent: string[], id: string) {
  return [id, ...recent.filter((item) => item !== id)];
}

function isTab(value: unknown): value is PageTab {
  if (!value || typeof value !== "object") return false;
  const tab = value as PageTab;
  return (
    typeof tab.id === "string" &&
    Array.isArray(tab.history) &&
    tab.history.length > 0 &&
    tab.history.every((href) => typeof href === "string" && isTabbedPath(href)) &&
    Number.isInteger(tab.index) &&
    tab.index >= 0 &&
    tab.index < tab.history.length
  );
}

/**
 * Tabs saved before docs and sheets merged into Files hold /docs and /sheets
 * paths; point them at /files. Anything else passes through for isTab to judge.
 */
function migrateTab(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const tab = value as PageTab;
  if (!Array.isArray(tab.history)) return value;
  const moved = (href: unknown) => (typeof href === "string" ? legacyFilePath(href) ?? href : href);
  return {
    ...tab,
    history: tab.history.map(moved),
    scroll: tab.scroll ? { ...tab.scroll, href: moved(tab.scroll.href) } : tab.scroll,
  };
}

function load(): Pick<PageTabsState, "tabs" | "activeId" | "recent"> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { tabs: [], activeId: null, recent: [] };
    const parsed = JSON.parse(raw) as Partial<PageTabsState>;
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.map(migrateTab).filter(isTab).slice(0, MAX_TABS)
      : [];
    const ids = new Set(tabs.map((tab) => tab.id));
    const activeId = parsed.activeId && ids.has(parsed.activeId) ? parsed.activeId : tabs[0]?.id ?? null;
    const recent = Array.isArray(parsed.recent) ? parsed.recent.filter((id) => ids.has(id)) : [];
    return { tabs, activeId, recent };
  } catch {
    return { tabs: [], activeId: null, recent: [] };
  }
}

export const usePageTabsStore = create<PageTabsState>((set, get) => ({
  hydrated: false,
  tabs: [],
  activeId: null,
  recent: [],

  hydrate: () => {
    if (get().hydrated) return;
    set({ ...load(), hydrated: true });
  },

  visit: (href) => {
    const { tabs, activeId } = get();
    const active = tabs.find((tab) => tab.id === activeId);
    if (!active) {
      const tab = newTab(href);
      set({ tabs: [...tabs, tab], activeId: tab.id, recent: touch(get().recent, tab.id) });
      return;
    }
    if (currentHref(active) === href) return;
    const history = [...active.history.slice(0, active.index + 1), href].slice(-MAX_HISTORY);
    const next = { ...active, history, index: history.length - 1, scroll: undefined };
    set({ tabs: tabs.map((tab) => (tab.id === active.id ? next : tab)) });
  },

  open: (href, options = {}) => {
    const { tabs, activeId, recent } = get();
    const activate = options.activate ?? true;
    const tab = { ...newTab(href), openerId: activate ? undefined : activeId ?? undefined };
    // Like a browser, background tabs line up after the ones already opened
    // from the same tab, so a run of Ctrl-clicks keeps its order.
    let at = tabs.findIndex((item) => item.id === activeId);
    if (at < 0) at = tabs.length - 1;
    else while (tabs[at + 1]?.openerId && tabs[at + 1].openerId === activeId) at += 1;
    const nextTabs = [...tabs];
    nextTabs.splice(at + 1, 0, tab);
    // Past the cap, the least recently used background tab makes room.
    if (nextTabs.length > MAX_TABS) {
      const ids = new Set(nextTabs.map((item) => item.id));
      const oldest = [...recent].reverse().find((id) => id !== activeId && ids.has(id)) ?? nextTabs[0].id;
      nextTabs.splice(nextTabs.findIndex((item) => item.id === oldest), 1);
    }
    set({
      tabs: nextTabs,
      activeId: activate || !activeId ? tab.id : activeId,
      recent: activate || !activeId ? touch(recent, tab.id) : [...recent, tab.id],
    });
    return tab;
  },

  activate: (id) => {
    const tab = get().tabs.find((item) => item.id === id) ?? null;
    if (!tab || id === get().activeId) return tab;
    // Switching tabs ends the current run of background opens.
    const tabs = get().tabs.map((item) => (item.openerId ? { ...item, openerId: undefined } : item));
    set({ tabs, activeId: id, recent: touch(get().recent, id) });
    return tabs.find((item) => item.id === id) ?? null;
  },

  close: (id) => {
    const { tabs, activeId, recent } = get();
    const at = tabs.findIndex((tab) => tab.id === id);
    if (at < 0) return tabs.find((tab) => tab.id === activeId) ?? null;
    const nextTabs = tabs.filter((tab) => tab.id !== id);
    const nextRecent = recent.filter((item) => item !== id);
    if (id !== activeId) {
      set({ tabs: nextTabs, recent: nextRecent });
      return tabs.find((tab) => tab.id === activeId) ?? null;
    }
    // Like a browser: the neighbour to the right takes over, else the left one.
    const next = nextTabs[at] ?? nextTabs[at - 1] ?? null;
    set({
      tabs: nextTabs,
      activeId: next?.id ?? null,
      recent: next ? touch(nextRecent, next.id) : nextRecent,
    });
    return next;
  },

  go: (delta) => {
    const { tabs, activeId } = get();
    const active = tabs.find((tab) => tab.id === activeId);
    if (!active) return null;
    const index = active.index + delta;
    if (index < 0 || index >= active.history.length) return null;
    const next = { ...active, index, scroll: undefined };
    set({ tabs: tabs.map((tab) => (tab.id === active.id ? next : tab)) });
    return currentHref(next);
  },

  reorder: (ids) => {
    const byId = new Map(get().tabs.map((tab) => [tab.id, tab]));
    const tabs = ids.map((id) => byId.get(id)).filter((tab): tab is PageTab => Boolean(tab));
    if (tabs.length === byId.size) set({ tabs });
  },

  saveScroll: (id, scroll) => {
    set({ tabs: get().tabs.map((tab) => (tab.id === id ? { ...tab, scroll } : tab)) });
  },

  prune: (exists) => {
    const { tabs, activeId, recent } = get();
    const keep = tabs.filter((tab) => tab.id === activeId || exists(currentHref(tab)));
    if (keep.length === tabs.length) return;
    const ids = new Set(keep.map((tab) => tab.id));
    set({ tabs: keep, recent: recent.filter((id) => ids.has(id)) });
  },
}));

// Persist after every change once the saved tabs have been read back.
usePageTabsStore.subscribe((state) => {
  if (!state.hydrated) return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ tabs: state.tabs, activeId: state.activeId, recent: state.recent }),
    );
  } catch {
    // Private mode or a full quota: tabs just won't survive a reload.
  }
});
