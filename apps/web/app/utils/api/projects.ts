import type {
  Project,
  ProjectActivityEntry,
  Stage,
} from "@/app/_types/types";
import type {
  CreateProjectPayload,
  UpdateProjectPayload,
} from "@timely/contract/entities";
import { apiFetch } from "./client";

export type {
  CreateProjectPayload,
  UpdateProjectPayload,
};

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return typeof body?.message === "string" ? body.message : fallback;
  } catch {
    return fallback;
  }
}

export async function getProjects(): Promise<Project[]> {
  const response = await apiFetch("/projects", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch projects");
  }

  return response.json();
}

export type { ProjectActivityEntry };

/** Newest-first task changes inside the project plus the project's creation. */
export async function getProjectActivity(id: string): Promise<ProjectActivityEntry[]> {
  const response = await apiFetch(`/projects/${id}/activity`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to load project activity"));
  }
  return response.json();
}

export async function getProject(id: string): Promise<Project> {
  const response = await apiFetch(`/projects/${id}`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to fetch project"));
  }

  const resData = await response.json();
  return resData.project ?? resData;
}

export async function createProject(
  data: CreateProjectPayload,
): Promise<Project> {
  const response = await apiFetch("/projects", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error("Failed to create project");
  }

  const resData = await response.json();
  return resData.project ?? resData;
}

export async function updateProject(
  id: string,
  data: UpdateProjectPayload,
): Promise<Project> {
  const response = await apiFetch(`/projects/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update project"));
  }

  const resData = await response.json();
  return resData.project ?? resData;
}

export async function deleteProject(id: string): Promise<void> {
  const response = await apiFetch(`/projects/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to delete project"));
  }
}

export async function createStage(
  projectId: string,
  data: { name: string; color?: string },
): Promise<Stage> {
  const response = await apiFetch(`/projects/${projectId}/stages`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to create stage"));
  }
  return response.json();
}

export async function updateStage(
  projectId: string,
  stageId: string,
  data: { name?: string; color?: string },
): Promise<Stage> {
  const response = await apiFetch(`/projects/${projectId}/stages/${stageId}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update stage"));
  }
  return response.json();
}

export async function deleteStage(projectId: string, stageId: string): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/stages/${stageId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to delete stage"));
  }
}

export async function reorderStages(projectId: string, ids: string[]): Promise<Stage[]> {
  const response = await apiFetch(`/projects/${projectId}/stages/reorder`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to reorder stages"));
  }
  return response.json();
}

export async function duplicateProject(id: string): Promise<Project> {
  const response = await apiFetch(`/projects/${id}/duplicate`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to duplicate project"));
  }
  const data = await response.json();
  return data.project ?? data;
}
