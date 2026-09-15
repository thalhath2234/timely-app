import { DocContent, Sheet, SheetColumn, SheetMerge, SheetRow, SheetTab } from "@/app/_types/types";
import { apiFetch } from "./client";


export interface CreateSheetPayload {
  title?: string;
  icon?: string;
  description?: string;
  descriptionRich?: DocContent;
  columns?: SheetColumn[];
  rows?: SheetRow[];
  merges?: SheetMerge[];
  tabs?: SheetTab[];
  workspaceId?: string;
  projectId?: string | null;
}

export interface UpdateSheetPayload {
  title?: string;
  icon?: string;
  description?: string;
  descriptionRich?: DocContent;
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
