"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSidebarStore } from "@/app/_store/sidebarStore";
import { useEntityDetailStore } from "@/app/_store/entityDetailStore";
import { isTasksListPath } from "@/app/utils/entityDetail";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
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
  LayoutTemplate,
  ListTodo,
  Palette,
  Plus,
  Repeat,
  Sheet as SheetIcon,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useWorkspaces } from "@/app/utils/hooks/workspaces";
import { useProjects } from "@/app/utils/hooks/projects";
import { useCreateDoc } from "@/app/utils/hooks/docs";
import { useCreateSheet, useSheetTemplates } from "@/app/utils/hooks/sheets";
import { getSheetTemplateSuggestion } from "@/app/utils/api/decisions";
import {
  createProjectWithStart,
  ProjectStartChoices,
  useProjectStart,
} from "@/app/_components/_ui/modal/projectStart";
import { useCreateTask, useClarifyInbox } from "@/app/utils/hooks/tasks";
import {
  useClarifySuggestions,
  useDecisionFeedback,
  useDecisions,
  useSuggestedDuration,
} from "@/app/utils/hooks/decisions";
import ClarifyHints, { clarifyKept } from "@/app/_components/_ui/modal/clarifyHints";
import { useCreateEvent } from "@/app/utils/hooks/calendar";
import RecurrenceEditor from "@/app/_components/_ui/recurrenceEditor";
import TaskTypeToggle from "@/app/_components/_ui/tasks/taskTypeToggle";
import CustomFieldControl, {
  customFieldIcon,
  emptyCustomFieldDrafts,
  findCustomFieldDraft,
  withCustomFieldDraft,
} from "@/app/_components/_ui/customFieldControl";
import DatePicker, { TimeField } from "@/app/_components/_ui/datePicker";
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
import { apiFetch } from "@/app/utils/api/client";
import {
  applyClockToDate,
  dateFromDateInput,
  formatDuration,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
  toTimeInputValue,
} from "@/app/utils/calendar";
import { buildRecurrenceInput, type RecurrenceDraft } from "@/app/utils/recurrence";
import { isRichContentEmpty } from "@/app/utils/richText";
import { PRIORITY_OPTIONS } from "@/app/utils/priority";
import { stagesForProject } from "@/app/utils/stages";
import { fileHref } from "@/app/utils/fileRoutes";

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
  color: z
    .string()
    .regex(/^#([0-9a-fA-F]{6})$/, "Color must be a valid hex value")
    .default("#6E56CF"),
});

type AddWorkspaceForm = z.input<typeof addWorkspaceSchema>;

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

const addTaskSchema = z
  .object({
    name: z
      .string()
      .min(2, "Task name must be at least 2 characters")
      .max(100, "Task name must be less than 100 characters"),
    workspaceId: z.string().optional(),
    projectId: z.string().optional(),
    statusId: z.string().optional(),
    stageId: z.string().optional(),
    priorityLevel: z.string().optional(),
    startDate: z.string().optional(),
    deadline: z.string().optional(),
    scheduledOn: z.string().optional(),
    duration: z.coerce.number().optional(),
    labelIds: z.array(z.string()).default([]),
    customFieldValues: z.array(customFieldValueSchema).default([]),
  })
  .superRefine((data, ctx) => {
    if ((Number(data.duration) || 0) > 0 && !data.workspaceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workspaceId"],
        message: "Please select a workspace",
      });
    }
  });

type AddTaskForm = z.input<typeof addTaskSchema>;

// Fields only Work uses; once the person edits one, a late Reminder
// suggestion no longer switches the kind.
const WORK_FIELDS = [
  "duration",
  "workspaceId",
  "projectId",
  "statusId",
  "stageId",
  "priorityLevel",
  "startDate",
  "deadline",
  "labelIds",
  "customFieldValues",
] as const;

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
  const isOpen = useSidebarStore((state) => state.isAddItemModalOpen);
  return isOpen ? <AddItemModalInner /> : null;
}

