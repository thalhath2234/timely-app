import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { api, API_URL, ApiError, readError } from "./client";
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

async function authenticatedDownload(path: string, filename: string) {
  const token = await getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (API_URL.includes("ngrok")) headers["ngrok-skip-browser-warning"] = "true";
  const response = await fetch(`${API_URL}${path}`, { headers });
  if (!response.ok) throw new ApiError(await readError(response, "Download failed"), response.status);
  const target = new File(Paths.cache, filename);
  if (target.exists) target.delete();
  target.write(new Uint8Array(await response.arrayBuffer()));
  return target;
}

export async function shareExport(path: string, filename: string, mimeType: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error("File sharing is not available on this device.");
  const file = await authenticatedDownload(path, filename);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: `Export ${filename}` });
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
