export type SidebarProps = {
  name: string;
  icon: string;
  href: string;
};

export const SIDEBAR_ITEMS = [
  {
    name: "Calendar",
    icon: "Calendar",
    href: "/calendar",
  },
  {
    name: "Tasks",
    icon: "ListTodo",
    href: "/tasks",
  },
  {
    name: "Docs",
    icon: "FileText",
    href: "/docs",
  },
  {
    name: "Sheets",
    icon: "Sheet",
    href: "/sheets",
  },
  {
    name: "Report",
    icon: "Brain",
    href: "/report",
  },
  {
    name: "Settings",
    icon: "Settings",
    href: "/settings",
  },
];

export type AddNewModeOptions = "workspace" | "task" | "project" | "event" | "doc" | "sheet";

export type CalendarView = "month" | "week" | "day" | "agenda";

export const CALENDAR_VIEWS: { label: string; value: CalendarView }[] = [
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
  { label: "Agenda", value: "agenda" },
];

export type AddNewModeOption = AddNewModeOptions;

export const HOURS = Array.from({ length: 24 }, (_, i) => i);
export function formatHour(h: number) {
  if (h === 0) return "";
  const period = h < 12 ? "AM" : "PM";
  const display = h === 12 ? 12 : h % 12;
  return `${display} ${period}`;
}
export function getGmtLabel() {
  const offsetMin = -new Date().getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, "0");
  return `GMT${sign}${hh}`;
}

export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface Status extends BaseEntity {
  name: string;
  color: string;
  workspaceId: string;
  isDefault?: boolean;
}

export interface Stage extends BaseEntity {
  name: string;
  order: number;
  projectId?: string | null;
}

export interface Project extends BaseEntity {
  title: string;
  description: string | null;
  descriptionRich?: DocContent | null;
  statusId?: string | null;
  deadline?: string | null;
  startDate?: string | null;
  completedAt?: string | null;
  priorityLevel?: string | null;
  color?: string | null;
  doesHaveStages?: boolean;
  workspaceId: string;
  status?: Status | null;
  workspace?: Workspace | null;
  stages?: Stage[];
}

export interface Workspace extends BaseEntity {
  name: string;
  color?: string | null;
  userId: string;
  status: Status[];
  customFields: CustomField[];
  lables?: Label[];
}

export interface Label extends BaseEntity {
  name: string;
  color: string;
  workspaceId: string;
}

export type CustomFieldType =
  | "text"
  | "select"
  | "multi_select"
  | "number"
  | "url"
  | "date"
  | "boolean";

export interface CustomFieldOption {
  id: string;
  value: string;
  color?: string;
}

export interface CustomFieldOptions {
  options: CustomFieldOption[];
}

export interface CustomField {
  id: string;
  name: string;
  workspaceId: string;
  createdTime: string;
  updatedTime: string;
  type: CustomFieldType;
  options: CustomFieldOptions;
}


export interface TaskCustomFieldValue extends BaseEntity {
  customFieldValueId?: string;
  customFieldId: string;
  taskId: string;
  name?: string;
  type?: string;
  "type; not null"?: string;
  stringValue?: string;
  numberValue?: number;
  dateValue?: string;
  boolValue?: boolean;
  optionValue?: CustomFieldOption[];
}

/**
 * Custom field value as written back to the API. `id` is the custom field id;
 * option-based types use `optionsValue`, everything else `stringValue`.
 */
export interface CustomFieldValueInput {
  id: string;
  type: CustomFieldType;
  stringValue?: string;
  optionsValue?: { id: string }[];
}

export interface TaskLabelId {
  id: string;
}

export interface ChecklistItem {
  id: string;
  title: string;
  completedAt: string | null;
  order: number;
}

export type TaskKind = "task" | "reminder" | "inbox";

export interface Task {
  id: string;
  name: string;
  description: string;
  descriptionRich?: DocContent | null;
  timeChunks?: number;
  duration: number;
  kind?: TaskKind;
  parentTaskId?: string | null;
  checklist?: ChecklistItem[];
  actualMinutes?: number;
  focusStartedAt?: string | null;
  todayFocusOn?: string | null;
  minChunkMinutes?: number;
  preferredChunkMinutes?: number | null;
  contiguous?: boolean;
  earliestStartAt?: string | null;
  preferredWindows?: PreferredWindow[];
  scheduleLocked?: boolean;
  openSubtaskCount?: number;
  subtaskCount?: number;
  checklistDone?: number;
  checklistTotal?: number;
  progressDone?: number;
  progressTotal?: number;
  subtasks?: Task[];

  deadline: string | null;
  startDate: string | null;
  scheduledOn: string | null;
  completedAt: string | null;

  createdAt: string;
  updatedAt: string;

  userId: string;
  projectId: string | null;
  statusId: string | null;
  priorityLevel: string | null;
  workspaceId: string | null;
  scheduleId: string | null;
  stageId: string | null;
  blockedById: string | null;
  blockedBy?: { id: string; name?: string } | null;

  project?: Project | null;
  workspace?: Workspace | null;
  status?: Status | null;

