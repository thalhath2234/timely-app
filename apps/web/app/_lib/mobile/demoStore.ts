import { create } from "zustand";
import type { Task } from "@/app/_types/types";

/**
 * Local-only edits applied on top of the sample dataset so the prototype
 * feels interactive (tick a task, add a task) without a backend.
 */
interface DemoState {
  taskOverrides: Record<string, Partial<Task>>;
  createdTasks: Task[];
  patchTask: (id: string, patch: Partial<Task>) => void;
  addTask: (task: Task) => void;
  removeTask: (id: string) => void;
  removedTaskIds: string[];
}

export const useDemoStore = create<DemoState>((set) => ({
  taskOverrides: {},
  createdTasks: [],
  removedTaskIds: [],
  patchTask: (id, patch) =>
    set((s) => ({
      taskOverrides: {
        ...s.taskOverrides,
        [id]: { ...s.taskOverrides[id], ...patch },
      },
    })),
  addTask: (task) => set((s) => ({ createdTasks: [task, ...s.createdTasks] })),
  removeTask: (id) => set((s) => ({ removedTaskIds: [...s.removedTaskIds, id] })),
}));
