/**
 * External MCP servers (phase 5, plan 8.2; owner answer Q-5.6): the whole
 * curated catalog, sending tools included, each server Can use / Ask me
 * first / Off. `GET/POST /agent/mcp/servers`, `PUT/DELETE /agent/mcp/servers/:name`,
 * `GET /agent/mcp/catalog`, `GET /agent/mcp/servers/:name/tools` and
 * `POST /agent/mcp/servers/:name/sign-in`. The words and the small decisions
 * (what a row says, how a catalog is filtered, how typed arguments are read)
 * are shared so web, desktop and phone say the same thing. Pure: no app imports.
 */

export type McpMode = "use" | "ask" | "off";

export const MCP_TITLE = "MCP servers";
export const MCP_SUMMARY_EMPTY = "Connect Linear, Notion, Stripe and more";

export const MCP_MODES: { value: McpMode; label: string; hint: string }[] = [
  {
    value: "use",
    label: "Can use",
    hint: "In Auto it runs without asking, except to send something, delete something, spend money or change settings. In Supervised it still asks.",
  },
  { value: "ask", label: "Ask me first", hint: "Every call waits for your OK on a card." },
  { value: "off", label: "Off", hint: "Not connected. The assistant can't see its tools." },
];

export function modeLabel(mode: string): string {
  return MCP_MODES.find((m) => m.value === mode)?.label ?? "Ask me first";
}

export function modeHint(mode: string): string {
  return MCP_MODES.find((m) => m.value === mode)?.hint ?? MCP_MODES[1].hint;
}

/** What the gate treats a tool as (`agentmcp.Class`). */
export type McpToolClass = "send" | "pay" | "config" | "delete" | "write" | "read";

export type McpToolHints = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type McpTool = {
  name: string;
  description: string;
  annotations: McpToolHints;
  class: McpToolClass;
};

const TOOL_CLASS_LABEL: Record<McpToolClass, string> = {
  send: "Sends",
  pay: "Spends money",
  config: "Changes settings",
  delete: "Deletes",
  write: "Changes data",
  read: "Reads",
};

export function toolClassLabel(c: string): string {
  return TOOL_CLASS_LABEL[c as McpToolClass] ?? "Changes data";
}

/** Classes that Auto always stops on, however the server is set. */
export function toolAlwaysAsks(c: string): boolean {
  return c === "send" || c === "pay" || c === "config" || c === "delete";
}

export type McpStatus = "ready" | "needs_sign_in" | "waiting_for_ok" | "not_approved" | "unavailable";

export type McpServer = {
  name: string;
  source: "catalog" | "custom";
  catalogId: string;
  transport: "remote" | "command";
  url?: string;
  command?: string;
  args?: string[];
  envNames?: string[];
  mode: McpMode;
  status: McpStatus;
  signsIn: boolean;
  signedIn: boolean;
  category?: string;
  /** "Sends messages to other people" and the like, for servers that act on others. */
  flag?: string;
  description?: string;
  warning?: string;
  lastError?: string;
  tools: McpTool[] | null;
  createdAt: string;
};

export type McpServersResponse = { servers: McpServer[]; canAddCommand: boolean };

export type McpCatalogField = { name: string; prompt: string; secret: boolean; required: boolean };

export type McpCatalogRow = {
  id: string;
  name: string;
  url: string;
  category: string;
  flag: string;
  auth: "oauth" | "none" | string;
  description: string;
  fields: McpCatalogField[];
  note: string;
  added: boolean;
};

export type McpAddInput = {
  catalogId?: string;
  name?: string;
  url?: string;
  signIn?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  values?: Record<string, string>;
  mode?: McpMode;
};

export type McpUpdateInput = {
  mode?: McpMode;
  url?: string;
  signIn?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
};

/** The one-line state of a row: what it says and how loudly. */
export function serverStatus(s: Pick<McpServer, "status" | "mode" | "warning" | "lastError" | "signedIn" | "signsIn">): {
  text: string;
  tone: "ok" | "warn" | "error" | "muted";
} {
  if (s.mode === "off") return { text: "Not connected", tone: "muted" };
  switch (s.status) {
    case "needs_sign_in":
      return { text: "Sign in to use it", tone: "warn" };
    case "waiting_for_ok":
      return { text: "Waiting for your OK on the host card", tone: "warn" };
    case "not_approved":
      return { text: s.warning || "Not added: you said no, or it timed out.", tone: "warn" };
    case "unavailable":
      return { text: s.warning || "Not available", tone: "error" };
  }
  if (s.lastError) return { text: s.lastError, tone: "error" };
  return { text: s.signsIn && s.signedIn ? "Signed in" : "Connected", tone: "ok" };
}

/** "3 servers, 1 needs you" for the closed row. */
export function serversSummary(servers: Pick<McpServer, "status" | "mode">[] | undefined): string {
  if (!servers || servers.length === 0) return MCP_SUMMARY_EMPTY;
  const needs = servers.filter((s) => s.mode !== "off" && (s.status === "needs_sign_in" || s.status === "waiting_for_ok" || s.status === "not_approved")).length;
  const base = `${servers.length} ${servers.length === 1 ? "server" : "servers"}`;
  return needs > 0 ? `${base}, ${needs} need${needs === 1 ? "s" : ""} you` : base;
}

