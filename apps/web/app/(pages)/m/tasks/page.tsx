"use client";

import { useMemo, useState } from "react";
import { ListTodo, Search, X } from "lucide-react";
import MobileHeader, { HeaderIconButton } from "@/app/_components/mobile/MobileHeader";
import TaskFilterBar, { type TaskFilter } from "@/app/_components/mobile/tasks/TaskFilterBar";
import TaskCard from "@/app/_components/mobile/tasks/TaskCard";
import EmptyState from "@/app/_components/mobile/EmptyState";
import {
  useMobileTaskSaver,
  useMobileTasks,
  useMobileWorkspaces,
} from "@/app/_lib/mobile/useMobileData";
import { addDays, isOverdue, isSameDay, PRIORITY_ORDER, startOfDay } from "@/app/_lib/mobile/format";
import type { Task } from "@/app/_types/types";

function matchesFilter(task: Task, filter: TaskFilter) {
  const done = Boolean(task.completedAt);
  if (filter === "done") return done;
  if (done) return false;
  if (filter === "all") return true;
  const deadline = task.deadline ? new Date(task.deadline) : null;
  const today = new Date();
  switch (filter) {
    case "today":
      return Boolean(deadline && isSameDay(deadline, today));
    case "overdue":
      return isOverdue(task.deadline, task.completedAt);
    case "upcoming":
      return Boolean(
        deadline &&
          startOfDay(deadline) > startOfDay(today) &&
          deadline <= addDays(startOfDay(today), 14),
      );
    case "nodate":
      return !deadline;
  }
  return true;
}

function sortTasks(a: Task, b: Task) {
  const pa = a.priorityLevel ? PRIORITY_ORDER.indexOf(a.priorityLevel) : 9;
  const pb = b.priorityLevel ? PRIORITY_ORDER.indexOf(b.priorityLevel) : 9;
  if (a.deadline && b.deadline && a.deadline !== b.deadline) {
    return a.deadline < b.deadline ? -1 : 1;
  }
  if (a.deadline && !b.deadline) return -1;
  if (!a.deadline && b.deadline) return 1;
  return pa - pb;
}

export default function MobileTasksPage() {
  const { data: tasks, isDemo } = useMobileTasks();
  const { data: workspaces } = useMobileWorkspaces();
  const save = useMobileTaskSaver(isDemo);

  const [filter, setFilter] = useState<TaskFilter>("all");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const scoped = useMemo(
    () => tasks.filter((t) => (workspaceId ? t.workspaceId === workspaceId : true)),
    [tasks, workspaceId],
  );

  const counts = useMemo(
    () => ({
      today: scoped.filter((t) => matchesFilter(t, "today")).length,
      overdue: scoped.filter((t) => matchesFilter(t, "overdue")).length,
    }),
    [scoped],
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = scoped
      .filter((t) => matchesFilter(t, filter))
      .filter((t) => (q ? t.name.toLowerCase().includes(q) : true))
      .sort(sortTasks);

    const map = new Map<string, { title: string; color: string | null; tasks: Task[] }>();
    for (const t of visible) {
      const key = t.projectId ?? `ws:${t.workspaceId}`;
      if (!map.has(key)) {
        map.set(key, {
          title: t.project?.title ?? `${t.workspace?.name ?? "Tasks"} · no project`,
          color: t.project?.color ?? null,
          tasks: [],
        });
      }
      map.get(key)!.tasks.push(t);
    }
    return [...map.values()];
  }, [scoped, filter, query]);

  function toggle(task: Task) {
    save(task.id, {
      completedAt: task.completedAt ? null : new Date().toISOString(),
    });
  }

  const openCount = scoped.filter((t) => !t.completedAt).length;

  return (
    <>
      <MobileHeader
        title="Tasks"
        subtitle={`${openCount} open`}
        isDemo={isDemo}
        actions={
          <HeaderIconButton
            label={searchOpen ? "Close search" : "Search"}
            active={searchOpen}
            onClick={() => {
              setSearchOpen((v) => !v);
              setQuery("");
            }}
          >
            {searchOpen ? <X size={20} /> : <Search size={20} />}
          </HeaderIconButton>
        }
      >
        {searchOpen ? (
          <div className="px-3 pb-3">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tasks"
              aria-label="Search tasks"
              className="h-11 w-full rounded-xl border border-input bg-card px-4 text-[16px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
            />
          </div>
        ) : null}
        <TaskFilterBar
          filter={filter}
          onFilter={setFilter}
          workspaces={workspaces}
          workspaceId={workspaceId}
          onWorkspace={setWorkspaceId}
          counts={counts}
        />
      </MobileHeader>

      <main className="min-h-0 flex-1 overflow-y-auto pb-28">
        {groups.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title={filter === "done" ? "Nothing completed yet" : "All clear"}
            description={
              query
                ? "No tasks match your search."
                : "Tap the + button to capture something new."
            }
          />
        ) : (
          groups.map((group) => (
            <section key={group.title} className="px-3">
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-background/95 px-1 pt-4 pb-2 backdrop-blur">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: group.color ?? "var(--muted-foreground)" }}
                />
                <h2 className="text-[13px] font-semibold text-foreground">{group.title}</h2>
                <span className="text-xs text-muted-foreground">{group.tasks.length}</span>
              </div>
              <ul className="flex flex-col gap-2">
                {group.tasks.map((task) => (
                  <li key={task.id}>
                    <TaskCard task={task} onToggle={toggle} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </main>
    </>
  );
}
