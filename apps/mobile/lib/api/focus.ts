import { api } from "./client";

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

export const getHabits = (today: string) =>
  api<{ habits: Habit[]; today: string }>(`/habits?today=${encodeURIComponent(today)}`);
export const addHabit = (name: string) => api<Habit>("/habits", { method: "POST", body: { name } });
export const renameHabit = (id: string, name: string) =>
  api<Habit>(`/habits/${encodeURIComponent(id)}`, { method: "PATCH", body: { name } });
export const deleteHabit = (id: string) => api<void>(`/habits/${encodeURIComponent(id)}`, { method: "DELETE" });
export const reorderHabits = (ids: string[]) => api<void>("/habits/order", { method: "PUT", body: { ids } });
export const checkHabit = (id: string, day: string, done: boolean) =>
  api<void>(`/habits/${encodeURIComponent(id)}/check`, { method: "POST", body: { day, done } });

export const getGoals = () => api<{ goals: Goal[] }>("/goals");
export const addGoal = (title: string) => api<Goal>("/goals", { method: "POST", body: { title } });
export const renameGoal = (id: string, title: string) =>
  api<Goal>(`/goals/${encodeURIComponent(id)}`, { method: "PATCH", body: { title } });
export const deleteGoal = (id: string) => api<void>(`/goals/${encodeURIComponent(id)}`, { method: "DELETE" });
export const reorderGoals = (ids: string[]) => api<void>("/goals/order", { method: "PUT", body: { ids } });
export const getGoalProgress = () => api<GoalProgress>("/goals/progress");
