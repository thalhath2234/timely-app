"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  Flag,
  FolderKanban,
  Link2,
  ListTodo,
  Trash2,
} from "lucide-react";
import CustomFieldControl, {
  findCustomFieldDraft,
  toCustomFieldDrafts,
  withCustomFieldDraft,
} from "@/app/_components/_ui/customFieldControl";
import DatePicker from "@/app/_components/_ui/datePicker";
import TaskScheduleSection, { TaskRepeatRow } from "@/app/_components/_ui/tasks/taskScheduleSection";
import { GroupHint, GroupLabel, ListGroup, ListRow } from "@/app/_components/_ui/groupedList";
import TaskTypeToggle from "@/app/_components/_ui/tasks/taskTypeToggle";
import {
  EntityModalShell,
  ModalMain,
  ModalSidebar,
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
  useDuplicateTask,
  useTaskActivity,
  useTask,
  useTasks,
  useUpdateTask,
} from "@/app/utils/hooks/tasks";
import { useWorkingHoursZone, useWorkspaces } from "@/app/utils/hooks/workspaces";
import { formatActivityTime } from "@/app/utils/activityTime";
import { useMe } from "@/app/utils/hooks/user";
import {
  applyClockToDate,
  dateFromDateInput,
  formatDuration,
  localDateStamp,
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
import { showUndoToast, useToastStore } from "@/app/_store/toastStore";
import TaskExecution from "@/app/_components/_ui/tasks/taskExecution";
import RelatedItems from "@/app/_components/_ui/relatedItems";
import TaskHints from "@/app/_components/_ui/tasks/taskHints";
import { runViewTransition } from "@/app/utils/viewTransition";
import {
  attachMorphTarget,
  beginCloseMorph,
  detachMorphTarget,
  entityTitleKey,
} from "@/app/utils/titleMorph";
import { buttonClass } from "@/app/_components/_ui/button";
import { PRIORITY_OPTIONS, normalizePriority, priorityColor } from "@/app/utils/priority";
import { isOverdue } from "@timely/contract/workStatus";

const DURATION_STEPS = [15, 30, 45, 60, 90, 120, 180, 240, 480];

function durationOptions(current: number) {
  const steps = current > 0 && !DURATION_STEPS.includes(current) ? [...DURATION_STEPS, current].sort((a, b) => a - b) : DURATION_STEPS;
  return steps.map((minutes) => ({ value: String(minutes), label: formatDuration(minutes) }));
}

const PRIORITY_ROW_OPTIONS = PRIORITY_OPTIONS.map((option) => ({
  ...option,
  icon: <Flag style={{ color: priorityColor(option.value) ?? undefined }} />,
}));

/** Only High and Urgent tint their value, so the card stays calm. */
function priorityTint(priority: string) {
  return priority === "High" || priority === "Urgent" ? priorityColor(priority) ?? undefined : undefined;
}

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
  /** 0 clears it. */
  preferredChunkMinutes?: number;
  /** Empty string clears it. */
  earliestStartAt?: string;
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
    kind === "task" ? id : undefined,
  );
  const task = fetchedTask ?? listedTask;
  const project =
    kind === "project"
      ? ((projects ?? []) as Project[]).find((item) => item.id === id)
      : undefined;

  const isLoading =
    kind === "task"
      ? !listedTask && (tasksLoading || taskLoading)
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
  const duplicateTask = useDuplicateTask();
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
      onDuplicate={() =>
        void duplicateTask.mutateAsync(task.id).then((copy) => {
          showUndoToast(`Duplicated “${copy.name}”`);
        })
      }
      onCopyLink={() => {
        void navigator.clipboard
          .writeText(
            `${window.location.origin}/tasks?taskId=${encodeURIComponent(task.id)}`,
          )
          .then(() => {
            useToastStore.getState().show("Link copied");
          })
          .catch(() => {
            useToastStore.getState().show("Could not copy link");
          });
      }}
    >
      <TaskExecution task={task} />
      {task.kind !== "inbox" && <RelatedItems kind="task" id={task.id} section />}
    </DetailBody>
  );
}

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
          <GroupLabel aside={String(projectTasks.length)}>Tasks in this project</GroupLabel>
          <ul className="flex flex-col gap-1">
            {projectTasks.map((task) => (
              <li key={task.id}>
                <ProjectTaskLink task={task} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <RelatedItems kind="project" id={project.id} section />
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

function DetailBody({
  view,
  save,
  onLabelsChange,
  onClose,
  onDelete,
  onDuplicate,
  onCopyLink,
  children,
}: {
  view: DetailView;
  save: (patch: DetailPatch) => Promise<unknown>;
  onLabelsChange?: (ids: string[]) => void;
  onClose: () => void;
  onDelete?: () => Promise<void> | void;
  onDuplicate?: () => void;
  onCopyLink?: () => void;
  children?: React.ReactNode;
}) {
  const { data: workspaces } = useWorkspaces();
  const timeZone = useWorkingHoursZone();
  const { data: me } = useMe();
  const { data: tasks } = useTasks();
  const [title, setTitle] = useState(view.title);
  const titleRef = useRef<HTMLInputElement>(null);
  const [labelIds, setLabelIds] = useState(view.labelIds ?? []);
  const [descriptionDirty, setDescriptionDirty] = useState(false);
  const [descriptionSaving, setDescriptionSaving] = useState(false);
  const descriptionDraftRef = useRef<{
    content: DocContent;
    plainText: string;
  } | null>(null);
  const descriptionSavePromiseRef = useRef<Promise<void> | null>(null);

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

  const filledFieldIds = useMemo(
    () =>
      new Set(
        customFieldValues
          .filter((draft) => (draft.stringValue ?? "") !== "" || (draft.optionsValue ?? []).length > 0)
          .map((draft) => draft.id),
      ),
    [customFieldValues],
  );

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

  const saveDescription = () => {
    if (descriptionSavePromiseRef.current) {
      return descriptionSavePromiseRef.current;
    }
    const draft = descriptionDraftRef.current;
    if (!draft) return Promise.resolve();

    setDescriptionSaving(true);
    const work = (async () => {
      try {
        await save({
          descriptionRich: draft.content,
          description: draft.plainText,
        });
        setDescriptionDirty(false);
      } finally {
        setDescriptionSaving(false);
        descriptionSavePromiseRef.current = null;
      }
    })();
    descriptionSavePromiseRef.current = work;
    return work;
  };

  // Closing the panel or switching to another item keeps unsaved description
  // text: it saves on the way out, unless the item is being deleted.
  const descriptionDirtyRef = useRef(false);
  const saveDescriptionRef = useRef(saveDescription);
  const deletingRef = useRef(false);
  useEffect(() => {
    descriptionDirtyRef.current = descriptionDirty;
    saveDescriptionRef.current = saveDescription;
  });
  useEffect(
    () => () => {
      if (descriptionDirtyRef.current && !deletingRef.current) void saveDescriptionRef.current();
    },
    [],
  );
  const deleteItem = onDelete
    ? async () => {
        deletingRef.current = true;
        try {
          await onDelete();
        } catch (err) {
          deletingRef.current = false;
          throw err;
        }
      }
    : undefined;

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
  const stageName = stageOptions.find((stage) => stage.id === view.stageId)?.name;
  const createdLabel = view.createdAt
    ? `Created ${new Date(view.createdAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })}${me?.name ? ` by @${me.name}` : ""}`
    : "";

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

  // The list title morphs into this input on open and back on close.
  const morphKey = entityTitleKey(view.kind, view.id);
  useLayoutEffect(() => {
    const input = titleRef.current;
    if (!input) return;
    attachMorphTarget(input);
    return () => detachMorphTarget(input);
  }, []);
  const closeWithMorph = () => {
    if (descriptionDirtyRef.current) {
      descriptionDirtyRef.current = false;
      void saveDescription();
    }
    beginCloseMorph(titleRef.current, morphKey);
    onClose();
  };

  return (
    <PanelShell
      kind={view.kind}
      completed={Boolean(view.completedAt)}
      saveStatus={<SaveStatusBadge status={status} onRetry={() => void flush()} />}
      crumbs={{
        workspace: workspaceName !== "-" ? workspaceName : view.kind === "project" ? title : "",
        project: view.kind === "task" && projectName !== "-" ? projectName : "",
        stage: stageName ?? "",
      }}
      onToggleComplete={toggleComplete}
      onClose={closeWithMorph}
      onDelete={deleteItem}
      onDuplicate={onDuplicate}
      onCopyLink={onCopyLink}
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
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {stageName ? (
            <span className="rounded border border-primary/20 bg-primary/10 px-2 py-0.5 tabular-nums text-[11px] font-semibold uppercase tracking-wider text-primary">
              {stageName}
            </span>
          ) : null}
          {createdLabel ? (
            <span className="text-xs text-muted-foreground">{createdLabel}</span>
          ) : null}
        </div>
        <input
          ref={titleRef}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            schedule({ title: event.target.value });
          }}
          onBlur={() => void flush()}
          placeholder="Untitled"
          className="w-full bg-transparent text-2xl font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/50"
        />

        <div className="mt-4 flex min-h-52 shrink-0 flex-col">
          <div className="flex min-h-0 flex-1 flex-col">
            <RichTextEditor
              key={view.id}
              variant="compact"
              toolbar="fixed"
              syncKey={view.id}
              content={toRichContent(view.descriptionRich, view.description)}
              placeholder="Description"
              writeContext={{ kind: view.kind, title }}
              onChange={(draft) => {
                descriptionDraftRef.current = draft;
                setDescriptionDirty(true);
              }}
            />
          </div>
          {descriptionDirty ? (
            <div className="mt-2 flex shrink-0 justify-end">
              <button
                type="button"
                disabled={descriptionSaving}
                onClick={() => void saveDescription()}
                className={buttonClass({ size: "sm" })}
              >
                {descriptionSaving ? "Saving..." : "Save"}
              </button>
            </div>
          ) : null}
        </div>

        <div className="mt-5">
          {view.kind === "task" && !isInbox && !isReminder && (
            <TaskHints
              taskId={view.id}
              version={`${view.description.length}:${view.description.slice(-40)}:${view.completedAt ?? ""}:${view.blockedById ?? ""}:${view.stageId ?? ""}:${view.duration ?? 0}`}
              statusId={view.statusId}
              stageId={view.stageId}
              blockedById={view.blockedById}
              statusOptions={statusOptions}
              stageOptions={stageOptions}
              customFields={customFields}
              filledFieldIds={filledFieldIds}
              onStatus={(statusId) => {
                const next = statusOptions.find((option) => option.id === statusId);
                const completing = next ? isCompletedStatus(next) : false;
                commit({
                  statusId,
                  ...(completing && !view.completedAt
                    ? { completedAt: new Date().toISOString() }
                    : !completing && view.completedAt
                      ? { completedAt: "" }
                      : {}),
                });
              }}
              onStage={(stageId) => commit({ stageId })}
              onField={(field, next) => {
                changeCustomField(field, next);
                void flush();
              }}
              onBlocker={(blockedById) => commit({ blockedById })}
              contiguous={view.contiguous}
              hasPreferredWindows={(view.preferredWindows ?? []).length > 0}
              onOneSitting={() => commit({ contiguous: true })}
              onPreferredWindow={(window) => commit({ preferredWindows: [window] })}
            />
          )}
          {children}
        </div>

        <section className="mt-6">
          <GroupLabel>Activity</GroupLabel>
          {view.kind === "task" ? (
            <TaskActivityFeed taskId={view.id} />
          ) : (
            <p className="text-xs text-muted-foreground">
              Created {formatActivityTime(view.createdAt, timeZone)}
              {view.updatedAt && view.updatedAt !== view.createdAt
                ? ` · Updated ${formatActivityTime(view.updatedAt, timeZone)}`
                : ""}
              {view.completedAt
                ? ` · Completed ${formatActivityTime(view.completedAt, timeZone)}`
                : ""}
            </p>
          )}
        </section>
      </ModalMain>

      <ModalSidebar>
        <div className="flex flex-col gap-4">
          <div>
            <ListGroup>
              {view.kind === "task" ? (
                <ListRow label="Type">
                  <TaskTypeToggle
                    className="w-48"
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
                </ListRow>
              ) : null}
              {!isReminder && view.kind === "task" ? (
                <ListRow label="Workspace">
                  <Select
                    variant="row"
                    aria-label="Workspace"
                    value={view.workspaceId ?? ""}
                    onChange={onWorkspaceChange}
                    placeholder="Select"
                    options={typedWorkspaces.map((space) => ({
                      value: space.id,
                      label: space.name,
                      color: space.color ?? undefined,
                    }))}
                  />
                </ListRow>
              ) : null}
              {view.kind === "project" ? (
                <ListRow label="Workspace">
                  <span className="truncate text-[13px] font-medium text-muted-foreground">{workspaceName}</span>
                </ListRow>
              ) : null}
              {view.kind === "project" ? (
                <ListRow label="Colour">
                  <ColorPicker
                    variant="row"
                    value={view.color || "#30A66D"}
                    onChange={(color) => schedule({ color })}
                    aria-label="Project colour"
                  />
                </ListRow>
              ) : null}
              {!isReminder ? (
                <ListRow label="Status">
                  <Select
                    variant="row"
                    aria-label="Status"
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
                    placeholder="None"
                    options={[
                      { value: "", label: "None" },
                      ...statusOptions.map((option) => ({
                        value: option.id,
                        label: option.name,
                        color: option.color,
                      })),
                    ]}
                  />
                </ListRow>
              ) : null}
              <ListRow label="Priority">
                <Select
                  variant="row"
                  aria-label="Priority"
                  value={normalizePriority(view.priorityLevel)}
                  tint={priorityTint(normalizePriority(view.priorityLevel))}
                  onChange={(priorityLevel) => schedule({ priorityLevel })}
                  placeholder="None"
                  options={[{ value: "", label: "None" }, ...PRIORITY_ROW_OPTIONS]}
                />
              </ListRow>
              {!isReminder && view.kind === "task" ? (
                <ListRow label="Project">
                  <Select
                    variant="row"
                    aria-label="Project"
                    value={view.projectId ?? ""}
                    onChange={onProjectChange}
                    placeholder="None"
                    options={[
                      { value: "", label: "None" },
                      ...projectsInWorkspace.map((project) => ({
                        value: project.id,
                        label: project.title,
                        color: project.color ?? undefined,
                      })),
                    ]}
                  />
                </ListRow>
              ) : null}
              {!isReminder && view.kind === "task" && stageOptions.length > 0 ? (
                <ListRow label="Stage">
                  <Select
                    variant="row"
                    aria-label="Stage"
                    value={view.stageId ?? ""}
                    onChange={(stageId) => schedule({ stageId })}
                    placeholder="None"
                    options={[
                      { value: "", label: "None" },
                      ...stageOptions.map((stage) => ({
                        value: stage.id,
                        label: stage.name,
                        color: stage.color ?? undefined,
                      })),
                    ]}
                  />
                </ListRow>
              ) : null}
              {!isReminder && view.kind === "task" ? (
                <ListRow label="Blocked by">
                  <Select
                    variant="row"
                    aria-label="Blocked by"
                    value={view.blockedById ?? ""}
                    onChange={(blockedById) => schedule({ blockedById })}
                    placeholder="None"
                    options={[
                      { value: "", label: "None" },
                      ...otherTasks.map((task) => ({
                        value: task.id,
                        label: task.name,
                      })),
                    ]}
                  />
                </ListRow>
              ) : null}
              {view.kind === "task" && !isInbox && !isReminder ? (
                <ListRow label="Duration">
                  <Select
                    variant="row"
                    aria-label="Duration"
                    value={String(view.duration ?? 30)}
                    onChange={(value) => schedule({ duration: Math.max(15, Number(value) || 30) })}
                    options={durationOptions(view.duration ?? 30)}
                  />
                </ListRow>
              ) : null}
              {!isReminder && view.kind === "task" ? (
                <ListRow label="Labels">
                  <Select
                    variant="row"
                    aria-label="Labels"
                    value=""
                    values={labelIds}
                    placeholder={labelOptions.length ? "None" : "No labels yet"}
                    onChange={(labelId) => {
                      const ids = labelIds.includes(labelId)
                        ? labelIds.filter((id) => id !== labelId)
                        : [...labelIds, labelId];
                      setLabelIds(ids);
                      onLabelsChange?.(ids);
                      schedule({ labelIds: ids.map((id) => ({ id })) });
                    }}
                    options={labelOptions.map((label) => ({ value: label.id, label: label.name, color: label.color }))}
                  />
                </ListRow>
              ) : null}
            </ListGroup>
            {view.kind === "task" ? (
              <GroupHint>
                {isInbox
                  ? "Assign a workspace to put this on the board, or choose Reminder for a ping."
                  : isReminder
                    ? "Pings at a chosen time. Does not reserve a work block."
                    : "Work is estimated minutes the scheduler can place."}
                {!isReminder && blockingTasks.length > 0
                  ? ` Waiting on this: ${blockingTasks.map((task) => task.name).join(", ")}.`
                  : ""}
              </GroupHint>
            ) : null}
          </div>

          <div>
            <GroupLabel>Dates</GroupLabel>
            <ListGroup>
              <ListRow label="Start date">
                <DatePicker
                  variant="row"
                  mode="date"
                  aria-label="Start date"
                  value={toDateInputValue(view.startDate)}
                  onChange={(startDate) => {
                    const deadline = toDateInputValue(view.deadline);
                    if (startDate && deadline && startDate > deadline) {
                      useToastStore
                        .getState()
                        .show(`Start date can’t be after the deadline (${shortDay(deadline)}).`);
                      return;
                    }
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
              </ListRow>
              <ListRow label="Deadline">
                <DatePicker
                  variant="row"
                  mode="date"
                  aria-label="Deadline"
                  className={
                    isOverdue(
                      { deadline: view.deadline, completedAt: view.completedAt, kind: view.taskKind },
                      localDateStamp(),
                    )
                      ? "text-destructive hover:text-destructive"
                      : undefined
                  }
                  value={toDateInputValue(view.deadline)}
                  onChange={(deadline) => {
                    const startDate = toDateInputValue(view.startDate);
                    if (deadline && startDate && deadline < startDate) {
                      useToastStore
                        .getState()
                        .show(`Deadline can’t be before the start date (${shortDay(startDate)}).`);
                      return;
                    }
                    schedule({ deadline });
                  }}
                />
              </ListRow>
              {view.kind === "task" && !isInbox ? (
                <TaskRepeatRow
                  recurrence={view.recurrence}
                  scheduledOn={view.scheduledOn}
                  onRecurrenceChange={(recurrence) => {
                    schedule({ recurrence });
                    void flush();
                  }}
                />
              ) : null}
            </ListGroup>
          </div>

          {view.kind === "task" && !isInbox ? (
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

          {view.kind === "task" && !isReminder && customFields.length > 0 ? (
            <div>
              <GroupLabel aside={String(customFields.length)}>Custom fields</GroupLabel>
              <ListGroup>
                {customFields.map((field) => (
                  <ListRow key={field.id} label={field.name}>
                    <CustomFieldControl
                      variant="row"
                      field={field}
                      value={findCustomFieldDraft(customFieldValues, field.id)}
                      onChange={(next) => changeCustomField(field, next)}
                    />
                  </ListRow>
                ))}
              </ListGroup>
            </div>
          ) : null}
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
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading activity...</p>
      ) : (
        <ol className="mb-4 flex flex-col gap-3">
          {(entries ?? []).map((entry) => (
            <TaskActivityItem key={entry.id} entry={entry} />
          ))}
        </ol>
      )}

      <div className="rounded-xl border border-border bg-muted/20 px-3 py-2.5">
        <textarea
          rows={2}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          onKeyDown={onCommentKeyDown}
          placeholder="Add a comment..."
          className="w-full resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          {addComment.isError ? (
            <span className="text-destructive">Could not post comment</span>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!comment.trim() || addComment.isPending}
            className={buttonClass({ size: "sm" })}
          >
            {addComment.isPending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </>
  );
}

function TaskActivityItem({ entry }: { entry: TaskActivity }) {
  const isComment = entry.action === "commented";
  const timeZone = useWorkingHoursZone();

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
          {formatActivityTime(entry.createdAt, timeZone)}
        </p>
      </div>
    </li>
  );
}

function PanelShell({
  children,
  onClose,
  saveStatus,
  crumbs,
  kind = "task",
  completed = false,
  onToggleComplete,
  onDelete,
  onDuplicate,
  onCopyLink,
  deleteTitle = "Delete this task?",
  deleteDescription = "This cannot be undone.",
}: {
  children: React.ReactNode;
  onClose: () => void;
  saveStatus?: React.ReactNode;
  crumbs?: { workspace?: string; project?: string; stage?: string };
  kind?: "task" | "project";
  completed?: boolean;
  onToggleComplete?: () => void;
  onDelete?: () => Promise<void> | void;
  onDuplicate?: () => void;
  onCopyLink?: () => void;
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
      runViewTransition(() => setConfirmingDelete(false));
    }
  };

  const crumbParts = [crumbs?.workspace, crumbs?.project, crumbs?.stage].filter(
    Boolean,
  ) as string[];

  const iconButtonClass = buttonClass({ variant: "ghost", size: "sm", icon: true });

  return (
    <>
      <EntityModalShell
        icon={kind === "project" ? FolderKanban : ListTodo}
        label={kind}
        size="xl"
        onClose={onClose}
        headerLeft={
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
            {crumbParts.map((part, index) => (
              <span key={`${part}-${index}`} className="inline-flex min-w-0 items-center gap-1.5">
                {index > 0 ? <span className="text-muted-foreground/50">/</span> : null}
                <span className="truncate font-medium text-foreground/80">{part}</span>
              </span>
            ))}
          </div>
        }
        headerRight={
          <>
            {saveStatus}

            {onToggleComplete ? (
              <button
                type="button"
                onClick={onToggleComplete}
                className={buttonClass({ variant: completed ? "outline" : "primary", size: "sm" })}
              >
                <Check className={completed ? "text-success" : undefined} />
                {completed ? "Completed" : "Mark complete"}
              </button>
            ) : null}

            {onDuplicate ? (
              <button
                type="button"
                onClick={onDuplicate}
                title="Duplicate"
                className={iconButtonClass}
              >
                <Copy className="size-3.5" />
              </button>
            ) : null}

            {onCopyLink ? (
              <button
                type="button"
                onClick={onCopyLink}
                title="Copy link"
                className={iconButtonClass}
              >
                <Link2 className="size-3.5" />
              </button>
            ) : null}

            {onDelete ? (
              <button
                type="button"
                onClick={() => runViewTransition(() => setConfirmingDelete(true))}
                title="Delete"
                className={buttonClass({ variant: "destructive-ghost", size: "sm", icon: true })}
              >
                <Trash2 className="size-3.5" />
              </button>
            ) : null}
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
            if (!deleting) runViewTransition(() => setConfirmingDelete(false));
          }}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </>
  );
}

/** "Fri 16 Oct" for a YYYY-MM-DD date, in the person's own calendar day. */
function shortDay(value: string) {
  return dateFromDateInput(value).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
