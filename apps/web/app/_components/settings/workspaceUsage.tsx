"use client";

import { useMemo } from "react";
import { Tags } from "lucide-react";
import { RailEmpty, RailRow, RailRows, RailSection } from "@/app/_components/_ui/pageWithRail";
import { useTasks } from "@/app/utils/hooks/tasks";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";
import type { Task, Workspace } from "@/app/_types/types";

/** How many open tasks use each status, label and custom field of the
 * workspace being edited, so a rename or delete is made knowing its reach. */
export default function WorkspaceUsage({ workspaceId }: { workspaceId: string | null }) {
  const { data: workspaces } = useWorkspaces();
  const { data: tasks } = useTasks();
  const list = (workspaces ?? []) as Workspace[];
  const workspace = list.find((item) => item.id === workspaceId) ?? list[0];

  const usage = useMemo(() => {
    if (!workspace) return null;
    const scoped = ((tasks ?? []) as Task[]).filter((task) => task.workspaceId === workspace.id && !task.completedAt);
    const byStatus = new Map<string, number>();
    const byLabel = new Map<string, number>();
    for (const task of scoped) {
      if (task.statusId) byStatus.set(task.statusId, (byStatus.get(task.statusId) ?? 0) + 1);
      for (const label of task.labels ?? []) byLabel.set(label.id, (byLabel.get(label.id) ?? 0) + 1);
    }
    return {
      open: scoped.length,
      statuses: (workspace.status ?? []).map((status) => ({ ...status, count: byStatus.get(status.id) ?? 0 })),
      labels: (workspace.lables ?? [])
        .map((label) => ({ ...label, count: byLabel.get(label.id) ?? 0 }))
        .sort((a, b) => b.count - a.count),
      fields: workspace.customFields ?? [],
    };
  }, [workspace, tasks]);

  if (!workspace || !usage) return null;

  return (
    <RailSection
      title={workspace.name}
      icon={<span aria-hidden className="size-2.5 rounded-full" style={{ backgroundColor: workspace.color }} />}
      meta={`${usage.open} open task${usage.open === 1 ? "" : "s"}`}
      data-testid="workspace-usage"
    >
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Statuses</h3>
      {usage.statuses.length === 0 ? (
        <RailEmpty>No statuses yet.</RailEmpty>
      ) : (
        <RailRows>
          {usage.statuses.map((status) => (
            <RailRow key={status.id} label={status.name} meta={status.isDefault ? "Default for new tasks" : undefined} color={status.color} value={status.count} />
          ))}
        </RailRows>
      )}
      <h3 className="mb-1 mt-4 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Tags className="size-3" /> Labels
      </h3>
      {usage.labels.length === 0 ? (
        <RailEmpty>No labels yet.</RailEmpty>
      ) : (
        <RailRows>
          {usage.labels.slice(0, 8).map((label) => (
            <RailRow key={label.id} label={label.name} color={label.color} value={label.count} />
          ))}
          {usage.labels.length > 8 ? <RailRow label={`${usage.labels.length - 8} more`} tone="muted" /> : null}
        </RailRows>
      )}
      <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Custom fields</h3>
      {usage.fields.length === 0 ? (
        <RailEmpty>No custom fields yet.</RailEmpty>
      ) : (
        <RailRows>
          {usage.fields.map((field) => (
            <RailRow key={field.id} label={field.name} />
          ))}
        </RailRows>
      )}
    </RailSection>
  );
}
