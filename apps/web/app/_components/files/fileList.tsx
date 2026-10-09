"use client";

import {
  docFrontmatter,
  frontmatterEntries,
  matchesPropertyFilters,
  splitPropertyQuery,
} from "@timely/contract/properties";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { availableTemplates, contentFromTemplate, dailyNoteTemplate, dateKey, templateVars, type DocTemplate } from "@timely/contract/templates";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronRight,
  FileText,
  LayoutTemplate,
  PanelLeftClose,
  Plus,
  Search,
  Sheet as SheetIcon,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import type { Doc, Sheet } from "@/app/_types/types";
import { docsKey, useCreateDoc, useDeleteDoc, useDocs, useUpdateDoc } from "@/app/utils/hooks/docs";
import {
  useCreateSheet,
  useDeleteSheet,
  useSheets,
  useSheetTemplates,
  useUpdateSheet,
} from "@/app/utils/hooks/sheets";
import { fileHref, FILES_PATH } from "@/app/utils/fileRoutes";
import { importCsvGrid } from "@/app/utils/sheetCsv";
import { openDailyDoc } from "@/app/utils/api/docs";
import { useToastStore } from "@/app/_store/toastStore";
import { QueryFailure } from "@/app/_components/_ui/loadError";
import { readMarkdownFile } from "@/app/utils/importMarkdown";
import { useCollapsedPanel } from "@/app/utils/hooks/useCollapsedPanel";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { useDocContextMenu } from "@/app/utils/hooks/useDocContextMenu";
import { useSheetContextMenu } from "@/app/utils/hooks/useSheetContextMenu";
import { newSheetMenuItems } from "@/app/_components/sheets/sheetTemplateMenu";
import { tidyEntries } from "@/app/_store/contextMenuStore";

interface DocNode extends Doc {
  children: DocNode[];
}

/** A top-level row: a doc (with its subpages) or a sheet. */
type RootRow = { kind: "doc"; node: DocNode } | { kind: "sheet"; sheet: Sheet };

type KindFilter = "all" | "doc" | "sheet";

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "doc", label: "Docs" },
  { value: "sheet", label: "Sheets" },
];

// Sheets have no manual order, so they sit with docs that were never moved.
const rootOrder = (row: RootRow) => (row.kind === "doc" ? row.node.order : 0);
const rootUpdatedAt = (row: RootRow) => (row.kind === "doc" ? row.node.updatedAt : row.sheet.updatedAt);

