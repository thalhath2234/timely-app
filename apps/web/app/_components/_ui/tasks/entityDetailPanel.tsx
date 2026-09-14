"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  CalendarDays,
  Check,
  Circle,
  Clock,
  Flag,
  FolderKanban,
  ListTodo,
  Palette,
  Trash2,
} from "lucide-react";
import CustomFieldControl, {
  customFieldIcon,
  findCustomFieldDraft,
  toCustomFieldDrafts,
  withCustomFieldDraft,
} from "@/app/_components/_ui/customFieldControl";
import DatePicker from "@/app/_components/_ui/datePicker";
import LabelPicker from "@/app/_components/_ui/labelPicker";
import TaskScheduleSection from "@/app/_components/_ui/tasks/taskScheduleSection";
import TaskTypeToggle from "@/app/_components/_ui/tasks/taskTypeToggle";
import {
  EntityModalShell,
  ModalMain,
  ModalSidebar,
  PropertyRow,
  SidebarSectionTitle,
  modalTitleClass,
} from "@/app/_components/_ui/modal/entityModal";
import Select from "@/app/_components/_ui/select";
import ColorPicker from "@/app/_components/_ui/colorPicker";
import RichTextEditor from "@/app/_components/editor/richTextEditor";
import {
  CustomField,
  CustomFieldValueInput,
  DocContent,
  Label,
  PreferredWindow,
  Project,
  RecurrenceInput,
  RecurrenceRule,
  ScheduledBlock,
  Status,
  Task,
  TaskActivity,
  TaskCustomFieldValue,
  TaskKind,
  Workspace,
} from "@/app/_types/types";
import { UpdateTaskPayload } from "@/app/utils/api/tasks";
import { openTasksEntity } from "@/app/utils/entityDetail";
import { useProjects, useUpdateProject } from "@/app/utils/hooks/projects";
import {
  patchTaskInCache,
  useAddTaskComment,
  useDeleteTask,
  useTaskActivity,
  useTask,
  useTasks,
  useUpdateTask,
} from "@/app/utils/hooks/tasks";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";
import {
  applyClockToDate,
  dateFromDateInput,
  nextRoundHour,
  toDateInputValue,
  toTimeInputValue,
} from "@/app/utils/calendar";
import { useAutosave } from "@/app/utils/hooks/useAutosave";
import { toRichContent } from "@/app/utils/richText";
import { stagesForProject } from "@/app/utils/stages";
import { isReminderTask } from "@/app/utils/taskFilters";
import SaveStatusBadge from "@/app/_components/_ui/saveStatus";
import ConfirmDialog from "@/app/_components/_ui/confirmDialog";
import { showUndoToast } from "@/app/_store/toastStore";
import TaskExecution from "@/app/_components/_ui/tasks/taskExecution";

const PRIORITY_OPTIONS = ["Low", "Medium", "High", "Urgent"];

function isCompletedStatus(status: Status) {
  const name = status.name.trim().toLowerCase();
  return name === "completed" || name === "complete" || name === "done";
}

function findCompletedStatus(statuses: Status[]) {
  return statuses.find(isCompletedStatus);
}

function findDefaultStatus(statuses: Status[]) {
  return statuses.find((status) => status.isDefault) ?? statuses[0];
}

/** Fields the panel can change, named the same for tasks and projects. */
interface DetailPatch {
  title?: string;
  description?: string;
  descriptionRich?: DocContent;
  priorityLevel?: string;
  statusId?: string;
  startDate?: string;
  deadline?: string;
  scheduledOn?: string;
  duration?: number;
  kind?: TaskKind;
  workspaceId?: string;
  projectId?: string;
  completedAt?: string;
  blockedById?: string;
  stageId?: string;
  color?: string;
  labelIds?: { id: string }[];
  customFieldValues?: CustomFieldValueInput[];
  recurrence?: RecurrenceInput | null;
  scheduleLocked?: boolean;
  contiguous?: boolean;
  minChunkMinutes?: number;
  preferredChunkMinutes?: number | null;
  earliestStartAt?: string | null;
  preferredWindows?: PreferredWindow[];
}

