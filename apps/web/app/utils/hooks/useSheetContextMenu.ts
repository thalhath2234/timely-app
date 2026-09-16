"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  Copy,
  ExternalLink,
  Link2,
  Pencil,
  Sheet as SheetIcon,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import type { Sheet } from "@/app/_types/types";
import { useDeleteSheet, useDuplicateSheet, useUpdateSheet } from "@/app/utils/hooks/sheets";
import { requestConfirm } from "@/app/_store/confirmStore";
import { useToastStore } from "@/app/_store/toastStore";
import { tidyEntries, type ContextMenuEntry } from "@/app/_store/contextMenuStore";

export type SheetMenuOptions = {
  onRename?: () => void;
  onDeleted?: (id: string) => void;
};

function copyText(text: string, message: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => useToastStore.getState().show(message))
    .catch(() => useToastStore.getState().show("Could not copy to clipboard"));
}

/** Right-click menu for a sheet, shared by the sheets list and Report. */
export function useSheetContextMenu() {
  const router = useRouter();
  const deleteSheet = useDeleteSheet();
  const updateSheet = useUpdateSheet();
  const duplicateSheet = useDuplicateSheet();

  return useCallback(
    (sheet: Sheet, options: SheetMenuOptions = {}): ContextMenuEntry[] => {
      const archived = Boolean(sheet.archivedAt);
      const title = sheet.title || "Untitled";

      return tidyEntries([
        {
          kind: "action",
          label: "Open",
          icon: SheetIcon,
          shortcut: "Enter",
          onSelect: () => router.push(`/sheets/${sheet.id}`),
        },
        {
          kind: "action",
          label: "Open in new window",
          icon: ExternalLink,
          onSelect: () => window.open(`/sheets/${sheet.id}`, "_blank", "noopener"),
        },
        { kind: "separator" },
        options.onRename && {
          kind: "action",
          label: "Rename",
          icon: Pencil,
          shortcut: "F2",
          onSelect: () => options.onRename?.(),
        },
        {
          kind: "action",
          label: "Duplicate",
          icon: Copy,
          shortcut: "mod+D",
          onSelect: () => {
            void duplicateSheet
              .mutateAsync(sheet.id)
              .then((copy) => {
                useToastStore.getState().show(`Duplicated “${copy.title}”`);
                router.push(`/sheets/${copy.id}`);
              })
              .catch(() => useToastStore.getState().show("Could not duplicate sheet"));
          },
        },
        {
          kind: "action",
          label: sheet.isFavorite ? "Remove from favorites" : "Add to favorites",
          icon: sheet.isFavorite ? StarOff : Star,
          onSelect: () => {
            void updateSheet
              .mutateAsync({ id: sheet.id, isFavorite: !sheet.isFavorite })
              .then(() =>
                useToastStore
                  .getState()
                  .show(sheet.isFavorite ? "Removed from favorites" : "Added to favorites"),
              );
          },
        },
        { kind: "separator" },
        {
          kind: "action",
          label: "Copy link",
          icon: Link2,
          shortcut: "mod+shift+C",
          onSelect: () =>
            copyText(
              new URL(`/sheets/${sheet.id}`, window.location.origin).toString(),
              "Link copied",
            ),
        },
        {
          kind: "action",
          label: archived ? "Restore from archive" : "Archive",
          icon: archived ? ArchiveRestore : Archive,
          onSelect: () => {
            void updateSheet
              .mutateAsync({ id: sheet.id, archived: !archived })
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
                await deleteSheet.mutateAsync(sheet.id);
                options.onDeleted?.(sheet.id);
                useToastStore.getState().show("Sheet deleted");
              },
            }),
        },
      ]);
    },
    [deleteSheet, duplicateSheet, router, updateSheet],
  );
}
