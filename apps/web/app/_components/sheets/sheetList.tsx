"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sheet as SheetIcon,
  Star,
  Trash2,
} from "lucide-react";
import {
  useCreateSheet,
  useDeleteSheet,
  useSheets,
  useUpdateSheet,
} from "@/app/utils/hooks/sheets";
import { sheetMetaLabel } from "@/app/utils/sheetWorkbook";
import { useCollapsedPanel } from "@/app/utils/hooks/useCollapsedPanel";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { useSheetContextMenu } from "@/app/utils/hooks/useSheetContextMenu";
import type { Sheet } from "@/app/_types/types";

export default function SheetList() {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const activeId = params?.id;

  const { data: sheets, isLoading } = useSheets();
  const createSheet = useCreateSheet();
  const deleteSheet = useDeleteSheet();
  const updateSheet = useUpdateSheet();

  const [search, setSearch] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const { collapsed, toggle } = useCollapsedPanel("timely.sheetsListCollapsed");
  const openMenu = useContextMenu();
  const sheetMenu = useSheetContextMenu();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visibleSheets = useMemo(() => {
    const query = search.trim().toLowerCase();
    const all = (sheets ?? []).filter((sheet) =>
      showArchived ? Boolean(sheet.archivedAt) : !sheet.archivedAt,
    );
    if (!query) return all;

    return all.filter(
      (sheet) =>
        sheet.title.toLowerCase().includes(query) ||
        sheet.description.toLowerCase().includes(query),
    );
  }, [sheets, search, showArchived]);

  const handleCreate = async () => {
    const sheet = await createSheet.mutateAsync({});
    router.push(`/sheets/${sheet.id}`);
  };

  const handleDelete = async (id: string) => {
    await deleteSheet.mutateAsync(id);
    setPendingDeleteId(null);

    if (activeId === id) router.push("/sheets");
  };

  const commitRename = (sheet: Sheet, next: string) => {
    const title = next.trim();
    setRenamingId(null);
    if (!title || title === sheet.title) return;
    void updateSheet.mutateAsync({ id: sheet.id, title });
  };

  const onSheetContextMenu = (event: React.MouseEvent, sheet: Sheet) => {
    openMenu(
      event,
      sheetMenu(sheet, {
        onRename: () => setRenamingId(sheet.id),
        onDeleted: (id) => {
          setPendingDeleteId(null);
          if (activeId === id) router.push("/sheets");
        },
      }),
      { title: sheet.title },
    );
  };

  if (collapsed) {
    return (
      <aside className="flex h-full w-11 shrink-0 flex-col items-center gap-2 border-r border-border bg-background py-3">
        <button
          type="button"
          title="Expand sheets list"
          onClick={toggle}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <PanelLeftOpen className="size-4" />
        </button>
        <button
          type="button"
          title="New sheet"
          onClick={handleCreate}
          disabled={createSheet.isPending}
          className="flex size-7 cursor-pointer items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          <Plus className="size-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-primary" />
          <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">
            {showArchived ? "Archived" : "Sheets Workspace"}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Collapse sheets list"
            onClick={toggle}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <PanelLeftClose className="size-4" />
          </button>
          <button
            type="button"
            title="New sheet"
            onClick={handleCreate}
            disabled={createSheet.isPending}
            className="flex size-7 cursor-pointer items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      <div className="px-3 py-3">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3 size-3.5 text-muted-foreground" />
          <input
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search sheets, models..."
            className="w-full rounded-lg border border-border bg-muted py-1.5 pl-8 pr-8 text-xs text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring"
          />
          <span className="absolute right-2.5 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
            /
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between px-5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <span>Recent Sheets</span>
        <button
          type="button"
          onClick={() => setShowArchived((previous) => !previous)}
          className="text-[10px] normal-case tracking-normal hover:text-foreground"
        >
          {showArchived ? "Show active" : "Show archived"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {isLoading && (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">Loading...</p>
        )}

        {!isLoading && visibleSheets.length === 0 && (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            {search ? `No matches for "${search}"` : "No sheets yet."}
          </p>
        )}

        {visibleSheets.map((sheet) => (
          <div key={sheet.id}>
            <div
              className={`group flex items-center gap-1 rounded-lg pr-1 transition-colors ${
                sheet.id === activeId
                  ? "border border-primary/20 bg-primary/12 text-foreground"
                  : "hover:bg-accent"
              }`}
              onContextMenu={(event) => onSheetContextMenu(event, sheet)}
            >
              {renamingId === sheet.id ? (
                <form
                  className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const title = new FormData(event.currentTarget).get("title");
                    commitRename(sheet, typeof title === "string" ? title : "");
                  }}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/12 text-base leading-none text-primary">
                    {sheet.icon ? sheet.icon : <SheetIcon className="size-3.5" />}
                  </span>
                  <input
                    name="title"
                    autoFocus
                    defaultValue={sheet.title}
                    aria-label="Rename sheet"
                    onBlur={(event) => commitRename(sheet, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setRenamingId(null);
                      }
                    }}
                    className="min-w-0 flex-1 rounded border border-ring bg-input/40 px-1 py-0.5 text-xs outline-none"
                  />
                </form>
              ) : (
                <Link
                  href={`/sheets/${sheet.id}`}
                  className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/12 text-base leading-none text-primary">
                    {sheet.icon ? (
                      sheet.icon
                    ) : (
                      <SheetIcon className="size-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <span className="truncate text-xs font-medium">{sheet.title}</span>
                      {sheet.isFavorite && (
                        <Star className="size-3 shrink-0 fill-warning text-warning" />
                      )}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {sheetMetaLabel(sheet)}
                    </span>
                  </span>
                  {sheet.id === activeId && (
                    <span className="size-1.5 shrink-0 rounded-full bg-success" />
                  )}
                </Link>
              )}

              <button
                type="button"
                title="Delete"
                onClick={() => setPendingDeleteId(sheet.id)}
                className="flex size-6 shrink-0 items-center justify-center rounded opacity-0 transition hover:bg-sidebar-border hover:text-destructive group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>

            {pendingDeleteId === sheet.id && (
              <div className="my-1 rounded-md border border-border bg-card p-2 text-xs">
                <p className="text-muted-foreground">
                  Delete <span className="text-foreground">{sheet.title}</span>?
                </p>
                <div className="mt-2 flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPendingDeleteId(null)}
                    className="cursor-pointer rounded-md bg-secondary px-2 py-1 text-secondary-foreground transition-colors hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(sheet.id)}
                    disabled={deleteSheet.isPending}
                    className="cursor-pointer rounded-md bg-destructive-container px-2 py-1 text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="m-3 rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
        <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
          <span className="size-1.5 rounded-full bg-primary" />
          Formula Syntax
        </div>
        <p className="font-mono text-[10px] leading-relaxed">
          <span className="text-primary">=SUM(A1:A10)</span>
          <br />
          <span className="text-success">=B2*1.1</span>
          <br />
          <span className="text-warning">=IF(C1&gt;10, &quot;high&quot;, &quot;low&quot;)</span>
        </p>
      </div>
    </aside>
  );
}