interface DetailView {
  kind: "task" | "project";
  id: string;
  title: string;
  description: string;
  descriptionRich?: DocContent | null;
  priorityLevel: string | null;
  statusId: string | null;
  workspaceId: string | null;
  projectId?: string | null;
  startDate: string | null;
  deadline: string | null;
  scheduledOn?: string | null;
  duration?: number | null;
  taskKind?: TaskKind;
  recurrence?: RecurrenceRule | null;
  blocks?: ScheduledBlock[];
  scheduleLocked?: boolean;
  contiguous?: boolean;
  minChunkMinutes?: number;
  preferredChunkMinutes?: number | null;
  earliestStartAt?: string | null;
  preferredWindows?: PreferredWindow[];
  blockedById?: string | null;
  stageId?: string | null;
  color?: string | null;
  labelIds?: string[];
  customFieldValues?: TaskCustomFieldValue[];
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  facts: { label: string; value: string }[];
}

function formatActivityTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (Math.abs(minutes) < 1) return "just now";
  if (Math.abs(minutes) < 60) return `${Math.abs(minutes)} min ago`;

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface EntityDetailPanelProps {
  kind: "task" | "project";
  id: string;
  onClose: () => void;
}

export default function EntityDetailPanel({
  kind,
  id,
  onClose,
}: EntityDetailPanelProps) {
  const { data: tasks, isLoading: tasksLoading } = useTasks();
  const { data: projects, isLoading: projectsLoading } = useProjects();

  const listedTask =
    kind === "task"
      ? ((tasks ?? []) as Task[]).find((item) => item.id === id)
      : undefined;
  const { data: fetchedTask, isLoading: taskLoading } = useTask(
    kind === "task" && !tasksLoading && !listedTask ? id : undefined,
  );
  const task = listedTask ?? fetchedTask;
  const project =
    kind === "project"
      ? ((projects ?? []) as Project[]).find((item) => item.id === id)
      : undefined;

  const isLoading =
    kind === "task"
      ? tasksLoading || (!listedTask && taskLoading)
      : projectsLoading;

  if (isLoading) {
    return (
      <PanelShell onClose={onClose}>
        <p className="p-6 text-sm text-muted-foreground">Loading...</p>
      </PanelShell>
    );
  }

  if (kind === "task" && task) {
    // Keying by id resets the local draft state when a different row opens.
    return <TaskDetail key={task.id} task={task} onClose={onClose} />;
  }

  if (kind === "project" && project) {
    return (
      <ProjectDetail key={project.id} project={project} onClose={onClose} />
    );
  }

  return (
    <PanelShell onClose={onClose}>
      <p className="p-6 text-sm text-muted-foreground">
        This {kind} no longer exists.
      </p>
    </PanelShell>
  );
}

function TaskDetail({ task, onClose }: { task: Task; onClose: () => void }) {
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const queryClient = useQueryClient();
  const { data: workspaces } = useWorkspaces();

  // Tasks call it "name" where projects call it "title".
  const save = useCallback(
    ({ title, ...rest }: DetailPatch) => {
      const payload: UpdateTaskPayload = { ...rest };
      if (title !== undefined) payload.name = title;
      return updateTask.mutateAsync({ id: task.id, ...payload });
    },
    [task.id, updateTask],
  );

  const onLabelsChange = useCallback(
    (ids: string[]) => {
      const workspaceId = task.workspaceId ?? task.workspace?.id;
      const workspace = ((workspaces ?? []) as Workspace[]).find(
        (item) => item.id === workspaceId,
      );
      const selected = ((workspace?.lables ?? []) as Label[]).filter((label) =>
        ids.includes(label.id),
      );
      // Optimistic: table reads `labels`, so update the list cache immediately.
      patchTaskInCache(queryClient, task.id, {
        labelIds: ids.map((id) => ({ id })),
        labels: selected,
      });
    },
    [queryClient, task.id, task.workspace?.id, task.workspaceId, workspaces],
  );

  const view: DetailView = {
    kind: "task",
    id: task.id,
    title: task.name,
    description: task.description ?? "",
    descriptionRich: task.descriptionRich,
    priorityLevel: task.priorityLevel,
    statusId: task.statusId,
    workspaceId: task.workspaceId ?? task.workspace?.id ?? null,
    projectId: task.projectId ?? task.project?.id ?? null,
    startDate: task.startDate,
    deadline: task.deadline,
    scheduledOn: task.scheduledOn,
    duration: task.duration,
    taskKind: task.kind,
    recurrence: task.recurrence ?? null,
    blocks: task.blocks ?? [],
    scheduleLocked: task.scheduleLocked,
    contiguous: task.contiguous,
    minChunkMinutes: task.minChunkMinutes,
    preferredChunkMinutes: task.preferredChunkMinutes,
    earliestStartAt: task.earliestStartAt,
    preferredWindows: task.preferredWindows,
    blockedById: task.blockedById,
    stageId: task.stageId,
    labelIds:
      task.labelIds?.map((item) => item.id) ??
      task.labels?.map((item) => item.id) ??
      [],
    customFieldValues: task.customFieldValues ?? [],
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    facts: task.kind === "inbox"
      ? [{ label: "Inbox", value: "Unprocessed" }]
      : isReminderTask(task)
        ? []
        : [
            { label: "Project", value: task.project?.title || "-" },
            { label: "Workspace", value: task.workspace?.name || "-" },
          ],
  };

  return (
    <DetailBody
      view={view}
      save={save}
      onLabelsChange={onLabelsChange}
      onClose={onClose}
      onDelete={
        view.kind === "task"
          ? async () => {
              await deleteTask.mutateAsync(task.id);
              onClose();
            }
          : undefined
      }
    >
      <TaskExecution task={task} />
    </DetailBody>
  );
}

