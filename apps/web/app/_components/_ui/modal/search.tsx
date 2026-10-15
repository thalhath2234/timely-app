"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpRight, CalendarDays, CheckSquare, Command, FileText, Folder, LayoutGrid, ListFilter, Plus, Search, Sparkles, Table2, X, type LucideIcon } from "lucide-react";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { useSearch, useSmartSearch } from "@/app/utils/hooks/search";
import { useConfig, useWorkingHoursZone, useWorkspaces } from "@/app/utils/hooks/workspaces";
import type { Config, Project, Task, TaskViewConfig, Workspace } from "@/app/_types/types";
import { matchViewByName } from "@timely/contract/viewSearch";
import { describeView, readingIsListing, readViewQuery, viewFromAiDraft, viewFromReading, viewNoun, vocabularyFrom } from "@timely/contract/viewLanguage";
import { runView } from "@timely/contract/taskQuery";
import { todayInZone } from "@timely/contract/workStatus";
import { useTasks } from "@/app/utils/hooks/tasks";
import { useProjects } from "@/app/utils/hooks/projects";
import { useAgentProviders } from "@/app/utils/hooks/agentProviders";
import { readyProviders } from "@/app/_components/chat/modelMenu";
import { readViewWithAi } from "@/app/utils/api/viewQuery";
import { useViewPreviewStore } from "@/app/_store/viewPreviewStore";
import { ViewChips } from "@/app/_components/_ui/tasks/viewRulesBar";
import Button from "@/app/_components/_ui/button";
import type { SearchHit } from "@/app/utils/api/search";
import { sendDecisionFeedback } from "@/app/utils/api/decisions";
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
type PaletteItem = {
  id: string; title: string; description: string; kind: string; icon: LucideIcon; run: () => void; command?: boolean; section: "suggested" | "results" | "commands";
  /** Extra lines under the title (a listing's chips). */
  detail?: ReactNode;
  /** Buttons in place of the kind label. */
  actions?: ReactNode;
};

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

export default function SearchModal() {
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
        <SearchPanel onClose={closeSearch} />
      </OverlayFrame>
    </>
  ) : null;
}

function SearchPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  // The highlighted row, pinned by id once the person moves it, so results
  // that arrive or reorder later never move the highlight to another item.
  const [selection, setSelection] = useState<{ index: number; id?: string }>({ index: 0 });
  const trimmed = query.trim();
  const search = useSearch(query);
  // Never show cached results for the previous query during the debounce window.
  const matchesCurrentQuery = search.query === trimmed;
  const hits = trimmed && matchesCurrentQuery ? search.data ?? [] : [];
  // Smart suggestions reorder the results, set clear misses aside and may
  // read the query as a command. Plain results show first; this applies when
  // Jev answers, and only for the query on screen.
  const smart = useSmartSearch(search.query);
  const smartData = trimmed && smart.query === trimmed && matchesCurrentQuery ? smart.data : undefined;
  const [showHidden, setShowHidden] = useState(false);
  // Counted per tab: a weak doc match is not one of the Sheets tab's results.
  const hidden = smartData?.hits ? (smartData.hidden ?? []).filter((hit) => category === "all" || hit.kind === category) : [];
  const shownHits = smartData?.hits ? [...smartData.hits, ...(showHidden ? hidden : [])] : hits;
  const suggestedCategory = smartData?.category && category === "all" ? categories.find((tab) => tab.id === smartData.category) : undefined;
  const pending = !!trimmed && (!matchesCurrentQuery || search.isFetching);
  const failed = !!trimmed && matchesCurrentQuery && search.isError;
  const config = useConfig().data as Config | undefined;
  const taskViews = config?.taskViews;
  const savedViews = useMemo(() => taskViews ?? [], [taskViews]);
  const listing = useListing(trimmed, config);

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
    const store = useSidebarStore.getState();
    store.setCreateTaskDraft(title ? { name: title } : null);
    store.setAddNewMode(kind);
    store.setIsAddItemModalOpen(true);
  }

  function openHit(hit: SearchHit) {
    onClose();
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
  // A search that names a saved view ("show my deadline") opens it straight
  // away, with or without Smart suggestions; one that reads as "show me what
  // needs attention" gets Smart suggestions' pick.
  const namedView = trimmed ? matchViewByName(trimmed, savedViews) : undefined;
  const viewPick = namedView ?? smartData?.view;
  const viewItems: PaletteItem[] = viewPick && (category === "all" || category === "task") ? [{
    id: `view-${viewPick.id}`, title: `Open view “${viewPick.name}”`, description: namedView ? "Your saved view in Tasks" : "Your saved view for this", kind: "view", icon: ListFilter, section: "suggested",
    run: () => {
      onClose();
      if (smartData?.logId && smartData.view?.id === viewPick.id) void sendDecisionFeedback(smartData.logId, true).catch(() => {});
      router.push(`/tasks?view=${encodeURIComponent(viewPick.id)}`);
    },
  }] : [];
  const listingItem = listing && (category === "all" || category === "task") ? listing.item(onClose, router.push) : undefined;
  const listingItems: PaletteItem[] = listingItem && listingItem.section !== "commands" ? [listingItem] : [];
  // A saved view named outright comes first; Smart suggestions' looser pick
  // follows the listing the words themselves describe.
  const viewsFirst = namedView ? [...viewItems, ...listingItems] : [...listingItems, ...viewItems];
  const items = [...viewsFirst, ...suggested, ...results, ...(listingItem?.section === "commands" ? [listingItem] : []), ...commands];
  // The AI offer turns into the card it read, so the highlight follows it.
  const pinnedId = selection.id === "listing-ai" && listing?.fromAi ? "listing" : selection.id;
  const pinned = pinnedId ? items.findIndex((item) => item.id === pinnedId) : -1;
  const active = pinned >= 0 ? pinned : Math.min(selection.index, Math.max(0, items.length - 1));
  const select = (index: number) => setSelection({ index, id: items[index]?.id });
  const activeId = items.length ? `palette-option-${active}` : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  function selectCategory(next: Category) { setCategory(next); setSelection({ index: 0 }); }
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
      if (items.length) select((active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
    }
    if (event.key === "Enter" && items[active]) { event.preventDefault(); items[active].run(); }
  }

  return (
    <OverlayPanel ref={panel} role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}
      className="relative flex max-h-[75dvh] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl">
      <div className="flex items-center gap-3 px-5 py-5">
        <Search size={21} className="shrink-0 text-primary" aria-hidden="true" />
        <input ref={input} role="combobox" aria-label="Search or run a command" aria-expanded="true" aria-controls="palette-results" aria-autocomplete="list" aria-activedescendant={activeId}
          autoComplete="off" value={query} onChange={(event) => { setQuery(event.target.value); setSelection({ index: 0 }); setShowHidden(false); }}
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
          {!pending && !failed && trimmed && !results.length && !hidden.length && viewItems.length > 0 && !listingItems.length && <p className="py-3">No items match this search.</p>}
          {!pending && !failed && trimmed && !results.length && !hidden.length && !viewItems.length && !listingItems.length && <p className="py-3">No matching {category === "all" ? "items" : categories.find((tab) => tab.id === category)?.label.toLowerCase()}. Try another keyword or tab.</p>}
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
            {(index === 0 || item.section !== items[index - 1].section) && <p role="presentation" className="px-3 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{item.section === "suggested" ? "Suggested" : item.section === "commands" ? "Quick actions" : "Search results"}</p>}
            <div id={`palette-option-${index}`} role="option" aria-selected={active === index} onClick={item.run} onPointerMove={() => select(index)}
              className={cn("group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left", active === index ? "bg-primary/10 text-foreground" : "text-foreground hover:bg-muted")}>
              <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border", active === index ? "border-primary/20 bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground")}><item.icon size={17} aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.title}</span>{item.detail}<span className="block truncate text-xs text-muted-foreground">{item.description || item.kind}</span></span>
              {item.actions ?? <span className="hidden text-[10px] capitalize text-muted-foreground sm:inline">{item.command ? "Command" : item.kind}</span>}
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

/**
 * Search words read as a list of tasks [natural-language views]: "show task
 * deadline" lists tasks with a deadline instead of keyword hits. The reading
 * needs no AI key; when words are left over and an AI provider is set up,
 * "Read with AI" asks it for a richer reading of the same words.
 */
function useListing(query: string, config: Config | undefined) {
  const { data: tasks } = useTasks();
  const { data: workspaces } = useWorkspaces();
  const { data: projects } = useProjects();
  const { data: providers } = useAgentProviders();
  const timeZone = useWorkingHoursZone();
  const setPending = useViewPreviewStore((state) => state.setPending);
  const aiReady = readyProviders(providers).length > 0;
  const [ai, setAi] = useState<{ query: string; view?: TaskViewConfig; busy?: boolean; error?: string; dropped?: string[] } | null>(null);
  const vocab = useMemo(
    () => vocabularyFrom({ workspaces: (workspaces ?? []) as Workspace[], projects: (projects ?? []) as Project[], customFields: config?.customFields }),
    [workspaces, projects, config?.customFields],
  );
  const today = todayInZone(timeZone);
  const reading = useMemo(() => (query ? readViewQuery(query, vocab, { today }) : undefined), [query, vocab, today]);
  const aiView = ai?.query === query ? ai.view : undefined;
  const view = useMemo(
    () => aiView ?? (reading && readingIsListing(reading) ? viewFromReading(reading, "preview", { prompt: query }) : undefined),
    [aiView, reading, query],
  );
  const rows = useMemo(
    () => (view ? runView((tasks ?? []) as Task[], view, { timeZone }) : []),
    [view, tasks, timeZone],
  );
  if (!reading) return undefined;
  const aiState = ai?.query === query ? ai : undefined;
  const askAi = () => {
    setAi({ query, busy: true });
    readViewWithAi({ query, today, client: "web" })
      .then((result) => setAi({ query, view: viewFromAiDraft(result.view, "preview", vocab, { prompt: query }), dropped: result.dropped }))
      .catch((error: Error) => setAi({ query, error: error.message }));
  };
  if (!view) {
    // Words the plain reading can't place ("stuff I keep putting off") can
    // still be read by the AI provider, on request.
    if (!aiReady || query.split(/\s+/).length < 3) return undefined;
    return {
      fromAi: false,
      item: (): PaletteItem => ({
        id: "listing-ai",
        title: aiState?.busy ? "Reading your words…" : "Make a task view from these words",
        description: aiState?.error ?? "Your AI provider reads what to list, sort and group",
        kind: "view",
        icon: Sparkles,
        command: true,
        section: "commands",
        run: () => { if (!aiState?.busy) askAi(); },
      }),
    };
  }
  const create = reading.createView;
  const noun = viewNoun(view).toLowerCase();
  const count = rows.length;
  const first = rows.slice(0, 3).map((task) => task.name || "Untitled").join(", ");
  const chips = describeView(view, vocab).filter((chip) => chip.kind !== "layout" || view.renderMode !== "list");

  return {
    fromAi: Boolean(aiView),
    item(onClose: () => void, push: (href: string) => void): PaletteItem {
      const open = (save: boolean) => {
        onClose();
        setPending({ view, save });
        push("/tasks");
      };
      return {
        id: "listing",
        title: create ? `Create view “${view.name}”` : `${count} ${count === 1 ? noun.replace(/s$/, "") : noun} · ${view.name}`,
        description: aiState?.error
          ? aiState.error
          : count
            ? `${create ? `${count} ${count === 1 ? noun.replace(/s$/, "") : noun} now: ` : ""}${first}${count > 3 ? ", …" : ""}`
            : "Nothing matches yet; it will fill as work comes in",
        kind: "view",
        icon: aiView ? Sparkles : ListFilter,
        section: "suggested",
        detail: <ViewChips chips={chips} className="my-1" />,
        actions: (
          <span className="flex shrink-0 items-center gap-1">
            {aiReady && reading.leftover.length > 0 && !aiView ? (
              <Button size="sm" variant="ghost" leading={<Sparkles />} loading={aiState?.busy} onClick={(event) => { event.stopPropagation(); askAi(); }}>
                Read with AI
              </Button>
            ) : null}
            {create ? null : (
              <Button size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); open(true); }}>
                Save as view
              </Button>
            )}
          </span>
        ),
        run: () => open(create),
      };
    },
  };
}
