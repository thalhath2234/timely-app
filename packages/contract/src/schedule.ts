/** Working hours, schedule settings and the auto-schedule plan. */

export interface WorkingWindow {
  start: string;
  end: string;
}

export type WeekdayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

/** `models.WorkingHours`, as stored in Config. */
export interface WorkingHours {
  timezone: string;
  days: Partial<Record<WeekdayKey, WorkingWindow[]>>;
}

/** GET/PUT /schedule/working-hours; Config.workingHours has no `isDefault`. */
export interface WorkingHoursResponse extends WorkingHours {
  isDefault: boolean;
}

export interface ScheduleSettings {
  breakMinutes: number;
  freezeHours: number;
  excludedWorkspaceIds: string[];
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
  occurrenceStart?: string;
  change?: string;
  /** Estimate vs. what the proposed blocks actually cover. */
  requiredMinutes: number;
  placedMinutes: number;
  shortfallMinutes: number;
  /** True when the blocks do not cover the whole estimate. */
  partial: boolean;
}

export interface ScheduleSkipped {
  taskId: string;
  taskName: string;
  reason: ScheduleSkipReason;
  message: string;
}

export interface ScheduleChange {
  action: "add" | "move" | "remove" | "pin" | string;
  taskId: string;
  taskName: string;
  message: string;
  before?: ScheduleProposalBlock;
  after?: ScheduleProposalBlock;
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

/** One stretch of Working hours with no Event or Block in it. */
export interface FreeSlot {
  start: string;
  end: string;
}

/**
 * GET /schedule/free-time?from=&to=&timezone= (RFC3339 range, default the next
 * seven days). The server takes Events and Blocks out of Working hours (ADR
 * 0006); clients pick a slot from `slots` and never work out busy time.
 */
export interface FreeTimeResponse {
  slots: FreeSlot[];
  /** Sum of the slots, in minutes. */
  freeMinutes: number;
}

export interface SchedulePlan {
  from: string;
  to: string;
  /** IANA name of the day-boundary zone; "" when the server's own zone has no resolvable name. */
  timezone: string;
  proposals: ScheduleProposal[];
  skipped: ScheduleSkipped[];
  changes: ScheduleChange[];
  risks: ScheduleRisk[];
  capacity: DayCapacity[];
  freeMinutes: number;
  plannedMinutes: number;
  applied: boolean;
  canUndo: boolean;
}

/**
 * POST /schedule/preview and /schedule/apply (`planRequest`). Clients add their
 * own `timezone` when the Working hours have none saved; the other keys are the
 * caller's.
 */
export interface PlanRequest {
  /** Limit the run to these tasks; omit for every schedulable task. */
  taskIds?: string[];
  from?: string;
  to?: string;
  timezone?: string;
  /** Let the engine replace blocks the user placed by hand. */
  includeManual?: boolean;
}

/** POST /tasks/:id/blocks (`blockRequest`). */
export interface AddBlockPayload {
  start: string;
  end?: string;
  durationMinutes?: number;
  /** Drop the task's other blocks so this becomes its only one. */
  replace?: boolean;
}
