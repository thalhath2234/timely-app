import { apiFetch } from "./client";

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

async function jsonOrThrow<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message || fallback);
  }
  return response.json() as Promise<T>;
}

export async function downloadPortable(path: string, fallbackName: string) {
  const response = await apiFetch(path);
  if (!response.ok) throw new Error("Could not download the export.");
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function getBackupSettings() {
  return jsonOrThrow<BackupSettings>(await apiFetch("/backups/settings"), "Could not load backup settings.");
}

export async function updateBackupSettings(settings: BackupSettings) {
  return jsonOrThrow<BackupSettings>(await apiFetch("/backups/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  }), "Could not save backup settings.");
}

export async function listBackups() {
  const payload = await jsonOrThrow<{ items: BackupFile[] }>(await apiFetch("/backups"), "Could not load backups.");
  return payload.items;
}

export async function createBackup() {
  return jsonOrThrow<BackupFile>(await apiFetch("/backups", { method: "POST" }), "Could not create a backup.");
}

export async function deleteBackup(id: string) {
  const response = await apiFetch(`/backups/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Could not delete the backup.");
}

export async function restoreBackup(file: File) {
  const response = await apiFetch("/restore?mode=replace", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Timely-Restore": "replace",
    },
    body: file,
  });
  return jsonOrThrow<{ restoredAt: string; counts: Record<string, number> }>(response, "Could not restore the backup.");
}
