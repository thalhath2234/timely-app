"use client";

import { motion } from "motion/react";
import { revealProps } from "@/app/_components/_ui/motion";
import { SkeletonRows } from "@/app/_components/_ui/skeleton";
import EmptyState from "@/app/_components/_ui/emptyState";
import Button, { buttonClass } from "@/app/_components/_ui/button";
import PageHeader from "@/app/_components/_ui/pageHeader";
import PageWithRail from "@/app/_components/_ui/pageWithRail";
import FilesRail from "@/app/_components/files/filesRail";
import { useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, FileText, LayoutTemplate, Plus, Sheet as SheetIcon, Star, Upload } from "lucide-react";
import { useCreateDoc, useDocs, useUpdateDoc } from "@/app/utils/hooks/docs";
import {
  useCreateSheet,
  useSheets,
  useSheetTemplates,
  useUpdateSheet,
  useUpdateSheetTemplate,
} from "@/app/utils/hooks/sheets";
import { readMarkdownFile } from "@/app/utils/importMarkdown";
import { importCsvGrid } from "@/app/utils/sheetCsv";
import { fileHref } from "@/app/utils/fileRoutes";
import { QueryFailure } from "@/app/_components/_ui/loadError";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { useDocContextMenu } from "@/app/utils/hooks/useDocContextMenu";
import { useSheetContextMenu } from "@/app/utils/hooks/useSheetContextMenu";
import { useTemplateDelete } from "@/app/utils/hooks/useTemplateDelete";
import { newSheetMenuItems, sheetCreatePayload } from "@/app/_components/sheets/sheetTemplateMenu";
import { formatUpdatedAt } from "@/app/_components/docs/docCard";
import FilePreview, { docWords, type FileItem } from "@/app/_components/files/filePreview";
import { GroupLabel } from "@/app/_components/_ui/groupedList";
import { cn } from "@/app/utils/cn";
import { tidyEntries } from "@/app/_store/contextMenuStore";
import { useToastStore } from "@/app/_store/toastStore";
import type { Doc, Sheet, SheetTemplate } from "@/app/_types/types";
import { plural } from "@/app/utils/plural";

type Item = FileItem;

const itemId = (item: Item) => (item.kind === "doc" ? item.doc.id : item.sheet.id);
const itemUpdatedAt = (item: Item) => (item.kind === "doc" ? item.doc.updatedAt : item.sheet.updatedAt);

