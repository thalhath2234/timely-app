"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Reorder } from "motion/react";
import { ArrowLeft, ArrowRight, FileText, LayoutTemplate, Plus, Sheet, X } from "lucide-react";
import {
  currentHref,
  isSectionIndex,
  usePageTabsStore,
  type PageTab,
} from "@/app/_store/pageTabsStore";
import { useDocs } from "@/app/utils/hooks/docs";
import { useSheets } from "@/app/utils/hooks/sheets";
import { fileIdFromPath, fileKind, FILES_PATH } from "@/app/utils/fileRoutes";
import { cn } from "@/app/utils/cn";

type Scroll = NonNullable<PageTab["scroll"]>;

// Survives the remount when a doc tab hands over to a sheet tab (the two
// pages have different layouts).
let pendingRestore: Scroll | null = null;

/** The page's main scroller: the largest element that actually scrolls. */
function mainScroller(root: HTMLElement) {
  let best: HTMLElement | null = null;
  let bestArea = 0;
  for (const element of root.querySelectorAll<HTMLElement>("*")) {
    const scrollsY = element.scrollHeight > element.clientHeight + 1;
    const scrollsX = element.scrollWidth > element.clientWidth + 1;
    if (!scrollsY && !scrollsX) continue;
    const style = getComputedStyle(element);
    if (!/(auto|scroll)/.test(`${style.overflowY} ${style.overflowX}`)) continue;
    const area = element.clientWidth * element.clientHeight;
    if (area > bestArea) {
      best = element;
      bestArea = area;
    }
  }
  return best;
}

