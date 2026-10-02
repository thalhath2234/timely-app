/**
 * One sample story runs through every scene on the landing page: a
 * "Website refresh" project whose items are captured, clarified, scheduled,
 * focused on and reviewed. It matches the command-palette demo's sample world.
 */

export const REPO_URL = "https://github.com/thalhath2234/timely-app";

/** Tools the API exposes to external agents on /mcp. */
export const MCP_TOOL_COUNT = 147;

export const PROJECT = { title: "Website refresh", workspace: "Studio", color: "#6E56CF" };
export const EVENT_COLOR = "#0090FF";
export const REMINDER_COLOR = "#FFB224";

export const DOC_TITLE = "Website launch brief";
export const SHEET_TITLE = "Launch budget";

/** Mon–Fri of the sample week. */
export const WEEK_DAYS = [
  { short: "Mon", date: 5 },
  { short: "Tue", date: 6 },
  { short: "Wed", date: 7 },
  { short: "Thu", date: 8 },
  { short: "Fri", date: 9 },
] as const;

/** The Working hours every mini calendar shows: 09:00–17:00. */
export const WORKING_DAY = { start: 9, hours: 8 };

/**
 * The project's open Work. The brief and the checklist are the two the
 * visitor watches being captured and clarified; the rest was already there.
 */
export const WORK = {
  brief: { title: "Write the launch brief", duration: "1h 30m" },
  checklist: { title: "Review the launch checklist", duration: "45m" },
  homepage: { title: "Design the homepage", duration: "6h" },
  budget: { title: "Build the launch budget", duration: "1h" },
  form: { title: "Test the contact form", duration: "1h" },
} as const;

export type WorkId = keyof typeof WORK;

export const REMINDER = { title: "Renew the domain", when: "Fri 09:00" };

/** A Block on the sample week. */
export type CalendarBlock = {
  title: string;
  /** 0 = Monday. */
  day: number;
  /** Start hour, e.g. 11.5 for 11:30. */
  start: number;
  hours: number;
};

/** A Block of Work; split Work has one per chunk, labelled "1/2", "2/2". */
export type WorkBlock = CalendarBlock & { work: WorkId; part?: string };

function workBlock(work: WorkId, day: number, start: number, hours: number, part?: string): WorkBlock {
  return { work, title: WORK[work].title, day, start, hours, part };
}

/**
 * Where Auto-schedule places the Work: earliest fit inside Working hours,
 * around the Events below, splitting the homepage around lunch.
 */
export const WORK_BLOCKS: WorkBlock[] = [
  workBlock("brief", 0, 10, 1.5),
  workBlock("checklist", 0, 11.5, 0.75),
  workBlock("homepage", 1, 9, 3, "1/2"),
  workBlock("homepage", 1, 13, 3, "2/2"),
  workBlock("budget", 1, 16, 1),
  workBlock("form", 2, 9, 1),
];

export const EVENT_BLOCKS: CalendarBlock[] = [
  { title: "Weekly planning", day: 0, start: 9, hours: 1 },
  { title: "Brand workshop", day: 0, start: 13, hours: 4 },
  { title: "Lunch with Sam", day: 1, start: 12, hours: 1 },
  { title: "Dentist", day: 2, start: 14, hours: 1 },
  { title: "Client review", day: 3, start: 10, hours: 1 },
];
