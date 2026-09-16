"use client";

import Link from "next/link";
import { FolderKanban, Plus } from "lucide-react";
import EmptyState from "@/app/_components/_ui/emptyState";
import LoadError, { LoadErrorBanner } from "@/app/_components/_ui/loadError";
import { useProjects } from "@/app/utils/hooks/projects";
import { useTasks } from "@/app/utils/hooks/tasks";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { resolvedColor } from "@/app/utils/entityColor";
import { formatShortDate, projectStats } from "@/app/utils/projectStats";
import type { Project, Task } from "@/app/_types/types";

function ProgressBar({ value, color }: { value: number; color?: string | null }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.min(100, Math.max(0, value))}%`,
          backgroundColor: color || "var(--primary)",
        }}
      />
    </div>
  );
}

function ProjectCard({ project, tasks }: { project: Project; tasks: Task[] }) {
  const stats = projectStats(project, tasks);
  const workspaceName = project.workspace?.name;
  const color = resolvedColor(project.color, project.id);

  return (
    <Link
      href={`/projects/${project.id}`}
      className="flex flex-col gap-3 overflow-hidden rounded-xl border border-white/10 bg-[#191b22] p-4 transition-colors hover:border-[#c0c1ff]/30 hover:bg-white/[0.03]"
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-medium text-foreground">{project.title || "Untitled project"}</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {project.workspace?.color ? (
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: project.workspace.color }}
              />
            ) : null}
            <span className="truncate">
              {workspaceName || "No workspace"}
              {project.status?.name ? ` · ${project.status.name}` : ""}
            </span>
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
      <ProgressBar value={stats.progress} color={color} />
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
  const projectsQuery = useProjects();
  const { data: projects, isLoading, isError } = projectsQuery;
  const tasksQuery = useTasks();
  const { data: tasks } = tasksQuery;
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
            className="inline-flex items-center gap-2 rounded-lg bg-[#c0c1ff] px-4 py-2 font-medium text-[#1000a9] hover:bg-[#a8a6ff] disabled:opacity-60"
          >
            <Plus className="size-4" />
            New project
          </button>
        </div>

        {tasksQuery.isError && (
          <LoadErrorBanner
            what="tasks (project progress may be incomplete)"
            error={tasksQuery.error}
            onRetry={() => tasksQuery.refetch()}
            retrying={tasksQuery.isFetching}
            className="mt-4"
          />
        )}

        {isLoading ? (
          <p className="mt-6 text-sm text-muted-foreground">Loading projects…</p>
        ) : isError ? (
          <div className="mt-6 flex flex-1 flex-col">
            <LoadError
              what="projects"
              error={projectsQuery.error}
              onRetry={() => projectsQuery.refetch()}
              retrying={projectsQuery.isFetching}
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
                  className="mt-2 rounded-lg bg-[#c0c1ff] px-3 py-1.5 text-sm text-[#1000a9]"
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
