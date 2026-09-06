"use client";

import type { Workspace } from "@/app/_types/types";

export type TaskFilter = "all" | "today" | "overdue" | "upcoming" | "nodate" | "done";

const FILTERS: { value: TaskFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "today", label: "Today" },
  { value: "overdue", label: "Overdue" },
  { value: "upcoming", label: "Upcoming" },
  { value: "nodate", label: "No date" },
  { value: "done", label: "Done" },
];

interface TaskFilterBarProps {
  filter: TaskFilter;
  onFilter: (f: TaskFilter) => void;
  workspaces: Workspace[];
  workspaceId: string | null;
  onWorkspace: (id: string | null) => void;
  counts: Partial<Record<TaskFilter, number>>;
}

export default function TaskFilterBar({
  filter,
  onFilter,
  workspaces,
  workspaceId,
  onWorkspace,
  counts,
}: TaskFilterBarProps) {
  return (
    <div className="flex flex-col gap-2 pb-3">
      <div className="flex gap-2 overflow-x-auto px-3 scrollbar-none" role="tablist" aria-label="Filter">
        {FILTERS.map((f) => {
          const active = f.value === filter;
          const count = counts[f.value];
          return (
            <button
              key={f.value}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => onFilter(f.value)}
              className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground active:bg-muted"
              }`}
            >
              {f.label}
              {count ? (
                <span
                  className={`rounded-full px-1.5 text-[11px] ${
                    active ? "bg-primary-foreground/20" : "bg-muted"
                  }`}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {workspaces.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto px-3 scrollbar-none" aria-label="Workspace">
          <button
            type="button"
            onClick={() => onWorkspace(null)}
            className={`h-7 shrink-0 rounded-md px-2.5 text-xs font-medium ${
              workspaceId === null ? "bg-accent text-accent-foreground" : "text-muted-foreground"
            }`}
          >
            All workspaces
          </button>
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => onWorkspace(w.id)}
              className={`h-7 shrink-0 rounded-md px-2.5 text-xs font-medium ${
                workspaceId === w.id ? "bg-accent text-accent-foreground" : "text-muted-foreground"
              }`}
            >
              {w.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
