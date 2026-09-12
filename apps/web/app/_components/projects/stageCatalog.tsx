"use client";

import { useState } from "react";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import type { Stage } from "@/app/_types/types";
import {
  useCreateStage,
  useDeleteStage,
  useReorderStages,
  useUpdateProject,
  useUpdateStage,
} from "@/app/utils/hooks/projects";
import { sortedStages } from "@/app/utils/stages";

export default function StageCatalog({
  projectId,
  stages,
  doesHaveStages,
}: {
  projectId: string;
  stages?: Stage[] | null;
  doesHaveStages?: boolean;
}) {
  const ordered = sortedStages(stages);
  const enable = useUpdateProject();
  const createStage = useCreateStage(projectId);
  const renameStage = useUpdateStage(projectId);
  const removeStage = useDeleteStage(projectId);
  const reorder = useReorderStages(projectId);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const enabled = Boolean(doesHaveStages);

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

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Stages</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Break the project into ordered phases and assign tasks to them.
          </p>
        </div>
        {!enabled ? (
          <button
            type="button"
            onClick={() => void enable.mutateAsync({ id: projectId, doesHaveStages: true })}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            Enable stages
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void enable.mutateAsync({ id: projectId, doesHaveStages: false })}
            className="rounded-lg bg-secondary px-3 py-1.5 text-xs text-secondary-foreground"
          >
            Disable
          </button>
        )}
      </div>

      {enabled ? (
        <div className="mt-4 space-y-2">
          {ordered.map((stage) => (
            <div
              key={stage.id}
              draggable
              onDragStart={() => setDraggingId(stage.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (draggingId) move(draggingId, stage.id);
                setDraggingId(null);
              }}
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5"
            >
              <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" />
              {editingId === stage.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => {
                    const next = draft.trim();
                    if (next && next !== stage.name) {
                      void renameStage.mutateAsync({ stageId: stage.id, name: next });
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
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{stage.name}</span>
              )}
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
          ))}

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const next = name.trim();
              if (!next) return;
              void createStage.mutateAsync(next);
              setName("");
            }}
          >
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="New stage"
              className="min-w-0 flex-1 rounded-lg border border-border bg-input/30 px-3 py-1.5 text-sm outline-none focus:border-ring"
            />
            <button
              type="submit"
              disabled={!name.trim() || createStage.isPending}
              className="inline-flex items-center gap-1 rounded-lg bg-secondary px-3 py-1.5 text-sm text-secondary-foreground disabled:opacity-50"
            >
              <Plus className="size-3.5" />
              Add
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
