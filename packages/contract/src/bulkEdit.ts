import type { Label, Task, TaskLabelId, UpdateTaskPayload } from "./entities";

/**
 * Undo for bulk task edits, shared by the web bulk bar and the phone's
 * select mode. A bulk edit touches tasks that each had their own value, so
 * Undo restores each task's own previous value instead of blanking the whole
 * selection. Nullable string fields use "" to mean "clear" on the way back.
 */
export type BulkUndoField = keyof Pick<
  UpdateTaskPayload,
  "completedAt" | "statusId" | "priorityLevel" | "projectId" | "labelIds" | "deadline"
>;

/** The label ids a task carries now, from either shape the API sends. */
export function taskLabelIds(task: Pick<Task, "labels" | "labelIds">): TaskLabelId[] {
  const ids = new Set<string>();
  for (const label of task.labels ?? []) ids.add(label.id);
  for (const ref of task.labelIds ?? []) ids.add(ref.id);
  return [...ids].map((id) => ({ id }));
}

/**
 * Labels are per workspace, so a selection across workspaces sees "Deep work"
 * once per workspace. The bulk label picker lists each name once and, per
 * task, uses that workspace's label of the name.
 */
export interface NamedLabelGroup {
  key: string;
  name: string;
  color: string;
  labels: Label[];
}

const labelKey = (name: string) => name.trim().toLowerCase();

export function mergeLabelsByName(labels: Label[]): NamedLabelGroup[] {
  const groups: NamedLabelGroup[] = [];
  const byKey = new Map<string, NamedLabelGroup>();
  for (const label of labels) {
    const key = labelKey(label.name);
    if (!key) continue;
    const group = byKey.get(key);
    if (group) {
      group.labels.push(label);
      continue;
    }
    const created = { key, name: label.name.trim(), color: label.color, labels: [label] };
    byKey.set(key, created);
    groups.push(created);
  }
  return groups;
}

/**
 * The task's labels with the group's label for its workspace added, or null
 * when its workspace has no label of that name. The API replaces a task's
 * whole label set, so this is sent per task; sending just the new label would
 * wipe the labels each task already had.
 */
export function labelIdsWithNamed(
  task: Pick<Task, "labels" | "labelIds" | "workspaceId" | "workspace">,
  group: NamedLabelGroup,
): TaskLabelId[] | null {
  const workspaceId = task.workspaceId ?? task.workspace?.id;
  const label = group.labels.find((item) => item.workspaceId === workspaceId);
  if (!label) return null;
  const current = taskLabelIds(task);
  return current.some((ref) => ref.id === label.id) ? current : [...current, { id: label.id }];
}

/** Snapshot the fields a bulk edit is about to touch, per task, for Undo. */
export function bulkUndoSnapshot(tasks: Task[], fields: BulkUndoField[]): Map<string, UpdateTaskPayload> {
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
        case "labelIds":
          previous.labelIds = taskLabelIds(task);
          break;
      }
    }
    out.set(task.id, previous);
  }
  return out;
}