const CATEGORY_LABEL: Record<string, string> = {
  analytics: "Analytics",
  automation: "Automation",
  crm: "CRM",
  data: "Data",
  design: "Design",
  developer: "Developer tools",
  docs: "Docs",
  files: "Files",
  finance: "Finance",
  fitness: "Fitness",
  infrastructure: "Hosting and databases",
  jobs: "Jobs",
  meetings: "Meetings",
  messaging: "Messaging",
  operations: "Monitoring",
  other: "Other",
  payments: "Payments",
  projects: "Projects and tasks",
  reference: "Reference",
  scheduling: "Scheduling",
  travel: "Travel",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

/** The categories the catalog has, by label. */
export function catalogCategories(rows: Pick<McpCatalogRow, "category">[]): { value: string; label: string }[] {
  const seen = new Set(rows.map((r) => r.category || "other"));
  return [...seen].map((value) => ({ value, label: categoryLabel(value) })).sort((a, b) => a.label.localeCompare(b.label));
}

/** The catalog filtered by a search and a category, by name; servers already added last. */
export function filterCatalog<T extends McpCatalogRow>(rows: T[], query: string, category: string): T[] {
  const q = query.trim().toLowerCase();
  return rows
    .filter((r) => (!category || r.category === category) && (!q || `${r.name} ${r.description} ${categoryLabel(r.category)}`.toLowerCase().includes(q)))
    .sort((a, b) => Number(a.added) - Number(b.added) || a.name.localeCompare(b.name));
}

/** The values a catalog server asks for that are still empty. */
export function missingFields(item: Pick<McpCatalogRow, "fields">, values: Record<string, string>): McpCatalogField[] {
  return item.fields.filter((f) => f.required && !(values[f.name] ?? "").trim());
}

export const NAME_RULE = "Letters, numbers, - and _, up to 48 characters";

/** A server name the API accepts (`agentmcp.nameRe`), else why not. */
export function nameProblem(name: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(name.trim()) ? null : NAME_RULE;
}

/** "my-notes" from "https://notes.example.com/mcp" as a first suggestion. */
export function suggestName(url: string): string {
  try {
    const host = new URL(url.trim()).hostname.replace(/^(www|mcp|api)\./, "");
    const word = host.split(".")[0] ?? "";
    return word.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 48);
  } catch {
    return "";
  }
}

/** An address the API accepts in shape: http or https with a host. The API checks that it is public. */
export function urlProblem(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return "Use an http or https address";
    if (u.username || u.password) return "Leave the user name and password out";
    if (u.hash) return "Leave the # part out";
    return null;
  } catch {
    return "Enter the server's address, like https://mcp.example.com/mcp";
  }
}

/** Splits typed arguments the way a shell would for the simple cases: spaces separate, quotes group. */
export function parseArgs(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || cur) out.push(cur);
      cur = "";
      started = false;
    } else cur += ch;
  }
  if (started || cur) out.push(cur);
  return out;
}

/** The inverse of parseArgs, for showing a command on a card. */
export function formatArgs(args: string[]): string {
  return args.map((a) => (/[\s"']/.test(a) || a === "" ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
}

/** `KEY=value` per line; blank lines and # comments are skipped. */
export function parseEnv(text: string): { env: Record<string, string>; error?: string } {
  const env: Record<string, string> = {};
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    const key = eq < 0 ? "" : line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) return { env, error: `Line ${i + 1} should look like NAME=value` };
    env[key] = line.slice(eq + 1);
  }
  return { env };
}

/** What a command server runs, as one line. */
export function commandLine(s: Pick<McpServer, "command" | "args">): string {
  return [s.command ?? "", formatArgs(s.args ?? [])].filter(Boolean).join(" ");
}

/** The address or command a row shows under its name. */
export function serverTarget(s: Pick<McpServer, "transport" | "url" | "command" | "args">): string {
  if (s.transport === "command") return commandLine(s);
  try {
    const u = new URL(s.url ?? "");
    return u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return s.url ?? "";
  }
}

export const COMMAND_ONLY_DESKTOP = "Add a command server from Timely on the web or the desktop app. It runs on the computer that hosts Timely.";
export const COMMAND_NOT_ALLOWED = "Only an account that can use this computer can add a command server.";
export const ADD_COMMAND_NOTE =
  "A command server starts a program on this computer. It waits for your OK on a card that shows the exact command, and every change asks again.";
export const SIGN_IN_NOTE = "Opens the server's sign-in page. Timely keeps the sign-in encrypted and never in a backup.";
export const MCP_INTRO =
  "Connect other services to the assistant. Each server is Can use, Ask me first or Off. Anything that sends, deletes, spends money or changes settings always asks in Auto.";
export const MCP_SENDING_NOTE =
  "Tools that send, delete, spend or change settings are found by their names and what the server says about them. Keep a mail or messaging server on Ask me first.";

/** The toast after Add: command servers wait for the card. */
export function addedMessage(name: string, pending: boolean): string {
  return pending ? `${name} is waiting for your OK on the host card.` : `${name} added. It asks first until you change it.`;
}
