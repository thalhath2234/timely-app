import type { CustomFieldValueInput, DocContent, Project } from "../types";
import { api, unwrap } from "./client";

export type CreateProjectPayload = {
  title: string;
  workspaceId: string;
  description?: string;
  descriptionRich?: DocContent;
  statusId?: string;
  deadline?: string;
  startDate?: string;
  priorityLevel?: string;
  color?: string;
};

export type UpdateProjectPayload = {
  title?: string;
  description?: string;
  descriptionRich?: DocContent;
  statusId?: string;
  deadline?: string;
  startDate?: string;
  completedAt?: string;
  priorityLevel?: string;
  color?: string;
  customFieldValues?: CustomFieldValueInput[];
};

export function getProjects() {
  return api<Project[]>("/projects");
}

export async function createProject(data: CreateProjectPayload) {
  const res = await api<Project | { project: Project }>("/projects", { method: "POST", body: data });
  return unwrap(res, "project");
}

export async function updateProject(id: string, data: UpdateProjectPayload) {
  const res = await api<Project | { project: Project }>(`/projects/${id}`, { method: "PUT", body: data });
  return unwrap(res, "project");
}
