"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, ChevronDown, FileText, Folder, Sparkles, Table2 } from "lucide-react";
import { useRelated } from "@/app/utils/hooks/search";
import type { RelatedItem } from "@/app/utils/api/search";
import { openTasksEntity } from "@/app/utils/entityDetail";
import { fileHref } from "@/app/utils/fileRoutes";

const icons = { task: CheckSquare, project: Folder, doc: FileText, sheet: Table2 };

/** "Related": items smart suggestions confirm are about the same thing as
 * this one. A count next to the backlinks that opens the list, or with
 * `section` a titled list for detail panels; nothing at all while smart
 * suggestions are off or find nothing. */
export default function RelatedItems({ kind, id, section = false }: { kind: RelatedItem["kind"]; id: string; section?: boolean }) {
  const router = useRouter();
  const { data } = useRelated(kind, id);
  const [open, setOpen] = useState(false);
  if (!data || data.length === 0) return null;

  function openItem(item: RelatedItem) {
    if (item.kind === "task" || item.kind === "project") {
      openTasksEntity({ kind: item.kind, id: item.id }, { navigate: (href) => router.push(href, { scroll: false }) });
    } else router.push(fileHref(encodeURIComponent(item.id)));
  }

  const list = (
    <ul className={section ? "flex flex-col gap-1" : "mb-3 mt-1 flex w-full flex-col gap-0.5 rounded-lg border border-border bg-muted/20 p-1"} aria-label="Related">
      {data.map((item) => {
        const Icon = icons[item.kind] ?? FileText;
        return (
          <li key={`${item.kind}:${item.id}`}>
            <button type="button" onClick={() => openItem(item)} className="block w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{item.title || "Untitled"}</span>
              </span>
              {item.snippet && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.snippet}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );

  if (section) {
    return (
      <section className="mt-8" data-testid="related-items">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Sparkles className="size-3.5" /> Related
        </h3>
        {list}
      </section>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        data-testid="related-items"
      >
        <Sparkles className="size-3.5" />
        {data.length} related
        <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && list}
    </>
  );
}
