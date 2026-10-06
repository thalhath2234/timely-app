import type {
  BlockSource,
  CalendarEventEntity,
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
