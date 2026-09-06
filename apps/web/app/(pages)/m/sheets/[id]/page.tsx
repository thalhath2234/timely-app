"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Sheet as SheetIcon, Smile, Star, Trash2 } from "lucide-react";
import MobileHeader, { HeaderIconButton } from "@/app/_components/mobile/MobileHeader";
import BottomSheet, { SheetOption } from "@/app/_components/mobile/BottomSheet";
import EmptyState from "@/app/_components/mobile/EmptyState";
import RichTextEditor from "@/app/_components/editor/richTextEditor";
import SheetGrid from "@/app/_components/sheets/sheetGrid";
import { useMobileSheet, useMobileWorkspaces } from "@/app/_lib/mobile/useMobileData";
import { useDeleteSheet, useUpdateSheet } from "@/app/utils/hooks/sheets";
import { saveStatusLabel, useAutosave } from "@/app/utils/hooks/useAutosave";
import { toRichContent } from "@/app/utils/richText";
import type { UpdateSheetPayload } from "@/app/utils/api/sheets";
import type { Sheet, SheetColumn, SheetRow } from "@/app/_types/types";
import { timeAgo } from "@/app/_lib/mobile/format";

const ICON_CHOICES = [
  "📊", "📈", "📉", "🧮", "💰", "📋", "🗓️", "⚙️",
  "🎯", "🔢", "📦", "🏷️", "⏱️", "✅", "⭐", "🧾",
];

interface GridState {
  columns: SheetColumn[];
  rows: SheetRow[];
}

export default function MobileSheetDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: sheet, isDemo, isLoading } = useMobileSheet(id);

  if (!sheet) {
    return (
      <>
        <MobileHeader title="Sheet" backHref="/m/sheets" large={false} />
        <main className="flex-1">
          {isLoading ? null : <EmptyState icon={SheetIcon} title="Sheet not found" />}
        </main>
      </>
    );
  }

  return <SheetEditor key={sheet.id} sheet={sheet} isDemo={isDemo} />;
}

function SheetEditor({ sheet, isDemo }: { sheet: Sheet; isDemo: boolean }) {
  const router = useRouter();
  const { data: workspaces } = useMobileWorkspaces();
  const updateSheet = useUpdateSheet();
  const deleteSheet = useDeleteSheet();

  const [title, setTitle] = useState(sheet.title);
  const [icon, setIcon] = useState(sheet.icon ?? "");
  const [favorite, setFavorite] = useState(sheet.isFavorite);
  const [grid, setGrid] = useState<GridState>({ columns: sheet.columns, rows: sheet.rows });
  const [showDescription, setShowDescription] = useState(
    Boolean(sheet.description?.trim()) || Boolean(sheet.descriptionRich),
  );
  const [menu, setMenu] = useState<"more" | "icon" | "delete" | null>(null);

  const { schedule, flush, status } = useAutosave<UpdateSheetPayload>((patch) =>
    isDemo ? Promise.resolve() : updateSheet.mutateAsync({ id: sheet.id, ...patch }),
  );

  const workspace = workspaces.find((w) => w.id === sheet.workspaceId);

  // Grid edits stay local so typing is instant, then autosave in one patch.
  function handleGridChange(next: Partial<GridState>) {
    const merged = {
      columns: next.columns ?? grid.columns,
      rows: next.rows ?? grid.rows,
    };
    setGrid(merged);
    schedule(merged);
  }

  async function remove() {
    if (!isDemo) await deleteSheet.mutateAsync(sheet.id);
    router.push("/m/sheets");
  }

  return (
    <>
      <MobileHeader
        title={workspace?.name ?? "Sheet"}
        subtitle={saveStatusLabel(status) || `Edited ${timeAgo(sheet.updatedAt)}`}
        backHref="/m/sheets"
        large={false}
        isDemo={isDemo}
        actions={
          <>
            <HeaderIconButton
              label={favorite ? "Remove from favorites" : "Add to favorites"}
              active={favorite}
              onClick={() => {
                setFavorite(!favorite);
                schedule({ isFavorite: !favorite });
              }}
            >
              <Star size={20} className={favorite ? "fill-warning text-warning" : ""} />
            </HeaderIconButton>
            <HeaderIconButton label="More" onClick={() => setMenu("more")}>
              <MoreHorizontal size={22} />
            </HeaderIconButton>
          </>
        }
      />

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 px-5 pt-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              aria-label="Change icon"
              onClick={() => setMenu("icon")}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-card text-[28px] leading-none active:bg-muted"
            >
              {icon || <Smile size={22} className="text-muted-foreground" />}
            </button>
            <textarea
              value={title}
              rows={1}
              placeholder="Untitled"
              aria-label="Title"
              onChange={(e) => {
                setTitle(e.target.value);
                schedule({ title: e.target.value });
              }}
              onBlur={() => void flush()}
              className="min-w-0 flex-1 resize-none bg-transparent pt-1 text-[24px] font-semibold leading-tight tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50 field-sizing-content"
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {grid.rows.length} rows · {grid.columns.length} columns
            {!showDescription ? (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={() => setShowDescription(true)}
                  className="font-medium text-primary"
                >
                  Add description
                </button>
              </>
            ) : null}
          </p>

          {showDescription ? (
            <div className="mobile-editor mt-3 rounded-xl border border-border bg-card px-3 py-2">
              <RichTextEditor
                variant="compact"
                content={toRichContent(sheet.descriptionRich, sheet.description)}
                placeholder="Add a description. Type '@' to mention docs, tasks, or projects…"
                onChange={({ content, plainText }) =>
                  schedule({ descriptionRich: content, description: plainText })
                }
              />
            </div>
          ) : null}
        </div>

        <div className="mobile-sheet-grid mt-3 min-h-0 flex-1 border-t border-border">
          <SheetGrid columns={grid.columns} rows={grid.rows} onChange={handleGridChange} />
        </div>
      </main>

      <BottomSheet open={menu === "more"} onClose={() => setMenu(null)} title="Sheet">
        <SheetOption onSelect={() => setMenu("icon")} leading={<Smile size={18} />}>
          Change icon
        </SheetOption>
        {!showDescription ? (
          <SheetOption
            onSelect={() => {
              setShowDescription(true);
              setMenu(null);
            }}
          >
            Add description
          </SheetOption>
        ) : null}
        <SheetOption
          onSelect={() => setMenu("delete")}
          leading={<Trash2 size={18} className="text-destructive" />}
        >
          <span className="text-destructive">Delete sheet</span>
        </SheetOption>
      </BottomSheet>

      <BottomSheet open={menu === "icon"} onClose={() => setMenu(null)} title="Icon">
        <div className="grid grid-cols-8 gap-1">
          {ICON_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => {
                setIcon(choice);
                schedule({ icon: choice });
                setMenu(null);
              }}
              className={`flex h-11 items-center justify-center rounded-xl text-[24px] active:bg-muted ${
                choice === icon ? "bg-accent" : ""
              }`}
            >
              {choice}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setIcon("");
            schedule({ icon: "" });
            setMenu(null);
          }}
          className="mt-3 flex h-11 w-full items-center justify-center rounded-xl bg-secondary text-[14px] font-medium text-secondary-foreground"
        >
          Remove icon
        </button>
      </BottomSheet>

      <BottomSheet open={menu === "delete"} onClose={() => setMenu(null)} title="Delete this sheet?">
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => setMenu(null)}
            className="flex h-12 flex-1 items-center justify-center rounded-xl border border-border bg-card text-[15px] font-medium text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={deleteSheet.isPending}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-destructive text-[15px] font-semibold text-white disabled:opacity-60"
          >
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