function AddItemModalInner() {
  const {
    isAddItemModalOpen,
    setIsAddItemModalOpen,
    addNewMode,
    createTaskDraft,
    setCreateTaskDraft,
  } = useSidebarStore();

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
  const [taskKind, setTaskKind] = useState<"task" | "reminder">("task");
  // Impure clock read belongs in a lazy initializer, not in render.
  const [defaultProjectDeadline] = useState(() =>
    new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
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
  const [sheetTemplateId, setSheetTemplateId] = useState("");
  // Smart suggestions pre-pick a saved template for the sheet's title until
  // the person picks one themselves.
  const [suggestedTemplateId, setSuggestedTemplateId] = useState("");
  const [templateTouched, setTemplateTouched] = useState(false);
  // Which smart suggestions the Clarify form already filled, so each fills
  // once. See the suggestion effects below.
  const filledRef = useRef<{
    logId?: string;
    workspaceTarget?: string;
    secondDone?: boolean;
  }>({});

  // Form for Workspace
  const {
    register,
    handleSubmit,
    reset,
    control: workspaceControl,
    setValue: setWorkspaceValue,
    formState: { errors, isValid },
  } = useForm<AddWorkspaceForm>({
    resolver: zodResolver(addWorkspaceSchema),
    mode: "onChange",
    defaultValues: {
      color: "#6E56CF",
    },
  });

  // Form for Project
  const {
    register: registerProject,
    handleSubmit: handleProjectSubmit,
    reset: resetProject,
    control: projectControl,
    setValue,
    formState: { errors: projectErrors, isValid: isProjectValid },
  } = useForm<AddProjectForm>({
    resolver: zodResolver(addProjectSchema),
    mode: "onChange",
    defaultValues: {
      color: "#30A66D",
      priorityLevel: "Low",
      doesHaveStages: false,
      deadline: defaultProjectDeadline,
    },
  });

  // Form for Task
  const {
    register: registerTask,
    handleSubmit: handleTaskSubmit,
    reset: resetTask,
    control: taskControl,
    setValue: setValueTask,
    getFieldState: getTaskFieldState,
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
    control: pageControl,
    formState: { errors: pageErrors, isValid: isPageValid },
  } = useForm<AddPageForm>({
    resolver: zodResolver(addPageSchema),
    mode: "onChange",
  });

  const selectedWorkspaceId = useWatch({ control: projectControl, name: "workspaceId" });
  const workspaceColor = useWatch({ control: workspaceControl, name: "color" }) ?? "#6E56CF";
  const projectStatusId = useWatch({ control: projectControl, name: "statusId" }) ?? "";
  const projectPriorityLevel = useWatch({ control: projectControl, name: "priorityLevel" }) ?? "Low";
  const projectStartDate = useWatch({ control: projectControl, name: "startDate" }) ?? "";
  const projectDeadline = useWatch({ control: projectControl, name: "deadline" }) ?? "";
  const projectColor = useWatch({ control: projectControl, name: "color" }) ?? "#30A66D";
  const selectedTaskWorkspaceId = useWatch({ control: taskControl, name: "workspaceId" });
  const taskProjectId = useWatch({ control: taskControl, name: "projectId" }) ?? "";
  const taskStageId = useWatch({ control: taskControl, name: "stageId" }) ?? "";
  const taskStatusId = useWatch({ control: taskControl, name: "statusId" }) ?? "";
  const taskPriorityLevel = useWatch({ control: taskControl, name: "priorityLevel" }) ?? "Medium";
  const taskStartDate = useWatch({ control: taskControl, name: "startDate" }) ?? "";
  const taskDeadline = useWatch({ control: taskControl, name: "deadline" }) ?? "";
  const taskScheduledOn = useWatch({ control: taskControl, name: "scheduledOn" }) ?? "";
  // A quick-add draft that asks for a Reminder switches the kind as soon as the
  // task form is shown; the effect below consumes the rest of the draft.
  const draftKindForTaskForm =
    isAddItemModalOpen && addNewMode === "task" ? createTaskDraft?.kind : undefined;
  const [seenDraftKind, setSeenDraftKind] = useState(draftKindForTaskForm);
  if (seenDraftKind !== draftKindForTaskForm) {
    setSeenDraftKind(draftKindForTaskForm);
    if (draftKindForTaskForm === "reminder") setTaskKind("reminder");
  }
  const taskIsReminder = taskKind === "reminder";
  const taskName = useWatch({ control: taskControl, name: "name" }) ?? "";
  const taskDuration = useWatch({ control: taskControl, name: "duration" });
  // Clarify already pre-fills its own estimate; new Work only offers one.
  const suggestedDuration = useSuggestedDuration(
    taskName,
    isAddItemModalOpen && addNewMode === "task" && !createTaskDraft?.inboxId && !taskIsReminder,
  );
  const taskTimeOnly = Boolean(taskRecurrence);
  const taskLabelIds = useWatch({ control: taskControl, name: "labelIds" }) ?? [];
  const selectedPageWorkspaceId = useWatch({ control: pageControl, name: "workspaceId" });
  const pageTitle = useWatch({ control: pageControl, name: "title" });

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
  const availableTaskStages = stagesForProject(typedProjects, taskProjectId);

  const createWorkspaceMutation = useMutation({
    mutationFn: async (data: AddWorkspaceForm) => {
      const response = await apiFetch("/workspaces", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: data.name,
          color: data.color,
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

  const projectTitle = useWatch({ control: projectControl, name: "title" }) ?? "";
  const projectStart = useProjectStart(
    projectTitle,
    selectedWorkspaceId ?? "",
    isAddItemModalOpen && addNewMode === "project",
  );
  const createProjectMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createProjectWithStart>[0]) =>
      createProjectWithStart(payload, projectStart.suggestion, projectStart.choices),
    onSuccess: async () => {
      await Promise.all(
        [["projects"], ["tasks"], ["docs"], ["sheets"]].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );

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

  const createTaskMutation = useCreateTask();
  const clarifyInboxMutation = useClarifyInbox();
  const isClarify = Boolean(createTaskDraft?.inboxId);

  // The first occurrence of a repeating task is the "Schedule" time when set,
  // otherwise the next round hour, so the series starts somewhere sensible.
  const taskRecurrenceAnchor = useMemo(
    () => (taskScheduledOn ? new Date(taskScheduledOn) : nextRoundHour()),
    [taskScheduledOn],
  );

  const setTaskClock = (hhmm: string) => {
    if (!hhmm) {
      setValueTask("scheduledOn", "", { shouldValidate: true, shouldDirty: true });
      return;
    }
    const day = taskStartDate
      ? dateFromDateInput(taskStartDate)
      : taskScheduledOn
        ? new Date(taskScheduledOn)
        : new Date();
    setValueTask("scheduledOn", toDatetimeLocalValue(applyClockToDate(day, hhmm)), {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  const makeTaskReminder = () => {
    setTaskKind("reminder");
    setValueTask("duration", 0, { shouldValidate: true, shouldDirty: true });
    if (!taskScheduledOn) {
      setTaskClock(toTimeInputValue(nextRoundHour()));
    }
  };

  // Kept means most of the fields the suggestions named still have that
  // value (see clarifyKept), so tweaking only the length still counts.
  const reportSuggestionFeedback = (data: AddTaskForm) => {
    if (!suggestions?.logId) return;
    const sorted = (ids: string[] | undefined) => [...(ids ?? [])].sort().join(",");
    const checks: boolean[] = [];
    if (suggestions.kind) checks.push(taskKind === suggestions.kind);
    if (suggestions.duration && suggestions.kind !== "reminder")
      checks.push(Number(data.duration) === suggestions.duration);
    if (suggestions.priority) checks.push(data.priorityLevel === suggestions.priority);
    if (suggestions.workspaceId) checks.push(data.workspaceId === suggestions.workspaceId);
    if (suggestions.projectId) checks.push(data.projectId === suggestions.projectId);
    if (suggestions.labelIds?.length)
      checks.push(sorted(data.labelIds) === sorted(suggestions.labelIds));
    if (checks.length === 0) return;
    decisionFeedback.mutate({ logId: suggestions.logId, accepted: clarifyKept(checks) });
  };

  const onTaskSubmit = (data: AddTaskForm) => {
    const hasDescription =
      !isRichContentEmpty(taskDescription.content) ||
      taskDescription.plainText.trim().length > 0;
    const recurrence = buildRecurrenceInput(taskRecurrence, taskRecurrenceAnchor);

    const isReminder = taskKind === "reminder";
    const pingAt =
      !recurrence && (data.scheduledOn || isReminder)
        ? fromDatetimeLocalValue(
            data.scheduledOn || toDatetimeLocalValue(nextRoundHour()),
          )
        : undefined;
    const isInbox = !isClarify && !isReminder && (Number(data.duration) || 0) <= 0;
    const payload = {
      name: data.name,
      description: hasDescription ? taskDescription.plainText : "",
      descriptionRich: hasDescription ? taskDescription.content : undefined,
      workspaceId: isReminder || isInbox ? undefined : data.workspaceId,
      projectId: isReminder || isInbox ? undefined : data.projectId || undefined,
      stageId: isReminder || isInbox ? undefined : data.stageId || undefined,
      statusId: isReminder || isInbox ? undefined : data.statusId || undefined,
      priorityLevel: data.priorityLevel || undefined,
      startDate: data.startDate || undefined,
      deadline: data.deadline || undefined,
      scheduledOn: pingAt,
      duration: isReminder ? 0 : data.duration ? Number(data.duration) : 0,
      kind: isInbox ? "inbox" as const : isReminder ? "reminder" as const : "task" as const,
      labelIds: isReminder || isInbox
        ? undefined
        : (data.labelIds ?? taskLabelIds ?? []).map((id) => ({ id })),
      customFieldValues: isReminder || isInbox ? undefined : data.customFieldValues,
      recurrence: recurrence ?? undefined,
    };
    if (isClarify && createTaskDraft?.inboxId) {
      if (payload.kind === "inbox") return;
      reportSuggestionFeedback(data);
      clarifyInboxMutation.mutate(
        { inboxId: createTaskDraft.inboxId, data: payload },
        { onSuccess: () => closeModal() },
      );
      return;
    }
    createTaskMutation.mutate(payload, {
      onSuccess: () => closeModal(),
    });
  };

  const createEventMutation = useCreateEvent();
  const eventStartDate = useMemo(
    () => (eventStart ? new Date(fromDatetimeLocalValue(eventStart)) : nextRoundHour()),
    [eventStart],
  );
  const isEventValid = eventTitle.trim().length > 0 && Boolean(eventStart);
  const eventTimeOnly = Boolean(eventRecurrence) && !eventAllDay;

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
    router.push(fileHref(doc.id));
  };

  const createSheetMutation = useCreateSheet();
  const templatesQuery = useSheetTemplates();

  const onSheetSubmit = async (data: AddPageForm) => {
    const sheet = await createSheetMutation.mutateAsync({
      title: data.title,
      workspaceId: data.workspaceId,
      templateId: sheetTemplateId || undefined,
    });

    closeModal();
    router.push(fileHref(sheet.id));
  };

  const closeModal = () => {
    reset();
    resetProject();
    resetTask();
    resetPage();
    setTaskKind("task");
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
    setSheetTemplateId("");
    setSuggestedTemplateId("");
    setTemplateTouched(false);
    setSuggestedKindFor(undefined);
    setKindTouched(false);
    setFilledFor(undefined);
    setCreateTaskDraft(null);
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
      const preferred = createTaskDraft?.workspaceId;
      const nextWorkspace =
        preferred && typedWorkspaces.some((w) => w.id === preferred)
          ? preferred
          : selectedTaskWorkspaceId &&
              typedWorkspaces.some((w) => w.id === selectedTaskWorkspaceId)
            ? selectedTaskWorkspaceId
            : typedWorkspaces[0].id;
      if (nextWorkspace !== selectedTaskWorkspaceId) {
        setValueTask("workspaceId", nextWorkspace, {
          shouldValidate: true,
        });
      }
      if (createTaskDraft?.projectId) {
        setValueTask("projectId", createTaskDraft.projectId, {
          shouldValidate: true,
        });
      }
      if (createTaskDraft?.stageId) {
        setValueTask("stageId", createTaskDraft.stageId, {
          shouldValidate: true,
        });
      }
      let nextDraft = createTaskDraft;
      let draftUsed = false;
      if (nextDraft?.kind === "reminder") {
        // taskKind itself follows the draft during render (see above).
        setValueTask("duration", 0, { shouldValidate: true, shouldDirty: true });
        nextDraft = { ...nextDraft, kind: undefined };
        draftUsed = true;
      }
      if (nextDraft?.name) {
        setValueTask("name", nextDraft.name, { shouldValidate: true });
        nextDraft = { ...nextDraft, name: undefined };
        draftUsed = true;
      }
      if (draftUsed) {
        setCreateTaskDraft(nextDraft);
      }
    }
  }, [
    isAddItemModalOpen,
    addNewMode,
    typedWorkspaces,
    selectedTaskWorkspaceId,
    setValueTask,
    setCreateTaskDraft,
    createTaskDraft,
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

  // Smart suggestions for an Inbox item being clarified. They fill only fields
  // the person has not touched yet; nothing is saved until they press Clarify.
  // Off or unsure returns nothing and the form stays as it is today.
  const clarifyInboxId =
    isAddItemModalOpen && addNewMode === "task" ? createTaskDraft?.inboxId : undefined;
  const decisionsOn = useDecisions().data?.available === true;
  const suggestionsQuery = useClarifySuggestions(clarifyInboxId, decisionsOn);
  const suggestions = suggestionsQuery.data?.available ? suggestionsQuery.data : undefined;
  const decisionFeedback = useDecisionFeedback();
  // The person picked Work or Reminder themselves; a suggested kind never
  // overrides that.
  const [kindTouched, setKindTouched] = useState(false);
  // The suggestions (by logId) that filled at least one field, so the note
  // above the form only says so when something was filled.
  const [filledFor, setFilledFor] = useState<string>();
  // The log id whose date (read by code from the item's words) filled a field.
  // A suggested Reminder switches the kind during render, like a quick-add
  // draft does above; step one then sets its length and time. A late answer
  // leaves the kind alone once the person chose it or edited a Work field.
  const [suggestedKindFor, setSuggestedKindFor] = useState<string>();
  if (suggestions?.kind === "reminder" && suggestions.logId && suggestedKindFor !== suggestions.logId) {
    setSuggestedKindFor(suggestions.logId);
    const workTouched = kindTouched || WORK_FIELDS.some((name) => getTaskFieldState(name).isDirty);
    if (taskKind === "task" && !workTouched) {
      setTaskKind("reminder");
      setFilledFor(suggestions.logId);
    }
  }

  // Forget what was filled once the form closes, so reopening fills again.
  useEffect(() => {
    if (!clarifyInboxId) filledRef.current = {};
  }, [clarifyInboxId]);

  // Step one: kind, length, priority and workspace.
  useEffect(() => {
    if (!suggestions?.logId || filledRef.current.logId === suggestions.logId) return;
    if (typedWorkspaces.length === 0 || !selectedTaskWorkspaceId) return;
    const untouched = (name: "duration" | "priorityLevel" | "workspaceId") =>
      !getTaskFieldState(name).isDirty;
    let filled = false;
    if (suggestions.kind === "reminder" && taskKind === "reminder" && !kindTouched) {
      // The kind itself switched during render, above (or the person's own
      // Reminder already set these).
      if (untouched("duration")) setValueTask("duration", 0, { shouldValidate: true });
      if (!taskScheduledOn) setTaskClock(toTimeInputValue(nextRoundHour()));
    } else if (suggestions.duration && suggestions.kind !== "reminder" && untouched("duration")) {
      setValueTask("duration", suggestions.duration, { shouldValidate: true });
      filled = true;
    }
    if (suggestions.priority && untouched("priorityLevel")) {
      setValueTask("priorityLevel", suggestions.priority, { shouldValidate: true });
      // The default Medium suggested again changes nothing on screen.
      if (suggestions.priority !== taskPriorityLevel) filled = true;
    }
    let workspaceTarget = selectedTaskWorkspaceId;
    if (
      suggestions.workspaceId &&
      suggestions.workspaceId !== selectedTaskWorkspaceId &&
      untouched("workspaceId") &&
      !createTaskDraft?.workspaceId &&
      typedWorkspaces.some((w) => w.id === suggestions.workspaceId)
    ) {
      setValueTask("workspaceId", suggestions.workspaceId, { shouldValidate: true });
      workspaceTarget = suggestions.workspaceId;
      filled = true;
    }
    // Code read the date from the words; Jev only said which field it is for.
    if (suggestions.date && suggestions.dateRole) {
      const day = dateFromDateInput(suggestions.date);
      let dateFilled = false;
      if (suggestions.dateRole === "deadline" && !taskIsReminder && !getTaskFieldState("deadline").isDirty) {
        setValueTask("deadline", suggestions.date, { shouldValidate: true });
        dateFilled = true;
      } else if (suggestions.dateRole === "start" && !taskIsReminder && !getTaskFieldState("startDate").isDirty) {
        setValueTask("startDate", suggestions.date, { shouldValidate: true });
        if (suggestions.time)
          setValueTask("scheduledOn", toDatetimeLocalValue(applyClockToDate(day, suggestions.time)), { shouldValidate: true });
        dateFilled = true;
      } else if (suggestions.dateRole === "reminder" && taskKind === "reminder" && !getTaskFieldState("scheduledOn").isDirty) {
        setValueTask("scheduledOn", toDatetimeLocalValue(applyClockToDate(day, suggestions.time || "09:00")), { shouldValidate: true });
        dateFilled = true;
      }
      if (dateFilled) filled = true;
    }
    filledRef.current = { logId: suggestions.logId, workspaceTarget };
    if (filled) setFilledFor(suggestions.logId);
    // setTaskClock is recreated each render; the logId guard runs this once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions, typedWorkspaces, selectedTaskWorkspaceId, taskKind, kindTouched, getTaskFieldState, setValueTask, createTaskDraft?.workspaceId]);

  // Step two runs after the workspace reset above, so project and labels are
  // not wiped by the workspace change step one made.
  useEffect(() => {
    const filled = filledRef.current;
    if (!suggestions || filled.logId !== suggestions.logId || filled.secondDone) return;
    if (selectedTaskWorkspaceId !== filled.workspaceTarget) return;
    let filledHere = false;
    if (
      suggestions.projectId &&
      !getTaskFieldState("projectId").isDirty &&
      availableTaskProjects.some((p) => p.id === suggestions.projectId)
    ) {
      setValueTask("projectId", suggestions.projectId, { shouldValidate: true });
      filledHere = true;
    }
    const known = new Set((selectedTaskWorkspace?.lables ?? []).map((l) => l.id));
    const labelIds = (suggestions.labelIds ?? []).filter((id) => known.has(id));
    if (labelIds.length > 0 && !getTaskFieldState("labelIds").isDirty) {
      setValueTask("labelIds", labelIds, { shouldValidate: true });
      filledHere = true;
    }
    filledRef.current = { ...filled, secondDone: true };
    if (filledHere) setFilledFor(suggestions.logId);
  }, [suggestions, selectedTaskWorkspaceId, selectedTaskWorkspace, availableTaskProjects, getTaskFieldState, setValueTask]);

  // A title suggested elsewhere (smart search's "Create sheet “Budget”")
  // pre-fills the doc, sheet or project form once.
  useEffect(() => {
    const name = createTaskDraft?.name;
    if (!isAddItemModalOpen || !name) return;
    if (addNewMode === "doc" || addNewMode === "sheet") {
      setValuePage("title", name, { shouldValidate: true });
    } else if (addNewMode === "project") {
      setValue("title", name, { shouldValidate: true });
    } else return;
    setCreateTaskDraft({ ...createTaskDraft, name: undefined });
  }, [isAddItemModalOpen, addNewMode, createTaskDraft, setValuePage, setValue, setCreateTaskDraft]);

  // Pick the saved template the sheet's title calls for, while the person
  // has not chosen one.
  const templates = useDecisions().data?.available ? templatesQuery.data : undefined;
  useEffect(() => {
    const title = (pageTitle ?? "").trim();
    if (!isAddItemModalOpen || addNewMode !== "sheet" || !templates?.length || templateTouched || title.length < 2)
      return;
    let stale = false;
    const timer = setTimeout(() => {
      getSheetTemplateSuggestion(title)
        .then((suggestion) => {
          if (stale || !suggestion.available) return;
          const id = templates.some((t) => t.id === suggestion.templateId) ? suggestion.templateId! : "";
          setSheetTemplateId(id);
          setSuggestedTemplateId(id);
        })
        .catch(() => {});
    }, 600);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [isAddItemModalOpen, addNewMode, pageTitle, templates, templateTouched]);

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

  const projectCustomFieldValues = useWatch({ control: projectControl, name: "customFieldValues" }) ?? [];
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

  const taskCustomFieldValues = useWatch({ control: taskControl, name: "customFieldValues" }) ?? [];
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

  const meta = {
    ...(MODE_META[addNewMode] ?? MODE_META.task),
    ...(isClarify ? { label: "Clarify", action: "Clarify" } : {}),
  };

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

            <div className="mt-4 flex items-center gap-2">
              <ColorPicker
                value={workspaceColor}
                onChange={(color) =>
                  setWorkspaceValue("color", color, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
                aria-label="Workspace color"
              />
              <span className="text-sm text-muted-foreground">Workspace color</span>
            </div>

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

            <ProjectStartChoices
              suggestion={projectStart.suggestion}
              choices={projectStart.choices}
              onChange={projectStart.setChoices}
            />
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
                    color: workspace.color ?? undefined,
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
            pending={createTaskMutation.isPending || clarifyInboxMutation.isPending}
            disabled={!isTaskValid}
            failed={createTaskMutation.isError || clarifyInboxMutation.isError}
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

            {isClarify && (
              <ClarifyHints
                loading={suggestionsQuery.isFetching && !suggestionsQuery.data}
                suggestions={suggestions}
                filled={Boolean(suggestions?.logId) && filledFor === suggestions?.logId}
                dateFilled={
                  Boolean(suggestions?.date) &&
                  filledFor === suggestions?.logId &&
                  (suggestions?.dateRole === "deadline"
                    ? taskDeadline === suggestions.date
                    : suggestions?.dateRole === "start"
                      ? taskStartDate === suggestions.date
                      : taskScheduledOn.startsWith(suggestions?.date ?? "-"))
                }
                error={suggestionsQuery.data?.error}
                onOpenDuplicate={(id) => {
                  closeModal();
                  // Open the task over the current page, like a task chip;
                  // the Tasks list has its own detail view keyed by the URL.
                  if (isTasksListPath(window.location.pathname)) {
                    router.push(`/tasks?taskId=${encodeURIComponent(id)}`);
                  } else {
                    useEntityDetailStore.getState().openTask(id);
                  }
                }}
              />
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
              <div className="px-1 py-1.5">
                <TaskTypeToggle
                  value={taskIsReminder ? "reminder" : "task"}
                  onChange={(next) => {
                    setKindTouched(true);
                    if (next === "reminder") {
                      makeTaskReminder();
                      return;
                    }
                    setTaskKind("task");
                    setValueTask("duration", 30, {
                      shouldValidate: true,
                      shouldDirty: true,
                    });
                  }}
                />
                <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                  {taskIsReminder
                    ? "Pings at a chosen time. Does not reserve a work block."
                    : "Estimated minutes of work the scheduler can place."}
                </p>
              </div>
              {!taskIsReminder ? (
                <>
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
                    color: workspace.color ?? undefined,
                  }))}
                />
              </PropertyRow>

              <PropertyRow icon={ListTodo} label="Project">
                <Select
                  size="sm"
                  value={taskProjectId}
                  onChange={(projectId) => {
                    setValueTask("projectId", projectId, {
                      shouldValidate: true,
                      shouldDirty: true,
                    });
                    setValueTask("stageId", "", { shouldDirty: true });
                  }}
                  placeholder="No project"
                  className="border-0 bg-transparent px-0 shadow-none"
                  options={[
                    { value: "", label: "No project" },
                    ...availableTaskProjects.map((project) => ({
                      value: project.id,
                      label: project.title,
                      color: project.color ?? undefined,
                    })),
                  ]}
                />
              </PropertyRow>

              {availableTaskStages.length > 0 ? (
              <PropertyRow icon={GitBranch} label="Stage">
                <Select
                  size="sm"
                  value={taskStageId}
                  onChange={(stageId) =>
                    setValueTask("stageId", stageId, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                  placeholder="No stage"
                  className="border-0 bg-transparent px-0 shadow-none"
                  options={[
                    { value: "", label: "No stage" },
                    ...availableTaskStages.map((stage) => ({
                      value: stage.id,
                      label: stage.name,
                      color: stage.color || undefined,
                    })),
                  ]}
                />
              </PropertyRow>
              ) : null}

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
                </>
              ) : null}

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

              {!taskIsReminder ? (
              <PropertyRow icon={Clock} label="Duration">
                    <input
                      type="number"
                      min={15}
                      step={15}
                      {...registerTask("duration")}
                      className="w-full bg-transparent text-sm text-foreground outline-none"
                    />
                    <span className="shrink-0 text-xs text-muted-foreground">
                      min
                    </span>
                    {suggestedDuration &&
                    suggestedDuration !== Number(taskDuration) ? (
                      <button
                        type="button"
                        onClick={() =>
                          setValueTask("duration", suggestedDuration, {
                            shouldValidate: true,
                            shouldDirty: true,
                          })
                        }
                        className="ml-2 flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
                        title="Use the suggested length"
                      >
                        <Sparkles className="size-3" />
                        Suggested {formatDuration(suggestedDuration)}
                      </button>
                    ) : null}
              </PropertyRow>
              ) : null}

              {!taskIsReminder ? (
              <PropertyRow icon={CalendarDays} label="Start date">
                <DatePicker
                  mode="date"
                  value={taskStartDate}
                  onChange={(startDate) => {
                    setValueTask("startDate", startDate, {
                      shouldValidate: true,
                      shouldDirty: true,
                    });
                    if (taskTimeOnly && taskScheduledOn) {
                      const clock = toTimeInputValue(taskScheduledOn);
                      if (clock) {
                        setValueTask(
                          "scheduledOn",
                          toDatetimeLocalValue(
                            applyClockToDate(dateFromDateInput(startDate), clock),
                          ),
                          { shouldValidate: true, shouldDirty: true },
                        );
                      }
                    }
                  }}
                />
              </PropertyRow>
              ) : null}

              {!taskIsReminder ? (
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
              ) : null}

              <PropertyRow
                icon={Clock}
                label={taskIsReminder ? (taskTimeOnly ? "Time" : "Notify at") : taskTimeOnly ? "Time" : "Schedule"}
              >
                {taskTimeOnly ? (
                  <TimeField
                    className="min-w-0 flex-1"
                    value={toTimeInputValue(taskScheduledOn)}
                    clearable={!taskIsReminder}
                    aria-label={taskIsReminder ? "Notify at" : "Time"}
                    onChange={setTaskClock}
                  />
                ) : (
                  <DatePicker
                    mode="datetime"
                    value={taskScheduledOn}
                    placeholder={taskIsReminder ? "Pick when to ping" : undefined}
                    onChange={(scheduledOn) =>
                      setValueTask("scheduledOn", scheduledOn, {
                        shouldValidate: true,
                        shouldDirty: true,
                      })
                    }
                  />
                )}
              </PropertyRow>

              <RecurrenceEditor
                label="Repeat"
                icon={Repeat}
                value={taskRecurrence}
                anchor={taskRecurrenceAnchor}
                onChange={(next) => {
                  setTaskRecurrence(next);
                  if (next && !toTimeInputValue(taskScheduledOn)) {
                    setTaskClock(toTimeInputValue(nextRoundHour()));
                  }
                }}
              />
            </div>

            <p className="mt-1 px-1 text-[11px] text-muted-foreground">
              {taskIsReminder
                ? taskRecurrence
                  ? "Each repeat pings at this time. No work block is reserved."
                  : "Pings at this date and time. Does not reserve a work block."
                : taskRecurrence
                  ? "Each occurrence starts at this time. Auto-schedule keeps that block for this task."
                  : "Tasks appear on the calendar once scheduled, by hand or with Auto-schedule."}
            </p>

            {!taskIsReminder && taskErrors.workspaceId && (
              <p className="mt-2 px-1 text-xs text-destructive">
                {taskErrors.workspaceId.message}
              </p>
            )}

            {!taskIsReminder ? (
            <>
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
            </>
            ) : null}
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
              <PropertyRow icon={eventTimeOnly ? Clock : CalendarDays} label={eventTimeOnly ? "Time" : "Starts"}>
                {eventTimeOnly ? (
                  <TimeField
                    className="min-w-0 flex-1"
                    value={toTimeInputValue(eventStart)}
                    clearable={false}
                    aria-label="Time"
                    onChange={(hhmm) =>
                      setEventStart(
                        toDatetimeLocalValue(applyClockToDate(eventStartDate, hhmm)),
                      )
                    }
                  />
                ) : (
                  <DatePicker
                    mode={eventAllDay ? "date" : "datetime"}
                    value={eventStart}
                    onChange={setEventStart}
                    clearable={false}
                  />
                )}
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
              {eventTimeOnly ? (
                <p className="mt-1 px-1 text-[11px] text-muted-foreground">
                  Each occurrence starts at this time. Dates come from the repeat rule.
                </p>
              ) : null}

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
                      color: workspace.color ?? undefined,
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
                  color: workspace.color ?? undefined,
                }))}
              />
            </PropertyRow>

            {addNewMode === "sheet" && (templatesQuery.data?.length ?? 0) > 0 && (
              <PropertyRow icon={LayoutTemplate} label="Template">
                <Select
                  size="sm"
                  value={sheetTemplateId}
                  onChange={(id) => {
                    setTemplateTouched(true);
                    setSheetTemplateId(id);
                  }}
                  placeholder="Blank sheet"
                  className="border-0 bg-transparent px-0 shadow-none"
                  options={[
                    { value: "", label: "Blank sheet" },
                    ...(templatesQuery.data ?? []).map((template) => ({
                      value: template.id,
                      label: template.name || "Untitled",
                    })),
                  ]}
                />
              </PropertyRow>
            )}
            {addNewMode === "sheet" && !!suggestedTemplateId && sheetTemplateId === suggestedTemplateId && (
              <p
                className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground"
                data-testid="sheet-template-suggested"
              >
                <Sparkles className="size-3 shrink-0" />
                Suggested for this title
              </p>
            )}

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
