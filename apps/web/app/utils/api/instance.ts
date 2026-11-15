import type { ShellOp } from "@/electron-env";
import type { AgentLimitsPayload, HostAccountPayload, InstanceSettings } from "@timely/contract/instanceSettings";
import { saveFailureMessage } from "@timely/contract/instanceSettings";
import { apiFetch } from "./client";
import { getAgentProviders, type AgentProviders } from "./agentProviders";

/** `GET /health` (public). Contract: docs/desktop/README.md. */
export type Health = {
  status: "ok" | "degraded";
  /** This server's id; phones pin it when they pair. Missing when the database is down. */
  instanceId?: string;
  version: string;
  /** "ok" or the database error text. */
  db: string;
  migrations: { version: number; pending: number };
  registrationOpen: boolean;
  uptimeSeconds: number;
};

/** `GET /instance` (authenticated). Contract: docs/desktop/README.md. */
export type Instance = {
  instanceId?: string;
  version: string;
  platform: string;
  startedAt: string;
  port: number;
  bind: string[];
  listening: string[];
  dataDir: string;
  backupDir: string;
  allowRegistration: boolean;
  registrationOpen: boolean;
  localCli: boolean;
};

async function readMessage(res: Response, fallback: string) {
  try {
    const data = (await res.json()) as { message?: unknown };
    if (typeof data?.message === "string") return data.message;
  } catch {
    // keep the fallback
  }
  return fallback;
}

/** A 503 with `status: "degraded"` is a valid answer: the server is up but its
 * database is not. Anything else that is not 2xx throws. */
export async function getHealth(): Promise<Health> {
  const res = await apiFetch("/health");
  if (res.ok || res.status === 503) {
    const data = (await res.json()) as Partial<Health>;
    if (typeof data?.status !== "string") {
      throw new Error(`Unexpected health answer (${res.status})`);
    }
    return data as Health;
  }
  throw new Error(await readMessage(res, `Server check failed (${res.status})`));
}

export async function getInstance(): Promise<Instance> {
  const res = await apiFetch("/instance");
  if (!res.ok) {
    throw new Error(await readMessage(res, `Could not read server details (${res.status})`));
  }
  return res.json();
}

/** `POST /pairing-codes`: a one-time code (5 minutes) that signs in the phone
 * which scans the pairing QR, as the person signed in here. */
export type PairingCode = { code: string; expiresAt: string };

export async function createPairingCode(): Promise<PairingCode> {
  const res = await apiFetch("/pairing-codes", { method: "POST" });
  if (!res.ok) {
    throw new Error(await readMessage(res, `Could not create a sign-in code (${res.status})`));
  }
  return res.json();
}

/** Drops the cached CLI detection and returns the fresh provider view. The
 * rescan endpoint itself only promises to clear the cache, so the result is
 * taken from the next `GET /agent/providers` unless the POST already returned
 * a full provider payload. */
export async function rescanProviders(): Promise<AgentProviders> {
  const res = await apiFetch("/agent/providers/rescan", { method: "POST" });
  if (!res.ok) {
    throw new Error(await readMessage(res, `Re-scan failed (${res.status})`));
  }
  try {
    const data = (await res.json()) as Partial<AgentProviders> | null;
    if (data && typeof data.defaultProvider === "string" && data.claude && data.codex) {
      return data as AgentProviders;
    }
  } catch {
    // empty or non-JSON body: fall through to a fresh read
  }
  return getAgentProviders();
}

// ---------------------------------------------------------------------------
// Instance settings: who may use this computer, the worker limits
// ---------------------------------------------------------------------------

/** The desktop window's bridge for requests the server answers only to it, or null in a browser. */
export function desktopShell() {
  if (typeof window === "undefined") return null;
  return window.timelyDesktop?.shell ?? null;
}

type ShellBody = Record<string, string | number | boolean | null>;

/** Sends one listed request through the desktop main process (it adds the
 * credential the page never holds). A 401 means the window's session cookie
 * is a refresh behind, so one normal request refreshes it and this one is
 * sent again. */
async function shellRequest(op: ShellOp, body?: ShellBody) {
  const shell = desktopShell();
  if (!shell) throw new Error("This can only be changed in the Timely desktop app.");
  let result = await shell.request(op, body);
  if (result.status === 401) {
    await apiFetch("/instance").catch(() => undefined);
    result = await shell.request(op, body);
  }
  return result;
}

function bodyMessage(body: unknown): string | undefined {
  if (body && typeof body === "object" && "message" in body && typeof (body as { message: unknown }).message === "string") {
    return (body as { message: string }).message;
  }
  return undefined;
}

/** `GET /instance/settings`. In the desktop window it goes through the main
 * process so the answer's `shell` is true; anywhere else it is a plain read. */
export async function getInstanceSettings(): Promise<InstanceSettings> {
  if (desktopShell()) {
    const result = await shellRequest("instance.settings");
    if (!result.ok) throw new Error(saveFailureMessage(result.status, bodyMessage(result.body)));
    return result.body as InstanceSettings;
  }
  const res = await apiFetch("/instance/settings");
  if (!res.ok) {
    throw new Error(await readMessage(res, `Could not read the computer settings (${res.status})`));
  }
  return res.json();
}

async function shellSave(op: ShellOp, body: ShellBody): Promise<InstanceSettings> {
  const result = await shellRequest(op, body);
  if (!result.ok) throw new Error(saveFailureMessage(result.status, bodyMessage(result.body)));
  return result.body as InstanceSettings;
}

/** Turns the signed-in account's access to this computer on or off. Desktop window only. */
export function setHostAccount(uid: string, on: boolean): Promise<InstanceSettings> {
  const payload: HostAccountPayload = { uid, on };
  return shellSave("hostAccounts.set", payload as ShellBody);
}

/** Sets or clears ("") the signed-in account's working folder. Desktop window only. */
export function setWorkingFolder(uid: string, workingDir: string): Promise<InstanceSettings> {
  const payload: HostAccountPayload = { uid, workingDir };
  return shellSave("hostAccounts.workingDir", payload as ShellBody);
}

/** The worker cap and idle minutes. Desktop window only. */
export function setAgentLimits(limits: AgentLimitsPayload): Promise<InstanceSettings> {
  return shellSave("agentLimits.set", limits as ShellBody);
}
