import { Config, Workspace } from "@/app/_types/types";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}



export async function getWorkspaces(): Promise<Workspace[]> {
  const response = await fetch("http://localhost:8080/workspaces", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch workspaces");
  }

  return response.json();
}

export async function getConfig(): Promise<Config> {
  const response = await fetch("http://localhost:8080/config", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch config");
  }

  return response.json();
}

export async function createWorkspace(data: {
  name: string;
}): Promise<Workspace> {
  const response = await fetch("http://localhost:8080/workspaces", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: data.name,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to create workspace");
  }

  return response.json();
}

export async function completeOnboarding(): Promise<Config> {
  const response = await fetch("http://localhost:8080/config", {
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
  isOnboardingCompleted?: boolean;
}): Promise<Config> {
  const response = await fetch("http://localhost:8080/config", {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      taskViews: data.taskViews,
      activeTaskViewId: data.activeTaskViewId,
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
