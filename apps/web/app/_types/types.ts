import type { TaskKind } from "@timely/contract";

export type { TaskKind };
export type { SheetColumn, SheetColumnType, SheetMerge } from "@timely/contract/sheetTypes";
export type {
  ApiKey,
  CreatedApiKey,
  DeviceSession,
  User,
} from "@timely/contract/account";
export type {
  CalendarItem,
  CalendarItemKind,
  CalendarRange,
  ProjectActivityEntry,
  TaskActivity,
  TaskActivityAction,
  TodayResponse,
} from "@timely/contract/calendar";
export type {
  Appearance,
  Config,
  ConfigUpdateInput,
  TaskListDataMode,
  TaskListGroupField,
  TaskListGroupSortDirection,
  TaskListSortDirection,
  TaskRenderMode,
  TaskViewConfig,
  TaskViewSortBy,
} from "@timely/contract/config";
export type {
  Doc,
  DocContent,
  MentionAppearance,
  MentionAttrs,
  MentionEntityType,
} from "@timely/contract/documents";
export type {
  BaseEntity,
  BlockSource,
  CalendarEventEntity,
  ChecklistItem,
  CustomField,
  CustomFieldOption,
  CustomFieldOptions,
  CustomFieldType,
  CustomFieldValueInput,
  Label,
  PreferredWindow,
  Project,
  RecurrenceException,
  RecurrenceInput,
  RecurrenceRule,
  Schedule,
  ScheduledBlock,
  Stage,
  Status,
  Task,
  TaskCustomFieldValue,
  TaskLabelId,
  Workspace,
} from "@timely/contract/entities";
export type {
  AppNotification,
  JobHealth,
  JobRecord,
  NotificationCategory,
  NotificationSettings,
} from "@timely/contract/notifications";
export type {
  DayCapacity,
  ScheduleChange,
  SchedulePlan,
  ScheduleProposal,
  ScheduleProposalBlock,
  ScheduleRisk,
  ScheduleSettings,
  ScheduleSkipped,
  ScheduleSkipReason,
  WeekdayKey,
  WorkingHours,
  WorkingHoursResponse,
  WorkingWindow,
} from "@timely/contract/schedule";
export type {
  Sheet,
  SheetAlign,
  SheetBorder,
  SheetCellFormat,
  SheetFontFamily,
  SheetNumberFormat,
  SheetRow,
  SheetTab,
  SheetTemplate,
  SheetVerticalAlign,
} from "@timely/contract/sheet";

export type SidebarProps = {
  name: string;
  icon: string;
  href: string;
};

export const SIDEBAR_ITEMS = [
  { name: "Chat", icon: "MessageCircle", href: "/chat" },
  {
    name: "Today",
    icon: "Sun",
    href: "/today",
  },
  {
    name: "Inbox",
    icon: "Inbox",
    href: "/inbox",
  },
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
    name: "Projects",
    icon: "FolderKanban",
    href: "/projects",
  },
  {
    name: "Files",
    icon: "Files",
    href: "/files",
  },
  {
    name: "Report",
    icon: "Brain",
    href: "/report",
  },
  {
    name: "Notifications",
    icon: "Bell",
    href: "/notifications",
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

export type TaskListGroupBy =
  | "none"
  | "status"
  | "project"
  | "priority"
  | `cf:${string}`;
