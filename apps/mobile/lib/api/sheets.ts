import { normalizeSheet } from "../sheet";
import type { DocContent, Sheet, SheetColumn, SheetRow } from "../types";
import { api, unwrap } from "./client";

export type CreateSheetPayload = {
  title?: string;
  icon?: string;
  description?: string;
  descriptionRich?: DocContent;
  columns?: SheetColumn[];
  rows?: SheetRow[];
  workspaceId?: string;
  projectId?: string | null;
};

export type UpdateSheetPayload = {
  title?: string;
  icon?: string;
  description?: string;
  descriptionRich?: DocContent;
  columns?: SheetColumn[];
  rows?: SheetRow[];
  projectId?: string | null;
  isFavorite?: boolean;
  archived?: boolean;
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
