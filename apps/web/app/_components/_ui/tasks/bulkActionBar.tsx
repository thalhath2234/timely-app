"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Label, Project, Task, Workspace } from "@/app/_types/types";
import type { UpdateTaskPayload } from "@/app/utils/api/tasks";
import { PRIORITY_OPTIONS } from "@/app/utils/priority";
import { mergeStatusesByName, statusForWorkspace } from "@/app/utils/status";
import { tasksKey, useBulkUpdateTasks, useDeleteTask, useUpdateTask } from "@/app/utils/hooks/tasks";
import { showUndoToast, useToastStore } from "@/app/_store/toastStore";
import Select from "@/app/_components/_ui/select";

type UndoableField = keyof Pick<
  UpdateTaskPayload,
  "completedAt" | "statusId" | "priorityLevel" | "projectId" | "labelIds" | "deadline"
>;

/**
 * Snapshot the fields a bulk update is about to touch, per task, so Undo can
 * restore each task's own previous value instead of blanking the whole
 * selection. Nullable string fields use "" to mean "clear" on the way back.
 */
function snapshotBefore(tasks: Task[], fields: UndoableField[]): Map<string, UpdateTaskPayload> {
  const out = new Map<string, UpdateTaskPayload>();
  for (const task of tasks) {
    const previous: UpdateTaskPayload = {};
    for (const field of fields) {
      switch (field) {
        case "completedAt":
          previous.completedAt = task.completedAt ?? "";
          break;
        case "statusId":
          previous.statusId = task.status?.id ?? task.statusId ?? "";
          break;
        case "priorityLevel":
          previous.priorityLevel = task.priorityLevel ?? "";
          break;
        case "projectId":
          previous.projectId = task.project?.id ?? task.projectId ?? "";
          break;
        case "deadline":
          previous.deadline = task.deadline ?? "";
          break;
        case "labelIds": {
          const ids = new Set<string>();
          for (const label of task.labels ?? []) ids.add(label.id);
          for (const ref of task.labelIds ?? []) ids.add(ref.id);
          previous.labelIds = [...ids].map((id) => ({ id }));
          break;
        }
      }
    }
    out.set(task.id, previous);
  }
  return out;
}

