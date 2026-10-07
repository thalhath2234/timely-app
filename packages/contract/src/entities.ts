import type { TaskKind } from "./index";
import type { DocContent } from "./documents";

/**
 * Core entities as the Go API serialises them (`apps/api/internal/models`).
 * Timestamps and dates are ISO strings. A key marked `?` is `omitempty` on the
 * server (absent when empty or not preloaded); `T | null` is a nullable column.
 */

export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface Status extends BaseEntity {
  name: string;
  color: string;
  workspaceId: string;
  isDefault: boolean;
}

export interface Stage extends BaseEntity {
  name: string;
  order: number;
  /** Empty string when no colour is set. */
  color: string;
  projectId: string | null;
}

export interface Project extends BaseEntity {
  title: string;
  description: string;
  descriptionRich?: DocContent | null;
  statusId: string | null;
  deadline: string | null;
  startDate: string | null;
  completedAt: string | null;
  priorityLevel: string | null;
  color: string | null;
  doesHaveStages: boolean;
  /** A Go pointer, but every project is created inside a workspace. */
  workspaceId: string;
  status?: Status | null;
  workspace?: Workspace | null;
  stages?: Stage[];
  tasks?: Task[];
  customFieldValues?: TaskCustomFieldValue[];
}

export interface Workspace extends BaseEntity {
  name: string;
  /** Always set; the server fills a default palette colour on create. */
  color: string;
  /** A Go pointer, but always set from the authenticated user. */
  userId: string;
  /** Omitted by the server when the workspace has none. */
  status?: Status[];
  customFields?: CustomField[];
  /** Sic: the server's JSON key is misspelled `lables`. */
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
  color: string;
}

export interface CustomFieldOptions {
  options: CustomFieldOption[];
}

export interface CustomField {
  id: string;
  name: string;
  workspaceId: string;
  /** Sic: `createdTime`/`updatedTime`, not `createdAt`/`updatedAt`. */
  createdTime: string;
  updatedTime: string;
  type: CustomFieldType;
  options: CustomFieldOptions;
}

/**
 * A custom field value as read from a task or project. The server's id for the
 * row is `customFieldValueId`; there is no `id`. Only `stringValue` (and the
 * derived `boolValue` / `optionValue`) is ever sent; there is no number or date
 * column.
 */
export interface TaskCustomFieldValue {
  customFieldValueId: string;
  customFieldId: string;
  taskId?: string;
  projectId?: string;
  name?: string;
  type: string;
  stringValue?: string;
  boolValue?: boolean;
  optionValue?: CustomFieldOption[];
  createdAt: string;
  updatedAt: string;
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

export interface PreferredWindow {
  days?: string[];
  start: string;
  end: string;
}

/** A named schedule a task can belong to (`models/schedule.go`). */
export interface Schedule extends BaseEntity {
  name: string;
  type: string;
}

/**
 * A task row of any `kind`; "Work" in CONTEXT.md is `kind: "task"`. The server
 * always sends the fields marked `?` below (and `recurrence`/`blocks` may be
 * JSON null). They are optional here only because the clients build synthetic
 * rows (project roll-ups, optimistic edits) that leave them out.
 */
export interface Task {
  id: string;
  name: string;
  description: string;
  descriptionRich?: DocContent | null;
  duration: number;
  kind: TaskKind;
  checklist?: ChecklistItem[];
  actualMinutes?: number;
  focusStartedAt?: string | null;
  /** Set while a focus session is paused; the task is in Today's paused slot. */
  focusPausedAt?: string | null;
  todayFocusOn?: string | null;
  minChunkMinutes?: number;
  preferredChunkMinutes?: number | null;
  contiguous?: boolean;
  earliestStartAt?: string | null;
  preferredWindows?: PreferredWindow[];
  scheduleLocked?: boolean;
  checklistDone?: number;
  checklistTotal?: number;
  progressDone?: number;
  progressTotal?: number;

  deadline: string | null;
  startDate: string | null;
  scheduledOn: string | null;
  completedAt: string | null;

  createdAt: string;
  updatedAt: string;

  /** A Go pointer, but always set from the authenticated user. */
  userId: string;
  projectId: string | null;
  statusId: string | null;
  priorityLevel: string | null;
  /** Null for inbox items and standalone reminders. */
  workspaceId: string | null;
  scheduleId: string | null;
  stageId: string | null;
  blockedById: string | null;

  project?: Project | null;
  workspace?: Workspace | null;
  status?: Status | null;
  schedule?: Schedule | null;
  stage?: Stage | null;
  /** The blocking task, when the server preloaded it. */
  blockedBy?: Task | null;

  customFieldValues?: TaskCustomFieldValue[];
  labelIds?: TaskLabelId[] | null;
  labels?: Label[];

  /** Set when the task repeats (haircut every 4 weeks, run every Tuesday). */
  recurrence?: RecurrenceRule | null;
  /** Calendar time reserved for a one-off task; empty when unscheduled. */
  blocks?: ScheduledBlock[] | null;
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
  createdAt: string;
  updatedAt: string;
}

export interface RecurrenceRule extends RecurrenceInput {
  id: string;
  ownerType: "task" | "event";
  ownerId: string;
  userId: string;
  exceptions: RecurrenceException[] | null;
  createdAt: string;
  updatedAt: string;
}

export type BlockSource = "manual" | "engine";

export interface ScheduledBlock {
  id: string;
  taskId: string;
  /** Set on blocks owned by an event instead of a task. */
  eventId?: string;
  userId: string;
  start: string;
  end: string;
  source: BlockSource;
  chunkIndex: number;
  locked: boolean;
  occurrenceStart?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEventEntity {
  id: string;
  title: string;
  description: string;
  start: string;
  end: string;
  /** Minutes of one timed instance; 0 on all-day events. */
  duration: number;
  allDay: boolean;
  color: string | null;
  userId: string;
  workspaceId: string | null;
  projectId: string | null;
  taskId: string | null;
  recurrence: RecurrenceRule | null;
  blocks: ScheduledBlock[] | null;
  createdAt: string;
  updatedAt: string;
}
