import type {
  BlockSource,
  CalendarEventEntity,
  RecurrenceInput,
  Task,
} from "./entities";

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
  pausedFocus: Task | null;
  todayFocus: Task[];
  items: CalendarItem[];
  overdue: Task[];
  unscheduled: Task[];
  inboxCount: number;
  completedToday: Task[];
  unfinished: Task[];
  tomorrowFocus: Task[];
}

export type TaskActivityAction = "created" | "updated" | "commented";

export interface TaskActivity {
  id: string;
  taskId: string;
  userId: string;
  actorName: string;
  action: TaskActivityAction;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  message: string;
  createdAt: string;
}

/** One entry of GET /projects/:id/activity. */
export interface ProjectActivityEntry {
  id: string;
  /** Empty for the synthetic project-level entries. */
  taskId: string;
  taskName: string;
  actorName: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  message: string;
  createdAt: string;
}

/*
 * Event request bodies (`event/handler.go`). Update fields are pointers on the
 * server: absent or `null` leaves the value alone, an empty string clears
 * `color`, `projectId`, `workspaceId` and `taskId`. `recurrence` is read from
 * the raw body, so `null` there removes the rule.
 */

/** POST /events (`createEventRequest`). */
export interface CreateEventPayload {
  title: string;
  description?: string;
  /** ISO timestamps. */
  start: string;
  end: string;
  /** Minutes; the server derives it from `start`/`end` when 0. */
  duration?: number;
  allDay?: boolean;
  color?: string;
  workspaceId?: string;
  projectId?: string;
  taskId?: string;
  /** Omit for a one-off event. */
  recurrence?: RecurrenceInput;
}

/** PUT /events/:id (`updateEventRequest`). */
export interface UpdateEventPayload {
  title?: string;
  description?: string;
  start?: string;
  end?: string;
  duration?: number;
  allDay?: boolean;
  /** Empty string clears the color. */
  color?: string;
  workspaceId?: string;
  projectId?: string;
  taskId?: string;
  /** `null` removes the rule; omit to leave it untouched. */
  recurrence?: RecurrenceInput | null;
}

export type EventOccurrenceAction = "skip" | "restore" | "move";

/** PUT /events/:id/occurrences (`occurrenceRequest`). */
export interface EventOccurrencePayload {
  originalStart: string;
  action: EventOccurrenceAction;
  newStart?: string;
  newEnd?: string;
}

/** POST /events/:id/recurrence/split (`splitRequest`). */
export interface SplitEventSeriesPayload {
  fromStart: string;
  /** Any field left out is taken from the series being split. */
  recurrence?: Partial<RecurrenceInput>;
  title?: string;
  start?: string;
  end?: string;
}
