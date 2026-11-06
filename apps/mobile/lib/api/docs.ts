import { File as ExpoFile } from "expo-file-system";
import type { Doc, DocContent } from "../types";
import type { CreateDocPayload, DailyDocPayload, DocBacklink, DocVersion, UpdateDocPayload as WireUpdateDocPayload } from "@timely/contract/documents";
import type { LinkPreview } from "@timely/contract/embeds";
import type { ChecklistTickRequest } from "@timely/contract/docChecklist";
import { isRichContentEmpty } from "../richText";
import { api, unwrap } from "./client";
import { watchStream, type WatchEvent } from "./watch";
import { clearNulls, type Clearable } from "./clearable";

export type { CreateDocPayload, DocBacklink, DocVersion };

const CLEARABLE_DOC_FIELDS = ["parentId", "projectId"] as const;

/** `UpdateDocPayload` from the contract, plus `null` meaning "clear" on `parentId` and `projectId`. */
export type UpdateDocPayload = Clearable<WireUpdateDocPayload, (typeof CLEARABLE_DOC_FIELDS)[number]>;

export type DocWatchEvent = WatchEvent<Doc>;

export function getDocs() {
  return api<Doc[]>("/docs");
}

export function getDoc(id: string) {
  return api<Doc>(`/docs/${id}`);
}

export async function createDoc(data: CreateDocPayload = {}) {
  const res = await api<Doc | { document: Doc }>("/docs", { method: "POST", body: data });
  return unwrap(res, "document");
}

export async function updateDoc(id: string, data: UpdateDocPayload) {
  const res = await api<Doc | { document: Doc }>(`/docs/${id}`, {
    method: "PUT",
    body: clearNulls<WireUpdateDocPayload>(data, CLEARABLE_DOC_FIELDS),
  });
  const saved = unwrap(res, "document");
  if (data.content && !isRichContentEmpty(data.content) && isRichContentEmpty(saved.content)) {
    throw new Error("Document body was not persisted");
  }
  return saved;
}

/** Ticks or unticks one checklist item in the doc as the server holds it (a card's CheckRow). */
export async function setChecklistItem(id: string, tick: ChecklistTickRequest) {
  const res = await api<Doc | { document: Doc }>(`/docs/${id}/checklist`, { method: "PUT", body: tick });
  return unwrap(res, "document");
}

/** SSE stream with cookie-less Bearer auth. Falls back to polling if the body is not readable. */
export function watchDoc(id: string, onEvent: (event: DocWatchEvent) => void) {
  return watchStream<Doc>(`/docs/${id}/watch`, "doc", id, () => getDoc(id), onEvent);
}

export function deleteDoc(id: string) {
  return api<void>(`/docs/${id}`, { method: "DELETE" });
}

export type DocFile = { id: string; url: string; name: string; mime: string; width: number; height: number };

/** Uploads an image for a doc; `url` ("/files/<id>") is what the doc stores. */
export function uploadDocFile(uri: string) {
  const form = new FormData();
  // SDK 57 fetch consumes Blob-compatible Expo files.
  form.append("file", new ExpoFile(uri));
  return api<DocFile>("/docs/files", { method: "POST", body: form, queueIfOffline: false });
}

export function getDocBacklinks(id: string) {
  return api<DocBacklink[]>(`/docs/${id}/backlinks`);
}

export function getDocVersions(id: string) {
  return api<DocVersion[]>(`/docs/${id}/versions`);
}

export function getDocVersion(id: string, versionId: string) {
  return api<DocVersion>(`/docs/${id}/versions/${versionId}`);
}

export async function restoreDocVersion(id: string, versionId: string) {
  const res = await api<{ document: Doc }>(`/docs/${id}/versions/${versionId}/restore`, { method: "POST", queueIfOffline: false });
  return res.document;
}

/** Opens the daily note for `date`, creating it from the payload's content when there is none yet. */
export function openDailyDoc(data: DailyDocPayload) {
  return api<{ document: Doc; created: boolean }>("/docs/daily", { method: "POST", body: data, queueIfOffline: false });
}

/** Title and description of a web page, for a bookmark. */
export function getLinkPreview(url: string) {
  return api<LinkPreview>(`/docs/link-preview?url=${encodeURIComponent(url)}`, { queueIfOffline: false });
}
