/**
 * What a host card shows and which of its buttons work (phase 5, work
 * packages contract 8 and decisions 7 and 12): pure functions over the
 * contract's HostRequest and ClosedHost, so both apps draw the same words.
 * The phone's lib/chat/host.ts is this file's twin: `make test-mobile-assistant`
 * runs the same cases on both and fails when they differ.
 *
 * A card's command, path and URL are plain text for the screen to draw in a
 * monospace block: they come from the model's call, which may have read an
 * outside page, so no function here ever makes a link of them.
 */
import {
  AUTO_ASKS_BEFORE,
  FULL_ACCESS_PHONE_NOTE,
  HOST_BUTTONS,
  HOST_CARD_STATE_WORDS,
  HOST_ERRORS,
  HOST_TIMEOUT_LIMITS,
  hostCanUndo,
  hostCardState,
  hostCardTitle,
  hostChoices,
  hostNeedsUnlock,
  hostSecondsLeft,
  hostTimeLeft,
  type ClosedHost,
  type FullAccessAllowedOn,
  type HostApprovalRule,
  type HostCard,
  type HostCardKind,
  type HostCardState,
  type HostChoice,
  type HostDevice,
  type HostRequest,
} from "@timely/contract/agentChat";

/** Where the person is answering from. "desktop" is the desktop window (it
 * holds the shell bridge), "web" any other browser, "phone" the app. */
export type Surface = "desktop" | "web" | "phone";

/** The label above the monospace block, by what the card is about. */
export function subjectLabel(kind: HostCardKind): string {
  switch (kind) {
    case "terminal":
      return "Command";
    case "file":
      return "File";
    case "code":
      return "Code";
    case "browser":
      return "Address";
    case "mcp":
      return "Tool";
    case "mcp_server":
      return "Command to start it";
  }
}

/** The card's one block of text: its command, path, URL or server, whole. */
export function subjectText(card: HostCard | null | undefined): string {
  if (!card) return "";
  const text = (
    card.command ||
    card.path ||
    card.url ||
    card.server ||
    ""
  ).trim();
  return text;
}

/** "Always asks: Deleting or overwriting" for a critical-list item, else "". */
export function criticalLine(item: number | undefined): string {
  const row = AUTO_ASKS_BEFORE.find((r) => r.item === item);
  return row ? `Always asks, in every mode: ${row.title.toLowerCase()}` : "";
}

/** What "Allow for this chat" would cover, named, or "". */
export function grantLine(request: HostRequest | null | undefined): string {
  if (!request?.card?.grantable) return "";
  const label = request.grant?.label?.trim();
  return label
    ? `Covers later calls like ${label} in this chat only.`
    : "Covers later calls of the same kind in this chat only.";
}

export type HostCardView = {
  state: "live" | "parked";
  title: string;
  /** "Needs your OK" or "Paused: waiting for your OK". */
  stateWord: string;
  /** The line under the title: what the wait is. */
  lead: string;
  kind: HostCardKind;
  subjectLabel: string;
  subject: string;
  cwd: string;
  /** Environment variable names a command MCP server is started with. */
  envNames: string[];
  reason: string;
  critical: string;
  timeLeft: string;
  timeUp: boolean;
  soon: boolean;
  /** The choices Go offers, in order. */
  choices: HostChoice[];
  grant: string;
};

/** Everything an open card draws. */
export function hostCardView(
  request: HostRequest,
  now: Date | number = Date.now(),
): HostCardView {
  const card = request.card;
  const kind = card?.kind ?? "terminal";
  const parked = request.phase === "parked";
  const left = hostSecondsLeft(request, now);
  return {
    state: parked ? "parked" : "live",
    title: card?.title?.trim() || hostCardTitle({ kind, server: card?.server }),
    stateWord: HOST_CARD_STATE_WORDS[parked ? "parked" : "live"],
    lead:
      kind === "mcp_server"
        ? "This server is not added yet. It starts only after you choose."
        : parked
          ? "The assistant stopped to wait. Run once starts it again to run exactly this."
          : "The assistant is waiting for you. Nothing runs until you choose.",
    kind,
    subjectLabel: subjectLabel(kind),
    subject: subjectText(card),
    cwd: card?.cwd?.trim() ?? "",
    envNames: card?.envNames ?? [],
    reason: card?.reason?.trim() ?? "",
    critical: criticalLine(card?.criticalItem),
    timeLeft: hostTimeLeft(request, now),
    timeUp: left !== null && left <= 0,
    soon: left !== null && left <= 60,
    choices: hostChoices(request),
    grant: grantLine(request),
  };
}

