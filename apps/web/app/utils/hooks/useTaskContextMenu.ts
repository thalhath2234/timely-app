"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CalendarPlus,
  Check,
  Circle,
  Copy,
  CopyCheck,
  Flag,
  Folder,
  Link2,
  Play,
  RotateCcw,
  Square,
  SquarePen,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import type { Label, Project, Task, Workspace } from "@/app/_types/types";
import type { UpdateTaskPayload } from "@/app/utils/api/tasks";
import { addDays, dateOnly, localDateStamp } from "@/app/utils/calendar";
import { PRIORITIES } from "@/app/utils/priority";
import { priorityColor } from "@/app/utils/priority";
import { isCompletedStatus, mergeStatusesByName, statusForWorkspace } from "@/app/utils/status";
import { openTasksEntity } from "@/app/utils/entityDetail";
import {
  tasksKey,
  useBulkUpdateTasks,
  useDeleteTask,
  useDuplicateTask,
  useSetTodayFocus,
  useStartFocus,
  useStopFocus,
  useUpdateTask,
} from "@/app/utils/hooks/tasks";
import { useProjects } from "@/app/utils/hooks/projects";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";
import { showUndoToast, useToastStore } from "@/app/_store/toastStore";
import { requestConfirm } from "@/app/_store/confirmStore";
import { tidyEntries, type ContextMenuEntry } from "@/app/_store/contextMenuStore";

export type TaskMenuSection = "open" | "focus" | "fields" | "schedule" | "clipboard" | "delete";

export type TaskMenuOptions = {
  /** Ids currently ticked on the surface. A right-click inside a multi-row
   * selection acts on the whole selection, matching file-manager behaviour. */
  selectedIds?: string[];
  /** Sections this surface has no room or no use for. */
  omit?: TaskMenuSection[];
  /** Extra rows appended before the delete section (stage pickers, etc.). */
  extra?: ContextMenuEntry[];
  /** Called after a delete so the surface can drop its selection. */
  onDeleted?: (ids: string[]) => void;
};

function copyText(text: string, message: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => useToastStore.getState().show(message))
    .catch(() => useToastStore.getState().show("Could not copy to clipboard"));
}

function taskHref(id: string) {
  return `/tasks?taskId=${encodeURIComponent(id)}`;
}

/**
 * Builds the right-click menu shared by every task surface — list, board,
 * gantt, project list and Today — so the same task offers the same verbs
 * wherever it is shown.
 */
