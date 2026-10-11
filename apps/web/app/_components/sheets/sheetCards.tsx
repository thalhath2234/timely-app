"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { LayoutTemplate, Sheet as SheetIcon, Star } from "lucide-react";
import { fileHref } from "@/app/utils/fileRoutes";
import type { Sheet, SheetTemplate } from "@/app/_types/types";

export function SheetCard({
  sheet,
  meta,
  updated,
  favorite,
  renaming,
  onContextMenu,
  onCommitRename,
  onCancelRename,
}: {
  sheet: Sheet;
  meta: string;
  updated?: string;
  favorite?: boolean;
  renaming: boolean;
  onContextMenu: (event: ReactMouseEvent) => void;
  onCommitRename: (sheet: Sheet, next: string) => void;
  onCancelRename: () => void;
}) {
  const icon = (
    <span className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-base leading-none text-primary">
      {sheet.icon ?? <SheetIcon className="size-4" />}
    </span>
  );

  if (renaming) {
    return (
      <div className="rounded-xl border border-ring bg-card p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const title = new FormData(event.currentTarget).get("title");
            onCommitRename(sheet, typeof title === "string" ? title : "");
          }}
        >
          <div className="flex items-center gap-2">
            {icon}
            <input
              name="title"
              autoFocus
              defaultValue={sheet.title}
              aria-label="Rename sheet"
              onBlur={(event) => onCommitRename(sheet, event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelRename();
                }
              }}
              className="min-w-0 flex-1 rounded border border-ring bg-input/40 px-1 py-0.5 font-medium outline-none"
            />
            {favorite && <Star className="size-3.5 shrink-0 fill-warning text-warning" />}
          </div>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">{meta}</p>
        {updated ? (
          <p className="mt-3 text-xs text-muted-foreground">{updated}</p>
        ) : null}
      </div>
    );
  }

  return (
    <Link
      href={fileHref(sheet.id)}
      onContextMenu={onContextMenu}
      className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30 hover:bg-accent/50"
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {sheet.title}
        </span>
        {favorite && <Star className="size-3.5 shrink-0 fill-warning text-warning" />}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{meta}</p>
      {updated ? (
        <p className="mt-3 text-xs text-muted-foreground">{updated}</p>
      ) : null}
    </Link>
  );
}

export function TemplateCard({
  template,
  renaming,
  onOpen,
  onContextMenu,
  onCommitRename,
  onCancelRename,
}: {
  template: SheetTemplate;
  renaming: boolean;
  onOpen: () => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  onCommitRename: (next: string) => void;
  onCancelRename: () => void;
}) {
  const tabCount = template.tabs?.length || 1;
  const meta = `${template.rows.length} rows · ${template.columns.length} columns${
    tabCount > 1 ? ` · ${tabCount} tabs` : ""
  }`;
  const icon = (
    <span className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-base leading-none text-primary">
      {template.icon ?? <LayoutTemplate className="size-4" />}
    </span>
  );

  if (renaming) {
    return (
      <div className="rounded-xl border border-ring bg-card p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const title = new FormData(event.currentTarget).get("title");
            onCommitRename(typeof title === "string" ? title : "");
          }}
        >
          <div className="flex items-center gap-2">
            {icon}
            <input
              name="title"
              autoFocus
              defaultValue={template.name}
              aria-label="Rename template"
              onBlur={(event) => onCommitRename(event.currentTarget.value)}
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
        <p className="mt-2 text-xs text-muted-foreground">{meta}</p>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={onContextMenu}
      className="rounded-xl border border-dashed border-border bg-card p-4 text-left transition-colors hover:border-primary/30 hover:bg-accent/50"
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {template.name}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{meta}</p>
    </button>
  );
}
