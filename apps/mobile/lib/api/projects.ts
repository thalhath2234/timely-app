import type { Project, ProjectActivityEntry, Stage } from "../types";
import type { CreateProjectPayload, UpdateProjectPayload } from "@timely/contract/entities";
import { api, unwrap } from "./client";

export type {
  CreateProjectPayload,
  UpdateProjectPayload,
};

export function getProjects() {
  return api<Project[]>("/projects");
}

export function getProject(id: string) {
  return api<Project>(`/projects/${id}`);
}

export async function createProject(data: CreateProjectPayload) {
  const res = await api<Project | { project: Project }>("/projects", { method: "POST", body: data });
  return unwrap(res, "project");
}

export async function updateProject(id: string, data: UpdateProjectPayload) {
  const res = await api<Project | { project: Project }>(`/projects/${id}`, { method: "PUT", body: data });
  return unwrap(res, "project");
}

export function deleteProject(id: string) {
  return api<void>(`/projects/${id}`, { method: "DELETE" });
}

export function createStage(projectId: string, name: string) {
  return api<Stage>(`/projects/${projectId}/stages`, { method: "POST", body: { name } });
}

export function updateStage(projectId: string, stageId: string, name: string) {
  return api<Stage>(`/projects/${projectId}/stages/${stageId}`, { method: "PUT", body: { name } });
}

export function deleteStage(projectId: string, stageId: string) {
  return api<void>(`/projects/${projectId}/stages/${stageId}`, { method: "DELETE" });
}

export function reorderStages(projectId: string, ids: string[]) {
  return api<Stage[]>(`/projects/${projectId}/stages/reorder`, { method: "PUT", body: { ids } });
}

export async function duplicateProject(id: string) {
  const res = await api<Project | { project: Project }>(`/projects/${id}/duplicate`, { method: "POST" });
  return unwrap(res, "project");
}

export function getProjectActivity(id: string) {
  return api<ProjectActivityEntry[]>(`/projects/${encodeURIComponent(id)}/activity`);
}
