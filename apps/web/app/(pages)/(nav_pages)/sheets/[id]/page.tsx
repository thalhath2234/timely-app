"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Archive, ChevronRight, Smile, Star, Trash2 } from "lucide-react";
import RichTextEditor from "@/app/_components/editor/richTextEditor";
import SheetGrid from "@/app/_components/sheets/sheetGrid";
import { Sheet, SheetColumn, SheetRow } from "@/app/_types/types";
import { UpdateSheetPayload } from "@/app/utils/api/sheets";
import {
  useDeleteSheet,
  useSheet,
  useUpdateSheet,
} from "@/app/utils/hooks/sheets";
import { useAutosave } from "@/app/utils/hooks/useAutosave";
import { toRichContent } from "@/app/utils/richText";
import SaveStatusBadge from "@/app/_components/_ui/saveStatus";
import { showUndoToast } from "@/app/_store/toastStore";

const ICON_CHOICES = [
  "📊", "📈", "📉", "🧮", "💰", "📋", "🗓️", "⚙️",
  "🎯", "🔢", "📦", "🏷️", "⏱️", "✅", "⭐", "🧾",
];

interface GridState {
  columns: SheetColumn[];
  rows: SheetRow[];
}

export default function SheetPage() {
  const params = useParams<{ id: string }>();
  const { data: sheet, isLoading, isError, error } = useSheet(params.id);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading sheet...
      </div>
    );
  }

  if (isError || !sheet) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">
          {error instanceof Error
            ? error.message
            : "This sheet could not be found."}
        </p>
        <Link
          href="/sheets"
          className="rounded-lg bg-secondary px-4 py-2 text-sm text-secondary-foreground transition-colors hover:bg-accent"
        >
          Back to sheets
        </Link>
      </div>
    );
  }

  // Keying by id remounts the grid so its local draft state comes from the
  // freshly opened sheet.
  return <SheetView key={sheet.id} sheet={sheet} />;
}

function SheetView({ sheet }: { sheet: Sheet }) {
  const router = useRouter();
  const updateSheet = useUpdateSheet();
  const deleteSheet = useDeleteSheet();

  const [title, setTitle] = useState(sheet.title);
  const [grid, setGrid] = useState<GridState>({
    columns: sheet.columns,
    rows: sheet.rows,
  });
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const { schedule, flush, status } = useAutosave<UpdateSheetPayload>((patch) =>
    updateSheet.mutateAsync({ id: sheet.id, ...patch }),
  );

  const handleDelete = async () => {
    await deleteSheet.mutateAsync(sheet.id);
    router.push("/sheets");
  };

  // Grid edits are held locally so typing stays instant, then autosaved.
  const handleGridChange = (next: Partial<GridState>) => {
    const merged = {
      columns: next.columns ?? grid.columns,
      rows: next.rows ?? grid.rows,
    };

    setGrid(merged);
    schedule(merged);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border px-6 py-2.5">
        <nav className="flex min-w-0 flex-1 items-center gap-1 text-xs text-muted-foreground">
          <Link
            href="/sheets"
            className="shrink-0 transition-colors hover:text-foreground"
          >
            Sheets
          </Link>
          <ChevronRight className="size-3 shrink-0" />
          <span className="truncate text-foreground">{sheet.title}</span>
        </nav>

        <SaveStatusBadge status={status} onRetry={() => void flush()} />

        <button
          type="button"
          title={sheet.isFavorite ? "Remove from favorites" : "Add to favorites"}
          onClick={() => schedule({ isFavorite: !sheet.isFavorite })}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Star
            className={`size-4 ${sheet.isFavorite ? "fill-warning text-warning" : ""}`}
          />
        </button>

        <button
          type="button"
          title={sheet.archivedAt ? "Unarchive" : "Archive"}
          onClick={() => {
            const next = !sheet.archivedAt;
            schedule({ archived: next });
            showUndoToast(next ? "Archived" : "Unarchived", () =>
              schedule({ archived: !next }),
            );
          }}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent"
        >
          <Archive className={`size-4 ${sheet.archivedAt ? "text-warning" : ""}`} />
        </button>

        <div className="relative shrink-0">
          <button
            type="button"
            title="Delete sheet"
            onClick={() => setIsConfirmingDelete((previous) => !previous)}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </button>

          {isConfirmingDelete && (
            <div className="absolute right-0 top-9 z-50 w-52 rounded-lg border border-border bg-popover p-3 text-xs shadow-xl">
              <p className="text-muted-foreground">Delete this sheet?</p>
              <div className="mt-2 flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsConfirmingDelete(false)}
                  className="cursor-pointer rounded-md bg-secondary px-2 py-1 text-secondary-foreground transition-colors hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleteSheet.isPending}
                  className="cursor-pointer rounded-md bg-destructive px-2 py-1 text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="flex items-start gap-2 px-6 pb-2 pt-4">
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsIconPickerOpen((previous) => !previous)}
            title="Change icon"
            className="flex size-10 cursor-pointer items-center justify-center rounded-lg text-2xl transition-colors hover:bg-accent"
          >
            {sheet.icon ?? <Smile className="size-5 text-muted-foreground" />}
          </button>

          {isIconPickerOpen && (
            <div className="absolute left-0 top-11 z-50 w-64 rounded-lg border border-border bg-popover p-2 shadow-xl">
              <div className="grid grid-cols-8 gap-1">
                {ICON_CHOICES.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    onClick={() => {
                      schedule({ icon });
                      setIsIconPickerOpen(false);
                    }}
                    className="flex size-7 cursor-pointer items-center justify-center rounded transition-colors hover:bg-accent"
                  >
                    {icon}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  schedule({ icon: "" });
                  setIsIconPickerOpen(false);
                }}
                className="mt-2 w-full cursor-pointer rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground transition-colors hover:bg-accent"
              >
                Remove icon
              </button>
            </div>
          )}
        </div>

        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            schedule({ title: event.target.value });
          }}
          onBlur={() => void flush()}
          placeholder="Untitled"
          className="min-w-0 flex-1 bg-transparent pt-0.5 text-2xl font-bold text-foreground outline-none placeholder:text-muted-foreground/50"
        />
      </div>

      <div className="mx-6 mb-3 rounded-lg border border-border bg-input/20 px-3 py-2">
        <RichTextEditor
          variant="compact"
          content={toRichContent(sheet.descriptionRich, sheet.description)}
          placeholder="Add a description. Type '@' to mention docs, tasks, or projects..."
          onChange={({ content, plainText }) =>
            schedule({ descriptionRich: content, description: plainText })
          }
        />
      </div>

      <div className="min-h-0 flex-1">
        <SheetGrid
          columns={grid.columns}
          rows={grid.rows}
          onChange={handleGridChange}
        />
      </div>
    </div>
  );
}