/** Which of an open card's choices this device may send right now, and why not. */
export type ChoiceAccess = {
  choice: HostChoice;
  label: string;
  enabled: boolean;
  why: string;
  needsUnlock: boolean;
};

/**
 * The buttons for this surface under the account's rule (decision 12):
 * Deny always works; Run once and Allow for this chat need the desktop window
 * under the "desktop" rule, and a phone that unlocked first.
 */
export function choiceAccess(
  choices: HostChoice[],
  surface: Surface,
  rule: HostApprovalRule | undefined,
): ChoiceAccess[] {
  return choices.map((choice) => {
    const desktopOnly =
      choice !== "deny" && rule === "desktop" && surface !== "desktop";
    return {
      choice,
      label: HOST_BUTTONS[choice],
      enabled: !desktopOnly,
      why: desktopOnly ? HOST_ERRORS.desktopOnly : "",
      needsUnlock: hostNeedsUnlock(
        choice,
        surface === "phone" ? "phone" : "web",
      ),
    };
  });
}

/** The device sent with an answer. The server marks the desktop window itself. */
export function answerDevice(
  surface: Surface,
  name: string,
  unlocked: boolean,
): HostDevice {
  return surface === "phone"
    ? { kind: "phone", name, unlocked }
    : { kind: surface, name };
}

/** The body of POST /chats/:id/host-approval. */
export function hostAnswerBody(
  request: HostRequest,
  revision: number,
  choice: HostChoice,
  device: HostDevice,
): {
  revision: number;
  requestId: string;
  choice: HostChoice;
  device: HostDevice;
} {
  return { revision, requestId: request.requestId ?? "", choice, device };
}

/** The answer a refused request shows on the card, in the person's words. */
export function hostAnswerError(
  status: number | undefined,
  message: string,
): string {
  if (status === 403 && /unlock/i.test(message)) return HOST_ERRORS.phoneLocked;
  if (status === 403 && /desktop/i.test(message))
    return HOST_ERRORS.desktopOnly;
  if (status === 409) return message || HOST_ERRORS.answered;
  return message || "Couldn't send your answer. Try again.";
}

/** Whether a failed answer means the card is gone or changed: refetch the chat. */
export function hostAnswerStale(status: number | undefined): boolean {
  return status === 409;
}

export type ClosedHostView = {
  state: HostCardState;
  /** "Ran", "Allowed for this chat", "Denied", "Expired, not run", "Stopped before you answered". */
  stateWord: string;
  /** The card's question without its mark: "Run this command". */
  title: string;
  kind: HostCardKind;
  subjectLabel: string;
  subject: string;
  cwd: string;
  /** "On your phone", "In the desktop app", "In a browser", or "". */
  deviceNote: string;
  /** The activity line: "Ran `ls`", "Changed notes.md". */
  line: string;
  /** A call that ran by itself (Auto, Full Access or an earlier grant). */
  auto: boolean;
  canUndo: boolean;
  undone: boolean;
  /** The note under a card that did not run. */
  note: string;
  /** Whether the call actually ran. */
  ran: boolean;
};

function deviceNote(device: HostDevice | undefined): string {
  switch (device?.kind) {
    case "phone":
      return "On your phone";
    case "desktop":
      return "In the desktop app";
    case "web":
      return "In a browser";
    default:
      return "";
  }
}

function plainName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function hostOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url.trim());
  return (m ? m[1] : url).replace(/^www\./, "");
}

/**
 * The one line a host call leaves in the activity: what it did, in the
 * past tense, with the command, file, site or server named. Plain text;
 * the screen draws a command inside backticks as code.
 */