  customFieldValues?: TaskCustomFieldValue[];
  labelIds?: TaskLabelId[];
  labels?: Label[];

  /** Set when the task repeats (haircut every 4 weeks, run every Tuesday). */
  recurrence?: RecurrenceRule | null;
  /** Calendar time reserved for a one-off task; empty when unscheduled. */
  blocks?: ScheduledBlock[];
}

/** Payload for attaching a recurrence rule to a task or event. */
export interface RecurrenceInput {
  /** RFC 5545 RRULE, e.g. `FREQ=WEEKLY;BYDAY=TU,TH`. */
  rrule: string;
  /** ISO timestamp of the first occurrence; carries the time of day. */
  dtstart: string;
  /** IANA zone occurrences are expanded in. */
  timezone: string;
}

export interface RecurrenceException {
  id: string;
  ruleId: string;
  originalStart: string;
  newStart: string | null;
  newEnd: string | null;
  isCancelled: boolean;
  completedAt: string | null;
}

export interface RecurrenceRule extends RecurrenceInput {
  id: string;
  ownerType: "task" | "event";
  ownerId: string;
  exceptions?: RecurrenceException[];
}

export type BlockSource = "manual" | "engine";

export interface ScheduledBlock {
  id: string;
  taskId: string;
  start: string;
  end: string;
  source: BlockSource;
  chunkIndex: number;
  locked?: boolean;
  occurrenceStart?: string | null;
}

export interface CalendarEventEntity {
  id: string;
  title: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
  color: string | null;
  userId: string;
  workspaceId: string | null;
  projectId: string | null;
  taskId: string | null;
  recurrence?: RecurrenceRule | null;
  createdAt: string;
  updatedAt: string;
}

export type CalendarItemKind =
  | "task"
  | "event"
  | "taskOccurrence"
  | "eventOccurrence";

/** One entry from GET /calendar. */
export interface CalendarItem {
  id: string;
  kind: CalendarItemKind;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  color: string | null;
  blockId?: string;
  source?: BlockSource;
  chunkIndex: number;
  chunkCount: number;
  taskId?: string;
  eventId?: string;
  seriesId?: string;
  originalStart?: string;
  moved?: boolean;
  completedAt?: string | null;
  task?: Task;
  event?: CalendarEventEntity;
  /** Timed ping with no work estimate; does not reserve a schedule block. */
  reminder?: boolean;
}

export interface CalendarRange {
  from: string;
  to: string;
  items: CalendarItem[];
}

export interface TodayResponse {
  date: string;
  timezone: string;
  focusing: Task | null;
  todayFocus: Task[];
  items: CalendarItem[];
  overdue: Task[];
  inboxCount: number;
  completedToday: Task[];
  unfinished: Task[];
  tomorrowFocus: Task[];
}

export interface WorkingWindow {
  start: string;
  end: string;
}

export type WeekdayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export interface WorkingHours {
  timezone: string;
  days: Partial<Record<WeekdayKey, WorkingWindow[]>>;
  isDefault?: boolean;
}

export interface PreferredWindow {
  days?: string[];
  start: string;
  end: string;
}

export interface ScheduleSettings {
  breakMinutes: number;
  freezeHours: number;
  excludedWorkspaceIds: string[];
}

export interface NotificationSettings {
  reminders: boolean;
  digestMorning: boolean;
  digestEvening: boolean;
  planning: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
  morningDigestAt: string;
  eveningDigestAt: string;
}

export type NotificationCategory = "reminder" | "digest" | "planning";

export interface AppNotification {
  id: string;
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
  data?: Record<string, unknown>;
  dedupeKey?: string | null;
  readAt?: string | null;
  snoozedUntil?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
}

export interface JobRecord {
  id: string;
  userId: string;
  kind: string;
  status: string;
  lastError?: string | null;
  attempts: number;
  maxAttempts: number;
}

export interface JobHealth {
  pending: number;
  running: number;
  failed: number;
  succeededLastHour: number;
}

export type ScheduleSkipReason =
  | "no_capacity"
  | "blocked"
  | "manual"
  | "no_duration"
  | "reminder"
  | "recurring"
  | "completed"
  | "inbox"
  | "parent_has_subtasks"
  | "locked"
  | "frozen"
  | "workspace_excluded"
  | "contiguous_no_fit"
  | "before_earliest"
  | string;

export interface ScheduleProposalBlock {
  start: string;
  end: string;
  chunkIndex: number;
  occurrenceStart?: string;
}

export interface ScheduleProposal {
  taskId: string;
  taskName: string;
  blocks: ScheduleProposalBlock[];
  endsAt: string;
  deadline?: string;
  pastDeadline: boolean;
  reason?: string;
  change?: string;
}

export interface ScheduleSkipped {
  taskId: string;
  taskName: string;
  reason: ScheduleSkipReason;
  message?: string;
}

export interface ScheduleChange {
  action: "add" | "move" | "remove" | "pin" | string;
  taskId: string;
  taskName?: string;
  message: string;
}

export interface ScheduleRisk {
  kind: string;
  taskId?: string;
  taskName?: string;
  message: string;
}

