"use client";

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, LayoutTemplate, Plus, Sheet as SheetIcon, Star, Upload } from "lucide-react";
import {
  useCreateSheet,
  useDeleteSheetTemplate,
  useSheets,
  useSheetTemplates,
  useUpdateSheet,
  useUpdateSheetTemplate,
} from "@/app/utils/hooks/sheets";
import { QueryFailure } from "@/app/_components/_ui/loadError";
import ExpandCollapsedListButton from "@/app/_components/_ui/expandCollapsedListButton";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { useSheetContextMenu } from "@/app/utils/hooks/useSheetContextMenu";
import { newSheetMenuItems } from "@/app/_components/sheets/sheetTemplateMenu";
import { csvToGrid } from "@/app/utils/sheetCsv";
import { formatSheetDate, sheetMetaLabel } from "@/app/utils/sheetWorkbook";
import type { Sheet, SheetTemplate } from "@/app/_types/types";
import { requestConfirm } from "@/app/_store/confirmStore";
import { tidyEntries } from "@/app/_store/contextMenuStore";
import { useToastStore } from "@/app/_store/toastStore";

export default function SheetsPage() {
  const router = useRouter();
  const sheetsQuery = useSheets();
  const { data: sheets, isLoading } = sheetsQuery;
  const createSheet = useCreateSheet();
  const updateSheet = useUpdateSheet();
  const templatesQuery = useSheetTemplates();
  const updateTemplate = useUpdateSheetTemplate();
  const deleteTemplate = useDeleteSheetTemplate();
  const openMenu = useContextMenu();
  const sheetMenu = useSheetContextMenu();
  const [renamingKey, setRenamingKey] = useState<string | null>(null);

  const activeSheets = (sheets ?? []).filter((sheet) => !sheet.archivedAt);
  const favorites = activeSheets.filter((sheet) => sheet.isFavorite);
  const recentSheets = activeSheets.slice(0, 12);
  const templates = templatesQuery.data ?? [];

  const handleCreate = async (templateId?: string) => {
    const sheet = await createSheet.mutateAsync(templateId ? { templateId } : {});
    router.push(`/sheets/${sheet.id}`);
  };

  const onNewSheetClick = (event: ReactMouseEvent) => {
    if (templates.length === 0) {
      void handleCreate();
      return;
    }
    openMenu(
      event,
      newSheetMenuItems({
        templates,
        onBlank: () => void handleCreate(),
        onTemplate: (templateId) => void handleCreate(templateId),
      }),
      { title: "New sheet" },
    );
  };

  const handleImport = async (file: File) => {
    const text = await file.text();
    const grid = csvToGrid(text);
    const title = file.name.replace(/\.csv$/i, "") || "Imported sheet";
    const sheet = await createSheet.mutateAsync({ title, ...grid });
    router.push(`/sheets/${sheet.id}`);
  };

  const onSheetContextMenu = (event: ReactMouseEvent, sheet: Sheet, renameKey: string) =>
    openMenu(
      event,
      sheetMenu(sheet, {
        onRename: () => setRenamingKey(renameKey),
      }),
      { title: sheet.title },
    );

  const commitRename = (sheet: Sheet, next: string) => {
    const title = next.trim();
    if (!title || title === sheet.title) {
      setRenamingKey(null);
      return;
    }
    void updateSheet
      .mutateAsync({ id: sheet.id, title })
      .then(() => setRenamingKey(null))
      .catch((error: unknown) =>
        useToastStore
          .getState()
          .show(error instanceof Error ? error.message : "Could not rename"),
      );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <ExpandCollapsedListButton
                storageKey="timely.sheetsListCollapsed"
                label="sheets list"
              />
              <h1 className="text-2xl font-semibold text-foreground">Sheets</h1>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Track numbers in a grid. Cells support formulas such as{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-primary">
                =SUM(A1:A10)
              </code>
              ,{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-success">
                =B2*1.1
              </code>{" "}
              and{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-warning">
                =IF(C1&gt;10,&quot;high&quot;,&quot;low&quot;)
              </code>
              .
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 font-medium text-foreground transition-colors hover:border-primary/30">
              <Upload className="size-4" />
              Import CSV
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void handleImport(file);
                }}
              />
            </label>
            <button
              type="button"
              onClick={onNewSheetClick}
              disabled={createSheet.isPending}
              className="flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              <Plus className="size-4" />
              {createSheet.isPending ? "Creating..." : "New sheet"}
              {templates.length > 0 && <ChevronDown className="size-4 opacity-80" />}
            </button>
          </div>
        </div>

        {favorites.length > 0 && (
          <>
            <h2 className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Favorites
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {favorites.map((sheet) => (
                <SheetCard
                  key={`favorite-${sheet.id}`}
                  sheet={sheet}
                  meta={sheetMetaLabel(sheet)}
                  favorite
                  renaming={renamingKey === `favorite:${sheet.id}`}
                  onContextMenu={(event) =>
                    onSheetContextMenu(event, sheet, `favorite:${sheet.id}`)
                  }
                  onCommitRename={commitRename}
                  onCancelRename={() => setRenamingKey(null)}
                />
              ))}
            </div>
          </>
        )}

        {isLoading && (
          <p className="mt-6 text-sm text-muted-foreground">Loading sheets...</p>
        )}

        {sheetsQuery.isError && (
          <QueryFailure
            what="sheets"
            hasData={Boolean(sheets)}
            error={sheetsQuery.error}
            onRetry={() => sheetsQuery.refetch()}
            retrying={sheetsQuery.isFetching}
            className="mt-3"
          />
        )}

        {!isLoading && !(sheetsQuery.isError && !sheets) && recentSheets.length === 0 && templates.length === 0 && (
          <div className="mt-6 flex flex-1 items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-10">
            <p className="text-sm text-muted-foreground">
              Nothing here yet. Create a sheet or import a CSV to get started.
            </p>
          </div>
        )}

        {templatesQuery.isError && (
          <QueryFailure
            what="templates"
            hasData={Boolean(templatesQuery.data)}
            error={templatesQuery.error}
            onRetry={() => templatesQuery.refetch()}
            retrying={templatesQuery.isFetching}
            className="mt-3"
          />
        )}

        {recentSheets.length > 0 && (
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {recentSheets.map((sheet) => (
              <SheetCard
                key={sheet.id}
                sheet={sheet}
                meta={`${sheet.rows.length} rows · ${sheet.columns.length} columns`}
                updated={formatSheetDate(sheet.updatedAt)}
                favorite={sheet.isFavorite}
                renaming={renamingKey === `recent:${sheet.id}`}
                onContextMenu={(event) =>
                  onSheetContextMenu(event, sheet, `recent:${sheet.id}`)
                }
                onCommitRename={commitRename}
                onCancelRename={() => setRenamingKey(null)}
              />
            ))}
          </div>
        )}

        {templates.length > 0 && (
          <>
            <h2 className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Templates
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  renaming={renamingKey === `template:${template.id}`}
                  onOpen={() => router.push(`/sheets/templates/${template.id}`)}
                  onContextMenu={(event) =>
                    openMenu(
                      event,
                      tidyEntries([
                        {
                          kind: "action",
                          label: "New sheet from template",
                          onSelect: () => void handleCreate(template.id),
                        },
                        {
                          kind: "action",
                          label: "Rename",
                          onSelect: () => setRenamingKey(`template:${template.id}`),
                        },
                        { kind: "separator" },
                        {
                          kind: "action",
                          label: "Delete",
                          danger: true,
                          onSelect: () =>
                            requestConfirm({
                              title: `Delete template “${template.name}”?`,
                              description: "Sheets already created from it are kept.",
                              onConfirm: async () => {
                                await deleteTemplate.mutateAsync(template.id);
                                useToastStore.getState().show("Template deleted");
                              },
                            }),
                        },
                      ]),
                      { title: template.name },
                    )
                  }
                  onCommitRename={(next) => {
                    const name = next.trim();
                    if (!name || name === template.name) {
                      setRenamingKey(null);
                      return;
                    }
                    void updateTemplate
                      .mutateAsync({ id: template.id, name })
                      .then(() => setRenamingKey(null))
                      .catch((error: unknown) =>
                        useToastStore
                          .getState()
                          .show(error instanceof Error ? error.message : "Could not rename"),
                      );
                  }}
                  onCancelRename={() => setRenamingKey(null)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SheetCard({
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
      href={`/sheets/${sheet.id}`}
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

function TemplateCard({
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
