import type { AppNotification, JobHealth, JobRecord, NotificationSettings, SchedulePlan } from "../types";
import { api } from "./client";

export function listNotifications(unread = false) {
  const params = new URLSearchParams();
  if (unread) params.set("unread", "true");
  const suffix = params.toString() ? `?${params}` : "";
  return api<{ items?: AppNotification[] }>(`/notifications${suffix}`).then((body) => body.items ?? []);
}

export function unreadNotificationCount() {
  return api<{ count?: number }>("/notifications/unread-count").then((body) => body.count ?? 0);
}

export function markNotificationRead(id: string) {
  return api<AppNotification>(`/notifications/${id}/read`, { method: "POST" });
}

export function markAllNotificationsRead() {
  return api<{ ok: boolean }>("/notifications/read-all", { method: "POST" });
}

export function clearNotifications() {
  return api<{ ok: boolean }>("/notifications/clear", { method: "POST", body: {} });
}

export function snoozeNotification(id: string, payload: { minutes?: number; until?: string }) {
  return api<AppNotification>(`/notifications/${id}/snooze`, { method: "POST", body: payload });
}

export function prioritizeOverdueTask(taskId: string) {
  return api<SchedulePlan>(`/tasks/${taskId}/reschedule-urgent`, { method: "POST" });
}

export function getNotificationSettings() {
  return api<NotificationSettings>("/notifications/settings");
}

export function updateNotificationSettings(data: Partial<NotificationSettings>) {
  return api<NotificationSettings>("/notifications/settings", { method: "PUT", body: data });
}

export function registerPushDevice(token: string, platform: string) {
  return api("/devices/push", { method: "PUT", body: { token, platform } });
}

export function unregisterPushDevice(token: string) {
  return api("/devices/push", { method: "DELETE", body: { token } });
}

export function listFailedJobs() {
  return api<{ items?: JobRecord[] }>("/jobs?status=failed").then((body) => body.items ?? []);
}

export function getJobHealth() {
  return api<JobHealth>("/jobs/health");
}

export function retryJob(id: string) {
  return api<JobRecord>(`/jobs/${id}/retry`, { method: "POST" });
}
