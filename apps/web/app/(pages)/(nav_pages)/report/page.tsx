"use client";

import Link from "next/link";
import { useMemo, type ComponentType } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  FileText,
  FolderKanban,
  Link2,
  ListTodo,
  Sheet as SheetIcon,
} from "lucide-react";
import { MENTION_TYPE_LABELS } from "@/app/_components/editor/mention";
import { Doc, Project, Sheet, Task, Workspace } from "@/app/_types/types";
import { useDocs } from "@/app/utils/hooks/docs";
import { useProjects } from "@/app/utils/hooks/projects";
import { useSheets } from "@/app/utils/hooks/sheets";
import { useTasks } from "@/app/utils/hooks/tasks";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";
import {
  buildReportData,
  formatRelative,
  formatReportDate,
  type DeadlineItem,
} from "@/app/utils/report";
import { taskDateSourceLabel } from "@/app/utils/taskDates";
import LoadError, { LoadErrorBanner } from "@/app/_components/_ui/loadError";

const KIND_ICON = {
  doc: FileText,
  sheet: SheetIcon,
  task: ListTodo,
  project: FolderKanban,
} as const;

const PRIORITY_TINT: Record<string, string> = {
  Urgent: "bg-destructive",
  Critical: "bg-destructive",
  High: "bg-warning",
  Medium: "bg-primary",
  Low: "bg-muted-foreground/40",
  None: "bg-muted-foreground/25",
};

