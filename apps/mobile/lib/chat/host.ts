/**
 * What a host card shows and which of its buttons work (phase 5, work
 * packages contract 8 and decisions 7 and 12): pure functions over the
 * contract's HostRequest and ClosedHost, so both apps draw the same words.
 * The web's app/_components/chat/hostView.ts is this file's twin: `make test-mobile-assistant`
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

/** The label above the monospace block, by what the card is about. A file
 * card that carries a pattern is a search: its block is what is searched for. */
export function subjectLabel(
  kind: HostCardKind,
  card?: HostCard | null,
): string {
  switch (kind) {
    case "terminal":
      // Text typed into a running program is not a command run in a folder.
      return card?.stdin ? "Text to type" : "Command";
    case "file":
      if (card?.command?.trim()) return "Search for";
      // A patch can change and delete several files: one line each.
      return (card?.path ?? "").trim().includes("\n") ? "Files" : "File";
    case "code":
      return "Code";
    case "browser":
      // A script that names no address is the whole subject.
      return card?.url?.trim() ? "Address" : "Script";
    case "mcp":
      return "Tool";
    case "mcp_server":
      return "Command to start it";
  }
}

/** The card's one block of text, by what the card is about: a command for a
 * terminal, code or MCP call, the file (or, for a search, the pattern) for a
 * file card, the address for the browser. Whole, never cut. */
export function subjectText(card: HostCard | null | undefined): string {
  if (!card) return "";
  const pick = (...fields: (string | undefined)[]): string =>
    (fields.find((f) => f && f.trim()) ?? "").trim();
  switch (card.kind) {
    case "file":
      return pick(card.command, card.path);
    case "browser":
      return pick(card.url, card.command);
    case "terminal":
    case "code":
    case "mcp":
    case "mcp_server":
      return pick(card.command, card.server);
    default:
      return pick(card.command, card.path, card.url, card.server);
  }
}

/** A second block under the first, when the card carries more than one thing:
 * the script a browser call runs on the address it names. */
export function detailBlock(card: HostCard | null | undefined): {
  label: string;
  text: string;
} {
  if (card?.kind === "browser" && card.url?.trim() && card.command?.trim())
    return { label: "Script", text: card.command.trim() };
  // The program that gets the typed text: Hermes names it by session id only.
  if (card?.stdin && card.session?.trim())
    return { label: "Typed into the running command", text: card.session.trim() };
  return { label: "", text: "" };
}

/** What a browser script that names no address acts on: the page that is
 * already open. "" for every other card. */
export function pageLine(card: HostCard | null | undefined): string {
  if (card?.stdin)
    return "Sent to a command that is already running: it answers whatever that command is asking. Look at the command that started it, earlier in this chat.";
  return card?.kind === "browser" && !card.url?.trim()
    ? "Runs on the page that is open in your browser"
    : "";
}

/** The "In" line: the folder a search looks in, else the folder the command
 * starts in. */
export function whereLine(card: HostCard | null | undefined): string {
  if (!card || card.stdin) return "";
  if (card.kind === "file" && card.command?.trim() && card.path?.trim())
    return card.path.trim();
  return card.cwd?.trim() ?? "";
}

/** "Auto always asks before this: deleting or overwriting" for a critical-list
 * item, else "". Auto is what the list belongs to: Full Access lifts it, and
 * no grant covers it, except item 6 (a change after reading outside content)
 * when everything read was local: that card is grantable, so it says Auto
 * asks "unless you allow it for this chat", never "always". */
export function criticalLine(
  item: number | undefined,
  grantable?: boolean,
): string {
  const row = AUTO_ASKS_BEFORE.find((r) => r.item === item);
  if (!row) return "";
  return grantable
    ? `Auto asks before this unless you allow it for this chat: ${row.title.toLowerCase()}`
    : `Auto always asks before this: ${row.title.toLowerCase()}`;
}

/** Go's reason in the person's words. The critical list's reasons are verb
 * phrases ("deletes folders"); the rest are whole sentences already. */
