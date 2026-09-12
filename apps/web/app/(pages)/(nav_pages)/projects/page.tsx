"use client";

import Link from "next/link";
import { FolderKanban, Plus } from "lucide-react";
import EmptyState from "@/app/_components/_ui/emptyState";
import { useProjects } from "@/app/utils/hooks/projects";
import { useTasks } from "@/app/utils/hooks/tasks";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { formatShortDate, projectStats } from "@/app/utils/projectStats";
import type { Project, Task } from "@/app/_types/types";

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

function ProjectCard({ project, tasks }: { project: Project; tasks: Task[] }) {
  const stats = projectStats(project, tasks);
  const workspaceName = project.workspace?.name;

  return (
    <Link
      href={`/projects/${project.id}`}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-ring hover:bg-accent/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-medium text-foreground">{project.title || "Untitled project"}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {workspaceName || "No workspace"}
            {project.status?.name ? ` · ${project.status.name}` : ""}
          </p>
        </div>
        {project.priorityLevel ? (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {project.priorityLevel}
          </span>
        ) : null}
      </div>
      <p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">
        {project.description?.trim() || "No description"}
      </p>
      <ProgressBar value={stats.progress} />
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>{stats.open} open</span>
        <span>{stats.completed}/{stats.total} done</span>
        <span>Start {formatShortDate(project.startDate)}</span>
        <span>Due {formatShortDate(project.deadline)}</span>
      </div>
    </Link>
  );
}

export default function ProjectsPage() {
  const { data: projects, isLoading, isError } = useProjects();
  const { data: tasks } = useTasks();
  const { data: workspaces } = useWorkspaces();
  const setAddNewMode = useSidebarStore((state) => state.setAddNewMode);
  const setIsAddItemModalOpen = useSidebarStore((state) => state.setIsAddItemModalOpen);

  const openCreate = () => {
    setAddNewMode("project");
    setIsAddItemModalOpen(true);
  };

  const list = (projects ?? []) as Project[];
  const allTasks = (tasks ?? []) as Task[];
  const canCreate = ((workspaces ?? []) as { id: string }[]).length > 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full flex-col px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Projects</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Create a project, break it into stages, and work the tasks without leaving this area.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            disabled={!canCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            <Plus className="size-4" />
            New project
          </button>
        </div>

        {isLoading ? (
          <p className="mt-6 text-sm text-muted-foreground">Loading projects…</p>
        ) : isError ? (
          <div className="mt-6">
            <EmptyState
              icon={FolderKanban}
              title="Couldn't load projects"
              description="Check your connection and try again."
            />
          </div>
        ) : list.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              icon={FolderKanban}
              title="No projects yet"
              description="Create a project to group tasks, stages, and deadlines."
              action={
                <button
                  type="button"
                  onClick={openCreate}
                  className="mt-2 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                >
                  New project
                </button>
              }
            />
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((project) => (
              <ProjectCard key={project.id} project={project} tasks={allTasks} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
