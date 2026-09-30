import type { Sheet } from "@/app/_types/types";
import type { ChatContext, ReceiptDestination } from "@/app/utils/api/chat";

export function receiptDestination(
  context: ChatContext[],
  sheets: Sheet[],
): ReceiptDestination {
  const workspaceId = context.find((c) => c.kind === "workspace")?.value || "";
  const projectId =
    context.find((c) => c.kind === "project")?.value ||
    context
      .find((c) => c.kind === "object" && c.value.startsWith("projects/"))
      ?.value.split("/")[1];
  const openSheetId = context
    .find((c) => c.kind === "object" && c.value.startsWith("sheets/"))
    ?.value.split("/")[1];
  const available = sheets.filter((s) => !s.archivedAt);
  const openSheet = available.find((s) => s.id === openSheetId);
  // Honor attached scope; standalone chat can use one unambiguous account match.
  const candidates = available.filter(
    (s) =>
      (projectId
        ? s.projectId === projectId
        : workspaceId
          ? s.workspaceId === workspaceId
          : true) && /\bexpenses?\b/i.test(s.title),
  );
  const selected =
    openSheet ||
    (!openSheetId && candidates.length === 1 ? candidates[0] : undefined);
  return {
    sheetId: selected?.id || "",
    workspaceId: selected?.workspaceId || workspaceId,
    title: "Expenses",
    expenseTabId: "",
    duplicateAction: "",
    duplicateRowId: "",
  };
}

export function receiptTabs(sheet: Sheet | undefined) {
  if (!sheet) return [];
  return (
    sheet.tabs?.length ? sheet.tabs : [{ id: "primary", name: "Expenses" }]
  ).filter((tab) => tab.name.trim().toLowerCase() !== "items");
}

export function receiptTabId(context: ChatContext[], sheet: Sheet | undefined) {
  const tabs = receiptTabs(sheet);
  const attached = context.find(
    (c) =>
      c.kind === "sheet-tab" && c.value.startsWith(`sheets/${sheet?.id}/tabs/`),
  );
  const activeId = attached?.value.split("/")[3];
  return (
    tabs.find((t) => t.id === activeId)?.id ||
    tabs.find((t) => /^expenses?$/i.test(t.name.trim()))?.id ||
    tabs[0]?.id ||
    ""
  );
}