export function reasonLine(reason: string | undefined): string {
  const text = (reason ?? "").trim();
  if (!text) return "";
  if (!/^[a-z]/.test(text)) return /[.!?]$/.test(text) ? text : `${text}.`;
  const person = text
    .replace(/\bthe person has not\b/g, "you have not")
    .replace(/\bthe person\b/g, "you");
  return `Asks because it ${person}.`;
}

/** What "Allow for this chat" would cover, named, or "". */
export function grantLine(request: HostRequest | null | undefined): string {
  if (!request?.card?.grantable) return "";
  const label = request.grant?.label?.trim();
  if (!label)
    return "Allow for this chat covers later calls of the same kind here.";
  return `Allow for this chat covers: ${label.charAt(0).toLowerCase()}${label.slice(1)}.`;
}

export type HostCardView = {
  state: "live" | "parked";
  title: string;
  /** "Needs your OK" or "Waiting for your OK". */
  stateWord: string;
  /** The line under the title: what the wait is. */
  lead: string;
  kind: HostCardKind;
  subjectLabel: string;
  subject: string;
  /** A second block (the browser's script), "" when none. */
  detailLabel: string;
  detail: string;
  /** The "In" line: the folder searched, else the folder the command starts in. */
  cwd: string;
  /** "Runs on the page that is open in your browser" for a script with no address, else "". */
  page: string;
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
    subjectLabel: subjectLabel(kind, card),
    subject: subjectText(card),
    detailLabel: detailBlock(card).label,
    detail: detailBlock(card).text,
    cwd: whereLine(card),
    page: pageLine(card),
    envNames: card?.envNames ?? [],
    reason: reasonLine(card?.reason),
    critical: criticalLine(card?.criticalItem, card?.grantable),
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

/** What the phone says under the buttons about unlocking: only the choices
 * that are offered and need it ("Run once asks for your fingerprint, face or
 * screen lock."), or "" when none do. */
export function unlockLine(access: ChoiceAccess[]): string {
  const names = access
    .filter((a) => a.enabled && a.needsUnlock)
    .map((a) => a.label);
  if (names.length === 0) return "";
  const who =
    names.length === 1
      ? `${names[0]} asks`
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} ask`;
  return `${who} for your fingerprint, face or screen lock.`;
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
  detailLabel: string;
  detail: string;
  cwd: string;
  page: string;
  /** "Approved on your phone", "Denied in the desktop app", ..., or "". */
  deviceNote: string;
  /** The activity line: "Ran `ls`", "Changed notes.md". */
  line: string;
  /** The line around the command it quotes (no backticks): draw `code` in monospace. */
  lineBefore: string;
  lineCode: string;
  lineAfter: string;
  /** A call that ran by itself (Auto, Full Access or an earlier grant). */
  auto: boolean;
  canUndo: boolean;
  undone: boolean;
  /** The note under a card that did not run. */
  note: string;
  /** Whether the call actually ran. */
  ran: boolean;
};

/** Where the person answered, said as what they did: "Approved on your phone",
 * "Denied in the desktop app". Nothing for a card nobody answered. */
function deviceNote(
  device: HostDevice | undefined,
  outcome: ClosedHost["outcome"],
): string {
  const verb =
    outcome === "denied"
      ? "Denied"
      : outcome === "expired" || outcome === "stopped"
        ? ""
        : "Approved";
  if (!verb) return "";
  switch (device?.kind) {
    case "phone":
      return `${verb} on your phone`;
    case "desktop":
      return `${verb} in the desktop app`;
    case "web":
      return `${verb} in a browser`;
    default:
      return "";
  }
}

function plainName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

/** What a file call changed, in the past tense. A patch names several files,
 * one per line ("Change …/a.md", "Delete …/b.md"): count them rather than
 * naming the last one. */
function filesLine(path: string): string {
  const lines = path
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length <= 1) return `Changed ${plainName(path)}`;
  const deleted = lines.filter((l) => /^Delete\s/.test(l)).length;
  const changed = lines.length - deleted;
  const count = (n: number) => `${n} ${n === 1 ? "file" : "files"}`;
  if (!changed) return `Deleted ${count(deleted)}`;
  return deleted
    ? `Changed ${count(changed)}, deleted ${count(deleted)}`
    : `Changed ${count(changed)}`;
}

/** An activity line split around the command it quotes: the screen draws the
 * command in monospace, never with its backticks. */
export function lineParts(line: string): {
  before: string;
  code: string;
  after: string;
} {
  const m = /^([^`]*)`([^`]*)`([\s\S]*)$/.exec(line);
  return m
    ? { before: m[1], code: m[2], after: m[3] }
    : { before: line, code: "", after: "" };
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
    if (host.outcome === "denied") {
      if (card?.stdin) return `Denied typing \`${short}\` into a running command`;
      if (kind === "browser" && !card?.url?.trim())
        return "Denied using your browser";
      return `Denied ${kind === "browser" ? "opening" : ""} ${what}`
        .replace(/\s+/g, " ")
        .trim();
    }
    if (host.outcome === "expired") return `Expired, not run: ${what}`;
    if (host.outcome === "approved") return `Approved, waiting to run: ${what}`;
    if (host.outcome === "notrun") return `Approved, did not run: ${what}`;
    return `Stopped before you answered: ${what}`;
  }
  switch (kind) {
    case "terminal":
      if (card?.stdin) return `Typed \`${short}\` into a running command`;
      if (card?.session) return short; // "Stop the running command proc_1"
      return `Ran \`${short}\``;
    case "code":
      return "Ran code";
    case "file":
      return filesLine(card?.path ?? short);
    case "browser":
      return card?.url?.trim()
        ? `Opened ${hostOf(card.url)} in your browser`
        : "Used your browser";
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
    // An MCP server that was added did not "run": it is in Settings now.
    stateWord:
      kind === "mcp_server" && ran
        ? "Added"
        : kind === "mcp_server" && state === "expired"
          ? "Expired, not added"
          : HOST_CARD_STATE_WORDS[state],
    title: (
      card?.title?.trim() || hostCardTitle({ kind, server: card?.server })
    ).replace(/\?$/, ""),
    kind,
    subjectLabel: subjectLabel(kind, card),
    subject: subjectText(card),
    detailLabel: detailBlock(card).label,
    detail: detailBlock(card).text,
    cwd: whereLine(card),
    page: pageLine(card),
    deviceNote: host.auto ? "" : deviceNote(host.device, host.outcome),
    line: hostLine(host),
    lineBefore: lineParts(hostLine(host)).before,
    lineCode: lineParts(hostLine(host)).code,
    lineAfter: lineParts(hostLine(host)).after,
    auto: !!host.auto,
    canUndo: hostCanUndo(host),
    undone,
    ran,
    note:
      host.outcome === "denied"
        ? kind === "mcp_server"
          ? "Not added. Nothing ran."
          : "Nothing ran. The assistant was told you said no."
        : host.outcome === "expired"
          ? kind === "mcp_server"
            ? "Nobody answered in time, so it was not added."
            : "Nobody answered in time, so nothing ran."
          : host.outcome === "stopped"
            ? "You stopped the reply first, so nothing ran."
            : host.outcome === "approved"
              ? "It runs as soon as the assistant gets to it."
              : host.outcome === "notrun"
                ? "The reply was stopped or ended before this ran, so it did not."
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
  { value: "desktop", label: "The desktop app" },
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
  "On this computer Auto also asks before every command that is not simple and read-only (it runs ls, cat, grep, find, git status and the like in the working folder), anything typed into a running command, all code and every browser step. Writes inside the working folder run on their own. Supervised asks before all of it.";

/** What the permission sheet says under "Allowed for this chat", and its empty state. */
export const GRANTS_TITLE = "Allowed for this chat";
export const GRANTS_EMPTY =
  "Nothing yet. Choose Allow for this chat on a card to add it.";
export const GRANTS_HINT =
  "These run without a card in this chat only. Anything that deletes, sends, pays or installs still asks.";

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
      return /^(read|search)/i.test(card.title ?? "")
        ? "Your assistant wants to read a file."
        : "Your assistant wants to change a file.";
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