export function useTaskContextMenu() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const updateTask = useUpdateTask();
  const bulkUpdate = useBulkUpdateTasks();
  const removeTask = useDeleteTask();
  const duplicateTask = useDuplicateTask();
  const setTodayFocus = useSetTodayFocus();
  const startFocus = useStartFocus();
  const stopFocus = useStopFocus();
  const { data: workspaces } = useWorkspaces();
  const { data: projects } = useProjects();

  return useCallback(
    (task: Task, options: TaskMenuOptions = {}): ContextMenuEntry[] => {
      const omit = new Set(options.omit ?? []);
      const selected = options.selectedIds ?? [];
      // Right-clicking a row outside the selection targets just that row.
      const targets = selected.includes(task.id) && selected.length > 1 ? selected : [task.id];
      const many = targets.length > 1;
      const suffix = many ? ` (${targets.length})` : "";

      const workspaceList = (workspaces ?? []) as Workspace[];
      const projectList = (projects ?? []) as Project[];
      const cached = queryClient.getQueryData<Task[]>(tasksKey) ?? [];
      const targetTasks = many
        ? cached.filter((item) => targets.includes(item.id))
        : [task];

      const statusGroups = mergeStatusesByName(
        workspaceList.flatMap((workspace) => workspace.status ?? []),
      );
      const labels = workspaceList.flatMap((workspace) => workspace.lables ?? []) as Label[];

      const completed = Boolean(task.completedAt);
      const focusing = Boolean(task.focusStartedAt);
      const onToday = dateOnly(task.todayFocusOn) === localDateStamp();
      const currentLabelIds = new Set([
        ...(task.labels ?? []).map((label) => label.id),
        ...(task.labelIds ?? []).map((ref) => ref.id),
      ]);

      /** Applies a patch to every target and offers a per-task Undo. */
      const apply = (
        update: UpdateTaskPayload,
        message: string,
        snapshot: (item: Task) => UpdateTaskPayload,
      ) => {
        const before = new Map(targetTasks.map((item) => [item.id, snapshot(item)]));
        const run = many
          ? bulkUpdate.mutateAsync({ ids: targets, update })
          : updateTask.mutateAsync({ id: task.id, ...update });

        void run
          .then(() => {
            showUndoToast(message, () => {
              void Promise.all(
                [...before.entries()].map(([id, previous]) =>
                  updateTask.mutateAsync({ id, ...previous }),
                ),
              );
            });
          })
          .catch((error: unknown) => {
            useToastStore
              .getState()
              .show(error instanceof Error ? error.message : "Update failed");
          });
      };

      /* ---------------- open ---------------- */

      const openSection: (ContextMenuEntry | false)[] = omit.has("open")
        ? []
        : [
            !many && {
              kind: "action" as const,
              label: "Open details",
              icon: SquarePen,
              shortcut: "Enter",
              onSelect: () =>
                openTasksEntity(
                  { kind: "task", id: task.id },
                  { navigate: (href) => router.push(href, { scroll: false }) },
                ),
            },
            {
              kind: "action" as const,
              label: completed ? `Reopen${suffix}` : `Mark complete${suffix}`,
              icon: completed ? RotateCcw : Check,
              shortcut: "X",
              onSelect: () =>
                apply(
                  { completedAt: completed ? "" : new Date().toISOString() },
                  completed ? "Reopened" : "Marked complete",
                  (item) => ({
                    completedAt: item.completedAt ?? "",
                    statusId: item.status?.id ?? item.statusId ?? "",
                  }),
                ),
            },
          ];

      /* ---------------- focus ---------------- */

      const focusSection: (ContextMenuEntry | false)[] =
        omit.has("focus") || many
          ? []
          : [
              {
                kind: "action" as const,
                label: focusing ? "Stop focus" : "Start focus",
                icon: focusing ? Square : Play,
                shortcut: "mod+F",
                onSelect: () => {
                  void (focusing
                    ? stopFocus.mutateAsync(task.id)
                    : startFocus.mutateAsync(task.id));
                },
              },
              {
                kind: "action" as const,
                label: onToday ? "Remove from Today" : "Plan for Today",
                icon: Star,
                onSelect: () => {
                  void setTodayFocus
                    .mutateAsync({
                      taskId: task.id,
                      date: onToday ? null : localDateStamp(),
                    })
                    .then(() =>
                      useToastStore
                        .getState()
                        .show(onToday ? "Removed from Today" : "Planned for Today"),
                    );
                },
              },
            ];

      /* ---------------- field pickers ---------------- */

      const statusSubmenu: ContextMenuEntry[] = statusGroups.map((group) => ({
        kind: "action",
        label: group.name,
        color: group.color,
        checked: !many && group.statuses.some((status) => status.id === (task.statusId ?? task.status?.id)),
        onSelect: () => {
          // Statuses are workspace-local, so each task resolves the shared
          // name to the status that belongs to its own workspace.
          const skipped: string[] = [];
          const before = new Map(
            targetTasks.map((item) => [
              item.id,
              {
                statusId: item.status?.id ?? item.statusId ?? "",
                completedAt: item.completedAt ?? "",
              } satisfies UpdateTaskPayload,
            ]),
          );

          void Promise.all(
            targetTasks.map((item) => {
              const status = statusForWorkspace(group, item.workspaceId ?? item.workspace?.id);
              if (!status) {
                skipped.push(item.workspace?.name || item.name);
                return Promise.resolve();
              }
              const completing = isCompletedStatus(status);
              return updateTask.mutateAsync({
                id: item.id,
                statusId: status.id,
                ...(completing && !item.completedAt
                  ? { completedAt: new Date().toISOString() }
                  : !completing && item.completedAt
                    ? { completedAt: "" }
                    : {}),
              });
            }),
          ).then(() => {
            showUndoToast(
              skipped.length
                ? `Status updated · skipped ${skipped.length} without "${group.name}"`
                : `Moved to ${group.name}`,
              () => {
                void Promise.all(
                  [...before.entries()].map(([id, previous]) =>
                    updateTask.mutateAsync({ id, ...previous }),
                  ),
                );
              },
            );
          });
        },
      }));

      const prioritySubmenu: ContextMenuEntry[] = [
        ...PRIORITIES.map<ContextMenuEntry>((priority) => ({
          kind: "action",
          label: priority,
          color: priorityColor(priority) ?? undefined,
          checked: !many && task.priorityLevel === priority,
          onSelect: () =>
            apply({ priorityLevel: priority }, `Priority set to ${priority}`, (item) => ({
              priorityLevel: item.priorityLevel ?? "",
            })),
        })),
        { kind: "separator" },
        {
          kind: "action",
          label: "Clear priority",
          disabled: !many && !task.priorityLevel,
          onSelect: () =>
            apply({ priorityLevel: "" }, "Priority cleared", (item) => ({
              priorityLevel: item.priorityLevel ?? "",
            })),
        },
      ];

      const projectSubmenu: ContextMenuEntry[] = [
        {
          kind: "action",
          label: "No project",
          checked: !many && !(task.projectId ?? task.project?.id),
          onSelect: () =>
            apply({ projectId: "" }, "Removed from project", (item) => ({
              projectId: item.project?.id ?? item.projectId ?? "",
            })),
        },
        ...(projectList.length ? [{ kind: "separator" as const }] : []),
        ...projectList.map<ContextMenuEntry>((project) => ({
          kind: "action",
          label: project.title,
          color: project.color ?? undefined,
          checked: !many && (task.projectId ?? task.project?.id) === project.id,
          onSelect: () =>
            apply({ projectId: project.id }, `Moved to ${project.title}`, (item) => ({
              projectId: item.project?.id ?? item.projectId ?? "",
            })),
        })),
      ];

      const labelSubmenu: ContextMenuEntry[] = labels.map<ContextMenuEntry>((label) => ({
        kind: "action",
        label: label.name,
        color: label.color,
        checked: !many && currentLabelIds.has(label.id),
        onSelect: () => {
          if (many) {
            apply({ labelIds: [{ id: label.id }] }, `Labeled ${label.name}`, (item) => ({
              labelIds: [
                ...new Set([
                  ...(item.labels ?? []).map((entry) => entry.id),
                  ...(item.labelIds ?? []).map((ref) => ref.id),
                ]),
              ].map((id) => ({ id })),
            }));
            return;
          }
          const next = new Set(currentLabelIds);
          if (next.has(label.id)) next.delete(label.id);
          else next.add(label.id);
          apply(
            { labelIds: [...next].map((id) => ({ id })) },
            currentLabelIds.has(label.id) ? `Removed ${label.name}` : `Labeled ${label.name}`,
            (item) => ({
              labelIds: [
                ...new Set([
                  ...(item.labels ?? []).map((entry) => entry.id),
                  ...(item.labelIds ?? []).map((ref) => ref.id),
                ]),
              ].map((id) => ({ id })),
            }),
          );
        },
      }));

      const fieldSection: (ContextMenuEntry | false)[] = omit.has("fields")
        ? []
        : [
            statusGroups.length > 0 && {
              kind: "submenu" as const,
              label: "Status",
              icon: Circle,
              items: statusSubmenu,
            },
            { kind: "submenu" as const, label: "Priority", icon: Flag, items: prioritySubmenu },
            { kind: "submenu" as const, label: "Project", icon: Folder, items: projectSubmenu },
            labels.length > 0 && {
              kind: "submenu" as const,
              label: "Labels",
              icon: Tag,
              items: labelSubmenu,
            },
          ];

      /* ---------------- scheduling ---------------- */

      const now = new Date();
      const deadlineChoices: { label: string; stamp: string }[] = [
        { label: "Today", stamp: localDateStamp(now) },
        { label: "Tomorrow", stamp: localDateStamp(addDays(now, 1)) },
        { label: "Next week", stamp: localDateStamp(addDays(now, 7)) },
      ];

      const scheduleSection: (ContextMenuEntry | false)[] = omit.has("schedule")
        ? []
        : [
            {
              kind: "submenu" as const,
              label: "Deadline",
              icon: CalendarClock,
              items: [
                ...deadlineChoices.map<ContextMenuEntry>((choice) => ({
                  kind: "action",
                  label: choice.label,
                  checked: !many && dateOnly(task.deadline) === choice.stamp,
                  onSelect: () =>
                    apply({ deadline: choice.stamp }, `Deadline set to ${choice.label}`, (item) => ({
                      deadline: item.deadline ?? "",
                    })),
                })),
                { kind: "separator" },
                {
                  kind: "action",
                  label: "Clear deadline",
                  disabled: !many && !task.deadline,
                  onSelect: () =>
                    apply({ deadline: "" }, "Deadline cleared", (item) => ({
                      deadline: item.deadline ?? "",
                    })),
                },
              ],
            },
            !many && {
              kind: "action" as const,
              label: "Find time on calendar",
              icon: CalendarPlus,
              shortcut: "S",
              onSelect: () => router.push(`/calendar?taskId=${encodeURIComponent(task.id)}`),
            },
          ];

      /* ---------------- clipboard ---------------- */

      const clipboardSection: (ContextMenuEntry | false)[] = omit.has("clipboard")
        ? []
        : [
            !many && {
              kind: "action" as const,
              label: "Duplicate",
              icon: Copy,
              shortcut: "mod+D",
              onSelect: () => {
                void duplicateTask
                  .mutateAsync(task.id)
                  .then((copy) => useToastStore.getState().show(`Duplicated “${copy.name}”`));
              },
            },
            {
              kind: "action" as const,
              label: many ? `Copy names${suffix}` : "Copy name",
              icon: CopyCheck,
              onSelect: () =>
                copyText(
                  targetTasks.map((item) => item.name).join("\n"),
                  many ? `Copied ${targets.length} names` : "Name copied",
                ),
            },
            !many && {
              kind: "action" as const,
              label: "Copy link",
              icon: Link2,
              shortcut: "mod+shift+C",
              onSelect: () =>
                copyText(
                  new URL(taskHref(task.id), window.location.origin).toString(),
                  "Link copied",
                ),
            },
          ];

      /* ---------------- delete ---------------- */

      const deleteSection: (ContextMenuEntry | false)[] = omit.has("delete")
        ? []
        : [
            {
              kind: "action" as const,
              label: `Delete${suffix}`,
              icon: Trash2,
              danger: true,
              shortcut: "mod+Backspace",
              onSelect: () =>
                requestConfirm({
                  title: many
                    ? `Delete ${targets.length} tasks?`
                    : `Delete “${task.name}”?`,
                  description: "This cannot be undone.",
                  onConfirm: async () => {
                    for (const id of targets) {
                      await removeTask.mutateAsync(id);
                    }
                    options.onDeleted?.(targets);
                    useToastStore
                      .getState()
                      .show(many ? `Deleted ${targets.length} tasks` : "Task deleted");
                  },
                }),
            },
          ];

      return tidyEntries([
        ...openSection,
        { kind: "separator" },
        ...focusSection,
        { kind: "separator" },
        ...fieldSection,
        { kind: "separator" },
        ...scheduleSection,
        { kind: "separator" },
        ...clipboardSection,
        ...(options.extra?.length ? [{ kind: "separator" as const }, ...options.extra] : []),
        { kind: "separator" },
        ...deleteSection,
      ]);
    },
    [
      bulkUpdate,
      duplicateTask,
      projects,
      queryClient,
      removeTask,
      router,
      setTodayFocus,
      startFocus,
      stopFocus,
      updateTask,
      workspaces,
    ],
  );
}
