"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { subpageIds, templateDeleteCopy } from "@timely/contract/templates";
import { useDeleteDoc, useDocs } from "@/app/utils/hooks/docs";
import { useDeleteSheetTemplate } from "@/app/utils/hooks/sheets";
import { requestConfirm } from "@/app/_store/confirmStore";
import { useToastStore } from "@/app/_store/toastStore";
import { FILES_PATH, fileIdFromPath } from "@/app/utils/fileRoutes";

const failed = (error: unknown) =>
  useToastStore.getState().show(error instanceof Error ? error.message : "Could not delete template");

/**
 * Deleting a user-made template from a picker or list, after a confirmation
 * that names it. A doc template is a doc, so the doc (and its subpages) goes;
 * a sheet template is only the template. Built-ins are never offered. When
 * the open page is the deleted one, Files' start page opens instead.
 */
export function useTemplateDelete() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: docs } = useDocs();
  const deleteDoc = useDeleteDoc();
  const deleteSheetTemplate = useDeleteSheetTemplate();

  const leaveIfOpen = useCallback(
    (ids: Set<string>) => {
      const openId = fileIdFromPath(pathname ?? "");
      if (openId && ids.has(openId)) router.push(FILES_PATH);
    },
    [pathname, router],
  );

  const confirmDocTemplate = useCallback(
    (template: { id: string; title: string }) => {
      const subpages = subpageIds(docs ?? [], template.id);
      const { title, message } = templateDeleteCopy("doc", template.title, subpages.length);
      requestConfirm({
        title,
        description: message,
        onConfirm: async () => {
          try {
            await deleteDoc.mutateAsync(template.id);
            // Its subpages go with it, so leave any of them too.
            leaveIfOpen(new Set([template.id, ...subpages]));
            useToastStore.getState().show("Template deleted");
          } catch (error) {
            failed(error);
          }
        },
      });
    },
    [deleteDoc, docs, leaveIfOpen],
  );

  const confirmSheetTemplate = useCallback(
    (template: { id: string; name: string }) => {
      const { title, message } = templateDeleteCopy("sheet", template.name);
      requestConfirm({
        title,
        description: message,
        onConfirm: async () => {
          try {
            await deleteSheetTemplate.mutateAsync(template.id);
            leaveIfOpen(new Set([template.id]));
            useToastStore.getState().show("Template deleted");
          } catch (error) {
            failed(error);
          }
        },
      });
    },
    [deleteSheetTemplate, leaveIfOpen],
  );

  return { confirmDocTemplate, confirmSheetTemplate };
}
