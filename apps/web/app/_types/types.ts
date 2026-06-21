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
    name: "Report",
    icon: "Brain",
    href: "/report",
  },
];

export type AddNewModeOptions = "workspace" | "task" | "project" | "event" | "doc" | "sheet";

export type CalendarView = "month" | "week" | "day";

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
  id: string;
  name: string;
  color: string;
  workspaceId: string;
  isDefault?: boolean;
}

export interface Project extends BaseEntity {
  title?: string;
  name?: string;
  description: string | null;
  userId?: string;
  statusId?: string;
  deadline?: string | null;
  startDate?: string | null;
  completedAt?: string | null;
  priorityLevel?: string | null;
  color?: string | null;
  doesHaveStages?: boolean;
  workspaceId: string;
}

export interface Workspace extends BaseEntity {
  name: string;
  userId: string;
  description?: string | null;
}

export interface Label extends BaseEntity {
  name: string;
  color: string;
  workspaceId: string;
}

export interface CustomFieldOption {
  id: string;
  value: string;
  color?: string;
}

export interface CustomField {
  id: string;
  name: string;
  workspaceId: string;
  createdTime?: string;
  updatedTime?: string;
  type: string;
  options?: {
    options: CustomFieldOption[];
  };
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

export interface TaskLabelId {
  id: string;
}

export interface Task {
  id: string;
  name: string;
  description: string;
  timeChunks: number;
  duration: number;

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

  project?: Project | null;
  workspace?: Workspace | null;
  status?: Status | null;

  customFieldValues?: TaskCustomFieldValue[];
  labelIds?: TaskLabelId[];
  labels?: Label[];

  projectid?: string | null;
  statusid?: string | null;
  workspaceid?: string | null;
  scheduleid?: string | null;
  stageid?: string | null;
  blockedByid?: string | null;
}

export interface User {
  id: string;
  email: string;
  isOnBoardingCompleted?: boolean;
  IsOnBoardingCompleted?: boolean;
}

export interface Config {
  id: string;
  userId: string;
  isOnBoardingCompleted?: boolean;
  isOnboardingCompleted: boolean;
  customFields?: CustomField[];
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