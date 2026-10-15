import type { DashboardLayout } from "./dashboard";
import type { CustomField } from "./entities";
import type { NotificationSettings } from "./notifications";
import type { ScheduleSettings, WorkingHours } from "./schedule";

/**
 * The server's accepted `sortBy` values (`models.TaskViewConfig.Validate`).
 * PUT /config rejects anything else with 400 "invalid sortBy value".
 */
export type TaskViewSortBy =
  | "name"
  | "deadline"
  | "startDate"
  | "scheduledOn"
  | "createdAt"
  | "updatedAt"
  | "completedAt"
  | "priority"
  | "status"
  | "project"
  | "workspace"
  | "stage"
  | "duration"
  | "tracked"
  | "urgency"
  | "progress"
  | "effort"
  | `cf:${string}`;

export type TaskListSortDirection = "asc" | "desc";

/**
 * Static group keys plus `cf:{customFieldId}` for a custom field. The date
 * keys group into buckets (Overdue, Today, This week, ...; see `taskQuery.ts`)
 * and "label" puts a task under each of its labels.
 */
export type TaskListGroupField =
  | "workspace"
  | "project"
  | "stage"
  | "status"
  | "priority"
  | "label"
  | "deadline"
  | "planned"
  | "startDate"
  | "createdAt"
  | "updatedAt"
  | "completedAt"
  | "effort"
  | "done"
  | "recurring"
  | `cf:${string}`;

export type TaskListGroupSortDirection = "asc" | "desc";

export type TaskListDataMode = "task" | "project";

export type TaskRenderMode = "list" | "kanban" | "gantt";

/**
 * What a view rule reads. Choice fields hold ids (priority and effort hold
 * their names), dates are read in the Working hours timezone, `planned` is
 * the day of the task's calendar time (blocks or `scheduledOn`), `duration`
 * and `tracked` are minutes, `progress` is the checklist's percent done and
 * `urgency` is smart suggestions' 0-4. Flags take op "is" with true or false.
 */
export type TaskRuleField =
  | "workspace"
  | "project"
  | "status"
  | "stage"
  | "label"
  | "priority"
  | "effort"
  | "name"
  | "description"
  | "text"
  | "deadline"
  | "startDate"
  | "planned"
  | "createdAt"
  | "updatedAt"
  | "completedAt"
  | "duration"
  | "tracked"
  | "urgency"
  | "progress"
  | "done"
  | "overdue"
  | "recurring"
  | "scheduled"
  | "blocked"
  | "blocking"
  | "hasChecklist"
  | "inFocus"
  | "todayFocus"
  | "locked"
  | "overEstimate"
  | `cf:${string}`;

export type TaskRuleOp =
  | "anyOf"
  | "noneOf"
  | "allOf"
  | "isEmpty"
  | "isNotEmpty"
  | "contains"
  | "notContains"
  | "startsWith"
  | "is"
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "in"
  | "notIn"
  | "before"
  | "after"
  | "onOrBefore"
  | "onOrAfter";

/**
 * One condition of a view. Dates are a day (`YYYY-MM-DD`), a day counted
 * from today (`+3`, `-30`) or a range word: today, tomorrow, yesterday,
 * thisWeek, nextWeek, lastWeek, thisWeekend, thisMonth, nextMonth, lastMonth,
 * thisYear, `next:N` (today and the N days after) or `last:N` (the N days
 * before and today). `to` is the end of a "between".
 */
export interface TaskViewCondition {
  field: TaskRuleField;
  op: TaskRuleOp;
  value?: string | number | boolean | string[] | null;
  to?: string | number | null;
}

/** Conditions that hold together ("all") or as alternatives ("any"). */
export interface TaskViewRuleGroup {
  match: TaskViewRuleMatch;
  rules: TaskViewCondition[];
}

export type TaskViewRule = TaskViewCondition | TaskViewRuleGroup;

