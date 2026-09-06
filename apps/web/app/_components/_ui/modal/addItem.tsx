"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  CalendarDays,
  Circle,
  Clock,
  FileText,
  Flag,
  FolderKanban,
  GitBranch,
  ListTodo,
  Palette,
  Plus,
  Repeat,
  Sheet as SheetIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";
import { useProjects } from "@/app/utils/hooks/projects";
import { useCreateDoc } from "@/app/utils/hooks/docs";
import { useCreateSheet } from "@/app/utils/hooks/sheets";
import { createProject } from "@/app/utils/api/projects";
import { createTask } from "@/app/utils/api/tasks";
import { useCreateEvent } from "@/app/utils/hooks/calendar";
import RecurrenceEditor from "@/app/_components/_ui/recurrenceEditor";
import CustomFieldControl, {
  customFieldIcon,
  emptyCustomFieldDrafts,
  findCustomFieldDraft,
  withCustomFieldDraft,
} from "@/app/_components/_ui/customFieldControl";
import DatePicker from "@/app/_components/_ui/datePicker";
import ColorPicker from "@/app/_components/_ui/colorPicker";
import LabelPicker from "@/app/_components/_ui/labelPicker";
import Select from "@/app/_components/_ui/select";
import {
  CreateCustomFieldInline,
  CreateLabelInline,
} from "@/app/_components/_ui/workspaceQuickCreate";
import RichTextEditor from "@/app/_components/editor/richTextEditor";
import {
  EntityModalShell,
  ModalMain,
  ModalSidebar,
  PropertyRow,
  SidebarSectionTitle,
  modalTitleClass,
} from "@/app/_components/_ui/modal/entityModal";
import {
  CustomField,
  CustomFieldValueInput,
  DocContent,
  Label,
  Project,
  Workspace,
  Status,
} from "@/app/_types/types";
import {
  formatDuration,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from "@/app/utils/calendar";
import { buildRecurrenceInput, type RecurrenceDraft } from "@/app/utils/recurrence";
import { isRichContentEmpty } from "@/app/utils/richText";

const PRIORITY_OPTIONS = [
  { value: "Low", label: "Low" },
  { value: "Medium", label: "Medium" },
  { value: "High", label: "High" },
  { value: "Urgent", label: "Urgent" },
];

interface RichDescription {
  content: DocContent;
  plainText: string;
}

const EMPTY_DESCRIPTION: RichDescription = { content: {}, plainText: "" };

const addWorkspaceSchema = z.object({
  name: z
    .string()
    .min(2, "Workspace name must be at least 2 characters")
    .max(100, "Workspace name must be less than 100 characters"),
});

type AddWorkspaceForm = z.infer<typeof addWorkspaceSchema>;

const customFieldValueSchema = z.object({
  id: z.string(),
  type: z.enum([
    "text",
    "select",
    "multi_select",
    "number",
    "url",
    "date",
    "boolean",
  ]),
  stringValue: z.string().optional(),
  optionsValue: z
    .array(
      z.object({
        id: z.string(),
      }),
    )
    .optional(),
});

const addProjectSchema = z.object({
  title: z
    .string()
    .min(2, "Project name must be at least 2 characters")
    .max(100, "Project name must be less than 100 characters"),
  workspaceId: z.string().min(1, "Please select a workspace"),
  statusId: z.string().optional(),
  priorityLevel: z.string().optional(),
  startDate: z.string().optional(),
  deadline: z.string().optional(),
  color: z
    .string()
    .regex(/^#([0-9a-fA-F]{6})$/, "Color must be a valid hex value")
    .default("#30A66D"),
  doesHaveStages: z.boolean().default(false),
  customFieldValues: z.array(customFieldValueSchema).default([]),
});

type AddProjectForm = z.input<typeof addProjectSchema>;

const addTaskSchema = z.object({
  name: z
    .string()
    .min(2, "Task name must be at least 2 characters")
    .max(100, "Task name must be less than 100 characters"),
  workspaceId: z.string().min(1, "Please select a workspace"),
  projectId: z.string().optional(),
  statusId: z.string().optional(),
  priorityLevel: z.string().optional(),
  startDate: z.string().optional(),
  deadline: z.string().optional(),
  scheduledOn: z.string().optional(),
  duration: z.coerce.number().optional(),
  labelIds: z.array(z.string()).default([]),
  customFieldValues: z.array(customFieldValueSchema).default([]),
});

type AddTaskForm = z.input<typeof addTaskSchema>;

const addPageSchema = z.object({
  title: z
    .string()
    .min(1, "Name is required")
    .max(200, "Name must be less than 200 characters"),
  workspaceId: z.string().min(1, "Please select a workspace"),
});

type AddPageForm = z.infer<typeof addPageSchema>;

const MODE_META: Record<string, { icon: LucideIcon; label: string; action: string }> =
  {
    workspace: { icon: FolderKanban, label: "New workspace", action: "Create workspace" },
    project: { icon: FolderKanban, label: "New project", action: "Create project" },
    task: { icon: ListTodo, label: "New task", action: "Create task" },
    event: { icon: CalendarDays, label: "New event", action: "Create event" },
    doc: { icon: FileText, label: "New doc", action: "Create doc" },
    sheet: { icon: SheetIcon, label: "New sheet", action: "Create sheet" },
  };

export default function AddItemModal() {
  const { isAddItemModalOpen, setIsAddItemModalOpen, addNewMode } =
    useSidebarStore();

  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: workspaces } = useWorkspaces();
  const { data: projects } = useProjects();
  // Kept outside react-hook-form so TipTap can own the document tree.
  const [projectDescription, setProjectDescription] =
    useState<RichDescription>(EMPTY_DESCRIPTION);
  const [taskDescription, setTaskDescription] =
    useState<RichDescription>(EMPTY_DESCRIPTION);
  // Recurrence lives outside the zod schema; it is a structured draft that
  // only becomes an RRULE string on submit.
  const [taskRecurrence, setTaskRecurrence] = useState<RecurrenceDraft | null>(
    null,
  );

  // Event fields. Events are simple enough that plain state beats a resolver.
  const [eventTitle, setEventTitle] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [eventStart, setEventStart] = useState(() =>
    toDatetimeLocalValue(nextRoundHour()),
  );
  const [eventDuration, setEventDuration] = useState(60);
  const [eventAllDay, setEventAllDay] = useState(false);
  const [eventWorkspaceId, setEventWorkspaceId] = useState("");
  const [eventRecurrence, setEventRecurrence] = useState<RecurrenceDraft | null>(
    null,
  );

  // Form for Workspace
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isValid },
  } = useForm<AddWorkspaceForm>({
    resolver: zodResolver(addWorkspaceSchema),
    mode: "onChange",
  });

  // Form for Project
  const {
    register: registerProject,
    handleSubmit: handleProjectSubmit,
    reset: resetProject,
    watch,
    setValue,
    formState: { errors: projectErrors, isValid: isProjectValid },
  } = useForm<AddProjectForm>({
    resolver: zodResolver(addProjectSchema),
    mode: "onChange",
    defaultValues: {
      color: "#30A66D",
      priorityLevel: "Low",
      doesHaveStages: false,
      deadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
    },
  });

  // Form for Task
  const {
    register: registerTask,
    handleSubmit: handleTaskSubmit,
    reset: resetTask,
    watch: watchTask,
    setValue: setValueTask,
    formState: { errors: taskErrors, isValid: isTaskValid },
  } = useForm<AddTaskForm>({
    resolver: zodResolver(addTaskSchema),
    mode: "onChange",
    defaultValues: {
      duration: 30,
      priorityLevel: "Medium",
      labelIds: [],
    },
  });

  // Shared form for the Doc and Sheet modes, which need only a name and a
  // workspace before the editor takes over.
  const {
    register: registerPage,
    handleSubmit: handlePageSubmit,
    reset: resetPage,
    setValue: setValuePage,
    watch: watchPage,
    formState: { errors: pageErrors, isValid: isPageValid },
  } = useForm<AddPageForm>({
    resolver: zodResolver(addPageSchema),
    mode: "onChange",
  });

  const selectedWorkspaceId = watch("workspaceId");
  const projectStatusId = watch("statusId") ?? "";
  const projectPriorityLevel = watch("priorityLevel") ?? "Low";
  const projectStartDate = watch("startDate") ?? "";
  const projectDeadline = watch("deadline") ?? "";
  const projectColor = watch("color") ?? "#30A66D";
  const selectedTaskWorkspaceId = watchTask("workspaceId");
  const taskProjectId = watchTask("projectId") ?? "";
  const taskStatusId = watchTask("statusId") ?? "";
  const taskPriorityLevel = watchTask("priorityLevel") ?? "Medium";
  const taskStartDate = watchTask("startDate") ?? "";
  const taskDeadline = watchTask("deadline") ?? "";
  const taskScheduledOn = watchTask("scheduledOn") ?? "";
  const taskLabelIds = watchTask("labelIds") ?? [];
  const selectedPageWorkspaceId = watchPage("workspaceId");

  const typedWorkspaces = useMemo(
    () => (workspaces ?? []) as Workspace[],
    [workspaces],
  );
  const typedProjects = useMemo(
    () => (projects ?? []) as Project[],
    [projects],
  );

  const selectedWorkspace = useMemo(
    () =>
      typedWorkspaces.find((workspace) => workspace.id === selectedWorkspaceId),
    [typedWorkspaces, selectedWorkspaceId],
  );

  const selectedTaskWorkspace = useMemo(
    () =>
      typedWorkspaces.find(
        (workspace) => workspace.id === selectedTaskWorkspaceId,
      ),
    [typedWorkspaces, selectedTaskWorkspaceId],
  );

  const availableTaskProjects = useMemo(
    () =>
      typedProjects.filter(
        (p) =>
          !selectedTaskWorkspaceId || p.workspaceId === selectedTaskWorkspaceId,
      ),
    [typedProjects, selectedTaskWorkspaceId],
  );

  const createWorkspaceMutation = useMutation({
    mutationFn: async (data: AddWorkspaceForm) => {
      const response = await fetch("http://localhost:8080/workspaces", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: data.name,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create workspace");
      }

      return response.json();
    },

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces"],
      });

      closeModal();
    },
  });

  const onSubmit = (data: AddWorkspaceForm) => {
    createWorkspaceMutation.mutate(data);
  };

  const createProjectMutation = useMutation({
    mutationFn: createProject,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["projects"],
      });

      closeModal();
    },
  });

  const onProjectSubmit = (data: AddProjectForm) => {
    const hasDescription =
      !isRichContentEmpty(projectDescription.content) ||
      projectDescription.plainText.trim().length > 0;

    createProjectMutation.mutate({
      ...data,
      description: hasDescription ? projectDescription.plainText : undefined,
      descriptionRich: hasDescription
        ? projectDescription.content
        : undefined,
    });
  };

  const createTaskMutation = useMutation({
    mutationFn: createTask,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["tasks"],
      });
      closeModal();
    },
  });

  // The first occurrence of a repeating task is the "Schedule" time when set,
  // otherwise the next round hour, so the series starts somewhere sensible.
  const taskRecurrenceAnchor = useMemo(
    () => (taskScheduledOn ? new Date(taskScheduledOn) : nextRoundHour()),
    [taskScheduledOn],
  );

  const onTaskSubmit = (data: AddTaskForm) => {
    const hasDescription =
      !isRichContentEmpty(taskDescription.content) ||
      taskDescription.plainText.trim().length > 0;
    const recurrence = buildRecurrenceInput(taskRecurrence, taskRecurrenceAnchor);

    createTaskMutation.mutate({
      name: data.name,
      description: hasDescription ? taskDescription.plainText : "",
      descriptionRich: hasDescription ? taskDescription.content : undefined,
      workspaceId: data.workspaceId,
      projectId: data.projectId || undefined,
      statusId: data.statusId || undefined,
      priorityLevel: data.priorityLevel || undefined,
      startDate: data.startDate || undefined,
      deadline: data.deadline || undefined,
      // A repeating task is placed by its rule, not by a pinned block.
      scheduledOn:
        !recurrence && data.scheduledOn
          ? fromDatetimeLocalValue(data.scheduledOn)
          : undefined,
      duration: data.duration ? Number(data.duration) : 0,
      labelIds: (data.labelIds ?? taskLabelIds ?? []).map((id) => ({ id })),
      customFieldValues: data.customFieldValues,
      recurrence: recurrence ?? undefined,
    });
  };

  const createEventMutation = useCreateEvent();
  const eventStartDate = useMemo(
    () => (eventStart ? new Date(fromDatetimeLocalValue(eventStart)) : nextRoundHour()),
    [eventStart],
  );
  const isEventValid = eventTitle.trim().length > 0 && Boolean(eventStart);

  const onEventSubmit = async (submit: React.FormEvent<HTMLFormElement>) => {
    submit.preventDefault();
    if (!isEventValid) return;
    const minutes = Math.max(15, eventDuration || 60);
    await createEventMutation.mutateAsync({
      title: eventTitle.trim(),
      description: eventDescription.trim() || undefined,
      start: eventStartDate.toISOString(),
      end: new Date(eventStartDate.getTime() + minutes * 60_000).toISOString(),
      allDay: eventAllDay,
      workspaceId: eventWorkspaceId || undefined,
      recurrence: buildRecurrenceInput(eventRecurrence, eventStartDate) ?? undefined,
    });
    closeModal();
  };

  const createDocMutation = useCreateDoc();

  const onDocSubmit = async (data: AddPageForm) => {
    const doc = await createDocMutation.mutateAsync({
      title: data.title,
      workspaceId: data.workspaceId,
    });

    closeModal();
    router.push(`/docs/${doc.id}`);
  };

  const createSheetMutation = useCreateSheet();

  const onSheetSubmit = async (data: AddPageForm) => {
    const sheet = await createSheetMutation.mutateAsync({
      title: data.title,
      workspaceId: data.workspaceId,
    });

    closeModal();
    router.push(`/sheets/${sheet.id}`);
  };

  const closeModal = () => {
    reset();
    resetProject();
    resetTask();
    resetPage();
    setProjectDescription(EMPTY_DESCRIPTION);
    setTaskDescription(EMPTY_DESCRIPTION);
    setTaskRecurrence(null);
    setEventTitle("");
    setEventDescription("");
    setEventStart(toDatetimeLocalValue(nextRoundHour()));
    setEventDuration(60);
    setEventAllDay(false);
    setEventWorkspaceId("");
    setEventRecurrence(null);
    setIsAddItemModalOpen(false);
  };

  // Sync Project Workspace & Status
  useEffect(() => {
    if (
      isAddItemModalOpen &&
      addNewMode === "project" &&
      typedWorkspaces.length > 0
    ) {
      if (
        !selectedWorkspaceId ||
        !typedWorkspaces.some((w) => w.id === selectedWorkspaceId)
      ) {
        setValue("workspaceId", typedWorkspaces[0].id, {
          shouldValidate: true,
        });
      }
    }
  }, [
    isAddItemModalOpen,
    addNewMode,
    typedWorkspaces,
    selectedWorkspaceId,
    setValue,
  ]);

  useEffect(() => {
    if (!selectedWorkspace) return;

    const defaultStatus =
      selectedWorkspace.status?.find((status) => status.isDefault) ??
      selectedWorkspace.status?.[0];

    if (defaultStatus) {
      setValue("statusId", defaultStatus.id, {
        shouldValidate: true,
      });
    }

    setValue(
      "customFieldValues",
      emptyCustomFieldDrafts(selectedWorkspace.customFields),
    );
    // Reset only when switching workspace. Creating a field refetches the
    // workspace object and must not wipe values already entered.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by workspace id
  }, [selectedWorkspace?.id, setValue]);

  // Sync Task Workspace & Status
  useEffect(() => {
    if (
      isAddItemModalOpen &&
      addNewMode === "task" &&
      typedWorkspaces.length > 0
    ) {
      if (
        !selectedTaskWorkspaceId ||
        !typedWorkspaces.some((w) => w.id === selectedTaskWorkspaceId)
      ) {
        setValueTask("workspaceId", typedWorkspaces[0].id, {
          shouldValidate: true,
        });
      }
    }
  }, [
    isAddItemModalOpen,
    addNewMode,
    typedWorkspaces,
    selectedTaskWorkspaceId,
    setValueTask,
  ]);

  useEffect(() => {
    if (!selectedTaskWorkspace) return;

    const defaultStatus =
      selectedTaskWorkspace.status?.find((status) => status.isDefault) ??
      selectedTaskWorkspace.status?.[0];

    if (defaultStatus) {
      setValueTask("statusId", defaultStatus.id, {
        shouldValidate: true,
      });
    }

    setValueTask(
      "customFieldValues",
      emptyCustomFieldDrafts(selectedTaskWorkspace.customFields),
    );
    setValueTask("labelIds", [], { shouldValidate: true });
    // Keyed by workspace id so creating a label/field does not reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by workspace id
  }, [selectedTaskWorkspace?.id, setValueTask]);

  // Sync Doc / Sheet Workspace
  useEffect(() => {
    if (
      isAddItemModalOpen &&
      (addNewMode === "doc" || addNewMode === "sheet") &&
      typedWorkspaces.length > 0
    ) {
      if (
        !selectedPageWorkspaceId ||
        !typedWorkspaces.some((w) => w.id === selectedPageWorkspaceId)
      ) {
        setValuePage("workspaceId", typedWorkspaces[0].id, {
          shouldValidate: true,
        });
      }
    }
  }, [
    isAddItemModalOpen,
    addNewMode,
    typedWorkspaces,
    selectedPageWorkspaceId,
    setValuePage,
  ]);

  const projectCustomFieldValues = watch("customFieldValues") ?? [];
  const changeProjectCustomField = (
    field: CustomField,
    next: Pick<CustomFieldValueInput, "stringValue" | "optionsValue">,
  ) => {
    setValue(
      "customFieldValues",
      withCustomFieldDraft(projectCustomFieldValues, field, next),
      { shouldValidate: true },
    );
  };
  const addProjectCustomField = (field: CustomField) => {
    setValue(
      "customFieldValues",
      withCustomFieldDraft(projectCustomFieldValues, field, {
        stringValue: "",
        optionsValue: [],
      }),
      { shouldValidate: true, shouldDirty: true },
    );
  };

  const taskCustomFieldValues = watchTask("customFieldValues") ?? [];
  const changeTaskCustomField = (
    field: CustomField,
    next: Pick<CustomFieldValueInput, "stringValue" | "optionsValue">,
  ) => {
    setValueTask(
      "customFieldValues",
      withCustomFieldDraft(taskCustomFieldValues, field, next),
      { shouldValidate: true },
    );
  };
  const addTaskCustomField = (field: CustomField) => {
    setValueTask(
      "customFieldValues",
      withCustomFieldDraft(taskCustomFieldValues, field, {
        stringValue: "",
        optionsValue: [],
      }),
      { shouldValidate: true, shouldDirty: true },
    );
  };
  const addTaskLabel = (label: Label) => {
    if (taskLabelIds.includes(label.id)) return;
    setValueTask("labelIds", [...taskLabelIds, label.id], {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  if (!isAddItemModalOpen) return null;

  const meta = MODE_META[addNewMode] ?? MODE_META.task;

  if (addNewMode === "workspace") {
    return (
      <EntityModalShell
        icon={meta.icon}
        label={meta.label}
        onClose={closeModal}
        headerRight={
          <CreateAction
            formId="create-workspace"
            label={meta.action}
            pending={createWorkspaceMutation.isPending}
            disabled={!isValid}
            failed={createWorkspaceMutation.isError}
          />
        }
      >
        <form
          id="create-workspace"
          onSubmit={handleSubmit(onSubmit)}
          className="contents"
        >
          <ModalMain>
            <input
              autoFocus
              {...register("name")}
              placeholder="Workspace name"
              className={modalTitleClass}
            />

            {errors.name && (
              <p className="mt-2 text-xs text-destructive">
                {errors.name.message}
              </p>
            )}

            <p className="mt-4 max-w-md text-sm text-muted-foreground">
              A workspace holds its own projects, tasks, statuses, labels and
              custom fields. You can add those from settings once it exists.
            </p>
          </ModalMain>
        </form>
      </EntityModalShell>
    );
  }

  if (addNewMode === "project") {
    return (
      <EntityModalShell
        icon={meta.icon}
        label={meta.label}
        onClose={closeModal}
        headerRight={
          <CreateAction
            formId="create-project"
            label={meta.action}
            pending={createProjectMutation.isPending}
            disabled={!isProjectValid}
            failed={createProjectMutation.isError}
          />
        }
      >
        <form
          id="create-project"
          onSubmit={handleProjectSubmit(onProjectSubmit)}
          className="contents"
        >
          <ModalMain>
            <input
              autoFocus
              {...registerProject("title")}
              placeholder="Project name"
              className={modalTitleClass}
            />

            {projectErrors.title && (
              <p className="mt-2 text-xs text-destructive">
                {projectErrors.title.message}
              </p>
            )}

            <div className="mt-4 flex h-80 shrink-0 flex-col overflow-hidden rounded-lg border border-border">
              <div className="flex min-h-0 flex-1 flex-col px-3 pt-2">
                <RichTextEditor
                  variant="compact"
                  toolbar="fixed"
                  content={projectDescription.content}
                  placeholder="Description. Type '/' for blocks, '@' to mention docs, sheets, tasks..."
                  onChange={({ content, plainText }) =>
                    setProjectDescription({ content, plainText })
                  }
                />
              </div>
            </div>
          </ModalMain>

          <ModalSidebar>
            <div className="flex flex-col gap-1">
              <PropertyRow icon={FolderKanban} label="Workspace">
                <Select
                  size="sm"
                  value={selectedWorkspaceId ?? ""}
                  onChange={(workspaceId) =>
                    setValue("workspaceId", workspaceId, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                  placeholder="Select workspace"
                  className="border-0 bg-transparent px-0 shadow-none"
                  options={typedWorkspaces.map((workspace) => ({
                    value: workspace.id,
                    label: workspace.name,
                  }))}
                />
              </PropertyRow>

              <PropertyRow icon={Circle} label="Status">
                <Select
                  size="sm"
                  value={projectStatusId}
                  onChange={(statusId) =>
                    setValue("statusId", statusId, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                  placeholder="Select status"
                  className="border-0 bg-transparent px-0 shadow-none"
                  options={(selectedWorkspace?.status ?? []).map(
                    (status: Status) => ({
                      value: status.id,
                      label: status.name,
                      color: status.color,
                    }),
                  )}
                />
              </PropertyRow>

              <PropertyRow icon={Flag} label="Priority">
                <Select
                  size="sm"
                  value={projectPriorityLevel}
                  onChange={(priorityLevel) =>
                    setValue("priorityLevel", priorityLevel, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                  className="border-0 bg-transparent px-0 shadow-none"
                  options={PRIORITY_OPTIONS}
                />
              </PropertyRow>

              <PropertyRow icon={CalendarDays} label="Start date">
                <DatePicker
                  mode="date"
                  value={projectStartDate}
                  onChange={(startDate) =>
                    setValue("startDate", startDate, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                />
              </PropertyRow>

              <PropertyRow icon={CalendarDays} label="Deadline">
                <DatePicker
                  mode="date"
                  value={projectDeadline}
                  onChange={(deadline) =>
                    setValue("deadline", deadline, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                />
              </PropertyRow>

              <PropertyRow icon={Palette} label="Color">
                <ColorPicker
                  value={projectColor}
                  onChange={(color) =>
                    setValue("color", color, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                />
              </PropertyRow>

              <PropertyRow icon={GitBranch} label="Stages">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    {...registerProject("doesHaveStages")}
                    className="size-4 cursor-pointer rounded border-border accent-primary"
                  />
                  Enabled
                </label>
              </PropertyRow>
            </div>

            {projectErrors.workspaceId && (
              <p className="mt-2 px-1 text-xs text-destructive">
                {projectErrors.workspaceId.message}
              </p>
            )}

            <div className="mt-4 border-t border-border pt-3">
              <SidebarSectionTitle>Custom fields</SidebarSectionTitle>
              {(selectedWorkspace?.customFields ?? []).map((field) => (
                <PropertyRow
                  key={field.id}
                  icon={customFieldIcon(field.type)}
                  label={field.name}
                >
                  <CustomFieldControl
                    field={field}
                    value={findCustomFieldDraft(
                      projectCustomFieldValues,
                      field.id,
                    )}
                    onChange={(next) => changeProjectCustomField(field, next)}
                  />
                </PropertyRow>
              ))}
              <CreateCustomFieldInline
                workspaceId={selectedWorkspaceId}
                onCreated={addProjectCustomField}
              />
            </div>
          </ModalSidebar>
        </form>
      </EntityModalShell>
    );
  }

  if (addNewMode === "task") {
    return (
      <EntityModalShell
        icon={meta.icon}
        label={meta.label}
        onClose={closeModal}
        headerRight={
          <CreateAction
            formId="create-task"
            label={meta.action}
            pending={createTaskMutation.isPending}
            disabled={!isTaskValid}
            failed={createTaskMutation.isError}
          />
        }
      >
        <form
          id="create-task"
          onSubmit={handleTaskSubmit(onTaskSubmit)}
          className="contents"
        >
          <ModalMain>
            <input
              autoFocus
              {...registerTask("name")}
              placeholder="Task name"
              className={modalTitleClass}
            />

            {taskErrors.name && (
              <p className="mt-2 text-xs text-destructive">
                {taskErrors.name.message}
              </p>
            )}

            <div className="mt-4 flex h-80 shrink-0 flex-col overflow-hidden rounded-lg border border-border">
              <div className="flex min-h-0 flex-1 flex-col px-3 pt-2">
                <RichTextEditor
                  variant="compact"
                  toolbar="fixed"
                  content={taskDescription.content}
                  placeholder="Description. Type '/' for blocks, '@' to mention docs, sheets, projects..."
                  onChange={({ content, plainText }) =>
                    setTaskDescription({ content, plainText })
                  }
                />
              </div>
            </div>
          </ModalMain>

          <ModalSidebar>
            <div className="flex flex-col gap-1">
              <PropertyRow icon={FolderKanban} label="Workspace">
                <Select
                  size="sm"
                  value={selectedTaskWorkspaceId ?? ""}
                  onChange={(workspaceId) =>
                    setValueTask("workspaceId", workspaceId, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                  placeholder="Select workspace"
                  className="border-0 bg-transparent px-0 shadow-none"
                  options={typedWorkspaces.map((workspace) => ({
                    value: workspace.id,
                    label: workspace.name,
                  }))}
                />
              </PropertyRow>

              <PropertyRow icon={ListTodo} label="Project">
                <Select
                  size="sm"
                  value={taskProjectId}
                  onChange={(projectId) =>
                    setValueTask("projectId", projectId, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                  placeholder="No project"
                  className="border-0 bg-transparent px-0 shadow-none"
                  options={[
                    { value: "", label: "No project" },
                    ...availableTaskProjects.map((project) => ({
                      value: project.id,
                      label: project.title,
                    })),
                  ]}
                />
              </PropertyRow>

              <PropertyRow icon={Circle} label="Status">
                <Select
                  size="sm"
                  value={taskStatusId}
                  onChange={(statusId) =>
                    setValueTask("statusId", statusId, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                  placeholder="Select status"
                  className="border-0 bg-transparent px-0 shadow-none"
                  options={(selectedTaskWorkspace?.status ?? []).map(
                    (status: Status) => ({
                      value: status.id,
                      label: status.name,
                      color: status.color,
                    }),
                  )}
                />
              </PropertyRow>

              <PropertyRow icon={Flag} label="Priority">
                <Select
                  size="sm"
                  value={taskPriorityLevel}
                  onChange={(priorityLevel) =>
                    setValueTask("priorityLevel", priorityLevel, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                  className="border-0 bg-transparent px-0 shadow-none"
                  options={PRIORITY_OPTIONS}
                />
              </PropertyRow>

              <PropertyRow icon={Clock} label="Duration">
                <input
                  type="number"
                  min={0}
                  step={15}
                  {...registerTask("duration")}
                  className="w-full bg-transparent text-sm text-foreground outline-none"
                />
                <span className="shrink-0 text-xs text-muted-foreground">
                  min
                </span>
              </PropertyRow>

              <PropertyRow icon={CalendarDays} label="Start date">
                <DatePicker
                  mode="date"
                  value={taskStartDate}
                  onChange={(startDate) =>
                    setValueTask("startDate", startDate, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                />
              </PropertyRow>

              <PropertyRow icon={CalendarDays} label="Deadline">
                <DatePicker
                  mode="date"
                  value={taskDeadline}
                  onChange={(deadline) =>
                    setValueTask("deadline", deadline, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                />
              </PropertyRow>

              <PropertyRow
                icon={CalendarDays}
                label={taskRecurrence ? "First on" : "Schedule"}
              >
                <DatePicker
                  mode="datetime"
                  value={taskScheduledOn}
                  onChange={(scheduledOn) =>
                    setValueTask("scheduledOn", scheduledOn, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                />
              </PropertyRow>

              <RecurrenceEditor
                label="Repeat"
                icon={Repeat}
                value={taskRecurrence}
                anchor={taskRecurrenceAnchor}
                onChange={setTaskRecurrence}
              />
            </div>

            <p className="mt-1 px-1 text-[11px] text-muted-foreground">
              {taskRecurrence
                ? "Each occurrence shows on the calendar and is completed on its own."
                : "Tasks appear on the calendar once scheduled, by hand or with Auto-schedule."}
            </p>

            {taskErrors.workspaceId && (
              <p className="mt-2 px-1 text-xs text-destructive">
                {taskErrors.workspaceId.message}
              </p>
            )}

            <div className="pt-3">
              <SidebarSectionTitle>Labels</SidebarSectionTitle>
              <LabelPicker
                labels={selectedTaskWorkspace?.lables ?? []}
                selectedIds={taskLabelIds}
                emptyLabel=""
                onChange={(labelIds) =>
                  setValueTask("labelIds", labelIds, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
              />
              <CreateLabelInline
                workspaceId={selectedTaskWorkspaceId}
                onCreated={addTaskLabel}
              />
            </div>

            <div className="mt-4 border-t border-border pt-3">
              <SidebarSectionTitle>Custom fields</SidebarSectionTitle>
              {(selectedTaskWorkspace?.customFields ?? []).map((field) => (
                <PropertyRow
                  key={field.id}
                  icon={customFieldIcon(field.type)}
                  label={field.name}
                >
                  <CustomFieldControl
                    field={field}
                    value={findCustomFieldDraft(
                      taskCustomFieldValues,
                      field.id,
                    )}
                    onChange={(next) => changeTaskCustomField(field, next)}
                  />
                </PropertyRow>
              ))}
              <CreateCustomFieldInline
                workspaceId={selectedTaskWorkspaceId}
                onCreated={addTaskCustomField}
              />
            </div>
          </ModalSidebar>
        </form>
      </EntityModalShell>
    );
  }

  if (addNewMode === "event") {
    return (
      <EntityModalShell
        icon={meta.icon}
        label={meta.label}
        onClose={closeModal}
        headerRight={
          <CreateAction
            formId="create-event"
            label={meta.action}
            pending={createEventMutation.isPending}
            disabled={!isEventValid}
            failed={createEventMutation.isError}
          />
        }
      >
        <form id="create-event" onSubmit={onEventSubmit} className="contents">
          <ModalMain>
            <input
              autoFocus
              value={eventTitle}
              onChange={(input) => setEventTitle(input.target.value)}
              placeholder="Event title"
              className={modalTitleClass}
            />

            <textarea
              value={eventDescription}
              onChange={(input) => setEventDescription(input.target.value)}
              placeholder="Notes, location, links..."
              rows={6}
              className="mt-4 w-full resize-none rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
            />

            <p className="mt-4 max-w-md text-sm text-muted-foreground">
              Events block time on the calendar; Auto-schedule plans tasks around
              them. Add a repeat rule for anything that happens on a cadence.
            </p>

            {createEventMutation.isError && (
              <p className="mt-2 text-xs text-destructive">
                {createEventMutation.error instanceof Error
                  ? createEventMutation.error.message
                  : "Could not create event."}
              </p>
            )}
          </ModalMain>

          <ModalSidebar>
            <div className="flex flex-col gap-1">
              <PropertyRow icon={CalendarDays} label="Starts">
                <DatePicker
                  mode="datetime"
                  value={eventStart}
                  onChange={setEventStart}
                  clearable={false}
                />
              </PropertyRow>

              <PropertyRow icon={Clock} label="Duration">
                <input
                  type="number"
                  min={15}
                  step={15}
                  value={eventDuration}
                  onChange={(input) =>
                    setEventDuration(Number(input.target.value) || 60)
                  }
                  className="w-full bg-transparent text-sm text-foreground outline-none"
                />
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatDuration(Math.max(15, eventDuration || 60))}
                </span>
              </PropertyRow>

              <PropertyRow icon={Clock} label="All day">
                <input
                  type="checkbox"
                  checked={eventAllDay}
                  onChange={(input) => setEventAllDay(input.target.checked)}
                  className="size-3.5 accent-primary"
                />
              </PropertyRow>

              <RecurrenceEditor
                label="Repeat"
                icon={Repeat}
                value={eventRecurrence}
                anchor={eventStartDate}
                onChange={setEventRecurrence}
              />

              <PropertyRow icon={FolderKanban} label="Workspace">
                <Select
                  size="sm"
                  value={eventWorkspaceId}
                  onChange={setEventWorkspaceId}
                  placeholder="None"
                  className="border-0 bg-transparent px-0 shadow-none"
                  options={[
                    { value: "", label: "None" },
                    ...typedWorkspaces.map((workspace) => ({
                      value: workspace.id,
                      label: workspace.name,
                    })),
                  ]}
                />
              </PropertyRow>
            </div>
          </ModalSidebar>
        </form>
      </EntityModalShell>
    );
  }

  if (addNewMode === "doc" || addNewMode === "sheet") {
    const pending =
      createDocMutation.isPending || createSheetMutation.isPending;

    return (
      <EntityModalShell
        icon={meta.icon}
        label={meta.label}
        onClose={closeModal}
        headerRight={
          <CreateAction
            formId="create-page"
            label={meta.action}
            pending={pending}
            disabled={!isPageValid}
            failed={createDocMutation.isError || createSheetMutation.isError}
          />
        }
      >
        <form
          id="create-page"
          onSubmit={handlePageSubmit(
            addNewMode === "doc" ? onDocSubmit : onSheetSubmit,
          )}
          className="contents"
        >
          <ModalMain>
            <input
              autoFocus
              {...registerPage("title")}
              placeholder={addNewMode === "doc" ? "Doc title" : "Sheet title"}
              className={modalTitleClass}
            />

            {pageErrors.title && (
              <p className="mt-2 text-xs text-destructive">
                {pageErrors.title.message}
              </p>
            )}

            <p className="mt-4 max-w-md text-sm text-muted-foreground">
              {addNewMode === "doc"
                ? "The editor opens as soon as the doc is created."
                : "The grid opens as soon as the sheet is created."}
            </p>
          </ModalMain>

          <ModalSidebar>
            <PropertyRow icon={FolderKanban} label="Workspace">
              <Select
                size="sm"
                value={selectedPageWorkspaceId ?? ""}
                onChange={(workspaceId) =>
                  setValuePage("workspaceId", workspaceId, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
                placeholder="Select workspace"
                className="border-0 bg-transparent px-0 shadow-none"
                options={typedWorkspaces.map((workspace) => ({
                  value: workspace.id,
                  label: workspace.name,
                }))}
              />
            </PropertyRow>

            {pageErrors.workspaceId && (
              <p className="mt-2 px-1 text-xs text-destructive">
                {pageErrors.workspaceId.message}
              </p>
            )}
          </ModalSidebar>
        </form>
      </EntityModalShell>
    );
  }

  return null;
}

function nextRoundHour(): Date {
  const next = new Date();
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

function CreateAction({
  formId,
  label,
  pending,
  disabled,
  failed,
}: {
  formId: string;
  label: string;
  pending: boolean;
  disabled: boolean;
  failed?: boolean;
}) {
  return (
    <>
      {failed && (
        <span className="text-xs text-destructive">Could not save</span>
      )}
      <button
        type="submit"
        form={formId}
        disabled={disabled || pending}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="size-4" />
        {pending ? "Creating..." : label}
      </button>
    </>
  );
}
