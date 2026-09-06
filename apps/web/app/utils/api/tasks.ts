import {
  CustomFieldValueInput,
  DocContent,
  RecurrenceInput,
  Task,
  TaskActivity,
} from "@/app/_types/types";

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    return typeof body?.message === "string" ? body.message : fallback;
  } catch {
    return fallback;
  }
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

export type CreateTaskCustomFieldValuePayload = CustomFieldValueInput;

export interface CreateTaskPayload {
  name: string;
  description?: string;
  descriptionRich?: DocContent;
  duration?: number;
  deadline?: string;
  startDate?: string;
  scheduledOn?: string;
  workspaceId: string;
  projectId?: string;
  statusId?: string;
  priorityLevel?: string;
  scheduleId?: string;
  stageId?: string;
  blockedById?: string;
  labelIds?: { id: string }[];
  customFieldValues?: CreateTaskCustomFieldValuePayload[];
  /** Makes the task a repeating series. Omit for a one-off task. */
  recurrence?: RecurrenceInput;
}

export async function createTask(data: CreateTaskPayload): Promise<Task> {
  const response = await fetch("http://localhost:8080/tasks", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error("Failed to create task");
  }

  const resData = await response.json();
  return resData.task ?? resData;
}

/** Every field is optional so autosave can send just what changed. Passing an
 * empty string to a nullable field clears it. */
export interface UpdateTaskPayload {
  name?: string;
  description?: string;
  descriptionRich?: DocContent;
  duration?: number;
  deadline?: string;
  startDate?: string;
  scheduledOn?: string;
  completedAt?: string;
  projectId?: string;
  statusId?: string;
  priorityLevel?: string;
  stageId?: string;
  blockedById?: string;
  /** Replaces the full label set. Pass `[]` to clear. */
  labelIds?: { id: string }[];
  /** Replaces the values of the fields listed. Blank values clear a field. */
  customFieldValues?: CustomFieldValueInput[];
  /** Replaces the recurrence rule; `null` turns the series back into a one-off. */
  recurrence?: RecurrenceInput | null;
}

export type TaskOccurrenceAction =
  | "complete"
  | "uncomplete"
  | "skip"
  | "restore"
  | "move";

export interface TaskOccurrencePayload {
  originalStart: string;
  action: TaskOccurrenceAction;
  newStart?: string;
  newEnd?: string;
}

/** Edits one instance of a recurring task without touching the series. */
export async function editTaskOccurrence(
  taskId: string,
  data: TaskOccurrencePayload,
): Promise<Task> {
  const response = await fetch(
    `http://localhost:8080/tasks/${taskId}/occurrences`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update occurrence"));
  }

  const resData = await response.json();
  return resData.task ?? resData;
}

export interface SplitTaskSeriesPayload {
  /** Original start of the first occurrence that moves to the new series. */
  fromStart: string;
  recurrence: Partial<RecurrenceInput>;
  name?: string;
  duration?: number;
}

/** "This and future": closes the series before `fromStart` and returns the new task. */
export async function splitTaskSeries(
  taskId: string,
  data: SplitTaskSeriesPayload,
): Promise<Task> {
  const response = await fetch(
    `http://localhost:8080/tasks/${taskId}/recurrence/split`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to split series"));
  }

  const resData = await response.json();
  return resData.task ?? resData;
}

export async function updateTask(
  id: string,
  data: UpdateTaskPayload,
): Promise<Task> {
  const response = await fetch(`http://localhost:8080/tasks/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to update task"));
  }

  const resData = await response.json();
  return resData.task ?? resData;
}

export async function deleteTask(id: string): Promise<void> {
  const response = await fetch(`http://localhost:8080/tasks/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Failed to delete task"));
  }
}

export async function getTaskActivity(taskId: string): Promise<TaskActivity[]> {
  const response = await fetch(
    `http://localhost:8080/tasks/${taskId}/activity`,
    { credentials: "include" },
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to load activity"));
  }

  return response.json();
}

export async function addTaskComment(
  taskId: string,
  comment: string,
): Promise<TaskActivity> {
  const response = await fetch(
    `http://localhost:8080/tasks/${taskId}/activity`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    },
  );

  if (!response.ok) {
    throw new Error(await readError(response, "Failed to add comment"));
  }

  return response.json();
}
