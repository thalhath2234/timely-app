import type {
  CalendarEventEntity,
  ChecklistItem,
  RecurrenceRule,
  ScheduledBlock,
  Task,
  TaskCustomFieldValue,
} from "@/app/_types/types";
import { browserTimezone, type Clock } from "./clock";
import {
  CF_EFFORT,
  CF_FIGMA,
  EFFORT,
  LABEL,
  P_DESIGN_SYSTEM,
  P_ONBOARDING,
  P_PORTFOLIO,
  STAGE,
  USER_ID,
  WS_PERSONAL,
  WS_STUDIO,
  statusId,
} from "./workspace";

/** Task ids, so blocks, events, docs and chats can point at real tasks. */
export const T = {
  synthesize: "tsk_synthesize_interviews",
  funnel: "tsk_signup_funnel",
  wireframe: "tsk_welcome_wireframes",
  emptyCopy: "tsk_empty_state_copy",
  invite: "tsk_invite_screen",
  contrast: "tsk_contrast_pass",
  handoff: "tsk_handoff_notes",
  critiqueQs: "tsk_critique_questions",
  buttons: "tsk_button_audit",
  tokens: "tsk_spacing_tokens",
  selectDocs: "tsk_select_docs",
  focusRing: "tsk_focus_ring",
  darkRamp: "tsk_dark_ramp",
  pickCases: "tsk_pick_case_studies",
  caseStudy: "tsk_onboarding_case_study",
  images: "tsk_export_images",
  passport: "tsk_renew_passport",
  dentist: "tsk_call_dentist",
  weeklyUpdate: "tsk_weekly_update",
  inboxVariables: "tsk_inbox_figma_variables",
  inboxBudget: "tsk_inbox_research_budget",
  inboxMeter: "tsk_inbox_progress_meter",
} as const;

export type TaskSeed = Partial<Task> & Pick<Task, "id" | "name">;

export function makeTask(clock: Clock, seed: TaskSeed): Task {
  const createdAt = seed.createdAt ?? clock.iso(-10, 10, 0);
  return {
    description: "",
    descriptionRich: null,
    duration: 0,
    kind: "task",
    checklist: [],
    actualMinutes: 0,
    focusStartedAt: null,
    todayFocusOn: null,
    minChunkMinutes: 15,
    preferredChunkMinutes: null,
    contiguous: false,
    earliestStartAt: null,
    preferredWindows: [],
    scheduleLocked: false,
    deadline: null,
    startDate: null,
    scheduledOn: null,
    completedAt: null,
    updatedAt: seed.updatedAt ?? createdAt,
    userId: USER_ID,
    projectId: null,
    statusId: null,
    priorityLevel: null,
    workspaceId: null,
    scheduleId: null,
    stageId: null,
    blockedById: null,
    labelIds: [],
    customFieldValues: [],
    recurrence: null,
    blocks: [],
    ...seed,
    createdAt,
  };
}

function richText(text: string) {
  return {
    type: "doc",
    content: text
      .split("\n")
      .filter(Boolean)
      .map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })),
  };
}

function checklist(taskId: string, items: [string, string | null][]): ChecklistItem[] {
  return items.map(([title, completedAt], order) => ({
    id: `chk_${taskId.replace(/^tsk_/, "")}_${order + 1}`,
    title,
    completedAt,
    order,
  }));
}

function block(
  taskId: string,
  index: number,
  start: string,
  end: string,
  source: ScheduledBlock["source"] = "engine",
  locked = false,
): ScheduledBlock {
  return { id: `blk_${taskId.replace(/^tsk_/, "")}_${index}`, taskId, start, end, source, chunkIndex: index, locked };
}

function effort(taskId: string, option: (typeof EFFORT)[keyof typeof EFFORT], at: string): TaskCustomFieldValue {
  return {
    id: `cfv_${taskId}_effort`,
    customFieldValueId: `cfv_${taskId}_effort`,
    customFieldId: CF_EFFORT,
    taskId,
    name: "Effort",
    type: "select",
    optionValue: [{ ...option }],
    createdAt: at,
    updatedAt: at,
  };
}

function figma(taskId: string, url: string, at: string): TaskCustomFieldValue {
  return {
    id: `cfv_${taskId}_figma`,
    customFieldValueId: `cfv_${taskId}_figma`,
    customFieldId: CF_FIGMA,
    taskId,
    name: "Figma file",
    type: "url",
    stringValue: url,
    createdAt: at,
    updatedAt: at,
  };
}