export function hostLine(
  host: Pick<ClosedHost, "tool" | "card" | "outcome">,
): string {
  const card = host.card;
  const kind = card?.kind;
  const ran = host.outcome === "ran" || host.outcome === "allowed";
  const subject = subjectText(card);
  const first = subject.split("\n")[0].trim();
  const short = first.length > 80 ? `${first.slice(0, 79)}…` : first;
  if (!ran) {
    const what = short || host.tool;
    if (host.outcome === "denied")
      return `Denied ${kind === "browser" ? "opening" : ""} ${what}`
        .replace(/\s+/g, " ")
        .trim();
    if (host.outcome === "expired") return `Expired, not run: ${what}`;
    return `Stopped before you answered: ${what}`;
  }
  switch (kind) {
    case "terminal":
      return `Ran \`${short}\``;
    case "code":
      return "Ran code";
    case "file":
      return `Changed ${plainName(card?.path ?? short)}`;
    case "browser":
      return `Opened ${hostOf(card?.url ?? short)} in your browser`;
    case "mcp":
      return `Used ${card?.server || host.tool}`;
    case "mcp_server":
      return `Added ${card?.server || short}`;
    default:
      return `Ran ${short || host.tool}`;
  }
}

/** Everything a closed card or an auto host line draws. */
export function closedHostView(host: ClosedHost): ClosedHostView {
  const card = host.card;
  const kind = card?.kind ?? "terminal";
  const state = hostCardState(host);
  const ran = host.outcome === "ran" || host.outcome === "allowed";
  const undone = !!host.undoneAt;
  return {
    state,
    stateWord: HOST_CARD_STATE_WORDS[state],
    title: (
      card?.title?.trim() || hostCardTitle({ kind, server: card?.server })
    ).replace(/\?$/, ""),
    kind,
    subjectLabel: subjectLabel(kind),
    subject: subjectText(card),
    cwd: card?.cwd?.trim() ?? "",
    deviceNote: host.auto ? "" : deviceNote(host.device),
    line: hostLine(host),
    auto: !!host.auto,
    canUndo: hostCanUndo(host),
    undone,
    ran,
    note:
      host.outcome === "denied"
        ? "Nothing ran. The assistant was told you said no."
        : host.outcome === "expired"
          ? "Nobody answered in time, so nothing ran."
          : host.outcome === "stopped"
            ? "You stopped the reply first, so nothing ran."
            : "",
  };
}

/** The word a screen reader gets when a card closes. */
export function hostClosedAnnouncement(host: ClosedHost | undefined): string {
  if (!host) return "";
  return `Host card closed: ${HOST_CARD_STATE_WORDS[hostCardState(host)]}`;
}

/** How the composer treats a chat that waits on a host card. */
export type HostComposer = {
  /** A live card: the run is paused, so only Stop applies and typing waits. */
  locked: boolean;
  /** A parked card: a message closes it and runs as the next turn. */
  skips: boolean;
  placeholder: string;
  hint: string;
};

export function hostComposer(
  request: HostRequest | null | undefined,
  waiting: boolean,
): HostComposer {
  if (!waiting)
    return { locked: false, skips: false, placeholder: "", hint: "" };
  if (request?.phase === "parked")
    return {
      locked: false,
      skips: true,
      placeholder: "Or tell it something else instead…",
      hint: "Sending a message skips this card: nothing runs, and the assistant reads your message.",
    };
  return {
    locked: true,
    skips: false,
    placeholder: "Answer the card above to go on",
    hint: "A message can't answer this card. Choose on the card, or stop this reply.",
  };
}

/** Whether Full Access can be turned on from this surface, and what the picker says. */
export type FullAccessAccess = {
  allowed: boolean;
  needsUnlock: boolean;
  note: string;
};

/**
 * Decision 7: Full Access needs the step-up. The desktop window has it; the
 * phone only where the account allowed Full Access on any device, after
 * device unlock; a browser never does.
 */
export function fullAccessAccess(
  surface: Surface,
  allowedOn: FullAccessAllowedOn | undefined,
): FullAccessAccess {
  if (surface === "desktop")
    return { allowed: true, needsUnlock: false, note: "" };
  if (surface === "phone" && allowedOn === "devices")
    return {
      allowed: true,
      needsUnlock: true,
      note: "Asks for your fingerprint, face or screen lock first",
    };
  return { allowed: false, needsUnlock: false, note: FULL_ACCESS_PHONE_NOTE };
}

