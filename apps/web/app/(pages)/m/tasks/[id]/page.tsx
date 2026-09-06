"use client";

import { use, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Check,
  ChevronRight,
  CircleDot,
  Clock,
  Flag,
  FolderKanban,
  Tag,
  Trash2,
} from "lucide-react";
import MobileHeader from "@/app/_components/mobile/MobileHeader";
import BottomSheet, { SheetOption } from "@/app/_components/mobile/BottomSheet";
import DateTimeSheet from "@/app/_components/mobile/DateTimeSheet";
import EmptyState from "@/app/_components/mobile/EmptyState";
import {
  useMobileBlockScheduler,
  useMobileProjects,
  useMobileTask,
  useMobileTaskSaver,
  useMobileWorkspaces,
} from "@/app/_lib/mobile/useMobileData";
import { useDemoStore } from "@/app/_lib/mobile/demoStore";
import { useDeleteTask } from "@/app/utils/hooks/tasks";
import {
  formatDuration,
  formatShortDate,
  formatTimeRange,
  formatRelativeDay,
  isOverdue,
  PRIORITY_META,
} from "@/app/_lib/mobile/format";
import type { ScheduledBlock } from "@/app/_types/types";

type Picker =
  | { kind: "status" }
  | { kind: "priority" }
  | { kind: "due" }
  | { kind: "project" }
  | { kind: "schedule" }
  | { kind: "block"; block: ScheduledBlock }
  | null;

function Row({
  icon,
  label,
  value,
  onClick,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  onClick?: () => void;
  tone?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex min-h-12 w-full items-center gap-3 px-4 text-left active:bg-muted disabled:active:bg-transparent"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="w-20 shrink-0 text-[13px] text-muted-foreground">{label}</span>
      <span className={`min-w-0 flex-1 truncate text-[15px] ${tone ?? "text-foreground"}`}>
        {value}
      </span>
      {onClick ? <ChevronRight size={16} className="text-muted-foreground/60" /> : null}
    </button>
  );
}