/** Docs and sheets content with the tab strip above it. */
export default function TabbedPane({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const contentRef = useRef<HTMLDivElement>(null);
  const hydrated = usePageTabsStore((state) => state.hydrated);
  // The pathname the sync below last handled; null until the first visit.
  const handled = useRef<string | null>(null);
  const docs = useDocs();
  const sheets = useSheets();

  useEffect(() => usePageTabsStore.getState().hydrate(), []);

  const show = useCallback(
    (tab: PageTab) => {
      pendingRestore = tab.scroll ?? null;
      const href = currentHref(tab);
      if (href !== window.location.pathname) router.replace(href, { scroll: false });
    },
    [router],
  );

  // Keep the active tab in step with the URL.
  useEffect(() => {
    if (!hydrated) return;
    // Effects run twice in development; a second pass must not record twice.
    if (handled.current === pathname) return;
    const firstVisit = handled.current === null;
    handled.current = pathname;
    const store = usePageTabsStore.getState();
    const active = store.tabs.find((tab) => tab.id === store.activeId);
    if (active && currentHref(active) === pathname) return;

    // Back in Files from elsewhere: pick up where the user left off.
    if (firstVisit && isSectionIndex(pathname)) {
      const last = store.recent
        .map((id) => store.tabs.find((tab) => tab.id === id))
        .find(Boolean);
      if (last) {
        store.activate(last.id);
        show(last);
        return;
      }
      // Nothing open here yet: an empty tab takes the start page, else a new one.
      const empty = [active, ...store.tabs].find((tab) => tab && isSectionIndex(currentHref(tab)));
      if (empty) {
        store.activate(empty.id);
        store.visit(pathname);
      } else {
        store.open(pathname);
      }
      return;
    }

    // A page that is already open in another tab switches to that tab.
    const open = isSectionIndex(pathname)
      ? undefined
      : store.tabs.find((tab) => tab.id !== store.activeId && currentHref(tab) === pathname);
    if (open) {
      store.activate(open.id);
      pendingRestore = open.scroll ?? null;
      return;
    }
    store.visit(pathname);
  }, [hydrated, pathname, show]);

  // Put a reopened tab back where it was scrolled, once its page has loaded.
  useEffect(() => {
    const target = pendingRestore;
    const root = contentRef.current;
    if (!target || target.href !== pathname || !root) return;
    const started = performance.now();
    const timer = window.setInterval(() => {
      const scroller = mainScroller(root);
      const timedOut = performance.now() - started > 3000;
      if (!scroller && !timedOut) return;
      if (
        scroller &&
        (timedOut ||
          (scroller.scrollHeight - scroller.clientHeight >= target.top &&
            scroller.scrollWidth - scroller.clientWidth >= target.left))
      ) {
        scroller.scrollTo({ top: target.top, left: target.left });
      } else if (!timedOut) return;
      window.clearInterval(timer);
      if (pendingRestore === target) pendingRestore = null;
    }, 80);
    return () => window.clearInterval(timer);
  }, [pathname]);

  // Tabs whose doc or sheet was deleted (or belongs to another account) go
  // away once fresh lists are in. Waiting out refetches keeps a page that was
  // just created from looking deleted.
  useEffect(() => {
    if (!hydrated || !docs.isSuccess || !sheets.isSuccess || docs.isFetching || sheets.isFetching) return;
    const docIds = new Set(docs.data.map((doc) => doc.id));
    const sheetIds = new Set(sheets.data.map((sheet) => sheet.id));
    usePageTabsStore.getState().prune((href) => {
      const id = fileIdFromPath(href);
      if (!id) return true;
      const kind = fileKind(id);
      if (kind === "template") return true;
      return kind === "doc" ? docIds.has(id) : sheetIds.has(id);
    });
  }, [hydrated, docs.isSuccess, docs.isFetching, docs.data, sheets.isSuccess, sheets.isFetching, sheets.data]);

  // Remember the active tab's scroll as the user scrolls, and right before
  // the strip switches away from it.
  const rememberScroll = useCallback(() => {
    const root = contentRef.current;
    const store = usePageTabsStore.getState();
    const active = store.tabs.find((tab) => tab.id === store.activeId);
    const href = window.location.pathname;
    if (!root || !active || currentHref(active) !== href) return;
    const scroller = mainScroller(root);
    if (scroller) store.saveScroll(active.id, { href, top: scroller.scrollTop, left: scroller.scrollLeft });
  }, []);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    let timer: number | undefined;
    const onScroll = () => {
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        rememberScroll();
      }, 200);
    };
    root.addEventListener("scroll", onScroll, true);
    return () => {
      root.removeEventListener("scroll", onScroll, true);
      window.clearTimeout(timer);
    };
  }, [rememberScroll]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {hydrated ? <PageTabStrip show={show} rememberScroll={rememberScroll} /> : <div className="h-9 shrink-0 border-b border-border bg-muted/40" />}
      <div ref={contentRef} className="min-h-0 flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function PageTabStrip({
  show,
  rememberScroll,
}: {
  show: (tab: PageTab) => void;
  rememberScroll: () => void;
}) {
  const router = useRouter();
  const tabs = usePageTabsStore((state) => state.tabs);
  const activeId = usePageTabsStore((state) => state.activeId);
  const active = tabs.find((tab) => tab.id === activeId);
  const stripRef = useRef<HTMLDivElement>(null);

  const switchTo = useCallback(
    (id: string) => {
      if (id === usePageTabsStore.getState().activeId) return;
      rememberScroll();
      const tab = usePageTabsStore.getState().activate(id);
      if (tab) show(tab);
    },
    [rememberScroll, show],
  );

  const newTab = useCallback(() => {
    rememberScroll();
    show(usePageTabsStore.getState().open(FILES_PATH));
  }, [rememberScroll, show]);

  const closeTab = useCallback(
    (id: string) => {
      const store = usePageTabsStore.getState();
      const wasActive = store.activeId === id;
      const next = store.close(id);
      if (!wasActive) return;
      // Closing the last tab leaves an empty one, like Obsidian.
      show(next ?? usePageTabsStore.getState().open(FILES_PATH));
    },
    [show],
  );

  const go = useCallback(
    (delta: -1 | 1) => {
      const href = usePageTabsStore.getState().go(delta);
      if (href) router.replace(href, { scroll: false });
    },
    [router],
  );

  // Keyboard: the desktop app forwards Ctrl/Cmd+T, Ctrl/Cmd+W, Ctrl+Tab and
  // back/forward keys here (a browser keeps those for its own tabs).
  useEffect(() => {
    const desktop = window.timelyDesktop;
    if (!desktop?.onPageTabCommand) return;
    desktop.setPageTabsActive?.(true);
    const unsubscribe = desktop.onPageTabCommand((command) => {
      const store = usePageTabsStore.getState();
      const at = store.tabs.findIndex((tab) => tab.id === store.activeId);
      switch (command) {
        case "new":
          return newTab();
        case "close":
          return store.activeId ? closeTab(store.activeId) : undefined;
        case "next":
        case "previous": {
          if (store.tabs.length < 2) return;
          const step = command === "next" ? 1 : -1;
          return switchTo(store.tabs[(at + step + store.tabs.length) % store.tabs.length].id);
        }
        case "back":
          return go(-1);
        case "forward":
          return go(1);
      }
    });
    return () => {
      unsubscribe();
      desktop.setPageTabsActive?.(false);
    };
  }, [closeTab, go, newTab, switchTo]);

  // Mouse back/forward buttons move through the active tab's history.
  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      go(event.button === 3 ? -1 : 1);
    };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [go]);

  useEffect(() => {
    if (!activeId) return;
    stripRef.current
      ?.querySelector(`[data-tab-id="${activeId}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length]);

  const canGoBack = Boolean(active && active.index > 0);
  const canGoForward = Boolean(active && active.index < active.history.length - 1);

  return (
    <div className="flex h-9 shrink-0 items-end gap-1 border-b border-border bg-muted/40 pl-1.5 pr-1">
      <div className="flex h-full shrink-0 items-center gap-0.5 pr-1">
        <StripButton label="Back" disabled={!canGoBack} onClick={() => go(-1)}>
          <ArrowLeft className="size-3.5" />
        </StripButton>
        <StripButton label="Forward" disabled={!canGoForward} onClick={() => go(1)}>
          <ArrowRight className="size-3.5" />
        </StripButton>
      </div>

      <div
        ref={stripRef}
        className="flex h-full min-w-0 flex-1 items-end overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onDoubleClick={(event) => {
          if (event.target === event.currentTarget) newTab();
        }}
      >
        <Reorder.Group
          as="div"
          axis="x"
          role="tablist"
          aria-label="Open pages"
          values={tabs.map((tab) => tab.id)}
          onReorder={(ids) => usePageTabsStore.getState().reorder(ids)}
          className="flex h-full min-w-0 items-end gap-0.5"
        >
          {tabs.map((tab) => (
            <Reorder.Item
              as="div"
              key={tab.id}
              value={tab.id}
              data-tab-id={tab.id}
              role="tab"
              tabIndex={tab.id === activeId ? 0 : -1}
              aria-selected={tab.id === activeId}
              onClick={() => switchTo(tab.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  switchTo(tab.id);
                }
              }}
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                closeTab(tab.id);
              }}
              className={cn(
                "group relative -mb-px flex h-8 w-44 min-w-24 shrink cursor-pointer select-none items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tab.id === activeId
                  ? "border-border bg-background text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <TabLabel href={currentHref(tab)} />
              <button
                type="button"
                aria-label="Close tab"
                title="Close tab"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
                className={cn(
                  "ml-auto flex size-5 shrink-0 cursor-pointer items-center justify-center rounded transition-colors hover:bg-accent hover:text-foreground",
                  tab.id === activeId ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
              >
                <X className="size-3" />
              </button>
            </Reorder.Item>
          ))}
        </Reorder.Group>
        <div className="flex h-full shrink-0 items-center pl-1">
          <StripButton label="New tab" onClick={newTab}>
            <Plus className="size-4" />
          </StripButton>
        </div>
      </div>
    </div>
  );
}

function StripButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
    >
      {children}
    </button>
  );
}

function TabLabel({ href }: { href: string }) {
  const { data: docs } = useDocs();
  const { data: sheets } = useSheets();
  const id = fileIdFromPath(href);
  const kind = id ? fileKind(id) : null;

  let icon: ReactNode = null;
  let title = "New tab";
  if (kind === "doc") {
    const doc = docs?.find((item) => item.id === id);
    icon = doc?.icon ? <span className="text-sm leading-none">{doc.icon}</span> : <FileText className="size-3.5" />;
    title = doc ? doc.title || "Untitled" : "Doc";
  } else if (kind === "template") {
    icon = <LayoutTemplate className="size-3.5" />;
    title = "Sheet template";
  } else if (kind === "sheet") {
    const sheet = sheets?.find((item) => item.id === id);
    icon = sheet?.icon ? <span className="text-sm leading-none">{sheet.icon}</span> : <Sheet className="size-3.5" />;
    title = sheet ? sheet.title || "Untitled" : "Sheet";
  }

  return (
    <>
      {icon ? <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate" title={title}>
        {title}
      </span>
    </>
  );
}
