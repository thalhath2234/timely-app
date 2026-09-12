"use client";

import { useMemo, useState } from "react";
import type { Label, Project, Workspace } from "@/app/_types/types";
import type { UpdateTaskPayload } from "@/app/utils/api/tasks";
import { PRIORITY_OPTIONS } from "@/app/utils/priority";
import { useBulkUpdateTasks, useDeleteTask } from "@/app/utils/hooks/tasks";
import { showUndoToast } from "@/app/_store/toastStore";
import Select from "@/app/_components/_ui/select";

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
  const bulk = useBulkUpdateTasks();
  const remove = useDeleteTask();
  const [busy, setBusy] = useState(false);

  const statuses = useMemo(
    () => workspaces.flatMap((workspace) => workspace.status ?? []),
    [workspaces],
  );
  const labels = useMemo(
    () => workspaces.flatMap((workspace) => workspace.lables ?? []),
    [workspaces],
  );

  const apply = async (update: UpdateTaskPayload, undo: UpdateTaskPayload, message: string) => {
    setBusy(true);
    try {
      await bulk.mutateAsync({ ids, update });
      showUndoToast(message, () => {
        void bulk.mutateAsync({ ids, update: undo });
      });
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
            { completedAt: "" },
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
        onClick={() => void apply({ completedAt: "" }, { completedAt: new Date().toISOString() }, "Reopened")}
        className="rounded-md bg-secondary px-2 py-1 text-xs"
      >
        Reopen
      </button>
      <div className="w-36">
        <Select
          size="sm"
          value=""
          placeholder="Status"
          onChange={(statusId) =>
            void apply({ statusId }, { statusId: "" }, "Status updated")
          }
          options={statuses.map((status) => ({
            value: status.id,
            label: status.name,
            color: status.color,
          }))}
        />
      </div>
      <div className="w-28">
        <Select
          size="sm"
          value=""
          placeholder="Priority"
          onChange={(priorityLevel) =>
            void apply({ priorityLevel }, { priorityLevel: "" }, "Priority updated")
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
            void apply({ projectId }, { projectId: "" }, "Project updated")
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
            void apply({ labelIds: [{ id: labelId }] }, { labelIds: [] }, `Labeled ${label.name}`);
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
        disabled={busy}
        onChange={(event) => {
          if (!event.target.value) return;
          void apply({ deadline: event.target.value }, { deadline: "" }, "Deadline set");
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
