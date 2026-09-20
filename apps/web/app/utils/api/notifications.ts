import type {
  AppNotification,
  JobHealth,
  JobRecord,
  NotificationSettings,
} from "@/app/_types/types";
import { apiFetch } from "./client";

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return typeof body?.message === "string" ? body.message : fallback;
  } catch {
    return fallback;
  }
}

export async function listNotifications(unread = false): Promise<AppNotification[]> {
  const params = new URLSearchParams();
  if (unread) params.set("unread", "true");
  const suffix = params.toString() ? `?${params}` : "";
  const response = await apiFetch(`/notifications${suffix}`, { credentials: "include" });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to load notifications"));
  }
  const body = (await response.json()) as { items?: AppNotification[] };
  return body.items ?? [];
}

export async function unreadNotificationCount(): Promise<number> {
  const response = await apiFetch("/notifications/unread-count", { credentials: "include" });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to load unread count"));
  }
  const body = (await response.json()) as { count?: number };
  return body.count ?? 0;
}

export async function markNotificationRead(id: string): Promise<AppNotification> {
  const response = await apiFetch(`/notifications/${id}/read`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to mark notification read"));
  }
  return response.json();
}

export async function markAllNotificationsRead(): Promise<void> {
  const response = await apiFetch("/notifications/read-all", {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to mark notifications read"));
  }
}

export async function clearNotifications(): Promise<void> {
  const response = await apiFetch("/notifications/clear", {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to clear notifications"));
  }
}

export async function snoozeNotification(
  id: string,
  payload: { minutes?: number; until?: string },
): Promise<AppNotification> {
  const response = await apiFetch(`/notifications/${id}/snooze`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to snooze reminder"));
  }
  return response.json();
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const response = await apiFetch("/notifications/settings", { credentials: "include" });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to load notification settings"));
  }
  return response.json();
}

export async function updateNotificationSettings(
  data: Partial<NotificationSettings>,
): Promise<NotificationSettings> {
  const response = await apiFetch("/notifications/settings", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to save notification settings"));
  }
  return response.json();
}

export async function listJobs(status?: string): Promise<JobRecord[]> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const suffix = params.toString() ? `?${params}` : "";
  const response = await apiFetch(`/jobs${suffix}`, { credentials: "include" });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to load jobs"));
  }
  const body = (await response.json()) as { items?: JobRecord[] };
  return body.items ?? [];
}

export async function getJobHealth(): Promise<JobHealth> {
  const response = await apiFetch("/jobs/health", { credentials: "include" });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to load job health"));
  }
  return response.json();
}

export async function retryJob(id: string): Promise<JobRecord> {
  const response = await apiFetch(`/jobs/${id}/retry`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to retry job"));
  }
  return response.json();
}