/** Renders project metadata and controls inside the entity detail panel. */
function ProjectDetail({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const updateProject = useUpdateProject();
  const { data: tasks } = useTasks();

  const save = useCallback(
    (patch: DetailPatch) => {
      const next = { ...patch };
      delete next.scheduledOn;
      delete next.duration;
      delete next.labelIds;
      delete next.customFieldValues;
      delete next.kind;
      delete next.workspaceId;
      delete next.projectId;
      return updateProject.mutateAsync({ id: project.id, ...next });
    },
    [project.id, updateProject],
  );

  const projectTasks = useMemo(
    () =>
      ((tasks ?? []) as Task[]).filter(
        (task) => (task.project?.id ?? task.projectId) === project.id,
      ),
    [tasks, project.id],
  );

  const completed = projectTasks.filter((task) => task.completedAt).length;

  const view: DetailView = {
    kind: "project",
    id: project.id,
    title: project.title,
    description: project.description ?? "",
    descriptionRich: project.descriptionRich,
    priorityLevel: project.priorityLevel ?? null,
    statusId: project.statusId ?? null,
    workspaceId: project.workspaceId,
    projectId: project.id,
    startDate: project.startDate ?? null,
    deadline: project.deadline ?? null,
    completedAt: project.completedAt ?? null,
    color: project.color ?? null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    facts: [
      { label: "Tasks", value: String(projectTasks.length) },
      { label: "Completed", value: `${completed}/${projectTasks.length}` },
      { label: "Stages", value: project.doesHaveStages ? "Enabled" : "Off" },
    ],
  };

  return (
    <DetailBody view={view} save={save} onClose={onClose}>
      {projectTasks.length > 0 && (
        <section className="mt-8">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Tasks in this project
          </h3>
          <ul className="flex flex-col gap-1">
            {projectTasks.map((task) => (
              <li key={task.id}>
                <ProjectTaskLink task={task} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </DetailBody>
  );
}

function ProjectTaskLink({ task }: { task: Task }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() =>
        openTasksEntity(
          { kind: "task", id: task.id },
          { navigate: (href) => router.push(href, { scroll: false }) },
        )
      }
      className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <ListTodo className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{task.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {task.status?.name ?? ""}
      </span>
    </button>
  );
}

/** Selects and renders the detail view for the active task or project. */
function DetailBody({
  view,
  save,
  onLabelsChange,
  onClose,
  onDelete,
  children,
}: {
  view: DetailView;
  save: (patch: DetailPatch) => Promise<unknown>;
  onLabelsChange?: (ids: string[]) => void;
  onClose: () => void;
  onDelete?: () => Promise<void> | void;
  children?: React.ReactNode;
}) {
  const { data: workspaces } = useWorkspaces();
  const { data: tasks } = useTasks();
  const [title, setTitle] = useState(view.title);
  const [labelIds, setLabelIds] = useState(view.labelIds ?? []);
  const [descriptionDirty, setDescriptionDirty] = useState(false);
  const [descriptionSaving, setDescriptionSaving] = useState(false);
  const descriptionDraftRef = useRef<{
    content: DocContent;
    plainText: string;
  } | null>(null);

  const { schedule, flush, status } = useAutosave<DetailPatch>(save);
  const { data: projects } = useProjects();
  const typedWorkspaces = useMemo(
    () => (workspaces ?? []) as Workspace[],
    [workspaces],
  );
  const typedProjects = useMemo(
    () => (projects ?? []) as Project[],
    [projects],
  );
  const stageOptions = stagesForProject(typedProjects, view.projectId);
  const projectsInWorkspace = useMemo(
    () =>
      typedProjects.filter(
        (project) => !view.workspaceId || project.workspaceId === view.workspaceId,
      ),
    [typedProjects, view.workspaceId],
  );

  // Adopt the saved label set whenever it changes, so a save landing (or an
  // edit from elsewhere) is reflected without an extra render pass.
  const labelKey = (view.labelIds ?? []).join(",");
  const [syncedLabelKey, setSyncedLabelKey] = useState(labelKey);
  if (syncedLabelKey !== labelKey) {
    setSyncedLabelKey(labelKey);
    setLabelIds(view.labelIds ?? []);
  }

  const statusOptions = useMemo(() => {
    const workspace = ((workspaces ?? []) as Workspace[]).find(
      (item) => item.id === view.workspaceId,
    );
    return (workspace?.status ?? []) as Status[];
  }, [workspaces, view.workspaceId]);

  const labelOptions = useMemo(() => {
    const workspaceId = view.workspaceId;
    const fromList = ((workspaces ?? []) as Workspace[]).find(
      (item) => item.id === workspaceId,
    );
    return (fromList?.lables ?? []) as Label[];
  }, [workspaces, view.workspaceId]);

  const customFields = useMemo(() => {
    const workspace = ((workspaces ?? []) as Workspace[]).find(
      (item) => item.id === view.workspaceId,
    );
    return (workspace?.customFields ?? []) as CustomField[];
  }, [workspaces, view.workspaceId]);

  // One draft per workspace field. Re-init when the open task or the field
  // list changes, but not when a save echoes back — that would wipe a draft
  // still being typed.
  const savedCustomFields = useMemo(
    () => toCustomFieldDrafts(customFields, view.customFieldValues ?? []),
    [customFields, view.customFieldValues],
  );
  const fieldsKey = customFields.map((field) => field.id).join(",");
  const [customFieldValues, setCustomFieldValues] =
    useState<CustomFieldValueInput[]>(savedCustomFields);
  const [syncedCustomFieldsKey, setSyncedCustomFieldsKey] = useState(
    `${view.id}:${fieldsKey}`,
  );

  const nextCustomFieldsKey = `${view.id}:${fieldsKey}`;
  if (syncedCustomFieldsKey !== nextCustomFieldsKey) {
    setSyncedCustomFieldsKey(nextCustomFieldsKey);
    setCustomFieldValues(savedCustomFields);
  }

  const changeCustomField = (
    field: CustomField,
    next: Pick<CustomFieldValueInput, "stringValue" | "optionsValue">,
  ) => {
    const updated = withCustomFieldDraft(customFieldValues, field, next);
    setCustomFieldValues(updated);
    schedule({ customFieldValues: updated });
  };

  const blockingTasks = useMemo(
    () =>
      ((tasks ?? []) as Task[]).filter(
        (task) => task.blockedById === view.id && task.id !== view.id,
      ),
    [tasks, view.id],
  );

  const otherTasks = useMemo(
    () => ((tasks ?? []) as Task[]).filter((task) => task.id !== view.id),
    [tasks, view.id],
  );

  const toggleComplete = () => {
    const completing = !view.completedAt;
    const nextStatus = completing
      ? findCompletedStatus(statusOptions)
      : findDefaultStatus(statusOptions);
    const previousCompletedAt = view.completedAt ?? "";
    const previousStatusId = view.statusId ?? "";

    schedule({
      completedAt: completing ? new Date().toISOString() : "",
      ...(nextStatus ? { statusId: nextStatus.id } : {}),
    });
    void flush();
    if (completing) {
      showUndoToast("Marked complete", () => {
        schedule({
          completedAt: previousCompletedAt,
          statusId: previousStatusId,
        });
        void flush();
      });
    }
  };

  const saveDescription = async () => {
    const draft = descriptionDraftRef.current;
    if (!draft || descriptionSaving) return;

    setDescriptionSaving(true);
    try {
      await save({
        descriptionRich: draft.content,
        description: draft.plainText,
      });
      setDescriptionDirty(false);
    } finally {
      setDescriptionSaving(false);
    }
  };

  const isInbox = view.taskKind === "inbox" || view.facts.some((fact) => fact.label === "Inbox");
  const isReminder =
    view.kind === "task" &&
    !isInbox &&
    (view.taskKind === "reminder" ||
      (!view.taskKind && (view.duration ?? 0) <= 0));
  const workspaceName =
    typedWorkspaces.find((space) => space.id === view.workspaceId)?.name ??
    view.facts.find((fact) => fact.label === "Workspace")?.value ??
    "-";
  const projectName =
    typedProjects.find((project) => project.id === view.projectId)?.title ??
    view.facts.find((fact) => fact.label === "Project")?.value ??
    "-";

  const defaultWorkspaceId = view.workspaceId || typedWorkspaces[0]?.id || "";

  const commit = (patch: DetailPatch) => {
    schedule(patch);
    void flush();
  };

  const convertInboxToTask = (patch: DetailPatch = {}): DetailPatch | null => {
    const workspaceId = patch.workspaceId || defaultWorkspaceId;
    if (!workspaceId) return null;
    return {
      ...patch,
      kind: "task",
      duration: Math.max(30, view.duration ?? 0) || 30,
      workspaceId,
    };
  };

  const onWorkspaceChange = (workspaceId: string) => {
    const projectStillValid = typedProjects.some(
      (project) => project.id === view.projectId && project.workspaceId === workspaceId,
    );
    const patch: DetailPatch = {
      workspaceId,
      ...(projectStillValid ? {} : { projectId: "", stageId: "" }),
    };
    if (isInbox) {
      const converted = convertInboxToTask(patch);
      if (!converted) return;
      commit(converted);
      showUndoToast(`“${view.title}” is now a task`);
      return;
    }
    commit(patch);
  };

  const onProjectChange = (projectId: string) => {
    const project = typedProjects.find((item) => item.id === projectId);
    const patch: DetailPatch = {
      projectId,
      stageId: "",
      ...(project && project.workspaceId !== view.workspaceId
        ? { workspaceId: project.workspaceId }
        : {}),
    };
    if (isInbox && projectId) {
      const converted = convertInboxToTask({
        ...patch,
        workspaceId: patch.workspaceId || project?.workspaceId || defaultWorkspaceId,
      });
      if (!converted) return;
      commit(converted);
      showUndoToast(`“${view.title}” is now a task`);
      return;
    }
    commit(patch);
  };

  return (
    <PanelShell
      kind={view.kind}
      completed={Boolean(view.completedAt)}
      saveStatus={<SaveStatusBadge status={status} onRetry={() => void flush()} />}
      onToggleComplete={toggleComplete}
      onClose={onClose}
      onDelete={onDelete}
      deleteTitle={`Delete “${title.trim() || "Untitled"}”?`}
      deleteDescription={
        isInbox
          ? "This capture will be removed from Inbox."
          : isReminder
            ? "This reminder will be removed."
            : "This task will be removed permanently."
      }
    >
      <ModalMain>
        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            schedule({ title: event.target.value });
          }}
          onBlur={() => void flush()}
          placeholder="Untitled"
          className={modalTitleClass}
        />

        <div className="mt-4 flex h-80 shrink-0 flex-col overflow-hidden rounded-lg border border-border">
          <div className="flex min-h-0 flex-1 flex-col px-3 pt-2">
            <RichTextEditor
              key={view.id}
              variant="compact"
              toolbar="fixed"
              syncKey={view.id}
              content={toRichContent(view.descriptionRich, view.description)}
              placeholder="Description"
              onChange={(draft) => {
                descriptionDraftRef.current = draft;
                setDescriptionDirty(true);
              }}
            />
          </div>
          <div className="flex shrink-0 justify-end border-t border-border px-3 py-2">
            <button
              type="button"
              disabled={!descriptionDirty || descriptionSaving}
              onClick={() => void saveDescription()}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {descriptionSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        {children}

        <section className="mt-8 border-t border-border pt-4">
          <h3 className="text-sm font-medium text-foreground">Activity</h3>
          {view.kind === "task" ? (
            <TaskActivityFeed taskId={view.id} />
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Created {formatActivityTime(view.createdAt)}
              {view.updatedAt && view.updatedAt !== view.createdAt
                ? ` · Updated ${formatActivityTime(view.updatedAt)}`
                : ""}
              {view.completedAt
                ? ` · Completed ${formatActivityTime(view.completedAt)}`
                : ""}
            </p>
          )}
        </section>
      </ModalMain>

      <ModalSidebar>
        <div className="flex flex-col gap-1">
          {view.kind === "task" ? (
            <div className="px-1 py-1.5">
              <TaskTypeToggle
                value={isInbox ? null : isReminder ? "reminder" : "task"}
                onChange={(next) => {
                  if (next === "reminder") {
                    commit({
                      kind: "reminder",
                      duration: 0,
                      scheduledOn: view.scheduledOn || nextRoundHour().toISOString(),
                    });
                    if (isInbox) showUndoToast(`“${view.title}” is now a reminder`);
                    return;
                  }
                  if (isInbox) {
                    const converted = convertInboxToTask(
                      view.projectId ? { projectId: view.projectId } : {},
                    );
                    if (!converted) return;
                    commit(converted);
                    showUndoToast(`“${view.title}” is now a task`);
                    return;
                  }
                  commit({
                    kind: "task",
                    duration: Math.max(30, view.duration ?? 0) || 30,
                  });
                }}
              />
              <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                {isInbox
                  ? "Assign a workspace to put this on the board, or choose Reminder for a ping."
                  : isReminder
                    ? "Pings at a chosen time. Does not reserve a work block."
                    : "Estimated minutes of work the scheduler can place."}
              </p>
            </div>
          ) : null}

          {!isReminder ? (
          <>
          {view.kind === "task" ? (
            <>
              <PropertyRow icon={FolderKanban} label="Workspace">
                <Select
                  size="sm"
                  value={view.workspaceId ?? ""}
                  onChange={onWorkspaceChange}
                  placeholder="Select workspace"
                  className="border-0 bg-transparent px-0 shadow-none"
                  options={typedWorkspaces.map((space) => ({
                    value: space.id,
                    label: space.name,
                    color: space.color ?? undefined,
                  }))}
                />
              </PropertyRow>
              <PropertyRow icon={ListTodo} label="Project">
                <Select
                  size="sm"
                  value={view.projectId ?? ""}
                  onChange={onProjectChange}
                  placeholder="No project"
                  className="border-0 bg-transparent px-0 shadow-none"
                  options={[
                    { value: "", label: "No project" },
                    ...projectsInWorkspace.map((project) => ({
                      value: project.id,
                      label: project.title,
                      color: project.color ?? undefined,
                    })),
                  ]}
                />
              </PropertyRow>
            </>
          ) : (
            <>
              <PropertyRow icon={FolderKanban} label="Workspace">
                <span className="truncate text-foreground">{workspaceName}</span>
              </PropertyRow>
              <PropertyRow icon={ListTodo} label="Project">
                <span className="truncate text-foreground">{projectName}</span>
              </PropertyRow>
              <PropertyRow icon={Palette} label="Color">
                <ColorPicker
                  value={view.color || "#30A66D"}
                  onChange={(color) => schedule({ color })}
                  aria-label="Project color"
                />
              </PropertyRow>
            </>
          )}
          <PropertyRow icon={Circle} label="Status">
            <Select
              size="sm"
              value={view.statusId ?? ""}
              onChange={(statusId) => {
                const next = statusOptions.find((option) => option.id === statusId);
                const completing = next ? isCompletedStatus(next) : false;
                schedule({
                  statusId,
                  ...(completing && !view.completedAt
                    ? { completedAt: new Date().toISOString() }
                    : !completing && view.completedAt
                      ? { completedAt: "" }
                      : {}),
                });
              }}
              placeholder="No status"
              className="border-0 bg-transparent px-0 shadow-none"
              options={[
                { value: "", label: "No status" },
                ...statusOptions.map((option) => ({
                  value: option.id,
                  label: option.name,
                  color: option.color,
                })),
              ]}
            />
          </PropertyRow>
          {view.kind === "task" && stageOptions.length > 0 ? (
          <PropertyRow icon={FolderKanban} label="Stage">
            <Select
              size="sm"
              value={view.stageId ?? ""}
              onChange={(stageId) => schedule({ stageId })}
              placeholder="No stage"
              className="border-0 bg-transparent px-0 shadow-none"
              options={[
                { value: "", label: "No stage" },
                ...stageOptions.map((stage) => ({
                  value: stage.id,
                  label: stage.name,
                  color: stage.color ?? undefined,
                })),
              ]}
            />
          </PropertyRow>
          ) : null}
          </>
          ) : null}

          <PropertyRow icon={Flag} label="Priority">
            <Select
              size="sm"
              value={view.priorityLevel ?? ""}
              onChange={(priorityLevel) => schedule({ priorityLevel })}
              placeholder="No priority"
              className="border-0 bg-transparent px-0 shadow-none"
              options={[
                { value: "", label: "No priority" },
                ...PRIORITY_OPTIONS.map((option) => ({
                  value: option,
                  label: option,
                })),
              ]}
            />
          </PropertyRow>

          {view.kind === "task" && !isInbox && !isReminder ? (
            <PropertyRow icon={Clock} label="Duration">
              <input
                type="number"
                min={15}
                step={15}
                key={`duration-${view.id}-${view.duration ?? 0}`}
                defaultValue={view.duration ?? 30}
                onChange={(event) =>
                  schedule({
                    duration: Math.max(15, Number(event.target.value) || 30),
                  })
                }
                className="w-full bg-transparent text-sm text-foreground outline-none"
              />
              <span className="shrink-0 text-xs text-muted-foreground">min</span>
            </PropertyRow>
          ) : null}

          <PropertyRow icon={CalendarDays} label="Start date">
            <DatePicker
              mode="date"
              value={toDateInputValue(view.startDate)}
              onChange={(startDate) => {
                const timeOnly =
                  view.kind === "task" &&
                  (view.duration ?? 0) <= 0 &&
                  !view.recurrence;
                if (timeOnly && view.scheduledOn && startDate) {
                  schedule({
                    startDate,
                    scheduledOn: applyClockToDate(
                      dateFromDateInput(startDate),
                      toTimeInputValue(view.scheduledOn),
                    ).toISOString(),
                  });
                  return;
                }
                schedule({ startDate });
              }}
            />
          </PropertyRow>

          <PropertyRow icon={CalendarDays} label="Deadline">
            <DatePicker
              mode="date"
              value={toDateInputValue(view.deadline)}
              onChange={(deadline) => schedule({ deadline })}
            />
          </PropertyRow>

          {view.kind === "task" && (
            <>
              {!isInbox ? (
              <TaskScheduleSection
                taskId={view.id}
                duration={view.duration ?? 0}
                deadline={view.deadline}
                startDate={view.startDate}
                completed={Boolean(view.completedAt)}
                scheduledOn={view.scheduledOn}
                recurrence={view.recurrence}
                blocks={view.blocks}
                scheduleLocked={view.scheduleLocked}
                contiguous={view.contiguous}
                minChunkMinutes={view.minChunkMinutes}
                preferredChunkMinutes={view.preferredChunkMinutes}
                earliestStartAt={view.earliestStartAt}
                preferredWindows={view.preferredWindows}
                onRecurrenceChange={(recurrence) => {
                  schedule({ recurrence });
                  void flush();
                }}
                onScheduledOnChange={(scheduledOn) => {
                  schedule({ scheduledOn });
                  void flush();
                }}
              />
              ) : null}

              {!isReminder ? (
              <div className="pt-2">
                <p className="mb-1.5 text-xs text-muted-foreground">Labels</p>
                <LabelPicker
                  labels={labelOptions}
                  selectedIds={labelIds}
                  emptyLabel="None"
                  onChange={(ids) => {
                    setLabelIds(ids);
                    onLabelsChange?.(ids);
                    schedule({
                      labelIds: ids.map((id) => ({ id })),
                    });
                  }}
                />
              </div>
              ) : null}

              {!isReminder && customFields.length > 0 && (
                <div className="mt-4 border-t border-border pt-3">
                  <SidebarSectionTitle>Custom fields</SidebarSectionTitle>
                  {customFields.map((field) => (
                    <PropertyRow
                      key={field.id}
                      icon={customFieldIcon(field.type)}
                      label={field.name}
                    >
                      <CustomFieldControl
                        field={field}
                        value={findCustomFieldDraft(customFieldValues, field.id)}
                        onChange={(next) => changeCustomField(field, next)}
                      />
                    </PropertyRow>
                  ))}
                </div>
              )}

              {!isReminder ? (
              <div className="mt-4 border-t border-border pt-3">
                <PropertyRow icon={Ban} label="Blocked by">
                  <Select
                    size="sm"
                    value={view.blockedById ?? ""}
                    onChange={(blockedById) => schedule({ blockedById })}
                    placeholder="None"
                    className="border-0 bg-transparent px-0 shadow-none"
                    options={[
                      { value: "", label: "None" },
                      ...otherTasks.map((task) => ({
                        value: task.id,
                        label: task.name,
                      })),
                    ]}
                  />
                </PropertyRow>
                <PropertyRow icon={Ban} label="Blocking">
                  <span className="truncate text-sm text-foreground">
                    {blockingTasks.length > 0
                      ? blockingTasks.map((task) => task.name).join(", ")
                      : "None"}
                  </span>
                </PropertyRow>
              </div>
              ) : null}
            </>
          )}
        </div>
      </ModalSidebar>
    </PanelShell>
  );
}

function actorInitial(name: string) {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "?";
}

function TaskActivityFeed({ taskId }: { taskId: string }) {
  const { data: entries, isLoading } = useTaskActivity(taskId);
  const addComment = useAddTaskComment(taskId);
  const [comment, setComment] = useState("");

  const submit = () => {
    const text = comment.trim();
    if (!text || addComment.isPending) return;
    addComment.mutate(text, {
      onSuccess: () => setComment(""),
    });
  };

  const onCommentKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };

  return (
    <>
      <div className="mt-3 rounded-lg border border-border bg-input/20 px-3 py-2">
        <textarea
          rows={2}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={onCommentKeyDown}
          placeholder="Enter comment"
          className="w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="mt-1 flex items-center justify-end gap-2 text-[10px] text-muted-foreground">
          {addComment.isError && (
            <span className="text-destructive">Could not post comment</span>
          )}
          <kbd className="rounded border border-border px-1">Ctrl</kbd>
          <span>+</span>
          <kbd className="rounded border border-border px-1">Enter</kbd>
        </div>
      </div>

      {isLoading ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading activity...</p>
      ) : (
        <ol className="mt-4 flex flex-col gap-3">
          {(entries ?? []).map((entry) => (
            <TaskActivityItem key={entry.id} entry={entry} />
          ))}
        </ol>
      )}
    </>
  );
}

function TaskActivityItem({ entry }: { entry: TaskActivity }) {
  const isComment = entry.action === "commented";

  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden
        className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground"
      >
        {actorInitial(entry.actorName)}
      </span>
      <div className="min-w-0 flex-1">
        {isComment ? (
          <>
            <p className="text-sm text-foreground">
              <span className="font-medium">{entry.actorName}</span>{" "}
              <span className="text-muted-foreground">commented</span>
            </p>
            <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/60 px-2.5 py-1.5 text-sm text-foreground">
              {entry.message}
            </p>
          </>
        ) : (
          <p className="text-sm text-foreground">
            <span className="font-medium">{entry.actorName}</span>{" "}
            <span className="text-muted-foreground">{entry.message}</span>
          </p>
        )}
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {formatActivityTime(entry.createdAt)}
        </p>
      </div>
    </li>
  );
}

function PanelShell({
  children,
  onClose,
  saveStatus,
  kind = "task",
  completed = false,
  onToggleComplete,
  onDelete,
  deleteTitle = "Delete this task?",
  deleteDescription = "This cannot be undone.",
}: {
  children: React.ReactNode;
  onClose: () => void;
  saveStatus?: React.ReactNode;
  kind?: "task" | "project";
  completed?: boolean;
  onToggleComplete?: () => void;
  onDelete?: () => Promise<void> | void;
  deleteTitle?: string;
  deleteDescription?: string;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!onDelete || deleting) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  return (
    <>
    <EntityModalShell
      icon={kind === "project" ? FolderKanban : ListTodo}
      label={kind}
      onClose={onClose}
      headerRight={
        <>
          {saveStatus}

          {onToggleComplete && (
            <button
              type="button"
              onClick={onToggleComplete}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                completed
                  ? "bg-success/15 text-success hover:bg-success/25"
                  : "bg-foreground text-background hover:opacity-90"
              }`}
            >
              <Check className="size-4" />
              {completed ? "Completed" : "Mark complete"}
            </button>
          )}

          {onDelete && (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="size-4" />
              Delete
            </button>
          )}
        </>
      }
    >
      {children}
    </EntityModalShell>
    {confirmingDelete ? (
      <ConfirmDialog
        title={deleteTitle}
        description={deleteDescription}
        pending={deleting}
        onCancel={() => {
          if (!deleting) setConfirmingDelete(false);
        }}
        onConfirm={() => void confirmDelete()}
      />
    ) : null}
    </>
  );
}
