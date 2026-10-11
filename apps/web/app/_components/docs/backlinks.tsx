"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, FileText, Link2 } from "lucide-react";
import { useDocBacklinks } from "@/app/utils/hooks/docs";
import { fileHref } from "@/app/utils/fileRoutes";

/** "Linked from": the other docs that @mention this one or [[link]] to its
 * title. A count next to the word count that opens the list. */
export default function Backlinks({ docId }: { docId: string }) {
  const { data } = useDocBacklinks(docId);
  const [open, setOpen] = useState(false);
  if (!data || data.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Link2 className="size-3.5" />
        {data.length} {data.length === 1 ? "backlink" : "backlinks"}
        <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="mb-3 mt-1 flex w-full flex-col gap-0.5 rounded-lg border border-border bg-muted/20 p-1" aria-label="Backlinks">
          {data.map((link) => (
            <li key={link.id}>
              <Link href={fileHref(link.id)} className="block rounded-md px-2 py-1.5 transition-colors hover:bg-accent">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  {link.icon ? <span>{link.icon}</span> : <FileText className="size-3.5 text-muted-foreground" />}
                  {link.title || "Untitled"}
                </span>
                {link.snippets.slice(0, 3).map((snippet, index) => (
                  <span key={index} className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {snippet}
                  </span>
                ))}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
