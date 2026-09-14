import {
  Config,
  CustomField,
  CustomFieldType,
  Label,
  Status,
  Workspace,
} from "@/app/_types/types";
import { apiFetch } from "./client";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}



export async function getWorkspaces(): Promise<Workspace[]> {
  const response = await apiFetch("/workspaces", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch workspaces");
  }

  return response.json();
}

export async function getConfig(): Promise<Config> {
  const response = await apiFetch("/config", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch config");
  }

  return response.json();
}

/** Creates a workspace with its initial name and optional color. */
export async function createWorkspace(data: {
  name: string;
  color?: string;
}): Promise<Workspace> {
  const response = await apiFetch("/workspaces", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: data.name,
      color: data.color,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to create workspace");
  }

  const payload = await response.json();
  return payload.workspace ?? payload;
}

/** Persists editable workspace identity fields. */
export async function updateWorkspace(data: {
  id: string;
  name: string;
  color?: string;
}): Promise<Workspace> {
  const response = await apiFetch(
    `/workspaces/${encodeURIComponent(data.id)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: data.name, color: data.color }),
    },
  );

  if (!response.ok) {
    throw new Error("Failed to update workspace");
  }

  return response.json();
}

async function readError(response: Response, fallback: string) {
  try {
    const text = await response.text();
    if (!text) return fallback;
    try {
      const json = JSON.parse(text) as { message?: string };
      return json.message || text || fallback;
    } catch {
      return text || fallback;
    }
  } catch {
    return fallback;
  }
}

export type NamedColorPayload = {
  name: string;
  color: string;
};

export type CustomFieldOptionInput = {
  value: string;
  color?: string;
};

export type CustomFieldPayload = {
  name: string;
  type: CustomFieldType;
  options?: CustomFieldOptionInput[];
};

export async function createStatus(
  workspaceId: string,
  data: NamedColorPayload,
): Promise<Status> {
  const response = await apiFetch(
    `/workspaces/${encodeURIComponent(workspaceId)}/status`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to create status"));
  }
  return response.json();
}

export async function updateStatus(
  workspaceId: string,
  statusId: string,
  data: NamedColorPayload,
): Promise<Status> {
  const response = await apiFetch(
    `/workspaces/${encodeURIComponent(workspaceId)}/status/${encodeURIComponent(statusId)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update status"));
  }
  return response.json();
}

export async function deleteStatus(
  workspaceId: string,
  statusId: string,
): Promise<void> {
  const response = await apiFetch(
    `/workspaces/${encodeURIComponent(workspaceId)}/status/${encodeURIComponent(statusId)}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to delete status"));
  }
}

export async function createLabel(
  workspaceId: string,
  data: NamedColorPayload,
): Promise<Label> {
  const response = await apiFetch(
    `/workspaces/${encodeURIComponent(workspaceId)}/lable`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to create label"));
  }
  return response.json();
}

export async function updateLabel(
  workspaceId: string,
  labelId: string,
  data: NamedColorPayload,
): Promise<Label> {
  const response = await apiFetch(
    `/workspaces/${encodeURIComponent(workspaceId)}/lable/${encodeURIComponent(labelId)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update label"));
  }
  return response.json();
}

export async function deleteLabel(
  workspaceId: string,
  labelId: string,
): Promise<void> {
  const response = await apiFetch(
    `/workspaces/${encodeURIComponent(workspaceId)}/lable/${encodeURIComponent(labelId)}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to delete label"));
  }
}

export async function createCustomField(
  workspaceId: string,
  data: CustomFieldPayload,
): Promise<CustomField> {
  const response = await apiFetch(
    `/workspaces/${encodeURIComponent(workspaceId)}/custom-field`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to create custom field"));
  }
  return response.json();
}

export async function updateCustomField(
  workspaceId: string,
  customFieldId: string,
  data: CustomFieldPayload,
): Promise<CustomField> {
  const response = await apiFetch(
    `/workspaces/${encodeURIComponent(workspaceId)}/custom-field/${encodeURIComponent(customFieldId)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update custom field"));
  }
  return response.json();
}

export async function deleteCustomField(
  workspaceId: string,
  customFieldId: string,
): Promise<void> {
  const response = await apiFetch(
    `/workspaces/${encodeURIComponent(workspaceId)}/custom-field/${encodeURIComponent(customFieldId)}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to delete custom field"));
  }
}

export async function completeOnboarding(): Promise<Config> {
  const response = await apiFetch("/config", {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      isOnboardingCompleted: true,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to complete onboarding");
  }

  return response.json();
}

export async function updateTaskViewsConfig(data: {
  taskViews: Config["taskViews"];
  activeTaskViewId: string;
  projectTaskViews?: Config["projectTaskViews"];
  isOnboardingCompleted?: boolean;
}): Promise<Config> {
  const response = await apiFetch("/config", {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      taskViews: data.taskViews,
      activeTaskViewId: data.activeTaskViewId,
      ...(data.projectTaskViews ? { projectTaskViews: data.projectTaskViews } : {}),
      isOnboardingCompleted: true,
    }),
  });

  if (!response.ok) {
    const message =
      response.status === 409
        ? "Config conflict: please reload and retry"
        : "Failed to update task view config";
    throw new ApiError(message, response.status);
  }

  return response.json();
}