export default function MobileTaskDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: task, isDemo, isLoading } = useMobileTask(id);
  const { data: workspaces } = useMobileWorkspaces();
  const { data: projects } = useMobileProjects();
  const save = useMobileTaskSaver(isDemo);
  const deleteTask = useDeleteTask();
  const removeDemoTask = useDemoStore((s) => s.removeTask);
  const [picker, setPicker] = useState<Picker>(null);
  const scheduler = useMobileBlockScheduler(isDemo);

  if (!task) {
    return (
      <>
        <MobileHeader title="Task" backHref="/m/tasks" large={false} />
        <main className="flex-1">
          {isLoading ? null : (
            <EmptyState icon={CircleDot} title="Task not found" description="It may have been deleted." />
          )}
        </main>
      </>
    );
  }

  const workspace = workspaces.find((w) => w.id === task.workspaceId) ?? task.workspace ?? null;
  const statuses = workspace?.status ?? [];
  const status = statuses.find((s) => s.id === task.statusId) ?? task.status ?? null;
  const project = projects.find((p) => p.id === task.projectId) ?? task.project ?? null;
  const done = Boolean(task.completedAt);
  const overdue = isOverdue(task.deadline, task.completedAt);
  const priority = task.priorityLevel ? PRIORITY_META[task.priorityLevel] : null;
  const workspaceProjects = projects.filter((p) => p.workspaceId === task.workspaceId);

  function setDue(next: Date | null) {
    save(task!.id, { deadline: next ? next.toISOString() : null });
  }

  function remove() {
    if (isDemo) removeDemoTask(task!.id);
    else deleteTask.mutate(task!.id);
    router.push("/m/tasks");
  }

  return (
    <>
      <MobileHeader
        title={project?.title ?? workspace?.name ?? "Task"}
        backHref="/m/tasks"
        large={false}
        isDemo={isDemo}
        actions={
          <button
            type="button"
            onClick={() =>
              save(task.id, { completedAt: done ? null : new Date().toISOString() })
            }
            className={`mr-2 flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-colors ${
              done ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground"
            }`}
          >
            <Check size={15} strokeWidth={3} />
            {done ? "Done" : "Complete"}
          </button>
        }
      />

      <main className="min-h-0 flex-1 overflow-y-auto pb-10">
        <div className="px-4 pt-5 pb-3">
          <textarea
            key={task.id}
            defaultValue={task.name}
            rows={1}
            aria-label="Task name"
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name && name !== task.name) save(task.id, { name });
            }}
            className={`w-full resize-none bg-transparent text-[24px] font-semibold leading-tight tracking-tight outline-none field-sizing-content ${
              done ? "text-muted-foreground line-through" : "text-foreground"
            }`}
          />
          <div className="mt-1 flex flex-wrap gap-1.5">
            {(task.labels ?? []).map((l) => (
              <span
                key={l.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs text-foreground"
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: l.color }} />
                {l.name}
              </span>
            ))}
          </div>
        </div>

        <section className="mx-3 overflow-hidden rounded-2xl border border-border bg-card">
          <Row
            icon={<CircleDot size={18} />}
            label="Status"
            onClick={statuses.length ? () => setPicker({ kind: "status" }) : undefined}
            value={
              status ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: status.color }} />
                  {status.name}
                </span>
              ) : (
                <span className="text-muted-foreground">None</span>
              )
            }
          />
          <div className="mx-4 h-px bg-border" />
          <Row
            icon={<Flag size={18} />}
            label="Priority"
            onClick={() => setPicker({ kind: "priority" })}
            tone={priority?.className}
            value={priority?.label ?? <span className="text-muted-foreground">None</span>}
          />
          <div className="mx-4 h-px bg-border" />
          <Row
            icon={<CalendarDays size={18} />}
            label="Due"
            onClick={() => setPicker({ kind: "due" })}
            tone={overdue ? "text-destructive font-medium" : undefined}
            value={
              task.deadline ? (
                `${formatRelativeDay(new Date(task.deadline))} · ${new Date(task.deadline).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}${overdue ? " · overdue" : ""}`
              ) : (
                <span className="text-muted-foreground">No date</span>
              )
            }
          />
          <div className="mx-4 h-px bg-border" />
          <Row
            icon={<FolderKanban size={18} />}
            label="Project"
            onClick={workspaceProjects.length ? () => setPicker({ kind: "project" }) : undefined}
            value={
              project ? (
                <span className="inline-flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: project.color ?? "var(--muted-foreground)" }}
                  />
                  {project.title}
                </span>
              ) : (
                <span className="text-muted-foreground">None</span>
              )
            }
          />
          <div className="mx-4 h-px bg-border" />
          <Row
            icon={<Clock size={18} />}
            label="Duration"
            value={formatDuration(task.duration) ?? <span className="text-muted-foreground">Not set</span>}
          />
          <div className="mx-4 h-px bg-border" />
          <Row
            icon={<Tag size={18} />}
            label="Workspace"
            value={workspace?.name ?? <span className="text-muted-foreground">—</span>}
          />
        </section>

        <section className="mx-3 mt-4">
          <div className="flex items-center justify-between px-1 pb-2">
            <h2 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              Scheduled
            </h2>
            <button
              type="button"
              onClick={() => setPicker({ kind: "schedule" })}
              className="text-[13px] font-medium text-primary"
            >
              + Add time
            </button>
          </div>
          {task.blocks && task.blocks.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {task.blocks.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => setPicker({ kind: "block", block: b })}
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left active:bg-muted"
                  >
                    <span
                      className="h-8 w-1 rounded-full"
                      style={{ backgroundColor: project?.color ?? "var(--primary)" }}
                    />
                    <div className="flex-1">
                      <p className="text-[14px] text-card-foreground">
                        {formatRelativeDay(new Date(b.start))}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatTimeRange(b.start, b.end)} · {b.source === "engine" ? "auto" : "manual"}
                      </p>
                    </div>
                    <ChevronRight size={16} className="text-muted-foreground/60" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-border px-3 py-3 text-center text-[13px] text-muted-foreground">
              Not on the calendar yet.
            </p>
          )}
        </section>

        <section className="mx-3 mt-4">
          <h2 className="px-1 pb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
            Notes
          </h2>
          <textarea
            key={`${task.id}-desc`}
            defaultValue={task.description}
            placeholder="Add notes…"
            rows={5}
            aria-label="Notes"
            onBlur={(e) => {
              const description = e.target.value;
              if (description !== task.description) save(task.id, { description });
            }}
            className="w-full resize-none rounded-2xl border border-border bg-card px-4 py-3 text-[15px] leading-relaxed text-card-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
          />
        </section>

        <div className="mx-3 mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={remove}
            className="flex h-12 items-center justify-center gap-2 rounded-xl border border-destructive/30 text-[15px] font-medium text-destructive active:bg-destructive/10"
          >
            <Trash2 size={16} />
            Delete task
          </button>
          <p className="text-center text-xs text-muted-foreground">
            Created {formatShortDate(task.createdAt)}
          </p>
        </div>
      </main>

      <BottomSheet open={picker?.kind === "status"} onClose={() => setPicker(null)} title="Status">
        {statuses.map((s) => (
          <SheetOption
            key={s.id}
            selected={s.id === task.statusId}
            onSelect={() => {
              save(task.id, { statusId: s.id, status: s });
              setPicker(null);
            }}
            leading={<span className="h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} />}
          >
            {s.name}
          </SheetOption>
        ))}
      </BottomSheet>

      <BottomSheet open={picker?.kind === "priority"} onClose={() => setPicker(null)} title="Priority">
        {Object.entries(PRIORITY_META).map(([value, meta]) => (
          <SheetOption
            key={value}
            selected={value === task.priorityLevel}
            onSelect={() => {
              save(task.id, { priorityLevel: value });
              setPicker(null);
            }}
            leading={<Flag size={16} className={meta.className} />}
          >
            {meta.label}
          </SheetOption>
        ))}
        <SheetOption
          selected={!task.priorityLevel}
          onSelect={() => {
            save(task.id, { priorityLevel: null });
            setPicker(null);
          }}
          leading={<Flag size={16} className="text-muted-foreground/50" />}
        >
          No priority
        </SheetOption>
      </BottomSheet>

      <DateTimeSheet
        open={picker?.kind === "due"}
        onClose={() => setPicker(null)}
        title="Due date"
        value={task.deadline ? new Date(task.deadline) : null}
        onChange={setDue}
        mode="datetime"
        clearable
      />

      <DateTimeSheet
        open={picker?.kind === "schedule"}
        onClose={() => setPicker(null)}
        title={`Schedule · ${formatDuration(task.duration) ?? "1h"}`}
        value={null}
        onChange={(start) => {
          if (start) void scheduler.scheduleTask(task.id, start, task.duration || 60);
        }}
        mode="datetime"
      />

      <DateTimeSheet
        open={picker?.kind === "block"}
        onClose={() => setPicker(null)}
        title="Move block"
        value={picker?.kind === "block" ? new Date(picker.block.start) : null}
        onChange={(start) => {
          if (!start || picker?.kind !== "block") return;
          const b = picker.block;
          const duration = new Date(b.end).getTime() - new Date(b.start).getTime();
          void scheduler.moveBlock(b.id, start, duration);
        }}
        mode="datetime"
      />

      <BottomSheet open={picker?.kind === "project"} onClose={() => setPicker(null)} title="Project">
        {workspaceProjects.map((p) => (
          <SheetOption
            key={p.id}
            selected={p.id === task.projectId}
            onSelect={() => {
              save(task.id, { projectId: p.id, project: p });
              setPicker(null);
            }}
            leading={
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: p.color ?? "var(--muted-foreground)" }}
              />
            }
          >
            {p.title}
          </SheetOption>
        ))}
        <SheetOption
          selected={!task.projectId}
          onSelect={() => {
            save(task.id, { projectId: null, project: null });
            setPicker(null);
          }}
          leading={<span className="h-3 w-3 rounded-full border border-muted-foreground/50" />}
        >
          No project
        </SheetOption>
      </BottomSheet>
    </>
  );
}
