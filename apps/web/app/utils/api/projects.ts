import {
  CustomFieldValueInput,
  DocContent,
  Project,
} from "@/app/_types/types";

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return typeof body?.message === "string" ? body.message : fallback;
  } catch {
    return fallback;
  }
}

export async function getProjects(): Promise<Project[]> {
  const response = await fetch("http://localhost:8080/projects", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch projects");
  }

  return response.json();
}

export type CreateProjectCustomFieldValuePayload = CustomFieldValueInput;

export interface CreateProjectPayload {
  title: string;
  workspaceId: string;
  description?: string;
  descriptionRich?: DocContent;
  statusId?: string;
  deadline?: string;
  startDate?: string;
  priorityLevel?: string;
  color?: string;
  doesHaveStages?: boolean;
  customFieldValues?: CreateProjectCustomFieldValuePayload[];
}

export async function createProject(
  data: CreateProjectPayload,
): Promise<Project> {
  const response = await fetch("http://localhost:8080/projects", {
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

/** Every field is optional so autosave can send just what changed. Passing an
 * empty string to a nullable field clears it. */
export interface UpdateProjectPayload {
  title?: string;
  description?: string;
  descriptionRich?: DocContent;
  statusId?: string;
  deadline?: string;
  startDate?: string;
  completedAt?: string;
  priorityLevel?: string;
  color?: string;
  doesHaveStages?: boolean;
}

export async function updateProject(
  id: string,
  data: UpdateProjectPayload,
): Promise<Project> {
  const response = await fetch(`http://localhost:8080/projects/${id}`, {
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