function weekly(id: string, ownerType: "task" | "event", ownerId: string, byday: string, dtstart: string): RecurrenceRule {
  return {
    id,
    ownerType,
    ownerId,
    rrule: `FREQ=WEEKLY;BYDAY=${byday}`,
    dtstart,
    timezone: browserTimezone(),
    exceptions: [],
  };
}

const labels = (...ids: string[]) => ids.map((id) => ({ id }));

export function buildTasks(clock: Clock): Task[] {
  const { iso, ymd, ago, earlierToday } = clock;
  const studio = { workspaceId: WS_STUDIO };
  const onboarding = { ...studio, projectId: P_ONBOARDING };
  const ds = { ...studio, projectId: P_DESIGN_SYSTEM };
  const portfolio = { workspaceId: WS_PERSONAL, projectId: P_PORTFOLIO };
  const s = (key: Parameters<typeof statusId>[1], ws = WS_STUDIO) => statusId(ws, key);

  const tasks: TaskSeed[] = [
    // Onboarding Redesign
    {
      id: T.synthesize,
      ...onboarding,
      name: "Synthesize interview notes from 8 new-user sessions",
      description:
        "Cluster the notes from the September interviews into themes and pull 3-5 quotes per theme for the readout.",
      duration: 120,
      actualMinutes: 135,
      statusId: s("completed"),
      stageId: STAGE.research,
      priorityLevel: "High",
      deadline: ymd(-6),
      completedAt: iso(-6, 16, 40),
      labelIds: labels(LABEL.research),
      blocks: [block(T.synthesize, 0, iso(-7, 13, 30), iso(-7, 15, 30))],
      createdAt: iso(-20, 9, 45),
      updatedAt: iso(-6, 16, 40),
    },
    {
      id: T.funnel,
      ...onboarding,
      name: "Map the current signup funnel drop-off",
      description: "Pull the last 30 days from Amplitude and annotate where teams stall between signup and first project.",
      duration: 90,
      actualMinutes: 80,
      statusId: s("completed"),
      stageId: STAGE.research,
      priorityLevel: "Medium",
      deadline: ymd(-4),
      completedAt: iso(-4, 11, 5),
      labelIds: labels(LABEL.research),
      blocks: [block(T.funnel, 0, iso(-4, 9, 30), iso(-4, 11, 0))],
      createdAt: iso(-19, 10, 0),
      updatedAt: iso(-4, 11, 5),
    },
    {
      id: T.wireframe,
      ...onboarding,
      name: "Wireframe the 3-step welcome flow",
      description:
        "Cover workspace naming, inviting teammates and creating the first project. Keep the skip path visible on every step.",
      duration: 180,
      actualMinutes: 75,
      statusId: s("inProgress"),
      stageId: STAGE.wireframes,
      priorityLevel: "High",
      deadline: ymd(0),
      todayFocusOn: ymd(0),
      labelIds: labels(LABEL.ui),
      checklist: checklist(T.wireframe, [
        ["Workspace naming step", iso(-1, 11, 10)],
        ["Invite teammates step", iso(-1, 11, 25)],
        ["First project step", null],
        ["Skip and resume states", null],
      ]),
      customFieldValues: [
        effort(T.wireframe, EFFORT.l, iso(-12, 9, 0)),
        figma(T.wireframe, "https://www.figma.com/design/onboarding-v3", iso(-12, 9, 0)),
      ],
      blocks: [
        block(T.wireframe, 0, iso(-1, 10, 0), iso(-1, 11, 30)),
        block(T.wireframe, 1, iso(0, 9, 30), iso(0, 11, 0)),
      ],
      createdAt: iso(-12, 9, 0),
      updatedAt: ago(45),
    },
    {
      id: T.emptyCopy,
      ...onboarding,
      name: "Write empty-state copy for the workspace picker",
      description: "Three variants: brand new account, invited user, user who left every workspace.",
      duration: 45,
      statusId: s("todo"),
      stageId: STAGE.wireframes,
      priorityLevel: "Medium",
      deadline: ymd(2),
      todayFocusOn: ymd(0),
      labelIds: labels(LABEL.quickWin, LABEL.ui),
      customFieldValues: [effort(T.emptyCopy, EFFORT.s, iso(-8, 15, 0))],
      blocks: [block(T.emptyCopy, 0, iso(1, 14, 0), iso(1, 14, 45))],
      createdAt: iso(-8, 15, 0),
    },
    {
      id: T.invite,
      ...onboarding,
      name: "Design the workspace-invite screen in high fidelity",
      description: "Includes the bulk-invite paste field, role picker and the pending-invites list.",
      duration: 240,
      statusId: s("todo"),
      stageId: STAGE.visual,
      priorityLevel: "High",
      deadline: ymd(6),
      blockedById: T.wireframe,
      labelIds: labels(LABEL.ui),
      customFieldValues: [effort(T.invite, EFFORT.l, iso(-8, 15, 5))],
      blocks: [
        block(T.invite, 0, iso(2, 10, 0), iso(2, 12, 0)),
        block(T.invite, 1, iso(4, 13, 30), iso(4, 15, 30)),
      ],
      createdAt: iso(-8, 15, 5),
    },
    {
      id: T.contrast,
      ...onboarding,
      name: "Accessibility pass on onboarding color contrast",
      description: "Check every text/background pair against WCAG AA, including disabled buttons and the progress dots.",
      duration: 90,
      statusId: s("backlog"),
      stageId: STAGE.visual,
      priorityLevel: "Medium",
      deadline: ymd(9),
      labelIds: labels(LABEL.a11y),
      checklist: checklist(T.contrast, [
        ["Body text on tinted cards", null],
        ["Disabled button states", null],
        ["Step indicator dots", null],
      ]),
      createdAt: iso(-6, 14, 20),
    },
    {
      id: T.handoff,
      ...onboarding,
      name: "Prepare handoff notes and redlines for engineering",
      duration: 120,
      statusId: s("backlog"),
      stageId: STAGE.handoff,
      priorityLevel: "Medium",
      deadline: ymd(12),
      blockedById: T.invite,
      labelIds: labels(LABEL.meetingPrep),
      createdAt: iso(-6, 14, 25),
    },

    {
      id: T.critiqueQs,
      ...onboarding,
      name: "Prepare critique questions for the welcome flow",
      duration: 20,
      statusId: s("todo"),
      stageId: STAGE.wireframes,
      priorityLevel: "Medium",
      deadline: ymd(0),
      labelIds: labels(LABEL.meetingPrep),
      createdAt: earlierToday(174),
    },

    // Design System v2
    {
      id: T.buttons,
      ...ds,
      name: "Audit button variants across product surfaces",
      description: "Screenshot every button in settings, billing and the editor; flag one-off styles.",
      duration: 60,
      actualMinutes: 55,
      statusId: s("completed"),
      priorityLevel: "Medium",
      deadline: ymd(0),
      completedAt: earlierToday(70),
      labelIds: labels(LABEL.ui, LABEL.quickWin),
      customFieldValues: [effort(T.buttons, EFFORT.s, iso(-9, 11, 0))],
      createdAt: iso(-9, 11, 0),
      updatedAt: earlierToday(70),
    },
    {
      id: T.tokens,
      ...ds,
      name: "Define spacing and radius tokens",
      description: "Collapse the 14 spacing values in use down to an 8-step scale and name radius tokens by role, not size.",
      descriptionRich: richText(
        "Collapse the 14 spacing values in use down to an 8-step scale and name radius tokens by role, not size.\nOpen question: do we keep 6px for dense tables?",
      ),
      duration: 120,
      actualMinutes: 40,
      statusId: s("inProgress"),
      priorityLevel: "Urgent",
      deadline: ymd(-2),
      todayFocusOn: ymd(0),
      labelIds: labels(LABEL.ui),
      checklist: checklist(T.tokens, [
        ["Inventory values used in code", iso(-3, 15, 0)],
        ["Propose the 8-step scale", null],
        ["Review with Dev on Thursday", null],
      ]),
      customFieldValues: [effort(T.tokens, EFFORT.m, iso(-14, 10, 0))],
      blocks: [block(T.tokens, 0, iso(0, 13, 30), iso(0, 15, 0), "manual", true)],
      createdAt: iso(-14, 10, 0),
      updatedAt: ago(60 * 20),
    },
    {
      id: T.selectDocs,
      ...ds,
      name: "Document the Select component with usage guidelines",
      duration: 90,
      statusId: s("todo"),
      priorityLevel: "Medium",
      deadline: ymd(5),
      todayFocusOn: ymd(1),
      blocks: [block(T.selectDocs, 0, iso(1, 10, 0), iso(1, 11, 30))],
      createdAt: iso(-5, 16, 0),
    },
    {
      id: T.focusRing,
      ...ds,
      name: "Fix focus ring inconsistencies in form inputs",
      description: "Inputs use a 1px outline, buttons a 2px ring with offset. Pick one and update both.",
      duration: 60,
      statusId: s("blocked"),
      priorityLevel: "High",
      deadline: ymd(-1),
      labelIds: labels(LABEL.a11y),
      customFieldValues: [effort(T.focusRing, EFFORT.s, iso(-7, 9, 30))],
      createdAt: iso(-7, 9, 30),
    },
    {
      id: T.darkRamp,
      ...ds,
      name: "Draft the dark-mode color ramp proposal",
      duration: 150,
      statusId: s("backlog"),
      priorityLevel: "Low",
      labelIds: labels(LABEL.ui),
      createdAt: iso(-3, 17, 10),
    },

    // Portfolio Refresh (Personal)
    {
      id: T.pickCases,
      ...portfolio,
      name: "Pick three case studies to feature",
      duration: 30,
      statusId: s("completed", WS_PERSONAL),
      priorityLevel: "Medium",
      completedAt: iso(-3, 21, 0),
      createdAt: iso(-10, 20, 20),
      updatedAt: iso(-3, 21, 0),
    },
    {
      id: T.caseStudy,
      ...portfolio,
      name: "Write the onboarding redesign case study",
      description: "Problem, constraints, three iterations, results. Aim for a 6-minute read.",
      duration: 180,
      statusId: s("todo", WS_PERSONAL),
      priorityLevel: "Medium",
      deadline: ymd(14),
      labelIds: labels(LABEL.writing),
      checklist: checklist(T.caseStudy, [
        ["Outline", iso(-2, 21, 30)],
        ["First draft", null],
        ["Pick hero images", null],
      ]),
      blocks: [block(T.caseStudy, 0, iso(4, 19, 0), iso(4, 20, 30), "manual")],
      createdAt: iso(-9, 21, 0),
    },
    {
      id: T.images,
      ...portfolio,
      name: "Export and compress project images",
      duration: 60,
      statusId: s("todo", WS_PERSONAL),
      priorityLevel: "Low",
      deadline: ymd(20),
      createdAt: iso(-9, 21, 5),
    },

    // Personal, no project
    {
      id: T.passport,
      workspaceId: WS_PERSONAL,
      name: "Renew passport",
      description: "Photo booth on 3rd St, form DS-82, check is in the desk drawer.",
      duration: 30,
      statusId: s("todo", WS_PERSONAL),
      priorityLevel: "High",
      deadline: ymd(8),
      labelIds: labels(LABEL.admin),
      createdAt: iso(-12, 19, 0),
    },

    // Reminders (timed pings, no estimate)
    {
      id: T.dentist,
      kind: "reminder",
      name: "Call the dentist to move Thursday's cleaning",
      scheduledOn: iso(0, 17, 15),
      createdAt: iso(-2, 8, 30),
    },
    {
      id: T.weeklyUpdate,
      kind: "reminder",
      workspaceId: WS_STUDIO,
      name: "Post the weekly design update in #design",
      recurrence: weekly("rr_weekly_update", "task", T.weeklyUpdate, "FR", iso(-60, 16, 0)),
      createdAt: iso(-60, 9, 0),
    },

    // Inbox captures
    {
      id: T.inboxVariables,
      kind: "inbox",
      name: "Look into Figma variables for theming the token set",
      createdAt: ago(60 * 3),
    },
    {
      id: T.inboxBudget,
      kind: "inbox",
      name: "Ask Sam about the Q4 research participant budget",
      createdAt: ago(60 * 22),
    },
    {
      id: T.inboxMeter,
      kind: "inbox",
      name: "Idea: progress meter on the welcome checklist",
      createdAt: ago(25),
    },
  ];

  return tasks.map((seed) => makeTask(clock, seed));
}

