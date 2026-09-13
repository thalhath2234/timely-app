import type { Project, Task } from "@/app/_types/types";

export type ProjectStats = {
  total: number;
  open: number;
  completed: number;
  scheduled: number;
  progress: number;
  nextDeadline: string | null;
};

export function tasksForProject(tasks: Task[], projectId: string) {
  return tasks.filter((task) => (task.project?.id ?? task.projectId) === projectId);
}

export function projectStats(project: Project, tasks: Task[]): ProjectStats {
  const scoped = project.tasks?.length
    ? project.tasks
    : tasksForProject(tasks, project.id);
  const work = scoped.filter((task) => (task.duration ?? 0) > 0);
  const completed = work.filter((task) => task.completedAt).length;
  const open = work.length - completed;
  const scheduled = work.filter(
    (task) => !task.completedAt && (Boolean(task.scheduledOn) || (task.blocks?.length ?? 0) > 0),
  ).length;
  const nextDeadline =
    work
      .filter((task) => !task.completedAt && task.deadline)
      .map((task) => task.deadline as string)
      .sort()[0] ?? project.deadline ?? null;

  return {
    total: work.length,
    open,
    completed,
    scheduled,
    progress: work.length === 0 ? 0 : Math.round((completed / work.length) * 100),
    nextDeadline,
  };
}

export function formatShortDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
