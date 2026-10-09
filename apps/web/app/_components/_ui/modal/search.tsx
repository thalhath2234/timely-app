"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpRight, CalendarDays, CheckSquare, Command, FileText, Folder, LayoutGrid, Plus, Search, Sparkles, Table2, X, type LucideIcon } from "lucide-react";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { useSearch, useSmartSearch } from "@/app/utils/hooks/search";
import type { SearchHit } from "@/app/utils/api/search";
import { cn } from "@/app/utils/cn";
import { openTasksEntity } from "@/app/utils/entityDetail";
import { OverlayFrame, OverlayPanel, OverlayScrim } from "@/app/_components/_ui/motion";
import { useTransitionStore } from "@/app/utils/hooks/useTransitionStore";
import { fileHref, FILES_PATH } from "@/app/utils/fileRoutes";

const categories = [
  { id: "all", label: "All", icon: LayoutGrid },
  { id: "sheet", label: "Sheets", icon: Table2 },
  { id: "doc", label: "Docs", icon: FileText },
  { id: "task", label: "Tasks", icon: CheckSquare },
  { id: "project", label: "Projects", icon: Folder },
  { id: "event", label: "Events", icon: CalendarDays },
] as const;
type Category = typeof categories[number]["id"];
type PaletteItem = { id: string; title: string; description: string; kind: string; icon: LucideIcon; run: () => void; command?: boolean; section: "suggested" | "results" | "commands" };
type DemoProps = { demoItems?: SearchHit[]; onDemoSelect?: (title: string) => void };

function hrefFor(hit: SearchHit): string {
  switch (hit.kind) {
    case "doc": return fileHref(encodeURIComponent(hit.id));
    case "sheet": return fileHref(encodeURIComponent(hit.id));
    case "event": return "/calendar";
    default: return "/tasks";
  }
}

const nouns = { sheet: "sheet", doc: "document", task: "task", project: "project", event: "event" } as const;

const selectSearchMode = (state: ReturnType<typeof useSidebarStore.getState>) => state.searchMode;

export default function SearchModal(props: DemoProps) {
  const searchMode = useTransitionStore(useSidebarStore, selectSearchMode);
  const setSearchMode = useSidebarStore((state) => state.setSearchMode);
  const closeSearch = useCallback(() => setSearchMode(false), [setSearchMode]);
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") closeSearch();
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "k" || e.code === "KeyK")) {
        e.preventDefault();
        e.stopPropagation();
        setSearchMode(!useSidebarStore.getState().searchMode);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [setSearchMode, closeSearch]);

  return searchMode ? (
    <>
      <OverlayScrim className="z-50 bg-black/35 supports-backdrop-filter:backdrop-blur-xs" onClick={closeSearch} />
      <OverlayFrame className="z-50 items-start justify-center px-3 pt-[12vh] sm:pt-[16vh]">
        <SearchPanel onClose={closeSearch} {...props} />
      </OverlayFrame>
    </>
  ) : null;
}