export default function BulkActionBar({
  ids,
  workspaces,
  projects,
  onClear,
}: {
  ids: string[];
  workspaces: Workspace[];
  projects: Project[];
  onClear: () => void;
}) {
  const queryClient = useQueryClient();
  const bulk = useBulkUpdateTasks();
  const single = useUpdateTask();
  const remove = useDeleteTask();
  const [busy, setBusy] = useState(false);

  const statuses = useMemo(
    () => workspaces.flatMap((workspace) => workspace.status ?? []),
    [workspaces],
  );
  const statusGroups = useMemo(() => mergeStatusesByName(statuses), [statuses]);
  const labels = useMemo(
    () => workspaces.flatMap((workspace) => workspace.lables ?? []),
    [workspaces],
  );

  const apply = async (update: UpdateTaskPayload, fields: UndoableField[], message: string) => {
    setBusy(true);
    try {
      const cached = (queryClient.getQueryData<Task[]>(tasksKey) ?? []).filter((task) =>
        ids.includes(task.id),
      );
      const before = snapshotBefore(cached, fields);
      const missing = ids.filter((id) => !before.has(id));

      await bulk.mutateAsync({ ids, update });

      showUndoToast(message, () => {
        // Restore each task to what *it* had; a mixed selection must not end
        // up uniform (or blank) after Undo.
        void Promise.all(
          [...before.entries()].map(([id, previous]) => single.mutateAsync({ id, ...previous })),
        )
          .then(() => {
            if (missing.length > 0) {
              useToastStore
                .getState()
                .show(
                  `Restored ${before.size} task${before.size === 1 ? "" : "s"}; ${missing.length} had no cached previous value`,
                );
            }
          })
          .catch((err: unknown) => {
            useToastStore
              .getState()
              .show(err instanceof Error ? `Undo failed: ${err.message}` : "Undo failed");
          });
      });
      onClear();
    } finally {
      setBusy(false);
    }
  };

  const applyNamedStatus = async (nameKey: string) => {
    const group = statusGroups.find((item) => item.key === nameKey);
    if (!group) return;
    setBusy(true);
    try {
      const cached = (queryClient.getQueryData<Task[]>(tasksKey) ?? []).filter((task) =>
        ids.includes(task.id),
      );
      const before = snapshotBefore(cached, ["statusId", "completedAt"]);
      const missing = ids.filter((id) => !before.has(id));
      const skipped: string[] = [];

      await Promise.all(
        cached.map((task) => {
          const workspaceId = task.workspaceId ?? task.workspace?.id;
          const status = statusForWorkspace(group, workspaceId);
          if (!status) {
            skipped.push(task.workspace?.name || task.name);
            return Promise.resolve();
          }
          return single.mutateAsync({ id: task.id, statusId: status.id });
        }),
      );

      showUndoToast(
        skipped.length
          ? `Status updated · skipped ${skipped.length} without "${group.name}"`
          : "Status updated",
        () => {
          void Promise.all(
            [...before.entries()].map(([id, previous]) => single.mutateAsync({ id, ...previous })),
          )
            .then(() => {
              if (missing.length > 0) {
                useToastStore
                  .getState()
                  .show(
                    `Restored ${before.size} task${before.size === 1 ? "" : "s"}; ${missing.length} had no cached previous value`,
                  );
              }
            })
            .catch((err: unknown) => {
              useToastStore
                .getState()
                .show(err instanceof Error ? `Undo failed: ${err.message}` : "Undo failed");
            });
        },
      );
      onClear();
    } finally {
      setBusy(false);
    }
  };

  if (ids.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/50 px-4 py-2 text-sm">
      <span className="font-medium text-foreground">{ids.length} selected</span>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void apply(
            { completedAt: new Date().toISOString() },
            ["completedAt", "statusId"],
            "Marked complete",
          )
        }
        className="rounded-md bg-foreground px-2 py-1 text-xs text-background"
      >
        Complete
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void apply({ completedAt: "" }, ["completedAt", "statusId"], "Reopened")}
        className="rounded-md bg-secondary px-2 py-1 text-xs"
      >
        Reopen
      </button>
      <div className="w-36">
        <Select
          size="sm"
          value=""
          placeholder="Status"
          onChange={(nameKey) => void applyNamedStatus(nameKey)}
          options={statusGroups.map((group) => ({
            value: group.key,
            label: group.name,
            color: group.color,
          }))}
        />
      </div>
      <div className="w-28">
        <Select
          size="sm"
          value=""
          placeholder="Priority"
          onChange={(priorityLevel) =>
            void apply({ priorityLevel }, ["priorityLevel"], "Priority updated")
          }
          options={PRIORITY_OPTIONS}
        />
      </div>
      <div className="w-40">
        <Select
          size="sm"
          value=""
          placeholder="Project"
          onChange={(projectId) =>
            void apply({ projectId }, ["projectId"], "Project updated")
          }
          options={[
            { value: "", label: "No project" },
            ...projects.map((project) => ({ value: project.id, label: project.title })),
          ]}
        />
      </div>
      <div className="w-36">
        <Select
          size="sm"
          value=""
          placeholder="Set label"
          onChange={(labelId) => {
            const label = labels.find((item: Label) => item.id === labelId);
            if (!label) return;
            void apply({ labelIds: [{ id: labelId }] }, ["labelIds"], `Labeled ${label.name}`);
          }}
          options={labels.map((label) => ({
            value: label.id,
            label: label.name,
            color: label.color,
          }))}
        />
      </div>
      <input
        type="date"
        aria-label="Set deadline for selected tasks"
        title="Set deadline"
        disabled={busy}
        onChange={(event) => {
          if (!event.target.value) return;
          void apply({ deadline: event.target.value }, ["deadline"], "Deadline set");
          event.target.value = "";
        }}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs"
      />
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm(`Delete ${ids.length} task${ids.length === 1 ? "" : "s"}?`)) return;
          setBusy(true);
          try {
            for (const id of ids) {
              await remove.mutateAsync(id);
            }
            onClear();
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
      >
        Delete
      </button>
      <button type="button" onClick={onClear} className="ml-auto text-xs text-muted-foreground">
        Clear
      </button>
    </div>
  );
}
