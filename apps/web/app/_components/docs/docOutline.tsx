"use client";

import { useState, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { ChevronDown, List } from "lucide-react";
import { useDocHeadings } from "@/app/_components/docs/headingMinimap";
import { RailRow, RailRows, RailSection } from "@/app/_components/_ui/pageWithRail";
import { cn } from "@/app/utils/cn";

/** Whether the outline card was folded, remembered on this device. */
const COLLAPSED_KEY = "timely.docOutlineCollapsed";

function readCollapsed() {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

/** The outline card beside a wide doc: the page in numbers and its headings,
 * the one being read marked, each a jump. Folds to one line from its
 * chevron. Narrow pages keep the minimap strip. */
export default function DocOutline({
  editor,
  wordCount,
  updatedAt,
  subpages,
  rows,
}: {
  editor: Editor | null;
  wordCount: number;
  updatedAt: string;
  subpages: number;
  /** More rows for the page's numbers, such as a switch for the doc. */
  rows?: ReactNode;
}) {
  const { headings, activePos, goTo } = useDocHeadings(editor);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, String(next));
    } catch {
      // Remembering it is a nicety.
    }
  };
  const updated = new Date(updatedAt);
  const edited = Number.isNaN(updated.getTime())
    ? "—"
    : updated.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const top = Math.min(...headings.map((heading) => heading.level), 3);

  const summary = `${wordCount.toLocaleString()} ${wordCount === 1 ? "word" : "words"}${headings.length > 0 ? ` · ${headings.length} heading${headings.length === 1 ? "" : "s"}` : ""}`;

  return (
    <RailSection
      title="Outline"
      icon={<List className="size-3.5 text-muted-foreground" />}
      meta={collapsed ? <span className="tabular-nums">{summary}</span> : undefined}
      action={
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Show the outline" : "Hide the outline"}
          onClick={toggle}
          className="-mr-1 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronDown className={cn("size-3.5 transition-transform", collapsed && "-rotate-90")} />
        </button>
      }
      className={cn(collapsed && "[&>div:first-child]:mb-0")}
      data-testid="doc-outline"
      data-collapsed={collapsed ? "true" : undefined}
    >
      {collapsed ? null : (
        <>
      <RailRows>
        <RailRow label="Words" value={wordCount.toLocaleString()} />
        {subpages > 0 ? <RailRow label="Subpages" value={subpages} /> : null}
        <RailRow label="Last edited" value={edited} tone="muted" />
        {rows}
      </RailRows>
      {headings.length === 0 ? (
        <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
          Headings in the text are listed here and jump to their section.
        </p>
      ) : (
        <nav aria-label="Headings" className="mt-3 border-t border-border pt-2">
          <ul className="flex flex-col">
            {headings.map((heading) => {
              const active = heading.pos === activePos;
              return (
                <li key={heading.pos}>
                  <button
                    type="button"
                    aria-current={active ? "location" : undefined}
                    onClick={() => goTo(heading.pos)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md py-1 pr-1 text-left text-[13px] leading-5 transition-colors hover:text-foreground",
                      active ? "font-medium text-primary" : "text-muted-foreground",
                    )}
                    style={{ paddingLeft: `${(heading.level - top) * 12 + 4}px` }}
                  >
                    <span aria-hidden className={cn("h-3.5 w-0.5 shrink-0 rounded-full", active ? "bg-primary" : "bg-transparent")} />
                    <span className="truncate">{heading.text || "Untitled heading"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
        </>
      )}
    </RailSection>
  );
}
