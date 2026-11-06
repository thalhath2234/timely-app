"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { Check, ChevronLeft, ChevronRight, FolderKanban, Inbox, Plus, Search, Sparkle } from "lucide-react";
import Button from "@/app/_components/_ui/button";
import { cn } from "@/app/utils/cn";

/** Room the popover leaves between itself and the row's disc, for its arrow. */
const ARROW_GAP = 12;
const WIDTH = 320;

/** The open "Make task" offer of one row (offerMarks.ts draws its disc). A
 * wide page shows it as a popover left of the disc, over the empty end of the
 * text column; it opens below the row when the row's own words reach under
 * it. A narrow page shows it as a card in flow under the row. Every element
 * is a span: it renders inside the row's paragraph. */
export default function OfferPopover({
  offerKey,
  kind,
  name,
  details,
  target,
  targetId,
  places,
  onTarget,
  chooser,
  onChooser,
  step,
  busy,
  writing,
  disabled,
  onMake,
  onDismiss,
  onClose,
  onLeaveWithFocus,
  focus,
  editor,
  variant,
}: {
  offerKey: string;
  kind: "todo" | "work";
  name: string;
  details?: string;
  /** The name of where its task goes: the Inbox or a project. */
  target: string;
  /** Where it goes as a pick: "inbox" or the project's id. */
  targetId: string;
  /** The projects it can go to instead, and a pick for this task alone. */
  places: { id: string; title: string; color?: string }[];
  onTarget: (id: string) => void;
  /** The "Goes to" chooser while it is open, with what is typed in its
   * search box. Kept by DocHints: a redraw of the row (a hover does it)
   * draws the popover afresh, which would lose them here. */
  chooser: { query: string } | null;
  onChooser: (chooser: { query: string } | null) => void;
  /** Where it is among the doc's offers, with the previous and next. */
  step?: { index: number; total: number; prev: (() => void) | null; next: (() => void) | null };
  busy: boolean;
  /** The AI is writing the task's title. */
  writing: boolean;
  /** Another task is being made. */
  disabled: boolean;
  onMake: () => void;
  onDismiss: () => void;
  onClose: () => void;
  /** It went away with focus in it; focus goes back where it came from. */
  onLeaveWithFocus: () => void;
  /** What takes focus as it opens: the arrow that stepped to it, or the
   * popover itself; none when it opened from a click on the row's disc,
   * which leaves the caret in the text. */
  focus: "dialog" | "prev" | "next" | null;
  editor: Editor;
  variant: "popover" | "card";
}) {
  const root = useRef<HTMLSpanElement>(null);
  const prevButton = useRef<HTMLButtonElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  // How far below the disc's top the popover starts when it sits under the row.
  const [below, setBelow] = useState<number | null>(null);
  // Whether focus is in it. A button turning disabled (Make task while it
  // works) drops focus to the page without it moving on, so this stays set
  // until focus lands somewhere else.
  const holdsFocus = useRef(false);
  const goesToButton = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const choosing = chooser !== null;
  const query = chooser?.query ?? "";
  const leave = useRef(onLeaveWithFocus);
  useEffect(() => {
    leave.current = onLeaveWithFocus;
  }, [onLeaveWithFocus]);

  // Focus goes in as it opens, without scrolling: the row is being scrolled
  // into view. A disabled arrow (the last step) hands it to the popover.
  useLayoutEffect(() => {
    const moved = (event: FocusEvent) => {
      holdsFocus.current = event.target instanceof Node && Boolean(root.current?.contains(event.target));
    };
    document.addEventListener("focusin", moved);
    const button = focus === "prev" ? prevButton.current : focus === "next" ? nextButton.current : null;
    if (button && !button.disabled) button.focus({ preventScroll: true });
    else if (focus) root.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("focusin", moved);
      if (holdsFocus.current) leave.current();
    };
    // Only as it opens: a step opens a new popover.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc or a press anywhere else closes it; the row's own disc and its rail
  // row toggle or keep it themselves.
  useEffect(() => {
    const down = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (root.current?.contains(target)) return;
      if (target.closest("[data-offer-anchor]")?.getAttribute("data-offer-anchor") === offerKey) return;
      if (target.closest("[data-offer-trigger]")?.getAttribute("data-offer-trigger") === offerKey) return;
      // Focus goes where the press lands.
      holdsFocus.current = false;
      onClose();
    };
    // Esc in the chooser goes back to the offer; only then does it close.
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (choosing) {
        event.preventDefault();
        event.stopPropagation();
        onChooser(null);
      } else onClose();
    };
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [offerKey, onClose, onChooser, choosing]);

  // Focus goes to the search box as the chooser opens (or is drawn again
  // open), and back to the Goes to row as it closes.
  const wasChoosing = useRef(choosing);
  useLayoutEffect(() => {
    if (choosing) search.current?.focus({ preventScroll: true });
    else if (wasChoosing.current) goesToButton.current?.focus({ preventScroll: true });
    wasChoosing.current = choosing;
  }, [choosing]);

  // Beside the row unless the row's words reach under it; read again as the
  // text is edited or rewraps.
  useLayoutEffect(() => {
    if (variant !== "popover") return;
    const place = () => {
      const pop = root.current;
      const anchor = pop?.parentElement;
      const line = anchor?.parentElement;
      if (!pop || !anchor || !line) return;
      const disc = anchor.getBoundingClientRect();
      const left = disc.left - ARROW_GAP - WIDTH;
      const top = disc.top - 12;
      const bottom = top + pop.offsetHeight;
      let reaches = false;
      let lineBottom = disc.bottom;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (anchor.contains(node)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          lineBottom = Math.max(lineBottom, rect.bottom);
          if (rect.right > left - 4 && rect.bottom > top && rect.top < bottom) reaches = true;
        }
      }
      setBelow(reaches ? Math.round(lineBottom - disc.top + 8) : null);
    };
    place();
    const observer = new ResizeObserver(place);
    const line = root.current?.parentElement?.parentElement;
    if (line) observer.observe(line);
    editor.on("update", place);
    return () => {
      observer.disconnect();
      editor.off("update", place);
    };
  }, [editor, variant]);

  const eyebrow = (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase leading-4 tracking-[0.08em] text-muted-foreground">
      <Sparkle className="size-3 shrink-0 fill-current text-primary" aria-hidden />
      <span className="truncate">{kind === "todo" ? "Checklist item" : "Reads like a task"}</span>
    </span>
  );
  const body = (
    <>
      <span className="flex min-h-7 items-center gap-1">
        {eyebrow}
        <span className="flex-1" />
        {step && step.total > 1 && (
          <>
            <span className="mr-1 text-xs tabular-nums text-muted-foreground">
              {step.index + 1} of {step.total}
            </span>
            <Button ref={prevButton} size="sm" variant="ghost" icon aria-label="Previous" disabled={!step.prev} onClick={() => step.prev?.()}>
              <ChevronLeft />
            </Button>
            <Button ref={nextButton} size="sm" variant="ghost" icon className="-mr-1.5" aria-label="Next" disabled={!step.next} onClick={() => step.next?.()}>
              <ChevronRight />
            </Button>
          </>
        )}
      </span>
      <span className="mt-1 line-clamp-3 block text-sm font-semibold leading-5 text-foreground" title={name}>
        {name}
      </span>
      {details && <span className="mt-1 line-clamp-2 block text-xs leading-4 text-muted-foreground">{details}</span>}
      {/* The divider is the wrapper's, square, as wide as the text; the
          button's rounded fill sits inside it. */}
      <span className="mt-2.5 block border-t border-border pt-0.5">
        <button
          ref={goesToButton}
          type="button"
          aria-label={`Goes to, ${target}. Changes only this task`}
          className="-mx-1.5 flex h-9 w-[calc(100%+0.75rem)] items-center justify-between gap-3 rounded-[10px] px-1.5 text-[13px] outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring/30"
          onClick={() => onChooser({ query: "" })}
        >
          <span className="shrink-0 text-muted-foreground">Goes to</span>
          <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
            {targetId === "inbox" ? <Inbox className="size-3.5 shrink-0" aria-hidden /> : <Dot color={places.find((p) => p.id === targetId)?.color} />}
            <span className="truncate">{target}</span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </span>
        </button>
      </span>
      <span className="flex items-center justify-end gap-1.5 pt-0.5">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss}>
          Dismiss
        </Button>
        <Button size="sm" variant="primary" leading={<Plus />} loading={busy} disabled={disabled} onClick={onMake}>
          {writing ? "Writing…" : "Make task"}
        </Button>
      </span>
    </>
  );

  const needle = query.trim().toLowerCase();
  const shown = places.filter((place) => !needle || place.title.toLowerCase().includes(needle));
  const inboxShown = !needle || "inbox".includes(needle);
  const choose = (id: string) => {
    onTarget(id);
    onChooser(null);
  };
  // The arrows move through the places, from the search box down and back up.
  const move = (event: ReactKeyboardEvent<HTMLElement>, from: number) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const pop = event.currentTarget.closest(".doc-offer-pop");
    const all = [...(pop?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? [])];
    const to = from + (event.key === "ArrowDown" ? 1 : -1);
    if (to < 0) pop?.querySelector<HTMLInputElement>("input")?.focus();
    else all[Math.min(to, all.length - 1)]?.focus();
  };
  const option = (id: string, label: string, lead: ReactNode, index: number) => (
    <button
      key={id}
      type="button"
      role="option"
      aria-selected={id === targetId}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground outline-none hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.08]",
        id === targetId && "bg-foreground/[0.05]",
      )}
      onKeyDown={(event) => move(event, index)}
      onClick={() => choose(id)}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{lead}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {id === targetId && <Check className="size-3.5 shrink-0 text-primary" aria-hidden />}
    </button>
  );
  const chooserView = (
    <>
      <span className="flex min-h-7 items-center gap-1">
        <Button size="sm" variant="ghost" icon className="-ml-1.5" aria-label="Back" onClick={() => onChooser(null)}>
          <ChevronLeft />
        </Button>
        <span className="text-[13px] font-semibold text-foreground">Goes to</span>
        <span className="flex-1" />
        <span className="truncate text-xs text-muted-foreground">{name}</span>
      </span>
      <span className="relative mt-1.5 block">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          ref={search}
          value={query}
          onChange={(event) => onChooser({ query: event.target.value })}
          onKeyDown={(event) => {
            // Enter takes the first place shown.
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.closest(".doc-offer-pop")?.querySelector<HTMLButtonElement>("[role=option]")?.click();
            } else move(event, -1);
          }}
          placeholder="Find a project"
          aria-label="Find a project"
          aria-controls={listId}
          className="h-8 w-full rounded-md bg-muted/60 pl-7 pr-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </span>
      <span id={listId} role="listbox" aria-label="Places" className="mt-1 block max-h-56 overflow-y-auto">
        {inboxShown && option("inbox", "Inbox", <Inbox className="size-3.5 text-muted-foreground" aria-hidden />, 0)}
        {shown.length > 0 && (
          <span role="presentation" className="block px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
            Projects
          </span>
        )}
        {shown.map((place, i) => option(place.id, place.title, <Dot color={place.color} />, i + (inboxShown ? 1 : 0)))}
        {!inboxShown && shown.length === 0 && <span className="block px-2 py-1.5 text-sm text-muted-foreground">No matches</span>}
      </span>
      <span className="mt-1 block border-t border-border px-2 pt-2 text-xs leading-4 text-muted-foreground">
        Changes only this task. The doc’s Goes to sets it for every offer in it.
      </span>
    </>
  );

  return (
    <span
      ref={root}
      role="dialog"
      tabIndex={-1}
      aria-label={`Make task: ${name}`}
      className={cn("doc-offer-pop", variant === "card" ? "is-card" : below !== null && "is-below")}
      style={variant === "popover" && below !== null ? { top: below } : undefined}
    >
      {variant === "popover" && below === null && <span aria-hidden className="doc-offer-pop-arrow" />}
      {choosing ? chooserView : body}
    </span>
  );
}

function Dot({ color }: { color?: string }) {
  return color ? <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} /> : <FolderKanban className="size-3.5 shrink-0" aria-hidden />;
}
