"use client";

import Link from "next/link";
import { CalendarDays, Check, Flag } from "lucide-react";
import type { Task } from "@/app/_types/types";
import { formatDueDate, isOverdue, PRIORITY_META } from "@/app/_lib/mobile/format";

interface TaskCardProps {
  task: Task;
  onToggle: (task: Task) => void;
}

export default function TaskCard({ task, onToggle }: TaskCardProps) {
  const done = Boolean(task.completedAt);
  const overdue = isOverdue(task.deadline, task.completedAt);
  const due = formatDueDate(task.deadline);
  const priority = task.priorityLevel ? PRIORITY_META[task.priorityLevel] : null;

  return (
    <div className="flex items-stretch rounded-xl border border-border bg-card transition-colors active:bg-muted">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark "${task.name}" incomplete` : `Complete "${task.name}"`}
        onClick={() => onToggle(task)}
        className="flex w-12 shrink-0 items-center justify-center"
      >
        <span
          className={`flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 transition-colors ${
            done
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/50"
          }`}
        >
          {done ? <Check size={14} strokeWidth={3} /> : null}
        </span>
      </button>
      <Link
        href={`/m/tasks/${task.id}`}
        className="flex min-h-14 min-w-0 flex-1 flex-col justify-center gap-1 py-2.5 pr-3"
      >
        <p
          className={`truncate text-[15px] font-medium leading-5 ${
            done ? "text-muted-foreground line-through" : "text-card-foreground"
          }`}
        >
          {task.name}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {task.status ? (
            <span className="inline-flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: task.status.color }}
              />
              {task.status.name}
            </span>
          ) : null}
          {priority && !done ? (
            <span className={`inline-flex items-center gap-1 ${priority.className}`}>
              <Flag size={11} />
              {priority.label}
            </span>
          ) : null}
          {due ? (
            <span
              className={`inline-flex items-center gap-1 ${
                overdue ? "font-medium text-destructive" : ""
              }`}
            >
              <CalendarDays size={11} />
              {due}
            </span>
          ) : null}
          {(task.labels ?? []).length ? (
            <span className="inline-flex items-center gap-1">
              {(task.labels ?? []).slice(0, 4).map((l) => (
                <span
                  key={l.id}
                  title={l.name}
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: l.color }}
                />
              ))}
            </span>
          ) : null}
        </div>
      </Link>
    </div>
  );
}
