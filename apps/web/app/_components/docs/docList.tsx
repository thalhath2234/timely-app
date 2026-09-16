"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ChevronRight,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { Doc } from "@/app/_types/types";
import { useCreateDoc, useDeleteDoc, useDocs } from "@/app/utils/hooks/docs";
import { QueryFailure } from "@/app/_components/_ui/loadError";
import { readMarkdownFile } from "@/app/utils/importMarkdown";
import { useCollapsedPanel } from "@/app/utils/hooks/useCollapsedPanel";

interface DocNode extends Doc {
  children: DocNode[];
}

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

export default function DocList() {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const activeId = params?.id;

  const docsQuery = useDocs();
  const { data: docs, isLoading } = docsQuery;
  const createDoc = useCreateDoc();
  const deleteDoc = useDeleteDoc();

  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const { collapsed, toggle } = useCollapsedPanel("timely.docsListCollapsed");

  const allDocs = useMemo(
    () =>
      (docs ?? []).filter((doc) =>
        showArchived ? Boolean(doc.archivedAt) : !doc.archivedAt,
      ),
    [docs, showArchived],
  );
  const tree = useMemo(() => buildTree(allDocs), [allDocs]);

  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return null;

    return allDocs.filter(
      (doc) =>
        doc.title.toLowerCase().includes(query) ||
        doc.plainText.toLowerCase().includes(query),
    );
  }, [allDocs, search]);

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
    router.push(`/docs/${doc.id}`);
  };

  const handleDelete = async (id: string) => {
    await deleteDoc.mutateAsync(id);
    setPendingDeleteId(null);

    if (activeId === id) router.push("/docs");
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
              ? "bg-[#c0c1ff]/12 text-foreground"
              : "hover:bg-white/[0.04]"
          }`}
          style={{ paddingLeft: depth * 12 }}
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

          <Link
            href={`/docs/${node.id}`}
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
            className="my-1 rounded-md border border-white/10 bg-[#191b22] p-2 text-xs"
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
                className="cursor-pointer rounded-md bg-destructive px-2 py-1 text-white transition-opacity hover:opacity-90 disabled:opacity-60"
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

  if (collapsed) {
    return (
      <aside className="flex h-full w-11 shrink-0 flex-col items-center gap-2 border-r border-white/10 bg-[#111319] py-3">
        <button
          type="button"
          title="Expand docs list"
          onClick={toggle}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        >
          <PanelLeftOpen className="size-4" />
        </button>
        <button
          type="button"
          title="New doc"
          onClick={() => handleCreate()}
          disabled={createDoc.isPending}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md bg-[#c0c1ff] text-[#1000a9] hover:bg-[#a8a6ff] disabled:opacity-60"
        >
          <Plus className="size-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-white/10 bg-[#111319]">
      <div className="flex items-center justify-between px-3 py-3">
        <h2 className="text-sm font-semibold text-foreground">
          {showArchived ? "Archived" : "Docs"}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Collapse docs list"
            onClick={toggle}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <PanelLeftClose className="size-4" />
          </button>
          <button
            type="button"
            title="New doc"
            onClick={() => handleCreate()}
            disabled={createDoc.isPending}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md bg-[#c0c1ff] text-[#1000a9] hover:bg-[#a8a6ff] disabled:opacity-60"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      <div className="px-3 pb-2">
        <label className="mb-2 flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/10 px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-[#c0c1ff]/30 hover:text-foreground">
          <Upload className="size-3.5" />
          Import Markdown
          <input
            type="file"
            accept=".md,.markdown,text/markdown,text/plain"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void readMarkdownFile(file).then((imported) =>
                createDoc
                  .mutateAsync({
                    title: imported.title,
                    content: imported.content,
                    plainText: imported.plainText,
                  })
                  .then((doc) => router.push(`/docs/${doc.id}`)),
              );
            }}
          />
        </label>
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#0c0e14] px-2 py-1.5 transition focus-within:border-[#c0c1ff]/40">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search docs"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowArchived((previous) => !previous)}
          className="mt-2 text-xs text-muted-foreground hover:text-foreground"
        >
          {showArchived ? "Show active docs" : "Show archived"}
        </button>
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

        {!isLoading && !(docsQuery.isError && !docs) && allDocs.length === 0 && (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            No docs yet. Create your first page.
          </p>
        )}

        {searchResults
          ? searchResults.map((doc) => (
              <Link
                key={doc.id}
                href={`/docs/${doc.id}`}
                className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                  doc.id === activeId
                    ? "bg-[#c0c1ff]/12 text-foreground"
                    : "hover:bg-white/[0.04]"
                }`}
              >
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{doc.title}</span>
              </Link>
            ))
          : tree.map((node) => renderRow(node, 0))}

        {searchResults?.length === 0 && (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            No matches for &quot;{search}&quot;
          </p>
        )}
      </div>
    </aside>
  );
}
