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
import { GroupLabel, ListGroup, ListRow } from "@/app/_components/_ui/groupedList";
import Button, { buttonClass } from "@/app/_components/_ui/button";
import { requestConfirm } from "@/app/_store/confirmStore";
import StageBoard from "@/app/_components/projects/stageBoard";
import StageCatalog from "@/app/_components/projects/stageCatalog";
import ProjectInsights from "@/app/_components/projects/projectInsights";
import ProjectTaskList from "@/app/_components/_ui/tasks/projectTaskList";
import SaveStatusBadge from "@/app/_components/_ui/saveStatus";
import { PRIORITY_OPTIONS, normalizePriority, priorityRank } from "@/app/utils/priority";
import { dateFromDateInput } from "@/app/utils/calendar";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";
import { formatShortDate, projectStats, tasksForProject } from "@/app/utils/projectStats";
import {
  useDeleteProject,
  useDuplicateProject,
  useProject,
  useProjectActivity,
  useUpdateProject,
} from "@/app/utils/hooks/projects";
import LoadError from "@/app/_components/_ui/loadError";
import { useContextMenu } from "@/app/_components/_ui/contextMenu";
import { useProjectContextMenu } from "@/app/utils/hooks/useProjectContextMenu";
import { projectDeleteCopy } from "@timely/contract/projectDelete";
import { useTasks } from "@/app/utils/hooks/tasks";
import { useWorkingHoursZone, useWorkspaces } from "@/app/utils/hooks/workspaces";
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
            <Link href="/projects" className={buttonClass()}>
              Back to projects
            </Link>
          }
        />
      </div>
    );
  }

  return <ProjectHub key={project.id} project={project} />;
}

function ProjectHub({ project }: { project: Project }) {
  const router = useRouter();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const duplicateProject = useDuplicateProject();
  const { data: tasks } = useTasks();
  const { data: workspaces } = useWorkspaces();
  const openMenu = useContextMenu();
  const projectMenu = useProjectContextMenu();
  // Overview is the landing tab: the brief, the numbers and what is next,
  // with the stage board one click away.
  const [tab, setTab] = useState<Tab>("overview");
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
      <header
        className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3"
        onContextMenu={(event) => {
          if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
          openMenu(event, projectMenu(project, { omit: ["open"] }), {
            title: project.title || "Untitled project",
          });
        }}
      >
        <Link href="/projects" className={buttonClass({ variant: "ghost", size: "sm", className: "-ml-2" })}>
          <ArrowLeft />
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
        <Button
          variant="outline"
          leading={<Copy />}
          loading={duplicateProject.isPending}
          onClick={() =>
            void duplicateProject.mutateAsync(project.id).then((copy) => {
              router.push(`/projects/${copy.id}`);
            })
          }
        >
          Duplicate
        </Button>
        <Button
          variant="ghost"
          icon
          aria-label="Delete project"
          title="Delete project"
          className="hover:text-destructive"
          onClick={() =>
            requestConfirm({
              ...projectDeleteCopy(title, projectTasks.length, project.stages?.length ?? 0),
              onConfirm: async () => {
                await deleteProject.mutateAsync(project.id);
                router.push("/projects");
              },
            })
          }
        >
          <Trash2 />
        </Button>
        <Button
          variant={project.completedAt ? "soft" : "primary"}
          leading={<Check />}
          onClick={() => {
            const completing = !project.completedAt;
            schedule({
              completedAt: completing ? new Date().toISOString() : "",
            });
            void flush();
          }}
        >
          {project.completedAt ? "Completed" : "Mark complete"}
        </Button>
      </header>

      <div className="flex gap-1 border-b border-border px-6">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`inline-flex items-center border-b-2 px-3 py-2 text-sm ${
              tab === item.id
                ? "border-primary font-medium text-foreground"
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

      <div className={`flex-1 ${tab === "tasks" ? "min-h-0 overflow-hidden" : "overflow-y-auto px-6 py-5"}`}>
        {tab === "overview" ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-4">
              <textarea
                defaultValue={project.description ?? ""}
                onChange={(event) => schedule({ description: event.target.value })}
                onBlur={() => void flush()}
                placeholder="What is this project for?"
                className="min-h-28 w-full rounded-[12px] border border-border bg-card p-3 text-sm outline-none focus:border-ring"
              />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Fact label="open tasks" value={String(stats.open)} />
                <Fact label="done" value={`${stats.progress}%`} share={stats.progress} color={project.color} />
                <Fact label="scheduled" value={String(stats.scheduled)} />
                <Fact label="next deadline" value={formatShortDate(stats.nextDeadline)} />
              </div>
              <ProjectInsights project={project} />
              <div className="grid gap-4 xl:grid-cols-2">
                <UpNext
                  tasks={projectTasks}
                  statuses={statuses}
                  onSeeAll={() => setTab("tasks")}
                />
                <RecentChanges project={project} onSeeAll={() => setTab("activity")} />
              </div>
            </div>
            <aside className="flex flex-col gap-1.5" aria-label="Project details">
              <GroupLabel>Details</GroupLabel>
              <ListGroup>
                <ListRow label="Status">
                  <Select
                    variant="row"
                    placeholder="No status"
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
                </ListRow>
                <ListRow label="Priority">
                  <Select
                    variant="row"
                    placeholder="No priority"
                    value={normalizePriority(project.priorityLevel)}
                    onChange={(priorityLevel) => schedule({ priorityLevel })}
                    options={[{ value: "", label: "No priority" }, ...PRIORITY_OPTIONS]}
                  />
                </ListRow>
                <ListRow label="Start">
                  <DateField variant="row" aria-label="Start date" clearable value={project.startDate} onChange={(startDate) => schedule({ startDate })} />
                </ListRow>
                <ListRow label="Deadline">
                  <DateField variant="row" aria-label="Deadline" clearable value={project.deadline} onChange={(deadline) => schedule({ deadline })} />
                </ListRow>
                <ListRow label="Colour">
                  <ColorPicker variant="row" value={project.color || "#30A66D"} onChange={(color) => schedule({ color })} aria-label="Project color" />
                </ListRow>
                <ListRow label="Workspace">
                  {workspace ? <ColorChip color={workspace.color}>{workspace.name}</ColorChip> : <span className="text-[13px] text-muted-foreground">None</span>}
                </ListRow>
              </ListGroup>
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

/** When a change happened, in the person's Working hours zone. */
function formatActivityStamp(value: string, timeZone?: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
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
  const timeZone = useWorkingHoursZone();
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
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
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
                    {formatActivityStamp(entry.createdAt, timeZone)}
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
                  className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm hover:border-primary/30 hover:bg-accent/50"
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

function OverviewCard({
  title,
  action,
  onAction,
  children,
}: {
  title: string;
  action: string;
  onAction: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        <Button variant="link" size="sm" onClick={onAction}>
          {action}
        </Button>
      </div>
      {children}
    </section>
  );
}

/** The project's open work in the order it is due, so the overview answers
 * "what's next here?" without switching to the Tasks tab. */
function UpNext({
  tasks,
  statuses,
  onSeeAll,
}: {
  tasks: Task[];
  statuses: Status[];
  onSeeAll: () => void;
}) {
  const openTask = useEntityDetailStore((state) => state.openTask);
  const open = tasks
    .filter((task) => !task.completedAt && (task.duration ?? 0) > 0)
    .sort(
      (a, b) =>
        (a.deadline || "9999").localeCompare(b.deadline || "9999") ||
        priorityRank(a.priorityLevel) - priorityRank(b.priorityLevel),
    );
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <OverviewCard title="Up next" action={tasks.length === 1 ? "Open in Tasks" : `All ${tasks.length} tasks`} onAction={onSeeAll}>
      {open.length === 0 ? (
        <p className="px-4 pb-4 pt-2 text-sm text-muted-foreground">Nothing open. Add work from the Tasks tab.</p>
      ) : (
        <ul className="divide-y divide-border px-1 pb-1">
          {open.slice(0, 6).map((task) => {
            const status = task.status ?? statuses.find((item) => item.id === task.statusId);
            const priority = normalizePriority(task.priorityLevel);
            const overdue = task.deadline ? dateFromDateInput(task.deadline) < today : false;
            return (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => openTask(task.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-accent/50"
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: status?.color || "var(--muted-foreground)" }}
                    title={status?.name}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{task.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[status?.name, priority].filter(Boolean).join(" · ") || "No status"}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-xs tabular-nums ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}
                  >
                    {task.deadline
                      ? `${overdue ? "Overdue" : "Due"} ${dateFromDateInput(task.deadline).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                      : "No deadline"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </OverviewCard>
  );
}

