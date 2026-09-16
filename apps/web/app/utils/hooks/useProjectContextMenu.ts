"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  Check,
  Circle,
  Copy,
  CopyCheck,
  ExternalLink,
  Flag,
  Link2,
  Plus,
  RotateCcw,
  SquarePen,
  Trash2,
} from "lucide-react";
import type { Project, Workspace } from "@/app/_types/types";
import { addDays, dateOnly, localDateStamp } from "@/app/utils/calendar";
import { PRIORITIES, priorityColor } from "@/app/utils/priority";
import { mergeStatusesByName, statusForWorkspace } from "@/app/utils/status";
import { openTasksEntity } from "@/app/utils/entityDetail";
import { useDeleteProject, useDuplicateProject, useUpdateProject } from "@/app/utils/hooks/projects";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { showUndoToast, useToastStore } from "@/app/_store/toastStore";
import { requestConfirm } from "@/app/_store/confirmStore";
import { tidyEntries, type ContextMenuEntry } from "@/app/_store/contextMenuStore";

export type ProjectMenuOptions = {
  /** Skips "Open project page" when the menu is raised from that page. */
  omit?: ("open" | "delete")[];
  extra?: ContextMenuEntry[];
  onDeleted?: (id: string) => void;
};

function copyText(text: string, message: string) {
  void navigator.clipboard
    .writeText(text)
    .then(() => useToastStore.getState().show(message))
    .catch(() => useToastStore.getState().show("Could not copy to clipboard"));
}

/** Right-click menu for a project, shared by the projects grid, the task
 * list's project rows and the project detail header. */
