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
  | "priority"
  | "status"
  | "project";

export type TaskListSortDirection = "asc" | "desc";

/** Static group keys plus `cf:{customFieldId}` for a custom field. */
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
  /** The Report page layout; null until the account customises it. */
  reportDashboard?: DashboardLayout | null;
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
  /** Replaces the whole Report layout (`dashboard.ts`). */
  reportDashboard?: DashboardLayout;
}
