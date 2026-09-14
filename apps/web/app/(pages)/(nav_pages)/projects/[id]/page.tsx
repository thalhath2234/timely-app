"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Check, Copy, FolderKanban, Trash2 } from "lucide-react";
import EmptyState from "@/app/_components/_ui/emptyState";
import { DateField } from "@/app/_components/_ui/datePicker";
import ColorPicker from "@/app/_components/_ui/colorPicker";
import ColorChip from "@/app/_components/_ui/colorChip";
import Select from "@/app/_components/_ui/select";
import StageBoard from "@/app/_components/projects/stageBoard";
import StageCatalog from "@/app/_components/projects/stageCatalog";
import ProjectTaskList from "@/app/_components/_ui/tasks/projectTaskList";
import SaveStatusBadge from "@/app/_components/_ui/saveStatus";
import { PRIORITY_OPTIONS } from "@/app/utils/priority";
import { formatShortDate, projectStats, tasksForProject } from "@/app/utils/projectStats";
import {
  useDeleteProject,
  useDuplicateProject,
  useProject,
  useProjectActivity,
  useUpdateProject,
} from "@/app/utils/hooks/projects";
import LoadError from "@/app/_components/_ui/loadError";
import { useTasks } from "@/app/utils/hooks/tasks";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";
import { saveStatusLabel, useAutosave } from "@/app/utils/hooks/useAutosave";
import type { Project, Status, Task, Workspace } from "@/app/_types/types";

type Tab = "overview" | "tasks" | "stages" | "activity";

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const { data: project, isLoading, isError } = useProject(params.id);

  if (isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Loading project…</p>;
  }

  if (isError || !project) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={FolderKanban}
          title="Project not found"
          description="It may have been deleted, or you don't have access."
          action={
            <Link href="/projects" className="rounded-lg bg-secondary px-3 py-1.5 text-sm">
              Back to projects
            </Link>
          }
        />
      </div>
    );
  }

  return <ProjectHub key={project.id} project={project} />;
}

/** Renders a project's overview, editable settings, tasks, stages, and activity. */
function ProjectHub({ project }: { project: Project }) {
  const router = useRouter();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const duplicateProject = useDuplicateProject();
  const { data: tasks } = useTasks();
  const { data: workspaces } = useWorkspaces();
  const [tab, setTab] = useState<Tab>(project.doesHaveStages ? "stages" : "overview");
  const [title, setTitle] = useState(project.title);

  const { schedule, flush, status } = useAutosave<{
    title?: string;
    description?: string;
    statusId?: string;
    priorityLevel?: string;
    startDate?: string;
    deadline?: string;
    completedAt?: string;
    color?: string;
  }>((patch) => updateProject.mutateAsync({ id: project.id, ...patch }));

  const workspace = ((workspaces ?? []) as Workspace[]).find(
    (item) => item.id === project.workspaceId,
  );
  const statuses = (workspace?.status ?? []) as Status[];
  const projectTasks = useMemo(
    () => tasksForProject((tasks ?? []) as Task[], project.id),
    [tasks, project.id],
  );
  const stats = projectStats(project, projectTasks);
  const recent = [...projectTasks]
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .slice(0, 12);

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "tasks", label: "Tasks" },
    { id: "stages", label: "Stages" },
    { id: "activity", label: "Activity" },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <Link
          href="/projects"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Projects
        </Link>
        {workspace ? (
          <span
            className="hidden size-2 rounded-full sm:inline-block"
            style={{
              backgroundColor: project.color || workspace.color || "var(--primary)",
            }}
            title={workspace.name}
          />
        ) : null}
        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            schedule({ title: event.target.value });
          }}
          onBlur={() => void flush()}
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
        />
        {project.doesHaveStages ? (
          <span className="hidden items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success sm:inline-flex">
            <span className="size-1.5 rounded-full bg-success" />
            Active Release Cycle
          </span>
        ) : null}
        <SaveStatusBadge status={status} onRetry={() => void flush()} />
        <button
          type="button"
          onClick={() => {
            const completing = !project.completedAt;
            schedule({
              completedAt: completing ? new Date().toISOString() : "",
            });
            void flush();
          }}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
            project.completedAt
              ? "bg-success/15 text-success"
              : "bg-foreground text-background"
          }`}
        >
          <Check className="size-4" />
          {project.completedAt ? "Completed" : "Mark complete"}
        </button>
        <button
          type="button"
          onClick={() =>
            void duplicateProject.mutateAsync(project.id).then((copy) => {
              router.push(`/projects/${copy.id}`);
            })
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm"
        >
          <Copy className="size-4" />
          Duplicate
        </button>
        <button
          type="button"
          onClick={async () => {
            if (!window.confirm("Delete this project and its stages?")) return;
            await deleteProject.mutateAsync(project.id);
            router.push("/projects");
          }}
          className="rounded-lg px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="size-4" />
        </button>
      </header>

      <div className="flex gap-1 border-b border-border px-5">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`inline-flex items-center border-b-2 px-3 py-2 text-sm ${
              tab === item.id
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.label}
            {item.id === "tasks" ? (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
                {projectTasks.length}
              </span>
            ) : null}
            {item.id === "stages" && (project.stages?.length ?? 0) > 0 ? (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
                {project.stages?.length}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className={`flex-1 ${tab === "tasks" ? "min-h-0 overflow-hidden" : "overflow-y-auto p-5"}`}>
        {tab === "overview" ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
            <div className="space-y-4">
              <textarea
                defaultValue={project.description ?? ""}
                onChange={(event) => schedule({ description: event.target.value })}
                onBlur={() => void flush()}
                placeholder="What is this project for?"
                className="min-h-32 w-full rounded-xl border border-border bg-input/20 p-3 text-sm outline-none focus:border-ring"
              />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Fact label="Open tasks" value={String(stats.open)} />
                <Fact label="Progress" value={`${stats.progress}%`} />
                <Fact label="Scheduled" value={String(stats.scheduled)} />
                <Fact label="Next deadline" value={formatShortDate(stats.nextDeadline)} />
              </div>
            </div>
            <aside className="space-y-3 rounded-xl border border-border p-4">
              <label className="block text-xs text-muted-foreground">Status</label>
              <Select
                size="sm"
                value={project.statusId ?? ""}
                onChange={(statusId) => schedule({ statusId })}
                options={[
                  { value: "", label: "No status" },
                  ...statuses.map((status) => ({
                    value: status.id,
                    label: status.name,
                    color: status.color,
                  })),
                ]}
              />
              <label className="block text-xs text-muted-foreground">Priority</label>
              <Select
                size="sm"
                value={project.priorityLevel ?? ""}
                onChange={(priorityLevel) => schedule({ priorityLevel })}
                options={[{ value: "", label: "No priority" }, ...PRIORITY_OPTIONS]}
              />
              <label className="block text-xs text-muted-foreground">Start</label>
              <DateField
                size="sm"
                value={project.startDate}
                onChange={(startDate) => schedule({ startDate })}
              />
              <label className="block text-xs text-muted-foreground">Deadline</label>
              <DateField
                size="sm"
                value={project.deadline}
                onChange={(deadline) => schedule({ deadline })}
              />
              <label className="block text-xs text-muted-foreground">Color</label>
              <ColorPicker
                value={project.color || "#30A66D"}
                onChange={(color) => schedule({ color })}
                aria-label="Project color"
              />
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                Workspace:{" "}
                {workspace ? (
                  <ColorChip color={workspace.color}>{workspace.name}</ColorChip>
                ) : (
                  "—"
                )}
              </p>
              <p className="sr-only">{saveStatusLabel(status)}</p>
            </aside>
          </div>
        ) : null}

        {tab === "tasks" ? (
          <ProjectTaskList project={project} workspace={workspace} />
        ) : null}

        {tab === "stages" ? (
          <div className="space-y-5">
            <StageCatalog
              projectId={project.id}
              workspaceId={project.workspaceId}
              stages={project.stages}
              tasks={projectTasks}
              doesHaveStages={project.doesHaveStages}
            />
            {project.doesHaveStages ? (
              <StageBoard
                projectId={project.id}
                workspaceId={project.workspaceId}
                stages={project.stages}
                tasks={projectTasks}
              />
            ) : null}
          </div>
        ) : null}

        {tab === "activity" ? (
          <ProjectActivityFeed project={project} recent={recent} />
        ) : null}
      </div>
    </div>
  );
}

function formatActivityStamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The project's change history: who changed what on which task, newest
 * first. Project-level field edits are not journaled yet, so the header says
 * so instead of implying completeness; the "recently updated" list stays as a
 * secondary section for quick navigation.
 */
function ProjectActivityFeed({ project, recent }: { project: Project; recent: Task[] }) {
  const activity = useProjectActivity(project.id);
  const entries = activity.data ?? [];

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Task changes in this project
          </h3>
          <span className="text-xs text-muted-foreground">
            Created {formatShortDate(project.createdAt)}
            {project.updatedAt && project.updatedAt !== project.createdAt
              ? ` · project fields last edited ${formatShortDate(project.updatedAt)}`
              : ""}
          </span>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Status, priority, stage, schedule, comment and completion changes on every task here.
          Edits to the project&apos;s own title, dates and description are not recorded yet.
        </p>
        {activity.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading activity…</p>
        ) : activity.isError ? (
          <LoadError
            what="project activity"
            error={activity.error}
            onRetry={() => activity.refetch()}
            retrying={activity.isFetching}
          />
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recorded changes yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {entries.map((entry) => {
              const isProjectLevel = !entry.taskId;
              const row = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">
                      {entry.actorName ? <span className="font-medium">{entry.actorName} </span> : null}
                      {entry.message || entry.action}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {isProjectLevel ? "Project" : entry.taskName || "Task"}
                      {entry.field ? ` · ${entry.field}` : ""}
                      {entry.oldValue && entry.newValue
                        ? ` · ${entry.oldValue} → ${entry.newValue}`
                        : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatActivityStamp(entry.createdAt)}
                  </span>
                </>
              );
              return (
                <li key={entry.id}>
                  {isProjectLevel ? (
                    <div className="flex items-center gap-3 px-3 py-2">{row}</div>
                  ) : (
                    <Link
                      href={`/tasks?taskId=${encodeURIComponent(entry.taskId)}`}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-accent/40"
                    >
                      {row}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {recent.length > 0 ? (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recently updated tasks
          </h3>
          <ul className="space-y-2">
            {recent.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/tasks?taskId=${encodeURIComponent(task.id)}`}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent/40"
                >
                  <span className="truncate">{task.name}</span>
                  <span className="text-xs text-muted-foreground">{formatShortDate(task.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
