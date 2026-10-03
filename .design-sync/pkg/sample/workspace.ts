import type {
  Config,
  CustomField,
  Label,
  Project,
  Stage,
  Status,
  TaskViewConfig,
  User,
  Workspace,
  WorkingHours,
} from "@/app/_types/types";
import { browserTimezone, type Clock } from "./clock";

export const USER_ID = "usr_maya";

export const WS_STUDIO = "ws_studio";
export const WS_PERSONAL = "ws_personal";

export const P_ONBOARDING = "prj_onboarding";
export const P_DESIGN_SYSTEM = "prj_design_system";
export const P_PORTFOLIO = "prj_portfolio";

export const STAGE = {
  research: "stg_research",
  wireframes: "stg_wireframes",
  visual: "stg_visual",
  handoff: "stg_handoff",
} as const;

export const LABEL = {
  research: "lbl_research",
  ui: "lbl_ui",
  a11y: "lbl_a11y",
  meetingPrep: "lbl_meeting_prep",
  quickWin: "lbl_quick_win",
  writing: "lbl_writing",
  admin: "lbl_admin",
} as const;

export const CF_EFFORT = "cf_effort";
export const CF_FIGMA = "cf_figma";
export const EFFORT = {
  s: { id: "opt_effort_s", value: "Small", color: "#30A66D" },
  m: { id: "opt_effort_m", value: "Medium", color: "#FFB224" },
  l: { id: "opt_effort_l", value: "Large", color: "#E5484D" },
} as const;

type StatusKey = "backlog" | "todo" | "inProgress" | "blocked" | "completed" | "canceled";

/** Status id for a workspace's built-in status. */
export function statusId(workspaceId: string, key: StatusKey) {
  return `st_${workspaceId.replace(/^ws_/, "")}_${key}`;
}

/** The six statuses every new workspace starts with (see the Go workspace service). */
function defaultStatuses(workspaceId: string, createdAt: string): Status[] {
  const rows: [StatusKey, string, string, boolean][] = [
    ["backlog", "Backlog", "#889096", false],
    ["todo", "Todo", "#889096", true],
    ["inProgress", "In Progress", "#FFB224", false],
    ["blocked", "Blocked", "#E5484D", false],
    ["completed", "Completed", "#30A66D", false],
    ["canceled", "Canceled", "#E5484D", false],
  ];
  return rows.map(([key, name, color, isDefault]) => ({
    id: statusId(workspaceId, key),
    name,
    color,
    isDefault,
    workspaceId,
    createdAt,
    updatedAt: createdAt,
  }));
}

export function buildUser(): User {
  return {
    id: USER_ID,
    email: "maya.chen@hey.com",
    name: "Maya Chen",
    is_on_boarding_completed: true,
  };
}

export function buildWorkspaces(clock: Clock): Workspace[] {
  const created = clock.iso(-120, 10, 0);
  const label = (id: string, name: string, color: string, workspaceId: string): Label => ({
    id,
    name,
    color,
    workspaceId,
    createdAt: created,
    updatedAt: created,
  });
  const customFields: CustomField[] = [
    {
      id: CF_EFFORT,
      name: "Effort",
      workspaceId: WS_STUDIO,
      createdTime: created,
      updatedTime: created,
      type: "select",
      options: { options: [EFFORT.s, EFFORT.m, EFFORT.l] },
    },
    {
      id: CF_FIGMA,
      name: "Figma file",
      workspaceId: WS_STUDIO,
      createdTime: created,
      updatedTime: created,
      type: "url",
      options: { options: [] },
    },
  ];
  return [
    {
      id: WS_STUDIO,
      name: "Design Studio",
      color: "#6E56CF",
      userId: USER_ID,
      createdAt: created,
      updatedAt: created,
      status: defaultStatuses(WS_STUDIO, created),
      customFields,
      lables: [
        label(LABEL.research, "Research", "#0091FF", WS_STUDIO),
        label(LABEL.ui, "UI", "#6E56CF", WS_STUDIO),
        label(LABEL.a11y, "Accessibility", "#F76808", WS_STUDIO),
        label(LABEL.meetingPrep, "Meeting prep", "#889096", WS_STUDIO),
        label(LABEL.quickWin, "Quick win", "#30A66D", WS_STUDIO),
      ],
    },
    {
      id: WS_PERSONAL,
      name: "Personal",
      color: "#30A66D",
      userId: USER_ID,
      createdAt: created,
      updatedAt: created,
      status: defaultStatuses(WS_PERSONAL, created),
      customFields: [],
      lables: [
        label(LABEL.writing, "Writing", "#D6409F", WS_PERSONAL),
        label(LABEL.admin, "Life admin", "#889096", WS_PERSONAL),
      ],
    },
  ];
}

