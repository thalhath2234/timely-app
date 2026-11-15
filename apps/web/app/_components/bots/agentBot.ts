import {
  checkOutcomeWords,
  everyLabel,
  type BotSchedule,
  type BotView,
  type CheckView,
} from "@timely/contract/bots";
import type { AgentBotView, AgentRunRecord } from "@/app/_types/types";

/** A Bot whose engine is the agent (the rules Bots keep their own page). */
export function isAgentBot(
  bot: BotView | null | undefined,
): bot is AgentBotView {
  return (bot as Partial<AgentBotView> | null | undefined)?.engine === "agent";
}

/** A Check with an agent tick's own record. */
export type AgentCheck = CheckView & {
  run?: AgentRunRecord | null;
  gateSkipped?: boolean;
  skipReason?: string;
};

export type CheckTally = {
  silent: number;
  alerted: number;
  skipped: number;
  failed: number;
  browserBusy: number;
  tokens: number;
};

const SKIPPED = new Set(["skipped", "unchanged", "superseded", "duplicate"]);
const FAILED = new Set(["failed", "strike", "offline"]);

/** What the recent checks came to: the numbers on the check strip. */
export function checkTally(checks: readonly AgentCheck[]): CheckTally {
  const out: CheckTally = {
    silent: 0,
    alerted: 0,
    skipped: 0,
    failed: 0,
    browserBusy: 0,
    tokens: 0,
  };
  for (const c of checks) {
    const o = c.outcome as string;
    if (o === "silent") out.silent++;
    else if (o === "alerted" || o === "fired") out.alerted++;
    else if (o === "browser_busy") out.browserBusy++;
    else if (FAILED.has(o)) out.failed++;
    else if (SKIPPED.has(o) || o === "no_ai") out.skipped++;
    if (c.run?.usage)
      out.tokens += c.run.usage.inputTokens + c.run.usage.outputTokens;
  }
  return out;
}

/** The strip's cells, in the order the numbers are read: label and count. */
export function tallyCells(
  tally: CheckTally,
): { key: keyof CheckTally; label: string; value: string }[] {
  return [
    { key: "silent", label: "Silent", value: String(tally.silent) },
    { key: "alerted", label: "Alerted", value: String(tally.alerted) },
    { key: "skipped", label: "Skipped", value: String(tally.skipped) },
    { key: "failed", label: "Failed", value: String(tally.failed) },
    {
      key: "browserBusy",
      label: "Browser busy",
      value: String(tally.browserBusy),
    },
    { key: "tokens", label: "Tokens", value: tokenWords(tally.tokens) },
  ];
}

/** 1234 -> "1.2k"; small counts stay whole. */
export function tokenWords(n: number): string {
  if (n < 1000) return String(n);
  if (n < 100_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n / 1000)}k`;
}

/** An agent check's outcome in words; a gate skip says why nothing ran. */
export function agentOutcomeWords(c: AgentCheck): string {
  if (c.gateSkipped && c.outcome === "skipped") return "Nothing changed";
  return checkOutcomeWords(c.outcome);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Every 30 min", "Weekdays at 09:00", "Mon, Wed at 18:00", or the cron text. */
export function scheduleWords(s: BotSchedule): string {
  if ("everyMinutes" in s) {
    const every = everyLabel(s.everyMinutes);
    return every.charAt(0).toUpperCase() + every.slice(1);
  }
  if ("cron" in s) return s.cron;
  const days = [...s.weekdays].sort((a, b) => a - b);
  const set = days.join(",");
  const when =
    set === "0,1,2,3,4,5,6"
      ? "Daily"
      : set === "1,2,3,4,5"
        ? "Weekdays"
        : days.map((d) => DAYS[d]).join(", ");
  return `${when} at ${s.dailyAt}`;
}

/** The schedule presets the editor offers; a saved schedule outside them is added as Current. */
export const SCHEDULE_PRESETS: {
  value: string;
  label: string;
  schedule: BotSchedule;
}[] = [
  { value: "m15", label: "Every 15 min", schedule: { everyMinutes: 15 } },
  { value: "m30", label: "Every 30 min", schedule: { everyMinutes: 30 } },
  { value: "m60", label: "Every hour", schedule: { everyMinutes: 60 } },
  { value: "m360", label: "Every 6 hours", schedule: { everyMinutes: 360 } },
  {
    value: "daily",
    label: "Daily",
    schedule: { dailyAt: "08:00", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  },
  {
    value: "weekdays",
    label: "Weekdays",
    schedule: { dailyAt: "09:00", weekdays: [1, 2, 3, 4, 5] },
  },
];

/** Which preset (or "custom") a schedule is. */
export function presetOf(s: BotSchedule): string {
  if ("everyMinutes" in s) {
    return (
      SCHEDULE_PRESETS.find(
        (p) =>
          "everyMinutes" in p.schedule &&
          p.schedule.everyMinutes === s.everyMinutes,
      )?.value ?? "custom"
    );
  }
  if ("dailyAt" in s) {
    const set = [...s.weekdays].sort((a, b) => a - b).join(",");
    if (set === "0,1,2,3,4,5,6") return "daily";
    if (set === "1,2,3,4,5") return "weekdays";
  }
  return "custom";
}

/** The three words after "Changed:" for a pending widening, as the card's title. */
export function pendingTitle(reason: string | undefined): string {
  if (reason === "browser_site") return "Read a site on your signed-in browser";
  if (reason === "memory") return "Use your memory and About you";
  if (reason === "permission") return "Run with looser permission";
  return "Give the Bot more reach";
}

/** A held alert's words; 'duplicate' is the same words as the duplicate check. */
export function heldWords(held: string | undefined): string {
  switch (held) {
    case "duplicate":
      return checkOutcomeWords("duplicate");
    case "snoozed":
      return "Kept while snoozed";
    case "cap":
      return "Over today's limit";
    case "shared":
      return "Folded into another alert";
    case "judged":
      return "Held back";
    default:
      return "";
  }
}