function buildTree(docs: Doc[]): DocNode[] {
  const byId = new Map<string, DocNode>();
  docs.forEach((doc) => byId.set(doc.id, { ...doc, children: [] }));

  const roots: DocNode[] = [];
  byId.forEach((node) => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortNodes = (nodes: DocNode[]) => {
    nodes.sort(
      (a, b) => a.order - b.order || b.updatedAt.localeCompare(a.updatedAt),
    );
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(roots);

  return roots;
}

function collectAncestorIds(docs: Doc[], docId: string | undefined) {
  if (!docId) return [] as string[];

  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const ancestors: string[] = [];
  let current = byId.get(docId)?.parentId ?? null;

  while (current && ancestors.length < 100) {
    ancestors.push(current);
    current = byId.get(current)?.parentId ?? null;
  }

  return ancestors;
}

function countDescendants(node: DocNode): number {
  return node.children.reduce(
    (total, child) => total + 1 + countDescendants(child),
    0,
  );
}

const quickButton =
  "flex cursor-pointer items-center justify-center gap-1 rounded-lg border border-dashed border-border px-1.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground";

/** Docs and sheets in one list: the Files section's sidebar. */
export default function FileList() {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const activeId = params?.id;

  const docsQuery = useDocs();
  const { data: docs } = docsQuery;
  const createDoc = useCreateDoc();
  const deleteDoc = useDeleteDoc();
  const updateDoc = useUpdateDoc();
  const sheetsQuery = useSheets();
  const { data: sheets } = sheetsQuery;
  const sheetTemplates = useSheetTemplates().data ?? [];
  const createSheet = useCreateSheet();
  const deleteSheet = useDeleteSheet();
  const updateSheet = useUpdateSheet();
  const isLoading = docsQuery.isLoading || sheetsQuery.isLoading;

  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const { collapsed, toggle } = useCollapsedPanel("timely.filesListCollapsed");
  const openMenu = useContextMenu();
  const docMenu = useDocContextMenu();
  const sheetMenu = useSheetContextMenu();

  const allDocs = useMemo(
    () =>
      (docs ?? []).filter((doc) =>
        showArchived ? Boolean(doc.archivedAt) : !doc.archivedAt,
      ),
    [docs, showArchived],
  );
  const allSheets = useMemo(
    () =>
      (sheets ?? []).filter((sheet) =>
        showArchived ? Boolean(sheet.archivedAt) : !sheet.archivedAt,
      ),
    [sheets, showArchived],
  );
  const tree = useMemo(() => buildTree(allDocs), [allDocs]);

  // Root docs and sheets share one order: manual order first, then newest.
  const rootRows = useMemo(() => {
    const rows: RootRow[] = [
      ...(kindFilter === "sheet" ? [] : tree.map((node) => ({ kind: "doc" as const, node }))),
      ...(kindFilter === "doc" ? [] : allSheets.map((sheet) => ({ kind: "sheet" as const, sheet }))),
    ];
    return rows.sort(
      (a, b) => rootOrder(a) - rootOrder(b) || rootUpdatedAt(b).localeCompare(rootUpdatedAt(a)),
    );
  }, [tree, allSheets, kindFilter]);

  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    // "status:draft" style terms filter by the doc's properties.
    const { text, filters } = splitPropertyQuery(search);
    const query = text.toLowerCase();

    const docHits = allDocs.filter(
      (doc) =>
        (filters.length === 0 ||
          matchesPropertyFilters(frontmatterEntries(docFrontmatter(doc.content)), filters)) &&
        (!query ||
          doc.title.toLowerCase().includes(query) ||
          doc.plainText.toLowerCase().includes(query)),
    );
    // Sheets have no properties, so a property filter leaves only docs.
    const sheetHits = filters.length > 0
      ? []
      : allSheets.filter((sheet) => sheet.title.toLowerCase().includes(query));
    return [
      ...(kindFilter === "sheet" ? [] : docHits.map((doc) => ({ kind: "doc" as const, node: { ...doc, children: [] } }))),
      ...(kindFilter === "doc" ? [] : sheetHits.map((sheet) => ({ kind: "sheet" as const, sheet }))),
    ] satisfies RootRow[];
  }, [allDocs, allSheets, search, kindFilter]);

  // Ancestors of the open doc are revealed automatically, unless the user has
  // explicitly collapsed them.
  const autoExpandedIds = useMemo(
    () => new Set(collectAncestorIds(allDocs, activeId)),
    [allDocs, activeId],
  );

  const isExpanded = (id: string) =>
    !collapsedIds.has(id) && (expandedIds.has(id) || autoExpandedIds.has(id));

  const withoutId = (ids: Set<string>, id: string) => {
    const next = new Set(ids);
    next.delete(id);
    return next;
  };

  const expandNode = (id: string) => {
    setExpandedIds((previous) => new Set(previous).add(id));
    setCollapsedIds((previous) => withoutId(previous, id));
  };

  const toggleExpanded = (id: string) => {
    if (isExpanded(id)) {
      setExpandedIds((previous) => withoutId(previous, id));
      setCollapsedIds((previous) => new Set(previous).add(id));
      return;
    }
    expandNode(id);
  };

  const handleCreate = async (parentId?: string) => {
    const doc = await createDoc.mutateAsync(parentId ? { parentId } : {});

    if (parentId) expandNode(parentId);
    router.push(fileHref(doc.id));
  };

  const handleCreateSheet = async (templateId?: string) => {
    const sheet = await createSheet.mutateAsync(templateId ? { templateId } : {});
    router.push(fileHref(sheet.id));
  };

  const onNewClick = (event: React.MouseEvent) =>
    openMenu(
      event,
      tidyEntries([
        { kind: "action", label: "New doc", icon: FileText, onSelect: () => void handleCreate() },
        { kind: "separator" },
        ...newSheetMenuItems({
          templates: sheetTemplates,
          onBlank: () => void handleCreateSheet(),
          onTemplate: (templateId) => void handleCreateSheet(templateId),
        }),
      ]),
      { title: "New" },
    );

  const importFile = async (file: File) => {
    // A .csv becomes a sheet; anything else is read as Markdown into a doc.
    if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
      const grid = await importCsvGrid(await file.text());
      const title = file.name.replace(/\.csv$/i, "") || "Imported sheet";
      const sheet = await createSheet.mutateAsync({ title, ...grid });
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

  const queryClient = useQueryClient();
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const templates = useMemo(() => availableTemplates(docs ?? []), [docs]);

  const createFromTemplate = async (template: DocTemplate) => {
    setIsTemplateMenuOpen(false);
    const title = template.id.startsWith("builtin:") ? template.title : `${template.title} copy`;
    const { content, plainText } = contentFromTemplate(template, templateVars(new Date(), title));
    const doc = await createDoc.mutateAsync({ title, icon: template.icon, content, plainText });
    router.push(fileHref(doc.id));
  };

  const openToday = async () => {
    try {
      const now = new Date();
      const date = dateKey(now);
      const { content, plainText } = contentFromTemplate(dailyNoteTemplate(docs ?? []), templateVars(now, date));
      const { document } = await openDailyDoc({ date, title: date, content, plainText });
      await queryClient.invalidateQueries({ queryKey: docsKey });
      router.push(fileHref(document.id));
    } catch (error) {
      useToastStore.getState().show(error instanceof Error ? error.message : "Could not open today's note");
    }
  };

  const handleDelete = async (id: string) => {
    await deleteDoc.mutateAsync(id);
    setPendingDeleteId(null);

    if (activeId === id) router.push(FILES_PATH);
  };

  const handleDeleteSheet = async (id: string) => {
    await deleteSheet.mutateAsync(id);
    setPendingDeleteId(null);

    if (activeId === id) router.push(FILES_PATH);
  };

  const commitSheetRename = (sheet: Sheet, next: string) => {
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
          if (activeId === id) router.push(FILES_PATH);
        },
      }),
      { title: sheet.title },
    );
  };

  const onRowContextMenu = (event: React.MouseEvent, node: DocNode) => {
    openMenu(
      event,
      docMenu(node, {
        hasChildren: node.children.length > 0,
        expanded: isExpanded(node.id),
        onToggleExpand: () => toggleExpanded(node.id),
        onRename: () => setRenamingId(node.id),
        onDeleted: (id) => {
          setPendingDeleteId(null);
          if (activeId === id) router.push(FILES_PATH);
        },
      }),
      { title: node.title },
    );
  };

  const renderRow = (node: DocNode, depth: number) => {
    const isActive = node.id === activeId;
    const expanded = isExpanded(node.id);
    const hasChildren = node.children.length > 0;
    const descendantCount = countDescendants(node);

    return (
      <div key={node.id}>
        <div
          className={`group flex items-center gap-0.5 rounded-md pr-1 transition-colors ${
            isActive
              ? "bg-primary/12 text-foreground"
              : "hover:bg-accent"
          }`}
          style={{ paddingLeft: depth * 12 }}
          onContextMenu={(event) => onRowContextMenu(event, node)}
        >
          <button
            type="button"
            onClick={() => toggleExpanded(node.id)}
            aria-label={expanded ? "Collapse" : "Expand"}
            className={`flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-sidebar-border ${
              hasChildren ? "" : "invisible"
            }`}
          >
            <ChevronRight
              className={`size-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
            />
          </button>

          {renamingId === node.id ? (
            <form
              className="flex min-w-0 flex-1 items-center gap-1.5 py-1"
              onSubmit={(event) => {
                event.preventDefault();
                const title = new FormData(event.currentTarget).get("title");
                const next = typeof title === "string" ? title.trim() : "";
                setRenamingId(null);
                if (!next || next === node.title) return;
                void updateDoc.mutateAsync({ id: node.id, title: next });
              }}
            >
              <span className="shrink-0 text-base leading-none">
                {node.icon ? node.icon : <FileText className="size-3.5 text-muted-foreground" />}
              </span>
              <input
                name="title"
                autoFocus
                defaultValue={node.title}
                aria-label="Rename doc"
                onBlur={(event) => {
                  const next = event.currentTarget.value.trim();
                  setRenamingId(null);
                  if (!next || next === node.title) return;
                  void updateDoc.mutateAsync({ id: node.id, title: next });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setRenamingId(null);
                  }
                }}
                className="min-w-0 flex-1 rounded border border-ring bg-input/40 px-1 py-0.5 text-sm outline-none"
              />
            </form>
          ) : (
            <Link
              href={fileHref(node.id)}
              className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-sm"
            >
              <span className="shrink-0 text-base leading-none">
                {node.icon ? (
                  node.icon
                ) : (
                  <FileText className="size-3.5 text-muted-foreground" />
                )}
              </span>
              <span className="truncate">{node.title}</span>
              {node.isFavorite && (
                <Star className="size-3 shrink-0 fill-warning text-warning" />
              )}
            </Link>
          )}

          <button
            type="button"
            title="Add subpage"
            onClick={() => handleCreate(node.id)}
            className="flex size-6 shrink-0 items-center justify-center rounded opacity-0 transition hover:bg-sidebar-border group-hover:opacity-100"
          >
            <Plus className="size-3.5" />
          </button>

          <button
            type="button"
            title="Delete"
            onClick={() => setPendingDeleteId(node.id)}
            className="flex size-6 shrink-0 items-center justify-center rounded opacity-0 transition hover:bg-sidebar-border hover:text-destructive group-hover:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>

        {pendingDeleteId === node.id && (
          <div
            className="my-1 rounded-md border border-border bg-card p-2 text-xs"
            style={{ marginLeft: depth * 12 }}
          >
            <p className="text-muted-foreground">
              Delete <span className="text-foreground">{node.title}</span>
              {descendantCount > 0 &&
                ` and its ${descendantCount} subpage${descendantCount > 1 ? "s" : ""}`}
              ?
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
                onClick={() => handleDelete(node.id)}
                disabled={deleteDoc.isPending}
                className="cursor-pointer rounded-md bg-destructive-container px-2 py-1 text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                Delete
              </button>
            </div>
          </div>
        )}

        {expanded && node.children.map((child) => renderRow(child, depth + 1))}
      </div>
    );
  };

  const renderSheetRow = (sheet: Sheet) => {
    const isActive = sheet.id === activeId;
    const icon = (
      <span className="flex size-4 shrink-0 items-center justify-center text-base leading-none text-primary">
        {sheet.icon ? sheet.icon : <SheetIcon className="size-3.5" />}
      </span>
    );

    return (
      <div key={sheet.id}>
        <div
          className={`group flex items-center gap-0.5 rounded-md pr-1 transition-colors ${
            isActive ? "bg-primary/12 text-foreground" : "hover:bg-accent"
          }`}
          onContextMenu={(event) => onSheetContextMenu(event, sheet)}
        >
          {/* Lines sheets up with docs, which have an expand arrow here. */}
          <span className="size-5 shrink-0" />

          {renamingId === sheet.id ? (
            <form
              className="flex min-w-0 flex-1 items-center gap-1.5 py-1"
              onSubmit={(event) => {
                event.preventDefault();
                const title = new FormData(event.currentTarget).get("title");
                commitSheetRename(sheet, typeof title === "string" ? title : "");
              }}
            >
              {icon}
              <input
                name="title"
                autoFocus
                defaultValue={sheet.title}
                aria-label="Rename sheet"
                onBlur={(event) => commitSheetRename(sheet, event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setRenamingId(null);
                  }
                }}
                className="min-w-0 flex-1 rounded border border-ring bg-input/40 px-1 py-0.5 text-sm outline-none"
              />
            </form>
          ) : (
            <Link
              href={fileHref(sheet.id)}
              className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-sm"
            >
              {icon}
              <span className="truncate">{sheet.title}</span>
              {sheet.isFavorite && (
                <Star className="size-3 shrink-0 fill-warning text-warning" />
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
                onClick={() => handleDeleteSheet(sheet.id)}
                disabled={deleteSheet.isPending}
                className="cursor-pointer rounded-md bg-destructive-container px-2 py-1 text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (collapsed) return null;

  const listFailed = (docsQuery.isError && !docs) || (sheetsQuery.isError && !sheets);
  const isEmpty = rootRows.length === 0;
  const emptyLabel = {
    all: "No docs or sheets yet.",
    doc: "No docs yet. Create your first page.",
    sheet: "No sheets yet.",
  }[kindFilter];

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-background">
      <div className="flex items-center justify-between px-3 py-3">
        <h2 className="text-sm font-semibold text-foreground">
          {showArchived ? "Archived" : "Files"}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Collapse files list"
            onClick={toggle}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <PanelLeftClose className="size-4" />
          </button>
          <button
            type="button"
            title="New doc or sheet"
            onClick={onNewClick}
            disabled={createDoc.isPending || createSheet.isPending}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      <div className="px-3 pb-2">
        <div className="mb-2 grid grid-cols-3 gap-1">
          <button type="button" title="Open today's daily note" onClick={() => void openToday()} className={quickButton}>
            <CalendarDays className="size-3.5 shrink-0" />
            Today
          </button>
          <div className="relative">
            <button
              type="button"
              title="New doc or sheet from a template"
              aria-expanded={isTemplateMenuOpen}
              onClick={() => setIsTemplateMenuOpen((open) => !open)}
              className={`${quickButton} w-full`}
            >
              <LayoutTemplate className="size-3.5 shrink-0" />
              Template
            </button>
            {isTemplateMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onMouseDown={() => setIsTemplateMenuOpen(false)} />
                <div role="menu" aria-label="Templates" className="absolute left-0 top-9 z-50 max-h-[70vh] w-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl">
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      role="menuitem"
                      onClick={() => void createFromTemplate(template)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                    >
                      <span className="w-5 text-center">{template.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{template.title}</span>
                      {!template.id.startsWith("builtin:") && <span className="text-[10px] uppercase text-muted-foreground">Yours</span>}
                    </button>
                  ))}
                  <p className="px-2 pb-1 pt-1.5 text-[11px] leading-snug text-muted-foreground">
                    Turn any doc into a template from its header. Text like {"{{date}}"} is filled in.
                  </p>
                  {sheetTemplates.length > 0 && (
                    <>
                      <p className="border-t border-border px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Sheets
                      </p>
                      {sheetTemplates.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setIsTemplateMenuOpen(false);
                            void handleCreateSheet(template.id);
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                        >
                          <span className="flex w-5 justify-center">
                            {template.icon ?? <SheetIcon className="size-3.5 text-primary" />}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{template.name || "Untitled"}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          <label title="Import a Markdown file as a doc, or a CSV file as a sheet" className={quickButton}>
            <Upload className="size-3.5" />
            Import
            <input
              type="file"
              accept=".md,.markdown,.csv,text/markdown,text/csv,text/plain"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importFile(file);
              }}
            />
          </label>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-2 py-1.5 transition focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search files, or status:draft"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div role="radiogroup" aria-label="Show" className="flex rounded-md bg-muted p-0.5">
            {KIND_FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={kindFilter === option.value}
                onClick={() => setKindFilter(option.value)}
                className={`rounded px-2 py-0.5 text-xs transition-colors ${
                  kindFilter === option.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowArchived((previous) => !previous)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showArchived ? "Show active" : "Show archived"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {isLoading && (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">Loading...</p>
        )}

        {docsQuery.isError && (
          <div className="px-2 py-1.5">
            <QueryFailure
              what="docs"
              hasData={Boolean(docs)}
              error={docsQuery.error}
              onRetry={() => docsQuery.refetch()}
              retrying={docsQuery.isFetching}
              className="px-3 py-4"
            />
          </div>
        )}

        {sheetsQuery.isError && (
          <div className="px-2 py-1.5">
            <QueryFailure
              what="sheets"
              hasData={Boolean(sheets)}
              error={sheetsQuery.error}
              onRetry={() => sheetsQuery.refetch()}
              retrying={sheetsQuery.isFetching}
              className="px-3 py-4"
            />
          </div>
        )}

        {!isLoading && !listFailed && !searchResults && isEmpty && (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">{emptyLabel}</p>
        )}

        {(searchResults ?? rootRows).map((row) =>
          row.kind === "doc" ? renderRow(row.node, 0) : renderSheetRow(row.sheet),
        )}

        {searchResults?.length === 0 && (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            No matches for &quot;{search}&quot;
          </p>
        )}
      </div>
    </aside>
  );
}
