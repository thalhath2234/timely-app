import type { Doc, Project, Sheet, Task, Workspace } from "./types";
import { extractMentions } from "./richText";

export type ReportStat = { label: string; value: number; hint: string };
export type PriorityBucket = { name: string; count: number; percent: number };
export type NamedCount = { id: string; name: string; count: number };
export type DeadlineItem = {
  id: string;
  name: string;
  deadline: string;
  priorityLevel: string | null;
  projectTitle?: string | null;
  overdue: boolean;
};
export type MentionLink = {
  from: { kind: string; id: string; label: string };
  to: { id: string; label: string; entityType: string };
};
export type ActivityItem = {
  id: string;
  kind: string;
  label: string;
  updatedAt: string;
  hint?: string;
};

export type ReportData = {
  stats: ReportStat[];
  openTasks: number;
  completedTasks: number;
  completionRate: number;
  overdue: DeadlineItem[];
  upcoming: DeadlineItem[];
  priorities: PriorityBucket[];
  byWorkspace: NamedCount[];
  byProject: NamedCount[];
  mentions: MentionLink[];
  recent: ActivityItem[];
};

const PRIORITY_ORDER = ["Urgent", "High", "Medium", "Low", "None"];

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(base: Date, days: number) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildReportData(input: {
  tasks: Task[];
  projects: Project[];
  docs: Doc[];
  sheets: Sheet[];
  workspaces: Workspace[];
}): ReportData {
  const { tasks, projects, docs, sheets, workspaces } = input;
  const today = startOfToday();
  const horizon = addDays(today, 14);
  const openTasks = tasks.filter((task) => !task.completedAt);
  const completedTasks = tasks.filter((task) => Boolean(task.completedAt));
  const completionRate = tasks.length === 0 ? 0 : Math.round((completedTasks.length / tasks.length) * 100);

  const overdue: DeadlineItem[] = [];
  const upcoming: DeadlineItem[] = [];
  for (const task of openTasks) {
    const deadline = parseDate(task.deadline);
    if (!deadline) continue;
    const item: DeadlineItem = {
      id: task.id,
      name: task.name,
      deadline: task.deadline as string,
      priorityLevel: task.priorityLevel,
      projectTitle: task.project?.title,
      overdue: deadline < today,
    };
    if (item.overdue) overdue.push(item);
    else if (deadline <= horizon) upcoming.push(item);
  }

  const priorityCounts = new Map<string, number>();
  for (const task of openTasks) {
    const key = task.priorityLevel?.trim() || "None";
    priorityCounts.set(key, (priorityCounts.get(key) ?? 0) + 1);
  }
  const priorities: PriorityBucket[] = [...priorityCounts.entries()]
    .sort((a, b) => PRIORITY_ORDER.indexOf(a[0]) - PRIORITY_ORDER.indexOf(b[0]))
    .map(([name, count]) => ({
      name,
      count,
      percent: openTasks.length === 0 ? 0 : Math.round((count / openTasks.length) * 100),
    }));

  const workspaceNames = new Map(workspaces.map((w) => [w.id, w.name]));
  const workspaceCounts = new Map<string, number>();
  for (const task of openTasks) {
    if (!task.workspaceId) continue;
    workspaceCounts.set(task.workspaceId, (workspaceCounts.get(task.workspaceId) ?? 0) + 1);
  }
  const byWorkspace = [...workspaceCounts.entries()]
    .map(([id, count]) => ({ id, name: workspaceNames.get(id) ?? "Unknown", count }))
    .sort((a, b) => b.count - a.count);

  const projectCounts = new Map<string, { title: string; count: number }>();
  for (const task of openTasks) {
    if (!task.projectId) continue;
    const title =
      task.project?.title ?? projects.find((p) => p.id === task.projectId)?.title ?? "Untitled project";
    const current = projectCounts.get(task.projectId);
    projectCounts.set(task.projectId, { title, count: (current?.count ?? 0) + 1 });
  }
  const byProject = [...projectCounts.entries()]
    .map(([id, value]) => ({ id, name: value.title, count: value.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const mentions: MentionLink[] = [];
  const push = (kind: string, id: string, label: string, content: Parameters<typeof extractMentions>[0]) => {
    for (const mention of extractMentions(content)) {
      mentions.push({ from: { kind, id, label }, to: mention });
    }
  };
  for (const doc of docs) push("doc", doc.id, doc.title, doc.content);
  for (const task of tasks) push("task", task.id, task.name, task.descriptionRich);
  for (const project of projects) push("project", project.id, project.title, project.descriptionRich);

  const recent: ActivityItem[] = [
    ...tasks.map((task) => ({
      id: task.id,
      kind: "task",
      label: task.name,
      updatedAt: task.updatedAt,
      hint: task.project?.title ?? undefined,
    })),
    ...projects.map((project) => ({
      id: project.id,
      kind: "project",
      label: project.title,
      updatedAt: project.updatedAt,
      hint: workspaceNames.get(project.workspaceId),
    })),
    ...docs.map((doc) => ({
      id: doc.id,
      kind: "doc",
      label: doc.title,
      updatedAt: doc.updatedAt,
      hint: workspaceNames.get(doc.workspaceId),
    })),
    ...sheets.map((sheet) => ({
      id: sheet.id,
      kind: "sheet",
      label: sheet.title,
      updatedAt: sheet.updatedAt,
      hint: workspaceNames.get(sheet.workspaceId),
    })),
  ]
    .sort((a, b) => (parseDate(b.updatedAt)?.getTime() ?? 0) - (parseDate(a.updatedAt)?.getTime() ?? 0))
    .slice(0, 12);

  return {
    stats: [
      { label: "Open tasks", value: openTasks.length, hint: `${completedTasks.length} completed` },
      { label: "Overdue", value: overdue.length, hint: overdue.length === 0 ? "All clear" : "Need attention" },
      { label: "Projects", value: projects.length, hint: `${byProject.length} with open work` },
      { label: "Docs & sheets", value: docs.length + sheets.length, hint: `${docs.length} docs · ${sheets.length} sheets` },
    ],
    openTasks: openTasks.length,
    completedTasks: completedTasks.length,
    completionRate,
    overdue: overdue.slice(0, 10),
    upcoming: upcoming.slice(0, 10),
    priorities,
    byWorkspace,
    byProject,
    mentions: mentions.slice(0, 16),
    recent,
  };
}

export function formatReportDate(value: string) {
  const date = parseDate(value);
  if (!date) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
