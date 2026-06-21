// lib/api/tasks.ts
import { Task } from "@/app/_types/types";

export async function getTasks(): Promise<Task[]> {
  const response = await fetch("http://localhost:8080/tasks", {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch tasks");
  }

  return response.json();
}
