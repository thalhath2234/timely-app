"use client";

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { GripVertical, MoreHorizontal } from "lucide-react";
import { DASHBOARD_COLUMNS, DASHBOARD_MAX_ROWS, cardTitle, minCardSize, type DashboardCard } from "@timely/contract/dashboard";
import { springSnappy } from "@/app/_components/_ui/motion";
import { cn } from "@/app/utils/cn";
import { useElementSize } from "./charts";

/** Holds the drag or resize cursor on the whole page, and stops text selection, while a card moves. */
function setPageDragStyle(cursor: string | null) {
  document.body.style.cursor = cursor ?? "";
  document.body.style.userSelect = cursor ? "none" : "";
}

export const ROW_HEIGHT = 80;
export const GRID_GAP = 12;

/** Columns for the board's width: the full 12 on a wide window, 6 on a narrow one, 1 on a phone. */
export function columnsFor(width: number) {
  if (width >= 900) return DASHBOARD_COLUMNS;
  if (width >= 560) return 6;
  return 1;
}

function spanFor(w: number, columns: number) {
  if (columns === DASHBOARD_COLUMNS) return w;
  if (columns === 1) return 1;
  return Math.min(columns, Math.max(2, Math.round((w * columns) / DASHBOARD_COLUMNS)));
}

/**
 * What a drag needs to render. The pointer position is not in here: the
 * floating copy follows the pointer through its style, so a move re-renders
 * the board only when the order changes.
 */
type DragState = {
  id: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  /** Where the pointer was when the drag started, for the floating copy's first frame. */
  startX: number;
  startY: number;
  width: number;
  height: number;
  order: string[];
};

type ResizeState = {
  id: string;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  axis: "both" | "x" | "y";
  w: number;
  h: number;
};

