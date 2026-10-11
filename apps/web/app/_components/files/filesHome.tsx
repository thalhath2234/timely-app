"use client";

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Upload } from "lucide-react";
import { useCreateDoc, useDocs, useUpdateDoc } from "@/app/utils/hooks/docs";
import {
  useCreateSheet,
  useDeleteSheetTemplate,
  useSheets,
  useSheetTemplates,
  useUpdateSheet,
  useUpdateSheetTemplate,
} from "@/app/utils/hooks/sheets";
import { readMarkdownFile } from "@/app/utils/importMarkdown";
import { importCsvGrid } from "@/app/utils/sheetCsv";
import { formatSheetDate, sheetMetaLabel } from "@/app/utils/sheetWorkbook";
import { fileHref } from "@/app/utils/fileRoutes";
import { QueryFailure } from "@/app/_components/_ui/loadError";
import ExpandCollapsedListButton from "@/app/_components/_ui/expandCollapsedListButton";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { useDocContextMenu } from "@/app/utils/hooks/useDocContextMenu";
import { useSheetContextMenu } from "@/app/utils/hooks/useSheetContextMenu";
import { newSheetMenuItems } from "@/app/_components/sheets/sheetTemplateMenu";
import { DocCard } from "@/app/_components/docs/docCard";
import { SheetCard, TemplateCard } from "@/app/_components/sheets/sheetCards";
import { requestConfirm } from "@/app/_store/confirmStore";
import { tidyEntries } from "@/app/_store/contextMenuStore";
import { useToastStore } from "@/app/_store/toastStore";
import type { Doc, Sheet } from "@/app/_types/types";

type Item = { kind: "doc"; doc: Doc } | { kind: "sheet"; sheet: Sheet };

const itemId = (item: Item) => (item.kind === "doc" ? item.doc.id : item.sheet.id);
const itemUpdatedAt = (item: Item) => (item.kind === "doc" ? item.doc.updatedAt : item.sheet.updatedAt);

const grid = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
const sectionHeading = "mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground";

