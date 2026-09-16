"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/app/utils/cn";
import {
  closeContextMenu,
  openContextMenu,
  useContextMenuStore,
  type ContextMenuEntry,
  type ContextMenuRequest,
} from "@/app/_store/contextMenuStore";

const EDGE_MARGIN = 8;
const MIN_WIDTH = 208;
const SUBMENU_OVERLAP = 4;

/* ------------------------------------------------------------------ */
/* Shortcut hints                                                      */
/* ------------------------------------------------------------------ */

const TOKENS: Record<string, { mac: string; other: string }> = {
  mod: { mac: "\u2318", other: "Ctrl" },
  cmd: { mac: "\u2318", other: "Ctrl" },
  ctrl: { mac: "\u2303", other: "Ctrl" },
  alt: { mac: "\u2325", other: "Alt" },
  option: { mac: "\u2325", other: "Alt" },
  shift: { mac: "\u21e7", other: "Shift" },
  enter: { mac: "\u21a9", other: "Enter" },
  backspace: { mac: "\u232b", other: "Backspace" },
  delete: { mac: "\u2326", other: "Del" },
  escape: { mac: "esc", other: "Esc" },
  space: { mac: "\u2423", other: "Space" },
  up: { mac: "\u2191", other: "\u2191" },
  down: { mac: "\u2193", other: "\u2193" },
  left: { mac: "\u2190", other: "\u2190" },
  right: { mac: "\u2192", other: "\u2192" },
};

function isMacLike() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/** Turns authoring tokens ("mod+shift+C") into the platform's glyphs. Strings
 * without a "+" pass through untouched so sequences like "G then T" read as
 * written. */
export function formatShortcut(shortcut: string): string {
  const mac = isMacLike();
  return shortcut
    .split("+")
    .map((raw) => {
      const token = raw.trim();
      const mapped = TOKENS[token.toLowerCase()];
      if (mapped) return mac ? mapped.mac : mapped.other;
      return token.length === 1 ? token.toUpperCase() : token;
    })
    .join(mac ? "" : "+");
}

/* ------------------------------------------------------------------ */
/* Call-site helpers                                                   */
/* ------------------------------------------------------------------ */

type OpenOptions = { title?: string };

/**
 * Returns an opener for right-click handlers:
 *
 *     const openMenu = useContextMenu();
 *     <tr onContextMenu={(event) => openMenu(event, items, { title: task.name })} />
 *
 * Opening is skipped for empty item lists so the browser keeps its own menu
 * where we have nothing better to offer.
 */
