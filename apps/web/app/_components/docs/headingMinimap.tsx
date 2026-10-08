"use client";

import { Editor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

interface HeadingEntry {
  pos: number;
  level: number;
  text: string;
}

/** Line widths from small to large. */
const LINE_WIDTHS = ["w-2.5", "w-4", "w-6"];

/** How far below the top of the scroll area a heading still counts as the
 * one being read. */
const ACTIVE_OFFSET = 80;

function readHeadings(editor: Editor): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return true;
    headings.push({
      pos,
      level: Number(node.attrs.level) || 1,
      text: node.textContent.trim(),
    });
    return false;
  });
  return headings;
}

/** With all three levels, H1, H2 and H3 get the large, medium and small line.
 * With fewer levels the sizes count up from small, so one level is all small
 * and two levels use medium for the higher one and small for the lower. */
function widthsByLevel(headings: HeadingEntry[]) {
  const levels = [...new Set(headings.map((heading) => heading.level))].sort(
    (a, b) => a - b,
  );
  return new Map(
    levels.map((level, rank) => [level, LINE_WIDTHS[levels.length - 1 - rank]]),
  );
}

function scrollParent(element: HTMLElement | null): HTMLElement | null {
  let current = element?.parentElement ?? null;
  while (current) {
    const { overflowY } = getComputedStyle(current);
    if (overflowY === "auto" || overflowY === "scroll") return current;
    current = current.parentElement;
  }
  return null;
}

function headingElement(editor: Editor, pos: number) {
  const dom = editor.view.nodeDOM(pos);
  return dom instanceof HTMLElement ? dom : null;
}

/** A strip of lines at the edge of a doc, one per H1–H3, that jumps to the
 * heading on click and shows its text on hover. */
export default function HeadingMinimap({ editor }: { editor: Editor | null }) {
  const [activePos, setActivePos] = useState<number | null>(null);

  // Transactions also cover remote reloads, which skip the update event. The
  // snapshot is a string so unrelated edits do not re-render the strip.
  const subscribe = useCallback(
    (onChange: () => void) => {
      editor?.on("transaction", onChange);
      return () => {
        editor?.off("transaction", onChange);
      };
    },
    [editor],
  );
  const headingsKey = useSyncExternalStore(
    subscribe,
    () => (editor && !editor.isDestroyed ? JSON.stringify(readHeadings(editor)) : "[]"),
    () => "[]",
  );
  const headings = useMemo(
    () => JSON.parse(headingsKey) as HeadingEntry[],
    [headingsKey],
  );

  const updateActive = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    const container = scrollParent(editor.view.dom);
    const top = (container?.getBoundingClientRect().top ?? 0) + ACTIVE_OFFSET;
    let active: number | null = headings[0]?.pos ?? null;
    for (const heading of headings) {
      const element = headingElement(editor, heading.pos);
      if (!element) continue;
      if (element.getBoundingClientRect().top <= top) active = heading.pos;
      else break;
    }
    setActivePos(active);
  }, [editor, headings]);

  useEffect(() => {
    if (!editor) return;
    let frame = requestAnimationFrame(updateActive);
    const handleScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateActive);
    };
    const container = scrollParent(editor.view.dom);
    container?.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      container?.removeEventListener("scroll", handleScroll);
    };
  }, [editor, updateActive]);

  if (!editor || headings.length === 0) return null;

  const widths = widthsByLevel(headings);
  const spacing = headings.length > 30 ? "py-0.5" : "py-1";

  return (
    <nav
      aria-label="Headings"
      className="absolute right-3 top-1/2 z-20 flex -translate-y-1/2 flex-col items-end"
    >
      {headings.map((heading) => {
        const isActive = heading.pos === activePos;
        return (
          <button
            key={heading.pos}
            type="button"
            aria-label={heading.text || `Heading ${heading.level}`}
            aria-current={isActive ? "location" : undefined}
            onClick={() => {
              headingElement(editor, heading.pos)?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
              setActivePos(heading.pos);
            }}
            className={`group relative flex cursor-pointer items-center justify-end pl-2 ${spacing}`}
          >
            <span
              className={`block h-0.5 rounded-full transition-colors ${
                widths.get(heading.level) ?? LINE_WIDTHS[0]
              } ${
                isActive
                  ? "bg-foreground"
                  : "bg-muted-foreground/40 group-hover:bg-foreground"
              }`}
            />
            <span className="pointer-events-none absolute right-full top-1/2 mr-2 hidden max-w-64 -translate-y-1/2 truncate whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-lg group-hover:block group-focus-visible:block">
              {heading.text || "Untitled heading"}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
