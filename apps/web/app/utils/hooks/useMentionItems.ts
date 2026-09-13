"use client";

import { useMemo } from "react";
import { MentionItem } from "@/app/_components/editor/mention";
import { Doc, Project, Sheet, Task, Workspace } from "@/app/_types/types";
import { useDocs } from "@/app/utils/hooks/docs";
import { useProjects } from "@/app/utils/hooks/projects";
import { useSheets } from "@/app/utils/hooks/sheets";
import { useTasks } from "@/app/utils/hooks/tasks";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";

function toTime(value?: string | null) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Everything mentionable, newest first. React Query dedupes these four
 * requests, so mounting this from several editors at once is cheap.
 */
export function useMentionItems(): MentionItem[] {
  const { data: docs } = useDocs();
  const { data: sheets } = useSheets();
  const { data: tasks } = useTasks();
  const { data: projects } = useProjects();
  const { data: workspaces } = useWorkspaces();

  return useMemo(() => {
    const workspaceNames = new Map(
      ((workspaces ?? []) as Workspace[]).map((workspace) => [
        workspace.id,
        workspace.name,
      ]),
    );

    const entries: { item: MentionItem; updatedAt: number }[] = [];

    for (const doc of (docs ?? []) as Doc[]) {
      entries.push({
        item: {
          id: doc.id,
          label: doc.title,
          entityType: "doc",
          hint: workspaceNames.get(doc.workspaceId),
        },
        updatedAt: toTime(doc.updatedAt),
      });
    }

    for (const sheet of (sheets ?? []) as Sheet[]) {
      entries.push({
        item: {
          id: sheet.id,
          label: sheet.title,
          entityType: "sheet",
          hint: workspaceNames.get(sheet.workspaceId),
        },
        updatedAt: toTime(sheet.updatedAt),
      });
    }

    for (const task of (tasks ?? []) as Task[]) {
      entries.push({
        item: {
          id: task.id,
          label: task.name,
          entityType: "task",
          hint:
            task.project?.title ??
            (task.workspaceId
              ? workspaceNames.get(task.workspaceId)
              : undefined),
        },
        updatedAt: toTime(task.updatedAt),
      });
    }

    for (const project of (projects ?? []) as Project[]) {
      entries.push({
        item: {
          id: project.id,
          label: project.title,
          entityType: "project",
          hint: workspaceNames.get(project.workspaceId),
        },
        updatedAt: toTime(project.updatedAt),
      });
    }

    return entries
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((entry) => entry.item);
  }, [docs, sheets, tasks, projects, workspaces]);
}