export function useProjectContextMenu() {
  const router = useRouter();
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const duplicateProject = useDuplicateProject();
  const { data: workspaces } = useWorkspaces();
  const setAddNewMode = useSidebarStore((state) => state.setAddNewMode);
  const setIsAddItemModalOpen = useSidebarStore((state) => state.setIsAddItemModalOpen);

  return useCallback(
    (project: Project, options: ProjectMenuOptions = {}): ContextMenuEntry[] => {
      const omit = new Set(options.omit ?? []);
      const workspaceList = (workspaces ?? []) as Workspace[];
      const statusGroups = mergeStatusesByName(
        workspaceList.flatMap((workspace) => workspace.status ?? []),
      );
      const completed = Boolean(project.completedAt);
      const name = project.title || "Untitled project";

      const patch = (
        update: Parameters<typeof updateProject.mutateAsync>[0],
        message: string,
        previous: Parameters<typeof updateProject.mutateAsync>[0],
      ) => {
        void updateProject
          .mutateAsync(update)
          .then(() => {
            showUndoToast(message, () => {
              void updateProject.mutateAsync(previous);
            });
          })
          .catch((error: unknown) => {
            useToastStore
              .getState()
              .show(error instanceof Error ? error.message : "Update failed");
          });
      };

      const now = new Date();
      const deadlineChoices = [
        { label: "Today", stamp: localDateStamp(now) },
        { label: "Next week", stamp: localDateStamp(addDays(now, 7)) },
        { label: "In a month", stamp: localDateStamp(addDays(now, 30)) },
      ];

      return tidyEntries([
        {
          kind: "action",
          label: "Open details",
          icon: SquarePen,
          shortcut: "Enter",
          onSelect: () =>
            openTasksEntity(
              { kind: "project", id: project.id },
              { navigate: (href) => router.push(href, { scroll: false }) },
            ),
        },
        !omit.has("open") && {
          kind: "action",
          label: "Open project page",
          icon: ExternalLink,
          onSelect: () => router.push(`/projects/${project.id}`),
        },
        { kind: "separator" },
        {
          kind: "action",
          label: completed ? "Reopen project" : "Mark complete",
          icon: completed ? RotateCcw : Check,
          onSelect: () =>
            patch(
              { id: project.id, completedAt: completed ? "" : new Date().toISOString() },
              completed ? "Project reopened" : "Project completed",
              { id: project.id, completedAt: project.completedAt ?? "" },
            ),
        },
        {
          kind: "action",
          label: "Add task to project",
          icon: Plus,
          onSelect: () => {
            setAddNewMode("task");
            setIsAddItemModalOpen(true);
          },
        },
        { kind: "separator" },
        statusGroups.length > 0 && {
          kind: "submenu",
          label: "Status",
          icon: Circle,
          items: statusGroups.map<ContextMenuEntry>((group) => {
            // Statuses belong to a workspace, so only groups that exist in the
            // project's own workspace can be applied.
            const status = statusForWorkspace(group, project.workspaceId);
            return {
              kind: "action",
              label: group.name,
              color: group.color,
              disabled: !status,
              checked: Boolean(status && status.id === project.statusId),
              onSelect: () => {
                if (!status) return;
                patch(
                  { id: project.id, statusId: status.id },
                  `Status set to ${group.name}`,
                  { id: project.id, statusId: project.statusId ?? "" },
                );
              },
            };
          }),
        },
        {
          kind: "submenu",
          label: "Priority",
          icon: Flag,
          items: [
            ...PRIORITIES.map<ContextMenuEntry>((priority) => ({
              kind: "action",
              label: priority,
              color: priorityColor(priority) ?? undefined,
              checked: project.priorityLevel === priority,
              onSelect: () =>
                patch(
                  { id: project.id, priorityLevel: priority },
                  `Priority set to ${priority}`,
                  { id: project.id, priorityLevel: project.priorityLevel ?? "" },
                ),
            })),
            { kind: "separator" },
            {
              kind: "action",
              label: "Clear priority",
              disabled: !project.priorityLevel,
              onSelect: () =>
                patch({ id: project.id, priorityLevel: "" }, "Priority cleared", {
                  id: project.id,
                  priorityLevel: project.priorityLevel ?? "",
                }),
            },
          ],
        },
        {
          kind: "submenu",
          label: "Deadline",
          icon: CalendarClock,
          items: [
            ...deadlineChoices.map<ContextMenuEntry>((choice) => ({
              kind: "action",
              label: choice.label,
              checked: dateOnly(project.deadline) === choice.stamp,
              onSelect: () =>
                patch(
                  { id: project.id, deadline: choice.stamp },
                  `Deadline set to ${choice.label}`,
                  { id: project.id, deadline: project.deadline ?? "" },
                ),
            })),
            { kind: "separator" },
            {
              kind: "action",
              label: "Clear deadline",
              disabled: !project.deadline,
              onSelect: () =>
                patch({ id: project.id, deadline: "" }, "Deadline cleared", {
                  id: project.id,
                  deadline: project.deadline ?? "",
                }),
            },
          ],
        },
        { kind: "separator" },
        {
          kind: "action",
          label: "Duplicate project",
          icon: Copy,
          shortcut: "mod+D",
          onSelect: () => {
            void duplicateProject
              .mutateAsync(project.id)
              .then((copy) => useToastStore.getState().show(`Duplicated “${copy.title}”`))
              .catch(() => useToastStore.getState().show("Could not duplicate project"));
          },
        },
        {
          kind: "action",
          label: "Copy name",
          icon: CopyCheck,
          onSelect: () => copyText(name, "Name copied"),
        },
        {
          kind: "action",
          label: "Copy link",
          icon: Link2,
          shortcut: "mod+shift+C",
          onSelect: () =>
            copyText(
              new URL(`/projects/${project.id}`, window.location.origin).toString(),
              "Link copied",
            ),
        },
        ...(options.extra?.length ? [{ kind: "separator" as const }, ...options.extra] : []),
        { kind: "separator" },
        !omit.has("delete") && {
          kind: "action",
          label: "Delete project",
          icon: Trash2,
          danger: true,
          shortcut: "mod+Backspace",
          onSelect: () =>
            requestConfirm({
              title: `Delete “${name}”?`,
              description: "Its tasks stay, but they lose this project. This cannot be undone.",
              onConfirm: async () => {
                await deleteProject.mutateAsync(project.id);
                options.onDeleted?.(project.id);
                useToastStore.getState().show("Project deleted");
              },
            }),
        },
      ]);
    },
    [
      deleteProject,
      duplicateProject,
      router,
      setAddNewMode,
      setIsAddItemModalOpen,
      updateProject,
      workspaces,
    ],
  );
}
