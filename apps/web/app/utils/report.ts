import { mentionHref } from "@/app/_components/editor/mention";
import {
  Doc,
  MentionAttrs,
  MentionEntityType,
  Project,
  Sheet,
  Task,
  Workspace,
} from "@/app/_types/types";
import { extractMentions } from "@/app/utils/richText";

export interface ReportStat {
  label: string;
  value: number;
  hint: string;
}

export interface PriorityBucket {
  name: string;
  count: number;
  percent: number;
}

export interface NamedCount {
  id: string;
  name: string;
  count: number;
  href: string;
}

export interface DeadlineItem {
  id: string;
  name: string;
  deadline: string;
  priorityLevel: string | null;
  projectTitle?: string | null;
  overdue: boolean;
  href: string;
}

export interface MentionLink {
  from: { kind: MentionEntityType | "doc" | "sheet"; id: string; label: string; href: string };
  to: MentionAttrs & { href: string };
}

export interface ActivityItem {
  id: string;
  kind: MentionEntityType;
  label: string;
  updatedAt: string;
  href: string;
  hint?: string;
}

export interface ReportData {
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
}

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

function isCompleted(task: Task) {
  return Boolean(task.completedAt);
}

const PRIORITY_ORDER = ["Urgent", "High", "Medium", "Low", "None"];

function priorityKey(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return "None";
  const lower = trimmed.toLowerCase();
  if (lower === "critical") return "Urgent";
  return trimmed[0].toUpperCase() + trimmed.slice(1).toLowerCase();
}

/**
 * Rolls the live task / project / doc / sheet lists into the numbers the
 * report page renders. Pure so it stays easy to reason about in the UI.
 */
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

  const openTasks = tasks.filter((task) => !isCompleted(task));
  const completedTasks = tasks.filter(isCompleted);
  const completionRate =
    tasks.length === 0
      ? 0
      : Math.round((completedTasks.length / tasks.length) * 100);

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
      href: mentionHref("task", task.id),
    };

    if (item.overdue) {
      overdue.push(item);
    } else if (deadline <= horizon) {
      upcoming.push(item);
    }
  }

  overdue.sort(
    (a, b) =>
      (parseDate(a.deadline)?.getTime() ?? 0) -
      (parseDate(b.deadline)?.getTime() ?? 0),
  );
  upcoming.sort(
    (a, b) =>
      (parseDate(a.deadline)?.getTime() ?? 0) -
      (parseDate(b.deadline)?.getTime() ?? 0),
  );

  const priorityCounts = new Map<string, number>();
  for (const task of openTasks) {
    const key = priorityKey(task.priorityLevel);
    priorityCounts.set(key, (priorityCounts.get(key) ?? 0) + 1);
  }

  const priorities: PriorityBucket[] = PRIORITY_ORDER.filter((name) =>
    priorityCounts.has(name),
  )
    .concat(
      [...priorityCounts.keys()].filter(
        (name) => !PRIORITY_ORDER.includes(name),
      ),
    )
    .map((name) => {
      const count = priorityCounts.get(name) ?? 0;
      return {
        name,
        count,
        percent:
          openTasks.length === 0
            ? 0
            : Math.round((count / openTasks.length) * 100),
      };
    });

  const workspaceNames = new Map(
    workspaces.map((workspace) => [workspace.id, workspace.name]),
  );

  const workspaceCounts = new Map<string, number>();
  for (const task of openTasks) {
    if (!task.workspaceId) continue;
    workspaceCounts.set(
      task.workspaceId,
      (workspaceCounts.get(task.workspaceId) ?? 0) + 1,
    );
  }

  const byWorkspace: NamedCount[] = [...workspaceCounts.entries()]
    .map(([id, count]) => ({
      id,
      name: workspaceNames.get(id) ?? "Unknown workspace",
      count,
      href: "/tasks",
    }))
    .sort((a, b) => b.count - a.count);

  const projectCounts = new Map<string, { title: string; count: number }>();
  for (const task of openTasks) {
    if (!task.projectId) continue;
    const title =
      task.project?.title ??
      projects.find((project) => project.id === task.projectId)?.title ??
      "Untitled project";
    const current = projectCounts.get(task.projectId);
    projectCounts.set(task.projectId, {
      title,
      count: (current?.count ?? 0) + 1,
    });
  }

  const byProject: NamedCount[] = [...projectCounts.entries()]
    .map(([id, value]) => ({
      id,
      name: value.title,
      count: value.count,
      href: mentionHref("project", id),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const mentions: MentionLink[] = [];
  const pushMentions = (
    kind: MentionEntityType,
    id: string,
    label: string,
    content: Parameters<typeof extractMentions>[0],
  ) => {
    for (const mention of extractMentions(content)) {
      mentions.push({
        from: {
          kind,
          id,
          label,
          href: mentionHref(kind, id),
        },
        to: { ...mention, href: mentionHref(mention.entityType, mention.id) },
      });
    }
  };

  for (const doc of docs) {
    pushMentions("doc", doc.id, doc.title, doc.content);
  }
  for (const sheet of sheets) {
    pushMentions(
      "sheet",
      sheet.id,
      sheet.title,
      sheet.descriptionRich ?? undefined,
    );
  }
  for (const task of tasks) {
    pushMentions(
      "task",
      task.id,
      task.name,
      task.descriptionRich ?? undefined,
    );
  }
  for (const project of projects) {
    pushMentions(
      "project",
      project.id,
      project.title,
      project.descriptionRich ?? undefined,
    );
  }

  const recent: ActivityItem[] = [
    ...tasks.map((task) => ({
      id: task.id,
      kind: "task" as const,
      label: task.name,
      updatedAt: task.updatedAt,
      href: mentionHref("task", task.id),
      hint: task.project?.title ?? undefined,
    })),
    ...projects.map((project) => ({
      id: project.id,
      kind: "project" as const,
      label: project.title,
      updatedAt: project.updatedAt,
      href: mentionHref("project", project.id),
      hint: workspaceNames.get(project.workspaceId),
    })),
    ...docs.map((doc) => ({
      id: doc.id,
      kind: "doc" as const,
      label: doc.title,
      updatedAt: doc.updatedAt,
      href: mentionHref("doc", doc.id),
      hint: workspaceNames.get(doc.workspaceId),
    })),
    ...sheets.map((sheet) => ({
      id: sheet.id,
      kind: "sheet" as const,
      label: sheet.title,
      updatedAt: sheet.updatedAt,
      href: mentionHref("sheet", sheet.id),
      hint: workspaceNames.get(sheet.workspaceId),
    })),
  ]
    .sort(
      (a, b) =>
        (parseDate(b.updatedAt)?.getTime() ?? 0) -
        (parseDate(a.updatedAt)?.getTime() ?? 0),
    )
    .slice(0, 12);

  return {
    stats: [
      {
        label: "Open tasks",
        value: openTasks.length,
        hint: `${completedTasks.length} completed`,
      },
      {
        label: "Overdue",
        value: overdue.length,
        hint: overdue.length === 0 ? "All clear" : "Need attention",
      },
      {
        label: "Projects",
        value: projects.length,
        hint: `${byProject.length} with open work`,
      },
      {
        label: "Docs & sheets",
        value: docs.length + sheets.length,
        hint: `${docs.length} docs · ${sheets.length} sheets`,
      },
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

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatRelative(value: string) {
  const date = parseDate(value);
  if (!date) return "";

  const diffMs = date.getTime() - Date.now();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays === -1) return "yesterday";
  if (diffDays > 1) return `in ${diffDays} days`;
  return `${Math.abs(diffDays)} days ago`;
}
