import { Project } from "@/app/_types/types";

export async function getProjects(): Promise<Project[]> {
  const response = await fetch("http://localhost:8080/projects", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch projects");
  }

  return response.json();
}

export async function createProject(data: {
  title: string;
  workspaceId: string;
  description?: string;
  color: string;
}): Promise<Project> {
  const response = await fetch("http://localhost:8080/projects", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: data.title,
      workspaceId: data.workspaceId,
      description: data.description ?? "",
      color: data.color,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to create project");
  }

  return response.json();
}