export type TaskViewRuleMatch = "all" | "any";

export interface TaskViewConfig {
  id: string;
  name: string;
  dataMode: TaskListDataMode;
  renderMode: TaskRenderMode;
  groupFields: TaskListGroupField[];
  groupSortDirection: TaskListGroupSortDirection;
  groupValueOrders: Record<string, string[]>;
  sortBy: TaskViewSortBy;
  sortDirection: TaskListSortDirection;
  selectedWorkspaceIds: string[];
  selectedStatusIds: string[];
  selectedProjectIds?: string[];
  selectedPriorityLevels?: string[];
  selectedLabelIds?: string[];
  selectedStageIds?: string[];
  /** When false, completed tasks are hidden. Defaults to true. */
  showCompleted?: boolean;
  onlyOverdue?: boolean;
  onlyScheduled?: boolean;
  onlyRecurring?: boolean;
  /** Only tasks with a deadline or reserved calendar time. Undefined falls
   * back to `true` for the built-in "My Deadlines" view. */
  onlyDated?: boolean;
  /** When true, the view shows duration-0 reminders instead of work tasks. */
  showReminders?: boolean;
  /** Conditions on top of the fields above; see `taskQuery.ts`. */
  rules?: TaskViewRule[];
  /** How `rules` combine. Undefined means "all". */
  ruleMatch?: TaskViewRuleMatch;
  /** Second sort key for ties on `sortBy`. */
  thenSortBy?: TaskViewSortBy;
  thenSortDirection?: TaskListSortDirection;
  /** Show only the first N rows after sorting. */
  limit?: number;
  /** The words the view was described with, when it was made from words. */
  prompt?: string;
  /** Built-in ids plus `cf:{customFieldId}`. Empty means the default order. */
  columnOrder: string[];
  /** Project-hub filter chrome. Undefined means shown. */
  optionsVisible?: boolean;
}

export interface Appearance {
  theme: "system" | "light" | "dark";
  accent: "default" | `#${string}`;
}

/**
 * GET /config. `isOnBoardingCompleted` is what the server sends; the PUT body
 * spells it `isOnboardingCompleted` (see ConfigUpdateInput).
 */
export interface Config {
  id: string;
  userId: string;
  isOnBoardingCompleted: boolean;
  taskViews: TaskViewConfig[];
  activeTaskViewId: string;
  /** One saved task-list layout per project id. */
  projectTaskViews: Record<string, TaskViewConfig>;
  appearance: Appearance;
  workingHours: WorkingHours;
  scheduleSettings: ScheduleSettings;
  notificationSettings: NotificationSettings;
  /** The Dashboard layout; null until the account customises it. */
  reportDashboard?: DashboardLayout | null;
  /**
   * The phone app's own saved views (list and board only), apart from
   * `taskViews`. Empty until the phone uploads its device views once.
   */
  mobileTaskViews?: TaskViewConfig[];
  mobileActiveTaskViewId?: string;
  customFields?: CustomField[];
  createdAt: string;
  updatedAt: string;
}

/**
 * PUT /config body (`workspace/handler.go`). Every key is optional and absent
 * keys leave the stored value alone. Note the lowercase "b" in
 * `isOnboardingCompleted`: it differs from the `Config` field on purpose of
 * history, and the server ignores `isOnBoardingCompleted` in a request.
 */
export interface ConfigUpdateInput {
  isOnboardingCompleted?: boolean;
  taskViews?: TaskViewConfig[];
  activeTaskViewId?: string;
  projectTaskViews?: Record<string, TaskViewConfig>;
  appearance?: Appearance;
  /** Replaces the whole Dashboard layout (`dashboard.ts`). */
  reportDashboard?: DashboardLayout;
  /** Replaces the phone's saved views; an empty list is ignored. */
  mobileTaskViews?: TaskViewConfig[];
  mobileActiveTaskViewId?: string;
}
