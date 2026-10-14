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
  Bell,
  Boxes,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronUp,
  Circle,
  Clock,
  FileText,
  Flag,
  FolderKanban,
  GitBranch,
  LayoutTemplate,
  ListTodo,
  Plus,
  Repeat,
  Sheet as SheetIcon,
  Sparkles,
  Sun,
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
  CreateDialogFooter,
  CreateDialogShell,
  PropertyRow,
  createTitleClass,
} from "@/app/_components/_ui/modal/entityModal";
import Button from "@/app/_components/_ui/button";
import { PropertyChip, PropertyChips } from "@/app/_components/_ui/propertyChip";
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
import { PRIORITY_OPTIONS, priorityColor } from "@/app/utils/priority";
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
    reminder: { icon: Bell, label: "New reminder", action: "Create reminder" },
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
    getValues: getTaskValue,
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
  // This component mounts only while the modal is open, so the draft is often
  // already there on the first render: start from "nothing seen" so that
  // render still switches the kind.
  const draftKindForTaskForm =
    isAddItemModalOpen && addNewMode === "task" ? createTaskDraft?.kind : undefined;
  const [seenDraftKind, setSeenDraftKind] = useState<typeof draftKindForTaskForm>(undefined);
  // The person picked Work or Reminder themselves (in the form, or with the
  // Inbox's "Make it a task" / "Remind me"); a suggested kind never overrides that.
  const [kindTouched, setKindTouched] = useState(false);
  if (seenDraftKind !== draftKindForTaskForm) {
    setSeenDraftKind(draftKindForTaskForm);
    if (draftKindForTaskForm) {
      setTaskKind(draftKindForTaskForm);
      setKindTouched(true);
    }
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

  // What Schedule held before the person picked Reminder, so going back to
  // Work does not keep the ping time as a scheduled block.
  const [workSchedule, setWorkSchedule] = useState<string | null>(null);
  const makeTaskReminder = () => {
    setTaskKind("reminder");
    setWorkSchedule(taskScheduledOn);
    setValueTask("duration", 0, { shouldValidate: true, shouldDirty: true });
    // A time the suggestions read from the words ("Tuesday afternoon") is
    // the ping; one that has already passed pings at the next hour.
    if (suggestions?.date && (suggestions.dateRole === "reminder" || suggestions.time)) {
      const at = applyClockToDate(dateFromDateInput(suggestions.date), suggestions.time || "09:00");
      setValueTask("scheduledOn", toDatetimeLocalValue(at < new Date() ? nextRoundHour() : at), {
        shouldValidate: true,
        shouldDirty: true,
      });
    } else if (!taskScheduledOn) {
      setTaskClock(toTimeInputValue(nextRoundHour()));
    }
  };
  const makeTaskWork = () => {
    setTaskKind("task");
    setValueTask("duration", 30, { shouldValidate: true, shouldDirty: true });
    if (workSchedule !== null) {
      setValueTask("scheduledOn", workSchedule, { shouldValidate: true, shouldDirty: true });
      setWorkSchedule(null);
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
      if (nextDraft?.kind) {
        // taskKind itself follows the draft during render (see above); a
        // Reminder gets what picking it in the form gives: no length, and the
        // next hour until a time is set.
        if (nextDraft.kind === "reminder") {
          setValueTask("duration", 0, { shouldValidate: true, shouldDirty: true });
          if (!getTaskValue("scheduledOn")) {
            setValueTask("scheduledOn", toDatetimeLocalValue(nextRoundHour()), {
              shouldValidate: true,
              shouldDirty: true,
            });
          }
        }
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
    getTaskValue,
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
  // Asked even with smart suggestions off: the server still reads "Remind
  // me…" and a date or time in the words, which needs no model.
  const suggestionsQuery = useClarifySuggestions(clarifyInboxId);
  const suggestions = suggestionsQuery.data?.available ? suggestionsQuery.data : undefined;
  const decisionFeedback = useDecisionFeedback();
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
    // A draft that names the kind counts as chosen even in the render that
    // reads it, before the kindTouched update above has landed (the answer is
    // often cached already, from the Inbox card).
    const workTouched =
      kindTouched || Boolean(draftKindForTaskForm) || WORK_FIELDS.some((name) => getTaskFieldState(name).isDirty);
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
      // A reminder time read from the words is set below instead; the default
      // here would mark the field as edited and block it.
      const readTime = suggestions.dateRole === "reminder" && Boolean(suggestions.date);
      if (!taskScheduledOn && !readTime) setTaskClock(toTimeInputValue(nextRoundHour()));
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
        // Only the date: a time here would place a block on the calendar.
        setValueTask("startDate", suggestions.date, { shouldValidate: true });
        dateFilled = true;
      } else if (
        suggestions.dateRole === "reminder" &&
        taskKind === "reminder" &&
        // Still empty, or only the next-hour default from picking Reminder.
        (!getTaskFieldState("scheduledOn").isDirty ||
          getTaskValue("scheduledOn") === toDatetimeLocalValue(nextRoundHour()))
      ) {
        // A read time that has already passed today pings at the next hour.
        const at = applyClockToDate(day, suggestions.time || "09:00");
        setValueTask("scheduledOn", toDatetimeLocalValue(at < new Date() ? nextRoundHour() : at), { shouldValidate: true });
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

  const workspaceName = useWatch({ control: workspaceControl, name: "name" }) ?? "";
  const projectHasStages = useWatch({ control: projectControl, name: "doesHaveStages" }) ?? false;
  const [more, setMore] = useState(false);

  const kindValue = addNewMode === "task" ? (taskIsReminder ? "reminder" : "task") : addNewMode;
  const meta = {
    ...(MODE_META[kindValue] ?? MODE_META.task),
    ...(isClarify ? { label: "Clarify", action: "Clarify" } : {}),
  };

  const currentTitle = () => {
    switch (addNewMode) {
      case "workspace":
        return workspaceName;
      case "project":
        return projectTitle;
      case "task":
        return taskName;
      case "event":
        return eventTitle;
      default:
        return pageTitle ?? "";
    }
  };

  // The kind chip in the header switches the form in place; a typed title
  // comes along when the new kind's title is still empty.
  const switchKind = (next: string) => {
    if (next === kindValue) return;
    setMore(false);
    if (next === "task" || next === "reminder") {
      setKindTouched(true);
      if (next === "reminder" && !taskIsReminder) makeTaskReminder();
      if (next === "task" && taskIsReminder) makeTaskWork();
    }
    const title = currentTitle().trim();
    const mode = next === "reminder" ? "task" : (next as typeof addNewMode);
    if (title && mode !== addNewMode) {
      const opts = { shouldValidate: true, shouldDirty: true };
      if (mode === "workspace" && !workspaceName) setWorkspaceValue("name", title, opts);
      if (mode === "project" && !projectTitle) setValue("title", title, opts);
      if (mode === "task" && !taskName) setValueTask("name", title, opts);
      if (mode === "event" && !eventTitle) setEventTitle(title);
      if ((mode === "doc" || mode === "sheet") && !pageTitle) setValuePage("title", title, opts);
    }
    if (mode !== addNewMode) useSidebarStore.getState().setAddNewMode(mode);
  };

  const kindChip = (
    <>
      {isClarify ? <span className="text-sm font-medium text-muted-foreground">Clarify as</span> : null}
      <Select
        variant="chip"
        active
        aria-label="Kind"
        value={kindValue}
        onChange={switchKind}
        options={(isClarify ? KIND_OPTIONS.filter((option) => option.value === "task" || option.value === "reminder") : KIND_OPTIONS)}
      />
    </>
  );

  const workspaceOptions = typedWorkspaces.map((workspace) => ({
    value: workspace.id,
    label: workspace.name,
    color: workspace.color ?? undefined,
  }));
  const workspaceLabel = (id?: string) => typedWorkspaces.find((workspace) => workspace.id === id)?.name;

  if (addNewMode === "workspace") {
    return (
      <CreateDialogShell
        label={meta.label}
        size="sm"
        onClose={closeModal}
        header={kindChip}
        footer={
          <CreateDialogFooter
            summary="Add projects, statuses and labels in Settings next"
            error={createWorkspaceMutation.isError ? "Could not save" : null}
            onCancel={closeModal}
          >
            <CreateAction formId="create-workspace" label={meta.action} pending={createWorkspaceMutation.isPending} disabled={!isValid} />
          </CreateDialogFooter>
        }
      >
        <form id="create-workspace" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div>
            <input autoFocus {...register("name")} placeholder="Workspace name" className={createTitleClass} />
            {errors.name && <p className="mt-2 text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <PropertyChips>
            <ColorPicker
              variant="chip"
              value={workspaceColor}
              onChange={(color) => setWorkspaceValue("color", color, { shouldValidate: true, shouldDirty: true })}
              aria-label="Workspace colour"
            />
          </PropertyChips>
        </form>
      </CreateDialogShell>
    );
  }

  if (addNewMode === "project") {
    const projectCustomFields = selectedWorkspace?.customFields ?? [];
    const filledProjectFields = projectCustomFields.filter((field) => {
      const draft = findCustomFieldDraft(projectCustomFieldValues, field.id);
      return Boolean(draft?.stringValue || draft?.optionsValue?.length);
    }).length;
    return (
      <CreateDialogShell
        label={meta.label}
        onClose={closeModal}
        header={kindChip}
        footer={
          <CreateDialogFooter
            summary={joinSummary([
              `In ${workspaceLabel(selectedWorkspaceId) ?? "no workspace yet"}`,
              projectDeadline ? `due ${shortDay(projectDeadline)}` : "",
            ])}
            error={createProjectMutation.isError ? "Could not save" : null}
            onCancel={closeModal}
          >
            <CreateAction formId="create-project" label={meta.action} pending={createProjectMutation.isPending} disabled={!isProjectValid} />
          </CreateDialogFooter>
        }
      >
        <form id="create-project" onSubmit={handleProjectSubmit(onProjectSubmit)} className="flex flex-col gap-4">
          <div>
            <input autoFocus {...registerProject("title")} placeholder="Project name" className={createTitleClass} />
            {projectErrors.title && <p className="mt-2 text-xs text-destructive">{projectErrors.title.message}</p>}
          </div>

          <DescriptionBox>
            <RichTextEditor
              variant="compact"
              toolbar="focus"
              content={projectDescription.content}
              placeholder="Add a description. Type / for blocks, @ to mention docs, sheets, tasks"
              writeContext={{ kind: "project", title: projectTitle }}
              onChange={({ content, plainText }) => setProjectDescription({ content, plainText })}
            />
          </DescriptionBox>

          <PropertyChips>
            <Select
              variant="chip"
              aria-label="Workspace"
              icon={<FolderKanban />}
              value={selectedWorkspaceId ?? ""}
              placeholder="Workspace"
              onChange={(workspaceId) => setValue("workspaceId", workspaceId, { shouldValidate: true, shouldDirty: true })}
              options={workspaceOptions}
            />
            <Select
              variant="chip"
              aria-label="Status"
              icon={<Circle />}
              value={projectStatusId}
              placeholder="Status"
              onChange={(statusId) => setValue("statusId", statusId, { shouldValidate: true, shouldDirty: true })}
              options={(selectedWorkspace?.status ?? []).map((status: Status) => ({
                value: status.id,
                label: status.name,
                color: status.color,
              }))}
            />
            <Select
              variant="chip"
              aria-label="Priority"
              value={projectPriorityLevel}
              tint={priorityTint(projectPriorityLevel)}
              onChange={(priorityLevel) => setValue("priorityLevel", priorityLevel, { shouldValidate: true, shouldDirty: true })}
              options={PRIORITY_CHIP_OPTIONS}
            />
            <DatePicker
              variant="chip"
              mode="date"
              aria-label="Start date"
              chipLabel="Start date"
              chipPrefix="Starts"
              value={projectStartDate}
              onChange={(startDate) => setValue("startDate", startDate, { shouldValidate: true, shouldDirty: true })}
            />
            <DatePicker
              variant="chip"
              mode="date"
              aria-label="Deadline"
              chipLabel="Deadline"
              chipPrefix="Due"
              value={projectDeadline}
              onChange={(deadline) => setValue("deadline", deadline, { shouldValidate: true, shouldDirty: true })}
            />
            <ColorPicker
              variant="chip"
              value={projectColor}
              onChange={(color) => setValue("color", color, { shouldValidate: true, shouldDirty: true })}
              aria-label="Project colour"
            />
            <PropertyChip
              icon={<GitBranch />}
              active={projectHasStages}
              aria-pressed={projectHasStages}
              onClick={() => setValue("doesHaveStages", !projectHasStages, { shouldValidate: true, shouldDirty: true })}
            >
              {projectHasStages ? "Stages on" : "Stages"}
            </PropertyChip>
            <MoreChip open={more} onToggle={() => setMore((open) => !open)} label="Custom fields" count={filledProjectFields} />
          </PropertyChips>

          {projectErrors.workspaceId && <p className="text-xs text-destructive">{projectErrors.workspaceId.message}</p>}

          {more ? (
            <MoreSection>
              <SectionCaption>Custom fields</SectionCaption>
              <CustomFieldRows
                fields={projectCustomFields}
                values={projectCustomFieldValues}
                onChange={changeProjectCustomField}
              />
              <CreateCustomFieldInline workspaceId={selectedWorkspaceId} onCreated={addProjectCustomField} />
            </MoreSection>
          ) : null}

          <ProjectStartChoices
            suggestion={projectStart.suggestion}
            choices={projectStart.choices}
            onChange={projectStart.setChoices}
          />
        </form>
      </CreateDialogShell>
    );
  }

  if (addNewMode === "task") {
    const taskProject = availableTaskProjects.find((project) => project.id === taskProjectId);
    const taskCustomFields = selectedTaskWorkspace?.customFields ?? [];
    const filledTaskFields = taskCustomFields.filter((field) => {
      const draft = findCustomFieldDraft(taskCustomFieldValues, field.id);
      return Boolean(draft?.stringValue || draft?.optionsValue?.length);
    }).length;
    const moreCount = taskIsReminder
      ? (taskRecurrence ? 1 : 0)
      : (taskRecurrence ? 1 : 0) + (taskStartDate ? 1 : 0) + taskLabelIds.length + filledTaskFields;
    const minutes = Number(taskDuration) || 0;
    const summary = taskIsReminder
      ? taskScheduledOn
        ? `Reminds you ${taskTimeOnly ? `at ${shortTime(taskScheduledOn)}` : shortDayTime(taskScheduledOn)}${taskRecurrence ? ", repeating" : ""}`
        : "Pick when to remind you"
      : joinSummary([
          `In ${taskProject?.title ?? workspaceLabel(selectedTaskWorkspaceId) ?? "no workspace yet"}`,
          taskScheduledOn
            ? `scheduled ${taskTimeOnly ? `at ${shortTime(taskScheduledOn)}` : shortDayTime(taskScheduledOn)}`
            : taskDeadline
              ? `Auto-schedule finds ${formatDuration(minutes)} before ${shortDay(taskDeadline)}`
              : "Auto-schedule can place it",
        ]);
    const reminderAt = taskTimeOnly ? (
      <TimeField
        variant="chip"
        chipLabel={taskIsReminder ? "Notify at" : "Time"}
        chipPrefix={taskIsReminder ? "At" : "At"}
        value={toTimeInputValue(taskScheduledOn)}
        clearable={!taskIsReminder}
        aria-label={taskIsReminder ? "Notify at" : "Time"}
        onChange={setTaskClock}
      />
    ) : (
      <DatePicker
        variant="chip"
        mode="datetime"
        icon={taskIsReminder ? <Bell /> : <CalendarClock />}
        chipLabel={taskIsReminder ? "Notify at" : "Schedule"}
        aria-label={taskIsReminder ? "Notify at" : "Schedule"}
        value={taskScheduledOn}
        clearable={!taskIsReminder}
        onChange={(scheduledOn) => setValueTask("scheduledOn", scheduledOn, { shouldValidate: true, shouldDirty: true })}
      />
    );
    const priorityChip = (
      <Select
        variant="chip"
        aria-label="Priority"
        value={taskPriorityLevel}
        tint={priorityTint(taskPriorityLevel)}
        onChange={(priorityLevel) => setValueTask("priorityLevel", priorityLevel, { shouldValidate: true, shouldDirty: true })}
        options={PRIORITY_CHIP_OPTIONS}
      />
    );
    const repeatEditor = (
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
    );

    return (
      <CreateDialogShell
        label={meta.label}
        onClose={closeModal}
        header={kindChip}
        footer={
          <CreateDialogFooter
            summary={summary}
            error={createTaskMutation.isError || clarifyInboxMutation.isError ? "Could not save" : null}
            onCancel={closeModal}
          >
            <CreateAction
              formId="create-task"
              label={meta.action}
              pending={createTaskMutation.isPending || clarifyInboxMutation.isPending}
              disabled={!isTaskValid}
            />
          </CreateDialogFooter>
        }
      >
        <form id="create-task" onSubmit={handleTaskSubmit(onTaskSubmit)} className="flex flex-col gap-4">
          <div>
            <input
              autoFocus
              {...registerTask("name")}
              placeholder={taskIsReminder ? "Remind me to…" : "What needs to be done?"}
              className={createTitleClass}
            />
            {taskErrors.name && <p className="mt-2 text-xs text-destructive">{taskErrors.name.message}</p>}
          </div>

          {isClarify && (
            <ClarifyHints
              loading={decisionsOn && suggestionsQuery.isFetching && !suggestionsQuery.data}
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

          <DescriptionBox>
            <RichTextEditor
              variant="compact"
              toolbar="focus"
              content={taskDescription.content}
              placeholder="Add notes. Type / for blocks, @ to mention docs, sheets, projects"
              writeContext={{ kind: "task", title: taskName }}
              onChange={({ content, plainText }) => setTaskDescription({ content, plainText })}
            />
          </DescriptionBox>

          {taskIsReminder ? (
            <PropertyChips>
              {reminderAt}
              {priorityChip}
              <MoreChip open={more} onToggle={() => setMore((open) => !open)} label="Repeat" count={moreCount} />
            </PropertyChips>
          ) : (
            <PropertyChips>
              <Select
                variant="chip"
                aria-label="Workspace"
                icon={<FolderKanban />}
                value={selectedTaskWorkspaceId ?? ""}
                placeholder="Workspace"
                onChange={(workspaceId) => setValueTask("workspaceId", workspaceId, { shouldValidate: true, shouldDirty: true })}
                options={workspaceOptions}
              />
              <Select
                variant="chip"
                aria-label="Project"
                icon={<ListTodo />}
                value={taskProjectId}
                placeholder="Project"
                onChange={(projectId) => {
                  setValueTask("projectId", projectId, { shouldValidate: true, shouldDirty: true });
                  setValueTask("stageId", "", { shouldDirty: true });
                }}
                options={[
                  { value: "", label: "No project" },
                  ...availableTaskProjects.map((project) => ({
                    value: project.id,
                    label: project.title,
                    color: project.color ?? undefined,
                  })),
                ]}
              />
              {availableTaskStages.length > 0 ? (
                <Select
                  variant="chip"
                  aria-label="Stage"
                  icon={<GitBranch />}
                  value={taskStageId}
                  placeholder="Stage"
                  onChange={(stageId) => setValueTask("stageId", stageId, { shouldValidate: true, shouldDirty: true })}
                  options={[
                    { value: "", label: "No stage" },
                    ...availableTaskStages.map((stage) => ({
                      value: stage.id,
                      label: stage.name,
                      color: stage.color || undefined,
                    })),
                  ]}
                />
              ) : null}
              <Select
                variant="chip"
                aria-label="Status"
                icon={<Circle />}
                value={taskStatusId}
                placeholder="Status"
                onChange={(statusId) => setValueTask("statusId", statusId, { shouldValidate: true, shouldDirty: true })}
                options={(selectedTaskWorkspace?.status ?? []).map((status: Status) => ({
                  value: status.id,
                  label: status.name,
                  color: status.color,
                }))}
              />
              {priorityChip}
              <Select
                variant="chip"
                aria-label="Duration"
                icon={<Clock />}
                value={String(minutes)}
                onChange={(value) => setValueTask("duration", Number(value), { shouldValidate: true, shouldDirty: true })}
                options={durationOptions(minutes)}
              />
              {suggestedDuration && suggestedDuration !== minutes ? (
                <PropertyChip
                  icon={<Sparkles />}
                  title="Use the suggested length"
                  className="bg-accent/60 text-accent-foreground"
                  onClick={() => setValueTask("duration", suggestedDuration, { shouldValidate: true, shouldDirty: true })}
                >
                  Suggested {formatDuration(suggestedDuration)}
                </PropertyChip>
              ) : null}
              <DatePicker
                variant="chip"
                mode="date"
                aria-label="Deadline"
                chipLabel="Deadline"
                chipPrefix="Due"
                value={taskDeadline}
                onChange={(deadline) => setValueTask("deadline", deadline, { shouldValidate: true, shouldDirty: true })}
              />
              {reminderAt}
              <MoreChip
                open={more}
                onToggle={() => setMore((open) => !open)}
                label="Repeat, start date, labels"
                count={moreCount}
              />
            </PropertyChips>
          )}

          {!taskIsReminder && taskErrors.workspaceId && (
            <p className="text-xs text-destructive">{taskErrors.workspaceId.message}</p>
          )}

          {more ? (
            <MoreSection>
              <div className="flex flex-col gap-1">
                {!taskIsReminder ? (
                  <PropertyRow icon={CalendarDays} label="Start date">
                    <DatePicker
                      mode="date"
                      size="sm"
                      className="border-transparent bg-transparent shadow-none hover:border-transparent hover:bg-muted"
                      value={taskStartDate}
                      onChange={(startDate) => {
                        setValueTask("startDate", startDate, { shouldValidate: true, shouldDirty: true });
                        if (taskTimeOnly && taskScheduledOn) {
                          const clock = toTimeInputValue(taskScheduledOn);
                          if (clock) {
                            setValueTask(
                              "scheduledOn",
                              toDatetimeLocalValue(applyClockToDate(dateFromDateInput(startDate), clock)),
                              { shouldValidate: true, shouldDirty: true },
                            );
                          }
                        }
                      }}
                    />
                  </PropertyRow>
                ) : null}
                {repeatEditor}
              </div>
              <p className="text-xs text-muted-foreground">
                {taskIsReminder
                  ? taskRecurrence
                    ? "Each repeat pings at this time. No work block is reserved."
                    : "Pings at one date and time. No work block is reserved."
                  : taskRecurrence
                    ? "Each occurrence starts at this time. Auto-schedule keeps that block for this task."
                    : "Auto-schedule won't start it before the start date."}
              </p>
              {!taskIsReminder ? (
                <>
                  <div className="flex flex-col gap-2">
                    <SectionCaption>{taskLabelIds.length ? `Labels · ${taskLabelIds.length}` : "Labels"}</SectionCaption>
                    <LabelPicker
                      labels={selectedTaskWorkspace?.lables ?? []}
                      selectedIds={taskLabelIds}
                      emptyLabel=""
                      onChange={(labelIds) => setValueTask("labelIds", labelIds, { shouldValidate: true, shouldDirty: true })}
                    />
                    <CreateLabelInline workspaceId={selectedTaskWorkspaceId} onCreated={addTaskLabel} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <SectionCaption>Custom fields</SectionCaption>
                    <CustomFieldRows fields={taskCustomFields} values={taskCustomFieldValues} onChange={changeTaskCustomField} />
                    <CreateCustomFieldInline workspaceId={selectedTaskWorkspaceId} onCreated={addTaskCustomField} />
                  </div>
                </>
              ) : null}
            </MoreSection>
          ) : null}
        </form>
      </CreateDialogShell>
    );
  }

  if (addNewMode === "event") {
    const minutes = Math.max(15, eventDuration || 60);
    const end = new Date(new Date(eventStart).getTime() + minutes * 60_000);
    const summary = !eventStart
      ? "Pick when it starts"
      : joinSummary([
          eventTimeOnly
            ? `Every repeat at ${shortTime(eventStart)} to ${shortTime(toDatetimeLocalValue(end))}`
            : eventAllDay
              ? `${shortDay(eventStart)}, all day`
              : `${shortDayTime(eventStart)} to ${shortTime(toDatetimeLocalValue(end))}`,
          eventWorkspaceId ? `in ${workspaceLabel(eventWorkspaceId)}` : "",
        ]);

    return (
      <CreateDialogShell
        label={meta.label}
        onClose={closeModal}
        header={kindChip}
        footer={
          <CreateDialogFooter
            summary={summary}
            error={
              createEventMutation.isError
                ? createEventMutation.error instanceof Error
                  ? createEventMutation.error.message
                  : "Could not create event."
                : null
            }
            onCancel={closeModal}
          >
            <CreateAction formId="create-event" label={meta.action} pending={createEventMutation.isPending} disabled={!isEventValid} />
          </CreateDialogFooter>
        }
      >
        <form id="create-event" onSubmit={onEventSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <input
              autoFocus
              value={eventTitle}
              onChange={(input) => setEventTitle(input.target.value)}
              placeholder="Event name"
              className={createTitleClass}
            />
            <textarea
              value={eventDescription}
              onChange={(input) => setEventDescription(input.target.value)}
              placeholder="Notes, place, links"
              rows={2}
              className="field-sizing-content min-h-12 w-full resize-none bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>

          <PropertyChips>
            {eventTimeOnly ? (
              <TimeField
                variant="chip"
                chipLabel="Time"
                chipPrefix="At"
                value={toTimeInputValue(eventStart)}
                clearable={false}
                aria-label="Time"
                onChange={(hhmm) => setEventStart(toDatetimeLocalValue(applyClockToDate(eventStartDate, hhmm)))}
              />
            ) : (
              <DatePicker
                variant="chip"
                mode={eventAllDay ? "date" : "datetime"}
                aria-label="Starts"
                chipLabel="Starts"
                value={eventStart}
                onChange={setEventStart}
                clearable={false}
              />
            )}
            {!eventAllDay ? (
              <Select
                variant="chip"
                aria-label="Duration"
                icon={<Clock />}
                value={String(minutes)}
                onChange={(value) => setEventDuration(Number(value) || 60)}
                options={durationOptions(minutes)}
              />
            ) : null}
            <PropertyChip
              icon={<Sun />}
              active={eventAllDay}
              aria-pressed={eventAllDay}
              onClick={() => setEventAllDay(!eventAllDay)}
            >
              All day
            </PropertyChip>
            <Select
              variant="chip"
              aria-label="Workspace"
              icon={<FolderKanban />}
              value={eventWorkspaceId}
              placeholder="Workspace"
              onChange={setEventWorkspaceId}
              options={[{ value: "", label: "None" }, ...workspaceOptions]}
            />
            <MoreChip open={more} onToggle={() => setMore((open) => !open)} label="Repeat" count={eventRecurrence ? 1 : 0} />
          </PropertyChips>

          {more ? (
            <MoreSection>
              <RecurrenceEditor
                label="Repeat"
                icon={Repeat}
                value={eventRecurrence}
                anchor={eventStartDate}
                onChange={setEventRecurrence}
              />
              <p className="text-xs text-muted-foreground">
                {eventTimeOnly
                  ? "Each occurrence starts at this time. Dates come from the repeat rule."
                  : "Events block time on the calendar; Auto-schedule plans tasks around them."}
              </p>
            </MoreSection>
          ) : null}
        </form>
      </CreateDialogShell>
    );
  }

  if (addNewMode === "doc" || addNewMode === "sheet") {
    const pending = createDocMutation.isPending || createSheetMutation.isPending;
    const template = (templatesQuery.data ?? []).find((entry) => entry.id === sheetTemplateId);
    const kindWord = addNewMode === "doc" ? "doc" : "sheet";

    return (
      <CreateDialogShell
        label={meta.label}
        size="sm"
        onClose={closeModal}
        header={kindChip}
        footer={
          <CreateDialogFooter
            summary={joinSummary([
              `In ${workspaceLabel(selectedPageWorkspaceId) ?? "no workspace yet"}`,
              addNewMode === "sheet" && template ? `from ${template.name || "Untitled"}` : `blank ${kindWord}`,
            ])}
            error={createDocMutation.isError || createSheetMutation.isError ? "Could not save" : null}
            onCancel={closeModal}
          >
            <CreateAction formId="create-page" label={meta.action} pending={pending} disabled={!isPageValid} />
          </CreateDialogFooter>
        }
      >
        <form
          id="create-page"
          onSubmit={handlePageSubmit(addNewMode === "doc" ? onDocSubmit : onSheetSubmit)}
          className="flex flex-col gap-4"
        >
          <div>
            <input
              autoFocus
              {...registerPage("title")}
              placeholder={addNewMode === "doc" ? "Doc title" : "Sheet title"}
              className={createTitleClass}
            />
            {pageErrors.title && <p className="mt-2 text-xs text-destructive">{pageErrors.title.message}</p>}
          </div>

          <PropertyChips>
            <Select
              variant="chip"
              aria-label="Workspace"
              icon={<FolderKanban />}
              value={selectedPageWorkspaceId ?? ""}
              placeholder="Workspace"
              onChange={(workspaceId) => setValuePage("workspaceId", workspaceId, { shouldValidate: true, shouldDirty: true })}
              options={workspaceOptions}
            />
            {addNewMode === "sheet" && (templatesQuery.data?.length ?? 0) > 0 && (
              <Select
                variant="chip"
                aria-label="Template"
                icon={<LayoutTemplate />}
                value={sheetTemplateId}
                placeholder="Blank sheet"
                onChange={(id) => {
                  setTemplateTouched(true);
                  setSheetTemplateId(id);
                }}
                options={[
                  { value: "", label: "Blank sheet" },
                  ...(templatesQuery.data ?? []).map((entry) => ({
                    value: entry.id,
                    label: entry.name || "Untitled",
                  })),
                ]}
              />
            )}
            {addNewMode === "sheet" && !!suggestedTemplateId && sheetTemplateId === suggestedTemplateId && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="sheet-template-suggested">
                <Sparkles className="size-3 shrink-0" />
                Suggested for this title
              </span>
            )}
          </PropertyChips>

          {pageErrors.workspaceId && <p className="text-xs text-destructive">{pageErrors.workspaceId.message}</p>}
        </form>
      </CreateDialogShell>
    );
  }

  return null;
}

const KIND_OPTIONS = [
  { value: "task", label: "Task", icon: <ListTodo /> },
  { value: "reminder", label: "Reminder", icon: <Bell /> },
  { value: "event", label: "Event", icon: <CalendarDays /> },
  { value: "doc", label: "Doc", icon: <FileText /> },
  { value: "sheet", label: "Sheet", icon: <SheetIcon /> },
  { value: "project", label: "Project", icon: <FolderKanban /> },
  { value: "workspace", label: "Workspace", icon: <Boxes /> },
];

const PRIORITY_CHIP_OPTIONS = PRIORITY_OPTIONS.map((option) => ({
  ...option,
  icon: <Flag style={{ color: priorityColor(option.value) ?? undefined }} />,
}));

/** Only High and Urgent tint their chip, so the row stays calm. */
function priorityTint(priority: string) {
  return priority === "High" || priority === "Urgent" ? priorityColor(priority) ?? undefined : undefined;
}

const DURATION_STEPS = [15, 30, 45, 60, 90, 120, 180, 240, 480];

function durationOptions(current: number) {
  const steps = current > 0 && !DURATION_STEPS.includes(current) ? [...DURATION_STEPS, current].sort((a, b) => a - b) : DURATION_STEPS;
  return steps.map((minutes) => ({ value: String(minutes), label: formatDuration(minutes) }));
}

function joinSummary(parts: string[]) {
  const text = parts.filter(Boolean).join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function shortDay(value: string) {
  const date = value.includes("T") ? new Date(value) : dateFromDateInput(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function shortTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function shortDayTime(value: string) {
  return `${shortDay(value)}, ${shortTime(value)}`;
}

function DescriptionBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex max-h-72 min-h-28 shrink-0 flex-col overflow-hidden rounded-[12px] border border-border px-3 pt-2 transition-colors focus-within:border-ring/60">
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

function MoreChip({ open, onToggle, label, count }: { open: boolean; onToggle: () => void; label: string; count: number }) {
  return (
    <PropertyChip
      icon={open ? <ChevronUp /> : <Plus />}
      empty={!open && count === 0}
      active={open}
      aria-expanded={open}
      onClick={onToggle}
    >
      {count > 0 && !open ? `${label} · ${count}` : label}
    </PropertyChip>
  );
}

function MoreSection({ children }: { children: React.ReactNode }) {
  return <section className="flex flex-col gap-4 rounded-[12px] bg-muted/30 p-4">{children}</section>;
}

function SectionCaption({ children }: { children: React.ReactNode }) {
  return <p className="px-1.5 text-xs font-medium text-muted-foreground">{children}</p>;
}

function CustomFieldRows({
  fields,
  values,
  onChange,
}: {
  fields: CustomField[];
  values: CustomFieldValueInput[];
  onChange: (field: CustomField, next: Pick<CustomFieldValueInput, "stringValue" | "optionsValue">) => void;
}) {
  if (fields.length === 0) return null;
  return (
    <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
      {fields.map((field) => (
        <PropertyRow key={field.id} icon={customFieldIcon(field.type)} label={field.name}>
          <CustomFieldControl field={field} value={findCustomFieldDraft(values, field.id)} onChange={(next) => onChange(field, next)} />
        </PropertyRow>
      ))}
    </div>
  );
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
}: {
  formId: string;
  label: string;
  pending: boolean;
  disabled: boolean;
}) {
  return (
    <Button type="submit" form={formId} disabled={disabled || pending} loading={pending} leading={<Check />}>
      {pending ? "Creating…" : label}
    </Button>
  );
}