function SearchPanel({ onClose, demoItems, onDemoSelect }: DemoProps & { onClose: () => void }) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [selected, setSelected] = useState(0);
  const trimmed = query.trim();
  const search = useSearch(demoItems ? "" : query);
  // Never show cached results for the previous query during the debounce window.
  const matchesCurrentQuery = search.query === trimmed;
  const hits = demoItems
    ? demoItems.filter((hit) => `${hit.title} ${hit.snippet}`.toLowerCase().includes(trimmed.toLowerCase()))
    : trimmed && matchesCurrentQuery ? search.data ?? [] : [];
  // Smart suggestions reorder the results, set clear misses aside and may
  // read the query as a command. Plain results show first; this applies when
  // Jev answers, and only for the query on screen.
  const smart = useSmartSearch(demoItems ? "" : search.query);
  const smartData = !demoItems && trimmed && smart.query === trimmed && matchesCurrentQuery ? smart.data : undefined;
  const [showHidden, setShowHidden] = useState(false);
  // Counted per tab: a weak doc match is not one of the Sheets tab's results.
  const hidden = smartData?.hits ? (smartData.hidden ?? []).filter((hit) => category === "all" || hit.kind === category) : [];
  const shownHits = smartData?.hits ? [...smartData.hits, ...(showHidden ? hidden : [])] : hits;
  const suggestedCategory = smartData?.category && category === "all" ? categories.find((tab) => tab.id === smartData.category) : undefined;
  const pending = !demoItems && !!trimmed && (!matchesCurrentQuery || search.isFetching);
  const failed = !demoItems && !!trimmed && matchesCurrentQuery && search.isError;

  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    input.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  function create(kind: Exclude<Category, "all">, title?: string) {
    onClose();
    if (onDemoSelect) return onDemoSelect(`Create ${nouns[kind]}`);
    const store = useSidebarStore.getState();
    store.setCreateTaskDraft(title ? { name: title } : null);
    store.setAddNewMode(kind);
    store.setIsAddItemModalOpen(true);
  }

  function openHit(hit: SearchHit) {
    onClose();
    if (onDemoSelect) return onDemoSelect(hit.title);
    if (hit.kind === "task" || hit.kind === "project") {
      openTasksEntity({ kind: hit.kind, id: hit.id }, { navigate: (href) => router.push(href, { scroll: false }) });
    } else router.push(hrefFor(hit));
  }

  const commands: PaletteItem[] = categories.filter((tab) => tab.id !== "all").flatMap((tab) => {
    const kind = tab.id as Exclude<Category, "all">;
    const noun = nouns[kind];
    const route = { sheet: FILES_PATH, doc: FILES_PATH, task: "/tasks", project: "/projects", event: "/calendar" }[kind];
    // Docs and sheets both live in Files.
    const place = kind === "event" ? "calendar" : route === FILES_PATH ? "files" : tab.label.toLowerCase();
    return [
      { id: `create-${kind}`, title: `Create ${noun}`, description: `Start a new ${noun}`, kind, icon: Plus, command: true, section: "commands" as const, run: () => create(kind) },
      { id: `goto-${kind}`, title: `Go to ${place}`, description: `Open your ${place}`, kind, icon: tab.icon, command: true, section: "commands" as const, run: () => {
        onClose();
        if (onDemoSelect) return onDemoSelect(`Go to ${place}`);
        router.push(route);
      } },
    ];
  }).filter((item) => (category === "all" || item.kind === category) && !(category === "all" && item.id === "goto-sheet") && `${item.title} ${item.description}`.toLowerCase().includes(trimmed.toLowerCase()));
  const results: PaletteItem[] = shownHits.filter((hit) => category === "all" || hit.kind === category).map((hit) => ({
    id: `${hit.kind}:${hit.id}`, title: hit.title || "Untitled", description: hit.snippet,
    kind: hit.kind, icon: categories.find((tab) => tab.id === hit.kind)?.icon ?? FileText, run: () => openHit(hit), section: "results" as const,
  }));
  // Events have no title pre-fill in the add dialog, so they get no suggestion.
  const suggestion = smartData?.create?.kind === "event" ? undefined : smartData?.create;
  const suggested: PaletteItem[] = suggestion && (category === "all" || category === suggestion.kind) ? [{
    id: `suggest-${suggestion.kind}`, title: `Create ${nouns[suggestion.kind]} “${suggestion.title}”`, description: "Looks like you want to make something new",
    kind: suggestion.kind, icon: Plus, command: true, section: "suggested", run: () => create(suggestion.kind, suggestion.title),
  }] : [];
  const items = [...suggested, ...results, ...commands];
  const active = Math.min(selected, Math.max(0, items.length - 1));
  const activeId = items.length ? `palette-option-${active}` : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  function selectCategory(next: Category) { setCategory(next); setSelected(0); }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Tab") {
      const elements = panel.current?.querySelectorAll<HTMLElement>('input, button:not([tabindex="-1"])');
      if (!elements?.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    if (event.target !== input.current) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length) setSelected((active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
    }
    if (event.key === "Enter" && items[active]) { event.preventDefault(); items[active].run(); }
  }

  return (
    <OverlayPanel ref={panel} role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}
      className="relative flex max-h-[75dvh] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl">
      <div className="flex items-center gap-3 px-5 py-5">
        <Search size={21} className="shrink-0 text-primary" aria-hidden="true" />
        <input ref={input} role="combobox" aria-label="Search or run a command" aria-expanded="true" aria-controls="palette-results" aria-autocomplete="list" aria-activedescendant={activeId}
          autoComplete="off" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); setShowHidden(false); }}
          placeholder="Search anything, or run a command…" className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground" />
        <button type="button" aria-label="Close command palette" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><X size={18} /></button>
      </div>
      <div role="tablist" aria-label="Search categories" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-4 pb-3">
        {categories.map((tab, index) => <button key={tab.id} id={`palette-tab-${tab.id}`} role="tab" aria-selected={category === tab.id} aria-controls="palette-results" tabIndex={category === tab.id ? 0 : -1}
          onClick={() => selectCategory(tab.id)} onKeyDown={(event) => {
            let next = index;
            if (event.key === "ArrowRight") next = (index + 1) % categories.length;
            else if (event.key === "ArrowLeft") next = (index + categories.length - 1) % categories.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = categories.length - 1;
            else return;
            event.preventDefault(); selectCategory(categories[next].id); document.getElementById(`palette-tab-${categories[next].id}`)?.focus();
          }} className={cn("flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring", category === tab.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
          <tab.icon size={14} aria-hidden="true" />{tab.label}
        </button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div role="status" className="px-3 text-xs text-muted-foreground">
          {pending && <p className="py-3">Searching your workspace…</p>}
          {failed && <p className="py-3 text-destructive">Couldn’t search your workspace. Try again; commands are still available.</p>}
          {!pending && !failed && trimmed && !results.length && !hidden.length && <p className="py-3">No matching {category === "all" ? "items" : categories.find((tab) => tab.id === category)?.label.toLowerCase()}. Try another keyword or tab.</p>}
          {!pending && !failed && hidden.length > 0 && (
            <p className="py-1" data-testid="smart-hidden">
              {results.length ? "" : "No good matches. "}
              {hidden.length} weak {hidden.length === 1 ? "match" : "matches"} {showHidden ? "shown at the end" : "hidden"} ·{" "}
              <button type="button" onClick={() => setShowHidden((value) => !value)} className="font-medium text-primary hover:underline">
                {showHidden ? "Hide" : "Show"}
              </button>
            </p>
          )}
          {!pending && !failed && suggestedCategory && (
            <button type="button" onClick={() => selectCategory(suggestedCategory.id)} data-testid="smart-category"
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-muted">
              <Sparkles size={12} className="text-primary" aria-hidden="true" />Looking for {suggestedCategory.label}?
            </button>
          )}
        </div>
        <div id="palette-results" role="listbox" aria-label={`${categories.find((tab) => tab.id === category)?.label} results and commands`} aria-busy={pending}>
          {items.map((item, index) => <div key={item.id}>
            {(index === 0 || item.section !== items[index - 1].section) && <p role="presentation" className="px-3 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{item.section === "suggested" ? "Suggested" : item.section === "commands" ? "Quick actions" : demoItems && !trimmed ? "Explore the demo" : "Search results"}</p>}
            <div id={`palette-option-${index}`} role="option" aria-selected={active === index} onClick={item.run} onPointerMove={() => setSelected(index)}
              className={cn("group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left", active === index ? "bg-primary/10 text-foreground" : "text-foreground hover:bg-muted")}>
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border", active === index ? "border-primary/20 bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground")}><item.icon size={17} aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.title}</span><span className="block truncate text-xs text-muted-foreground">{item.description || item.kind}</span></span>
              <span className="hidden text-[10px] capitalize text-muted-foreground sm:inline">{item.command ? "Command" : item.kind}</span>
              <ArrowUpRight size={14} aria-hidden="true" className={active === index ? "text-primary" : "text-muted-foreground/40"} />
            </div>
          </div>)}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><Command size={13} /> Timely <span className="hidden sm:inline">/ your workspace, one command away</span></span>
        <span className="flex items-center gap-3"><span className="flex items-center gap-1"><ArrowUp size={11} /><ArrowDown size={11} /> navigate</span><span>↵ open</span><span>esc close</span></span>
      </div>
    </OverlayPanel>
  );
}
