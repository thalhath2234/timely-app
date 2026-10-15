import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as Clipboard from "expo-clipboard";
import { api, ApiError, getApiUrl, readError, tunnelHeaders } from "./client";
import { getToken } from "../auth/session";

export type BackupSettings = {
  enabled: boolean;
  intervalDays: number;
  retentionCount: number;
  nextRunAt?: string | null;
};

export type BackupFile = {
  id: string;
  byteSize: number;
  checksum: string;
  createdAt: string;
};

export function getBackupSettings() { return api<BackupSettings>("/backups/settings"); }
export function updateBackupSettings(data: BackupSettings) { return api<BackupSettings>("/backups/settings", { method: "PUT", body: data }); }
export async function listBackups() {
  const payload = await api<{ items: BackupFile[] }>("/backups");
  return payload.items;
}
export function createBackup() { return api<BackupFile>("/backups", { method: "POST" }); }
export function deleteBackup(id: string) { return api<void>(`/backups/${encodeURIComponent(id)}`, { method: "DELETE" }); }

/** The file name the server gave a download (filename* first), kept to
 * characters every file system takes. */
function serverFilename(response: Response) {
  const disposition = response.headers.get("content-disposition") ?? "";
  let name = disposition.match(/filename="([^"]+)"/)?.[1];
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { name = decodeURIComponent(encoded); } catch { /* keep the plain name */ }
  }
  return name?.replace(/[\\/:*?"<>|]+/g, " ").trim() || undefined;
}

async function authenticatedDownload(path: string, filename: string) {
  const baseUrl = await getApiUrl();
  const token = await getToken();
  const headers: Record<string, string> = { ...tunnelHeaders(baseUrl) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, { headers });
  if (!response.ok) throw new ApiError(await readError(response, "Download failed"), response.status);
  const target = new File(Paths.cache, serverFilename(response) ?? filename);
  if (target.exists) target.delete();
  target.write(new Uint8Array(await response.arrayBuffer()));
  return { file: target, mimeType: response.headers.get("content-type")?.split(";")[0].trim() };
}

/** Downloads an export and opens the share sheet. The server's file name
 * and type win over the ones given, since a doc with images comes back as
 * a .zip rather than a .md. */
export async function shareExport(path: string, filename: string, mimeType: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error("File sharing is not available on this device.");
  const { file, mimeType: served } = await authenticatedDownload(path, filename);
  await Sharing.shareAsync(file.uri, { mimeType: served || mimeType, dialogTitle: `Export ${file.name}` });
}

/** Whether a doc's content shows an image uploaded to Timely ("/files/<id>");
 * its Markdown export then holds the images too, as a .zip. */
export function hasUploadedImages(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasUploadedImages);
  if (!node || typeof node !== "object") return false;
  const { type, attrs, content } = node as { type?: unknown; attrs?: { src?: unknown }; content?: unknown };
  if (type === "image" && typeof attrs?.src === "string" && attrs.src.startsWith("/files/")) return true;
  return hasUploadedImages(content);
}

export async function shareLocalText(filename: string, contents: string, mimeType: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error("File sharing is not available on this device.");
  const target = new File(Paths.cache, filename);
  if (target.exists) target.delete();
  target.write(contents);
  await Sharing.shareAsync(target.uri, { mimeType, dialogTitle: `Export ${filename}` });
}

const IMAGE_EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** Shares a doc image ("/files/<id>" on the server, or a web address), so it
 * can be saved to Photos or Files from the share sheet. */
/** Downloads a doc image ("/files/<id>" or a full address) into the cache. */
async function downloadImage(src: string, name: string) {
  const base = (name || "image").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 100) || "image";
  const url = src.startsWith("/files/") ? `${await getApiUrl()}${src}` : src;
  const response = await fetch(url, { headers: src.startsWith("/files/") ? tunnelHeaders(await getApiUrl()) : {} });
  if (!response.ok) throw new Error("Could not download the image");
  const mimeType = (response.headers.get("content-type") ?? "image/png").split(";")[0].trim();
  const target = new File(Paths.cache, `${base}.${IMAGE_EXTENSIONS[mimeType] ?? "png"}`);
  if (target.exists) target.delete();
  target.write(new Uint8Array(await response.arrayBuffer()));
  return { file: target, base, mimeType };
}

export async function shareImage(src: string, name: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error("File sharing is not available on this device.");
  const { file, base, mimeType } = await downloadImage(src, name);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: `Save ${base}` });
}

/** Puts the picture itself on the clipboard, so other apps paste the image. */
export async function copyImage(src: string, name: string) {
  const { file } = await downloadImage(src, name);
  await Clipboard.setImageAsync(await file.base64());
  file.delete();
}

/** Lays an HTML page out as a PDF on the device and shares it. */
export async function sharePdfFromHtml(filename: string, html: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error("File sharing is not available on this device.");
  const printed = await Print.printToFileAsync({ html });
  const target = new File(Paths.cache, filename);
  if (target.exists) target.delete();
  await new File(printed.uri).move(target);
  await Sharing.shareAsync(target.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: `Export ${filename}` });
}

export async function restoreBackupJSON(contents: string) {
  let backup: unknown;
  try { backup = JSON.parse(contents); }
  catch { throw new Error("This is not a valid JSON backup."); }
  return api<{ restoredAt: string; counts: Record<string, number> }>("/restore?mode=replace", {
    method: "POST",
    headers: { "X-Timely-Restore": "replace" },
    body: backup,
  });
}