export interface DayCapacity {
  date: string;
  availableMinutes: number;
  scheduledMinutes: number;
  plannedMinutes: number;
  overCapacity: boolean;
  atRisk: boolean;
}

export interface SchedulePlan {
  from: string;
  to: string;
  timezone: string;
  proposals: ScheduleProposal[];
  skipped: ScheduleSkipped[];
  changes?: ScheduleChange[];
  risks?: ScheduleRisk[];
  capacity?: DayCapacity[];
  freeMinutes: number;
  plannedMinutes: number;
  applied: boolean;
  canUndo?: boolean;
}

export interface TaskActivity {
  id: string;
  taskId: string;
  userId: string;
  actorName: string;
  action: "created" | "updated" | "commented";
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  message: string;
  createdAt: string;
}

/** ProseMirror document tree as produced by the Tiptap editor. */
export interface DocContent {
  type?: string;
  content?: unknown[];
  [key: string]: unknown;
}

/** Entities that can be @-mentioned from inside any rich text field. */
export type MentionEntityType = "doc" | "sheet" | "task" | "project";

export interface MentionAttrs {
  id: string;
  label: string;
  entityType: MentionEntityType;
  appearance?: "mention" | "page";
}

export interface Doc {
  id: string;
  title: string;
  icon: string | null;
  content: DocContent;
  plainText: string;
  parentId: string | null;
  workspaceId: string;
  projectId: string | null;
  userId: string;
  isFavorite: boolean;
  archivedAt: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export type SheetColumnType =
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "currency"
  | "percent"
  | "formula";

export interface SheetCellFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  align?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  wrap?: boolean;
  numberFormat?: "number" | "currency" | "percent";
  decimals?: number;
  textColor?: string;
  fillColor?: string;
  border?: "all" | "outer" | "bottom";
  link?: string;
  fontSize?: number;
  fontFamily?: "default" | "serif" | "mono";
  note?: string;
}

export interface SheetColumn {
  id: string;
  name: string;
  width: number;
  type: SheetColumnType;
}

export interface SheetRow {
  id: string;
  cells: Record<string, string>;
  formats?: Record<string, SheetCellFormat>;
}

export interface SheetMerge {
  startCol: number;
  startRow: number;
  colSpan: number;
  rowSpan: number;
}

export interface SheetTab {
  id: string;
  name: string;
  columns: SheetColumn[];
  rows: SheetRow[];
  merges?: SheetMerge[];
}

export interface Sheet {
  id: string;
  title: string;
  icon: string | null;
  description: string;
  descriptionRich?: DocContent | null;
  columns: SheetColumn[];
  rows: SheetRow[];
  merges?: SheetMerge[];
  tabs?: SheetTab[];
  workspaceId: string;
  projectId: string | null;
  userId: string;
  isFavorite: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  is_on_boarding_completed?: boolean;
  isOnBoardingCompleted?: boolean;
}

export interface ApiKey {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreatedApiKey extends ApiKey {
  key: string;
}

export interface Config {
  id: string;
  userId: string;
  isOnBoardingCompleted: boolean;
  customFields?: CustomField[];
  taskViews?: TaskViewConfig[];
  activeTaskViewId?: string;
  appearance?: {
    theme: "system" | "light" | "dark";
    accent: "default" | `#${string}`;
  };
  workingHours?: WorkingHours;
  createdAt?: string;
  updatedAt?: string;
}

export type TaskListSortBy =
  | "name"
  | "deadline"
  | "startDate"
  | "createdAt"
  | "priority"
  | "status"
  | "project";

export type TaskListSortDirection = "asc" | "desc";

export type TaskListGroupBy =
  | "none"
  | "status"
  | "project"
  | "priority"
  | `cf:${string}`;

export type TaskListGroupField =
  | "workspace"
  | "project"
  | "stage"
  | "status"
  | "priority"
  | `cf:${string}`;

export type TaskListGroupSortDirection = "asc" | "desc";

export type TaskListDataMode = "task" | "project";

export type TaskRenderMode = "list" | "kanban" | "gantt";

export interface TaskViewConfig {
  id: string;
  name: string;
  dataMode: TaskListDataMode;
  renderMode: TaskRenderMode;
  groupFields: TaskListGroupField[];
  groupSortDirection: TaskListGroupSortDirection;
  groupValueOrders: Record<string, string[]>;
  sortBy: TaskListSortBy;
  sortDirection: TaskListSortDirection;
  selectedWorkspaceIds: string[];
  selectedStatusIds: string[];
  selectedProjectIds?: string[];
  selectedPriorityLevels?: string[];
  selectedLabelIds?: string[];
  selectedStageIds?: string[];
  showCompleted?: boolean;
  onlyOverdue?: boolean;
  onlyScheduled?: boolean;
  onlyRecurring?: boolean;
  onlyDated?: boolean;
  showReminders?: boolean;
  columnOrder: string[];
  optionsVisible?: boolean;
}

export type DeviceSession = {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
};

export type ProjectActivityEntry = {
  id: string;
  taskId: string;
  taskName: string;
  actorName: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  message: string;
  createdAt: string;
};