/** The newest few entries of the project's activity, with the full feed one
 * click away on the Activity tab. */
function RecentChanges({ project, onSeeAll }: { project: Project; onSeeAll: () => void }) {
  const activity = useProjectActivity(project.id);
  const openTask = useEntityDetailStore((state) => state.openTask);
  const timeZone = useWorkingHoursZone();
  const entries = (activity.data ?? []).slice(0, 6);

  return (
    <OverviewCard title="Recent changes" action="All activity" onAction={onSeeAll}>
      {activity.isLoading ? (
        <p className="px-4 pb-4 pt-2 text-sm text-muted-foreground">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="px-4 pb-4 pt-2 text-sm text-muted-foreground">
          No changes yet. Status, priority, schedule and completion changes on this project&apos;s tasks show up here.
        </p>
      ) : (
        <ul className="divide-y divide-border px-1 pb-1">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                disabled={!entry.taskId}
                onClick={() => entry.taskId && openTask(entry.taskId)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left enabled:hover:bg-accent/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{entry.message || entry.action}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {entry.taskId ? entry.taskName || "Task" : "Project"}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatActivityStamp(entry.createdAt, timeZone)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </OverviewCard>
  );
}

/** The film's stat card: a big number over a small label, with a 3 px bar when it is a share. */
function Fact({ label, value, share, color }: { label: string; value: string; share?: number; color?: string | null }) {
  return (
    <div className="flex min-h-[88px] flex-col justify-end rounded-[12px] border border-border bg-card px-4 py-3">
      <p className="text-[26px] font-semibold leading-8 tracking-[-0.02em] tabular-nums text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      {share !== undefined ? (
        <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, share))}%`, backgroundColor: color || "var(--primary)" }} />
        </div>
      ) : null}
    </div>
  );
}