type EventSeed = Partial<CalendarEventEntity> & Pick<CalendarEventEntity, "id" | "title" | "start" | "end">;

export function buildEvents(clock: Clock): CalendarEventEntity[] {
  const { iso } = clock;
  const created = iso(-14, 9, 0);
  const minutes = (start: string, end: string) => Math.round((Date.parse(end) - Date.parse(start)) / 60_000);
  const seeds: EventSeed[] = [
    {
      id: "evt_standup",
      title: "Design team standup",
      description: "15 minutes, cameras optional. Blockers first.",
      start: iso(-60, 9, 0),
      end: iso(-60, 9, 15),
      color: "#889096",
      workspaceId: WS_STUDIO,
      recurrence: weekly("rr_standup", "event", "evt_standup", "MO,TU,WE,TH,FR", iso(-60, 9, 0)),
    },
    {
      id: "evt_sprint_planning",
      title: "Sprint planning",
      start: iso(-2, 10, 0),
      end: iso(-2, 11, 0),
      color: "#0091FF",
      workspaceId: WS_STUDIO,
    },
    {
      id: "evt_a11y_workshop",
      title: "Accessibility workshop with the platform team",
      start: iso(-3, 15, 0),
      end: iso(-3, 16, 30),
      color: "#F76808",
      workspaceId: WS_STUDIO,
      projectId: P_DESIGN_SYSTEM,
    },
    {
      id: "evt_interview_acme",
      title: "User interview: Acme Corp workspace admin",
      description: "Zoom link in the invite. Ask about how they invited the first 10 people.",
      start: iso(-1, 14, 0),
      end: iso(-1, 15, 0),
      color: "#6E56CF",
      workspaceId: WS_STUDIO,
      projectId: P_ONBOARDING,
    },
    {
      id: "evt_one_on_one",
      title: "1:1 with Priya",
      description: "Bring: onboarding timeline, conference talk proposal.",
      start: iso(0, 11, 30),
      end: iso(0, 12, 0),
      color: "#889096",
      workspaceId: WS_STUDIO,
    },
    {
      id: "evt_critique",
      title: "Onboarding design critique",
      description: "Show the welcome-flow wireframes. Ask specifically about the skip path.",
      start: iso(0, 15, 30),
      end: iso(0, 16, 30),
      color: "#6E56CF",
      workspaceId: WS_STUDIO,
      projectId: P_ONBOARDING,
      taskId: T.wireframe,
    },
    {
      id: "evt_lunch_jordan",
      title: "Lunch with Jordan",
      description: "Tartine, Valencia St.",
      start: iso(1, 12, 0),
      end: iso(1, 13, 0),
      color: "#30A66D",
      workspaceId: WS_PERSONAL,
    },
    {
      id: "evt_office_hours",
      title: "Design system office hours",
      start: iso(1, 15, 0),
      end: iso(1, 16, 0),
      color: "#0091FF",
      workspaceId: WS_STUDIO,
      projectId: P_DESIGN_SYSTEM,
    },
    {
      id: "evt_usability_4",
      title: "Usability test #4: welcome flow prototype",
      start: iso(2, 13, 30),
      end: iso(2, 14, 30),
      color: "#6E56CF",
      workspaceId: WS_STUDIO,
      projectId: P_ONBOARDING,
    },
    {
      id: "evt_offsite",
      title: "Company offsite",
      description: "Pier 27. No laptops before lunch.",
      start: iso(3, 0, 0),
      end: iso(4, 0, 0),
      allDay: true,
      color: "#D6409F",
    },
    {
      id: "evt_stakeholder_review",
      title: "Stakeholder review: onboarding direction",
      start: iso(4, 10, 30),
      end: iso(4, 11, 30),
      color: "#6E56CF",
      workspaceId: WS_STUDIO,
      projectId: P_ONBOARDING,
    },
    {
      id: "evt_climbing",
      title: "Climbing at Mission Cliffs",
      start: iso(-1, 18, 30),
      end: iso(-1, 20, 0),
      color: "#30A66D",
      workspaceId: WS_PERSONAL,
    },
  ];
  return seeds.map((seed) => ({
    description: "",
    allDay: false,
    color: null,
    userId: USER_ID,
    workspaceId: null,
    projectId: null,
    taskId: null,
    recurrence: null,
    createdAt: created,
    updatedAt: created,
    duration: minutes(seed.start, seed.end),
    ...seed,
  }));
}
