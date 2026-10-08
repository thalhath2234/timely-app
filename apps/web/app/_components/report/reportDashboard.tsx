"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  ExternalLink,
  Link2,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Scaling,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  builtinInfo,
  cardTitle,
  defaultDashboard,
  minCardSize,
  newCardId,
  DASHBOARD_MAX_CARDS,
  type BuiltinCardType,
  type CardRow,
  type CardTemplate,
  type DashboardCard,
} from "@timely/contract/dashboard";
import type { CalendarItem, Doc, Project, Sheet, Task } from "@/app/_types/types";
import { mentionHref } from "@/app/_components/editor/mention";
import LoadError, { LoadErrorBanner } from "@/app/_components/_ui/loadError";
import SaveStatusBadge from "@/app/_components/_ui/saveStatus";
import { openContextMenu, tidyEntries, type ContextMenuEntry } from "@/app/_store/contextMenuStore";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { requestConfirm } from "@/app/_store/confirmStore";
import { showUndoToast, useToastStore } from "@/app/_store/toastStore";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";
import { forgetPomodoro } from "@/app/_store/pomodoroStore";
import { useCalendarStore } from "@/app/_store/calendarStore";
import { useTaskContextMenu } from "@/app/utils/hooks/useTaskContextMenu";
import { useProjectContextMenu } from "@/app/utils/hooks/useProjectContextMenu";
import { useDocContextMenu } from "@/app/utils/hooks/useDocContextMenu";
import { useSheetContextMenu } from "@/app/utils/hooks/useSheetContextMenu";
import { useConfig } from "@/app/utils/hooks/workspaces";
import AddCardDialog from "./addCardDialog";
import CardWorkshop, { DISPLAY_ICON, type WorkshopResult } from "./cardWorkshop";
import CustomCardView, { useCardResult } from "./customCardView";
import DashboardGrid from "./dashboardGrid";
import PomodoroCard from "./pomodoroCard";
import { BuiltinIcon } from "./cardIcons";
import { CountdownCard, DayProgressCard, MatrixCard, NotesCard, QuickCaptureCard, StreakCard, TodayCard } from "./builtinCards";
import {
  ClockCard,
  FocusTimeCard,
  GoalCard,
  HabitsCard,
  InboxZeroCard,
  JournalCard,
  NextUpCard,
  TopThreeCard,
  WeeklyReviewCard,
} from "./productivityCards";
import { useDashboardData, useDashboardLayout } from "./useDashboard";

const SIZE_PRESETS = [
  { label: "Small", w: 3, h: 2 },
  { label: "Medium", w: 4, h: 3 },
  { label: "Large", w: 6, h: 4 },
  { label: "Wide", w: 8, h: 3 },
  { label: "Tall", w: 4, h: 6 },
  { label: "Full width", w: 12, h: 4 },
];

/** A clock for cards that read the time; once a minute is enough for them. */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

type WorkshopTarget = { cardId?: string } | null;

