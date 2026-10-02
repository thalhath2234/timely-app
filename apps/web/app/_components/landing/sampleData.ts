/**
 * One sample story runs through every scene on the landing page: a
 * "Website refresh" project whose items are captured, clarified, scheduled,
 * focused on and reviewed. It matches the command-palette demo's sample world.
 */

export const REPO_URL = "https://github.com/thalhath2234/timely-app";

export const PROJECT = { title: "Website refresh", workspace: "Studio", color: "#6E56CF" };
export const EVENT_COLOR = "#0090FF";
export const REMINDER_COLOR = "#FFB224";
export const DONE_COLOR = "#30A66D";

export const DOC_TITLE = "Website launch brief";
export const SHEET_TITLE = "Launch budget";

/** Mon–Fri of the sample week; the mini calendar shows Working hours 09:00–17:00. */
export const WEEK_DAYS = [
  { short: "Mon", date: 5 },
  { short: "Tue", date: 6 },
  { short: "Wed", date: 7 },
  { short: "Thu", date: 8 },
  { short: "Fri", date: 9 },
] as const;

export type CalendarSlot = {
  id: string;
  title: string;
  /** 0 = Monday. */
  day: number;
  /** Start hour, e.g. 10.5 for 10:30. */
  start: number;
  hours: number;
  /** "1/2" on a chunk of split Work. */
  part?: string;
};

export const WORK = {
  brief: { title: "Write the launch brief", duration: "1h 30m" },
  checklist: { title: "Review the launch checklist", duration: "45m" },
  homepage: { title: "Design the homepage", duration: "6h" },
  budget: { title: "Build the launch budget", duration: "1h" },
  form: { title: "Test the contact form", duration: "1h" },
} as const;

export const REMINDER = { title: "Renew the domain", when: "Fri 09:00" };

/**
 * Where Auto-schedule places the Work above: earliest fit inside Working
 * hours, around the Events below, splitting the homepage around lunch.
 */
export const WORK_SLOTS: CalendarSlot[] = [
  { id: "brief", title: WORK.brief.title, day: 0, start: 10, hours: 1.5 },
  { id: "checklist", title: WORK.checklist.title, day: 0, start: 11.5, hours: 0.75 },
  { id: "homepage-1", title: WORK.homepage.title, day: 1, start: 9, hours: 3, part: "1/2" },
  { id: "homepage-2", title: WORK.homepage.title, day: 1, start: 13, hours: 3, part: "2/2" },
  { id: "budget", title: WORK.budget.title, day: 1, start: 16, hours: 1 },
  { id: "form", title: WORK.form.title, day: 2, start: 9, hours: 1 },
];

export const EVENT_SLOTS: CalendarSlot[] = [
  { id: "planning", title: "Weekly planning", day: 0, start: 9, hours: 1 },
  { id: "workshop", title: "Brand workshop", day: 0, start: 13, hours: 4 },
  { id: "lunch", title: "Lunch with Sam", day: 1, start: 12, hours: 1 },
  { id: "dentist", title: "Dentist", day: 2, start: 14, hours: 1 },
  { id: "review", title: "Client review", day: 3, start: 10, hours: 1 },
];
