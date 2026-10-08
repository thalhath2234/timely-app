"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { fileHref } from "@/app/utils/fileRoutes";
import type { Doc } from "@/app/_types/types";

export function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DocCard({
  doc,
  renaming,
  onContextMenu,
  onCommitRename,
  onCancelRename,
}: {
  doc: Doc;
  renaming: boolean;
  onContextMenu: (event: ReactMouseEvent, doc: Doc) => void;
  onCommitRename: (doc: Doc, next: string) => void;
  onCancelRename: () => void;
}) {
  const icon = (
    <span className="text-base leading-none">
      {doc.icon ?? <FileText className="size-4 text-muted-foreground" />}
    </span>
  );

  if (renaming) {
    return (
      <div className="rounded-xl border border-ring bg-card p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const title = new FormData(event.currentTarget).get("title");
            onCommitRename(doc, typeof title === "string" ? title : "");
          }}
        >
          <div className="flex items-center gap-2">
            {icon}
            <input
              name="title"
              autoFocus
              defaultValue={doc.title}
              aria-label="Rename doc"
              onBlur={(event) => onCommitRename(doc, event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelRename();
                }
              }}
              className="min-w-0 flex-1 rounded border border-ring bg-input/40 px-1 py-0.5 font-medium outline-none"
            />
          </div>
        </form>
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
          {doc.plainText.trim() || "Empty page"}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          {formatUpdatedAt(doc.updatedAt)}
        </p>
      </div>
    );
  }

  return (
    <Link
      href={fileHref(doc.id)}
      onContextMenu={(event) => onContextMenu(event, doc)}
      className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30 hover:bg-accent/50"
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="truncate font-medium text-foreground">{doc.title}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {doc.plainText.trim() || "Empty page"}
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        {formatUpdatedAt(doc.updatedAt)}
      </p>
    </Link>
  );
}
