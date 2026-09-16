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
  FolderUp,
  Link2,
  Pencil,
  Plus,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import type { Doc } from "@/app/_types/types";
import { useCreateDoc, useDeleteDoc, useUpdateDoc } from "@/app/utils/hooks/docs";
import { requestConfirm } from "@/app/_store/confirmStore";
import { useToastStore } from "@/app/_store/toastStore";
import { tidyEntries, type ContextMenuEntry } from "@/app/_store/contextMenuStore";

export type DocMenuOptions = {
  hasChildren?: boolean;
  expanded?: boolean;
  onRename?: () => void;
  onToggleExpand?: () => void;
  onDeleted?: (id: string) => void;
};

function copyText(text: string, message: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => useToastStore.getState().show(message))
    .catch(() => useToastStore.getState().show("Could not copy to clipboard"));
}

/** Right-click menu for a doc, shared by the docs list and Report. */
export function useDocContextMenu() {
  const router = useRouter();
  const createDoc = useCreateDoc();
  const deleteDoc = useDeleteDoc();
  const updateDoc = useUpdateDoc();

  return useCallback(
    (doc: Doc, options: DocMenuOptions = {}): ContextMenuEntry[] => {
      const archived = Boolean(doc.archivedAt);
      const title = doc.title || "Untitled";

      return tidyEntries([
        {
          kind: "action",
          label: "Open",
          icon: FileText,
          shortcut: "Enter",
          onSelect: () => router.push(`/docs/${doc.id}`),
        },
        {
          kind: "action",
          label: "Open in new window",
          icon: ExternalLink,
          onSelect: () => window.open(`/docs/${doc.id}`, "_blank", "noopener"),
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
              .then((child) => router.push(`/docs/${child.id}`))
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
        doc.parentId && {
          kind: "action",
          label: "Move to top level",
          icon: FolderUp,
          onSelect: () => {
            void updateDoc
              .mutateAsync({ id: doc.id, parentId: null })
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
            copyText(new URL(`/docs/${doc.id}`, window.location.origin).toString(), "Link copied"),
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
    [createDoc, deleteDoc, router, updateDoc],
  );
}
