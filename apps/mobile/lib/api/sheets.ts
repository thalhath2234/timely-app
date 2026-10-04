import type { Sheet, SheetColumn, SheetMerge, SheetRow, SheetTab, SheetTemplate } from "../types";
import { normalizeSheet } from "../sheet";
import { api, unwrap } from "./client";

export type CreateSheetPayload = {
  title?: string;
  icon?: string;
  columns?: SheetColumn[];
  rows?: SheetRow[];
  merges?: SheetMerge[];
  tabs?: SheetTab[];
  workspaceId?: string;
  projectId?: string | null;
  templateId?: string;
};

export type UpdateSheetPayload = {
  title?: string;
  icon?: string;
  columns?: SheetColumn[];
  rows?: SheetRow[];
  merges?: SheetMerge[];
  tabs?: SheetTab[];
  projectId?: string | null;
  isFavorite?: boolean;
  archived?: boolean;
};

/** Any subset; omitted fields are left untouched. Tabs mirror the first tab like sheets. */
export type UpdateSheetTemplatePayload = {
  name?: string;
  icon?: string;
  columns?: SheetColumn[];
  rows?: SheetRow[];
  merges?: SheetMerge[];
  tabs?: SheetTab[];
};

export async function getSheets() {
  const res = await api<Sheet[] | { sheets: Sheet[] }>("/sheets");
  const list = unwrap(res, "sheets");
  return (Array.isArray(list) ? list : []).map(normalizeSheet);
}

export async function getSheet(id: string) {
  const res = await api<Sheet | { sheet: Sheet }>(`/sheets/${id}`);
  return normalizeSheet(unwrap(res, "sheet"));
}

export async function createSheet(data: CreateSheetPayload = {}) {
  const res = await api<Sheet | { sheet: Sheet }>("/sheets", { method: "POST", body: data });
  return normalizeSheet(unwrap(res, "sheet"));
}

export async function updateSheet(id: string, data: UpdateSheetPayload) {
  const res = await api<Sheet | { sheet: Sheet }>(`/sheets/${id}`, { method: "PUT", body: data });
  return normalizeSheet(unwrap(res, "sheet"));
}

export function deleteSheet(id: string) {
  return api<void>(`/sheets/${id}`, { method: "DELETE" });
}

export async function duplicateSheet(id: string) {
  const res = await api<Sheet | { sheet: Sheet }>(`/sheets/${id}/duplicate`, { method: "POST" });
  return normalizeSheet(unwrap(res, "sheet"));
}

export async function getSheetTemplates() {
  const res = await api<SheetTemplate[] | { templates: SheetTemplate[] }>("/sheet-templates");
  const list = Array.isArray(res) ? res : unwrap(res, "templates");
  return Array.isArray(list) ? list : [];
}

export async function createSheetTemplate(data: { sheetId: string; name?: string; tabId?: string }) {
  const res = await api<SheetTemplate | { template: SheetTemplate }>("/sheet-templates", {
    method: "POST",
    body: data,
  });
  return unwrap(res, "template");
}

export async function updateSheetTemplate(id: string, data: UpdateSheetTemplatePayload) {
  const res = await api<SheetTemplate | { template: SheetTemplate }>(`/sheet-templates/${id}`, {
    method: "PUT",
    body: data,
  });
  return unwrap(res, "template");
}

export async function deleteSheetTemplate(id: string) {
  return api<void>(`/sheet-templates/${id}`, { method: "DELETE" });
}

export async function materializeTemplateTab(templateId: string, tabId?: string) {
  const res = await api<SheetTab | { tab: SheetTab }>(`/sheet-templates/${templateId}/tab`, {
    method: "POST",
    body: { tabId: tabId ?? "" },
  });
  return unwrap(res, "tab");
}