/** The 403 of a loosening change (go-engine errDesktopRule). */
export const LOOSEN_ON_DESKTOP = "Change this from the desktop app";

export type SettingsField =
  | "hostApprovalRule"
  | "fullAccessAllowedOn"
  | "chatPermission"
  | "botPermission";

/**
 * Whether this surface may make a Permissions change (decision 12 and
 * go-engine's rules): looser settings need the desktop window, a Full Access
 * default needs the step-up, anything stricter works anywhere.
 */
export function settingAccess(
  surface: Surface,
  field: SettingsField,
  next: string,
  allowedOn: FullAccessAllowedOn | undefined,
): { allowed: boolean; needsUnlock: boolean; why: string } {
  const open = { allowed: true, needsUnlock: false, why: "" };
  if (surface === "desktop") return open;
  if (
    (field === "hostApprovalRule" || field === "fullAccessAllowedOn") &&
    next === "devices"
  )
    return { allowed: false, needsUnlock: false, why: LOOSEN_ON_DESKTOP };
  if (
    (field === "chatPermission" || field === "botPermission") &&
    next === "full"
  ) {
    const access = fullAccessAccess(surface, allowedOn);
    return {
      allowed: access.allowed,
      needsUnlock: access.needsUnlock,
      why: access.allowed ? "" : HOST_ERRORS.fullAccess,
    };
  }
  return open;
}

/** The two answers to "Host cards", as Settings → Permissions words them. */
export const HOST_RULE_OPTIONS: {
  value: HostApprovalRule;
  label: string;
  hint: string;
}[] = [
  {
    value: "devices",
    label: "Any of my devices",
    hint: "On the phone it asks for your fingerprint, face or screen lock first.",
  },
  {
    value: "desktop",
    label: "Only the desktop window",
    hint: "Other devices can still say Deny.",
  },
];

export const HOST_ALLOWED_ON_OPTIONS: {
  value: FullAccessAllowedOn;
  label: string;
}[] = [
  { value: "desktop", label: "This desktop" },
  { value: "devices", label: "Any of my devices" },
];

/** The minutes "Cards wait up to" offers, between the contract's limits. */
export const HOST_TIMEOUT_CHOICES: number[] = [10, 15, 20, 30, 45, 60].filter(
  (m) => m >= HOST_TIMEOUT_LIMITS.min && m <= HOST_TIMEOUT_LIMITS.max,
);

export function timeoutLabel(minutes: number | undefined): string {
  const m = minutes ?? HOST_TIMEOUT_LIMITS.default;
  return m === 60 ? "1 hour" : `${m} minutes`;
}

export function ruleLabel(rule: HostApprovalRule | undefined): string {
  return (
    HOST_RULE_OPTIONS.find((o) => o.value === (rule ?? "devices"))?.label ??
    HOST_RULE_OPTIONS[0].label
  );
}

/** The rows under "Auto always asks before" that the host tools add. */
export const AUTO_ASKS_HOST_NOTE =
  "On this computer that covers commands, writes, installs and every browser step. Supervised asks before all of it.";

/** What the permission sheet says under "Allowed for this chat", and its empty state. */
export const GRANTS_TITLE = "Allowed for this chat";
export const GRANTS_EMPTY =
  "Nothing yet. Choose Allow for this chat on a card to add it.";
export const GRANTS_HINT =
  "These run without a card in this chat only. A command that sends, deletes or installs still asks in Auto.";

/**
 * What a notification says a host card is about: what the assistant wants
 * to do, never the command itself (a lock screen shows it to anyone).
 */
export function hostPushBody(
  request: Pick<HostRequest, "card"> | null | undefined,
): string {
  const card = request?.card;
  switch (card?.kind) {
    case "file":
      return "Your assistant wants to change a file.";
    case "browser":
      return "Your assistant wants to use your browser.";
    case "mcp":
      return card.server
        ? `Your assistant wants to use ${card.server}.`
        : "Your assistant wants to use an MCP server.";
    case "mcp_server":
      return "Your assistant wants to add an MCP server.";
    case "code":
      return "Your assistant wants to run some code.";
    default:
      return "Your assistant wants to run a command.";
  }
}