export function useContextMenu() {
  return useCallback(
    (
      event: ReactMouseEvent | MouseEvent,
      items: ContextMenuEntry[],
      options: OpenOptions = {},
    ) => {
      if (items.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      openContextMenu({ x: event.clientX, y: event.clientY, items, ...options });
    },
    [],
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

type Placement = { top: number; left: number; maxHeight: number };

type SubmenuAnchor = {
  index: number;
  items: ContextMenuEntry[];
  /** Right-click menus grow from the parent row, not the pointer. */
  itemTop: number;
  panelLeft: number;
  panelRight: number;
};

function focusableIndexes(items: ContextMenuEntry[]): number[] {
  return items.reduce<number[]>((out, item, index) => {
    if ((item.kind === "action" || item.kind === "submenu") && !item.disabled) out.push(index);
    return out;
  }, []);
}

type PanelProps = {
  items: ContextMenuEntry[];
  title?: string;
  /** Root menus anchor to the pointer; submenus to their parent row. */
  anchor:
    | { type: "point"; x: number; y: number }
    | { type: "row"; top: number; parentLeft: number; parentRight: number };
  onDismiss: () => void;
  onCloseSelf?: () => void;
};

function MenuPanel({ items, title, anchor, onDismiss, onCloseSelf }: PanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [submenu, setSubmenu] = useState<SubmenuAnchor | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typeAhead = useRef<{ buffer: string; at: number }>({ buffer: "", at: 0 });

  const order = focusableIndexes(items);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxHeight = viewportHeight - EDGE_MARGIN * 2;

    let left: number;
    let top: number;

    if (anchor.type === "point") {
      left = anchor.x;
      if (left + width > viewportWidth - EDGE_MARGIN) left = anchor.x - width;
      top = anchor.y;
      if (top + height > viewportHeight - EDGE_MARGIN) {
        top = Math.min(anchor.y - height, viewportHeight - EDGE_MARGIN - height);
      }
    } else {
      left = anchor.parentRight - SUBMENU_OVERLAP;
      if (left + width > viewportWidth - EDGE_MARGIN) {
        left = anchor.parentLeft - width + SUBMENU_OVERLAP;
      }
      top = anchor.top - 4;
      if (top + height > viewportHeight - EDGE_MARGIN) {
        top = viewportHeight - EDGE_MARGIN - height;
      }
    }

    setPlacement({
      top: Math.max(EDGE_MARGIN, Math.min(top, viewportHeight - EDGE_MARGIN - Math.min(height, maxHeight))),
      left: Math.max(EDGE_MARGIN, Math.min(left, viewportWidth - EDGE_MARGIN - width)),
      maxHeight,
    });
  }, [anchor, items]);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    },
    [],
  );

  const closeSubmenu = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setSubmenu(null);
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  const openSubmenuAt = useCallback((index: number, entries: ContextMenuEntry[]) => {
    const panel = panelRef.current;
    const row = itemRefs.current.get(index);
    if (!panel || !row) return;
    const panelRect = panel.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    setSubmenu({
      index,
      items: entries,
      itemTop: rowRect.top,
      panelLeft: panelRect.left,
      panelRight: panelRect.right,
    });
  }, []);

  const activate = useCallback(
    (index: number) => {
      const entry = items[index];
      if (!entry || entry.kind === "separator" || entry.kind === "heading" || entry.disabled) return;
      if (entry.kind === "submenu") {
        openSubmenuAt(index, entry.items);
        return;
      }
      // Dismiss first so the action can open a dialog or move focus without
      // the menu stealing it back.
      onDismiss();
      queueMicrotask(() => entry.onSelect());
    },
    [items, onDismiss, openSubmenuAt],
  );

  const step = useCallback(
    (delta: number) => {
      if (order.length === 0) return;
      const current = activeIndex === null ? -1 : order.indexOf(activeIndex);
      const next = current === -1
        ? delta > 0
          ? 0
          : order.length - 1
        : (current + delta + order.length) % order.length;
      setActiveIndex(order[next]);
    },
    [activeIndex, order],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        step(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        step(-1);
        return;
      case "Home":
        event.preventDefault();
        if (order.length) setActiveIndex(order[0]);
        return;
      case "End":
        event.preventDefault();
        if (order.length) setActiveIndex(order[order.length - 1]);
        return;
      case "ArrowRight": {
        const entry = activeIndex === null ? null : items[activeIndex];
        if (entry?.kind === "submenu" && !entry.disabled && activeIndex !== null) {
          event.preventDefault();
          openSubmenuAt(activeIndex, entry.items);
        }
        return;
      }
      case "ArrowLeft":
        if (onCloseSelf) {
          event.preventDefault();
          onCloseSelf();
        }
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (activeIndex !== null) activate(activeIndex);
        return;
      case "Escape":
        event.preventDefault();
        if (onCloseSelf) onCloseSelf();
        else onDismiss();
        return;
      case "Tab":
        event.preventDefault();
        onDismiss();
        return;
      default:
        break;
    }

    // Type-ahead: jump to the next row starting with what was typed. Keeps long
    // project/status submenus usable without the mouse.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now();
      const state = typeAhead.current;
      state.buffer = now - state.at > 700 ? event.key : state.buffer + event.key;
      state.at = now;
      const needle = state.buffer.toLowerCase();

      const rotated = activeIndex === null ? order : [
        ...order.slice(order.indexOf(activeIndex) + 1),
        ...order.slice(0, order.indexOf(activeIndex) + 1),
      ];
      const hit = rotated.find((index) => {
        const entry = items[index];
        if (entry.kind !== "action" && entry.kind !== "submenu") return false;
        return entry.label.toLowerCase().startsWith(needle);
      });
      if (hit !== undefined) {
        event.preventDefault();
        setActiveIndex(hit);
      }
    }
  };

  useEffect(() => {
    if (activeIndex === null) return;
    itemRefs.current.get(activeIndex)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <>
      <div
        ref={panelRef}
        role="menu"
        tabIndex={-1}
        aria-label={title}
        data-context-menu="true"
        onKeyDown={onKeyDown}
        onContextMenu={(event) => event.preventDefault()}
        className={cn(
          "fixed z-[120] min-w-52 overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl ring-1 ring-foreground/10 outline-none",
          placement ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        style={{
          top: placement?.top ?? 0,
          left: placement?.left ?? 0,
          minWidth: MIN_WIDTH,
          maxHeight: placement?.maxHeight,
        }}
      >
        {title ? (
          <p className="truncate border-b border-border/70 px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
        ) : null}

        {items.map((entry, index) => {
          if (entry.kind === "separator") {
            return <div key={`sep-${index}`} role="separator" className="my-1 h-px bg-border/70" />;
          }

          if (entry.kind === "heading") {
            return (
              <p
                key={`head-${index}`}
                className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {entry.label}
              </p>
            );
          }

          const Icon = entry.icon;
          const isSubmenu = entry.kind === "submenu";
          const active = activeIndex === index || submenu?.index === index;

          return (
            <button
              key={`${entry.label}-${index}`}
              ref={(element) => {
                if (element) itemRefs.current.set(index, element);
                else itemRefs.current.delete(index);
              }}
              type="button"
              role="menuitem"
              disabled={entry.disabled}
              aria-haspopup={isSubmenu ? "menu" : undefined}
              aria-expanded={isSubmenu ? submenu?.index === index : undefined}
              onMouseEnter={() => {
                if (entry.disabled) return;
                setActiveIndex(index);
                if (hoverTimer.current) clearTimeout(hoverTimer.current);
                if (isSubmenu) {
                  hoverTimer.current = setTimeout(() => openSubmenuAt(index, entry.items), 90);
                } else if (submenu) {
                  hoverTimer.current = setTimeout(() => setSubmenu(null), 90);
                }
              }}
              onClick={() => activate(index)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                entry.disabled && "cursor-not-allowed opacity-40",
                !entry.disabled &&
                  (entry.kind === "action" && entry.danger
                    ? active
                      ? "bg-destructive/12 text-destructive"
                      : "text-destructive hover:bg-destructive/10"
                    : active
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/70"),
              )}
            >
              {entry.kind === "action" && entry.color ? (
                <span
                  className="size-2.5 shrink-0 rounded-full ring-1 ring-foreground/10"
                  style={{ backgroundColor: entry.color }}
                  aria-hidden
                />
              ) : Icon ? (
                <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden />
              ) : (
                <span className="size-3.5 shrink-0" aria-hidden />
              )}

              <span className="min-w-0 flex-1 truncate">{entry.label}</span>

              {entry.kind === "action" && entry.checked ? (
                <Check className="size-3.5 shrink-0 text-primary" aria-hidden />
              ) : null}

              {entry.kind === "action" && entry.shortcut ? (
                <span className="shrink-0 font-mono text-[11px] tracking-tight text-muted-foreground tabular-nums">
                  {formatShortcut(entry.shortcut)}
                </span>
              ) : null}

              {isSubmenu ? (
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              ) : null}
            </button>
          );
        })}
      </div>

      {submenu
        ? createPortal(
            <MenuPanel
              items={submenu.items}
              anchor={{
                type: "row",
                top: submenu.itemTop,
                parentLeft: submenu.panelLeft,
                parentRight: submenu.panelRight,
              }}
              onDismiss={onDismiss}
              onCloseSelf={closeSubmenu}
            />,
            document.body,
          )
        : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Host                                                                */
/* ------------------------------------------------------------------ */

/** Mounted once per app shell; renders whichever menu the store holds. */
export default function ContextMenuHost() {
  const menu = useContextMenuStore((state) => state.menu);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!menu) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    const openedId = menu.id;

    const isInsideMenu = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest("[data-context-menu]"));

    const onPointerDown = (event: MouseEvent) => {
      if (isInsideMenu(event.target)) return;
      closeContextMenu();
    };

    // A right-click elsewhere either opens a different menu (the surface
    // handler already ran and bumped the id) or simply dismisses this one.
    const onContextMenuEvent = (event: MouseEvent) => {
      if (isInsideMenu(event.target)) return;
      if (useContextMenuStore.getState().menu?.id !== openedId) return;
      closeContextMenu();
    };

    const onScroll = (event: Event) => {
      if (isInsideMenu(event.target)) return;
      closeContextMenu();
    };

    const onBlur = () => closeContextMenu();

    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("contextmenu", onContextMenuEvent);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onBlur);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("contextmenu", onContextMenuEvent);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onBlur);
      window.removeEventListener("blur", onBlur);
    };
  }, [menu]);

  const dismiss = useCallback(() => {
    closeContextMenu();
    const previous = restoreFocus.current;
    if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
  }, []);

  if (!menu || typeof document === "undefined") return null;

  return createPortal(
    <MenuPanel
      key={menu.id}
      items={menu.items}
      title={menu.title}
      anchor={{ type: "point", x: menu.x, y: menu.y }}
      onDismiss={dismiss}
    />,
    document.body,
  );
}

export type { ContextMenuEntry, ContextMenuRequest };
