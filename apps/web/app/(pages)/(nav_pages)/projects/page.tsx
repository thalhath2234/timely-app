"use client";

import Link from "next/link";
import type { MouseEvent as ReactMouseEvent } from "react";
import { FolderKanban, Plus } from "lucide-react";
import EmptyState from "@/app/_components/_ui/emptyState";
import LoadError, { LoadErrorBanner } from "@/app/_components/_ui/loadError";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { useProjects } from "@/app/utils/hooks/projects";
import { useProjectContextMenu } from "@/app/utils/hooks/useProjectContextMenu";
import { useTasks } from "@/app/utils/hooks/tasks";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { resolvedColor } from "@/app/utils/entityColor";
import { formatShortDate, projectStats, tasksForProject } from "@/app/utils/projectStats";
import { sortedStages } from "@/app/utils/stages";
import { cn } from "@/app/utils/cn";
import type { Project, Task } from "@/app/_types/types";
import { motion } from "motion/react";
import Button from "@/app/_components/_ui/button";
import PageHeader, { PageBadge } from "@/app/_components/_ui/pageHeader";
import PageWithRail from "@/app/_components/_ui/pageWithRail";
import ProjectsRail from "@/app/_components/projects/projectsRail";
import { listContainerVariants, listItemVariants, springSoft } from "@/app/_components/_ui/motion";

function ProgressBar({ value, color }: { value: number; color?: string | null }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <motion.div
        className="h-full rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        transition={springSoft}
        style={{ backgroundColor: color || "var(--primary)" }}
      />
    </div>
  );
}

/** One segment per stage, full when its tasks are all done, half when some are. */
function StageStrip({ project, tasks }: { project: Project; tasks: Task[] }) {
  const stages = sortedStages(project.stages);
  if (!project.doesHaveStages || stages.length === 0) return <span className="text-xs text-muted-foreground">No stages</span>;
  return (
    <span className="flex items-center gap-0.5" title={`${stages.length} stages`} aria-label={`${stages.length} stages`}>
      {stages.map((stage, index) => {
        const mine = tasks.filter((task) => task.stageId === stage.id && (task.duration ?? 0) > 0);
        const done = mine.filter((task) => task.completedAt).length;
        const share = mine.length === 0 ? 0 : done / mine.length;
        return (
          <span
            key={stage.id}
            className="h-2 w-3.5 rounded-sm"
            style={{ backgroundColor: resolvedColor(stage.color, undefined, index), opacity: share >= 1 ? 1 : share > 0 ? 0.6 : 0.22 }}
          />
        );
      })}
    </span>
  );
}

function ProjectRow({
  project,
  tasks,
  today,
  onContextMenu,
}: {
  project: Project;
  tasks: Task[];
  today: number;
  onContextMenu: (event: ReactMouseEvent, project: Project) => void;
}) {
  const mine = tasksForProject(tasks, project.id);
  const stats = projectStats(project, mine);
  const color = resolvedColor(project.color, project.id);
  // The project's own deadline, as the rail and the phone show it.
  const due = project.deadline ? new Date(project.deadline).getTime() : NaN;
  const overdue = !Number.isNaN(due) && due < today && !project.completedAt;

  return (
    <motion.li variants={listItemVariants} className="border-t border-border first:border-t-0">
      <Link
        href={`/projects/${project.id}`}
        onContextMenu={(event) => onContextMenu(event, project)}
        className="grid min-h-14 grid-cols-[3px_minmax(0,1fr)_auto] items-center gap-x-4 py-2 pl-3 pr-4 transition-colors hover:bg-muted/40 lg:grid-cols-[3px_minmax(0,1fr)_84px_180px_96px_64px]"
        data-testid="project-row"
      >
        <span className="h-9 w-[3px] rounded-full" style={{ backgroundColor: color }} aria-hidden />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">{project.title || "Untitled project"}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {project.workspace?.name || "No workspace"}
            {project.status?.name ? ` · ${project.status.name}` : ""}
            {project.description?.trim() ? ` · ${project.description.trim()}` : ""}
          </span>
        </span>
        <span className="hidden lg:block">
          <StageStrip project={project} tasks={mine} />
        </span>
        <span className="hidden items-center gap-2.5 lg:flex">
          <ProgressBar value={stats.progress} color={color} />
          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {stats.completed}/{stats.total}
          </span>
        </span>
        <span className={cn("text-right text-xs tabular-nums", overdue ? "font-medium text-destructive" : project.deadline ? "text-foreground" : "text-muted-foreground")}>
          {project.deadline ? `${overdue ? "Overdue" : "Due"} ${formatShortDate(project.deadline)}` : "No deadline"}
        </span>
        <span className="hidden text-right lg:block">
          {project.priorityLevel ? (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium capitalize text-foreground/80">{project.priorityLevel}</span>
          ) : null}
        </span>
      </Link>
    </motion.li>
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
  const openMenu = useContextMenu();
  const projectMenu = useProjectContextMenu();
  const onProjectContextMenu = (event: ReactMouseEvent, project: Project) =>
    openMenu(event, projectMenu(project, { omit: ["open"] }), {
      title: project.title || "Untitled project",
    });

  const openCreate = () => {
    setAddNewMode("project");
    setIsAddItemModalOpen(true);
  };

  const list = (projects ?? []) as Project[];
  const allTasks = (tasks ?? []) as Task[];
  const canCreate = ((workspaces ?? []) as { id: string }[]).length > 0;
  const today = new Date().setHours(0, 0, 0, 0);

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader
        title="Projects"
        badge={list.length > 0 ? <PageBadge>{list.length}</PageBadge> : null}
        actions={
          <Button onClick={openCreate} disabled={!canCreate} leading={<Plus />}>
            New project
          </Button>
        }
      />
      <PageWithRail
        className="px-6 pb-6"
        sticky
        rail={!isLoading && !isError && list.length > 0 ? <ProjectsRail projects={list} /> : null}
      >
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
          <p className="mt-2 text-sm text-muted-foreground">Loading projects…</p>
        ) : isError ? (
          <div className="mt-2 flex flex-1 flex-col">
            <LoadError
              what="projects"
              error={projectsQuery.error}
              onRetry={() => projectsQuery.refetch()}
              retrying={projectsQuery.isFetching}
            />
          </div>
        ) : list.length === 0 ? (
          <div className="mt-2">
            <EmptyState
              icon={FolderKanban}
              title="No projects yet"
              description="Create a project to group tasks, stages, and deadlines."
              action={
                <Button onClick={openCreate} className="mt-2" leading={<Plus />}>
                  New project
                </Button>
              }
            />
          </div>
        ) : (
          <motion.ul
            className="mt-1 overflow-hidden rounded-[12px] border border-border bg-card"
            variants={listContainerVariants}
            initial="hidden"
            animate="visible"
            data-testid="projects-list"
          >
            {list.map((project) => (
              <ProjectRow key={project.id} project={project} tasks={allTasks} today={today} onContextMenu={onProjectContextMenu} />
            ))}
          </motion.ul>
        )}
      </PageWithRail>
    </div>
  );
}