export default function ReportPage() {
  const tasksQuery = useTasks();
  const projectsQuery = useProjects();
  const docsQuery = useDocs();
  const sheetsQuery = useSheets();
  const workspacesQuery = useWorkspaces();
  const { data: tasks } = tasksQuery;
  const { data: projects } = projectsQuery;
  const { data: docs } = docsQuery;
  const { data: sheets } = sheetsQuery;
  const { data: workspaces } = workspacesQuery;

  const isLoading =
    tasksQuery.isLoading ||
    projectsQuery.isLoading ||
    docsQuery.isLoading ||
    sheetsQuery.isLoading ||
    workspacesQuery.isLoading;

  // Each source is reported separately so a failed feed never silently
  // renders as "0 open / 0 overdue".
  const failures = [
    { what: "tasks", query: tasksQuery },
    { what: "projects", query: projectsQuery },
    { what: "docs", query: docsQuery },
    { what: "sheets", query: sheetsQuery },
    { what: "workspaces", query: workspacesQuery },
  ].filter((entry) => entry.query.isError);
  const tasksUnavailable = tasksQuery.isError && !tasks;

  const report = useMemo(
    () =>
      buildReportData({
        tasks: (tasks ?? []) as Task[],
        projects: (projects ?? []) as Project[],
        docs: (docs ?? []) as Doc[],
        sheets: (sheets ?? []) as Sheet[],
        workspaces: (workspaces ?? []) as Workspace[],
      }),
    [tasks, projects, docs, sheets, workspaces],
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Building report...
      </div>
    );
  }

  if (tasksUnavailable) {
    return (
      <div className="flex h-full flex-col p-8">
        <LoadError
          what="tasks for the report"
          error={tasksQuery.error}
          onRetry={() => tasksQuery.refetch()}
          retrying={tasksQuery.isFetching}
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-foreground">Report</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              A snapshot of open work, deadlines, and the links between your
              docs, sheets, tasks, and projects.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2">
            <CheckCircle2 className="size-4 text-success" />
            <div>
              <p className="text-xs text-muted-foreground">Completion</p>
              <p className="text-lg font-semibold tabular-nums text-foreground">
                {report.completionRate}%
              </p>
            </div>
            <p className="ml-2 text-xs text-muted-foreground">
              {report.completedTasks} done · {report.openTasks} open
            </p>
          </div>
        </div>

        {failures.length > 0 && (
          <div className="mt-6 flex flex-col gap-2">
            {failures.map(({ what, query }) => (
              <LoadErrorBanner
                key={what}
                what={what}
                error={query.error}
                onRetry={() => query.refetch()}
                retrying={query.isFetching}
              />
            ))}
          </div>
        )}

        <section className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {report.stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-border bg-card px-4 py-3"
            >
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {stat.label}
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-foreground">
                {stat.value}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{stat.hint}</p>
            </div>
          ))}
        </section>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
          <section className="rounded-xl border border-border bg-card p-4 xl:col-span-2">
            <SectionHeader
              icon={AlertTriangle}
              title="Overdue"
              subtitle={
                report.overdue.length === 0
                  ? "Nothing past due"
                  : `${report.overdue.length} open past their deadline or last scheduled block`
              }
            />

            {report.overdue.length === 0 ? (
              <EmptyState text="No overdue tasks. Keep it that way." />
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {report.overdue.map((item) => (
                  <DeadlineRow key={item.id} item={item} tone="danger" />
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <SectionHeader
              icon={ListTodo}
              title="Open by priority"
              subtitle={`${report.openTasks} tasks`}
            />

            {report.priorities.length === 0 ? (
              <EmptyState text="No open tasks to chart." />
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {report.priorities.map((bucket) => (
                  <li key={bucket.name}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">
                        {bucket.name}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {bucket.count}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all ${PRIORITY_TINT[bucket.name] ?? "bg-primary"}`}
                        style={{ width: `${Math.max(bucket.percent, 4)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <section className="rounded-xl border border-border bg-card p-4">
            <SectionHeader
              icon={CalendarClock}
              title="Due or planned in the next 14 days"
              subtitle={`${report.upcoming.length} upcoming · deadlines and next scheduled blocks`}
            />

            {report.upcoming.length === 0 ? (
              <EmptyState text="No deadlines or scheduled work in the next two weeks." />
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {report.upcoming.map((item) => (
                  <DeadlineRow key={item.id} item={item} tone="neutral" />
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <SectionHeader
              icon={FolderKanban}
              title="Projects with open work"
              subtitle={
                report.byProject.length === 0
                  ? "No open project tasks"
                  : "Sorted by open task count"
              }
            />

            {report.byProject.length === 0 ? (
              <EmptyState text="Open tasks aren't attached to projects yet." />
            ) : (
              <ul className="mt-3 flex flex-col gap-1.5">
                {report.byProject.map((project) => (
                  <li key={project.id}>
                    <Link
                      href={project.href}
                      className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent/50"
                    >
                      <span className="truncate text-foreground">
                        {project.name}
                      </span>
                      <span className="ml-3 shrink-0 tabular-nums text-muted-foreground">
                        {project.count}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {report.byWorkspace.length > 0 && (
              <>
                <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  By workspace
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {report.byWorkspace.map((workspace) => (
                    <li
                      key={workspace.id}
                      className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm"
                    >
                      <span className="truncate text-foreground">
                        {workspace.name}
                      </span>
                      <span className="ml-3 shrink-0 tabular-nums text-muted-foreground">
                        {workspace.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <section className="rounded-xl border border-border bg-card p-4">
            <SectionHeader
              icon={Link2}
              title="Mentions"
              subtitle={
                report.mentions.length === 0
                  ? "No @mentions yet"
                  : "Cross-links between your pages"
              }
            />

            {report.mentions.length === 0 ? (
              <EmptyState text="Type @ in a doc, sheet, task, or project description to link things together." />
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {report.mentions.map((link, index) => {
                  const FromIcon = KIND_ICON[link.from.kind];
                  const ToIcon = KIND_ICON[link.to.entityType];

                  return (
                    <li
                      key={`${link.from.id}-${link.to.id}-${index}`}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted px-2.5 py-2 text-sm"
                    >
                      <Link
                        href={link.from.href}
                        className="inline-flex min-w-0 items-center gap-1.5 text-foreground transition-colors hover:text-primary"
                      >
                        <FromIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{link.from.label}</span>
                      </Link>

                      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />

                      <Link
                        href={link.to.href}
                        className="inline-flex min-w-0 items-center gap-1.5 text-foreground transition-colors hover:text-primary"
                        data-entity-type={link.to.entityType}
                      >
                        <ToIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">@{link.to.label}</span>
                        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {MENTION_TYPE_LABELS[link.to.entityType]}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <SectionHeader
              icon={FileText}
              title="Recently updated"
              subtitle="Across tasks, projects, docs and sheets"
            />

            {report.recent.length === 0 ? (
              <EmptyState text="Nothing here yet." />
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {report.recent.map((item) => {
                  const Icon = KIND_ICON[item.kind];
                  return (
                    <li key={`${item.kind}-${item.id}`}>
                      <Link
                        href={item.href}
                        className="flex items-center gap-3 py-2.5 transition-colors hover:bg-accent/40"
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
                          <Icon className="size-3.5 text-muted-foreground" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-foreground">
                            {item.label}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {MENTION_TYPE_LABELS[item.kind]}
                            {item.hint ? ` · ${item.hint}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatReportDate(item.updatedAt)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="mt-4 text-sm text-muted-foreground">{text}</p>;
}

function DeadlineRow({
  item,
  tone,
}: {
  item: DeadlineItem;
  tone: "danger" | "neutral";
}) {
  const sourceHint =
    item.source === "deadline"
      ? null
      : item.overdue
        ? "last block ended"
        : `${taskDateSourceLabel(item.source).toLowerCase()}`;
  return (
    <li>
      <Link
        href={item.href}
        className="flex items-center gap-3 py-2.5 transition-colors hover:bg-accent/40"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">
            {item.name}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {item.projectTitle ?? "No project"}
            {item.priorityLevel ? ` · ${item.priorityLevel}` : ""}
            {sourceHint ? ` · ${sourceHint}` : ""}
          </span>
        </span>
        <span
          className={`shrink-0 text-xs tabular-nums ${
            tone === "danger" ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {formatReportDate(item.deadline)}
          <span className="ml-1 opacity-80">
            ({formatRelative(item.deadline)})
          </span>
        </span>
      </Link>
    </li>
  );
}
