import type { DayBlock } from "./dayPanel";

/** A plausible day around the sign-in, so the panel never looks empty. */
export const SIGN_IN_DAY: DayBlock[] = [
  {
    id: "plan",
    title: "Plan the week",
    at: -85,
    length: 45,
    color: "var(--lp-amber)",
  },
  {
    id: "reply",
    title: "Reply to Sam",
    at: -30,
    length: 20,
    color: "var(--lp-cyan)",
  },
  {
    id: "now",
    title: "Sign in to Timely",
    at: 0,
    length: 20,
    color: "var(--lp-now)",
    state: "now",
  },
  {
    id: "deep",
    title: "Deep work: launch brief",
    at: 20,
    length: 90,
    color: "var(--lp-violet)",
    tag: { name: "Deep work", color: "#6E56CF" },
  },
  {
    id: "review",
    title: "Client review",
    at: 120,
    length: 60,
    color: "var(--lp-blue)",
    tag: { name: "Meeting", color: "#0091FF" },
  },
  { id: "gym", title: "Gym", at: 190, length: 45, color: "var(--lp-green)" },
];

/** Sign-up: the rest of the first day is getting set up. */
export const SIGN_UP_DAY: DayBlock[] = [
  {
    id: "now",
    title: "Create your account",
    at: 0,
    length: 20,
    color: "var(--lp-now)",
    state: "now",
  },
  {
    id: "uses",
    title: "Tell Timely what it is for",
    at: 20,
    length: 25,
    color: "var(--lp-violet)",
  },
  {
    id: "workspace",
    title: "Name your first workspace",
    at: 50,
    length: 25,
    color: "var(--lp-amber)",
  },
  {
    id: "capture",
    title: "Write down the first thing on your mind",
    at: 80,
    length: 60,
    color: "var(--lp-green)",
  },
  {
    id: "free",
    title: "",
    at: 150,
    length: 60,
    color: "var(--lp-now)",
    state: "ghost",
  },
];

/** An example task for each starter label, with a believable length. */
const LABEL_TASKS: Record<string, [string, number]> = {
  Urgent: ["Renew the passport", 30],
  Waiting: ["Hear back from the printer", 20],
  "Quick win": ["Book the dentist", 15],
  "Deep work": ["Deep work: launch brief", 90],
  Meeting: ["Team sync", 30],
  "Follow up": ["Follow up with Alex", 20],
  Admin: ["Expense report", 30],
  Errand: ["Pick up the parcel", 25],
  Bills: ["Pay the electricity bill", 15],
  Family: ["Call mum", 30],
  Health: ["Doctor's appointment", 45],
  Workout: ["Gym: legs day", 60],
  Reading: ["Read chapter 4", 45],
  Exam: ["Revise for the stats exam", 90],
  Assignment: ["Essay draft due", 60],
  Research: ["Collect sources", 45],
  Clients: ["Call with Northwind", 30],
  Invoices: ["Send October invoices", 25],
  Marketing: ["Plan the newsletter", 45],
  Sales: ["Demo for a new lead", 30],
  Hiring: ["Interview a designer", 45],
  "1:1": ["1:1 with Priya", 30],
  Review: ["Review the draft", 30],
  Ideas: ["Sketch new ideas", 30],
  Draft: ["First draft of the story", 60],
  "Home repair": ["Fix the kitchen tap", 45],
  Shopping: ["Weekly shop", 40],
  Learning: ["Spanish lesson", 45],
};

/**
 * Onboarding: one example block per picked starter label, after a short
 * "Set up Timely" block at the now marker.
 */
export function onboardingDay(
  labels: { name: string; color: string }[],
  max = 5,
): DayBlock[] {
  const blocks: DayBlock[] = [
    {
      id: "now",
      title: "Set up Timely",
      at: 0,
      length: 20,
      color: "var(--lp-now)",
      state: "now",
    },
  ];
  let at = 20;
  for (const label of labels.slice(0, max)) {
    const [title, length] = LABEL_TASKS[label.name] ?? [label.name, 30];
    blocks.push({
      id: `label-${label.name}`,
      title,
      at,
      length,
      color: label.color,
      tag: label,
    });
    at += length + 10;
  }
  return blocks;
}