export function buildStages(clock: Clock): Stage[] {
  const created = clock.iso(-21, 9, 30);
  const stage = (id: string, name: string, order: number, color: string): Stage => ({
    id,
    name,
    order,
    color,
    projectId: P_ONBOARDING,
    createdAt: created,
    updatedAt: created,
  });
  return [
    stage(STAGE.research, "Research", 0, "#0091FF"),
    stage(STAGE.wireframes, "Wireframes", 1, "#6E56CF"),
    stage(STAGE.visual, "Visual design", 2, "#D6409F"),
    stage(STAGE.handoff, "Handoff", 3, "#30A66D"),
  ];
}

/** Projects without their relations; routes attach status, workspace, stages and tasks. */
export function buildProjects(clock: Clock): Project[] {
  const rich = (...paragraphs: string[]) => ({
    type: "doc",
    content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  });
  const onboardingText = [
    "Rework the first-run experience so new teams reach their first shared project in under five minutes.",
    "Success metric: activation (a second teammate joins within 7 days) from 31% to 45%.",
  ];
  const dsText = [
    "Second iteration of the component library: tokens first, then the form controls, then documentation.",
  ];
  const portfolioText = [
    "Refresh mayachen.design with two new case studies before applications open in the new year.",
  ];
  return [
    {
      id: P_ONBOARDING,
      title: "Onboarding Redesign",
      description: onboardingText.join("\n"),
      descriptionRich: rich(...onboardingText),
      statusId: statusId(WS_STUDIO, "inProgress"),
      deadline: clock.ymd(12),
      startDate: clock.ymd(-21),
      completedAt: null,
      priorityLevel: "High",
      color: "#6E56CF",
      doesHaveStages: true,
      workspaceId: WS_STUDIO,
      createdAt: clock.iso(-21, 9, 30),
      updatedAt: clock.ago(90),
    },
    {
      id: P_DESIGN_SYSTEM,
      title: "Design System v2",
      description: dsText.join("\n"),
      descriptionRich: rich(...dsText),
      statusId: statusId(WS_STUDIO, "inProgress"),
      deadline: clock.ymd(30),
      startDate: clock.ymd(-35),
      completedAt: null,
      priorityLevel: "Medium",
      color: "#0091FF",
      doesHaveStages: false,
      workspaceId: WS_STUDIO,
      createdAt: clock.iso(-35, 14, 0),
      updatedAt: clock.ago(60 * 5),
    },
    {
      id: P_PORTFOLIO,
      title: "Portfolio Refresh",
      description: portfolioText.join("\n"),
      descriptionRich: rich(...portfolioText),
      statusId: statusId(WS_PERSONAL, "todo"),
      deadline: clock.ymd(40),
      startDate: clock.ymd(-7),
      completedAt: null,
      priorityLevel: "Low",
      color: "#30A66D",
      doesHaveStages: false,
      workspaceId: WS_PERSONAL,
      createdAt: clock.iso(-10, 20, 15),
      updatedAt: clock.ago(60 * 26),
    },
  ];
}

export function buildWorkingHours(): WorkingHours {
  const day = [{ start: "09:00", end: "12:30" }, { start: "13:30", end: "17:30" }];
  return {
    timezone: browserTimezone(),
    days: { mon: day, tue: day, wed: day, thu: day, fri: [{ start: "09:00", end: "12:30" }, { start: "13:30", end: "16:30" }] },
    isDefault: false,
  };
}

const view = (v: Partial<TaskViewConfig> & Pick<TaskViewConfig, "id" | "name">): TaskViewConfig => ({
  dataMode: "task",
  renderMode: "list",
  groupFields: ["workspace", "project", "stage"],
  groupSortDirection: "asc",
  groupValueOrders: {},
  sortBy: "deadline",
  sortDirection: "asc",
  selectedWorkspaceIds: [],
  selectedStatusIds: [],
  columnOrder: [],
  ...v,
});

export function buildConfig(clock: Clock): Config {
  return {
    id: "cfg_maya",
    userId: USER_ID,
    isOnBoardingCompleted: true,
    taskViews: [
      view({ id: "view_task_list", name: "Task List" }),
      view({ id: "view_my_deadlines", name: "My Deadlines", groupFields: ["priority"], showCompleted: false, onlyDated: true }),
      view({ id: "view_overview", name: "Overview", groupFields: ["workspace"], sortBy: "createdAt", sortDirection: "desc" }),
      view({
        id: "view_project_timelines",
        name: "Project Timelines",
        dataMode: "project",
        renderMode: "gantt",
        groupFields: ["workspace"],
        sortBy: "startDate",
      }),
      view({
        id: "view_onboarding_board",
        name: "Onboarding board",
        renderMode: "kanban",
        groupFields: ["stage"],
        selectedProjectIds: [P_ONBOARDING],
        sortBy: "priority",
      }),
    ],
    activeTaskViewId: "view_task_list",
    projectTaskViews: {},
    appearance: { theme: "system", accent: "default" },
    workingHours: buildWorkingHours(),
    createdAt: clock.iso(-120, 10, 0),
    updatedAt: clock.ago(60 * 24 * 2),
  };
}
