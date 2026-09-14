"use client";

import { useMemo, useState } from "react";
import { GripVertical, ListTodo, Pencil, Plus, Trash2 } from "lucide-react";
import ColorPicker from "@/app/_components/_ui/colorPicker";
import type { Stage, Task } from "@/app/_types/types";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import {
  useCreateStage,
  useDeleteStage,
  useReorderStages,
  useUpdateProject,
  useUpdateStage,
} from "@/app/utils/hooks/projects";
import { colorForIndex, progressStyle, resolvedColor } from "@/app/utils/entityColor";
import { sortedStages, stageCode } from "@/app/utils/stages";

function stageProgress(tasks: Task[], stageId: string) {
  const items = tasks.filter((task) => task.stageId === stageId);
  const completed = items.filter((task) => task.completedAt).length;
  const total = items.length;
  return {
    total,
    completed,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

export default function StageCatalog({
  projectId,
  workspaceId,
  stages,
  tasks,
  doesHaveStages,
}: {
  projectId: string;
  workspaceId?: string;
  stages?: Stage[] | null;
  tasks: Task[];
  doesHaveStages?: boolean;
}) {
  const ordered = sortedStages(stages);
  const enable = useUpdateProject();
  const createStage = useCreateStage(projectId);
  const updateStage = useUpdateStage(projectId);
  const removeStage = useDeleteStage(projectId);
  const reorder = useReorderStages(projectId);
  const setAddNewMode = useSidebarStore((state) => state.setAddNewMode);
  const setIsAddItemModalOpen = useSidebarStore((state) => state.setIsAddItemModalOpen);
  const setCreateTaskDraft = useSidebarStore((state) => state.setCreateTaskDraft);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const enabled = Boolean(doesHaveStages);
  const nextColor = useMemo(() => colorForIndex(ordered.length), [ordered.length]);

  const move = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const ids = ordered.map((stage) => stage.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void reorder.mutateAsync(next);
  };

  const addTask = (stageId?: string) => {
    setCreateTaskDraft({
      workspaceId,
      projectId,
      stageId,
    });
    setAddNewMode("task");
    setIsAddItemModalOpen(true);
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Stages &amp; Milestones
            <span className="ml-2 font-normal text-muted-foreground">
              — Release phases and ordered task execution
            </span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Define linear deliverables, track milestone velocity, and assign incoming backlog.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!enabled ? (
            <button
              type="button"
              onClick={() => void enable.mutateAsync({ id: projectId, doesHaveStages: true })}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              Enable stages
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void enable.mutateAsync({ id: projectId, doesHaveStages: false })}
                className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs text-secondary-foreground"
              >
                Disable
              </button>
            </>
          )}
        </div>
      </div>

      {enabled ? (
        <div className="mt-4 space-y-2">
          {ordered.map((stage, index) => {
            const color = resolvedColor(stage.color, undefined, index);
            const progress = stageProgress(tasks, stage.id);
            return (
              <div
                key={stage.id}
                draggable
                onDragStart={() => setDraggingId(stage.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggingId) move(draggingId, stage.id);
                  setDraggingId(null);
                }}
                className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-2"
              >
                <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" />
                <ColorPicker
                  size="sm"
                  value={color}
                  onChange={(next) =>
                    void updateStage.mutateAsync({ stageId: stage.id, color: next })
                  }
                  aria-label={`${stage.name} color`}
                />
                <span
                  className="inline-flex min-w-8 shrink-0 items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
                  style={{
                    backgroundColor: `color-mix(in oklab, ${color} 22%, var(--card))`,
                    color,
                  }}
                >
                  {stageCode(stage.name, index)}
                </span>
                {editingId === stage.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => {
                      const next = draft.trim();
                      if (next && next !== stage.name) {
                        void updateStage.mutateAsync({ stageId: stage.id, name: next });
                      }
                      setEditingId(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") setEditingId(null);
                    }}
                    className="min-w-0 flex-1 rounded-md border border-border bg-input/30 px-2 py-1 text-sm outline-none"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {stage.name}
                  </span>
                )}
                <div className="hidden min-w-40 items-center gap-2 sm:flex">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-[width]"
                      style={{
                        width: `${progress.percent}%`,
                        ...progressStyle(color),
                      }}
                    />
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {progress.completed}/{progress.total} ({progress.percent}%)
                  </span>
                </div>
                <button
                  type="button"
                  title="Add task"
                  onClick={() => addTask(stage.id)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Plus className="size-3.5" />
                </button>
                <button
                  type="button"
                  title="Rename"
                  onClick={() => {
                    setEditingId(stage.id);
                    setDraft(stage.name);
                  }}
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  title="Delete"
                  onClick={() => {
                    if (!window.confirm(`Delete stage “${stage.name}”? Tasks in it become unstaged.`)) {
                      return;
                    }
                    void removeStage.mutateAsync(stage.id);
                  }}
                  className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}

          {ordered.length === 0 ? (
            <p className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
              <ListTodo className="size-3.5" />
              Add a first stage to start sequencing this project.
            </p>
          ) : null}

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const next = name.trim();
              if (!next) return;
              void createStage.mutateAsync({ name: next, color: nextColor });
              setName("");
            }}
          >
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Create new release stage (e.g. R6 — Polish & Billing)…"
              className="min-w-0 flex-1 rounded-lg border border-border bg-input/30 px-3 py-1.5 text-sm outline-none focus:border-ring"
            />
            <button
              type="submit"
              disabled={!name.trim() || createStage.isPending}
              className="inline-flex items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-sm text-secondary-foreground disabled:opacity-50"
            >
              <Plus className="size-3.5" />
              Add Stage
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