export default function ReportDashboard() {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { layout, isLoading, error, retry, update, updateCard, saveState } = useDashboardLayout();
  const cards = useMemo(() => layout?.cards ?? [], [layout]);
  const { data, today, failures, loading, timeZone } = useDashboardData(cards);
  const configQuery = useConfig();
  const now = useNow(30_000);
  const [adding, setAdding] = useState(false);
  const [workshop, setWorkshop] = useState<WorkshopTarget>(null);
  const openTask = useEntityDetailStore((state) => state.openTask);
  const openProject = useEntityDetailStore((state) => state.openProject);
  const setSelectedDate = useCalendarStore((state) => state.setSelectedDate);
  const setCalendarView = useCalendarStore((state) => state.setActiveView);
  const openMenu = useContextMenu();
  const taskMenu = useTaskContextMenu();
  const projectMenu = useProjectContextMenu();
  const docMenu = useDocContextMenu();
  const sheetMenu = useSheetContextMenu();

  const tasks = useMemo(() => (data.tasks ?? []) as Task[], [data.tasks]);

  /* ---------------- opening things ---------------- */

  const openEvent = useCallback(
    (start: string) => {
      setSelectedDate(new Date(start));
      setCalendarView("day");
      router.push("/calendar?view=day");
    },
    [router, setCalendarView, setSelectedDate],
  );

  const openRow = useCallback(
    (row: CardRow) => {
      if (row.entity === "task") return openTask(row.id);
      if (row.entity === "project") return openProject(row.id);
      if (row.entity === "doc" || row.entity === "sheet") return router.push(mentionHref(row.entity, row.id));
      const item = data.events?.find((entry) => entry.id === row.id);
      if (item) openEvent(item.start);
    },
    [data.events, openEvent, openProject, openTask, router],
  );

  const openItem = useCallback(
    (item: CalendarItem) => {
      if (item.taskId && (item.kind === "task" || item.kind === "taskOccurrence")) openTask(item.taskId);
      else openEvent(item.start);
    },
    [openEvent, openTask],
  );

  const rowMenu = useCallback(
    (event: ReactMouseEvent, row: CardRow) => {
      if (row.entity === "task") {
        const task = tasks.find((entry) => entry.id === row.id);
        if (task) return openMenu(event, taskMenu(task), { title: task.name });
      }
      if (row.entity === "project") {
        const project = (data.projects ?? []).find((entry) => entry.id === row.id) as Project | undefined;
        if (project) return openMenu(event, projectMenu(project), { title: project.title || "Untitled project" });
      }
      if (row.entity === "doc") {
        const doc = (data.docs ?? []).find((entry) => entry.id === row.id) as Doc | undefined;
        if (doc) return openMenu(event, docMenu(doc), { title: doc.title });
      }
      if (row.entity === "sheet") {
        const sheet = (data.sheets ?? []).find((entry) => entry.id === row.id) as Sheet | undefined;
        if (sheet) return openMenu(event, sheetMenu(sheet), { title: sheet.title });
      }
      openMenu(
        event,
        tidyEntries([
          { kind: "action", label: "Open", icon: ExternalLink, shortcut: "Enter", onSelect: () => openRow(row) },
          row.entity !== "event" && {
            kind: "action",
            label: "Copy link",
            icon: Link2,
            onSelect: () => {
              void navigator.clipboard
                .writeText(new URL(mentionHref(row.entity as "doc", row.id), window.location.origin).toString())
                .then(() => useToastStore.getState().show("Link copied"))
                .catch(() => useToastStore.getState().show("Could not copy to clipboard"));
            },
          },
        ]),
        { title: row.title },
      );
    },
    [data.docs, data.projects, data.sheets, docMenu, openMenu, openRow, projectMenu, sheetMenu, taskMenu, tasks],
  );

  /* ---------------- editing the board ---------------- */

  const addCards = (fresh: DashboardCard[]) => {
    if (cards.length + fresh.length > DASHBOARD_MAX_CARDS) {
      useToastStore.getState().show(`A dashboard holds up to ${DASHBOARD_MAX_CARDS} cards`);
      return;
    }
    update((current) => ({ ...current, cards: [...current.cards, ...fresh] }));
    // Bring the new card into view once it renders.
    window.setTimeout(() => {
      const element = document.querySelector(`[data-card-id="${fresh[0].id}"]`);
      element?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 80);
  };

  const addBuiltin = (type: BuiltinCardType) => {
    const info = builtinInfo(type)!;
    addCards([{ id: newCardId(), type, w: info.w, h: info.h, settings: info.settings ? { ...info.settings } : undefined }]);
    setAdding(false);
  };

  const addTemplate = (template: CardTemplate) => {
    addCards([{ id: newCardId(), type: "custom", title: template.title, w: template.w, h: template.h, query: template.query }]);
    setAdding(false);
  };

  const saveWorkshop = (result: WorkshopResult) => {
    const target = workshop;
    setWorkshop(null);
    if (target?.cardId) {
      updateCard(target.cardId, { title: result.title || undefined, query: result.query, w: result.w, h: result.h });
      return;
    }
    addCards([{ id: newCardId(), type: "custom", title: result.title || undefined, query: result.query, w: result.w, h: result.h }]);
  };

  const removeCard = (card: DashboardCard) => {
    const index = cards.findIndex((entry) => entry.id === card.id);
    if (card.type === "pomodoro") forgetPomodoro(card.id);
    update((current) => ({ ...current, cards: current.cards.filter((entry) => entry.id !== card.id) }));
    showUndoToast(`Removed "${cardTitle(card)}"`, () =>
      update((current) => {
        if (current.cards.some((entry) => entry.id === card.id)) return current;
        const next = [...current.cards];
        next.splice(Math.min(index, next.length), 0, card);
        return { ...current, cards: next };
      }),
    );
  };

  const moveCard = (card: DashboardCard, delta: number) =>
    update((current) => {
      const index = current.cards.findIndex((entry) => entry.id === card.id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.cards.length) return current;
      const next = [...current.cards];
      next.splice(index, 1);
      next.splice(target, 0, card);
      return { ...current, cards: next };
    });

  const [renaming, setRenaming] = useState<string | null>(null);

  const cardMenu = (card: DashboardCard, at: { x: number; y: number }) => {
    const index = cards.findIndex((entry) => entry.id === card.id);
    const min = minCardSize(card);
    const items: ContextMenuEntry[] = tidyEntries([
      card.type === "custom" && { kind: "action", label: "Edit card…", icon: SlidersHorizontal, onSelect: () => setWorkshop({ cardId: card.id }) },
      {
        kind: "action",
        label: "Rename",
        icon: Pencil,
        onSelect: () => setRenaming(card.id),
      },
      {
        kind: "submenu",
        label: "Size",
        icon: Scaling,
        items: SIZE_PRESETS.map((preset) => {
          const w = Math.max(preset.w, min.w);
          const h = Math.max(preset.h, min.h);
          return {
            kind: "action" as const,
            label: `${preset.label} (${w} × ${h})`,
            checked: card.w === w && card.h === h,
            onSelect: () => updateCard(card.id, { w, h }),
          };
        }),
      },
      { kind: "separator" },
      { kind: "action", label: "Move earlier", icon: ArrowUp, disabled: index <= 0, onSelect: () => moveCard(card, -1) },
      { kind: "action", label: "Move later", icon: ArrowDown, disabled: index >= cards.length - 1, onSelect: () => moveCard(card, 1) },
      {
        kind: "action",
        label: "Duplicate",
        icon: Copy,
        onSelect: () =>
          update((current) => {
            const at = current.cards.findIndex((entry) => entry.id === card.id);
            const next = [...current.cards];
            next.splice(at + 1, 0, { ...card, id: newCardId(), title: card.title ? `${card.title} copy` : undefined });
            return { ...current, cards: next };
          }),
      },
      { kind: "separator" },
      { kind: "action", label: "Remove from dashboard", icon: Trash2, danger: true, onSelect: () => removeCard(card) },
    ]);
    openContextMenu({ x: at.x, y: at.y, items, title: cardTitle(card) });
  };

  const boardMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenu({
      x: rect.right - 220,
      y: rect.bottom + 4,
      items: [
        { kind: "action", label: "Add card…", icon: Plus, onSelect: () => setAdding(true) },
        { kind: "action", label: "Build a custom card…", icon: SlidersHorizontal, onSelect: () => setWorkshop({}) },
        { kind: "separator" },
        {
          kind: "action",
          label: "Reset to the default layout",
          icon: RotateCcw,
          danger: true,
          onSelect: () =>
            requestConfirm({
              title: "Reset the dashboard?",
              description: "Your cards, sizes and notes on this page are replaced by the default layout.",
              confirmLabel: "Reset",
              pendingLabel: "Resetting…",
              onConfirm: () => update(() => defaultDashboard()),
            }),
        },
      ],
    });
  };

  /* ---------------- rendering cards ---------------- */

  const renderIcon = (card: DashboardCard) => {
    if (card.type === "custom") {
      const Icon = DISPLAY_ICON[card.query?.display ?? "number"];
      return <Icon className="size-3.5" />;
    }
    return <BuiltinIcon type={card.type} className="size-3.5" />;
  };

  const renderCard = (card: DashboardCard) => {
    const settings = card.settings ?? {};
    const setSettings = (next: Record<string, unknown>) => updateCard(card.id, (current) => ({ ...current, settings: { ...current.settings, ...next } }));
    switch (card.type) {
      case "custom":
        return (
          <CustomCardSlot
            card={card}
            data={data}
            timeZone={timeZone}
            now={now}
            loading={loading[card.query?.source ?? "tasks"]}
            onOpen={openRow}
            onRowContextMenu={rowMenu}
          />
        );
      case "pomodoro":
        return <PomodoroCard cardId={card.id} settings={settings} onSettings={setSettings} tasks={tasks} timeZone={timeZone} />;
      case "today":
        return <TodayCard today={today.data} loading={today.isLoading} now={now} onOpenTask={openTask} onOpenItem={openItem} />;
      case "quickCapture":
        return <QuickCaptureCard inboxCount={data.inbox?.length ?? 0} />;
      case "notes":
        return <NotesCard text={typeof settings.text === "string" ? settings.text : ""} onChange={(text) => setSettings({ text })} />;
      case "streak":
        return <StreakCard tasks={tasks} timeZone={timeZone} />;
      case "dayProgress":
        return <DayProgressCard now={now} workingHours={configQuery.data?.workingHours} timeZone={timeZone} />;
      case "matrix":
        return (
          <MatrixCard
            tasks={tasks}
            timeZone={timeZone}
            urgentDays={typeof settings.urgentDays === "number" ? settings.urgentDays : 3}
            onOpenTask={openTask}
          />
        );
      case "countdown":
        return (
          <CountdownCard
            label={typeof settings.label === "string" ? settings.label : ""}
            date={typeof settings.date === "string" ? settings.date : ""}
            timeZone={timeZone}
            onChange={setSettings}
          />
        );
      case "topThree":
        return <TopThreeCard settings={settings} tasks={tasks} timeZone={timeZone} onSettings={setSettings} onOpenTask={openTask} />;
      case "focusTime":
        return <FocusTimeCard tasks={tasks} now={now} timeZone={timeZone} />;
      case "nextUp":
        return (
          <NextUpCard
            events={data.events ?? []}
            loading={loading.events}
            now={now}
            workingHours={configQuery.data?.workingHours}
            timeZone={timeZone}
            onOpenEvent={openEvent}
          />
        );
      case "habits":
        return <HabitsCard settings={settings} timeZone={timeZone} onSettings={setSettings} />;
      case "goal":
        return <GoalCard settings={settings} tasks={tasks} now={now} timeZone={timeZone} onSettings={setSettings} />;
      case "weeklyReview":
        return <WeeklyReviewCard settings={settings} tasks={tasks} timeZone={timeZone} onSettings={setSettings} onOpenTask={openTask} />;
      case "inboxZero":
        return <InboxZeroCard inbox={(data.inbox ?? []) as Task[]} loading={loading.inbox} now={now} timeZone={timeZone} />;
      case "clock":
        return <ClockCard title={cardTitle(card)} settings={settings} onSettings={setSettings} />;
      case "journal":
        return <JournalCard settings={settings} timeZone={timeZone} onSettings={setSettings} />;
    }
  };

  const editing = workshop?.cardId ? cards.find((card) => card.id === workshop.cardId) : undefined;
  const present = useMemo(() => new Set(cards.map((card) => card.type)), [cards]);

  if (isLoading && !layout) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading your dashboard…</div>;
  }

  if (error && !layout) {
    return (
      <div className="flex h-full flex-col p-8">
        <LoadError what="your dashboard" error={error} onRetry={retry} retrying={false} />
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="report-dashboard h-full overflow-y-auto">
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-8">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold text-foreground">Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Drag a card by its title to move it, drag its edge or corner to resize.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SaveStatusBadge status={saveState} />
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Plus className="size-4" />
              Add card
            </button>
            <button
              type="button"
              onClick={boardMenu}
              className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Dashboard options"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </div>
        </div>

        {failures.length > 0 ? (
          <div className="mb-4 flex flex-col gap-2">
            {failures.map(({ what, query }) => (
              <LoadErrorBanner key={what} what={what} error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} />
            ))}
          </div>
        ) : null}

        {cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border px-6 py-20 text-center">
            <LayoutGrid className="size-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">Your dashboard is empty</p>
              <p className="mt-1 text-sm text-muted-foreground">Add a productivity tool, a ready-made chart, or build your own card.</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setAdding(true)} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
                Add card
              </button>
              <button
                type="button"
                onClick={() => update(() => defaultDashboard())}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent"
              >
                Use the default layout
              </button>
            </div>
          </div>
        ) : (
          <DashboardGrid
            renaming={renaming}
            onRenaming={setRenaming}
            cards={cards}
            renderCard={renderCard}
            renderIcon={renderIcon}
            scrollContainer={scrollRef}
            onReorder={(order) =>
              update((current) => {
                const byId = new Map(current.cards.map((card) => [card.id, card]));
                const next = order.map((id) => byId.get(id)).filter((card): card is DashboardCard => Boolean(card));
                // Cards added elsewhere mid-drag keep their place at the end.
                for (const card of current.cards) if (!order.includes(card.id)) next.push(card);
                return { ...current, cards: next };
              })
            }
            onResize={(id, size) => updateCard(id, size)}
            onMenu={cardMenu}
            onRename={(card, title) => updateCard(card.id, { title: title || undefined })}
          />
        )}
      </div>

      {adding ? (
        <AddCardDialog
          present={present}
          onClose={() => setAdding(false)}
          onAddBuiltin={addBuiltin}
          onAddTemplate={addTemplate}
          onOpenWorkshop={() => {
            setAdding(false);
            setWorkshop({});
          }}
        />
      ) : null}

      {workshop ? (
        <CardWorkshop
          key={workshop.cardId ?? "new"}
          initial={editing?.query ? { title: editing.title ?? "", query: editing.query, w: editing.w, h: editing.h } : undefined}
          data={data}
          timeZone={timeZone}
          onClose={() => setWorkshop(null)}
          onSave={saveWorkshop}
        />
      ) : null}
    </div>
  );
}

function CustomCardSlot({
  card,
  data,
  timeZone,
  now,
  loading,
  onOpen,
  onRowContextMenu,
}: {
  card: DashboardCard;
  data: ReturnType<typeof useDashboardData>["data"];
  timeZone?: string;
  now: Date;
  loading: boolean;
  onOpen: (row: CardRow) => void;
  onRowContextMenu: (event: ReactMouseEvent, row: CardRow) => void;
}) {
  const result = useCardResult(card.query, data, timeZone, now);
  if (!card.query || !result) return null;
  if (loading) return <p className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</p>;
  return <CustomCardView query={card.query} result={result} onOpen={onOpen} onRowContextMenu={onRowContextMenu} />;
}
