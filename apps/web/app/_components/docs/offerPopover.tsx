"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { ChevronLeft, ChevronRight, FolderKanban, Inbox, Plus, Sparkle } from "lucide-react";
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
  /** The project its task goes to; none means the Inbox. */
  target?: string;
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
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", down, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [offerKey, onClose]);

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
      <span className="mt-2.5 flex h-9 items-center justify-between gap-3 border-t border-border text-[13px]">
        <span className="shrink-0 text-muted-foreground">Goes to</span>
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
          {target ? <FolderKanban className="size-3.5 shrink-0" aria-hidden /> : <Inbox className="size-3.5 shrink-0" aria-hidden />}
          <span className="truncate">{target ?? "Inbox"}</span>
        </span>
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
      {body}
    </span>
  );
}
