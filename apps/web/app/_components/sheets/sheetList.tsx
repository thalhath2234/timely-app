"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Plus, Search, Sheet as SheetIcon, Star, Trash2 } from "lucide-react";
import {
  useCreateSheet,
  useDeleteSheet,
  useSheets,
} from "@/app/utils/hooks/sheets";

export default function SheetList() {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const activeId = params?.id;

  const { data: sheets, isLoading } = useSheets();
  const createSheet = useCreateSheet();
  const deleteSheet = useDeleteSheet();

  const [search, setSearch] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

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

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-sidebar/40">
      <div className="flex items-center justify-between px-3 py-3">
        <h2 className="text-sm font-semibold text-foreground">
          {showArchived ? "Archived" : "Sheets"}
        </h2>
        <button
          type="button"
          title="New sheet"
          onClick={handleCreate}
          disabled={createSheet.isPending}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-input/30 px-2 py-1.5 transition focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/40">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search sheets"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowArchived((previous) => !previous)}
          className="mt-2 text-xs text-muted-foreground hover:text-foreground"
        >
          {showArchived ? "Show active sheets" : "Show archived"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
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
              className={`group flex items-center gap-1 rounded-md pr-1 transition-colors ${
                sheet.id === activeId
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/60"
              }`}
            >
              <Link
                href={`/sheets/${sheet.id}`}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-sm"
              >
                <span className="shrink-0 text-base leading-none">
                  {sheet.icon ? (
                    sheet.icon
                  ) : (
                    <SheetIcon className="size-3.5 text-muted-foreground" />
                  )}
                </span>
                <span className="truncate">{sheet.title}</span>
                {sheet.isFavorite && (
                  <Star className="size-3 shrink-0 fill-warning text-warning" />
                )}
              </Link>

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
                    className="cursor-pointer rounded-md bg-destructive px-2 py-1 text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
