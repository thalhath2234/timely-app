// Words and small rules for an agent Bot's grouped rows. Pure (no React), so
// `make test-mobile-assistant` runs it under Node.
import {
  AGENT_STARTERS,
  checkOutcomeWords,
  starterAvailable,
  type AgentBotFields,
  type AgentStarter,
  type BotPermission,
  type BotSchedule,
  type CheckView,
  type McpMode,
} from "@timely/contract/bots";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "8:00 AM" for "08:00". */
export function clockWords(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** "Every day", "Weekdays", "Mon, Wed" for a list of weekdays (0 = Sunday). */
export function weekdaysWords(days: number[]): string {
  const set = [...new Set(days)].sort((a, b) => a - b);
  if (set.length === 0 || set.length === 7) return "Every day";
  if (set.join() === "1,2,3,4,5") return "Weekdays";
  if (set.join() === "0,6") return "Weekends";
  if (set.length === 1) return `${DAY_NAMES[set[0]]}s`;
  return set.map((d) => DAY_SHORT[d]).join(", ");
}

/** The Bot's schedule in words: "Every 30 minutes", "Weekdays at 9:00 AM", "On a schedule (cron)". */
export function scheduleWords(schedule: BotSchedule | Record<string, never> | null | undefined): string {
  const s = (schedule ?? {}) as Partial<{ everyMinutes: number; dailyAt: string; weekdays: number[]; cron: string }>;
  if (typeof s.everyMinutes === "number" && s.everyMinutes > 0) {
    const n = s.everyMinutes;
    if (n % 1440 === 0) return n === 1440 ? "Every day" : `Every ${n / 1440} days`;
    if (n % 60 === 0) return n === 60 ? "Every hour" : `Every ${n / 60} hours`;
    return `Every ${n} minutes`;
  }
  if (s.dailyAt) return `${weekdaysWords(s.weekdays ?? [])} at ${clockWords(s.dailyAt)}`;
  if (s.cron) return `On a schedule (${s.cron})`;
  return "Not scheduled";
}

/** The schedule choices the editor offers; a `cron` stays whatever it was. */
export const EVERY_CHOICES: { minutes: number; label: string }[] = [
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 30, label: "Every 30 minutes" },
  { minutes: 60, label: "Every hour" },
  { minutes: 180, label: "Every 3 hours" },
  { minutes: 360, label: "Every 6 hours" },
  { minutes: 720, label: "Every 12 hours" },
];

export const PERMISSION_COPY: Record<BotPermission, { name: string; line: string }> = {
  supervised: { name: "Supervised", line: "Asks before any step that changes something" },
  auto: { name: "Auto", line: "Does safe steps itself; asks for the rest" },
  full: { name: "Full Access", line: "Never asks. Set on the desktop, after the step-up" },
};

/** The phone offers Supervised and Auto; Full Access waits for the desktop step-up. */
export const PHONE_PERMISSIONS: BotPermission[] = ["supervised", "auto"];

export const permissionWords = (mode: BotPermission | string | undefined): string =>
  PERMISSION_COPY[(mode as BotPermission) ?? "auto"]?.name ?? "Auto";

export const gateWords = (gate: string | undefined): string => (gate === "changed" ? "Only when something changed" : "Every time");

/** The first line of a prompt, shortened, for the row that opens it. */
export function promptPreview(prompt: string | undefined, max = 90): string {
  const line = (prompt ?? "").trim().split(/\r?\n/)[0] ?? "";
  if (!line) return "Not written yet";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** Tools row meta: "2 signed-in sites, 1 extra host", or "Reads the web only". */
export function toolsSummary(tools: AgentBotFields["tools"] | undefined): string {
  const sites = tools?.browserSites?.length ?? 0;
  const hosts = tools?.egress?.length ?? 0;
  const servers = Object.values(tools?.mcp ?? {}).filter((m) => m !== "off").length;
  const parts: string[] = [];
  if (sites) parts.push(`${sites} signed-in ${sites === 1 ? "site" : "sites"}`);
  if (hosts) parts.push(`${hosts} extra ${hosts === 1 ? "host" : "hosts"}`);
  if (servers) parts.push(`${servers} ${servers === 1 ? "app" : "apps"}`);
  return parts.length ? parts.join(", ") : "Only the sites it reads";
}

/** Skills row meta. */
export const skillsSummary = (skills: string[] | undefined): string => {
  const n = skills?.length ?? 0;
  return n ? `${n} ${n === 1 ? "skill" : "skills"}` : "None";
};

export const MCP_MODE_WORDS: Record<McpMode, string> = { use: "Use", ask: "Ask first", off: "Off" };

/** A site the Bot may read signed in, as typed: a host without a scheme, path or spaces; null when it isn't one. */
export function cleanSite(input: string): string | null {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) ? host : null;
}

/** One tick of an agent Bot, as a line: "Told you", "Browser busy", "Already told you". */
export function checkLine(check: Pick<CheckView, "outcome" | "note" | "error">): string {
  const words = checkOutcomeWords(check.outcome);
  const detail = check.note || check.error;
  return detail ? `${words}: ${detail}` : words;
}

/** The message a Starter sends to a new Bot's thread, so the thread drafts the whole setup for one Create. */
export function starterRequest(starter: AgentStarter): string {
  return `Set up a Bot called "${starter.title}". ${starter.prompt} Run it ${scheduleWords(starter.schedule).toLowerCase()}.`;
}

/** The one rules Bot to offer for conversion next: the first not put off this session, never one that is already an agent (one at a time, no bulk approve). */
export function nextToConvert<T extends { id: string; engine?: string }>(bots: T[], dismissed: ReadonlySet<string>): T | null {
  return bots.find((b) => b.engine !== "agent" && !dismissed.has(b.id)) ?? null;
}

export type StarterRow = { starter: AgentStarter; available: boolean; copy: string | null };

/** Every Starter, with whether it can run with these connectors and what it needs when it cannot. */
export function starterRows(connectors: readonly string[]): StarterRow[] {
  return AGENT_STARTERS.map((starter) => ({ starter, ...starterAvailable(starter, connectors) }));
}