export default function DashboardGrid({
  cards,
  renderCard,
  renderIcon,
  onReorder,
  onResize,
  onMenu,
  onRename,
  renaming,
  onRenaming: setRenaming,
  scrollContainer,
}: {
  cards: DashboardCard[];
  renderCard: (card: DashboardCard) => ReactNode;
  renderIcon: (card: DashboardCard) => ReactNode;
  onReorder: (order: string[]) => void;
  onResize: (id: string, size: { w: number; h: number }) => void;
  onMenu: (card: DashboardCard, at: { x: number; y: number }) => void;
  onRename: (card: DashboardCard, title: string) => void;
  /** The card whose title is being edited in place. */
  renaming: string | null;
  onRenaming: (id: string | null) => void;
  scrollContainer: React.RefObject<HTMLElement | null>;
}) {
  const [gridRef, gridSize] = useElementSize<HTMLDivElement>();
  const columns = columnsFor(gridSize.width || 1200);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [resize, setResize] = useState<ResizeState | null>(null);
  const lastTarget = useRef<string | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);

  const byId = new Map(cards.map((card) => [card.id, card]));
  const ordered = drag ? drag.order.map((id) => byId.get(id)).filter((card): card is DashboardCard => Boolean(card)) : cards;

  /* ---------------- drag to reorder ---------------- */

  const startDrag = (event: React.PointerEvent, card: DashboardCard) => {
    if (event.button !== 0 || renaming) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select, a")) return;
    const element = (event.currentTarget as HTMLElement).closest<HTMLElement>("[data-card-id]");
    if (!element) return;
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    const next: DragState = {
      id: card.id,
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: Math.min(rect.height, 220),
      order: cards.map((entry) => entry.id),
    };
    pointer.current = { x: event.clientX, y: event.clientY };
    lastTarget.current = null;
    dragRef.current = next;
    setDrag(next);
  };

  const finishDrag = useCallback(
    (commit: boolean) => {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!current || !commit) return;
      const before = cards.map((card) => card.id).join("|");
      if (current.order.join("|") !== before) onReorder(current.order);
    },
    [cards, onReorder],
  );

  useEffect(() => {
    if (!drag) return;
    // Pointer moves only record where the pointer is; one animation frame
    // moves the floating copy, looks for a card under the pointer and
    // scrolls the board, however many moves arrive in between.
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== dragRef.current?.pointerId) return;
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    let last = { x: Number.NaN, y: Number.NaN, scrollTop: Number.NaN };
    const hitTest = (current: DragState, x: number, y: number) => {
      const hit = document
        .elementsFromPoint(x, y)
        .map((element) => (element as HTMLElement).closest<HTMLElement>("[data-card-id]"))
        .find((element) => element && element.dataset.cardId !== current.id);
      const targetId = hit?.dataset.cardId ?? null;
      // Swap once per target: after the move the target may still sit under
      // the pointer, and swapping back would make the cards flicker.
      if (targetId && targetId !== lastTarget.current) {
        const from = current.order.indexOf(current.id);
        const to = current.order.indexOf(targetId);
        if (from >= 0 && to >= 0 && from !== to) {
          const order = [...current.order];
          order.splice(from, 1);
          order.splice(to, 0, current.id);
          const next = { ...current, order };
          dragRef.current = next;
          setDrag(next);
        }
      }
      lastTarget.current = targetId;
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId === dragRef.current?.pointerId) finishDrag(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finishDrag(false);
    };
    let frame = 0;
    const onFrame = () => {
      const current = dragRef.current;
      const { x, y } = pointer.current;
      // Scroll the board while a card is held near its top or bottom edge.
      const container = scrollContainer.current;
      const scrollTop = container?.scrollTop ?? 0;
      if (container) {
        const rect = container.getBoundingClientRect();
        const edge = 72;
        if (y < rect.top + edge) container.scrollTop -= Math.ceil(((rect.top + edge - y) / edge) * 14);
        else if (y > rect.bottom - edge) container.scrollTop += Math.ceil(((y - (rect.bottom - edge)) / edge) * 14);
      }
      // A scrolling board brings new cards under a still pointer.
      if (current && (x !== last.x || y !== last.y || scrollTop !== last.scrollTop)) {
        last = { x, y, scrollTop };
        const ghost = ghostRef.current;
        if (ghost) ghost.style.transform = ghostTransform(x - current.offsetX, y - current.offsetY);
        hitTest(current, x, y);
      }
      frame = window.requestAnimationFrame(onFrame);
    };
    frame = window.requestAnimationFrame(onFrame);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);
    setPageDragStyle("grabbing");
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
      setPageDragStyle(null);
    };
    // Only (re)subscribe when a drag starts or ends, not on every move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id, finishDrag, scrollContainer]);

  /* ---------------- drag to resize ---------------- */

  const columnUnit = (gridSize.width + GRID_GAP) / columns;
  const rowUnit = ROW_HEIGHT + GRID_GAP;
  const canResize = columns > 1;

  const startResize = (event: React.PointerEvent, card: DashboardCard, axis: ResizeState["axis"]) => {
    if (event.button !== 0 || !canResize) return;
    event.preventDefault();
    event.stopPropagation();
    const next: ResizeState = { id: card.id, startX: event.clientX, startY: event.clientY, startW: card.w, startH: card.h, axis, w: card.w, h: card.h };
    resizeRef.current = next;
    setResize(next);
  };

  useEffect(() => {
    if (!resize) return;
    const card = cards.find((entry) => entry.id === resize.id);
    if (!card) return;
    const min = minCardSize(card);
    // On the 6-column board one column is two of the saved twelve.
    const scale = DASHBOARD_COLUMNS / columns;
    const onMove = (event: PointerEvent) => {
      const current = resizeRef.current;
      if (!current) return;
      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;
      const w =
        current.axis === "y"
          ? current.startW
          : Math.min(DASHBOARD_COLUMNS, Math.max(min.w, Math.round(current.startW + (dx / columnUnit) * scale)));
      const h = current.axis === "x" ? current.startH : Math.min(DASHBOARD_MAX_ROWS, Math.max(min.h, Math.round(current.startH + dy / rowUnit)));
      if (w === current.w && h === current.h) return;
      const next = { ...current, w, h };
      resizeRef.current = next;
      setResize(next);
    };
    const onUp = () => {
      const current = resizeRef.current;
      resizeRef.current = null;
      setResize(null);
      if (current && (current.w !== current.startW || current.h !== current.startH)) onResize(current.id, { w: current.w, h: current.h });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    setPageDragStyle(resize.axis === "x" ? "ew-resize" : resize.axis === "y" ? "ns-resize" : "nwse-resize");
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setPageDragStyle(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resize?.id, columns, columnUnit, rowUnit]);

  const dragged = drag ? byId.get(drag.id) : null;

  return (
    <>
      <div
        ref={gridRef}
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridAutoRows: ROW_HEIGHT,
          // Smaller cards later in the order fill gaps a wide card leaves behind.
          gridAutoFlow: "row dense",
          gap: GRID_GAP,
        }}
      >
        {ordered.map((card) => {
          const size = resize?.id === card.id ? { w: resize.w, h: resize.h } : { w: card.w, h: card.h };
          const isDragged = drag?.id === card.id;
          const isResizing = resize?.id === card.id;
          return (
            <motion.section
              key={card.id}
              layout="position"
              transition={springSnappy}
              data-card-id={card.id}
              aria-label={cardTitle(card)}
              className={cn(
                "group/card relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card",
                isDragged ? "border-dashed border-primary/60 bg-accent/30" : "border-border",
                isResizing && "ring-2 ring-primary/40",
              )}
              style={{
                gridColumn: `span ${spanFor(size.w, columns)} / span ${spanFor(size.w, columns)}`,
                gridRow: `span ${size.h} / span ${size.h}`,
              }}
            >
              <header
                className={cn("flex h-9 shrink-0 cursor-grab items-center gap-1.5 pl-2 pr-1.5 active:cursor-grabbing", isDragged && "opacity-0")}
                onPointerDown={(event) => startDrag(event, card)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onMenu(card, { x: event.clientX, y: event.clientY });
                }}
                onDoubleClick={(event) => {
                  if ((event.target as HTMLElement).closest("button")) return;
                  setRenaming(card.id);
                }}
              >
                <GripVertical className="size-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover/card:text-muted-foreground" aria-hidden />
                <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">{renderIcon(card)}</span>
                {renaming === card.id ? (
                  <RenameInput
                    initial={cardTitle(card)}
                    onDone={(title) => {
                      setRenaming(null);
                      if (title !== null) onRename(card, title);
                    }}
                  />
                ) : (
                  <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={cardTitle(card)}>
                    {cardTitle(card)}
                  </h2>
                )}
                <button
                  type="button"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    onMenu(card, { x: rect.left, y: rect.bottom + 4 });
                  }}
                  className="rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/card:opacity-100"
                  aria-label={`Options for ${cardTitle(card)}`}
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </header>
              <div className={cn("min-h-0 flex-1 px-3 pb-3", isDragged && "invisible")}>
                <CardBody card={card} render={renderCard} />
              </div>

              {canResize && !isDragged ? (
                <>
                  <div
                    className="absolute inset-y-3 right-0 w-1.5 cursor-ew-resize"
                    onPointerDown={(event) => startResize(event, card, "x")}
                    aria-hidden
                  />
                  <div
                    className="absolute inset-x-3 bottom-0 h-1.5 cursor-ns-resize"
                    onPointerDown={(event) => startResize(event, card, "y")}
                    aria-hidden
                  />
                  <div
                    role="separator"
                    aria-label={`Resize ${cardTitle(card)}`}
                    title="Drag to resize"
                    className="absolute bottom-0 right-0 flex size-5 cursor-nwse-resize items-end justify-end p-1 opacity-0 transition-opacity group-hover/card:opacity-100"
                    onPointerDown={(event) => startResize(event, card, "both")}
                  >
                    <svg viewBox="0 0 8 8" className="size-2 text-muted-foreground" aria-hidden>
                      <path d="M7 1 1 7M7 4 4 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  </div>
                </>
              ) : null}
              {isResizing ? (
                <span className="pointer-events-none absolute bottom-2 right-6 rounded-md bg-foreground px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-background">
                  {size.w} × {size.h}
                </span>
              ) : null}
            </motion.section>
          );
        })}
      </div>

      {drag && dragged && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={ghostRef}
              className="pointer-events-none fixed left-0 top-0 z-[80] flex flex-col rounded-xl border border-primary/50 bg-card shadow-xl will-change-transform"
              style={{
                width: drag.width,
                height: drag.height,
                // Fixed for the whole drag, so a re-render never moves it back; the frame loop moves it.
                transform: ghostTransform(drag.startX - drag.offsetX, drag.startY - drag.offsetY),
              }}
            >
              <div className="flex h-9 items-center gap-1.5 px-2">
                <GripVertical className="size-3.5 text-muted-foreground" />
                <span className="flex size-4 items-center justify-center text-muted-foreground">{renderIcon(dragged)}</span>
                <span className="truncate text-sm font-medium text-foreground">{cardTitle(dragged)}</span>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function ghostTransform(x: number, y: number) {
  return `translate3d(${x}px, ${y}px, 0) rotate(1.2deg)`;
}

/**
 * A card's contents, skipped when only the board's order or another card's
 * size changes, so moving one card doesn't redraw every chart.
 */
const CardBody = memo(function CardBody({ card, render }: { card: DashboardCard; render: (card: DashboardCard) => ReactNode }) {
  return render(card);
});

function RenameInput({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (title: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(title);
  };
  return (
    <input
      autoFocus
      value={value}
      onChange={(event) => setValue(event.target.value.slice(0, 120))}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => finish(value.trim())}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(value.trim());
        if (event.key === "Escape") finish(null);
      }}
      aria-label="Card name"
      className="min-w-0 flex-1 rounded border border-ring bg-background px-1 text-sm font-medium text-foreground outline-none"
    />
  );
}
