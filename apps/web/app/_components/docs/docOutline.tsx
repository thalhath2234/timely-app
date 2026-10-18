"use client";

import type { Editor } from "@tiptap/react";
import { List } from "lucide-react";
import { useDocHeadings } from "@/app/_components/docs/headingMinimap";
import { RailRow, RailRows, RailSection } from "@/app/_components/_ui/pageWithRail";
import { cn } from "@/app/utils/cn";

/** Words a minute, for the reading time. */
const READING_PACE = 220;

/** The outline card beside a wide doc: the page in numbers and its headings,
 * the one being read marked, each a jump. Narrow pages keep the minimap strip. */
export default function DocOutline({
  editor,
  wordCount,
  updatedAt,
  subpages,
}: {
  editor: Editor | null;
  wordCount: number;
  updatedAt: string;
  subpages: number;
}) {
  const { headings, activePos, goTo } = useDocHeadings(editor);
  const minutes = Math.max(1, Math.round(wordCount / READING_PACE));
  const updated = new Date(updatedAt);
  const edited = Number.isNaN(updated.getTime())
    ? "—"
    : updated.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const top = Math.min(...headings.map((heading) => heading.level), 3);

  return (
    <RailSection title="Outline" icon={<List className="size-3.5 text-muted-foreground" />} data-testid="doc-outline">
      <RailRows>
        <RailRow label="Words" value={wordCount.toLocaleString()} />
        <RailRow label="Reading time" value={wordCount === 0 ? "—" : `${minutes} min`} />
        {subpages > 0 ? <RailRow label="Subpages" value={subpages} /> : null}
        <RailRow label="Last edited" value={edited} tone="muted" />
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
    </RailSection>
  );
}
