"use client";

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Plus, Upload } from "lucide-react";
import { useCreateDoc, useDocs, useUpdateDoc } from "@/app/utils/hooks/docs";
import { readMarkdownFile } from "@/app/utils/importMarkdown";
import ExpandCollapsedListButton from "@/app/_components/_ui/expandCollapsedListButton";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { useDocContextMenu } from "@/app/utils/hooks/useDocContextMenu";
import type { Doc } from "@/app/_types/types";

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DocsPage() {
  const router = useRouter();
  const { data: docs, isLoading } = useDocs();
  const createDoc = useCreateDoc();
  const updateDoc = useUpdateDoc();
  const openMenu = useContextMenu();
  const docMenu = useDocContextMenu();
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const recentDocs = (docs ?? []).filter((doc) => !doc.archivedAt).slice(0, 12);

  const handleCreate = async () => {
    const doc = await createDoc.mutateAsync({});
    router.push(`/docs/${doc.id}`);
  };

  const handleImport = async (file: File) => {
    const imported = await readMarkdownFile(file);
    const doc = await createDoc.mutateAsync({
      title: imported.title,
      content: imported.content,
      plainText: imported.plainText,
    });
    router.push(`/docs/${doc.id}`);
  };

  const onDocContextMenu = (event: ReactMouseEvent, doc: Doc) =>
    openMenu(
      event,
      docMenu(doc, {
        onRename: () => setRenamingId(doc.id),
      }),
      { title: doc.title },
    );

  const commitRename = (doc: Doc, next: string) => {
    const title = next.trim();
    setRenamingId(null);
    if (!title || title === doc.title) return;
    void updateDoc.mutateAsync({ id: doc.id, title });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <ExpandCollapsedListButton
                storageKey="timely.docsListCollapsed"
                label="docs list"
              />
              <h1 className="text-2xl font-semibold text-foreground">Docs</h1>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Write notes, specs and meeting minutes. Type{" "}
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs">
                /
              </kbd>{" "}
              inside a page for blocks, or use markdown shortcuts like{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">##</code>{" "}
              and{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">-</code>.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 font-medium text-foreground transition-colors hover:border-primary/30">
              <Upload className="size-4" />
              Import .md
              <input
                type="file"
                accept=".md,.markdown,text/markdown,text/plain"
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
              onClick={handleCreate}
              disabled={createDoc.isPending}
              className="flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              <Plus className="size-4" />
              {createDoc.isPending ? "Creating..." : "New doc"}
            </button>
          </div>
        </div>

        {isLoading && (
          <p className="mt-6 text-sm text-muted-foreground">Loading docs...</p>
        )}

        {!isLoading && recentDocs.length === 0 && (
          <div className="mt-6 flex flex-1 items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-10">
            <p className="text-sm text-muted-foreground">
              Nothing here yet. Your pages will show up once you create one.
            </p>
          </div>
        )}

        {recentDocs.length > 0 && (
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {recentDocs.map((doc) => (
              <DocCard
                key={doc.id}
                doc={doc}
                renaming={renamingId === doc.id}
                onContextMenu={onDocContextMenu}
                onCommitRename={commitRename}
                onCancelRename={() => setRenamingId(null)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DocCard({
  doc,
  renaming,
  onContextMenu,
  onCommitRename,
  onCancelRename,
}: {
  doc: Doc;
  renaming: boolean;
  onContextMenu: (event: ReactMouseEvent, doc: Doc) => void;
  onCommitRename: (doc: Doc, next: string) => void;
  onCancelRename: () => void;
}) {
  const icon = (
    <span className="text-base leading-none">
      {doc.icon ?? <FileText className="size-4 text-muted-foreground" />}
    </span>
  );

  if (renaming) {
    return (
      <div className="rounded-xl border border-ring bg-card p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const title = new FormData(event.currentTarget).get("title");
            onCommitRename(doc, typeof title === "string" ? title : "");
          }}
        >
          <div className="flex items-center gap-2">
            {icon}
            <input
              name="title"
              autoFocus
              defaultValue={doc.title}
              aria-label="Rename doc"
              onBlur={(event) => onCommitRename(doc, event.currentTarget.value)}
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
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
          {doc.plainText.trim() || "Empty page"}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          {formatUpdatedAt(doc.updatedAt)}
        </p>
      </div>
    );
  }

  return (
    <Link
      href={`/docs/${doc.id}`}
      onContextMenu={(event) => onContextMenu(event, doc)}
      className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30 hover:bg-accent/50"
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="truncate font-medium text-foreground">{doc.title}</span>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {doc.plainText.trim() || "Empty page"}
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        {formatUpdatedAt(doc.updatedAt)}
      </p>
    </Link>
  );
}
