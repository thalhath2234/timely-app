"use client";

import { requestConfirm } from "@/app/_store/confirmStore";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Project, Task, Workspace } from "@/app/_types/types";
import type { UpdateTaskPayload } from "@/app/utils/api/tasks";
import { PRIORITY_OPTIONS } from "@/app/utils/priority";
import { mergeStatusesByName, statusForWorkspace } from "@/app/utils/status";
import { tasksKey, useBulkUpdateTasks, useDeleteTask, useUpdateTask } from "@/app/utils/hooks/tasks";
import { showUndoToast, useToastStore } from "@/app/_store/toastStore";
import Select from "@/app/_components/_ui/select";
import DatePicker from "@/app/_components/_ui/datePicker";
import { AnimatePresence, motion } from "motion/react";
import {
  bulkUndoSnapshot,
  labelIdsWithNamed,
  mergeLabelsByName,
  type BulkUndoField,
} from "@timely/contract/bulkEdit";
import { springSoft } from "@/app/_components/_ui/motion";
import { buttonClass } from "@/app/_components/_ui/button";

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
  const labelGroups = useMemo(
    () => mergeLabelsByName(workspaces.flatMap((workspace) => workspace.lables ?? [])),
    [workspaces],
  );

  // `update` is either one patch for the whole selection, or a per-task patch
  // (adding a label keeps each task's own labels, so it can't be one patch);
  // a per-task patch of null skips that task.
  const apply = async (
    update: UpdateTaskPayload | ((task: Task) => UpdateTaskPayload | null),
    fields: BulkUndoField[],
    message: string | ((skipped: number) => string),
  ) => {
    setBusy(true);
    try {
      const cached = (queryClient.getQueryData<Task[]>(tasksKey) ?? []).filter((task) =>
        ids.includes(task.id),
      );
      const before = bulkUndoSnapshot(cached, fields);
      const missing = ids.filter((id) => !before.has(id));

      let skipped = 0;
      if (typeof update === "function") {
        await Promise.all(
          cached.map((task) => {
            const patch = update(task);
            if (!patch) {
              skipped += 1;
              before.delete(task.id);
              return Promise.resolve();
            }
            return single.mutateAsync({ id: task.id, ...patch });
          }),
        );
      } else {
        await bulk.mutateAsync({ ids, update });
      }

      showUndoToast(typeof message === "function" ? message(skipped) : message, () => {
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
      const before = bulkUndoSnapshot(cached, ["statusId", "completedAt"]);
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

  return (
    <AnimatePresence>
      {ids.length === 0 ? null : (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={springSoft}
          className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/50 px-4 py-2 text-sm"
        >
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
        className={buttonClass({ variant: "secondary", size: "sm" })}
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
          onChange={(key) => {
            const group = labelGroups.find((item) => item.key === key);
            if (!group) return;
            void apply(
              (task) => {
                const labelIds = labelIdsWithNamed(task, group);
                return labelIds ? { labelIds } : null;
              },
              ["labelIds"],
              (skipped) =>
                skipped
                  ? `Labeled ${group.name} · skipped ${skipped} without that label`
                  : `Labeled ${group.name}`,
            );
          }}
          options={labelGroups.map((group) => ({
            value: group.key,
            label: group.name,
            color: group.color,
          }))}
        />
      </div>
      <div className="w-36">
        <DatePicker
          size="sm"
          value=""
          placeholder="Set deadline"
          aria-label="Set deadline for selected tasks"
          clearable={false}
          disabled={busy}
          onChange={(value) => {
            if (!value) return;
            void apply({ deadline: value }, ["deadline"], "Deadline set");
          }}
        />
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          requestConfirm({
            title: `Delete ${ids.length} task${ids.length === 1 ? "" : "s"}?`,
            confirmLabel: "Delete",
            pendingLabel: "Deleting…",
            onConfirm: async () => {
              setBusy(true);
              try {
                for (const id of ids) {
                  await remove.mutateAsync(id);
                }
                onClear();
              } finally {
                setBusy(false);
              }
            },
          })
        }
        className="rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
      >
        Delete
      </button>
      <button type="button" onClick={onClear} className="ml-auto text-xs text-muted-foreground">
        Clear
      </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
