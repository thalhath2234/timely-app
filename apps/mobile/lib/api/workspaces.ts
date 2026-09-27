import type { Config, CustomField, CustomFieldType, Label, Status, Workspace } from "../types";
import { api, unwrap } from "./client";

export function getWorkspaces() {
  return api<Workspace[]>("/workspaces");
}

export function getConfig() {
  return api<Config>("/config");
}

export function updateConfig(data: {
  appearance?: Config["appearance"];
  taskViews?: Config["taskViews"];
  activeTaskViewId?: string;
  isOnboardingCompleted?: boolean;
}) {
  return api<Config>("/config", { method: "PUT", body: data });
}

export function updateTaskViewsConfig(data: {
  taskViews: NonNullable<Config["taskViews"]>;
  activeTaskViewId: string;
}) {
  return updateConfig({
    taskViews: data.taskViews,
    activeTaskViewId: data.activeTaskViewId,
  });
}

export async function createWorkspace(data: { name: string }) {
  const res = await api<Workspace | { workspace: Workspace }>("/workspaces", { method: "POST", body: data });
  return unwrap(res, "workspace");
}

export function updateWorkspace(data: { id: string; name: string }) {
  return api<Workspace>(`/workspaces/${encodeURIComponent(data.id)}`, {
    method: "PUT",
    body: { name: data.name },
  });
}

export function deleteWorkspace(id: string) {
  return api<void>(`/workspaces/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export type NamedColorPayload = { name: string; color: string };

export function createStatus(workspaceId: string, data: NamedColorPayload) {
  return api<Status>(`/workspaces/${encodeURIComponent(workspaceId)}/status`, { method: "POST", body: data });
}

export function updateStatus(workspaceId: string, statusId: string, data: NamedColorPayload) {
  return api<Status>(
    `/workspaces/${encodeURIComponent(workspaceId)}/status/${encodeURIComponent(statusId)}`,
    { method: "PUT", body: data },
  );
}

export function deleteStatus(workspaceId: string, statusId: string) {
  return api<void>(`/workspaces/${encodeURIComponent(workspaceId)}/status/${encodeURIComponent(statusId)}`, {
    method: "DELETE",
  });
}

export function createLabel(workspaceId: string, data: NamedColorPayload) {
  return api<Label>(`/workspaces/${encodeURIComponent(workspaceId)}/lable`, { method: "POST", body: data });
}

export function updateLabel(workspaceId: string, labelId: string, data: NamedColorPayload) {
  return api<Label>(
    `/workspaces/${encodeURIComponent(workspaceId)}/lable/${encodeURIComponent(labelId)}`,
    { method: "PUT", body: data },
  );
}

export function deleteLabel(workspaceId: string, labelId: string) {
  return api<void>(`/workspaces/${encodeURIComponent(workspaceId)}/lable/${encodeURIComponent(labelId)}`, {
    method: "DELETE",
  });
}

export type CustomFieldPayload = {
  name: string;
  type: CustomFieldType;
  options?: { id?: string; value: string; color?: string }[];
};

export function createCustomField(workspaceId: string, data: CustomFieldPayload) {
  return api<CustomField>(`/workspaces/${encodeURIComponent(workspaceId)}/custom-field`, {
    method: "POST",
    body: data,
  });
}

export function updateCustomField(workspaceId: string, customFieldId: string, data: CustomFieldPayload) {
  return api<CustomField>(
    `/workspaces/${encodeURIComponent(workspaceId)}/custom-field/${encodeURIComponent(customFieldId)}`,
    { method: "PUT", body: data },
  );
}

export function deleteCustomField(workspaceId: string, customFieldId: string) {
  return api<void>(
    `/workspaces/${encodeURIComponent(workspaceId)}/custom-field/${encodeURIComponent(customFieldId)}`,
    { method: "DELETE" },
  );
}
