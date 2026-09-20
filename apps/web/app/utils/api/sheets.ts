import { Sheet, SheetColumn, SheetMerge, SheetRow, SheetTab, SheetTemplate } from "@/app/_types/types";
import { apiFetch } from "./client";


export interface CreateSheetPayload {
  title?: string;
  icon?: string;
  columns?: SheetColumn[];
  rows?: SheetRow[];
  merges?: SheetMerge[];
  tabs?: SheetTab[];
  workspaceId?: string;
  projectId?: string | null;
  templateId?: string;
}

export interface UpdateSheetPayload {
  title?: string;
  icon?: string;
  columns?: SheetColumn[];
  rows?: SheetRow[];
  merges?: SheetMerge[];
  tabs?: SheetTab[];
  projectId?: string | null;
  isFavorite?: boolean;
  archived?: boolean;
}

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return body?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export async function getSheets(): Promise<Sheet[]> {
  const response = await apiFetch("/sheets", { credentials: "include" });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to fetch sheets"));
  }

  return response.json();
}

export async function getSheet(id: string): Promise<Sheet> {
  const response = await apiFetch(`/sheets/${id}`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to fetch sheet"));
  }

  return response.json();
}

export async function createSheet(
  data: CreateSheetPayload = {},
): Promise<Sheet> {
  const response = await apiFetch("/sheets", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to create sheet"));
  }

  const resData = await response.json();
  return resData.sheet ?? resData;
}

export async function updateSheet(
  id: string,
  data: UpdateSheetPayload,
): Promise<Sheet> {
  const response = await apiFetch(`/sheets/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update sheet"));
  }

  const resData = await response.json();
  return resData.sheet ?? resData;
}

export async function deleteSheet(id: string): Promise<void> {
  const response = await apiFetch(`/sheets/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to delete sheet"));
  }
}

export async function duplicateSheet(id: string): Promise<Sheet> {
  const response = await apiFetch(`/sheets/${id}/duplicate`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to duplicate sheet"));
  }

  const resData = await response.json();
  return resData.sheet ?? resData;
}

export async function getSheetTemplates(): Promise<SheetTemplate[]> {
  const response = await apiFetch("/sheet-templates", { credentials: "include" });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to fetch templates"));
  }
  const data = await response.json();
  return Array.isArray(data) ? data : data.templates ?? [];
}

export async function createSheetTemplate(data: {
  sheetId: string;
  name?: string;
  tabId?: string;
}): Promise<SheetTemplate> {
  const response = await apiFetch("/sheet-templates", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to save template"));
  }
  const resData = await response.json();
  return resData.template ?? resData;
}

export async function updateSheetTemplate(
  id: string,
  data: { name: string },
): Promise<SheetTemplate> {
  const response = await apiFetch(`/sheet-templates/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update template"));
  }
  const resData = await response.json();
  return resData.template ?? resData;
}

export async function deleteSheetTemplate(id: string): Promise<void> {
  const response = await apiFetch(`/sheet-templates/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to delete template"));
  }
}

export async function materializeTemplateTab(
  templateId: string,
  tabId?: string,
): Promise<SheetTab> {
  const response = await apiFetch(`/sheet-templates/${templateId}/tab`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tabId: tabId ?? "" }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to copy template tab"));
  }
  const resData = await response.json();
  return resData.tab ?? resData;
}