/** Start page of Files: recent docs and sheets together, then sheet templates. */
export default function FilesHome() {
  const router = useRouter();
  const docsQuery = useDocs();
  const sheetsQuery = useSheets();
  const templatesQuery = useSheetTemplates();
  const createDoc = useCreateDoc();
  const updateDoc = useUpdateDoc();
  const createSheet = useCreateSheet();
  const updateSheet = useUpdateSheet();
  const updateTemplate = useUpdateSheetTemplate();
  const deleteTemplate = useDeleteSheetTemplate();
  const openMenu = useContextMenu();
  const docMenu = useDocContextMenu();
  const sheetMenu = useSheetContextMenu();
  const [renamingKey, setRenamingKey] = useState<string | null>(null);

  const items: Item[] = [
    ...(docsQuery.data ?? []).filter((doc) => !doc.archivedAt).map((doc) => ({ kind: "doc" as const, doc })),
    ...(sheetsQuery.data ?? []).filter((sheet) => !sheet.archivedAt).map((sheet) => ({ kind: "sheet" as const, sheet })),
  ].sort((a, b) => itemUpdatedAt(b).localeCompare(itemUpdatedAt(a)));
  const favorites = items.filter((item) => (item.kind === "doc" ? item.doc.isFavorite : item.sheet.isFavorite));
  const recent = items.slice(0, 12);
  const templates = templatesQuery.data ?? [];
  const isLoading = docsQuery.isLoading || sheetsQuery.isLoading;

  const createNewDoc = async () => {
    const doc = await createDoc.mutateAsync({});
    router.push(fileHref(doc.id));
  };

  const createNewSheet = async (templateId?: string) => {
    const sheet = await createSheet.mutateAsync(templateId ? { templateId } : {});
    router.push(fileHref(sheet.id));
  };

  const onNewSheetClick = (event: ReactMouseEvent) => {
    if (templates.length === 0) {
      void createNewSheet();
      return;
    }
    openMenu(
      event,
      newSheetMenuItems({
        templates,
        onBlank: () => void createNewSheet(),
        onTemplate: (templateId) => void createNewSheet(templateId),
      }),
      { title: "New sheet" },
    );
  };

  // A .csv becomes a sheet; anything else is read as Markdown into a doc.
  const handleImport = async (file: File) => {
    if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
      const csv = await importCsvGrid(await file.text());
      const title = file.name.replace(/\.csv$/i, "") || "Imported sheet";
      const sheet = await createSheet.mutateAsync({ title, ...csv });
      router.push(fileHref(sheet.id));
      return;
    }
    const imported = await readMarkdownFile(file);
    const doc = await createDoc.mutateAsync({
      title: imported.title,
      content: imported.content,
      plainText: imported.plainText,
    });
    router.push(fileHref(doc.id));
  };

  const showError = (error: unknown) =>
    useToastStore.getState().show(error instanceof Error ? error.message : "Could not rename");

  const commitDocRename = (doc: Doc, next: string) => {
    const title = next.trim();
    if (!title || title === doc.title) {
      setRenamingKey(null);
      return;
    }
    void updateDoc
      .mutateAsync({ id: doc.id, title })
      .then(() => setRenamingKey(null))
      .catch(showError);
  };

  const commitSheetRename = (sheet: Sheet, next: string) => {
    const title = next.trim();
    if (!title || title === sheet.title) {
      setRenamingKey(null);
      return;
    }
    void updateSheet
      .mutateAsync({ id: sheet.id, title })
      .then(() => setRenamingKey(null))
      .catch(showError);
  };

  const renderItem = (item: Item, group: "favorite" | "recent") => {
    const key = `${group}:${itemId(item)}`;
    if (item.kind === "doc") {
      return (
        <DocCard
          key={key}
          doc={item.doc}
          renaming={renamingKey === key}
          onContextMenu={(event, doc) =>
            openMenu(event, docMenu(doc, { onRename: () => setRenamingKey(key) }), { title: doc.title })
          }
          onCommitRename={commitDocRename}
          onCancelRename={() => setRenamingKey(null)}
        />
      );
    }
    const { sheet } = item;
    return (
      <SheetCard
        key={key}
        sheet={sheet}
        meta={group === "favorite" ? sheetMetaLabel(sheet) : `${sheet.rows.length} rows · ${sheet.columns.length} columns`}
        updated={group === "recent" ? formatSheetDate(sheet.updatedAt) : undefined}
        favorite={sheet.isFavorite}
        renaming={renamingKey === key}
        onContextMenu={(event) =>
          openMenu(event, sheetMenu(sheet, { onRename: () => setRenamingKey(key) }), { title: sheet.title })
        }
        onCommitRename={commitSheetRename}
        onCancelRename={() => setRenamingKey(null)}
      />
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <ExpandCollapsedListButton storageKey="timely.filesListCollapsed" label="files list" />
              <h1 className="text-2xl font-semibold text-foreground">Files</h1>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Docs for notes, specs and meeting minutes; sheets for numbers in a grid. Type{" "}
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs">/</kbd>{" "}
              inside a doc for blocks, or a formula like{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-primary">=SUM(A1:A10)</code>{" "}
              in a sheet cell.
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <label
              title="Import a Markdown file as a doc, or a CSV file as a sheet"
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 font-medium text-foreground transition-colors hover:border-primary/30"
            >
              <Upload className="size-4" />
              Import
              <input
                type="file"
                accept=".md,.markdown,.csv,text/markdown,text/csv,text/plain"
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
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 font-medium text-foreground transition-colors hover:border-primary/30 disabled:opacity-60"
            >
              <Plus className="size-4" />
              {createSheet.isPending ? "Creating..." : "New sheet"}
              {templates.length > 0 && <ChevronDown className="size-4 opacity-80" />}
            </button>
            <button
              type="button"
              onClick={() => void createNewDoc()}
              disabled={createDoc.isPending}
              className="flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              <Plus className="size-4" />
              {createDoc.isPending ? "Creating..." : "New doc"}
            </button>
          </div>
        </div>

        {favorites.length > 0 && (
          <>
            <h2 className={sectionHeading}>Favorites</h2>
            <div className={`mt-3 ${grid}`}>{favorites.map((item) => renderItem(item, "favorite"))}</div>
          </>
        )}

        {isLoading && <p className="mt-6 text-sm text-muted-foreground">Loading files...</p>}

        {docsQuery.isError && (
          <QueryFailure
            what="docs"
            hasData={Boolean(docsQuery.data)}
            error={docsQuery.error}
            onRetry={() => docsQuery.refetch()}
            retrying={docsQuery.isFetching}
            className="mt-3"
          />
        )}
        {sheetsQuery.isError && (
          <QueryFailure
            what="sheets"
            hasData={Boolean(sheetsQuery.data)}
            error={sheetsQuery.error}
            onRetry={() => sheetsQuery.refetch()}
            retrying={sheetsQuery.isFetching}
            className="mt-3"
          />
        )}

        {!isLoading && !docsQuery.isError && !sheetsQuery.isError && recent.length === 0 && templates.length === 0 && (
          <div className="mt-6 flex flex-1 items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-10">
            <p className="text-sm text-muted-foreground">
              Nothing here yet. Create a doc or a sheet, or import a Markdown or CSV file.
            </p>
          </div>
        )}

        {recent.length > 0 && (
          <>
            {favorites.length > 0 && <h2 className={sectionHeading}>Recent</h2>}
            <div className={`${favorites.length > 0 ? "mt-3" : "mt-6"} ${grid}`}>
              {recent.map((item) => renderItem(item, "recent"))}
            </div>
          </>
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

        {templates.length > 0 && (
          <>
            <h2 className={sectionHeading}>Sheet templates</h2>
            <div className={`mt-3 ${grid}`}>
              {templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  renaming={renamingKey === `template:${template.id}`}
                  onOpen={() => router.push(fileHref(template.id))}
                  onContextMenu={(event) =>
                    openMenu(
                      event,
                      tidyEntries([
                        {
                          kind: "action",
                          label: "New sheet from template",
                          onSelect: () => void createNewSheet(template.id),
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
                      .catch(showError);
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
