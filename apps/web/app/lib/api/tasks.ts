// lib/api/tasks.ts

export interface Status {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  tasks: null;
}

export interface Priority {
  id: string;
  name: string;
  level: number;
  createdAt: string;
  updatedAt: string;
  tasks: null;
}

export interface Project{
    id: string;
    name: string;
    description: string;
    workspaceid: string;
}

export interface Workspace{
    id: string;
    name: string;
    description: string;
} 

export interface Task {
  id: string;
  name: string;
  description: string;
  timeChunks: number;
  duration: number;

  deadline: string | null;
  startDate: string | null;
  scheduledOn: string | null;
  completedAt: string | null;

  createdAt: string;
  updatedAt: string;

  userId: string;
  projectid: string | null;
  statusid: string;
  priorityid: string;
  workspaceid: string | null;
  scheduleid: string | null;
  stageid: string | null;
  blockedByid: string | null;

  user: null;
  project: Project;
  workspace: Workspace;
  schedule: null;
  stage: null;
  blockedBy: Task;

  status: Status;
  priority: Priority;

  labels: unknown[];
}

export async function getTasks(): Promise<Task[]> {
  const response = await fetch("http://localhost:8080/tasks", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch tasks");
  }

  return response.json();
}
