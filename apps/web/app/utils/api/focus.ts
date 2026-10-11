import { apiFetch } from "./client";

/** A daily habit with today's state, counted on the server from `today`. */
export type Habit = {
  id: string;
  name: string;
  position: number;
  doneToday: boolean;
  /** Days in a row; an unchecked today keeps yesterday's run. */
  streak: number;
  /** The last seven days, oldest first; the last one is today. */
  last7: boolean[];
};

export type Goal = { id: string; title: string; position: number };

export type GoalProgressItem = { taskId: string; name: string; deadline?: string };

/** Open Work that moves each goal forward. `available` is false while smart
 * suggestions are off; the goals themselves still work. */
export type GoalProgress = {
  available: boolean;
  error?: string;
  goals: { goalId: string; title: string; items: GoalProgressItem[] }[];
};

export const MAX_HABITS = 20;
export const MAX_GOALS = 5;
export const MAX_FOCUS_NAME = 80;

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data?.message === "string") message = data.message;
    } catch {
      // keep the fallback message
    }
    throw new Error(message);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const getHabits = (today: string) =>
  request<{ habits: Habit[]; today: string }>(`/habits?today=${encodeURIComponent(today)}`);
export const addHabit = (name: string) => request<Habit>("/habits", "POST", { name });
export const renameHabit = (id: string, name: string) =>
  request<Habit>(`/habits/${encodeURIComponent(id)}`, "PATCH", { name });
export const deleteHabit = (id: string) => request<void>(`/habits/${encodeURIComponent(id)}`, "DELETE");
export const reorderHabits = (ids: string[]) => request<void>("/habits/order", "PUT", { ids });
export const checkHabit = (id: string, day: string, done: boolean) =>
  request<void>(`/habits/${encodeURIComponent(id)}/check`, "POST", { day, done });

export const getGoals = () => request<{ goals: Goal[] }>("/goals");
export const addGoal = (title: string) => request<Goal>("/goals", "POST", { title });
export const renameGoal = (id: string, title: string) =>
  request<Goal>(`/goals/${encodeURIComponent(id)}`, "PATCH", { title });
export const deleteGoal = (id: string) => request<void>(`/goals/${encodeURIComponent(id)}`, "DELETE");
export const reorderGoals = (ids: string[]) => request<void>("/goals/order", "PUT", { ids });
export const getGoalProgress = () => request<GoalProgress>("/goals/progress");
