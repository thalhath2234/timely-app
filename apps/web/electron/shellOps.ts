// The fixed list of requests the desktop window may send to the API with the
// shell token (plan 11.4, docs/desktop/README.md "Shell requests"). Pure and
// free of Electron and Node imports: the preload checks the operation name
// against it, the main process builds the request from it, and
// scripts/electron-supervisor.test.mjs reads it. A page can send nothing that
// is not in this table, and it never holds the token.

export type ShellMethod = "GET" | "PUT" | "PATCH" | "POST";

/** A request body the page may pass: flat, JSON-safe, small. */
export type ShellBody = Record<string, string | number | boolean | null>;

export type ShellPlan = { method: ShellMethod; path: string; body?: Record<string, unknown> };

type Field = "string" | "number" | "boolean" | "integer";

type Spec = {
  method: ShellMethod;
  /** Builds the API path; chatId is checked against CHAT_ID. */
  path: (body: ShellBody) => string;
  /** Required fields and their types. */
  required: Record<string, Field>;
  /** Optional fields and their types. */
  optional?: Record<string, Field>;
  /** Fields that name the chat in the path and stay out of the body. */
  pathFields?: string[];
  /** A flat free-form object of settings (no required or optional fields listed). */
  freeForm?: boolean;
};

const CHAT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_FIELDS = 16;
const MAX_STRING = 2048;

export const SHELL_OPS = {
  /** GET /instance/settings with the token: `shell: true` in the answer says the window is trusted. */
  "instance.settings": { method: "GET", path: () => "/instance/settings", required: {} },
  /** Turn "Let the assistant use this computer" on or off for the signed-in account. */
  "hostAccounts.set": { method: "PUT", path: () => "/instance/host-accounts", required: { uid: "string", on: "boolean" } },
  /** Set (or clear, with "") the signed-in account's working folder. */
  "hostAccounts.workingDir": { method: "PUT", path: () => "/instance/host-accounts", required: { uid: "string", workingDir: "string" } },
  /** The worker cap and the idle minutes. */
  "agentLimits.set": { method: "PUT", path: () => "/instance/agent-limits", required: { maxWorkers: "integer", idleMinutes: "integer" } },
  /** A chat's permission mode, Full Access included (the step-up). */
  "chat.permission": {
    method: "PATCH",
    path: (body) => `/chats/${String(body.chatId)}`,
    required: { chatId: "string", permission: "string" },
    pathFields: ["chatId"],
  },
  /** Settings -> Assistant -> Permissions: defaults, Full Access, host card rule. */
  "settings.permissions": { method: "PATCH", path: () => "/agent/chat-settings", required: {}, freeForm: true },
  /** Answer a host card from the desktop window. */
  "chat.hostApproval": {
    method: "POST",
    path: (body) => `/chats/${String(body.chatId)}/host-approval`,
    required: { chatId: "string", revision: "integer", requestId: "string", choice: "string" },
    pathFields: ["chatId"],
  },
} as const satisfies Record<string, Spec>;

export type ShellOp = keyof typeof SHELL_OPS;

/** The operation names the preload exposes, in table order. */
export const SHELL_OP_NAMES = Object.keys(SHELL_OPS) as ShellOp[];

export function isShellOp(value: unknown): value is ShellOp {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SHELL_OPS, value);
}

function typeOk(value: unknown, type: Field): boolean {
  switch (type) {
    case "string":
      return typeof value === "string" && value.length <= MAX_STRING && !value.includes("\0");
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value);
  }
}

/**
 * Turns an operation and a page's body into the API request, or throws. Nothing
 * outside SHELL_OPS can be built: an unknown operation, an unknown or missing
 * field, a field of the wrong type or a chat id that is not a plain id is refused.
 */
export function planShellRequest(op: unknown, rawBody: unknown): ShellPlan {
  if (!isShellOp(op)) throw new Error("Unknown request");
  const spec = SHELL_OPS[op] as Spec;
  const body = rawBody === undefined || rawBody === null ? {} : rawBody;
  if (typeof body !== "object" || Array.isArray(body)) throw new Error("The request body must be an object");
  const fields = body as Record<string, unknown>;
  const keys = Object.keys(fields);
  if (keys.length > MAX_FIELDS) throw new Error("Too many fields");
  if (spec.freeForm) {
    for (const key of keys) {
      const value = fields[key];
      const primitive = value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || typeOk(value, "string");
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || !primitive) throw new Error(`Bad field ${key}`);
    }
    return { method: spec.method, path: spec.path(fields as ShellBody), body: { ...fields } };
  }
  const allowed = { ...spec.required, ...(spec.optional ?? {}) };
  for (const key of keys) {
    if (!(key in allowed)) throw new Error(`Unknown field ${key}`);
  }
  for (const [key, type] of Object.entries(spec.required)) {
    if (!typeOk(fields[key], type)) throw new Error(`Missing or invalid field ${key}`);
  }
  for (const [key, type] of Object.entries(spec.optional ?? {})) {
    if (fields[key] !== undefined && !typeOk(fields[key], type)) throw new Error(`Invalid field ${key}`);
  }
  if ("chatId" in fields && !CHAT_ID.test(String(fields.chatId))) throw new Error("Invalid chat id");
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (!spec.pathFields?.includes(key)) out[key] = fields[key];
  }
  const plan: ShellPlan = { method: spec.method, path: spec.path(fields as ShellBody) };
  if (spec.method !== "GET") plan.body = out;
  return plan;
}
