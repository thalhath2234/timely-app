"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderInput,
  FolderUp,
  Link2,
  PanelTop,
  Pencil,
  Plus,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import type { Doc } from "@/app/_types/types";
import { useCreateDoc, useDeleteDoc, useDocs, useUpdateDoc } from "@/app/utils/hooks/docs";
import { requestConfirm } from "@/app/_store/confirmStore";
import { useToastStore } from "@/app/_store/toastStore";
import { openInTab } from "@/app/_components/pageTabs/openInTab";
import { tidyEntries, type ContextMenuEntry } from "@/app/_store/contextMenuStore";
import { fileHref } from "@/app/utils/fileRoutes";

export type DocMenuOptions = {
  hasChildren?: boolean;
  expanded?: boolean;
  onRename?: () => void;
  onToggleExpand?: () => void;
  onDeleted?: (id: string) => void;
};

const MOVE_TARGETS = 15;

/** Pages a doc can move under: same workspace, not itself or one of its
 * sub-pages, not its current parent, templates or daily notes. Most recently
 * edited first. */
function moveTargets(docs: Doc[], doc: Doc) {
  const below = new Set([doc.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const d of docs) {
      if (d.parentId && below.has(d.parentId) && !below.has(d.id)) {
        below.add(d.id);
        grew = true;
      }
    }
  }
  return docs
    .filter((d) => !below.has(d.id) && d.id !== doc.parentId && d.workspaceId === doc.workspaceId && !d.archivedAt && !d.isTemplate && !d.dailyDate)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MOVE_TARGETS);
}

function copyText(text: string, message: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => useToastStore.getState().show(message))
    .catch(() => useToastStore.getState().show("Could not copy to clipboard"));
}

/** Right-click menu for a doc, shared by the docs list and the Dashboard. */
export function useDocContextMenu() {
  const router = useRouter();
  const createDoc = useCreateDoc();
  const deleteDoc = useDeleteDoc();
  const updateDoc = useUpdateDoc();
  const { data: allDocs } = useDocs();

  return useCallback(
    (doc: Doc, options: DocMenuOptions = {}): ContextMenuEntry[] => {
      const archived = Boolean(doc.archivedAt);
      const title = doc.title || "Untitled";
      const targets = moveTargets(allDocs ?? [], doc);

      return tidyEntries([
        {
          kind: "action",
          label: "Open",
          icon: FileText,
          shortcut: "Enter",
          onSelect: () => router.push(fileHref(doc.id)),
        },
        {
          kind: "action",
          label: "Open in new tab",
          icon: PanelTop,
          onSelect: () => openInTab(fileHref(doc.id), (href) => router.push(href)),
        },
        {
          kind: "action",
          label: "Open in new window",
          icon: ExternalLink,
          onSelect: () => window.open(fileHref(doc.id), "_blank", "noopener"),
        },
        options.hasChildren && options.onToggleExpand && {
          kind: "action",
          label: options.expanded ? "Collapse subpages" : "Expand subpages",
          icon: options.expanded ? ChevronDown : ChevronRight,
          onSelect: () => options.onToggleExpand?.(),
        },
        { kind: "separator" },
        {
          kind: "action",
          label: "Add subpage",
          icon: Plus,
          onSelect: () => {
            void createDoc
              .mutateAsync({ parentId: doc.id })
              .then((child) => router.push(fileHref(child.id)))
              .catch(() => useToastStore.getState().show("Could not create subpage"));
          },
        },
        options.onRename && {
          kind: "action",
          label: "Rename",
          icon: Pencil,
          shortcut: "F2",
          onSelect: () => options.onRename?.(),
        },
        {
          kind: "action",
          label: doc.isFavorite ? "Remove from favorites" : "Add to favorites",
          icon: doc.isFavorite ? StarOff : Star,
          onSelect: () => {
            void updateDoc
              .mutateAsync({ id: doc.id, isFavorite: !doc.isFavorite })
              .then(() =>
                useToastStore
                  .getState()
                  .show(doc.isFavorite ? "Removed from favorites" : "Added to favorites"),
              );
          },
        },
        targets.length > 0 && {
          kind: "submenu",
          label: "Move to page",
          icon: FolderInput,
          items: targets.map((target) => ({
            kind: "action" as const,
            label: `${target.icon ? `${target.icon} ` : ""}${target.title || "Untitled"}`,
            onSelect: () => {
              void updateDoc
                .mutateAsync({ id: doc.id, parentId: target.id })
                .then(() => useToastStore.getState().show(`Moved under ${target.title || "Untitled"}`))
                .catch(() => useToastStore.getState().show("Could not move the doc"));
            },
          })),
        },
        doc.parentId && {
          kind: "action",
          label: "Move to top level",
          icon: FolderUp,
          onSelect: () => {
            void updateDoc
              .mutateAsync({ id: doc.id, parentId: "" })
              .then(() => useToastStore.getState().show("Moved to top level"));
          },
        },
        { kind: "separator" },
        {
          kind: "action",
          label: "Copy link",
          icon: Link2,
          shortcut: "mod+shift+C",
          onSelect: () =>
            copyText(new URL(fileHref(doc.id), window.location.origin).toString(), "Link copied"),
        },
        {
          kind: "action",
          label: archived ? "Restore from archive" : "Archive",
          icon: archived ? ArchiveRestore : Archive,
          onSelect: () => {
            void updateDoc
              .mutateAsync({ id: doc.id, archived: !archived })
              .then(() =>
                useToastStore.getState().show(archived ? "Restored" : "Archived"),
              );
          },
        },
        { kind: "separator" },
        {
          kind: "action",
          label: "Delete",
          icon: Trash2,
          danger: true,
          shortcut: "mod+Backspace",
          onSelect: () =>
            requestConfirm({
              title: `Delete “${title}”?`,
              description: "This cannot be undone.",
              onConfirm: async () => {
                await deleteDoc.mutateAsync(doc.id);
                options.onDeleted?.(doc.id);
                useToastStore.getState().show("Doc deleted");
              },
            }),
        },
      ]);
    },
    [allDocs, createDoc, deleteDoc, router, updateDoc],
  );
}
