// The desktop window's requests to the API (plan 11.4). Electron-free so
// scripts/electron-supervisor.test.mjs can run it: main.ts hands in the
// session cookie reader and the device's name.
//
// The token is made per launch by the supervisor and goes to the API in its
// environment. It lives only in the main process: the renderer asks for an
// operation from the fixed list in shellOps.ts and gets the API's answer
// back, never the token and never the session cookie.
import { randomBytes } from "node:crypto";
import { planShellRequest, type ShellPlan } from "./shellOps.ts";

/** The header the API reads (apps/api/internal/features/instance/shell.go). */
export const SHELL_TOKEN_HEADER = "X-Timely-Shell-Token";

/** 32 random bytes as 64 hex characters; a new one for every launch of the app. */
export function newShellToken(): string {
  return randomBytes(32).toString("hex");
}

/** True for http://127.0.0.1, http://localhost and http://[::1] only. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:") return false;
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]";
  } catch {
    return false;
  }
}

export type ShellResult = { ok: boolean; status: number; body: unknown };

export type ShellForwardOptions = {
  /** The API's loopback address (supervisor.apiUrl). Anything else is refused. */
  apiUrl: string;
  token: string;
  /** The renderer's `session` cookie value, read from its Electron session. */
  sessionCookie: () => Promise<string | undefined>;
  /** What this device is called on a host card answer. */
  deviceName: string;
  fetchImpl?: typeof fetch;
};

/**
 * Sends one listed operation to the API with the shell token and the
 * renderer's session. A chat.hostApproval request is stamped as the desktop
 * device here, so a page cannot claim another kind.
 */
export async function forwardShellRequest(options: ShellForwardOptions, op: unknown, rawBody: unknown): Promise<ShellResult> {
  if (!isLoopbackUrl(options.apiUrl)) throw new Error("The desktop window only talks to the API on this computer");
  if (!options.token) throw new Error("No shell token");
  const plan: ShellPlan = planShellRequest(op, rawBody);
  if (op === "chat.hostApproval" && plan.body) {
    plan.body.device = { kind: "desktop", name: options.deviceName };
  }
  const session = await options.sessionCookie();
  const headers: Record<string, string> = {
    Accept: "application/json",
    [SHELL_TOKEN_HEADER]: options.token,
  };
  if (session) headers.Cookie = `session=${session}`;
  if (plan.body) headers["Content-Type"] = "application/json";
  const response = await (options.fetchImpl ?? fetch)(new URL(plan.path, options.apiUrl), {
    method: plan.method,
    headers,
    body: plan.body ? JSON.stringify(plan.body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // The API answered with plain text; hand it back as it is.
  }
  return { ok: response.ok, status: response.status, body };
}
