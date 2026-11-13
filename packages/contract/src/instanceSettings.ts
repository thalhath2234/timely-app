/**
 * Instance settings (plan 11.2, 12): which accounts may use this computer for
 * host tools, each one's working folder, and the agent worker limits. The
 * server keeps them in `instance_settings`; the desktop window alone changes
 * them (`PUT /instance/host-accounts`, `PUT /instance/agent-limits` answer 404
 * to anyone else). Settings → Server shows them on the web and on the phone.
 * The words are shared so both say the same thing. Pure: no app imports.
 */

/** Where an account was turned on: the desktop window, or the server's `TIMELY_AGENT_HOST_ACCOUNTS`. */
export type HostAccountSource = "desktop" | "server";

/** One account that may use this computer (`GET /instance/settings`). */
export type InstanceHostAccount = {
  uid: string;
  email: string;
  /** "" means the assistant's own workspace folder. */
  workingDir: string;
  source: HostAccountSource;
};

/** `GET /instance/settings`. */
export type InstanceSettings = {
  hostAccounts: InstanceHostAccount[];
  /** The signed-in account may use this computer. */
  thisAccountHostAllowed: boolean;
  thisAccountWorkingDir: string;
  maxWorkers: number;
  idleMinutes: number;
  /** This very request came from the desktop window, the only place these settings change. */
  shell: boolean;
};

/** `PUT /instance/host-accounts`: `on` and `workingDir` are each optional, one must be given. */
export type HostAccountPayload = { uid: string; on?: boolean; workingDir?: string };

/** `PUT /instance/agent-limits`. */
export type AgentLimitsPayload = { maxWorkers: number; idleMinutes: number };

/** The limits the server accepts (apps/api/internal/features/instance/store.go). */
export const WORKER_LIMIT = { min: 1, max: 16 } as const;
export const IDLE_MINUTES_LIMIT = { min: 1, max: 240 } as const;

export const HOST_TOGGLE_LABEL = "Let the assistant use this computer";

/** The limit, said once, wherever the switch appears. */
export const HOST_LIMIT_COPY =
  "With this on, the assistant can ask to run commands, change files and use your browser here. " +
  "You approve each one on a card first. An approved command runs as you on this computer, " +
  "so it can read every account's data here, not only this account's.";

export const HOST_DESKTOP_ONLY = "Turn this on in the desktop app.";

export const WORKING_FOLDER_LABEL = "Working folder";
export const WORKING_FOLDER_NONE = "Not chosen. The assistant works in its own folder.";
export const WORKING_FOLDER_HINT =
  "Commands start here and the assistant reads this folder's project notes (AGENTS.md, CLAUDE.md). " +
  "A command can still reach any folder you approve.";

export function sourceLabel(source: HostAccountSource): string {
  return source === "server" ? "Set by the server" : "Turned on in the desktop app";
}

export function workingFolderLabel(dir: string): string {
  return dir.trim() === "" ? WORKING_FOLDER_NONE : dir;
}

export type HostAccountRow = {
  uid: string;
  /** The account's email, or "Account" when the server could not read it. */
  title: string;
  /** "You" on the signed-in account's row, else "". */
  you: string;
  source: HostAccountSource;
  sourceLabel: string;
  folder: string;
};

/** The list of accounts that may use this computer, the signed-in one first. */
export function hostAccountRows(settings: InstanceSettings, signedInUid: string | null): HostAccountRow[] {
  const rows = settings.hostAccounts.map((account) => ({
    uid: account.uid,
    title: account.email || "Account",
    you: signedInUid !== null && account.uid === signedInUid ? "You" : "",
    source: account.source,
    sourceLabel: sourceLabel(account.source),
    folder: workingFolderLabel(account.workingDir),
  }));
  return rows.sort((a, b) => (a.you === b.you ? 0 : a.you ? -1 : 1));
}

export type HostSectionState = {
  /** The switch and the fields can be used: this is the desktop window. */
  editable: boolean;
  /** The switch can be turned off here: not set by the server. */
  canTurnOff: boolean;
  checked: boolean;
  /** One sentence under the switch when it cannot be used, else "". */
  note: string;
};

export function hostSectionState(settings: InstanceSettings, inDesktopWindow: boolean, signedInSource: HostAccountSource | null): HostSectionState {
  const checked = settings.thisAccountHostAllowed;
  if (!inDesktopWindow) return { editable: false, canTurnOff: false, checked, note: HOST_DESKTOP_ONLY };
  if (checked && signedInSource === "server") {
    return { editable: true, canTurnOff: false, checked, note: "The server's settings allow this account (TIMELY_AGENT_HOST_ACCOUNTS). Change them there to turn it off." };
  }
  return { editable: true, canTurnOff: true, checked, note: "" };
}

/** The phone's read-only line: "This account can use the computer: Yes". */
export function phoneHostLine(settings: InstanceSettings | null): { label: string; value: string; hint: string } {
  const label = "This account can use the computer";
  if (!settings) return { label, value: "—", hint: "" };
  return {
    label,
    value: settings.thisAccountHostAllowed ? "Yes" : "No",
    hint: settings.thisAccountHostAllowed
      ? "The assistant can ask to run commands and change files on the computer. You approve each one."
      : "To let the assistant use the computer, turn this on in the Timely desktop app, under Settings, Server.",
  };
}

/** Why a worker cap and idle time cannot be saved, or null. Mirrors the server's checks. */
export function agentLimitsError(maxWorkers: unknown, idleMinutes: unknown): string | null {
  if (!Number.isInteger(maxWorkers) || (maxWorkers as number) < WORKER_LIMIT.min || (maxWorkers as number) > WORKER_LIMIT.max) {
    return `Workers must be a whole number from ${WORKER_LIMIT.min} to ${WORKER_LIMIT.max}.`;
  }
  if (!Number.isInteger(idleMinutes) || (idleMinutes as number) < IDLE_MINUTES_LIMIT.min || (idleMinutes as number) > IDLE_MINUTES_LIMIT.max) {
    return `Idle minutes must be a whole number from ${IDLE_MINUTES_LIMIT.min} to ${IDLE_MINUTES_LIMIT.max}.`;
  }
  return null;
}

/** Reads a number the person typed; anything that is not a whole number is NaN (so agentLimitsError says why). */
export function parseWholeNumber(text: string): number {
  return /^\s*\d{1,4}\s*$/.test(text) ? Number(text) : Number.NaN;
}

/** A refused save, in words for the person. */
export function saveFailureMessage(status: number, serverMessage: string | undefined): string {
  if (serverMessage) return serverMessage;
  if (status === 404) return "This can only be changed in the Timely desktop app.";
  if (status === 401) return "Sign in again, then try once more.";
  return `Could not save that (${status}).`;
}