const list = "overflow-hidden rounded-[12px] border border-border bg-card";
/** A row of the files list: icon, name, type and size, edited; selected rows feed the preview. */
const rowClass =
  "grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-border px-3 text-left transition-colors first:border-t-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:bg-muted/40 lg:grid-cols-[2rem_minmax(0,1fr)_8rem_7rem]";

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
  const { confirmSheetTemplate } = useTemplateDelete();
  const openMenu = useContextMenu();
  const docMenu = useDocContextMenu();
  const sheetMenu = useSheetContextMenu();
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  // The row whose preview the rail shows; the most recent file until one is picked.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const items: Item[] = [
    ...(docsQuery.data ?? []).filter((doc) => !doc.archivedAt).map((doc) => ({ kind: "doc" as const, doc })),
    ...(sheetsQuery.data ?? []).filter((sheet) => !sheet.archivedAt).map((sheet) => ({ kind: "sheet" as const, sheet })),
  ].sort((a, b) => itemUpdatedAt(b).localeCompare(itemUpdatedAt(a)));
  const favorites = items.filter((item) => (item.kind === "doc" ? item.doc.isFavorite : item.sheet.isFavorite));
  const recent = items.filter((item) => !favorites.includes(item)).slice(0, 24);
  const templates = templatesQuery.data ?? [];
  const selected = items.find((item) => itemId(item) === selectedId) ?? items[0] ?? null;
  const isLoading = docsQuery.isLoading || sheetsQuery.isLoading;

  const createNewDoc = async () => {
    const doc = await createDoc.mutateAsync({});
    router.push(fileHref(doc.id));
  };

  const createNewSheet = async (templateId?: string) => {
    const sheet = await createSheet.mutateAsync(sheetCreatePayload(templateId));
    router.push(fileHref(sheet.id));
  };

  const onNewSheetClick = (event: ReactMouseEvent) => {
    openMenu(
      event,
      newSheetMenuItems({
        templates,
        onBlank: () => void createNewSheet(),
        onTemplate: (templateId) => void createNewSheet(templateId),
        onDeleteTemplate: confirmSheetTemplate,
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

  const rowKeys = (event: ReactKeyboardEvent, href: string) => {
    if (event.key === "Enter") {
      event.preventDefault();
      router.push(href);
    }
  };

  const renderItem = (item: Item, group: "favorite" | "recent", index = 0) => {
    const key = `${group}:${itemId(item)}`;
    const id = itemId(item);
    const href = fileHref(id);
    const isSelected = selected !== null && itemId(selected) === id;
    const favorite = item.kind === "doc" ? item.doc.isFavorite : item.sheet.isFavorite;
    const icon = item.kind === "doc" ? item.doc.icon : item.sheet.icon;
    const title = item.kind === "doc" ? item.doc.title : item.sheet.title;
    const kindLabel = item.kind === "doc" ? `Doc · ${plural(docWords(item.doc), "word")}` : `Sheet · ${item.sheet.rows.length} × ${item.sheet.columns.length}`;
    const onContextMenu = (event: ReactMouseEvent) =>
      item.kind === "doc"
        ? openMenu(event, docMenu(item.doc, { onRename: () => setRenamingKey(key) }), { title: item.doc.title })
        : openMenu(event, sheetMenu(item.sheet, { onRename: () => setRenamingKey(key) }), { title: item.sheet.title });
    const commit = (next: string) => (item.kind === "doc" ? commitDocRename(item.doc, next) : commitSheetRename(item.sheet, next));
    const glyph = (
      <span className={cn("flex size-8 items-center justify-center rounded-[8px] text-base leading-none", item.kind === "sheet" ? "bg-primary/12 text-primary" : "bg-muted")}>
        {icon ?? (item.kind === "doc" ? <FileText className="size-4 text-muted-foreground" /> : <SheetIcon className="size-4" />)}
      </span>
    );
    if (renamingKey === key) {
      return (
        <form
          key={key}
          className={cn(rowClass, "h-12")}
          onSubmit={(event) => {
            event.preventDefault();
            const next = new FormData(event.currentTarget).get("title");
            commit(typeof next === "string" ? next : "");
          }}
        >
          {glyph}
          <input
            name="title"
            autoFocus
            defaultValue={title}
            aria-label={item.kind === "doc" ? "Rename doc" : "Rename sheet"}
            onBlur={(event) => commit(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setRenamingKey(null);
              }
            }}
            className="min-w-0 rounded border border-ring bg-input/40 px-1 py-0.5 text-sm font-medium outline-none"
          />
          <span className="hidden text-xs text-muted-foreground lg:block">{kindLabel}</span>
          <span className="text-right text-xs text-muted-foreground">{formatUpdatedAt(itemUpdatedAt(item))}</span>
        </form>
      );
    }
    return (
      <motion.div
        key={key}
        {...revealProps(index)}
        role="row"
        tabIndex={0}
        aria-selected={isSelected}
        onClick={() => setSelectedId(id)}
        onDoubleClick={() => router.push(href)}
        onKeyDown={(event) => rowKeys(event, href)}
        onFocus={() => setSelectedId(id)}
        onContextMenu={onContextMenu}
        className={cn(rowClass, "h-12 cursor-default", isSelected && "bg-primary/[0.07] hover:bg-primary/[0.09]")}
        data-testid="file-row"
      >
        {glyph}
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">{title || "Untitled"}</span>
          {favorite ? <Star className="size-3.5 shrink-0 fill-warning text-warning" aria-label="Favorite" /> : null}
        </span>
        <span className="hidden truncate text-xs text-muted-foreground lg:block">{kindLabel}</span>
        <span className="text-right text-xs tabular-nums text-muted-foreground">{formatUpdatedAt(itemUpdatedAt(item))}</span>
      </motion.div>
    );
  };

  const renderTemplate = (template: SheetTemplate) => {
    const key = `template:${template.id}`;
    const onContextMenu = (event: ReactMouseEvent) =>
      openMenu(
        event,
        tidyEntries([
          { kind: "action", label: "New sheet from template", onSelect: () => void createNewSheet(template.id) },
          { kind: "action", label: "Rename", onSelect: () => setRenamingKey(key) },
          { kind: "separator" },
          { kind: "action", label: "Delete", danger: true, onSelect: () => confirmSheetTemplate(template) },
        ]),
        { title: template.name },
      );
    const commit = (next: string) => {
      const name = next.trim();
      if (!name || name === template.name) {
        setRenamingKey(null);
        return;
      }
      void updateTemplate
        .mutateAsync({ id: template.id, name })
        .then(() => setRenamingKey(null))
        .catch(showError);
    };
    const glyph = (
      <span className="flex size-8 items-center justify-center rounded-[8px] bg-muted text-base leading-none">
        {template.icon ?? <LayoutTemplate className="size-4 text-muted-foreground" />}
      </span>
    );
    const size = `${plural(template.columns.length, "column")} · ${plural(template.rows.length, "row")}`;
    if (renamingKey === key) {
      return (
        <form
          key={key}
          className={cn(rowClass, "h-12")}
          onSubmit={(event) => {
            event.preventDefault();
            const next = new FormData(event.currentTarget).get("name");
            commit(typeof next === "string" ? next : "");
          }}
        >
          {glyph}
          <input
            name="name"
            autoFocus
            defaultValue={template.name}
            aria-label="Rename template"
            onBlur={(event) => commit(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setRenamingKey(null);
              }
            }}
            className="min-w-0 rounded border border-ring bg-input/40 px-1 py-0.5 text-sm font-medium outline-none"
          />
          <span className="hidden text-xs text-muted-foreground lg:block">{size}</span>
          <span />
        </form>
      );
    }
    return (
      <div key={key} role="row" className={cn(rowClass, "h-12")} onContextMenu={onContextMenu} data-testid="template-row">
        {glyph}
        <button type="button" onClick={() => router.push(fileHref(template.id))} className="min-w-0 truncate text-left text-sm font-medium text-foreground hover:underline">
          {template.name}
        </button>
        <span className="hidden truncate text-xs text-muted-foreground lg:block">{size}</span>
        <span className="text-right">
          <Button size="sm" variant="soft" onClick={() => void createNewSheet(template.id)} loading={createSheet.isPending}>
            Use
          </Button>
        </span>
      </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Files"
        actions={
          <>
            <label
              title="Import a Markdown file as a doc, or a CSV file as a sheet"
              className={buttonClass({ variant: "outline" })}
            >
              <Upload />
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
            <Button
              variant="outline"
              onClick={onNewSheetClick}
              loading={createSheet.isPending}
              leading={<Plus />}
              trailing={<ChevronDown className="opacity-70" />}
            >
              New sheet
            </Button>
            <Button onClick={() => void createNewDoc()} loading={createDoc.isPending} leading={<Plus />}>
              New doc
            </Button>
          </>
        }
      />
      <PageWithRail
        className="px-6 pb-6"
        sticky
        rail={
          <>
            {items.length > 0 ? <FilePreview item={selected} /> : null}
            <FilesRail
              docs={docsQuery.data ?? []}
            sheets={sheetsQuery.data ?? []}
            templates={templates}
            creating={createSheet.isPending}
            onCreateFromTemplate={(templateId) => void createNewSheet(templateId)}
            />
          </>
        }
      >
        {favorites.length > 0 && (
          <section className="mt-1" aria-label="Favorites">
            <GroupLabel aside={plural(favorites.length, "file")}>Favorites</GroupLabel>
            <div className={list} role="grid">
              {favorites.map((item, index) => renderItem(item, "favorite", index))}
            </div>
          </section>
        )}

        {isLoading && <SkeletonRows rows={6} height={48} className="mt-6" />}

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
          <EmptyState
            loop="files"
            title="Nothing here yet"
            description="Docs turn lines into tasks; sheets turn cells into cards and widgets. Or import a Markdown or CSV file."
            className="mt-4"
            action={
              <>
                <Button onClick={() => void createNewDoc()} loading={createDoc.isPending} leading={<Plus />}>
                  New doc
                </Button>
                <Button variant="outline" onClick={onNewSheetClick} loading={createSheet.isPending}>
                  New sheet
                </Button>
              </>
            }
          />
        )}

        {recent.length > 0 && (
          <section className={favorites.length > 0 ? "mt-4" : "mt-1"} aria-label="Recent">
            <GroupLabel aside={plural(recent.length, "file")}>{favorites.length > 0 ? "Recent" : "All files"}</GroupLabel>
            <div className={list} role="grid">
              {recent.map((item, index) => renderItem(item, "recent", index))}
            </div>
          </section>
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
          <section className="mt-4" aria-label="Sheet templates">
            <GroupLabel aside={plural(templates.length, "template")}>Sheet templates</GroupLabel>
            <div className={list} role="grid">
              {templates.map(renderTemplate)}
            </div>
          </section>
        )}
      </PageWithRail>
    </div>
  );
}
