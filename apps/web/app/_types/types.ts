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

export type CalendarView = "month" | "week" | "day";

export type Task = {
  id: string;
  title: string;
  description: string;
  deadline: Date;
  project: string;
  stage: string;
  status: string;
  priority: string;
  totalTime: number;
  timeChunks: number;
  blockedBy: string[];
  blocking: string[];
  workSpace: string;
  lables: string[];
  startDate: Date;
  scheduledOn: Date;
  schedule: string; // eg. ["Free time", "Worktime", "Night time" ....]
  attachments: string[];

  createdAt: Date;
  updatedAt: Date;
  completedAt: Date;
};

export type customeFields = {
  name: string;
  type: string; // text, date, select etc,
  options: string[];
}[];

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
