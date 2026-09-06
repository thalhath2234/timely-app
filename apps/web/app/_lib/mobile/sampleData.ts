import type {
  CalendarItem,
  Doc,
  Project,
  Sheet,
  Status,
  Task,
  User,
  Workspace,
} from "@/app/_types/types";

/**
 * Realistic demo dataset used when the Go backend is unreachable (e.g. in the
 * hosted preview). Dates are generated relative to "now" so the calendar and
 * task lists always look current.
 */

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function at(dayOffset: number, hour: number, minute = 0) {
  const d = startOfDay(new Date());
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function dayISO(dayOffset: number) {
  return at(dayOffset, 0);
}

const now = new Date().toISOString();
const base = { createdAt: now, updatedAt: now };

export const SAMPLE_USER: User = {
  id: "u_1",
  email: "you@timely.app",
  name: "Alex Rivera",
};

const statuses = {
  todo: { id: "st_todo", name: "To do", color: "#8b8f98", workspaceId: "ws_work", isDefault: true, ...base },
  inProgress: { id: "st_prog", name: "In progress", color: "#6c7cff", workspaceId: "ws_work", ...base },
  review: { id: "st_review", name: "In review", color: "#e7a33e", workspaceId: "ws_work", ...base },
  done: { id: "st_done", name: "Done", color: "#3fb27f", workspaceId: "ws_work", ...base },
} satisfies Record<string, Status>;

const personalStatuses = {
  later: { id: "st_later", name: "Later", color: "#8b8f98", workspaceId: "ws_personal", isDefault: true, ...base },
  doing: { id: "st_doing", name: "Doing", color: "#6c7cff", workspaceId: "ws_personal", ...base },
  done: { id: "st_pdone", name: "Done", color: "#3fb27f", workspaceId: "ws_personal", ...base },
} satisfies Record<string, Status>;

export const SAMPLE_WORKSPACES: Workspace[] = [
  {
    id: "ws_work",
    name: "Work",
    userId: SAMPLE_USER.id,
    status: Object.values(statuses),
    customFields: [],
    lables: [
      { id: "lb_bug", name: "Bug", color: "#e5484d", workspaceId: "ws_work", ...base },
      { id: "lb_design", name: "Design", color: "#d6409f", workspaceId: "ws_work", ...base },
      { id: "lb_backend", name: "Backend", color: "#30a46c", workspaceId: "ws_work", ...base },
    ],
    ...base,
  },
  {
    id: "ws_personal",
    name: "Personal",
    userId: SAMPLE_USER.id,
    status: Object.values(personalStatuses),
    customFields: [],
    lables: [
      { id: "lb_health", name: "Health", color: "#3fb27f", workspaceId: "ws_personal", ...base },
      { id: "lb_home", name: "Home", color: "#e7a33e", workspaceId: "ws_personal", ...base },
    ],
    ...base,
  },
];

export const SAMPLE_PROJECTS: Project[] = [
  {
    id: "pr_mobile",
    title: "Mobile app launch",
    description: "Ship the Flutter app to both stores.",
    color: "#6c7cff",
    workspaceId: "ws_work",
    deadline: dayISO(21),
    priorityLevel: "high",
    ...base,
  },
  {
    id: "pr_api",
    title: "API v2",
    description: "Recurrence, scheduling engine and webhooks.",
    color: "#30a46c",
    workspaceId: "ws_work",
    deadline: dayISO(40),
    priorityLevel: "medium",
    ...base,
  },
  {
    id: "pr_home",
    title: "Apartment move",
    description: null,
    color: "#e7a33e",
    workspaceId: "ws_personal",
    deadline: dayISO(12),
    priorityLevel: "medium",
    ...base,
  },
];

const projectById = Object.fromEntries(SAMPLE_PROJECTS.map((p) => [p.id, p]));
const workspaceById = Object.fromEntries(SAMPLE_WORKSPACES.map((w) => [w.id, w]));

type TaskSeed = Pick<Task, "id" | "name" | "description"> & {
  projectId: string | null;
  workspaceId: string;
  status: Status;
  priorityLevel: Task["priorityLevel"];
  deadline?: string | null;
  scheduledOn?: string | null;
  completedAt?: string | null;
  duration?: number;
  labelIds?: string[];
  blocks?: { start: string; end: string }[];
};

function task(seed: TaskSeed): Task {
  const workspace = workspaceById[seed.workspaceId];
  const labels = (workspace.lables ?? []).filter((l) => seed.labelIds?.includes(l.id));
  return {
    id: seed.id,
    name: seed.name,
    description: seed.description,
    descriptionRich: null,
    timeChunks: 1,
    duration: seed.duration ?? 60,
    deadline: seed.deadline ?? null,
    startDate: null,
    scheduledOn: seed.scheduledOn ?? seed.blocks?.[0]?.start ?? null,
    completedAt: seed.completedAt ?? null,
    createdAt: now,
    updatedAt: now,
    userId: SAMPLE_USER.id,
    projectId: seed.projectId,
    statusId: seed.status.id,
    priorityLevel: seed.priorityLevel,
    workspaceId: seed.workspaceId,
    scheduleId: null,
    stageId: null,
    blockedById: null,
    project: seed.projectId ? projectById[seed.projectId] : null,
    workspace,
    status: seed.status,
    labelIds: labels.map((l) => ({ id: l.id })),
    labels,
    recurrence: null,
    blocks: (seed.blocks ?? []).map((b, i) => ({
      id: `${seed.id}_b${i}`,
      taskId: seed.id,
      start: b.start,
      end: b.end,
      source: "engine" as const,
      chunkIndex: i,
    })),
  };
}

export const SAMPLE_TASKS: Task[] = [
  task({
    id: "t_1",
    name: "Design bottom tab bar states",
    description: "Active, inactive and badge states for the five primary tabs. Match the desktop indigo accent and keep labels at 11px.",
    projectId: "pr_mobile",
    workspaceId: "ws_work",
    status: statuses.inProgress,
    priorityLevel: "high",
    deadline: dayISO(0),
    labelIds: ["lb_design"],
    duration: 90,
    blocks: [{ start: at(0, 9, 30), end: at(0, 11, 0) }],
  }),
  task({
    id: "t_2",
    name: "Agenda view: group items by day",
    description: "Sections for Today, Tomorrow and weekday headers. Sticky headers while scrolling.",
    projectId: "pr_mobile",
    workspaceId: "ws_work",
    status: statuses.todo,
    priorityLevel: "medium",
    deadline: dayISO(2),
    duration: 120,
    blocks: [{ start: at(1, 10, 0), end: at(1, 12, 0) }],
  }),
  task({
    id: "t_3",
    name: "Fix overlapping blocks in day view",
    description: "Two blocks that share a start time render on top of each other. Split the column width instead.",
    projectId: "pr_mobile",
    workspaceId: "ws_work",
    status: statuses.review,
    priorityLevel: "urgent",
    deadline: dayISO(-1),
    labelIds: ["lb_bug"],
    duration: 45,
  }),
  task({
    id: "t_4",
    name: "Write release notes for beta 3",
    description: "",
    projectId: "pr_mobile",
    workspaceId: "ws_work",
    status: statuses.done,
    priorityLevel: "low",
    deadline: dayISO(-3),
    completedAt: at(-2, 16),
    duration: 30,
  }),
  task({
    id: "t_5",
    name: "Recurrence exceptions endpoint",
    description: "PATCH /tasks/:id/occurrence supporting skip, restore and move.",
    projectId: "pr_api",
    workspaceId: "ws_work",
    status: statuses.inProgress,
    priorityLevel: "high",
    deadline: dayISO(4),
    labelIds: ["lb_backend"],
    duration: 180,
    blocks: [
      { start: at(0, 13, 0), end: at(0, 15, 0) },
      { start: at(2, 9, 0), end: at(2, 10, 0) },
    ],
  }),
  task({
    id: "t_6",
    name: "Webhook retry with exponential backoff",
    description: "",
    projectId: "pr_api",
    workspaceId: "ws_work",
    status: statuses.todo,
    priorityLevel: "medium",
    deadline: dayISO(9),
    labelIds: ["lb_backend"],
    duration: 120,
  }),
  task({
    id: "t_7",
    name: "Load-test the scheduling engine",
    description: "10k tasks, 500 users. Capture p95 for plan preview.",
    projectId: "pr_api",
    workspaceId: "ws_work",
    status: statuses.todo,
    priorityLevel: "low",
    deadline: null,
    duration: 240,
  }),
  task({
    id: "t_8",
    name: "Book movers",
    description: "Get three quotes. Prefer a Saturday morning slot.",
    projectId: "pr_home",
    workspaceId: "ws_personal",
    status: personalStatuses.doing,
    priorityLevel: "high",
    deadline: dayISO(1),
    labelIds: ["lb_home"],
    duration: 30,
    blocks: [{ start: at(0, 18, 0), end: at(0, 18, 30) }],
  }),
  task({
    id: "t_9",
    name: "Change address with the bank",
    description: "",
    projectId: "pr_home",
    workspaceId: "ws_personal",
    status: personalStatuses.later,
    priorityLevel: "medium",
    deadline: dayISO(6),
    labelIds: ["lb_home"],
    duration: 20,
  }),
  task({
    id: "t_10",
    name: "Morning run",
    description: "5k along the river.",
    projectId: null,
    workspaceId: "ws_personal",
    status: personalStatuses.doing,
    priorityLevel: null,
    deadline: null,
    labelIds: ["lb_health"],
    duration: 40,
    blocks: [
      { start: at(0, 7, 0), end: at(0, 7, 40) },
      { start: at(2, 7, 0), end: at(2, 7, 40) },
      { start: at(4, 7, 0), end: at(4, 7, 40) },
    ],
  }),
  task({
    id: "t_11",
    name: "Renew passport",
    description: "Expires in 5 months. Photos are in the drawer.",
    projectId: null,
    workspaceId: "ws_personal",
    status: personalStatuses.later,
    priorityLevel: "low",
    deadline: dayISO(30),
    duration: 60,
  }),
];

function eventItem(
  id: string,
  title: string,
  start: string,
  end: string,
  color: string,
  extra: Partial<CalendarItem> = {},
): CalendarItem {
  return {
    id,
    kind: "event",
    title,
    start,
    end,
    allDay: false,
    color,
    chunkIndex: 0,
    chunkCount: 1,
    eventId: id,
    event: {
      id,
      title,
      description: "",
      start,
      end,
      allDay: false,
      color,
      userId: SAMPLE_USER.id,
      workspaceId: "ws_work",
      projectId: null,
      taskId: null,
      ...base,
    },
    ...extra,
  };
}

const taskItems: CalendarItem[] = SAMPLE_TASKS.flatMap((t) =>
  (t.blocks ?? []).map((b) => ({
    id: b.id,
    kind: "task" as const,
    title: t.name,
    start: b.start,
    end: b.end,
    allDay: false,
    color: t.project?.color ?? null,
    blockId: b.id,
    source: b.source,
    chunkIndex: b.chunkIndex,
    chunkCount: t.blocks?.length ?? 1,
    taskId: t.id,
    completedAt: t.completedAt,
    task: t,
  })),
);

export const SAMPLE_CALENDAR_ITEMS: CalendarItem[] = [
  ...taskItems,
  eventItem("ev_standup_0", "Team standup", at(0, 9, 0), at(0, 9, 15), "#6c7cff"),
  eventItem("ev_standup_1", "Team standup", at(1, 9, 0), at(1, 9, 15), "#6c7cff"),
  eventItem("ev_standup_2", "Team standup", at(2, 9, 0), at(2, 9, 15), "#6c7cff"),
  eventItem("ev_standup_3", "Team standup", at(3, 9, 0), at(3, 9, 15), "#6c7cff"),
  eventItem("ev_review", "Mobile design review", at(0, 15, 30), at(0, 16, 30), "#d6409f"),
  eventItem("ev_lunch", "Lunch with Priya", at(1, 12, 30), at(1, 13, 30), "#e7a33e"),
  eventItem("ev_dentist", "Dentist", at(3, 14, 0), at(3, 15, 0), "#3fb27f"),
  eventItem("ev_planning", "Sprint planning", at(4, 10, 0), at(4, 11, 30), "#6c7cff"),
  eventItem("ev_moving", "Moving day", at(12, 0), at(13, 0), "#e7a33e", { allDay: true }),
  eventItem("ev_yesterday", "1:1 with Sam", at(-1, 11, 0), at(-1, 11, 30), "#6c7cff"),
];

function docContent(paragraphs: string[]) {
  return {
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  };
}

export const SAMPLE_DOCS: Doc[] = [
  {
    id: "d_1",
    title: "Mobile app – design principles",
    icon: "📱",
    plainText:
      "Timely on the phone is a companion, not a replacement for the desktop app.\n\nThe phone is for capture and glanceable planning: add a task in two taps, see what is next, tick things off. Heavy editing (kanban, gantt, rich docs) stays on desktop.\n\nNavigation uses a five-tab bottom bar. Every list is a set of cards with 44pt targets. Details open as full-screen pages with a back button, and quick choices (status, priority, date) open as bottom sheets.\n\nThe visual language keeps the desktop indigo primary and dark surfaces so the two feel like one product.",
    content: docContent([]),
    parentId: null,
    workspaceId: "ws_work",
    projectId: "pr_mobile",
    userId: SAMPLE_USER.id,
    isFavorite: true,
    archivedAt: null,
    order: 0,
    createdAt: at(-20, 10),
    updatedAt: at(0, 8, 15),
  },
  {
    id: "d_2",
    title: "Beta 3 release notes",
    icon: "🚀",
    plainText:
      "Highlights\n\n- Recurring tasks with per-occurrence exceptions\n- Auto-scheduling respects working hours\n- Agenda view on the calendar\n\nFixes\n\n- Blocks no longer overlap in day view\n- Docs autosave indicator is accurate",
    content: docContent([]),
    parentId: null,
    workspaceId: "ws_work",
    projectId: "pr_mobile",
    userId: SAMPLE_USER.id,
    isFavorite: false,
    archivedAt: null,
    order: 1,
    createdAt: at(-4, 10),
    updatedAt: at(-1, 17, 40),
  },
  {
    id: "d_3",
    title: "API v2 – recurrence spec",
    icon: "🧩",
    plainText:
      "Rules are stored as RFC 5545 RRULE strings with a dtstart and IANA timezone.\n\nOccurrences are expanded server-side for the requested range. Exceptions are keyed by originalStart and can cancel, move or complete a single instance.\n\nSplitting a series creates a new rule from the split date and truncates the original with UNTIL.",
    content: docContent([]),
    parentId: null,
    workspaceId: "ws_work",
    projectId: "pr_api",
    userId: SAMPLE_USER.id,
    isFavorite: true,
    archivedAt: null,
    order: 2,
    createdAt: at(-30, 9),
    updatedAt: at(-2, 12),
  },
  {
    id: "d_4",
    title: "Moving checklist",
    icon: "📦",
    plainText:
      "Two weeks before\n- Confirm movers\n- Start packing books and off-season clothes\n\nOne week before\n- Change address: bank, employer, subscriptions\n- Defrost the freezer\n\nMoving day\n- Meter readings\n- Keys handover at 4pm",
    content: docContent([]),
    parentId: null,
    workspaceId: "ws_personal",
    projectId: "pr_home",
    userId: SAMPLE_USER.id,
    isFavorite: false,
    archivedAt: null,
    order: 0,
    createdAt: at(-10, 20),
    updatedAt: at(-3, 21, 5),
  },
  {
    id: "d_5",
    title: "Reading list 2026",
    icon: "📚",
    plainText:
      "- Thinking in Systems\n- The Design of Everyday Things\n- Working in Public\n- A Philosophy of Software Design",
    content: docContent([]),
    parentId: null,
    workspaceId: "ws_personal",
    projectId: null,
    userId: SAMPLE_USER.id,
    isFavorite: false,
    archivedAt: null,
    order: 1,
    createdAt: at(-60, 20),
    updatedAt: at(-14, 22),
  },
];

export const SAMPLE_SHEETS: Sheet[] = [
  {
    id: "s_1",
    title: "Beta testers",
    icon: "🧪",
    description: "People on the TestFlight / Play internal track.",
    columns: [
      { id: "c_name", name: "Name", width: 160, type: "text" },
      { id: "c_platform", name: "Platform", width: 110, type: "text" },
      { id: "c_invited", name: "Invited", width: 120, type: "date" },
      { id: "c_active", name: "Active", width: 90, type: "boolean" },
      { id: "c_sessions", name: "Sessions", width: 100, type: "number" },
    ],
    rows: [
      { id: "r1", cells: { c_name: "Priya N.", c_platform: "iOS", c_invited: dayISO(-12), c_active: "true", c_sessions: "34" } },
      { id: "r2", cells: { c_name: "Sam O.", c_platform: "Android", c_invited: dayISO(-12), c_active: "true", c_sessions: "21" } },
      { id: "r3", cells: { c_name: "Lea K.", c_platform: "iOS", c_invited: dayISO(-9), c_active: "false", c_sessions: "3" } },
      { id: "r4", cells: { c_name: "Marcus T.", c_platform: "Android", c_invited: dayISO(-7), c_active: "true", c_sessions: "18" } },
      { id: "r5", cells: { c_name: "Yuki H.", c_platform: "iOS", c_invited: dayISO(-5), c_active: "true", c_sessions: "12" } },
      { id: "r6", cells: { c_name: "Diego R.", c_platform: "Android", c_invited: dayISO(-2), c_active: "false", c_sessions: "1" } },
    ],
    workspaceId: "ws_work",
    projectId: "pr_mobile",
    userId: SAMPLE_USER.id,
    isFavorite: true,
    archivedAt: null,
    createdAt: at(-14, 9),
    updatedAt: at(0, 9, 5),
  },
  {
    id: "s_2",
    title: "Moving budget",
    icon: "💸",
    description: "Everything that costs money for the move.",
    columns: [
      { id: "c_item", name: "Item", width: 170, type: "text" },
      { id: "c_est", name: "Estimate", width: 100, type: "number" },
      { id: "c_actual", name: "Actual", width: 100, type: "number" },
      { id: "c_paid", name: "Paid", width: 80, type: "boolean" },
      { id: "c_due", name: "Due", width: 120, type: "date" },
    ],
    rows: [
      { id: "r1", cells: { c_item: "Movers", c_est: "900", c_actual: "", c_paid: "false", c_due: dayISO(12) } },
      { id: "r2", cells: { c_item: "Boxes & tape", c_est: "80", c_actual: "74", c_paid: "true", c_due: dayISO(-2) } },
      { id: "r3", cells: { c_item: "Deposit", c_est: "2400", c_actual: "2400", c_paid: "true", c_due: dayISO(-20) } },
      { id: "r4", cells: { c_item: "Cleaning", c_est: "220", c_actual: "", c_paid: "false", c_due: dayISO(13) } },
      { id: "r5", cells: { c_item: "Van rental", c_est: "120", c_actual: "", c_paid: "false", c_due: dayISO(11) } },
    ],
    workspaceId: "ws_personal",
    projectId: "pr_home",
    userId: SAMPLE_USER.id,
    isFavorite: false,
    archivedAt: null,
    createdAt: at(-10, 20),
    updatedAt: at(-1, 8),
  },
  {
    id: "s_3",
    title: "API endpoints",
    icon: "🔌",
    description: "Status of every v2 endpoint.",
    columns: [
      { id: "c_path", name: "Endpoint", width: 220, type: "text" },
      { id: "c_status", name: "Status", width: 110, type: "text" },
      { id: "c_owner", name: "Owner", width: 110, type: "text" },
      { id: "c_tests", name: "Tests", width: 80, type: "boolean" },
    ],
    rows: [
      { id: "r1", cells: { c_path: "GET /calendar", c_status: "Shipped", c_owner: "Alex", c_tests: "true" } },
      { id: "r2", cells: { c_path: "POST /schedule/plan", c_status: "Shipped", c_owner: "Sam", c_tests: "true" } },
      { id: "r3", cells: { c_path: "PATCH /tasks/:id/occurrence", c_status: "In progress", c_owner: "Alex", c_tests: "false" } },
      { id: "r4", cells: { c_path: "POST /webhooks", c_status: "Planned", c_owner: "—", c_tests: "false" } },
    ],
    workspaceId: "ws_work",
    projectId: "pr_api",
    userId: SAMPLE_USER.id,
    isFavorite: false,
    archivedAt: null,
    createdAt: at(-25, 9),
    updatedAt: at(-4, 15),
  },
];

export const SAMPLE_DAY = DAY;
